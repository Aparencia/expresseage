// api/modules/bind.js · bind 域（绑定只能由顾客发起）
const client = require('../client');

module.exports = {
  create(payload) {
    return client.call('bind.create', { partnerNo: (payload && payload.partnerNo) || '' });
  },
  release(payload) {
    return client.call('bind.release', payload || {});
  },
  getCurrent() {
    return client.call('bind.getCurrent', {}, { retry: true });
  }
};
