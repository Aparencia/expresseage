// handlers/customer/index.js · customer 域动作汇总（键 = shared/actions.js 的 client 动作名）
'use strict';

const saveProfile = require('./saveProfile');
const getProfile = require('./getProfile');

module.exports = {
  actions: {
    'customer.saveProfile': saveProfile.handler,
    'customer.getProfile': getProfile.handler
  }
};
