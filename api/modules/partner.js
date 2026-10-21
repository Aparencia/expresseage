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
  listBindings() {
    return client.call('partner.listBindings', {}, { retry: true });
  },
  unbindCustomer(payload) {
    return client.call('partner.unbindCustomer', payload || {});
  },
  saveCustomerNote(payload) {
    return client.call('partner.saveCustomerNote', payload || {});
  }
};
