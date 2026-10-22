// pages/customer/orders/parts/ticker-patch.js · 等待接单行的秒级倒计时「行级补丁」（纯件，零 wx）
// 口径：PERFORMANCE §4.1 P0-6——1s ticker 不再整表 setData({list})，只给时间文案变了的 SUBMITTED 行下发
// `list[i].timeText` 点路径；无变化返回 null（页面据此跳过 setData）。
'use strict';

const state = require('../../../../shared/order-state');
const ordersView = require('../../parts/orders-view');

/**
 * @param {Array} rows 当前列表（order-row 视图模型）
 * @param {number} nowMs 服务端对齐后的当前时刻
 * @param {object} config 公开配置（orderTimeoutMinutes）
 * @returns {object|null} 形如 { 'list[2].timeText': '等待接单 01:23' }；无变化返回 null
 */
function build(rows, nowMs, config) {
  const list = rows || [];
  let patch = null;
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || row.status !== state.STATUS.SUBMITTED) {
      continue;
    }
    const timeText = ordersView.waitingTextOf(row, nowMs, config);
    if (timeText === row.timeText) {
      continue;
    }
    if (!patch) {
      patch = {};
    }
    patch['list[' + i + '].timeText'] = timeText;
  }
  return patch;
}

module.exports = { build };
