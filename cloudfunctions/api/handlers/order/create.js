// handlers/order/create.js · order.create（顾客本人单 / 兼职代客单）
// 幂等：orders.requestKey={customerId|partnerId}:{clientRequestId}；重复请求返回当前订单 + duplicated。
'use strict';

const createEngine = require('./_create');

module.exports = async function orderCreate(ctx, payload) {
  return createEngine.createOne(ctx, payload);
};
