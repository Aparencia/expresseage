// pkg-partner/pages/create-on-behalf/parts/result-model.js · 提交结果块纯件（零 wx、零请求）
// 口径：docs/ux/V4_UX_PARTNER.md §3.4（成功后当前页结果块逐个列 orderNo 可点；guest 提示块必显；一图多码 N 单）
//      D43/D51：guest 单自动完成时刻按调用方注入的公开配置 config.autoCompleteAt 生成文案（TD-083），
//      缺配置/非法才回退出厂默认；默认值唯一单源 config/defaults.DEFAULT_CONFIG（本文件不写第二处时刻字面量）。
'use strict';

const defaults = require('../../../../config/defaults');

// guest 提示前三行不含时刻（与配置无关）；第 4 行由 guestAutoCompleteLineOf(config) 按 D43 配置生成
const GUEST_HINT_LINES = [
  '该顾客尚未绑定：进度需线下告知，顾客在小程序里看不到这单的进度。',
  '可分享绑定卡片，邀请顾客自己发起绑定（兼职不能代绑）。',
  '顾客绑定后只能看到绑定之后下的单，这单不会补上进度。'
];

const BOUND_HINT_LINES = [
  '顾客已绑定：可在小程序里看到这单的进度。',
  '送达后顾客确认或系统自动完成。'
];

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// D43/D51（CONTRACT §13）：UTC+8 的完成时刻 config.autoCompleteAt（HH:MM，D51 默认 22:00）；
// 缺配置/非法一律回退出厂默认（唯一默认常量在 config/defaults，本零件不再写时刻字面量）。
function autoCompleteAtOf(config) {
  const source = config && typeof config === 'object' ? config : {};
  return defaults.normalizeClockText(source.autoCompleteAt) || defaults.DEFAULT_CONFIG.autoCompleteAt;
}

// guest 第 4 行：自动完成口径随配置走（该时刻前送达当天完成、该时刻后送达下一轮自动完成，无需顾客确认）
function guestAutoCompleteLineOf(config) {
  const at = autoCompleteAtOf(config);
  return '送达后由系统每天 ' + at + ' 自动完成（该时刻前送达的当天完成；该时刻后送达的下一轮自动完成），无需顾客确认。';
}

function guestHintLinesOf(config) {
  return GUEST_HINT_LINES.concat([guestAutoCompleteLineOf(config)]);
}

// 结果里的订单号：单件取 orderNo；批量取 orders[]（兼容字符串与 {orderNo} 两种 DTO）
function orderNosOf(result) {
  const data = result || {};
  const fromList = listOf(data.orders).map((item) => (typeof item === 'string' ? textOf(item) : textOf(item && item.orderNo)));
  const single = textOf(data.orderNo);
  return fromList.concat(single ? [single] : []).filter((no) => no !== '');
}

function buildResult(result, options) {
  const opts = options || {};
  const data = result || {};
  const orderNos = orderNosOf(data);
  const guest = opts.customerMode !== 'BOUND';
  const duplicated = data.duplicated === true;
  const duplicateText = duplicated
    ? (orderNos.length ? '这次提交与上次重复，已复用同一单（不会重复建单）。' : '这单之前已经提交成功，重复提交已被拦截。')
    : '';
  const rows = orderNos.map((orderNo, index) => ({
    orderNo: orderNo,
    label: orderNos.length > 1 ? '第 ' + (index + 1) + ' 单' : '点开查看进度'
  }));
  return {
    visible: rows.length > 0 || duplicateText !== '',
    title: rows.length > 1 ? '本次提交 ' + rows.length + ' 单' : '订单已提交',
    rows: rows,
    duplicateText: duplicateText,
    hintLines: (guest ? guestHintLinesOf(opts.config) : BOUND_HINT_LINES).slice(),
    tip: rows.length ? '点单号进订单详情查看进度' : ''
  };
}

module.exports = {
  BOUND_HINT_LINES,
  GUEST_HINT_LINES,
  buildResult,
  orderNosOf
};
