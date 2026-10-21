// lib/time.js · 服务端时间换算纯件（单请求的 nowMs 由 app.js 统一注入）
// 口径：orderNo / failureNo 的日期部分使用服务器 UTC+8 自然日；时间戳统一为 epoch 毫秒。
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TZ_OFFSET_MS = 8 * HOUR_MS;

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function toMs(value) {
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return Date.now();
}

function dayKey(nowMs) {
  const date = new Date(toMs(nowMs) + TZ_OFFSET_MS);
  return String(date.getUTCFullYear()) + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate());
}

function addMinutes(nowMs, minutes) {
  return toMs(nowMs) + minutes * MINUTE_MS;
}

function addHours(nowMs, hours) {
  return toMs(nowMs) + hours * HOUR_MS;
}

function addDays(nowMs, days) {
  return toMs(nowMs) + days * DAY_MS;
}

// 生产数据里的 expiresAt 可能是 Date（createInvites/activate）或可解析字符串；统一归一为毫秒。
// 无值/非法一律归 0（isPast 对 <=0 恒 false，保持"没有期限不算过期"的既有 number 语义）。
function deadlineMsOf(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }
  if (value instanceof Date) {
    return isFinite(value.getTime()) ? value.getTime() : 0;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isPast(deadlineMs, nowMs) {
  const deadline = deadlineMsOf(deadlineMs);
  if (deadline <= 0) {
    return false;
  }
  return deadline <= toMs(nowMs);
}

function elapsedMs(startMs, endMs) {
  return Math.max(0, toMs(endMs) - toMs(startMs));
}

module.exports = {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  TZ_OFFSET_MS,
  pad2,
  toMs,
  dayKey,
  addMinutes,
  addHours,
  addDays,
  isPast,
  elapsedMs
};
