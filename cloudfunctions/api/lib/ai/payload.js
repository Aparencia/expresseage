'use strict';

/**
 * AI 识别兜底 · 外发 payload 白名单（单源）。
 *
 * 口径：CONTRACT v0.9 §4.3 / ENGINEERING §4.10.3
 * - 外发键集合必须恰好落在 AI_PAYLOAD_KEYS 内；多键/少键/手拼 body 均判缺陷。
 * - 云函数内做二次去敏（客户端去敏只是第一道，服务端不信任客户端）。
 * - 只发去敏文本；不发原图、不发业务身份键、不发订单归属。
 * - 本文件不访问数据库、不感知身份，只做纯文本处理与白名单构造。
 */

/** 外发 payload 唯一键集合（顺序即构造顺序）。 */
const AI_PAYLOAD_KEYS = Object.freeze(['ocrTextMasked', 'hintTrackingTail', 'role']);

/** OCR 文本入参与外发上限（CONTRACT §4.3）。 */
const MAX_OCR_TEXT_LENGTH = 2000;

/** 业务角色值域。 */
const ROLE_VALUES = Object.freeze(['CUSTOMER', 'PARTNER']);

/** 运单尾号形制：恰好 5 位 ASCII 数字。 */
const TAIL_RE = /^\d{5}$/;

/* ------------------------------------------------------------------ *
 * 二次去敏：手机号 / 身份证 / 连续长数字 / 详细门牌 / 收件人姓名行
 * ------------------------------------------------------------------ */

const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const ID_CARD_RE = /(?<![\dXx])\d{17}[\dXx](?![\dXx])/g;
const LONG_DIGITS_RE = /\d{11,}/g;
// v1.1/D35：取件码上下文行里的 4~12 位码是识别必需信息，不能整体打码；只打码 ≥13 位运单长数字
const CODE_LINE_RE = /(?:取件码|取货码|提货码|取件|提货)/;
const CODE_LONG_RUN_RE = /(?<!\d)\d{13,}(?!\d)/g;
const DORM_KEY_RE = /(?<![0-9A-Za-z])[A-Z]\d{0,2}-\d{3,4}[A-Z]{0,2}(?![0-9A-Za-z])/g;
const ROOM_DETAIL_RE = /(\d{3,4})(?=\s*(?:室|房|号房|房间))/g;
const NAME_LINE_RE = /((?:收件人|收货人|联系人|姓名)\s*[：:]?\s*)[^\s，,。；;：:]{1,20}/g;
const INVISIBLE_RE = /[\u200b-\u200f\u2028\u2029\ufeff]/g;

function maskPhoneSegment(match) {
  return match.slice(0, 3) + '****' + match.slice(7);
}

function maskCodeLine(line) {
  let out = line.replace(PHONE_RE, maskPhoneSegment);
  out = out.replace(ID_CARD_RE, '***');
  out = out.replace(CODE_LONG_RUN_RE, '***');
  out = out.replace(DORM_KEY_RE, '***');
  out = out.replace(ROOM_DETAIL_RE, '***');
  return out.replace(NAME_LINE_RE, '$1**');
}

function maskPlainLine(line) {
  let out = line.replace(PHONE_RE, maskPhoneSegment);
  out = out.replace(ID_CARD_RE, '***');
  out = out.replace(LONG_DIGITS_RE, '***');
  out = out.replace(DORM_KEY_RE, '***');
  out = out.replace(ROOM_DETAIL_RE, '***');
  return out.replace(NAME_LINE_RE, '$1**');
}

/**
 * 对 OCR 文本做服务端二次去敏。
 * 保留站点名/取件码/柜号等识别必需信息；掩码联系方式与详细门牌。
 * v1.1/D35：取件码行里的 4~12 位码保留（AI/规则归一需要它），手机号/门牌/运单长数字照常打码。
 * @param {string} text 原始（客户端已去过敏的）OCR 文本
 * @returns {string} 去敏后的文本（未截断）
 */
function maskSensitiveText(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }
  const out = text.replace(INVISIBLE_RE, '')
    .split('\n')
    .map(function eachLine(line) {
      return CODE_LINE_RE.test(line) ? maskCodeLine(line) : maskPlainLine(line);
    })
    .join('\n');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 构造唯一外发 payload（AI_PAYLOAD_KEYS 白名单）。
 * @param {{ocrTextMasked: string, hintTrackingTail?: string, role: string}} input
 * @returns {{ocrTextMasked: string, hintTrackingTail?: string, role: string}}
 */
function buildAiPayload(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const role = String(raw.role || '').toUpperCase();
  if (ROLE_VALUES.indexOf(role) < 0) {
    throw new TypeError('ai payload role must be CUSTOMER or PARTNER');
  }
  const masked = maskSensitiveText(String(raw.ocrTextMasked == null ? '' : raw.ocrTextMasked));
  const payload = { ocrTextMasked: masked.slice(0, MAX_OCR_TEXT_LENGTH) };
  const hint = raw.hintTrackingTail == null ? '' : String(raw.hintTrackingTail).trim();
  if (TAIL_RE.test(hint)) {
    payload.hintTrackingTail = hint;
  }
  payload.role = role;
  return payload;
}

/**
 * 断言 payload 键集合严格落在白名单内且必填键齐全。
 * @param {object} payload
 * @returns {boolean}
 */
function assertPayloadKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i += 1) {
    if (AI_PAYLOAD_KEYS.indexOf(keys[i]) < 0) {
      return false;
    }
  }
  return typeof payload.ocrTextMasked === 'string' && ROLE_VALUES.indexOf(payload.role) >= 0;
}

module.exports = {
  AI_PAYLOAD_KEYS,
  MAX_OCR_TEXT_LENGTH,
  ROLE_VALUES,
  maskSensitiveText,
  buildAiPayload,
  assertPayloadKeys,
};
