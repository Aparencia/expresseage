// handlers/order/_common.js · 订单域共用件：身份作用域 / 时间 / 配置 / 载入 / 归属校验 /
// 上传票据 / 事件写入 / 通用状态动作引擎。不感知「视角分支」——只认中间件解析后的 ctx.identity。
'use strict';

const { COLLECTIONS, CONFIG_DOC_ID } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
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

// 业务身份键：真实会话=本人 openid；切换会话=中间件解析出的目标身份（中间件保证两种模式都解析为目标）。
function scopeOf(ctx) {
  const identity = identityOf(ctx);
  const testWrite = identity.viewMode === enums.VIEW_MODE.TEST_WRITE;
  return {
    role: identity.role || '',
    openid: identity.effectiveOpenid || (ctx && ctx.openid) || '',
    actorOpenid: identity.actorOpenid || (ctx && ctx.openid) || '',
    developerNo: identity.developerNo || '',
    impersonatedBy: testWrite ? identity.developerNo || '' : '',
    viewMode: identity.viewMode || '',
    targetId: identity.targetId || '',
    readOnly: identity.viewMode === enums.VIEW_MODE.READONLY,
    testWrite
  };
}

function assertWritable(ctx) {
  if (scopeOf(ctx).readOnly) {
    throw errors.forbidden('开发者只读视角不能操作');
  }
}

// 顾客业务身份键（query scope）：order.customerId / bindings.customerId / customers._id
function customerScope(ctx) {
  const scope = scopeOf(ctx);
  if (scope.role !== enums.ROLES.CUSTOMER) {
    throw errors.forbidden('仅顾客身份可执行该操作');
  }
  return scope.openid;
}

// 兼职业务身份键（query scope）：partners.openid；找不到时回退 targetId（切换会话兜底）
async function loadScopePartner(ctx) {
  const scope = scopeOf(ctx);
  if (scope.role !== enums.ROLES.PARTNER) {
    throw errors.forbidden('仅兼职身份可执行该操作');
  }
  let partner = await getPartnerByOpenid(ctx, scope.openid);
  if (!partner && scope.targetId) {
    partner = await getPartnerById(ctx, scope.targetId);
  }
  return partner;
}

// 兼职写动作前提：ACTIVE（SUSPENDED/CLOSED 同码 PARTNER_CLOSED，message 区分）
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

function isAdmin(ctx) {
  return scopeOf(ctx).role === enums.CANCELLED_BY.ADMIN;
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
  return ctx.dao.get(COLLECTIONS.users, openid);
}

async function getCustomerByOpenid(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.customers, openid);
}

async function getPartnerByOpenid(ctx, openid) {
  if (!openid) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.partners, { where: { openid } });
}

async function getPartnerById(ctx, partnerId) {
  if (partnerId === undefined || partnerId === null || partnerId === '') {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.partners, partnerId);
}

