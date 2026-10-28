// utils/recognize/index.js · OCR 文本 → 订单字段 DTO（单源形态闸；纯逻辑，零 wx）
// 页面只消费本模块输出；失败不阻断手填（NEED_CODE 允许提交）。
// 三处口径（task-45）：①自动填只认服务端同款紧凑码（4~12），超长候选标"认出但不像"不填；
// ②柜号先判原长 ≤10 再归一（不截断放行）；③站点归一单源 = shared/stations（本层不复制站点表）。
// v1.0（D23）：一单多包裹（≤10 件）+ 多图（≤5 张）——多图识别结果由 mergeParcels 汇总去重后交给页面。
'use strict';

const orderState = require('../../shared/order-state');
const text = require('./text');
const codes = require('./codes');
const station = require('./station');

// 一单上限（CONTRACT §5.2/D23）。task-21 落地 MAX_PARCELS_PER_ORDER/MAX_IMAGES_PER_ORDER 后自动取共享常量，
// 未落地前按 CONTRACT 定值兜底（测试断言锁定 CONTRACT 值 10/5，不抄现状）。
const MAX_PARCELS_PER_ORDER = orderState.MAX_PARCELS_PER_ORDER || 10;
const MAX_IMAGES_PER_ORDER = orderState.MAX_IMAGES_PER_ORDER || 5;

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
  if (value.pickupCode && !codes.isFillableCode(value.pickupCode)) {
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

/** 从行里抽柜号：支持「7号柜」「3-2柜」「柜A12」等形态（先判原长再归一，超长不截断） */
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
        const raw = match.length > 2 ? match[1] + '-' + match[2] : match[1];
        if (!codes.isPlausibleLocker(raw)) continue;
        const locker = codes.normalizeLocker(raw);
        if (locker) return locker;
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
 * 一图多码：每个紧凑码可提交的候选一件（共享同一 fileId，由页面组装）；无码有尾号 → 一件 NEED_CODE。
 * 超长/带奇怪符号的候选「认出但不像」：不自动填，单独放 unalignedCodes 交给页面提示。
 * @param {string} rawText OCR 行文本
 * @param {{stations?: Array<{id:string,name:string}>}} [options] 当前配置站点表（config.getPublic.stations；
 *   缺省=内置默认，旧调用零破坏）
 * @returns {{items:object[], found:boolean, station:object|null, trackingTail:string, lockerNo:string,
 *   unalignedCodes:string[], needsReview:boolean, formErrors:object}}
 */
function parseOcrText(rawText, options) {
  const lines = text.splitLines(rawText);
  const joined = lines.join(' ');
  const matched = station.matchStation(joined, options);
  const tail = text.pickTrackingTail(lines);
  const candidates = codes.pickCodeCandidates(lines);
  const codeList = candidates.filter(function compact(item) { return item.compact; });
  const unalignedCodes = candidates
    .filter(function odd(item) { return !item.compact; })
    .map(function value(item) { return item.value; });
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
  }) || (unalignedCodes.length > 0 && codeList.length === 0);
  let formErrors = {};
  if (items.length === 0) {
    formErrors = unalignedCodes.length > 0
      ? { pickupCode: FORM_ERROR.pickupCode }
      : { codeStatus: FORM_ERROR.codeStatus };
  }
  return {
    items: items,
    found: items.length > 0,
    station: matched,
    trackingTail: tail.value || '',
    lockerNo: lockerNo,
    unalignedCodes: unalignedCodes,
    needsReview: needsReview,
    formErrors: formErrors
  };
}

// ── AI 建议（D29）：低置信且来自 AI 的结果不写入，只给可采纳建议条 ──────────────
const AI_SOURCE = 'DEEPSEEK';
const CONFIDENCE_LOW = 'LOW';

/** 仅 AI 来源的低置信建议适用 D29；RULE/NONE 降级结果照旧预填 */
function isLowAiSuggestion(ai) {
  return ai.confidence === CONFIDENCE_LOW && ai.source === AI_SOURCE;
}

/** 低置信建议快照：只留可展示/可采纳字段（过形态闸并归一），一个字段都没有回 null */
function lowSuggestionOf(ai) {
  const out = {};
  if (ai.stationId && station.stationName(ai.stationId)) {
    out.stationId = ai.stationId;
    out.stationName = station.stationName(ai.stationId);
  }
  if (codes.isFillableCode(ai.pickupCode)) out.pickupCode = codes.normalizeCode(ai.pickupCode);
  if (codes.isPlausibleTail(ai.trackingTail)) out.trackingTail = codes.normalizeTail(ai.trackingTail);
  if (ai.lockerNo && codes.isPlausibleLocker(ai.lockerNo)) out.lockerNo = codes.normalizeLocker(ai.lockerNo);
  if (Object.keys(out).length === 0) return null;
  out.confidence = CONFIDENCE_LOW;
  out.source = AI_SOURCE;
  return out;
}

/** 写入后统一重算件形态闸（codeStatus/formErrors），避免各分支口径漂移 */
function finishParcel(target) {
  const result = validateParcel(target);
  target.codeStatus = result.codeStatus;
  target.formErrors = result.errors;
  return target;
}

/**
 * AI 兜底结果合并且只填空字段（手填优先、不覆盖）。
 * suggestion: {recognized,stationId,stationName,pickupCode,trackingTail,lockerNo,confidence,source,failureId,needsReview}
 * D29：仅「低置信且来自 AI」（confidence=LOW 且 source=DEEPSEEK）不写入任何字段，只返回可采纳建议快照；
 * RULE/NONE 的规则/降级结果与 HIGH/MEDIUM 照旧预填（规则结果不是 AI 猜测，不能让用户白填）。
 */
