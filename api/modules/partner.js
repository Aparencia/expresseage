// api/modules/partner.js · partner 域
const client = require('../client');

module.exports = {
  activate(payload) {
    return client.call('partner.activate', payload || {});
  },
  saveProfile(profile) {
    return client.call('partner.saveProfile', profile || {});
  },
  saveServiceConfig(serviceConfig) {
    return client.call('partner.saveServiceConfig', { serviceConfig: serviceConfig || {} });
  },
  getPublic(payload) {
    return client.call('partner.getPublic', { partnerNo: (payload && payload.partnerNo) || '' });
  },
  listBindings(payload) {
    return client.call('partner.listBindings', payload || {}, { retry: true });
  },
  // 顾客详情（档案 + 该顾客订单分页 + 解绑资格）：参数一律 bindingId，不带顾客 openid
  getCustomer(payload) {
    return client.call('partner.getCustomer', payload || {}, { retry: true });
  },
  // 单量统计（今日/本周/本月；无任何费用口径；服务端聚合、排除测试数据）
  stats(payload) {
    return client.call('partner.stats', payload || {}, { retry: true });
  },
  unbindCustomer(payload) {
    return client.call('partner.unbindCustomer', payload || {});
  },
  saveCustomerNote(payload) {
    return client.call('partner.saveCustomerNote', payload || {});
  }
};
