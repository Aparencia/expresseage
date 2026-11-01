// pkg-partner/pages/create-on-behalf/parts/recognize-model.js · 代客下单识别预填纯件（零 wx、零请求）
// 口径：UX_PARTNER §3.4「识别链路/预填/失败降级/低置信不写入」；CONTRACT D44（选图自动识别预填、一图多码按件拆）。
// 职责：识别结果行 → 逐件预填（只填空白字段、手填优先、不覆盖用户输入）；识别进度/取消/失败人话（单源）。
// 边界：本文件不调 wx、不发请求（OCR/AI 调用在 parts/recognize-flow.js）；不落任何本地存储。
'use strict';

const stations = require('../../../../shared/stations');
const formModel = require('./form-model');

const BATCH_MAX = formModel.BATCH_MAX;

// 进度文案（识别期间不阻塞页面：页面只渲染该文本 + 取消按钮）
const PHASE_TEXT = {
  ocr: '正在识别文字',
  ai: '正在智能兜底'
};
const START_TEXT = '正在识别截图…';
const CANCEL_TEXT = '已取消识别，可以手填。';
const PREFILL_TEXT = '已按截图预填，请核对（以手填为准）';
const FAIL_TEXT = '这次没认出取件码/站点，已反馈开发者复核；可手填，或稍后看复核结果';
const EMPTY_TEXT = '没识别出可预填的内容；可以手填，或换一张更清晰的图重试';
// D29：AI 低置信不写入（只给提示；不覆盖手填）
const LOW_TEXT = '识别结果不太确定，没自动填；已反馈开发者复核，可手填。';

function textOf(value) { return typeof value === 'string' ? value.trim() : ''; }
function listOf(value) { return Array.isArray(value) ? value : []; }
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 进度文案：第 n/N 张 + 阶段（OCR/智能兜底）；phase 非法只显示张数，不装懂 */
function progressTextOf(state) {
  const info = state || {};
  const index = numberOr(info.index, 0);
  const total = numberOr(info.total, 0);
  if (index <= 0 || total <= 0) {
    return START_TEXT;
  }
  const phase = PHASE_TEXT[info.phase] || '';
  return '正在识别（第 ' + index + '/' + total + ' 张）' + (phase ? ' · ' + phase : '');
}

/** 取消判定：token 变化即取消（页面在每次 await 之后调用；true 时立即停止后续 OCR/AI 与回写） */
function isCancelled(requestToken, currentToken) {
  return Number(requestToken) !== Number(currentToken);
}

// 上传票据形态（32 位 [A-Za-z0-9]）：AI 兜底入队幂等键前缀；非法票据不派生（交 api 生成）
const TICKET_RE = /^[A-Za-z0-9]{32}$/;

/** FNV-1a 32 位内容指纹（7 位 36 进制大写；纯函数、零随机） */
function contentHashOf(text) {
  const source = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return ('0000000' + (hash >>> 0).toString(36).toUpperCase()).slice(-7);
}

/**
 * 失败入队幂等键（16~32 位 [A-Za-z0-9]，确定性派生、零随机）：
 * 上传票据前 16 位 + OCR 内容指纹 + 件下标。同一张图同内容重试复用同一键（服务端 requestKey 幂等，
 * 不重复入队/不外呼）；换图或内容变化自动分键（同图多件逐件一条，DATA_MODEL §4.9）。
 */
function failureRequestIdOf(uploadTicketId, itemIndex, ocrTextMasked) {
  const ticket = typeof uploadTicketId === 'string' ? uploadTicketId.trim() : '';
  if (!TICKET_RE.test(ticket)) {
    return '';
  }
  const index = Number.isInteger(itemIndex) && itemIndex >= 0 ? itemIndex : 0;
  const indexText = index < 10 ? '0' + index : String(index);
  return ticket.slice(0, 16) + contentHashOf(ocrTextMasked) + 'AI' + indexText;
}