function applyAiSuggestion(parcel, suggestion) {
  const target = Object.assign(makeEmptyParcel(), parcel || {});
  const ai = suggestion || {};
  if (isLowAiSuggestion(ai)) {
    // 不写任何字段、不动 source/confidence/aiApplied（保持件原值）；只透传 failureId + 复核标记
    target.failureId = ai.failureId || target.failureId || '';
    target.needsReview = true;
    finishParcel(target);
    return { parcel: target, changed: [], suggestion: lowSuggestionOf(ai) };
  }
  const changed = [];
  if (!target.stationId && ai.stationId && station.stationName(ai.stationId)) {
    target.stationId = ai.stationId;
    target.stationName = ai.stationName || station.stationName(ai.stationId);
    changed.push('station');
  }
  if (!target.pickupCode && codes.isFillableCode(ai.pickupCode)) {
    target.pickupCode = codes.normalizeCode(ai.pickupCode);
    changed.push('pickupCode');
  } else if (ai.pickupCode && !codes.isCompactCode(ai.pickupCode) && !target.pickupCode) {
    // 「认出但不像」：原始候选只留痕给页面提示，不自动填（不阻断手填）
    target.aiPickupCodeUnaligned = String(ai.pickupCode);
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
  finishParcel(target);
  return { parcel: target, changed: changed, suggestion: null };
}

/**
 * 采纳低置信建议（D29）：用户点「采纳建议」后才写入——逐字段只填空位（手填优先、不覆盖），
 * 非法值不写并进 rejected 留痕；写入后按建议来源归一 source=DEEPSEEK、保留 confidence=LOW 快照、
 * aiApplied=true，并清空建议条（aiSuggestion=null）。仍需人核对，故 needsReview=true。
 * @returns {{parcel:object, changed:string[], rejected:string[]}}
 */
function adoptAiSuggestion(parcel, suggestion) {
  const target = Object.assign(makeEmptyParcel(), parcel || {});
  const ai = suggestion || {};
  const changed = [];
  const rejected = [];
  if (!target.stationId && ai.stationId) {
    if (station.stationName(ai.stationId)) {
      target.stationId = ai.stationId;
      target.stationName = ai.stationName || station.stationName(ai.stationId);
      changed.push('station');
    } else {
      rejected.push('stationId');
    }
  }
  if (!target.pickupCode && ai.pickupCode) {
    if (codes.isFillableCode(ai.pickupCode)) {
      target.pickupCode = codes.normalizeCode(ai.pickupCode);
      changed.push('pickupCode');
    } else {
      rejected.push('pickupCode');
    }
  }
  if (!target.trackingTail && ai.trackingTail) {
    if (codes.isPlausibleTail(ai.trackingTail)) {
      target.trackingTail = codes.normalizeTail(ai.trackingTail);
      changed.push('trackingTail');
    } else {
      rejected.push('trackingTail');
    }
  }
  if (!target.lockerNo && ai.lockerNo) {
    if (codes.isPlausibleLocker(ai.lockerNo)) {
      target.lockerNo = codes.normalizeLocker(ai.lockerNo);
      changed.push('lockerNo');
    } else {
      rejected.push('lockerNo');
    }
  }
  if (changed.length > 0) {
    target.source = AI_SOURCE;
    target.confidence = CONFIDENCE_LOW;
    target.aiApplied = true;
    target.aiSuggestion = null;
  }
  target.failureId = ai.failureId || target.failureId || '';
  target.needsReview = true;
  finishParcel(target);
  return { parcel: target, changed: changed, rejected: rejected };
}

// ── 多图汇总（v1.0 D23，纯函数）──────────────────────────────────────────────
/** 件的去重键：站点+码+柜+尾号（同一张图重复选择/一图多码跨图重复时只留一件） */
function parcelKey(parcel) {
  const value = parcel || {};
  return [
    value.stationId || '',
    value.pickupCode || '',
    value.lockerNo || '',
    value.trackingTail || ''
  ].join('\u0001');
}

/**
 * 多图识别结果汇总：按图顺序收集件、去重、截断到一单上限。
 * @param {object[][]} itemLists 每张图解析出的件数组（按图顺序）
 * @param {{max?:number}} [options]
 * @returns {{items:object[], duplicated:number, dropped:number, truncated:boolean}}
 */
function mergeParcels(itemLists, options) {
  const max = (options && options.max) || MAX_PARCELS_PER_ORDER;
  const lists = Array.isArray(itemLists) ? itemLists : [];
  const out = [];
  const seen = {};
  let duplicated = 0;
  let dropped = 0;
  lists.forEach(function each(list) {
    (Array.isArray(list) ? list : []).forEach(function take(item) {
      if (!item || typeof item !== 'object') {
        return;
      }
      const key = parcelKey(item);
      if (seen[key]) {
        duplicated += 1;
        return;
      }
      if (out.length >= max) {
        dropped += 1;
        return;
      }
      seen[key] = true;
      out.push(item);
    });
  });
  return { items: out, duplicated: duplicated, dropped: dropped, truncated: dropped > 0 };
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
  MAX_PARCELS_PER_ORDER,
  MAX_IMAGES_PER_ORDER,
  makeEmptyParcel,
  validateParcel,
  parseOcrText,
  applyAiSuggestion,
  adoptAiSuggestion,
  maskForAi,
  summarizeParcel,
  pickLocker,
  parcelKey,
  mergeParcels,
  station,
  codes,
  text
};
