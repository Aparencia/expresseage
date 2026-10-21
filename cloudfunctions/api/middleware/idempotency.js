// middleware/idempotency.js · 写动作幂等键构造 + 重放预查辅助（ARCHITECTURE §4.3 #6）
// 说明：重复写请求的「返回当前对象 + data.duplicated=true」由 handler 在同一事务/唯一索引内完成
//       （orders.requestKey / order_events.requestKey / bindings.activeKey / admin_audit.requestKey），
//       本模块提供唯一键构造与预查函数，禁止 handler 自造第二套键格式。
const { COLLECTIONS } = require('../db/collections');
const errors = require('../lib/errors');

// order.create：{customerId|partnerId}:{clientRequestId}；createBatch 追加 :{itemIndex}
function orderRequestKey(ctx, itemIndex) {
  const base = String(ctx.identity.effectiveOpenid || '') + ':' + String(ctx.clientRequestId || '');
  return itemIndex === undefined || itemIndex === null ? base : base + ':' + itemIndex;
}

// 订单后续动作：{orderId}:{action}:{clientRequestId}
function eventRequestKey(ctx, orderId, action) {
  return [String(orderId || ''), String(action || ''), String(ctx.clientRequestId || '')].join(':');
}

// admin 写动作 / 测试账号管理：{actorOpenid}:{clientRequestId}（审计表 requestKey †）
function auditRequestKey(ctx) {
  return String(ctx.identity.actorOpenid || ctx.openid || '') + ':' + String(ctx.clientRequestId || '');
}

// admin.viewAsStart：同一 clientRequestId 重放返回同一票据
function viewSessionRequestKey(ctx) {
  return String(ctx.identity.actorOpenid || ctx.openid || '') + ':' + String(ctx.clientRequestId || '');
}

// 预查重放对象（handler 用；命中即返回当前对象 + duplicated:true）
async function findReplay(dao, collection, where) {
  if (!where || Object.keys(where).length === 0) {
    return null;
  }
  return dao.findOne(collection, { where });
}

async function middleware(state) {
  const spec = state.meta.spec || {};
  if (spec.visibility !== 'client' || spec.write !== true) {
    return state;
  }
  if (!state.ctx.clientRequestId) {
    throw errors.validation('clientRequestId', '请求标识缺失或格式不正确，请重试');
  }
  state.meta.idempotency = {
    clientRequestId: state.ctx.clientRequestId,
    orderRequestKey: orderRequestKey(state.ctx),
    auditRequestKey: auditRequestKey(state.ctx)
  };
  return state;
}

async function finish(state) {
  return state;
}

module.exports = {
  middleware,
  finish,
  orderRequestKey,
  eventRequestKey,
  auditRequestKey,
  viewSessionRequestKey,
  findReplay,
  COLLECTIONS
};
