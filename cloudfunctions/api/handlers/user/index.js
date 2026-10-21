// handlers/user/index.js · user 域动作汇总（键 = shared/actions.js 的 client 动作名）
'use strict';

const bootstrap = require('./bootstrap');
const acceptPrivacy = require('./acceptPrivacy');
const deleteAccount = require('./deleteAccount');

module.exports = {
  actions: {
    'user.bootstrap': bootstrap.handler,
    'user.acceptPrivacy': acceptPrivacy.handler,
    'user.deleteAccount': deleteAccount.handler
  }
};
