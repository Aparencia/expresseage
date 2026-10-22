// handlers/message/_common.js · 消息域共用件：订单参与方判定 / 内容安全 / 消息 DTO / 已读水位
// 口径：DATA_MODEL §2.7/§5.2/§7.6；消息中心=order_events 状态类事件 + order_messages + 公告聚合，无 notifications 集合。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { readConfig } = require('../../db/config');
const { errors } = require('../../lib/errors');

const PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 100;
const MAX_ORDERS_SCAN = 20;
const EVENTS_PER_ORDER = 2;
const MESSAGES_PER_ORDER = 2;
const TEXT_MAX = 200;

function identityOf(ctx) {
  return (ctx && ctx.identity) || {};
}

// identity.roles = auth 按 users.roles 归一出的业务角色集（双角色 [CUSTOMER,PARTNER]）；
// 切换会话/手工注入 ctx 只有 role 时回落单元素集，保持单角色语义不变。
function rolesOfIdentity(identity) {
  const source = identity || {};
  const raw = Array.isArray(source.roles) ? source.roles : [];
  const roles = [];
  if (raw.indexOf(enums.ROLES.CUSTOMER) >= 0) {
    roles.push(enums.ROLES.CUSTOMER);
  }
  if (raw.indexOf(enums.ROLES.PARTNER) >= 0) {
    roles.push(enums.ROLES.PARTNER);
  }
  if (roles.length === 0
    && (source.role === enums.ROLES.CUSTOMER || source.role === enums.ROLES.PARTNER)) {
    roles.push(source.role);
  }
  return roles;
}

function scopeOf(ctx) {
  const identity = identityOf(ctx);
  return {
    role: identity.role || '',
    roles: rolesOfIdentity(identity),
    openid: identity.effectiveOpenid || (ctx && ctx.openid) || '',
    readOnly: identity.viewMode === enums.VIEW_MODE.READONLY,
    testWrite: identity.viewMode === enums.VIEW_MODE.TEST_WRITE,
    impersonatedBy: identity.viewMode === enums.VIEW_MODE.TEST_WRITE ? identity.developerNo || '' : ''
  };
}

function assertWritable(ctx) {
  if (scopeOf(ctx).readOnly) {
    throw errors.forbidden('开发者只读视角不能操作');
  }
}

