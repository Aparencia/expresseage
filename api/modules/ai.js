// api/modules/ai.js · ai 域（仅识别失败兜底；不自动重试；切换会话不调用）
const client = require('../client');

module.exports = {
  parseParcel(payload) {
    return client.call('ai.parseParcel', payload || {}, { retry: false });
  }
};
