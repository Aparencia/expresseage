// utils/recognize/index.js · OCR 文本 → 订单字段 DTO（单源形态闸；纯逻辑，零 wx）
// 页面只消费本模块输出；失败不阻断手填（NEED_CODE 允许提交）。
'use strict';

const text = require('./text');
const codes = require('./codes');
const station = require('./station');

const FORM_ERROR = {
  station: '请选择去哪取（按驿站站点）',
  pickupCode: '这串不太像取件码，请核对',
  lockerNo: '柜号最多 10 个字',
  trackingTail: '运单后 5 位要正好 5 位数字',
  codeStatus: '还没有取件码：可手动填写，或填运单后 5 位先提交'
};

function makeEmptyParcel() {
  return {
    stationId: '',
    stationName: '',
    pickupCode: '',
    lockerNo: '',
    trackingTail: '',
    codeStatus: 'NEED_CODE',
    confidence: 'NONE',
    source: 'NONE',
    recognized: false
  };
}

/** 单件形态闸：返回 {ok, errors, codeStatus}；errors 只给页面做行内提示 */
function validateParcel(parcel) {
  const value = parcel || {};
  const errors = {};
  if (!value.stationId || !station.stationName(value.stationId)) {
    errors.station = FORM_ERROR.station;
  }
  if (value.pickupCode && !codes.isPlausibleCode(value.pickupCode)) {
    errors.pickupCode = FORM_ERROR.pickupCode;
  }
  if (value.lockerNo && !codes.isPlausibleLocker(value.lockerNo)) {
    errors.lockerNo = FORM_ERROR.lockerNo;
  }
  if (value.trackingTail && !codes.isPlausibleTail(value.trackingTail)) {
    errors.trackingTail = FORM_ERROR.trackingTail;
  }
  const codeStatus = codes.deriveCodeStatus(value.pickupCode, value.trackingTail);
  if (codeStatus === 'NONE') errors.codeStatus = FORM_ERROR.codeStatus;
  return {
    ok: Object.keys(errors).length === 0,
    errors: errors,
    codeStatus: codeStatus
  };
}

/** 从行里抽柜号：支持「7号柜」「3-2柜」「柜A12」等形态 */
function pickLocker(lines) {
  for (let i = 0; i < (lines || []).length; i += 1) {
    const line = String(lines[i]);
    const patterns = [
      /(\d{1,3})\s*号\s*柜/,
      /柜\s*(?:号\s*)?([0-9A-Za-z]{1,10})/,
      /(\d{1,2})\s*[-/]\s*(\d{1,2})\s*柜/
    ];
    for (let p = 0; p < patterns.length; p += 1) {
      const match = line.match(patterns[p]);
      if (match) {
        const value = match.length > 2 ? match[1] + '-' + match[2] : match[1];
        const locker = codes.normalizeLocker(value);
        if (locker && codes.isPlausibleLocker(locker)) return locker;
      }
    }
  }
  return '';
}

function buildParcel(base) {
  const parcel = Object.assign(makeEmptyParcel(), base || {});
  const result = validateParcel(parcel);
  parcel.codeStatus = result.codeStatus;
  parcel.formErrors = result.errors;
  return parcel;
}

/**
 * OCR 文本 → 订单字段 DTO。
 * 一图多码：每个可用码一件（共享同一 fileId，由页面组装）；无码有尾号 → 一件 NEED_CODE。
 * @param {string} rawText OCR 行文本
 * @returns {{items:object[], found:boolean, station:object|null, trackingTail:string, lockerNo:string, formErrors:object}}
 */
