// api/modules/admin.js · admin 域（23 动作；仅开发者后台页面调用）
const client = require('../client');

function call(action, payload) {
  return client.call(action, payload || {});
}

function read(action, payload) {
  return client.call(action, payload || {}, { retry: true });
}

module.exports = {
  createInvites(payload) {
    return call('admin.createInvites', payload);
  },
  revokeInvite(payload) {
    return call('admin.revokeInvite', payload);
  },
  listInvites(payload) {
    return read('admin.listInvites', payload);
  },
  listCustomers(payload) {
    return read('admin.listCustomers', payload);
  },
  getCustomer(payload) {
    return read('admin.getCustomer', payload);
  },
  listPartners(payload) {
    return read('admin.listPartners', payload);
  },
  setPartnerStatus(payload) {
    return call('admin.setPartnerStatus', payload);
  },
  listOrders(payload) {
    return read('admin.listOrders', payload);
  },
  getOrder(payload) {
    return read('admin.getOrder', payload);
  },
  listAudit(payload) {
    return read('admin.listAudit', payload);
  },
  updateConfig(payload) {
    return call('admin.updateConfig', payload);
  },
  stats(payload) {
    return read('admin.stats', payload);
  },
  bootstrap() {
    return call('admin.bootstrap', {});
  },
  viewAsStart(payload) {
    return call('admin.viewAsStart', payload);
  },
  viewAsEnd(payload) {
    return call('admin.viewAsEnd', payload);
  },
  createTestAccount(payload) {
    return call('admin.createTestAccount', payload);
  },
  listTestAccounts(payload) {
    return read('admin.listTestAccounts', payload);
  },
  deleteTestAccount(payload) {
    return call('admin.deleteTestAccount', payload);
  },
  purgeTestData(payload) {
    return call('admin.purgeTestData', payload);
  },
  listRecognitionFailures(payload) {
    return read('admin.listRecognitionFailures', payload);
  },
  getRecognitionFailure(payload) {
    return read('admin.getRecognitionFailure', payload);
  },
  fixRecognitionFailure(payload) {
    return call('admin.fixRecognitionFailure', payload);
  },
  ignoreRecognitionFailure(payload) {
    return call('admin.ignoreRecognitionFailure', payload);
  }
};
