// pkg-customer/pages/order-detail/parts/transfer-view.js · D58 转派顾客可见性（纯件，零 wx）
// 口径：批 26-W5 / 草案 §1.4 顾客行——顾客只在「转派已完成（新兼职接手）」后看到结果态与目标编号；
//       判断由 DTO 字段驱动（transfer/fulfillmentPartnerNo），页面零状态字面量（check #21）；
//       顾客侧只显示编号，绝不展示头像/昵称/顾客档案（D19/D42）。
// 批 27 修（审查 P2-5）：时间线只把**最近一条** TRANSFER_ACCEPTED 改写为当前履约编号；A→B→C 两次转派时
//       更早那条退回通用人话（顾客侧事件 DTO 不下发 payload，拿不到历史 toPartnerNo，不能拿当前编号冒充）。
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

// 事件时间：服务端事件 DTO 用 ISO 字符串下发（_dto-party.buildEventDtos）；缺失/非法返回 null
// （不把坏时间当 0 参与比较，也不退回 Date.now 造出假的新旧关系）。
function atMsOf(event) {
  const value = event && event.at;
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

// 最近一条 TRANSFER_ACCEPTED 的下标：按 at 取最大（服务端下发顺序可能是 desc 也可能是 asc）；
//   时间全缺失（历史单）时退回数组最后一条——服务端事件列表「越靠后越新」由页面/DTO 口径保证。
function latestAcceptedIndexOf(events) {
  const list = Array.isArray(events) ? events : [];
  let latestByTime = -1;
  let latestMs = -Infinity;
  let lastSeen = -1;
  list.forEach(function scan(event, index) {
    if (textOf(event && event.type) !== ACCEPTED_EVENT) return;
    lastSeen = index;
    const ms = atMsOf(event);
    if (ms !== null && ms >= latestMs) {
      latestMs = ms;
      latestByTime = index;
    }
  });
  return latestByTime >= 0 ? latestByTime : lastSeen;
}

// 更早交接的通用人话：复用 parts/status-view 的事件文案单源（不出现英文事件名，也不冒用当前编号）。
function genericAcceptedText() {
  const built = statusView.buildEvents([{ type: ACCEPTED_EVENT }], {});
  const first = built && built[0];
  return first && first.text ? first.text : '';
}

/**
 * 时间线事件文案：只把**最近一条** TRANSFER_ACCEPTED 换成顾客人话（有编号时带编号），其余事件原样透传；
 *   更早的 TRANSFER_ACCEPTED 退回通用人话（A→B→C 两次转派时分别显示「由 C 接手履约」与「交接」通用文案）。
 * 编号缺失（历史单/匿名化）时同样退回通用人话单源（不出现英文事件名）。
 * @param {object[]} events 事件视图（{id,type,text,note,time,at}）
 * @param {object} order 顾客侧 order DTO（取已接手编号）
 */
function eventsView(events, order) {
  const list = Array.isArray(events) ? events : [];
  const no = acceptedPartnerNoOf(order);
  const latestIndex = latestAcceptedIndexOf(list);
  const generic = genericAcceptedText();
  return list.map(function map(event, index) {
    const item = event || {};
    if (textOf(item.type) !== ACCEPTED_EVENT) return item;
    const text = index === latestIndex && no ? '由 ' + no + ' 接手履约' : generic;
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
