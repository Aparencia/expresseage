// handlers/order/_common.js · 订单域共用件（二）：事件构造 / 通用状态动作引擎 / 常用校验包装
// 身份与数据访问在 _store.js；本文件不感知「视角分支」，切换会话由中间件统一解析为业务身份。
'use strict';

const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');
const store = require('./_store');

const {
  enums,
  validate,
  time,
  scopeOf,
  assertWritable,
  nowMsOf,
  toDate,
  normalizeOrderNoInput,
  getOrderByNo,
  getOrderById,
  orderSideOf,
  loadWritablePartner
} = store;

function isAdmin(ctx) {
  return scopeOf(ctx).role === enums.CANCELLED_BY.ADMIN;
}

// 批量动作分组标识（DATA_MODEL §2.5/§4.1：`orders.batchActionId` ≤32 随机、批次内、L2 内部、不返回客户端）。
// 只有 §7.3 标注 `batchActionId?` 的动作（markPicked/markDelivered/correct/undo）接收并落库；
// 缺省/空串 = 本单最近一次动作不属于任何批量 → 写 '' 清空旧批次归属，避免把后续单次操作误归到旧批次。
const BATCH_ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function readBatchActionId(payload) {
  const value = payload && typeof payload === 'object' ? payload.batchActionId : undefined;
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('batchActionId', '批量操作标识格式不正确，请刷新页面后重试');
  }
  const text = value.trim();
  if (text === '') {
    return '';
  }
  if (!BATCH_ACTION_ID_PATTERN.test(text)) {
    throw errors.validation('batchActionId', '批量操作标识格式不正确，请刷新页面后重试');
  }
  return text;
}

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

// spec = { action, guard?, build?, after?, extraResult? }
// guard/build 入参 = { ctx, order, payload, now, nowDate, actorRole, scope, checked }；
// after 在事务内执行（额外写审计等），入参额外含 trx/clientRequestId/fromStatus/toStatus。
// 幂等重放优先于状态机校验：同 clientRequestId 重放返回当前对象 + duplicated（不写事件、不报 INVALID_TRANSITION）。
async function runOrderAction(ctx, payload, spec) {
  assertWritable(ctx);
  const scope = scopeOf(ctx);
  const now = nowMsOf(ctx);
  const nowDate = toDate(now);
  const orderNo = normalizeOrderNoInput(payload && payload.orderNo);
  // 入参形态闸先于任何读库/写库：非法 batchActionId 一律 VALIDATION_FAILED（零落库）。
  const batchActionId = spec.acceptsBatchActionId === true ? readBatchActionId(payload) : null;
  const order = await getOrderByNo(ctx, orderNo);
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  const side = orderSideOf(ctx, order);
  if (!side) {
    throw errors.forbidden('无权操作该订单');
  }
  store.assertTestOrderVisible(ctx, order);
  const rule = orderState.actionRule(spec.action);
  if (!rule) {
    throw errors.internalError('订单动作未登记');
  }
  // actorRole 取订单侧别（由归属判定，双角色不依赖 identity.role）；ADMIN 分支保持只读介入语义。
  const actorRole = side === 'ADMIN' ? enums.CANCELLED_BY.ADMIN : side;
  if (rule.roles.indexOf(actorRole) < 0) {
    throw errors.forbidden('当前身份不能执行该操作');
  }
  // CONTRACT §1.1 第 4 条：开发者唯一的订单写动作 = 异常介入取消；不代确认送达/不代操作其它状态动作。
  // （shared/order-state 的 resolveException 角色表含 ADMIN，本闸把后台权限收敛到 cancel 一个动作。）
  if (actorRole === enums.CANCELLED_BY.ADMIN && spec.action !== 'order.cancel') {
    throw errors.forbidden('后台仅可介入取消异常订单');
  }
  if (actorRole === enums.ROLES.PARTNER) {
    await loadWritablePartner(ctx);
  }
  const clientRequestId = ctx.clientRequestId || '';
  if (!clientRequestId) {
    throw errors.validation('clientRequestId', '缺少请求标识，请重试');
  }
  const eventKey = [String(order._id), spec.action, clientRequestId].join(':');
  const existingEvent = await ctx.dao.findOne(store.COLLECTIONS.ORDER_EVENTS, {
    where: { requestKey: eventKey }
  });
  if (existingEvent) {
    return { order: await buildCurrentOrderView(ctx, order), duplicated: true };
  }
  const expectedVersion = typeof ctx.expectedVersion === 'number' ? ctx.expectedVersion : null;
  if (expectedVersion !== null && expectedVersion !== order.version) {
    throw errors.conflict('订单已被更新，请刷新后重试');
  }
  if (!orderState.canAct(spec.action, order.status, actorRole, order)) {
    throw errors.invalidTransition('当前订单状态不允许该操作');
  }
  const checked = typeof spec.guard === 'function'
    ? await spec.guard({ ctx, order, payload, now, actorRole, scope, batchActionId })
    : {};
  const built = typeof spec.build === 'function'
    ? spec.build({ ctx, order, payload, now, nowDate, actorRole, scope, checked, batchActionId })
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
        status: toStatus || fromStatus,
        version: order.version + 1,
        statusUpdatedAt: nowDate,
        updatedAt: nowDate
      });
      if (batchActionId !== null) {
        patch.batchActionId = batchActionId;
      }
      await trx.update(store.COLLECTIONS.ORDERS, order._id, patch);
      await trx.add(store.COLLECTIONS.ORDER_EVENTS, eventDoc);
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
          toStatus,
          ctx
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

function isSameTestSide(left, right) {
  return (left === true) === (right === true);
}

module.exports = Object.assign({}, store, {
  enums,
  orderState,
  time,
  errors,
  isAdmin,
  buildEventDocument,
  runOrderAction,
  buildCurrentOrderView,
  passOrThrow,
  assertNotTerminal,
  isSameTestSide,
  readBatchActionId
});
