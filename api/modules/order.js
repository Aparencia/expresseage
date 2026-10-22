// api/modules/order.js · order 域（18 动作；批量由客户端循环 + 同一 batchActionId）
// v1.0：下单单入口 order.create（一单多包裹/多图/无截图手填/合并窗口）；order.createBatch 已移除。
// 幂等：写动作 opts.clientRequestId 透传（页面重试复用同一键，防重复写；UX §4.8）；
// 乐观锁：写动作 opts.expectedVersion 透传 DTO.version（服务端 CONFLICT → 人话"请刷新后重试"）。
const client = require('../client');

function call(action, payload, opts) {
  return client.call(action, payload || {}, opts || {});
}

module.exports = {
  // 建单幂等：opts.clientRequestId 由页面在进入 Step4 生成，失败重试沿用（内容变更后重生成）
  create(payload, opts) {
    return call('order.create', payload, opts);
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
  accept(payload, opts) {
    return call('order.accept', payload, opts);
  },
  reject(payload, opts) {
    return call('order.reject', payload, opts);
  },
  markPicked(payload, opts) {
    return call('order.markPicked', payload, opts);
  },
  unmarkPicked(payload, opts) {
    return call('order.unmarkPicked', payload, opts);
  },
  markDelivered(payload, opts) {
    return call('order.markDelivered', payload, opts);
  },
  unmarkDelivered(payload, opts) {
    return call('order.unmarkDelivered', payload, opts);
  },
  reportException(payload, opts) {
    return call('order.reportException', payload, opts);
  },
  resolveException(payload, opts) {
    return call('order.resolveException', payload, opts);
  },
  // 取消/确认送达/删除记录：页面传 opts.expectedVersion=当前 DTO.version（状态竞态双保险）
  cancel(payload, opts) {
    return call('order.cancel', payload, opts);
  },
  confirmDelivery(payload, opts) {
    return call('order.confirmDelivery', payload, opts);
  },
  correct(payload, opts) {
    return call('order.correct', payload, opts);
  },
  undo(payload, opts) {
    return call('order.undo', payload, opts);
  },
  deleteRecord(payload, opts) {
    return call('order.deleteRecord', payload, opts);
  },
  imageUrl(payload) {
    return client.call('order.imageUrl', payload || {}, { retry: true });
  }
};