/** 识别 DTO 行 → 待合并件（只留可提交字段；recognized=false 行只带 failureId 用于复核提示） */
function recognizedItemOf(dto) {
  const data = dto || {};
  return {
    pickupCode: data.recognized ? textOf(data.pickupCode) : '',
    lockerNo: data.recognized ? textOf(data.lockerNo) : '',
    trackingTail: data.recognized ? textOf(data.trackingTail) : '',
    stationId: textOf(data.stationId).toUpperCase(),
    failureId: textOf(data.failureId),
    confidence: textOf(data.confidence),
    source: textOf(data.source),
    imageIndex: numberOr(data.imageIndex, -1)
  };
}

/** 只填空白字段（手填优先）：返回 {item, changed}；站点命中 P1~P8 才写入（非法站点不猜） */
function fillBlank(target, row) {
  const item = Object.assign({}, target || {});
  const value = row || {};
  let changed = 0;
  if (!textOf(item.pickupCode) && value.pickupCode) { item.pickupCode = value.pickupCode; changed += 1; }
  if (!textOf(item.lockerNo) && value.lockerNo) { item.lockerNo = value.lockerNo; changed += 1; }
  if (!textOf(item.trackingTail) && value.trackingTail) { item.trackingTail = value.trackingTail; changed += 1; }
  const stationId = textOf(value.stationId).toUpperCase();
  if (!textOf(item.stationId) && stations.isStationId(stationId)) {
    item.stationId = stationId;
    item.stationName = stations.stationNameOf(stationId);
    item.stationIndex = formModel.stationIndexOf(formModel.stationOptionsOf(), stationId);
    item.stationTouched = true;
    changed += 1;
  }
  if (value.failureId) item.failureId = value.failureId;
  if (value.imageIndex >= 0) item.imageIndex = value.imageIndex;
  return { item: item, changed: changed };
}

/**
 * 识别结果 → 表单预填（D44：一图多码按件拆；只填空白字段、手填优先、不覆盖用户输入）。
 * 每行优先填进第一件「还没码也没尾号」的空件；没有空件才追加新件（上限 10 件）。
 * @returns {{items:object[], parcelSeq:number, filled:number}}
 */
function mergeRecognizedItems(state, recognized) {
  const source = state || {};
  const items = listOf(source.items).map(function clone(item) { return Object.assign({}, item || {}); });
  let seq = numberOr(source.parcelSeq, items.length) || items.length;
  const used = {};
  let filled = 0;
  listOf(recognized).forEach(function each(raw) {
    const row = raw || {};
    if (!row.pickupCode && !textOf(row.trackingTail) && !row.stationId) {
      return;
    }
    let index = -1;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] || {};
      if (!used[i] && !textOf(item.pickupCode) && !textOf(item.trackingTail)) { index = i; break; }
    }
    if (index < 0 && items.length < BATCH_MAX) {
      seq += 1;
      items.push(formModel.emptyParcel(seq));
      index = items.length - 1;
    }
    if (index < 0) {
      return;
    }
    used[index] = true;
    const result = fillBlank(items[index], row);
    items[index] = result.item;
    if (result.changed > 0) filled += 1;
  });
  return { items: items, parcelSeq: seq, filled: filled };
}

/** 预填提示文案：有预填→请核对；低置信→没把握；无预填但有失败→已反馈复核；都没有→手填引导 */
function recognitionTextOf(result) {
  const info = result || {};
  if (info.filled > 0) {
    return info.lowSuggestions > 0 ? PREFILL_TEXT + '（部分字段没把握，未自动填）' : PREFILL_TEXT;
  }
  if (info.lowSuggestions > 0) {
    return LOW_TEXT;
  }
  if (info.failed > 0 || info.failureId) {
    return FAIL_TEXT;
  }
  return EMPTY_TEXT;
}

module.exports = {
  BATCH_MAX,
  CANCEL_TEXT,
  EMPTY_TEXT,
  FAIL_TEXT,
  LOW_TEXT,
  PREFILL_TEXT,
  START_TEXT,
  contentHashOf,
  failureRequestIdOf,
  fillBlank,
  isCancelled,
  mergeRecognizedItems,
  progressTextOf,
  recognizedItemOf,
  recognitionTextOf
};
