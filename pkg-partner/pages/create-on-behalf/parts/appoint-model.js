// pkg-partner/pages/create-on-behalf/parts/appoint-model.js · 代客下单预约纯件（零 wx、零请求）
// 口径：docs/contract/V4_CONTRACT.md §5.2 / D47（预约「最晚可接受时间」）：与顾客下单同一模型——
//   尽快 / 最晚时间（30 分钟粒度、≤7 天、最小提前 30 分钟）；SLOT 仅历史订单展示，新单不可选。
// 边界：校验与文案单源 shared/appoint；本文件只做代客页状态装配（页面不自行判断合法性、不手拼时间）。
'use strict';

const appointUtil = require('../../../../shared/appoint');
const enums = require('../../../../shared/enums');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// currentType：预填/热重载带来的历史值（SLOT 会降级为「尽快」并给提示）
function createState(nowMs, currentType) {
  return appointUtil.createState(nowMs, currentType);
}

function patchWithType(state, type, nowMs) {
  return { appoint: appointUtil.setType((state || {}).appoint, type, nowMs) };
}

function patchWithDate(state, dateValue, nowMs) {
  return { appoint: appointUtil.setDate((state || {}).appoint, dateValue, nowMs) };
}

function patchWithTime(state, clockValue, nowMs) {
  return { appoint: appointUtil.setTime((state || {}).appoint, clockValue, nowMs) };
}

function patchWithPreset(state, clockValue, nowMs) {
  return { appoint: appointUtil.pickPreset((state || {}).appoint, clockValue, nowMs) };
}

function payloadOf(state) {
  return appointUtil.payloadOf((state || {}).appoint);
}

function signatureOf(state) {
  return appointUtil.fingerprintOf((state || {}).appoint);
}

// 页面渲染字段（WXML 只读稳定键；不直读 shared/appoint 的内部结构）
function viewOf(state) {
  const appoint = (state || {}).appoint || {};
  return {
    appointType: textOf(appoint.type) || enums.APPOINT_TYPE.ASAP,
    appointDate: textOf(appoint.date),
    appointDateText: textOf(appoint.dateText),
    appointTime: textOf(appoint.time),
    appointTimeIndex: numberOr(appoint.timeIndex, -1),
    appointDays: listOf(appoint.days),
    appointTimes: listOf(appoint.times),
    appointPresets: listOf(appoint.presets),
    appointText: textOf(appoint.summary),
    appointError: textOf(appoint.error),
    appointNotice: textOf(appoint.notice),
    appointNote: textOf(appoint.note),
    appointMinDate: textOf(appoint.minDate),
    appointMaxDate: textOf(appoint.maxDate)
  };
}

module.exports = {
  createState: createState,
  patchWithType: patchWithType,
  patchWithDate: patchWithDate,
  patchWithTime: patchWithTime,
  patchWithPreset: patchWithPreset,
  payloadOf: payloadOf,
  signatureOf: signatureOf,
  viewOf: viewOf
};
