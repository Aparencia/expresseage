// api/modules/user.js · user 域（动作名只在 api/ 出现）
const client = require('../client');

module.exports = {
  bootstrap() {
    return client.call('user.bootstrap', {}, { retry: true });
  },
  acceptPrivacy(version) {
    return client.call('user.acceptPrivacy', { version: version || '' });
  },
  deleteAccount(payload) {
    const body = typeof payload === 'string'
      ? { confirmText: payload }
      : (payload || {});
    return client.call('user.deleteAccount', body);
  }
};
