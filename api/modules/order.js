// api/modules/order.js · order 域（19 动作；批量由客户端循环 + 同一 batchActionId）
// 幂等：create/createBatch 接受 opts.clientRequestId（页面重试复用同一键，防重复建单；UX §4.8）。
const client = require('../client');

function call(action, payload, opts) {
  return client.call(action, payload || {}, opts || {});
}

module.exports = {
  // 建单幂等：opts.clientRequestId 由页面在进入 Step4 生成，失败重试沿用（内容变更后重生成）
  create(payload, opts) {
    return call('order.create', payload, opts);
  },
  createBatch(payload, opts) {
    return call('order.createBatch', payload, opts);
  },
  get(payload) {
    return client.call('order.get', payload || {}, { retry: true });
  },
  listCustomer(payload) {
    return client.call('order.listCustomer', payload || {}, { retry: true });
  },
  listPartner(payload) {
    return client.call('order.listPartner', payload || {}, { retry: true });
  },
  accept(payload) {
    return call('order.accept', payload);
  },
  reject(payload) {
    return call('order.reject', payload);
  },
  markPicked(payload) {
    return call('order.markPicked', payload);
  },
  unmarkPicked(payload) {
    return call('order.unmarkPicked', payload);
  },
  markDelivered(payload) {
    return call('order.markDelivered', payload);
  },
  unmarkDelivered(payload) {
    return call('order.unmarkDelivered', payload);
  },
  reportException(payload) {
    return call('order.reportException', payload);
  },
  resolveException(payload) {
    return call('order.resolveException', payload);
  },
  cancel(payload) {
    return call('order.cancel', payload);
  },
  confirmDelivery(payload) {
    return call('order.confirmDelivery', payload);
  },
  correct(payload) {
    return call('order.correct', payload);
  },
  undo(payload) {
    return call('order.undo', payload);
  },
  deleteRecord(payload) {
    return call('order.deleteRecord', payload);
  },
  imageUrl(payload) {
    return client.call('order.imageUrl', payload || {}, { retry: true });
  }
};
