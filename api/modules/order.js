// api/modules/order.js · order 域（19 动作；批量由客户端循环 + 同一 batchActionId）
const client = require('../client');

function call(action, payload) {
  return client.call(action, payload || {});
}

module.exports = {
  create(payload) {
    return call('order.create', payload);
  },
  createBatch(payload) {
    return call('order.createBatch', payload);
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
