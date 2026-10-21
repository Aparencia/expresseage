// utils/recognize/codes.js · 取件码/柜号/尾号形态闸（单源；纯函数，零 wx）
// 口径（CONTRACT §3 + shared/validate.validatePickupCode 同源）：原始输入 ≤40；
// 去空格/连字符/下划线/# 后的「紧凑码」必须 4~12 位字母数字。识别层自动填只认紧凑码：
// 超长/带奇怪符号的候选标「认出但不像」，不自动填（提示文案沿用 FORM_ERROR.pickupCode）。
// 柜号 ≤10 字符串（值域不限）；运单尾号恰好 5 位数字。
'use strict';

// 原始输入上限（与服务端 validatePickupCode 的 PICKUP_CODE_MAX_RAW 同源）
const CODE_MAX = 40;
// 紧凑码上下限（与服务端 PICKUP_CODE_ALNUM_MIN/MAX 同源）
const CODE_COMPACT_MIN = 4;
const CODE_COMPACT_MAX = 12;
// 服务端 PICKUP_CODE_SEPARATOR：空格/连字符/下划线/井号在判紧凑码前整体去掉
const CODE_COMPACT_SEPARATOR = /[\s\-_#]/g;
const CODE_ALNUM = /^[0-9A-Za-z]+$/;
const LOCKER_MAX = 10;

function toHalfWidth(value) {
  let out = '';
  const str = String(value === undefined || value === null ? '' : value);
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += str.charAt(i);
  }
  return out;
}

function normalizeCode(raw) {
  return toHalfWidth(raw).trim().replace(/\s+/g, '');
}

// 紧凑形态：去掉服务端同款分隔符（空格/连字符/下划线/井号）后的字母数字串
function compactCode(raw) {
  return normalizeCode(raw).replace(CODE_COMPACT_SEPARATOR, '');
}

// 服务端闸：紧凑后 4~12 位字母数字（submit 前必须过；只做识别层复核，不改展示形态）
function isCompactCode(value) {
  const code = compactCode(value);
  if (code.length < CODE_COMPACT_MIN || code.length > CODE_COMPACT_MAX) return false;
  return CODE_ALNUM.test(code);
}

function isDateLike(value) {
  return /^(19|20)\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}日?$/.test(value);
}

function isPhoneLike(value) {
  return /^1[3-9]\d{9}$/.test(value);
}

/** 取件码展示形态闸：4~40 字符；必须含数字；不含竖排汉字；不像日期/手机号 */
function isPlausibleCode(value) {
  const code = normalizeCode(value);
  if (!code || code.length < 4 || code.length > CODE_MAX) return false;
  if (!/[0-9]/.test(code)) return false;
  if (!/^[0-9A-Za-z#*._-]+$/.test(code)) return false;
  if (/^[0-9A-Za-z]{1,3}$/.test(code)) return false;
  if (isDateLike(code) || isPhoneLike(code)) return false;
  if (/^\d{5}$/.test(code)) return false;
  return true;
}

/** 可自动填的码：展示闸 + 服务端紧凑闸都过（识别层不自动填「认出但不像」的候选） */
function isAutoFillCode(value) {
  return isPlausibleCode(value) && isCompactCode(value);
}

/** 候选打分：分段符/字母数字混合/常见长度更可信；用于同图多码排序 */
function scoreCode(value) {
  const code = normalizeCode(value);
  if (!isPlausibleCode(code)) return 0;
  let score = 10;
  if (/[-#*]/.test(code)) score += 6;
  if (/[A-Za-z]/.test(code) && /[0-9]/.test(code)) score += 4;
  if (code.length >= 6 && code.length <= 20) score += 4;
  if (/^\d+$/.test(code)) score -= 2;
  return score;
}

/**
 * 取件码候选（形态闸通过的全部候选，含 compact 标记）。
 * @returns {Array<{value:string, score:number, line:string, compact:boolean}>}
 */
function pickCodeCandidates(lines) {
  const tokens = [];
  (lines || []).forEach(function each(line) {
    const parts = String(line).split(/[\s,，;；、|:：()（）【】\[\]]+/);
    parts.forEach(function add(part) {
      const token = normalizeCode(part);
      if (!token) return;
      const score = scoreCode(token);
      if (score > 0) tokens.push({ value: token, score: score, line: line, compact: isCompactCode(token) });
    });
  });
  const seen = Object.create(null);
  const unique = [];
  tokens.forEach(function each(item) {
    if (seen[item.value]) return;
    seen[item.value] = true;
    unique.push(item);
  });
  unique.sort(function sort(a, b) { return b.score - a.score; });
  return unique;
}

/** 自动填候选：只保留紧凑码可提交的（超长候选由调用方标"认出但不像"） */
function pickCodes(lines) {
  return pickCodeCandidates(lines)
    .filter(function compact(item) { return item.compact; })
    .map(function strip(item) {
      return { value: item.value, score: item.score, line: item.line };
    });
}

/** 柜号归一：只做全角/空白归一，不截断（长度由 isPlausibleLocker 先判原长，不静默改数据） */
function normalizeLocker(raw) {
  return toHalfWidth(raw).replace(/\s+/g, '');
}

/** 柜号形态闸：先判归一后原长 1~10，再谈使用（>10 必须报行内错误，不许截断后放行） */
function isPlausibleLocker(value) {
  const text = normalizeLocker(value);
  return text.length > 0 && text.length <= LOCKER_MAX;
}

function normalizeTail(raw) {
  const text = toHalfWidth(raw).replace(/\D/g, '');
  return text.length === 5 ? text : '';
}

function isPlausibleTail(value) {
  return normalizeTail(value) !== '';
}

/** 派生 codeStatus：码过紧凑闸为 OK；无码有尾号 NEED_CODE；都无不可提交 */
function deriveCodeStatus(pickupCode, trackingTail) {
  if (isAutoFillCode(pickupCode)) return 'OK';
  if (isPlausibleTail(trackingTail)) return 'NEED_CODE';
  return 'NONE';
}

module.exports = {
  CODE_MAX,
  CODE_COMPACT_MIN,
  CODE_COMPACT_MAX,
  LOCKER_MAX,
  normalizeCode,
  compactCode,
  isCompactCode,
  isAutoFillCode,
  normalizeLocker,
  normalizeTail,
  isPlausibleCode,
  isPlausibleLocker,
  isPlausibleTail,
  scoreCode,
  pickCodeCandidates,
  pickCodes,
  deriveCodeStatus
};
