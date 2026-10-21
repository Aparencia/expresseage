'use strict';

/**
 * AI 识别兜底 · 模型输出解析与 DTO 裁剪（纯件）。
 *
 * 口径：CONTRACT v0.9 §4.3 / ENGINEERING §4.10.4
 * - 模型输出不可信：JSON 解析失败不抛错；字段逐个过形态闸，不合法一律置空串。
 * - stationName 不由模型决定：调用方按站点表用 stationId 回填（本文件接收注入的站点表）。
 * - 返回 DTO 只保留 §4.3 表格列出的键；多余键剥离。
 */

/** 取件码形制：去空格/连字符后 4~12 位字母数字。 */
const CODE_RE = /^[0-9A-Z]{4,12}$/;
/** 运单尾号：恰好 5 位 ASCII 数字。 */
const TAIL_RE = /^\d{5}$/;
/** 柜号上限（CONTRACT §4.2）。 */
const LOCKER_NO_MAX_LENGTH = 10;
/** 置信度值域。 */
const CONFIDENCE_VALUES = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
/** 兜底置信度（无法判定时按 LOW，触发复核）。 */
const FALLBACK_CONFIDENCE = 'LOW';
/** 返回 DTO 键集合（客户端只认这份）。 */
const DTO_KEYS = Object.freeze([
  'recognized',
  'stationId',
  'stationName',
  'pickupCode',
  'trackingTail',
  'lockerNo',
  'confidence',
  'source',
  'needsReview',
  'failureId',
]);

/** AI 兜底来源标识：只允许在 lib/ai（与 handlers/ai）内部出现，不进 shared/**。 */
const AI_SOURCE_DEEPSEEK = 'DEEPSEEK';

/** 识别来源中文文案（服务端下发 recognitionSourceLabel）。 */
const RECOGNITION_SOURCE_LABELS = Object.freeze({
  RULE: '截图识别',
  MANUAL: '手动填写',
  DEEPSEEK: 'AI 辅助',
});

/** 识别来源值域（订单 parcel.recognitionSource 的完整集合）。 */
const RECOGNITION_SOURCES = Object.freeze(['RULE', 'MANUAL', AI_SOURCE_DEEPSEEK]);

function recognitionSourceLabel(source) {
  return RECOGNITION_SOURCE_LABELS[source] || RECOGNITION_SOURCE_LABELS.RULE;
}

/**
 * 降级 DTO（识别失败/低置信）：客户端只认这份，走手填且不阻断下单。
 * queue 必须来自已成功入队/幂等命中的失败记录（failureNo 非空）。
 * @param {{failureNo: string, duplicated?: boolean}} queue
 * @param {object} fields 可回填的识别字段（可为空串）
 * @param {{source?: string}} extras
 */
function buildDegradedDto(queue, fields, extras) {
  const extra = extras || {};
  const value = fields && typeof fields === 'object' ? fields : {};
  return {
    recognized: false,
    stationId: typeof value.stationId === 'string' ? value.stationId : '',
    stationName: typeof value.stationName === 'string' ? value.stationName : '',
    pickupCode: typeof value.pickupCode === 'string' ? value.pickupCode : '',
    trackingTail: typeof value.trackingTail === 'string' ? value.trackingTail : '',
    lockerNo: typeof value.lockerNo === 'string' ? value.lockerNo : '',
    confidence: typeof value.confidence === 'string' && value.confidence ? value.confidence : FALLBACK_CONFIDENCE,
    source: typeof extra.source === 'string' ? extra.source : 'NONE',
    needsReview: true,
    failureId: queue && typeof queue.failureNo === 'string' ? queue.failureNo : '',
    duplicated: !!(queue && queue.duplicated === true)
  };
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/**
 * 从模型 content 中解析 JSON 对象；失败返回 null（不抛错）。
 * @param {string} content
 * @returns {object|null}
 */
function parseJsonObject(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }
  let text = content.trim();
  const fenced = FENCE_RE.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (err) {
    return null;
  }
}

/**
 * 取件码归一：去空白/连字符、转大写，再过形态闸。
 * @param {*} raw
 * @returns {string}
 */
function normalizePickupCode(raw) {
  if (raw == null) {
    return '';
  }
  const value = String(raw).replace(/[\s\-—_·]+/g, '').toUpperCase();
  return CODE_RE.test(value) ? value : '';
}

/**
 * 站点标识归一：必须命中注入的站点集合，否则 ''。
 * @param {*} raw
 * @param {string[]} stationIds
 * @returns {string}
 */
function normalizeStationId(raw, stationIds) {
  if (raw == null) {
    return '';
  }
  const value = String(raw).trim().toUpperCase();
  const ids = Array.isArray(stationIds) ? stationIds : [];
  return ids.indexOf(value) >= 0 ? value : '';
}

/**
 * 站点名称由服务端站点表回填（不信任模型输出的名称）。
 * @param {string} stationId
 * @param {Array<{id: string, name?: string}>} stations
 * @returns {string}
 */