function nowMsOf(ctx) {
  const value = ctx ? ctx.now : null;
  if (typeof value === 'function') {
    return value();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  return Date.now();
}

function toIso(value) {
  const ms = time.toMs(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

async function loadConfig(ctx) {
  if (ctx && ctx.config && typeof ctx.config === 'object' && Object.keys(ctx.config).length > 0) {
    return ctx.config;
  }
  const result = await readConfig(ctx.dao);
  return result.config;
}

async function getOrderByNo(ctx, orderNo) {
  return ctx.dao.findOne(COLLECTIONS.ORDERS, { where: { orderNo } });
}

function normalizeOrderNoInput(value) {
  const orderNo = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!orderNo || !enums.ORDER_NO_PATTERN.test(orderNo)) {
    throw errors.validation('orderNo', '订单号格式不正确，请核对后重试');
  }
  return orderNo;
}

// 订单参与方：CUSTOMER（本人单）/ PARTNER（本人订单，含代客单）/ ADMIN（只读，不允许发消息）。
// 侧别按「订单归属 + users.roles 是否含该侧角色」判定（双角色两类订单都可参与，不依赖 activeRole）。
function orderSideOf(ctx, order) {
  if (!order) {
    return '';
  }
  const scope = scopeOf(ctx);
  if (scope.role === enums.CANCELLED_BY.ADMIN) {
    return 'ADMIN';
  }
  if (scope.roles.indexOf(enums.ROLES.PARTNER) >= 0
    && order.partnerOpenid && order.partnerOpenid === scope.openid) {
    return 'PARTNER';
  }
  if (scope.roles.indexOf(enums.ROLES.CUSTOMER) >= 0
    && order.customerId && order.customerId === scope.openid) {
    return 'CUSTOMER';
  }
  return '';
}

function assertParticipant(ctx, order) {
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  const side = orderSideOf(ctx, order);
  if (!side) {
    throw errors.forbidden('无权查看该订单留言');
  }
  return side;
}

// 测试数据隔离：真实会话（含 READONLY）不得看到测试订单/测试通知；TEST_WRITE 会话只看测试单
function isTestSession(ctx) {
  return scopeOf(ctx).testWrite;
}

function assertTestOrderVisible(ctx, order) {
  const expectTest = isTestSession(ctx);
  if ((order.isTest === true) !== expectTest) {
    throw errors.notFound('订单不存在或不可查看');
  }
}

// 内容安全：微信 msgSecCheck v2（未过→VALIDATION_FAILED，data.field 指向文本字段）；
// 本地/单测无 openapi 时跳过（部署环境由 wx-server-sdk 提供，跳过不影响业务主流程）。
async function checkContentSecurity(ctx, text, field) {
  const cloud = ctx.cloud;
  const security = cloud && cloud.openapi && cloud.openapi.security;
  if (!security || typeof security.msgSecCheck !== 'function') {
    return { checked: false };
  }
  let result = null;
  try {
    result = await security.msgSecCheck({ content: text, version: 2 });
  } catch (error) {
    throw errors.dependencyFailed('内容检测暂时不可用，请稍后再试');
  }
  const errCode = result && typeof result.errCode === 'number' ? result.errCode : 0;
  if (errCode !== 0) {
    throw errors.dependencyFailed('内容检测暂时不可用，请稍后再试');
  }
  const suggest = result && result.result ? result.result.suggest : '';
  if (suggest && suggest !== 'pass') {
    throw errors.validation(field || 'text', '留言包含不适合的内容，请修改后重新发送');
  }
  return { checked: true };
}

const SYSTEM_FROM = 'SYSTEM';
const BIND_RELEASED_TEMPLATE = 'BIND_RELEASED';

function messageTitleOf(fromRole) {
  if (fromRole === enums.ROLES.CUSTOMER) {
    return '顾客留言';
  }
  if (fromRole === enums.ROLES.PARTNER) {
    return '兼职留言';
  }
  return '订单留言';
}

function isSystemNotice(message) {
  return message.fromId === SYSTEM_FROM
    || message.templateCode === BIND_RELEASED_TEMPLATE
    || (message.orderId === '' && message.templateCode);
}

function buildMessageItem(scope, orderNo, message) {
  const fromRole = textOf(message.fromRole);
  const system = isSystemNotice(message);
  // "本人留言"按 users.roles 成员制判定（双角色时两侧留言都算本人；单角色与旧 fromRole===role 等价）。
  const roles = Array.isArray(scope.roles) ? scope.roles : [];
  const mine = !system && (fromRole === scope.role || roles.indexOf(fromRole) >= 0);
  return {
    type: system ? 'NOTICE' : 'MESSAGE',
    title: system ? '系统通知' : messageTitleOf(fromRole),
    text: textOf(message.text),
    orderNo: orderNo || textOf(message.orderNo),
    at: toIso(message.createdAt),
    read: system ? !!message.readAt : (mine || !!message.readAt),
    fromRole: system ? SYSTEM_FROM : fromRole,
    templateCode: textOf(message.templateCode)
  };
}

function buildEventItem(scope, orderNo, event, readWatermarkMs) {
  const atMs = time.toMs(event.at);
  const statusText = orderState.statusText(event.toStatus) || textOf(event.toStatus);
  const note = textOf(event.note);
  return {
    type: 'EVENT',
    title: statusText,
    text: note || (orderNo ? orderNo + ' ' + statusText : statusText),
    orderNo,
    at: toIso(event.at),
    read: readWatermarkMs > 0 && atMs > 0 && atMs <= readWatermarkMs,
    fromRole: textOf(event.actorRole)
  };
}

function buildAnnouncementItem(config) {
  const announcement = config && config.announcement;
  let title = '公告';
  let text = '';
  let atMs = 0;
  let enabled = true;
  if (typeof announcement === 'string') {
    text = announcement;
  } else if (announcement && typeof announcement === 'object') {
    // config.announcement{enabled,title,text}：开关关闭时不下发（UX_CUSTOMER 消息中心公告口径）
    enabled = announcement.enabled !== false;
    title = textOf(announcement.title) || title;
    text = textOf(announcement.text);
    atMs = time.toMs(announcement.updatedAt);
  }
  if (!text || !enabled) {
    return null;
  }
  return {
    type: 'ANNOUNCEMENT',
    title,
    text,
    orderNo: '',
    at: atMs ? new Date(atMs).toISOString() : '',
    read: true,
    fromRole: 'SYSTEM'
  };
}

function itemTimeMs(item) {
  const ms = item && item.at ? Date.parse(item.at) : 0;
  return isNaN(ms) ? 0 : ms;
}

function sortItemsDesc(items) {
  return items.slice().sort((left, right) => itemTimeMs(right) - itemTimeMs(left));
}

function parseLimit(payload) {
  const raw = Number(payload && payload.limit);
  if (!Number.isFinite(raw) || raw <= 0) {
    return PAGE_LIMIT;
  }
  return Math.min(Math.floor(raw), MAX_PAGE_LIMIT);
}

function parseCursor(payload) {
  const cursor = payload && payload.cursor;
  if (!cursor || typeof cursor !== 'object') {
    return null;
  }
  const sortValue = Number(cursor.sortValue);
  if (!Number.isFinite(sortValue) || sortValue <= 0) {
    return null;
  }
  return { sortValue, tie: typeof cursor.tie === 'string' ? cursor.tie : '' };
}

function afterCursor(item, cursor) {
  if (!cursor) {
    return true;
  }
  const ms = itemTimeMs(item);
  if (ms !== cursor.sortValue) {
    return ms < cursor.sortValue;
  }
  return String(item.orderNo || '') < String(cursor.tie || '');
}

function makeListCursor(item) {
  const ms = itemTimeMs(item);
  if (!ms) {
    return null;
  }
  return { sortValue: ms, tie: String(item.orderNo || '') };
}

async function loadUser(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.USERS, openid);
}

function passOrThrow(result) {
  if (!result || !result.ok) {
    throw errors.validation((result && result.field) || 'payload', '参数不合法，请核对后重试');
  }
  return result;
}

module.exports = {
  PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_ORDERS_SCAN,
  EVENTS_PER_ORDER,
  MESSAGES_PER_ORDER,
  TEXT_MAX,
  enums,
  validate,
  time,
  errors,
  COLLECTIONS,
  scopeOf,
  assertWritable,
  nowMsOf,
  toIso,
  textOf,
  loadConfig,
  getOrderByNo,
  normalizeOrderNoInput,
  orderSideOf,
  assertParticipant,
  isTestSession,
  assertTestOrderVisible,
  checkContentSecurity,
  buildMessageItem,
  buildEventItem,
  buildAnnouncementItem,
  isSystemNotice,
  SYSTEM_FROM,
  BIND_RELEASED_TEMPLATE,
  sortItemsDesc,
  parseLimit,
  parseCursor,
  afterCursor,
  makeListCursor,
  loadUser,
  passOrThrow
};
