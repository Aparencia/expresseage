// api/modules/user.js · user 域（动作名只在 api/ 出现）
const client = require('../client');

module.exports = {
  bootstrap() {
    return client.call('user.bootstrap', {}, { retry: true });
  },
  // D42：本人头像 5 分钟临时 URL（无头像返回空；读动作，失败由页面回退默认头像）
  avatarUrl() {
    return client.call('user.avatarUrl', {}, { retry: true });
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
