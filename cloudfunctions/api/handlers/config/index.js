// handlers/config/index.js · config 域动作汇总
'use strict';

const getPublic = require('./getPublic');

module.exports = {
  actions: {
    'config.getPublic': getPublic.handler
  }
};
