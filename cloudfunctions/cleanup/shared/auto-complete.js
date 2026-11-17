// shared/auto-complete.js · 送达单自动完成时刻判据（D91：UTC+8 日结批 22:30 + 该时刻后送达即完成）
// 契约：docs/contract/V4_CONTRACT.md §5/§13 D91；docs/data/V4_DATA_MODEL.md §5.2。
// 单源：cleanup 日结批（逐单 cutoff 扫描）与 api「送达即完成 / 读路径补完成」共用本判据，不各写一份公式。
// 依赖纪律：本文件零 require（根副本与 cloudfunctions/*/shared 副本逐字节一致；时刻文本归一由调用方做，
//           统一走 config/defaults.normalizeClockText + DEFAULT_CONFIG.autoCompleteAt 回落）。
// 时区：显式 UTC+8 偏移换算，不读本机时区（云函数时区不可控），也不复用本地 setHours（历史漂移点）。
'use strict';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

// UTC+8 自然日 0 点（毫秒）：floor 到日界后再减回偏移，得到该日 00:00 的绝对毫秒。
function localDayStartOf(msValue) {
  return Math.floor((msValue + UTC8_OFFSET_MS) / DAY_MS) * DAY_MS - UTC8_OFFSET_MS;
}

// 每单 cutoff =「该单送达日所在 UTC+8 自然日的 HH:MM」；只由送达日决定，不随 now 漂移。
// clockText 必须是已归一的 'HH:MM'（调用方负责回落默认）；非法/缺失返回 0（永不到期，fail-closed 不误完成）。
function cutoffOf(deliveredAtMs, clockText) {
  const text = typeof clockText === 'string' ? clockText.trim() : '';
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(3, 5));
  if (text.length !== 5 || text.charAt(2) !== ':' || !isFinite(hours) || !isFinite(minutes)) {
    return 0;
  }
  if (hours > 23 || minutes > 59) {
    return 0;
  }
  return localDayStartOf(deliveredAtMs) + (hours * 60 + minutes) * MINUTE_MS;
}

// 到期判据：注入的 now 已到（含等号）该单送达日的日结时刻即完成。
// 送达即完成（D91）= 送达时刻本身已过当日日结时刻，即 isDue(now, now, clockText)。
function isDue(nowMs, deliveredAtMs, clockText) {
  if (typeof nowMs !== 'number' || !isFinite(nowMs) || nowMs <= 0) {
    return false;
  }
  if (typeof deliveredAtMs !== 'number' || !isFinite(deliveredAtMs) || deliveredAtMs <= 0) {
    return false;
  }
  const cutoff = cutoffOf(deliveredAtMs, clockText);
  return cutoff > 0 && nowMs >= cutoff;
}

module.exports = {
  cutoffOf,
  isDue
};