function resolveStationName(stationId, stations) {
  if (!stationId || !Array.isArray(stations)) {
    return '';
  }
  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i];
    if (station && String(station.id || '').toUpperCase() === stationId) {
      return typeof station.name === 'string' ? station.name : '';
    }
  }
  return '';
}

/**
 * 运单尾号归一：恰好 5 位数字，否则 ''。
 * @param {*} raw
 * @returns {string}
 */
function normalizeTrackingTail(raw) {
  if (raw == null) {
    return '';
  }
  const value = String(raw).replace(/\s+/g, '');
  return TAIL_RE.test(value) ? value : '';
}

/**
 * 柜号归一：去首尾空白，最长 10 个字符，否则 ''。
 * @param {*} raw
 * @returns {string}
 */
function normalizeLockerNo(raw) {
  if (raw == null) {
    return '';
  }
  const value = String(raw).trim().replace(/\s+/g, ' ');
  if (!value || value.length > LOCKER_NO_MAX_LENGTH) {
    return '';
  }
  return value;
}

/**
 * 置信度归一：非法值按 LOW（保守，触发复核）。
 * @param {*} raw
 * @returns {string}
 */
function normalizeConfidence(raw) {
  const value = String(raw == null ? '' : raw).trim().toUpperCase();
  return CONFIDENCE_VALUES.indexOf(value) >= 0 ? value : FALLBACK_CONFIDENCE;
}

/**
 * 把模型输出裁剪为固定字段集。
 * @param {object|null} raw 解析后的 JSON 对象
 * @param {{stationIds: string[], stations: Array<{id: string, name?: string}>}} options
 * @returns {{stationId: string, stationName: string, pickupCode: string,
 *   trackingTail: string, lockerNo: string, confidence: string, recognized: boolean}}
 */
function normalizeAiFields(raw, options) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const opts = options && typeof options === 'object' ? options : {};
  const stationIds = Array.isArray(opts.stationIds) ? opts.stationIds : [];
  const stations = Array.isArray(opts.stations) ? opts.stations : [];
  const stationId = normalizeStationId(input.stationId, stationIds);
  const pickupCode = normalizePickupCode(input.pickupCode);
  const confidence = normalizeConfidence(input.confidence);
  return {
    stationId,
    stationName: resolveStationName(stationId, stations),
    pickupCode,
    trackingTail: normalizeTrackingTail(input.trackingTail),
    lockerNo: normalizeLockerNo(input.lockerNo),
    confidence,
    recognized: stationId !== '' && pickupCode !== '',
  };
}

/**
 * 合并服务端规则快照与模型结果：规则命中的字段优先，模型只补空位。
 * @param {object} ruleFields 服务端规则快照字段
 * @param {object} aiFields 归一后的模型字段
 * @returns {{fields: object, source: string}}
 */
function mergeFields(ruleFields, aiFields) {
  const rule = ruleFields && typeof ruleFields === 'object' ? ruleFields : {};
  const ai = aiFields && typeof aiFields === 'object' ? aiFields : {};
  const ruleStationId = typeof rule.stationId === 'string' ? rule.stationId : '';
  const rulePickupCode = typeof rule.pickupCode === 'string' ? rule.pickupCode : '';
  const aiStationId = typeof ai.stationId === 'string' ? ai.stationId : '';
  const aiPickupCode = typeof ai.pickupCode === 'string' ? ai.pickupCode : '';
  const stationId = ruleStationId || aiStationId;
  const pickupCode = rulePickupCode || aiPickupCode;
  const stationName = stationId === ruleStationId && ruleStationId
    ? (typeof rule.stationName === 'string' ? rule.stationName : '')
    : (typeof ai.stationName === 'string' ? ai.stationName : '');
  const trackingTail = (typeof rule.trackingTail === 'string' && rule.trackingTail)
    ? rule.trackingTail
    : (typeof ai.trackingTail === 'string' ? ai.trackingTail : '');
  const lockerNo = (typeof rule.lockerNo === 'string' && rule.lockerNo)
    ? rule.lockerNo
    : (typeof ai.lockerNo === 'string' ? ai.lockerNo : '');
  const fields = {
    stationId,
    stationName,
    pickupCode,
    trackingTail,
    lockerNo,
    confidence: typeof ai.confidence === 'string' ? ai.confidence : '',
  };
  let source = 'NONE';
  if (ruleStationId || rulePickupCode) {
    source = 'RULE';
  } else if (aiStationId || aiPickupCode) {
    source = 'DEEPSEEK';
  }
  return { fields, source };
}

module.exports = {
  CODE_RE,
  TAIL_RE,
  LOCKER_NO_MAX_LENGTH,
  CONFIDENCE_VALUES,
  DTO_KEYS,
  AI_SOURCE_DEEPSEEK,
  RECOGNITION_SOURCES,
  RECOGNITION_SOURCE_LABELS,
  recognitionSourceLabel,
  buildDegradedDto,
  parseJsonObject,
  normalizePickupCode,
  normalizeStationId,
  resolveStationName,
  normalizeTrackingTail,
  normalizeLockerNo,
  normalizeConfidence,
  normalizeAiFields,
  mergeFields,
};
