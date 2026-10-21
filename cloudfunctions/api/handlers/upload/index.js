// handlers/upload/index.js · upload 域动作汇总（键 = shared/actions.js 的 client 动作名）
'use strict';

const prepare = require('./prepare');
const cancel = require('./cancel');

module.exports = {
  actions: {
    'upload.prepare': prepare.handler,
    'upload.cancel': cancel.handler
  }
};
