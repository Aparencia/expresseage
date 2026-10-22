// handlers/order/_store.js · 订单域共用件（一）：身份作用域 / 时间 / 配置 / 分页 / 载入 / 上传票据
// 不感知「视角分支」——只认中间件解析后的 ctx.identity（effectiveOpenid 即业务身份键）。
'use strict';

const { COLLECTIONS, CONFIG_DOC_ID } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { readConfig } = require('../../db/config');
const { errors } = require('../../lib/errors');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_LIST_SCAN = 500;
const EVENT_LIST_LIMIT = 100;
const IMAGE_MAX_BYTES = 500 * 1024;
const MS_PER_DAY = time.DAY_MS;

// ── 身份作用域 ────────────────────────────────────────────────────────────────
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
  const testWrite = identity.viewMode === enums.VIEW_MODE.TEST_WRITE;
  return {
    role: identity.role || '',
    roles: rolesOfIdentity(identity),
    openid: identity.effectiveOpenid || (ctx && ctx.openid) || '',
    actorOpenid: identity.actorOpenid || (ctx && ctx.openid) || '',
    developerNo: identity.developerNo || '',
    impersonatedBy: testWrite ? identity.developerNo || '' : '',
    viewMode: identity.viewMode || '',
    readOnly: identity.viewMode === enums.VIEW_MODE.READONLY,
    testWrite
  };
}

// 测试数据隔离：真实会话（含 READONLY）只看 isTest=false；TEST_WRITE 会话只看 isTest=true
function isTestSession(ctx) {
  return identityOf(ctx).viewMode === enums.VIEW_MODE.TEST_WRITE;
}

function assertTestOrderVisible(ctx, order) {
  const expectTest = isTestSession(ctx);
  if ((order.isTest === true) !== expectTest) {
    throw errors.notFound('订单不存在或不可查看');
  }
}

function assertWritable(ctx) {
  if (scopeOf(ctx).readOnly) {
    throw errors.forbidden('开发者只读视角不能操作');
  }
}

function customerScope(ctx) {
  const scope = scopeOf(ctx);
  if (scope.roles.indexOf(enums.ROLES.CUSTOMER) < 0) {
    throw errors.forbidden('仅顾客身份可执行该操作');
  }
  return scope.openid;
}

async function loadScopePartner(ctx) {
  const scope = scopeOf(ctx);
  if (scope.roles.indexOf(enums.ROLES.PARTNER) < 0) {
    throw errors.forbidden('仅兼职身份可执行该操作');
  }
  let partner = await getPartnerByOpenid(ctx, scope.openid);
  if (!partner && scope.targetId) {
    partner = await getPartnerById(ctx, scope.targetId);
  }
  return partner;
}

async function loadWritablePartner(ctx) {
  const partner = await loadScopePartner(ctx);
  if (!partner) {
    throw errors.forbidden('未激活兼职身份');
  }
  if (partner.deletedAt || partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.partnerClosed('兼职已注销，无法操作');
  }
  if (partner.status === enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.partnerClosed('兼职已停用，无法操作');
  }
  return partner;
}

// ── 时间 / 配置 / 分页 ────────────────────────────────────────────────────────
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

function toDate(ms) {
  return new Date(time.toMs(ms));
}

async function loadConfig(ctx) {
  if (ctx && ctx.config && typeof ctx.config === 'object' && Object.keys(ctx.config).length > 0) {
    return ctx.config;
  }
  const result = await readConfig(ctx.dao);
  return result.config;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.trim();
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return '';
}

// 游标：{ sortValue: epochMs, orderNo }；客户端原样回传
function parsePaging(payload) {
  const input = isPlainObject(payload) ? payload : {};
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  let cursor = null;
  if (isPlainObject(input.cursor)) {
    const sortValue = Number(input.cursor.sortValue);
    const orderNo = typeof input.cursor.orderNo === 'string' ? input.cursor.orderNo : '';
    if (Number.isFinite(sortValue) && sortValue > 0) {
      cursor = { sortValue, orderNo };
    }
  }
  return { limit, cursor };
}

function makeCursor(order, sortField) {
  if (!order) {
    return null;
  }
  const sortValue = time.toMs(order[sortField]);
  if (!sortValue) {
    return null;
  }
  return { sortValue, orderNo: order.orderNo || '' };
}

function isAfterCursor(sortValue, orderNo, cursor) {
  if (!cursor) {
    return true;
  }
  if (sortValue !== cursor.sortValue) {
    return sortValue < cursor.sortValue;
  }
  return String(orderNo || '') < String(cursor.orderNo || '');
}

// ── 载入 ─────────────────────────────────────────────────────────────────────
async function getUser(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.USERS, openid);
}

async function getCustomerByOpenid(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.CUSTOMERS, openid);
}

async function getPartnerByOpenid(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid } });
}

async function getPartnerById(ctx, partnerId) {
  if (partnerId === undefined || partnerId === null || partnerId === '') {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.PARTNERS, partnerId);
}

async function getActiveBinding(ctx, customerId) {
  if (!customerId) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

async function getBindingById(ctx, bindingId) {
  if (!bindingId) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.BINDINGS, bindingId);
}

