// api/modules/customer.js · customer 域
const client = require('../client');

module.exports = {
  saveProfile(profile) {
    return client.call('customer.saveProfile', profile || {});
  },
  getProfile() {
    return client.call('customer.getProfile', {}, { retry: true });
  }
};
