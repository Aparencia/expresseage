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
  store.assertTestOrderVisible(ctx, order);
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
  const eventKey = [String(order._id), spec.action, clientRequestId].join(':');
  const existingEvent = await ctx.dao.findOne(store.COLLECTIONS.ORDER_EVENTS, {
    where: { requestKey: eventKey }
  });
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
        status: toStatus || fromStatus,
        version: order.version + 1,
        statusUpdatedAt: nowDate,
        updatedAt: nowDate
      });
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
  isSameTestSide
});
