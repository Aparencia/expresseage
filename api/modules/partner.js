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
  },
  // D59 子队员（批 26 服务端/共享冻结；页面在批 27 接入）：发码/作废/列表为可重试幂等形制，移除为写形制
  createSubInvites(payload) {
    return client.call('partner.createSubInvites', payload || {}, { retry: true });
  },
  revokeSubInvite(payload) {
    return client.call('partner.revokeSubInvite', payload || {}, { retry: true });
  },
  listSubMembers(payload) {
    return client.call('partner.listSubMembers', payload || {}, { retry: true });
  },
  removeSubMember(payload) {
    return client.call('partner.removeSubMember', payload || {});
  },
  // D87-a 转派候选检索（只读、无游标、结果上限由服务端定；读动作可重试）
  searchTransferTargets(payload) {
    return client.call('partner.searchTransferTargets', payload || {}, { retry: true });
  },
  // D88 转派码：本人签发/轮换（写，不自动重试）；凭码解析（读，可重试）
  createTransferCode() {
    return client.call('partner.createTransferCode', {});
  },
  resolveTransferCode(payload) {
    return client.call('partner.resolveTransferCode', {
      code: (payload && payload.code) || ''
    }, { retry: true });
  },
  // D90 最近使用的转派目标（只回本人转派成功过的对象，≤5；读动作可重试）
  recentTransferTargets() {
    return client.call('partner.recentTransferTargets', {}, { retry: true });
  }
};
