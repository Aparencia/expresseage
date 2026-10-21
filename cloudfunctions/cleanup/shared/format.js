// shared/format.js · 展示格式化纯件（时间 / 文本截断 / 锚+键行）
// 契约：docs/V4_CONTRACT.md v0.9 §3「时间以 serverTime 为准」、§8「锚+键配对」；
//       docs/ENGINEERING §5.8（v3 锚+键展示同口径）。编号展示唯一实现在 utils/ids.js
//       （ENGINEERING §5.3），本文件不再拼一遍编号格式，避免两份口径。
// 调用方：订单列表/详情、消息中心、客户档案行（锚+键）、后台列表时间列。
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR_SEPARATOR = ' · ';

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function toMillis(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// 'YYYY-MM-DD'
function formatDate(value) {
  const ms = toMillis(value);
  if (!ms) {
    return '';
  }
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// 'HH:mm'
function formatTime(value) {
  const ms = toMillis(value);
  if (!ms) {
    return '';
  }
  const date = new Date(ms);
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

// 'YYYY-MM-DD HH:mm'
function formatDateTime(value) {
  const date = formatDate(value);
  const time = formatTime(value);
  if (!date || !time) {
    return '';
  }
  return date + ' ' + time;
}

// 相对时间：今天 14:23 / 昨天 09:10 / 10-19 14:23 / 2025-12-01（serverNow 由服务端下发）
function formatRelative(value, serverNow) {
  const ms = toMillis(value);
  if (!ms) {
    return '';
  }
  const now = toMillis(serverNow);
  if (!now) {
    return formatDateTime(ms);
  }
  const dayDelta = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  const clock = formatTime(ms);
  if (dayDelta === 0) {
    return '今天 ' + clock;
  }
  if (dayDelta === 1) {
    return '昨天 ' + clock;
  }
  const date = new Date(ms);
  if (dayDelta > 1 && dayDelta < 365) {
    return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + clock;
  }
  return formatDate(ms) + ' ' + clock;
}

// 文本截断（按码点计，保留可读性；不用于落库，落库前由 shared/validate 拒绝超限）
function truncate(text, max) {
  if (typeof text !== 'string') {
    return '';
  }
  const chars = Array.from(text);
  if (!max || chars.length <= max) {
    return text;
  }
  if (max <= 1) {
    return chars.slice(0, max).join('');
  }
  return chars.slice(0, max - 1).join('') + '…';
}

// 锚+键行：['D4-522A', '尾号6678', '小王'] → 'D4-522A · 尾号6678 · 小王'（空段自动跳过）
function anchorLine(parts) {
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '')
    .join(ANCHOR_SEPARATOR);
}

// 尾号展示：'6678' → '尾号6678'；空/非 4 位 → ''
function tailLabel(phoneTail) {
  if (typeof phoneTail !== 'string' || !/^[0-9]{4}$/.test(phoneTail)) {
    return '';
  }
  return '尾号' + phoneTail;
}

module.exports = {
  ANCHOR_SEPARATOR,
  pad2,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelative,
  truncate,
  anchorLine,
  tailLabel
};
