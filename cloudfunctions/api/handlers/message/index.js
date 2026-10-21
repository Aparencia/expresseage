// handlers/message/index.js · 消息域 action 注册表（3 个动作，键名逐字对齐 shared/actions.js）
'use strict';

module.exports = {
  actions: {
    'message.send': require('./send'),
    'message.list': require('./list'),
    'message.markRead': require('./markRead')
  }
};
