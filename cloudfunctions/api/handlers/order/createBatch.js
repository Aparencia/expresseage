// handlers/order/createBatch.js · order.createBatch（一图多码拆单 ≤5，单事务原子创建）
// 幂等：每条 requestKey={customerId|partnerId}:{clientRequestId}:{itemIndex}；任一非法整批不建。
'use strict';

const createEngine = require('./_create');

module.exports = async function orderCreateBatch(ctx, payload) {
  return createEngine.createBatch(ctx, payload);
};
