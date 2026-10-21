// pkg-admin/common/format.js · 后台页面纯展示格式化（零 wx、零业务判据）
// 时间一律按服务端时间轴展示；编号/昵称等敏感字段的脱敏由服务端 DTO 完成，这里只处理展示形态。

function pad2(value) {
  const text = String(value);
  return text.length >= 2 ? text : '0' + text;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const text = value.indexOf('T') >= 0 ? value : value.replace(/-/g, '/');
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof value.$date === 'number') {
    return new Date(value.$date);
  }
  return null;
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return '—';
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
    ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function formatClock(value) {
  const date = toDate(value);
  if (!date) return '—';
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function textOrDash(value) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function numOrZero(value) {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

function maskInvitationCode(code) {
  const raw = String(code || '').replace(/[^0-9A-Za-z]/g, '');
  if (!raw) return '';
  return '****-****-' + raw.slice(-4);
}

function joinParts(parts, separator) {
  const text = (parts || []).filter(function (item) {
    return item !== undefined && item !== null && item !== '';
  });
  return text.join(separator || ' · ');
}

module.exports = {
  formatTime,
  formatClock,
  textOrDash,
  numOrZero,
  maskInvitationCode,
  joinParts
};
