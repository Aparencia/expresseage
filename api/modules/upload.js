// api/modules/upload.js · upload 域（上传动作由 api/upload.js 编排）
const client = require('../client');

module.exports = {
  prepare(payload) {
    return client.call('upload.prepare', payload || {});
  },
  cancel(payload) {
    return client.call('upload.cancel', payload || {});
  }
};
