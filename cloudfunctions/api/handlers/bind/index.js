// handlers/bind/index.js · bind 域动作汇总（键 = shared/actions.js 的 client 动作名）
'use strict';

const create = require('./create');
const release = require('./release');
const getCurrent = require('./getCurrent');
const claimGuestOrder = require('./claimGuestOrder');

module.exports = {
  actions: {
    'bind.create': create.handler,
    'bind.release': release.handler,
    'bind.getCurrent': getCurrent.handler,
    'bind.claimGuestOrder': claimGuestOrder.handler
  }
};
