// handlers/order/create.js · order.create（v1.0 单入口：顾客本人单 / 兼职代客单；一单多包裹 1~10 件）
// 幂等：orders.requestKey={customerId|partnerId}:{clientRequestId}；合并窗口追加用 order_events.requestKey 兜底。
'use strict';

const createEngine = require('./_create');

module.exports = async function orderCreate(ctx, payload) {
  return createEngine.createOne(ctx, payload);
};
