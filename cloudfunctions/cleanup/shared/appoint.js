// shared/appoint.js · 预约方式纯件（D47「最晚可接受时间」LATEST；SLOT 仅历史订单展示）
// 口径：docs/contract/V4_CONTRACT.md §5.2/D47、docs/data/V4_DATA_MODEL.md §2.5。
// 边界：客户端只据此生成选项/预选与提示；服务端 normalizeLatestAt 是唯一权威校验（非法一律 VALIDATION_FAILED）。
// 时间基准：预约时刻一律按 UTC+8 的毫秒时间戳表达；云函数进程 TZ=UTC，故本文件全部显式 +8h 换算，
//   不调用本地时区 API（getHours/getMonth 在 UTC 进程里会错 8 小时）。
'use strict';

const enums = require('./enums');

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// D47 硬约束：30 分钟粒度、≤7 天、最小提前 30 分钟
const STEP_MINUTES = 30;
const MAX_DAYS = 7;
const MIN_LEAD_MINUTES = 30;
const PRESET_TIMES = ['12:00', '18:00', '22:00'];
// 新单不可选 SLOT（仅历史单展示）：预填/热重载拿到 SLOT 时降级为「尽快」并提示
const SLOT_DOWNGRADE_COPY = '「预约时段」已改为「最晚时间」，本单按「尽快」处理';
const LATEST_NOTE_COPY = '最晚时间只表达你的期望：不改变兼职接单时限，到点未送达也不会自动取消';
const INVALID_LATEST_COPY = '请选择 30 分钟后、7 天内的 30 分钟整点（如 18:30）';
const OVERDUE_COPY = '已超过最晚时间，兼职仍在处理（不会自动取消）';
const STEP_MS = STEP_MINUTES * MINUTE_MS;
const MAX_LATEST_MS = MAX_DAYS * DAY_MS;
const MIN_LEAD_MS = MIN_LEAD_MINUTES * MINUTE_MS;
// 到点标红只看「还没送到」的进行中状态；已送达/终态/异常不标红（异常本身有提示条）
const OVERDUE_STATUSES = [enums.ORDER_STATUS.SUBMITTED, enums.ORDER_STATUS.ACCEPTED, enums.ORDER_STATUS.PICKED];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// number/Date/非空字符串 → 毫秒（>0 才算「有时间」）；非法一律 0，不回落 Date.now()
function toMs(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// UTC+8 的日期分量（不依赖进程本地时区）
function partsOf(ms) {
  if (!ms) return null;
  const date = new Date(ms + TZ_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

// 'HH:MM'
function clockText(ms) {
  const parts = partsOf(ms);
  return parts ? pad2(parts.hour) + ':' + pad2(parts.minute) : '';
}

// 'YYYY-MM-DD'
function dateText(ms) {
  const parts = partsOf(ms);
  return parts ? parts.year + '-' + pad2(parts.month) + '-' + pad2(parts.day) : '';
}

// 'M月D日'
function dayText(ms) {
  const parts = partsOf(ms);
  return parts ? parts.month + '月' + parts.day + '日' : '';
}

// '最晚 M月D日 HH:MM'（详情/确认页与 DTO text 单源）
function latestText(ms) {
  if (!ms) return '';
  return '最晚 ' + dayText(ms) + ' ' + clockText(ms);
}

// 30 分钟对齐：整数毫米时间戳 % 30min == 0（UTC+8 与 UTC 相差整小时，对齐边界一致）
function isStepAligned(ms) {
  return isFinite(ms) && ms > 0 && ms % STEP_MS === 0;
}

// 'YYYY-MM-DD' + 'HH:MM'（UTC+8）→ 毫秒；非法返回 0。
// 日历日回算：Date.UTC 会把不存在的日期静默归一下一月（2026-02-30 → 2026-03-02），
// 回算年月日不一致即视为非法日期，避免把非法值当合法最晚时间上送/展示。
function dateTimeMs(dateValue, clockValue) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(textOf(dateValue));
  const clockMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(textOf(clockValue));
  if (!dateMatch || !clockMatch) return 0;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const minute = Number(clockMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || minute % STEP_MINUTES !== 0) return 0;
  const ms = Date.UTC(year, month - 1, day, Number(clockMatch[1]), minute) - TZ_OFFSET_MS;
  const back = new Date(ms + TZ_OFFSET_MS);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) {
    return 0;
  }
  return ms;
}

// 服务端权威校验（D47）：必须是 30 分钟整点，且在 [now+30min, now+7d] 内。合法返回毫秒，非法返回 0。
function normalizeLatestAt(value, nowMs) {
  const ms = toMs(value);
  if (!isStepAligned(ms)) return 0;
  const now = typeof nowMs === 'number' && isFinite(nowMs) && nowMs > 0 ? nowMs : 0;
  if (!now) return 0;
  if (ms < now + MIN_LEAD_MS) return 0;
  if (ms > now + MAX_LATEST_MS) return 0;
  return ms;
}

// 订单快照里的 latestAt（读路径/历史回看）：只要求值合法且 30 分钟对齐，不再按「当前时间」判过期
function latestAtOf(appoint) {
  const input = isPlainObject(appoint) ? appoint : {};
  if (textOf(input.type) !== enums.APPOINT_TYPE.LATEST) return 0;
  const ms = toMs(input.latestAt);
  return isStepAligned(ms) ? ms : 0;
}

// 展示文案：尽快 / 最晚 M月D日 HH:MM / 预约时段（历史 SLOT）
function appointTextOf(appoint) {
  const input = isPlainObject(appoint) ? appoint : {};
  const type = textOf(input.type);
  if (type === enums.APPOINT_TYPE.LATEST) {
    const ms = latestAtOf(input);
    return ms ? latestText(ms) : enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.LATEST];
  }
  if (type === enums.APPOINT_TYPE.SLOT) {
    return textOf(input.typeText) || enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.SLOT];
  }
  return enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.ASAP];
}

