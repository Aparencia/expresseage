// pkg-customer/parts/format.js · 时间/倒计时展示（纯函数，零 wx）
'use strict';

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).replace(/-/g, '/');
  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function formatTimeAgo(value, now) {
  const date = toDate(value);
  if (!date) return '';
  const current = now ? toDate(now) : new Date();
  const diff = current.getTime() - date.getTime();
  if (diff < 0) return formatDateTime(date);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  if (date >= today) return pad(date.getHours()) + ':' + pad(date.getMinutes());
  if (date >= new Date(today.getTime() - day)) return '昨天 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  return formatDateTime(date);
}

/** 剩余时长：{text, urgent, expired} */
function countdown(deadline, now) {
  const end = toDate(deadline);
  const current = now ? toDate(now) : new Date();
  if (!end) return { text: '', urgent: false, expired: false };
  const diff = end.getTime() - current.getTime();
  if (diff <= 0) return { text: '00:00', urgent: true, expired: true };
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const text = (hours > 0 ? pad(hours) + ':' : '') + pad(minutes) + ':' + pad(seconds);
  return { text: text, urgent: diff < 10 * 60 * 1000, expired: false };
}

module.exports = {
  pad,
  toDate,
  formatDateTime,
  formatTimeAgo,
  countdown
};
