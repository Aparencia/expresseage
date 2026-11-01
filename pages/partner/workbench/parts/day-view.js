// pages/partner/workbench/parts/day-view.js · UTC+8 自然日 / 下单日归档 / 顺延标签纯件（零 wx）
// 口径：CONTRACT §13 D45（形态 M1）——已完结区按订单 `createdAt`（UTC+8 自然日）归档 + 进行中行
//       「顺延 N 天」标签；进行中仍站点分组/四档动线不变；服务端零改动、不建索引、不新增页。
//       UX_PARTNER §4.10（分区锚=下单日）/§4.15（顺延文案）。
// 单源：UTC+8 日界公式只在本文件（原重复在 parts/history-view.js 与 index.js；cloudfunctions/api/lib/time.js
//       是服务端副本，本轮服务端零改动不动）。页面/其它纯件只消费，不自行算日。
// 说明：已完结行的 `completedAt`/`cancelledAt` 仍用于展示与统计，但**不能**当分区锚（research §3.1）。
'use strict';

const orderView = require('../../../../shared/order-view');

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 未完成桶（shared/order-view.js）：只有这些桶的跨日单才标顺延；DELIVERED（待确认）与 history 不标
const ACTIVE_BUCKETS = ['submitted', 'accepted', 'picked', 'exception'];
const DAY_KEYS = ['today', 'yesterday', 'earlier'];
const DAY_TEXT = { today: '今天', yesterday: '昨天', earlier: '更早' };

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// UTC+8 自然日 0 点（与云端 lib/time 同口径；不读本机时区）
function dayStartMs(nowMs) {
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  return now - ((now + TZ_OFFSET_MS) % DAY_MS);
}

function yesterdayStartMs(nowMs) {
  return dayStartMs(nowMs) - DAY_MS;
}

// 任意时刻 → 自然日桶（'today'/'yesterday'/'earlier'）；无效时刻归「更早」，不伪造今天
function dayKeyOf(ms, nowMs) {
  const value = typeof ms === 'number' && isFinite(ms) ? ms : 0;
  const todayStart = dayStartMs(nowMs);
  if (value >= todayStart) {
    return 'today';
  }
  if (value >= todayStart - DAY_MS) {
    return 'yesterday';
  }
  return 'earlier';
}

// UTC+8 日期文案（MM-DD）：只给分节标题用，跨日不变形
function dayDateTextOf(ms) {
  const value = typeof ms === 'number' && isFinite(ms) && ms > 0 ? ms : 0;
  if (!value) {
    return '';
  }
  const date = new Date(value + TZ_OFFSET_MS);
  return pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

// UTC+8 日期键（YYYY-MM-DD）：与统计页「今日完成」跳转参数 completedDate 同口径
function dayDateKeyOf(ms) {
  const value = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
  return new Date(value + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

// 统计页「今日完成」跳入参数：只接受 YYYY-MM-DD（其它/非法一律忽略，不改既有行为）
const COMPLETED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function focusDateOf(options) {
  const value = options && typeof options.completedDate === 'string' ? options.completedDate : '';
  return COMPLETED_DATE_RE.test(value) ? value : '';
}

// 订单下单时刻（毫秒）：视图行带 createdMs；DTO 用 createdAt（ISO 串/毫秒/Date 均兼容）。
// 缺失/非法 → 0（分区时归「更早」，顺延不标；不编造时间）
function createdMsOf(order) {
  const item = order || {};
  if (typeof item.createdMs === 'number' && isFinite(item.createdMs) && item.createdMs > 0) {
    return item.createdMs;
  }
  const raw = item.createdAt;
  if (typeof raw === 'number') {
    return isFinite(raw) && raw > 0 ? raw : 0;
  }
  if (raw instanceof Date) {
    const dateMs = raw.getTime();
    return Number.isNaN(dateMs) ? 0 : dateMs;
  }
  if (typeof raw === 'string' && raw) {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// 行/订单的桶：优先服务端 bucket，兼容只有 status 的旧形状（不读七状态字面量，走 shared/order-view）
function bucketOf(order) {
  const item = order || {};
  const bucket = typeof item.bucket === 'string' ? item.bucket.trim() : '';
  if (bucket) {
    return bucket;
  }
  return typeof item.status === 'string' && item.status ? orderView.bucketOf(item.status) : '';
}

function isActiveBucket(bucket) {
  return ACTIVE_BUCKETS.indexOf(bucket) >= 0;
}

// 顺延天数：N = 今天 0 点 − 下单日 0 点（自然日）；只对未完成桶、且下单日早于今天；
// 已送达/已完结/无 createdAt/当日单/时钟偏差 → 0（不标）
function delayDaysOf(order, nowMs) {
  const item = order || {};
  if (!isActiveBucket(bucketOf(item))) {
    return 0;
  }
  const createdMs = createdMsOf(item);
  if (!createdMs) {
    return 0;
  }
  const todayStart = dayStartMs(nowMs);
  if (createdMs >= todayStart) {
    return 0;
  }
  return Math.round((todayStart - dayStartMs(createdMs)) / DAY_MS);
}

// 「顺延 N 天」文案单源（页面/wxml 只渲染字段，不拼字面量）
function delayTextOf(days) {
  const count = typeof days === 'number' && isFinite(days) && days > 0 ? Math.floor(days) : 0;
  return count > 0 ? '顺延 ' + count + ' 天' : '';
}

// 行标签：空串表示不标（wxml 用 wx:if 判空，不再判状态/日期）
function delayDaysTextOf(order, nowMs) {
  return delayTextOf(delayDaysOf(order, nowMs));
}

// 已完结分节：按 createdAt 归「今天/昨天/更早」，节内按 createdAt 倒序；
// 返回 [{key,label,dateText,count,rows}]（今天/昨天标题带日期，更早不造日期），空节不返回
function sectionsOf(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  const buckets = { today: [], yesterday: [], earlier: [] };
  list
    .map((row, index) => ({ row: row, index: index, createdMs: createdMsOf(row) }))
    .sort((left, right) => (right.createdMs - left.createdMs) || (left.index - right.index))
    .forEach((entry) => {
      buckets[dayKeyOf(entry.createdMs, now)].push(entry.row);
    });
  return DAY_KEYS.map((key) => {
    const dayRows = buckets[key];
    const newest = dayRows.length ? createdMsOf(dayRows[0]) : 0;
    const dateText = key === 'earlier' ? '' : dayDateTextOf(newest);
    return {
      key: key,
      label: dateText ? DAY_TEXT[key] + ' · ' + dateText : DAY_TEXT[key],
      dateText: dateText,
      count: dayRows.length,
      rows: dayRows
    };
  }).filter((section) => section.count > 0);
}

module.exports = {
  TZ_OFFSET_MS,
  DAY_MS,
  dayStartMs,
  yesterdayStartMs,
  dayKeyOf,
  dayDateKeyOf,
  focusDateOf,
  createdMsOf,
  delayDaysTextOf,
  sectionsOf
};