async function getActiveBinding(ctx, customerId) {
  if (!customerId) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.bindings, {
    where: { customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

async function getOrderByNo(ctx, orderNo) {
  if (!orderNo) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.orders, { where: { orderNo } });
}

async function getOrderById(ctx, orderId) {
  if (!orderId) {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.orders, orderId);
}

function normalizeOrderNoInput(value) {
  const orderNo = readTrimmedText(value, 32).toUpperCase();
  if (!orderNo || !enums.ORDER_NO_PATTERN.test(orderNo)) {
    throw errors.validation('orderNo', '订单号格式不正确，请核对后重试');
  }
  return orderNo;
}

// 订单可见归属：顾客=本人单（guest 单 customerId 为空，顾客不可见）；兼职=自己的单；admin=白名单后台
function orderSideOf(ctx, order) {
  if (!order) {
    return '';
  }
  const scope = scopeOf(ctx);
  if (scope.role === enums.CANCELLED_BY.ADMIN) {
    return 'ADMIN';
  }
  if (scope.role === enums.ROLES.PARTNER && order.partnerOpenid && order.partnerOpenid === scope.openid) {
    return 'PARTNER';
  }
  if (scope.role === enums.ROLES.CUSTOMER && order.customerId && order.customerId === scope.openid) {
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
  const ticket = await ctx.dao.findOne(COLLECTIONS.upload_tickets, { where: { ticket: ticketId } });
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

// ── 事件 ─────────────────────────────────────────────────────────────────────
function buildEventDocument(options) {
  const opts = options || {};
  return {
    orderId: opts.orderId,
    orderNo: opts.orderNo,
    type: opts.type,
    fromStatus: opts.fromStatus || '',
    toStatus: opts.toStatus || '',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    impersonatedBy: opts.impersonatedBy || '',
    at: opts.at,
    note: opts.note || '',
    payload: opts.payload || {},
    requestKey: opts.requestKey
  };
}

// ── 通用状态动作引擎 ─────────────────────────────────────────────────────────
// spec = { action, guard?, build?, after?, onReplay? }
async function runOrderAction(ctx, payload, spec) {
  assertWritable(ctx);
  const scope = scopeOf(ctx);
  const now = nowMsOf(ctx);
  const nowDate = toDate(now);
  const orderNo = normalizeOrderNoInput(payload && payload.orderNo);
  const order = await getOrderByNo(ctx, orderNo);
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  const side = orderSideOf(ctx, order);
  if (!side) {
    throw errors.forbidden('无权操作该订单');
  }
  const rule = orderState.actionRule(spec.action);
  if (!rule) {
    throw errors.internalError('订单动作未登记');
  }
  const actorRole = side === 'ADMIN' ? enums.CANCELLED_BY.ADMIN : scope.role;
  if (rule.roles.indexOf(actorRole) < 0) {
    throw errors.forbidden('当前身份不能执行该操作');
  }
  if (actorRole === enums.ROLES.PARTNER) {
    await loadWritablePartner(ctx);
  }
  const expectedVersion = typeof ctx.expectedVersion === 'number' ? ctx.expectedVersion : null;
  if (expectedVersion !== null && expectedVersion !== order.version) {
    throw errors.conflict('订单已被更新，请刷新后重试');
  }
  if (!orderState.canAct(spec.action, order.status, actorRole, order)) {
    throw errors.invalidTransition('当前订单状态不允许该操作');
  }
  const clientRequestId = ctx.clientRequestId || '';
  if (!clientRequestId) {
    throw errors.validation('clientRequestId', '缺少请求标识，请重试');
  }
  const eventKey = order._id + ':' + spec.action + ':' + clientRequestId;
  const existingEvent = await ctx.dao.findOne(COLLECTIONS.order_events, { where: { requestKey: eventKey } });
  if (existingEvent) {
    return { order: await buildCurrentOrderView(ctx, order), duplicated: true };
  }
  const checked = typeof spec.guard === 'function'
    ? await spec.guard({ ctx, order, payload, now, actorRole, scope })
    : {};
  const built = typeof spec.build === 'function'
    ? spec.build({ ctx, order, payload, now, nowDate, actorRole, scope, checked })
    : {};
  const fromStatus = order.status;
  const toStatus = built.toStatus !== undefined
    ? built.toStatus
    : orderState.nextStatus(spec.action, fromStatus, order);
  const eventDoc = buildEventDocument({
    orderId: order._id,
    orderNo: order.orderNo,
    type: built.eventType || rule.event,
    fromStatus,
    toStatus,
    actorRole,
    actorId: scope.openid,
    impersonatedBy: scope.impersonatedBy,
    at: nowDate,
    note: built.note || '',
    payload: built.payload || {},
    requestKey: eventKey
  });
  try {
    await ctx.dao.transaction(async (trx) => {
      const patch = Object.assign({}, built.set || {}, {
        version: order.version + 1,
        statusUpdatedAt: nowDate,
        updatedAt: nowDate
      });
      await trx.update(COLLECTIONS.orders, order._id, patch);
      await trx.add(COLLECTIONS.order_events, eventDoc);
      if (typeof spec.after === 'function') {
        await spec.after({
          trx,
          order,
          now,
          nowDate,
          actorRole,
          scope,
          built,
          clientRequestId,
          fromStatus,
          toStatus
        });
      }
    });
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      return { order: await buildCurrentOrderView(ctx, order), duplicated: true };
    }
    throw error;
  }
  const fresh = await getOrderById(ctx, order._id);
  const result = { order: await buildCurrentOrderView(ctx, fresh || order) };
  if (typeof spec.extraResult === 'function') {
    Object.assign(result, spec.extraResult({ built, actorRole }) || {});
  }
  return result;
}

// 由 _dto 提供（延迟 require，避免环形依赖）
async function buildCurrentOrderView(ctx, order) {
  const dto = require('./_dto');
  return dto.buildOrderDto(ctx, order);
}

// ── 常用校验包装 ─────────────────────────────────────────────────────────────
function passOrThrow(result) {
  if (!result || !result.ok) {
    throw errors.validation((result && result.field) || 'payload', '参数不合法，请核对后重试');
  }
  return result;
}

function assertNotTerminal(order) {
  if (orderState.isTerminal(order.status)) {
    throw errors.invalidTransition('订单已完成或已取消，不能继续操作');
  }
}

function isSameTestSide(a, b) {
  return (a === true) === (b === true);
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_LIST_SCAN,
  EVENT_LIST_LIMIT,
  MS_PER_DAY,
  CONFIG_DOC_ID,
  enums,
  orderState,
  validate,
  time,
  errors,
  identityOf,
  scopeOf,
  assertWritable,
  customerScope,
  loadScopePartner,
  loadWritablePartner,
  isAdmin,
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
  getOrderByNo,
  getOrderById,
  normalizeOrderNoInput,
  orderSideOf,
  assertOrderVisible,
  loadUploadTicket,
  assertImageFile,
  buildImageSnapshot,
  buildEventDocument,
  runOrderAction,
  passOrThrow,
  assertNotTerminal,
  isSameTestSide
};
