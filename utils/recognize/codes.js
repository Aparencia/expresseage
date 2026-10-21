// utils/recognize/codes.js · 取件码/柜号/尾号形态闸（单源；纯函数，零 wx）
// 口径：码 ≤40、柜号 ≤10 字符串（值域不限）、运单尾号恰好 5 位数字（CONTRACT §3）。
'use strict';

const CODE_MAX = 40;
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

function isDateLike(value) {
  return /^(19|20)\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}日?$/.test(value);
}

function isPhoneLike(value) {
  return /^1[3-9]\d{9}$/.test(value);
}

/** 取件码形态闸：4~40 字符；必须含数字；不含竖排汉字；不像日期/手机号 */
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

function pickCodes(lines) {
  const tokens = [];
  (lines || []).forEach(function each(line) {
    const parts = String(line).split(/[\s,，;；、|:：()（）【】\[\]]+/);
    parts.forEach(function add(part) {
      const token = normalizeCode(part);
      if (!token) return;
      const score = scoreCode(token);
      if (score > 0) tokens.push({ value: token, score: score, line: line });
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

function normalizeLocker(raw) {
  const text = toHalfWidth(raw).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length > LOCKER_MAX) return text.slice(0, LOCKER_MAX);
  return text;
}

function isPlausibleLocker(value) {
  const text = normalizeLocker(value);
  return text.length <= LOCKER_MAX;
}

function normalizeTail(raw) {
  const text = toHalfWidth(raw).replace(/\D/g, '');
  return text.length === 5 ? text : '';
}

function isPlausibleTail(value) {
  return normalizeTail(value) !== '';
}

/** 派生 codeStatus：有码 OK；无码有尾号 NEED_CODE；都无不可提交 */
function deriveCodeStatus(pickupCode, trackingTail) {
  if (isPlausibleCode(pickupCode)) return 'OK';
  if (isPlausibleTail(trackingTail)) return 'NEED_CODE';
  return 'NONE';
}

module.exports = {
  CODE_MAX,
  LOCKER_MAX,
  normalizeCode,
  normalizeLocker,
  normalizeTail,
  isPlausibleCode,
  isPlausibleLocker,
  isPlausibleTail,
  scoreCode,
  pickCodes,
  deriveCodeStatus
};