// 新单选值域只有 ASAP/LATEST；SLOT（历史）与未知值一律降级为 ASAP
function normalizeType(value) {
  return textOf(value) === enums.APPOINT_TYPE.LATEST ? enums.APPOINT_TYPE.LATEST : enums.APPOINT_TYPE.ASAP;
}

function wasSlot(value) {
  return textOf(value) === enums.APPOINT_TYPE.SLOT;
}

// 日期选项：今天/明天/其后按「M月D日」；值域 ≤7 天（含今天共 8 个自然日，服务端按 now+7d 收紧）
function dayOptions(nowMs) {
  const base = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
  if (!base) return [];
  const list = [];
  for (let offset = 0; offset <= MAX_DAYS; offset += 1) {
    const ms = base + offset * DAY_MS;
    const label = offset === 0 ? '今天' : (offset === 1 ? '明天' : dayText(ms));
    list.push({ value: dateText(ms), label: label });
  }
  return list;
}

// 时间选项：00:00~23:30 共 48 个（30 分钟粒度）；预设 12:00/18:00/22:00 只是快捷入口
function timeOptions() {
  const list = [];
  for (let minute = 0; minute < 24 * 60; minute += STEP_MINUTES) {
    const value = pad2(Math.floor(minute / 60)) + ':' + pad2(minute % 60);
    list.push({ value: value, label: value });
  }
  return list;
}

function timeIndexOf(clockValue) {
  const value = textOf(clockValue);
  const list = timeOptions();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].value === value) return i;
  }
  return -1;
}

// 预选：今天最近的有效预设；当天预设全过 → 明天起的最近预设；再不行 → 30 分钟粒度扫描
function suggestOf(nowMs) {
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
  const fallback = { date: '', time: '' };
  if (!now) return fallback;
  for (let offset = 0; offset <= MAX_DAYS; offset += 1) {
    for (let i = 0; i < PRESET_TIMES.length; i += 1) {
      const dateValue = dateText(now + offset * DAY_MS);
      const ms = dateTimeMs(dateValue, PRESET_TIMES[i]);
      if (ms && normalizeLatestAt(ms, now)) return { date: dateValue, time: PRESET_TIMES[i] };
    }
  }
  const times = timeOptions();
  for (let offset = 0; offset <= MAX_DAYS; offset += 1) {
    const dateValue = dateText(now + offset * DAY_MS);
    for (let i = 0; i < times.length; i += 1) {
      const ms = dateTimeMs(dateValue, times[i].value);
      if (ms && normalizeLatestAt(ms, now)) return { date: dateValue, time: times[i].value };
    }
  }
  return fallback;
}

// 最晚日期上界：今天+7 天（picker mode=date 的 end；服务端仍按 now+7*24h 收紧）
function maxDateText(nowMs) {
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
  return now ? dateText(now + MAX_DAYS * DAY_MS) : '';
}

