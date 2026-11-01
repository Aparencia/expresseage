// pkg-partner/pages/create-on-behalf/parts/recognize-model.js · 代客下单识别预填纯件（零 wx、零请求）
// 口径：UX_PARTNER §3.4「识别链路/预填/失败降级/低置信不写入」；CONTRACT D44（选图自动识别预填、一图多码按件拆）。
// 职责：识别结果行 → 逐件预填（只填空白字段、手填优先、不覆盖用户输入）；识别进度/取消/失败人话（单源）。
// 边界：本文件不调 wx、不发请求（OCR/AI 调用在 parts/recognize-flow.js）；不落任何本地存储。
'use strict';

const stations = require('../../../../shared/stations');
const recognize = require('../../../../utils/recognize/index');
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

/** 该件是否需要 AI 兜底：缺站点或缺可提交码（C2 触发口径，不以"是否抽到文本"为前置） */
function needsAiOf(item) {
  if (!item || !item.stationId) return true;
  const checked = recognize.validateParcel(item);
  return !!checked.errors.pickupCode || checked.codeStatus !== 'OK';
}

/** 单图兜底目标（纯件）：只列缺站点/缺码的件下标——规则已可用的件不外呼，AI 次数按件有界（≤件数） */
function aiFallbackIndexesOf(items) {
  const list = listOf(items);
  const indexes = [];
  for (let index = 0; index < list.length; index += 1) {
    if (needsAiOf(list[index])) indexes.push(index);
  }
  return indexes;
}

/**
 * 逐件 AI 兜底结果回写（纯件，DATA_MODEL §4.9）：calls=[{index,value}]，value=aiApi.parseParcel 返回值。
 * 只写对应件（各自独立 failureId，同图多件不共键）、只填空字段（手填优先，applyAiSuggestion 统一完成）；
 * 某件失败只降级该件，不污染其它件的建议/失败关联。
 * @returns {{items:object[],changed:number,failed:number,low:number,error:number,failureId:string}}
 */
function applyAiFallbacksOf(items, calls) {
  const list = listOf(items).map(function clone(item) { return Object.assign({}, item || {}); });
  const out = { items: list, changed: 0, failed: 0, low: 0, error: 0, failureId: '' };
  listOf(calls).forEach(function each(call) {
    const index = numberOr(call && call.index, -1);
    if (index < 0 || index >= list.length) return;
    const value = Object.assign({}, (call && call.value) || {});
    // 兼容服务端旧 DTO 字段名：缺 failureId 时用 failureNo 兜底（建单仍按件关联失败记录）
    if (!textOf(value.failureId) && textOf(value.failureNo)) value.failureId = textOf(value.failureNo);
    const merged = recognize.applyAiSuggestion(list[index], value);
    list[index] = merged.parcel;
    if (merged.changed.length > 0) out.changed += 1;
    if (merged.suggestion) out.low += 1;
    const failureId = textOf(list[index].failureId);
    if (failureId) {
      out.failed += 1;
      if (!out.failureId) out.failureId = failureId;
    }
    if (value.error === true) out.error += 1;
  });
  return out;
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
 * TD-084③：已达上限仍有可填结果时不再静默丢弃——overflow=放不下的行数，交页面显式「请分单」提示。
 * @returns {{items:object[], parcelSeq:number, filled:number, overflow:number}}
 */
function mergeRecognizedItems(state, recognized) {
  const source = state || {};
  const items = listOf(source.items).map(function clone(item) { return Object.assign({}, item || {}); });
  let seq = numberOr(source.parcelSeq, items.length) || items.length;
  const used = {};
  let filled = 0;
  let overflow = 0;
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
      overflow += 1;
      return;
    }
    used[index] = true;
    const result = fillBlank(items[index], row);
    items[index] = result.item;
    if (result.changed > 0) filled += 1;
  });
  return { items: items, parcelSeq: seq, filled: filled, overflow: overflow };
}

/** 预填提示文案：有预填→请核对；低置信→没把握；无预填但有失败→已反馈复核；都没有→手填引导 */
function recognitionTextOf(result) {
  const info = result || {};
  if (numberOr(info.overflow, 0) > 0) {
    // TD-084③：超限不静默丢件——复用 form-model 的件数上限唯一文案（不在本文件再造第二处字面量）
    return (numberOr(info.filled, 0) > 0 ? PREFILL_TEXT + '；' : '') + formModel.PARCEL_LIMIT_TEXT;
  }
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
  aiFallbackIndexesOf,
  applyAiFallbacksOf,
  contentHashOf,
  failureRequestIdOf,
  fillBlank,
  isCancelled,
  mergeRecognizedItems,
  needsAiOf,
  progressTextOf,
  recognitionTextOf
};
