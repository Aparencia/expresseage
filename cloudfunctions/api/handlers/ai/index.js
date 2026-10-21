// handlers/ai/index.js · AI 识别兜底域 action 注册表（1 个动作，键名逐字对齐 shared/actions.js）
'use strict';

module.exports = {
  actions: {
    'ai.parseParcel': require('./parseParcel')
  }
};