function parseOcrText(rawText) {
  const lines = text.splitLines(rawText);
  const joined = lines.join(' ');
  const matched = station.matchStation(joined);
  const tail = text.pickTrackingTail(lines);
  const codeList = codes.pickCodes(lines);
  const lockerNo = pickLocker(lines);
  const shared = {
    stationId: matched ? matched.id : '',
    stationName: matched ? matched.name : '',
    trackingTail: tail.value || '',
    lockerNo: lockerNo,
    source: 'RULE',
    confidence: matched && tail.value ? 'MEDIUM' : 'LOW',
    recognized: !!(matched && codeList.length > 0)
  };
  let items = [];
  if (codeList.length > 0) {
    items = codeList.map(function mapCode(item, index) {
      return buildParcel(Object.assign({}, shared, {
        pickupCode: item.value,
        recognized: !!(shared.stationId && item.value),
        confidence: shared.stationId ? 'MEDIUM' : 'LOW',
        index: index
      }));
    });
  } else if (tail.value) {
    items = [buildParcel(Object.assign({}, shared, { pickupCode: '' }))];
  }
  const needsReview = items.some(function review(item) {
    return !item.stationId || item.codeStatus === 'NEED_CODE' || item.confidence === 'LOW';
  });
  return {
    items: items,
    found: items.length > 0,
    station: matched,
    trackingTail: tail.value || '',
    lockerNo: lockerNo,
    needsReview: needsReview,
    formErrors: items.length === 0 ? { codeStatus: FORM_ERROR.codeStatus } : {}
  };
}

/**
 * AI 兜底结果合并且只填空字段（手填优先、不覆盖）。
 * suggestion: {recognized,stationId,stationName,pickupCode,trackingTail,lockerNo,confidence,source,failureId,needsReview}
 */
function applyAiSuggestion(parcel, suggestion) {
  const target = Object.assign(makeEmptyParcel(), parcel || {});
  const ai = suggestion || {};
  const changed = [];
  if (!target.stationId && ai.stationId && station.stationName(ai.stationId)) {
    target.stationId = ai.stationId;
    target.stationName = ai.stationName || station.stationName(ai.stationId);
    changed.push('station');
  }
  if (!target.pickupCode && codes.isPlausibleCode(ai.pickupCode)) {
    target.pickupCode = codes.normalizeCode(ai.pickupCode);
    changed.push('pickupCode');
  }
  if (!target.trackingTail && codes.isPlausibleTail(ai.trackingTail)) {
    target.trackingTail = codes.normalizeTail(ai.trackingTail);
    changed.push('trackingTail');
  }
  if (!target.lockerNo && ai.lockerNo && codes.isPlausibleLocker(ai.lockerNo)) {
    target.lockerNo = codes.normalizeLocker(ai.lockerNo);
    changed.push('lockerNo');
  }
  if (changed.length > 0) {
    target.source = ai.source || 'RULE';
    target.confidence = ai.confidence || 'MEDIUM';
    target.recognized = !!ai.recognized;
    target.aiApplied = true;
  }
  target.failureId = ai.failureId || target.failureId || '';
  target.needsReview = ai.needsReview === true || !target.recognized;
  const result = validateParcel(target);
  target.codeStatus = result.codeStatus;
  target.formErrors = result.errors;
  return { parcel: target, changed: changed };
}

/** 外发给 AI 的去敏文本（≤2000 字；不含原图/openid/联系方式） */
function maskForAi(rawText) {
  return text.maskSensitive(rawText, 2000);
}

/** 页面摘要行：站点名/码/柜/尾号/需查明 */
function summarizeParcel(parcel) {
  const value = parcel || {};
  const parts = [];
  if (value.stationName) parts.push(value.stationName);
  if (value.pickupCode) parts.push(value.pickupCode);
  if (value.lockerNo) parts.push('柜 ' + value.lockerNo);
  if (value.trackingTail) parts.push('尾号 ' + value.trackingTail);
  if (value.codeStatus === 'NEED_CODE') parts.push('需查明');
  return parts.join(' · ');
}

module.exports = {
  FORM_ERROR,
  makeEmptyParcel,
  validateParcel,
  parseOcrText,
  applyAiSuggestion,
  maskForAi,
  summarizeParcel,
  pickLocker,
  station,
  codes,
  text
};