// 客户端 UI 状态（顾客下单页/代客下单页同一模型）：{type,date,time} + 派生展示字段
function createState(nowMs, currentType) {
  const suggestion = suggestOf(nowMs);
  const state = {
    type: normalizeType(currentType),
    date: suggestion.date,
    time: suggestion.time,
    notice: wasSlot(currentType) ? SLOT_DOWNGRADE_COPY : ''
  };
  return refreshState(state, nowMs);
}

function refreshState(state, nowMs) {
  const source = isPlainObject(state) ? state : {};
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
  const date = textOf(source.date);
  const clock = textOf(source.time);
  const ms = dateTimeMs(date, clock);
  const valid = ms ? normalizeLatestAt(ms, now) : 0;
  const type = normalizeType(source.type);
  const dayHit = dayOptions(now).filter(function match(item) { return item.value === date; })[0];
  const latest = valid ? latestText(ms) : '';
  return {
    type: type,
    date: date,
    time: clock,
    timeIndex: timeIndexOf(clock),
    dateText: dayHit ? dayHit.label : (ms ? dayText(ms) : ''),
    latestAt: ms,
    latestText: latest,
    summary: type === enums.APPOINT_TYPE.LATEST
      ? (latest || enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.LATEST])
      : enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.ASAP],
    error: type === enums.APPOINT_TYPE.LATEST && !valid ? INVALID_LATEST_COPY : '',
    notice: textOf(source.notice),
    minDate: now ? dateText(now) : '',
    maxDate: maxDateText(now),
    days: dayOptions(now),
    times: timeOptions(),
    presets: PRESET_TIMES.slice(),
    note: LATEST_NOTE_COPY
  };
}

function setType(state, type, nowMs) {
  const source = isPlainObject(state) ? state : {};
  const next = Object.assign({}, source, { type: normalizeType(type), notice: '' });
  if (next.type === enums.APPOINT_TYPE.LATEST) {
    const current = dateTimeMs(source.date, source.time);
    if (!current || !normalizeLatestAt(current, nowMs)) {
      const suggestion = suggestOf(nowMs);
      next.date = suggestion.date;
      next.time = suggestion.time;
    }
  }
  return refreshState(next, nowMs);
}

function setDate(state, dateValue, nowMs) {
  const source = isPlainObject(state) ? state : {};
  const next = Object.assign({}, source, { date: textOf(dateValue) });
  if (!textOf(next.time)) next.time = suggestOf(nowMs).time;
  return refreshState(next, nowMs);
}

function setTime(state, clockValue, nowMs) {
  const source = isPlainObject(state) ? state : {};
  const next = Object.assign({}, source, { time: textOf(clockValue) });
  if (!textOf(next.date)) next.date = suggestOf(nowMs).date;
  return refreshState(next, nowMs);
}

// 快捷预设：只改时间；若当天该时刻已不合法，把日期顺延到最近合法日（用户点一下就有合法值）
function pickPreset(state, clockValue, nowMs) {
  const source = isPlainObject(state) ? state : {};
  const clock = textOf(clockValue);
  const next = Object.assign({}, source, { date: textOf(source.date), time: clock });
  const current = dateTimeMs(next.date, clock);
  if (!current || !normalizeLatestAt(current, nowMs)) {
    const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
    for (let offset = 0; offset <= MAX_DAYS && now; offset += 1) {
      const dateValue = dateText(now + offset * DAY_MS);
      const ms = dateTimeMs(dateValue, clock);
      if (ms && normalizeLatestAt(ms, now)) {
        next.date = dateValue;
        break;
      }
    }
  }
  return refreshState(next, nowMs);
}

// 提交载荷：ASAP 不填时间；LATEST 必带 latestAt（UTC+8 ISO 串，服务端再校验）
function payloadOf(state, nowMs) {
  const source = isPlainObject(state) ? state : {};
  if (normalizeType(source.type) !== enums.APPOINT_TYPE.LATEST) {
    return { type: enums.APPOINT_TYPE.ASAP };
  }
  const ms = dateTimeMs(source.date, source.time);
  if (!ms) return { type: enums.APPOINT_TYPE.LATEST, latestAt: '' };
  return { type: enums.APPOINT_TYPE.LATEST, latestAt: isoOf(ms) };
}

// 'YYYY-MM-DDTHH:MM:00+08:00'
function isoOf(ms) {
  if (!ms) return '';
  return dateText(ms) + 'T' + clockText(ms) + ':00+08:00';
}

