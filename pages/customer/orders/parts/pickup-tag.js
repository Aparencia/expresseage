// pages/customer/orders/parts/pickup-tag.js · 顾客订单行「已取 n/m 件」标签（纯件，零 wx）
// 口径：CONTRACT §5/§5.1（D61）——已取件以「全部件取完」为准，部分取件时订单详情/列表显示「已取 N/M 件」。
// 单一判据：只读服务端 order DTO 的 status/pickedCount/parcelCount/allPicked；不写状态字面量、不按件推导动作。
'use strict';

const state = require('../../../../shared/order-state');

function countOf(value) {
  return typeof value === 'number' && isFinite(value) ? Math.floor(value) : null;
}

/**
 * 行内标签文案：仅「进行中 + 部分取件」（订单非终态、0 < 已取 < 件数）时返回「已取 n/m 件」。
 * 终态不显示（UX_CUSTOMER §3.4）：已取消单显示进度会让顾客误以为还能操作/还有进度；已完成单必然全取。
 * 未取/全部取完不显示（与订单状态「已取件」重复），旧 DTO 缺 pickedCount/parcelCount 时同样不显示。
 * @param {object} order 顾客侧 order DTO
 * @returns {string} 标签文案；不显示时为空串
 */
function tagOf(order) {
  const item = order || {};
  // 终态（COMPLETED/CANCELLED）不显示部分取件进度（状态判断单源 = shared/order-state，页面零状态字面量）
  if (state.isTerminal(item.status)) return '';
  const parcelCount = countOf(item.parcelCount);
  const pickedCount = countOf(item.pickedCount);
  if (parcelCount === null || pickedCount === null) return '';
  if (pickedCount <= 0 || pickedCount >= parcelCount) return '';
  // 服务端聚合标记优先：allPicked=true（全部件已取）时绝不显示部分取件标签
  if (item.allPicked === true) return '';
  return '已取 ' + pickedCount + '/' + parcelCount + ' 件';
}

module.exports = {
  tagOf
};
