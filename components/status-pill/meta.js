// components/status-pill/meta.js · 状态胶囊文案/色调派生（纯件，零 wx）
// 口径：七状态中文单源 = shared/enums.ORDER_STATUS_TEXT；胶囊短文案取「·」前段
//       （如「已取件·配送中」→「已取件」），组件内不再各写一份中文（批 16 死代码专项收敛）。
// 边界：色调只是视觉编码（本组件 wxss 的 status-* 类），不承载业务判据；未知状态回落默认色。
'use strict';

const enums = require('../../shared/enums');

const DEFAULT_TONE = 'pending';
const SHORT_TEXT_SEPARATOR = '·';
const TONES = {
  SUBMITTED: 'pending',
  ACCEPTED: 'accepted',
  PICKED: 'picked',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXCEPTION: 'exception'
};

function shortTextOf(status) {
  const text = (status && enums.ORDER_STATUS_TEXT[status]) || '';
  if (!text) {
    return '';
  }
  return text.split(SHORT_TEXT_SEPARATOR)[0];
}

function pillMetaOf(status) {
  const key = typeof status === 'string' ? status : '';
  return {
    text: shortTextOf(key),
    tone: TONES[key] || DEFAULT_TONE
  };
}

module.exports = {
  DEFAULT_TONE,
  TONES,
  pillMetaOf
};