function summaryOf(state) {
  const source = isPlainObject(state) ? state : {};
  if (normalizeType(source.type) !== enums.APPOINT_TYPE.LATEST) {
    return enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.ASAP];
  }
  return textOf(source.latestText) || enums.APPOINT_TYPE_TEXT[enums.APPOINT_TYPE.LATEST];
}

// 提交内容指纹片段：预约变更（含同一「最晚时间」改到另一刻）必须换幂等键
function fingerprintOf(state) {
  const source = isPlainObject(state) ? state : {};
  const type = normalizeType(source.type);
  if (type !== enums.APPOINT_TYPE.LATEST) return type;
  return type + '|' + textOf(source.date) + '|' + textOf(source.time);
}

// Step3 → Step4 本地闸（服务端仍唯一权威）：只挡必失败的 LATEST
function validateOf(state, nowMs) {
  const source = isPlainObject(state) ? state : {};
  if (normalizeType(source.type) !== enums.APPOINT_TYPE.LATEST) {
    return { ok: true, reason: '' };
  }
  const ms = dateTimeMs(source.date, source.time);
  if (!ms || !normalizeLatestAt(ms, nowMs)) {
    return { ok: false, reason: INVALID_LATEST_COPY };
  }
  return { ok: true, reason: '' };
}

// 详情/确认页展示（顾客与兼职同口径）：时间文案 + 到点未送达标红（纯展示，不改状态、不自动取消）
function viewOf(appoint, status, nowMs) {
  const input = isPlainObject(appoint) ? appoint : {};
  const type = textOf(input.type) || enums.APPOINT_TYPE.ASAP;
  const ms = type === enums.APPOINT_TYPE.LATEST ? latestAtOf(input) : 0;
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0;
  const overdue = ms > 0 && now > 0 && OVERDUE_STATUSES.indexOf(textOf(status)) >= 0 && now > ms;
  return {
    type: type,
    isLatest: type === enums.APPOINT_TYPE.LATEST,
    isSlot: type === enums.APPOINT_TYPE.SLOT,
    latestAt: ms,
    latestText: ms ? latestText(ms) : '',
    text: appointTextOf(input),
    overdue: overdue,
    overdueText: overdue ? OVERDUE_COPY : ''
  };
}

// 历史单兼容：老订单只有 type/startAt/endAt（SLOT）或只有 type（ASAP）
function slotRangeTextOf(appoint) {
  const input = isPlainObject(appoint) ? appoint : {};
  if (textOf(input.type) !== enums.APPOINT_TYPE.SLOT) return '';
  const start = toMs(input.startAt);
  const end = toMs(input.endAt);
  const startClock = clockText(start);
  const endClock = clockText(end);
  return [startClock, endClock].filter(Boolean).join('-');
}

module.exports = {
  STEP_MINUTES: STEP_MINUTES,
  MAX_DAYS: MAX_DAYS,
  MIN_LEAD_MINUTES: MIN_LEAD_MINUTES,
  PRESET_TIMES: PRESET_TIMES,
  SLOT_DOWNGRADE_COPY: SLOT_DOWNGRADE_COPY,
  LATEST_NOTE_COPY: LATEST_NOTE_COPY,
  INVALID_LATEST_COPY: INVALID_LATEST_COPY,
  OVERDUE_COPY: OVERDUE_COPY,
  toMs: toMs,
  clockText: clockText,
  dateText: dateText,
  dayText: dayText,
  latestText: latestText,
  isStepAligned: isStepAligned,
  dateTimeMs: dateTimeMs,
  normalizeLatestAt: normalizeLatestAt,
  latestAtOf: latestAtOf,
  appointTextOf: appointTextOf,
  normalizeType: normalizeType,
  wasSlot: wasSlot,
  dayOptions: dayOptions,
  timeOptions: timeOptions,
  timeIndexOf: timeIndexOf,
  suggestOf: suggestOf,
  maxDateText: maxDateText,
  isoOf: isoOf,
  createState: createState,
  refreshState: refreshState,
  setType: setType,
  setDate: setDate,
  setTime: setTime,
  pickPreset: pickPreset,
  payloadOf: payloadOf,
  summaryOf: summaryOf,
  fingerprintOf: fingerprintOf,
  validateOf: validateOf,
  viewOf: viewOf,
  slotRangeTextOf: slotRangeTextOf,
};
