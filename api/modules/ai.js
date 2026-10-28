// api/modules/ai.js · ai 域（仅识别失败兜底；默认不自动重试；切换会话不调用）
// opts 仅透传显式 clientRequestId（同图重试复用同一幂等键），其余选项不得覆盖 retry:false。
const client = require('../client');

module.exports = {
  parseParcel(payload, opts) {
    return client.call('ai.parseParcel', payload || {}, Object.assign({ retry: false }, opts || {}));
  }
};