// 已绑定顾客代客下单（DATA_MODEL §4.8 块 A）：绑定必须属于当前兼职且 ACTIVE；顾客资料必须存在且未注销。
// 归属不符 → FORBIDDEN（不暴露绑定是否存在）；非 ACTIVE/顾客已注销 → INVALID_STATE。
async function loadBoundCustomer(ctx, partner, bindingId) {
  const binding = await getBindingById(ctx, bindingId);
  if (!binding || String(binding.partnerId) !== String(partner && partner._id)) {
    throw errors.forbidden('绑定顾客不存在或不属于当前兼职');
  }
  if (binding.status !== enums.BINDING_STATUS.ACTIVE) {
    throw errors.invalidState('该顾客的绑定已解除，请刷新客户列表后重试');
  }
  const customer = await getCustomerByOpenid(ctx, binding.customerId);
  if (!customer || customer.deletedAt || customer.anonymizedAt) {
    throw errors.invalidState('顾客资料已不可用，无法代客下单');
  }
  const customerUser = await getUser(ctx, binding.customerId);
  return { binding, customer, customerIsTest: !!(customerUser && customerUser.isTestAccount) };
}

async function getOrderByNo(ctx, orderNo) {
  if (!orderNo) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.ORDERS, { where: { orderNo } });
}

async function getOrderById(ctx, orderId) {
  if (!orderId) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.ORDERS, orderId);
}

function normalizeOrderNoInput(value) {
  const orderNo = readTrimmedText(value, 32).toUpperCase();
  if (!orderNo || !enums.ORDER_NO_PATTERN.test(orderNo)) {
    throw errors.validation('orderNo', '订单号格式不正确，请核对后重试');
  }
  return orderNo;
}

// 订单侧别按「订单归属 + users.roles 是否含该侧角色」判定（双角色两类订单都允许；不依赖 activeRole）。
// 单角色语义与旧实现等价：角色不含某侧时该侧不参与匹配。
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

function assertOrderVisible(ctx, order) {
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  const side = orderSideOf(ctx, order);
  if (!side) {
    throw errors.forbidden('无权查看该订单');
  }
  return side;
}

// ── 上传票据 / 图片 ──────────────────────────────────────────────────────────
async function loadUploadTicket(ctx, ticketId, nowMs) {
  const ticket = await ctx.dao.findOne(COLLECTIONS.UPLOAD_TICKETS, { where: { ticket: ticketId } });
  if (!ticket || ticket.openid !== scopeOf(ctx).openid) {
    throw errors.notFound('上传凭证不存在或已失效');
  }
  if (ticket.usedAt || time.toMs(ticket.expiresAt) <= nowMs) {
    throw errors.invalidState('上传凭证已失效，请重新上传');
  }
  if (ticket.purpose !== enums.UPLOAD_PURPOSE.TICKET) {
    throw errors.validation('ticket', '上传凭证用途不符，请重新上传截图');
  }
  return ticket;
}

function assertImageFile(image, ticket) {
  const fileId = typeof image.fileId === 'string' ? image.fileId : '';
  if (!fileId || fileId.indexOf('cloud://') !== 0) {
    throw errors.validation('image', '截图未上传成功，请重新上传');
  }
  const cloudPath = typeof ticket.cloudPath === 'string' ? ticket.cloudPath : '';
  if (!cloudPath || fileId.indexOf(cloudPath) < 0) {
    throw errors.validation('image', '截图与上传凭证不匹配，请重新上传');
  }
  if (image.size !== undefined) {
    const size = Number(image.size);
    if (!Number.isFinite(size) || size <= 0 || size > IMAGE_MAX_BYTES) {
      throw errors.validation('image', '截图大小超出限制，请压缩后重新上传');
    }
  }
  if (image.contentType !== undefined) {
    if (enums.IMAGE_MIME_TYPES.indexOf(image.contentType) < 0) {
      throw errors.validation('image', '截图格式只支持 jpg 或 png');
    }
  }
}

function buildImageSnapshot(image, ticket, nowDate) {
  const snapshot = {
    fileId: image.fileId,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : 0,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : 0,
    uploadedAt: nowDate
  };
  if (ticket && ticket.cloudPath) {
    snapshot.cloudPath = ticket.cloudPath;
  }
  return snapshot;
}

// ── v1.0 订单聚合字段读取（只读归一，不写库）──────────────────────────────────
// parcels[]：新订单一单多包裹；历史单只有单包裹 parcel{} → 归一为单元素数组供统一读取。
function orderParcelsOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length > 0) {
    return list;
  }
  if (order && order.parcel && typeof order.parcel === 'object') {
    return [order.parcel];
  }
  return [];
}

// images[]：新订单 images[]（每张 {fileId,width,height,cleanedAt?}）；历史单 image{} → 归一为单元素数组。
function orderImagesOf(order) {
  const list = order && Array.isArray(order.images) ? order.images : [];
  if (list.length > 0) {
    return list;
  }
  if (order && order.image && typeof order.image === 'object') {
    return [order.image];
  }
  return [];
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_LIST_SCAN,
  EVENT_LIST_LIMIT,
  MS_PER_DAY,
  CONFIG_DOC_ID,
  COLLECTIONS,
  enums,
  validate,
  time,
  identityOf,
  rolesOfIdentity,
  scopeOf,
  isTestSession,
  assertTestOrderVisible,
  assertWritable,
  customerScope,
  loadScopePartner,
  loadWritablePartner,
  nowMsOf,
  toDate,
  loadConfig,
  isPlainObject,
  readTrimmedText,
  parsePaging,
  makeCursor,
  isAfterCursor,
  getUser,
  getCustomerByOpenid,
  getPartnerByOpenid,
  getPartnerById,
  getActiveBinding,
  getBindingById,
  loadBoundCustomer,
  getOrderByNo,
  getOrderById,
  normalizeOrderNoInput,
  orderSideOf,
  assertOrderVisible,
  loadUploadTicket,
  assertImageFile,
  buildImageSnapshot,
  orderParcelsOf,
  orderImagesOf
};
