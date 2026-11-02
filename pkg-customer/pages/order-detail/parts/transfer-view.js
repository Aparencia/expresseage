// pkg-customer/pages/order-detail/parts/transfer-view.js · D58 转派顾客可见性（纯件，零 wx）
// 口径：批 26-W5 / 草案 §1.4 顾客行——顾客只在「转派已完成（新兼职接手）」后看到结果态与目标编号；
//       判断由 DTO 字段驱动（transfer/fulfillmentPartnerNo），页面零状态字面量（check #21）；
//       顾客侧只显示编号，绝不展示头像/昵称/顾客档案（D19/D42）。
'use strict';

const enums = require('../../../../shared/enums');
const statusView = require('../../../parts/status-view');

const ACCEPTED_EVENT = 'TRANSFER_ACCEPTED';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 已接手的目标兼职编号：仅「服务端确认转派完成」时返回，否则空串。
 * 编号优先取 DTO.fulfillmentPartnerNo（=orders.partnerNo 当前履约编号快照），缺失时回退 transfer.toPartnerNo；
 * 判定用 shared/enums.TRANSFER_STATUS 常量（不写状态字面量）；冻结符号缺失时退化为两个 DTO 字段一致性判断。
 * @param {object} order 顾客侧 order DTO
 * @returns {string} 目标兼职编号；未接手时为空串
 */
function acceptedPartnerNoOf(order) {
  const item = order || {};
  const transfer = item.transfer && typeof item.transfer === 'object' ? item.transfer : null;
  if (!transfer) return '';
  const toNo = textOf(transfer.toPartnerNo);
  const fulfillmentNo = textOf(item.fulfillmentPartnerNo);
  const status = textOf(transfer.status);
  const transferStatus = enums.TRANSFER_STATUS;
  if (transferStatus && status) {
    if (status !== transferStatus.ACCEPTED) return '';
    return fulfillmentNo || toNo;
  }
  return fulfillmentNo && toNo && fulfillmentNo === toNo ? fulfillmentNo : '';
}

// 「由 P-XXX-XXX 接手履约」（只编号，无昵称头像；编号缺失时不显示）
function hintOf(order) {
  const no = acceptedPartnerNoOf(order);
  return no ? '由 ' + no + ' 接手履约' : '';
}

/**
 * 时间线事件文案：只把 TRANSFER_ACCEPTED 换成顾客人话（有编号时带编号），其余事件原样透传。
 * 编号缺失（历史单/匿名化）时退回 parts/status-view 的通用人话单源（不出现英文事件名）。
 * @param {object[]} events 事件视图（{id,type,text,note,time}）
 * @param {object} order 顾客侧 order DTO（取已接手编号）
 */
function eventsView(events, order) {
  const no = acceptedPartnerNoOf(order);
  return (Array.isArray(events) ? events : []).map(function map(event) {
    const item = event || {};
    if (textOf(item.type) !== ACCEPTED_EVENT) return item;
    const text = no ? '由 ' + no + ' 接手履约' : statusView.buildEvents([item], {})[0].text;
    return Object.assign({}, item, { text: text });
  });
}

/** 页面可直接 Object.assign 的扩展字段（转派提示；未接手时为空串，WXML 整行省略） */
function pageExtras(order) {
  return { transferHint: hintOf(order) };
}

module.exports = {
  eventsView,
  pageExtras
};
