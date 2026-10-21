// handlers/partner/_customer.js · 兼职客户域公共件（批 7：listBindings/getCustomer/stats/unbind/saveNote 共用）
// 口径：DATA_MODEL §7.4 表格 + 「批 7 兼职客户与运营（只增不改语义）」、§4.5（dormKey 自然序）、
//       §5.2（客户列表排序/进行中单）、§5.3（游标分页/扫描上限）、§2.3/§2.4；UX_PARTNER §3.5/§3.6/§3.8。
// 纪律：所有订单查询都带 partnerId 归属 + 测试数据隔离谓词；本文件不感知「视角分支」，身份由中间件解析。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const zones = require('../../shared/zones');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');

// 分页：limit 缺省 20、最大 50（DATA_MODEL §7.4）；客户列表一次扫描 ≤100 条（§5.2）。
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_BINDINGS = 100;
// 单状态订单扫描上限：防止全表扫描（§5.3）；档位与 order.listPartner 的 300 条扫描窗一致。
const MAX_ORDER_SCAN = 300;
const KEYWORD_MAX_CHARS = 40;
const DAY_MS = time.DAY_MS;
// 自然日/周/月时区口径：lib/time 固定 UTC+8（serverTime 派生），与 orderNo 日期部分同源。
const TZ_OFFSET_MS = time.TZ_OFFSET_MS;
const SERIES_DAYS = 7;
const RECENT_LIMIT = 10;
const KEYWORD_SEPARATOR = /[\s-]/g;
const WEEK_START_DAY = 6; // 周一起：UTC 0=周日，偏移 (day+6)%7

function scopeOf(ctx) {
  return identity.scopeOf(ctx);
}

function nowMsOf(ctx) {
  return identity.nowMs(ctx);
}

// 测试数据隔离（DATA_MODEL §6.6）：真实会话只看 isTest=false；TEST_WRITE 会话只看 isTest=true。
function isTestScope(ctx) {
  return scopeOf(ctx).testWrite;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 时间归一：null/undefined/''/非法一律归 0（「没有这个时间」不能变成当前真实时钟）。
function msOf(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const ms = time.toMs(value);
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

function isoOf(value) {
  const ms = msOf(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function sameId(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }
  return String(left) === String(right);
}

function parseLimit(payload) {
  const raw = Number(payload && payload.limit);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(raw), MAX_PAGE_SIZE);
}

// 搜索词：空=不过滤；超长/非串拒绝（静默忽略会让「搜了但没筛」变成全量返回）。
function readKeyword(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('keyword', '搜索词不正确，请重新输入');
  }
  const text = value.trim();
  if (text.length > KEYWORD_MAX_CHARS) {
    throw errors.validation('keyword', '搜索词过长，请缩短后重试');
  }
  return text;
}

// 时间范围入参：接受 epoch 毫秒或 ISO 字符串；非法值不静默降级为「无限制」。
function parseTimeBound(value, field) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms) || ms <= 0) {
    throw errors.validation(field, '时间范围不正确，请刷新页面后重试');
  }
  return ms;
}

// ── 绑定归属：bindingId 必须属于当前兼职（不属于/不存在一律 FORBIDDEN，不泄露存在性）──────
async function requireOwnedBinding(ctx, partner, bindingId) {
  const id = textOf(bindingId);
  if (!id) {
    throw errors.validation('bindingId', '绑定关系参数不正确，请刷新页面后重试');
  }
  const binding = await ctx.dao.get(COLLECTIONS.BINDINGS, id);
  if (!binding || !sameId(binding.partnerId, partner._id)) {
    throw errors.forbidden('绑定关系不存在或不属于你');
  }
  return binding;
}

// ── 进行中单（解绑守卫 / listBindings.activeOrderCount / getCustomer 同源口径）──────────
function activeOrderBase(ctx, partnerId) {
  return { partnerId, isTest: isTestScope(ctx) };
}

async function countActiveOrders(ctx, partnerId, customerId) {
  const base = activeOrderBase(ctx, partnerId);
  let total = 0;
  for (let i = 0; i < enums.ORDER_ACTIVE_STATUSES.length; i += 1) {
    const where = Object.assign({}, base, { status: enums.ORDER_ACTIVE_STATUSES[i] });
    if (customerId) {
      where.customerId = customerId;
    }
    total += await ctx.dao.count(COLLECTIONS.ORDERS, { where });
  }
  return total;
}

// 一次按状态取进行中单再按顾客分组（避免逐顾客 N+1）；guest 单 customerId='' 天然不归属顾客。
async function activeCountByCustomer(ctx, partnerId) {
  const base = activeOrderBase(ctx, partnerId);
  const counts = {};
  for (let i = 0; i < enums.ORDER_ACTIVE_STATUSES.length; i += 1) {
    const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: Object.assign({}, base, { status: enums.ORDER_ACTIVE_STATUSES[i] }),
      limit: MAX_ORDER_SCAN
    });
    rows.forEach((row) => {
      const key = textOf(row.customerId);
      if (key) {
        counts[key] = (counts[key] || 0) + 1;
      }
    });
  }
  return counts;
}

// ── 客户档案行 / 关键词匹配（DATA_MODEL §7.4：昵称/楼栋/宿舍/roomTag/尾号四位/customerNo）──
function customerRowOf(binding, customer, activeOrderCount) {
  return bindCommon.partnerBindingRow(binding, customer, activeOrderCount);
}

function matchKeyword(row, keyword) {
  if (!keyword) {
    return true;
  }
  const word = keyword.toLowerCase();
  const compact = word.replace(KEYWORD_SEPARATOR, '');
  const fields = [
    row.displayName,
    row.dormKey,
    row.roomTag,
    row.buildingText,
    row.phoneTail
  ];
  for (let i = 0; i < fields.length; i += 1) {
    if (textOf(fields[i]).toLowerCase().indexOf(word) >= 0) {
      return true;
    }
  }
  // 编号按「去空格/连字符」比较：页面展示 C-XXXX-XXXX，库内是 CXXXXXXXX。
  const customerNo = textOf(row.customerNo).toLowerCase();
  return customerNo !== '' && compact !== '' && customerNo.indexOf(compact) >= 0;
}

// ── 客户列表游标：只编码排序锚（dormKey 自然序 + allocSeq=绑定顺序），不含任何 openid ────
function parseBindingCursor(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  const dormKey = textOf(value.dormKey);
  const allocSeq = Number(value.allocSeq);
  if (!dormKey || !Number.isFinite(allocSeq) || allocSeq < 0) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  return { dormKey, allocSeq };
}

function allocSeqOf(binding) {
  const seq = Number(binding && binding.allocSeq);
  return Number.isFinite(seq) && seq >= 0 ? seq : 0;
}

function entryKey(entry) {
  return { dormKey: entry.row.dormKey || '', allocSeq: entry.allocSeq };
}

// 排序：dormKey 自然序（苑固定序 D→X→N→B→C、楼栋序、宿舍号数字序）→ 同宿舍 allocSeq（=roomTag 大写字母序）。
function compareBindingEntries(left, right) {
  const delta = zones.compareDormKey(entryKey(left).dormKey, entryKey(right).dormKey);
  if (delta !== 0) {
    return delta;
  }
  return left.allocSeq - right.allocSeq;
}

function isAfterBindingCursor(entry, cursor) {
  if (!cursor) {
    return true;
  }
  return zones.compareDormKey(entryKey(entry).dormKey, cursor.dormKey) > 0
    || (zones.compareDormKey(entryKey(entry).dormKey, cursor.dormKey) === 0 && entry.allocSeq > cursor.allocSeq);
}

function bindingCursorOf(entry) {
  const key = entryKey(entry);
  if (!key.dormKey) {
    return null;
  }
  return { dormKey: key.dormKey, allocSeq: key.allocSeq };
}

// ── 订单行（getCustomer 历史订单；只回展示所需字段，不含取件码/宿舍/尾号/openid）─────────
function orderRowOf(order) {
  const doc = order || {};
  const status = textOf(doc.status);
  const service = doc.service || {};
  const row = {
    orderNo: textOf(doc.orderNo),
    status,
    statusText: enums.orderStatusText(status),
    serviceName: textOf(service.name) || enums.serviceNameOf(textOf(service.code)),
    createdAt: isoOf(doc.createdAt)
  };
  if (msOf(doc.deliveredAt)) {
    row.deliveredAt = isoOf(doc.deliveredAt);
  }
  if (msOf(doc.completedAt)) {
    row.completedAt = isoOf(doc.completedAt);
  }
  if (msOf(doc.cancelledAt)) {
    row.cancelledAt = isoOf(doc.cancelledAt);
  }
  return row;
}

// 历史订单时间锚：完成/取消时间优先，进行中用 statusUpdatedAt（from/to 过滤与 order.listPartner 同口径）。
function orderAnchorMs(order) {
  return msOf(order && order.completedAt) || msOf(order && order.cancelledAt)
    || msOf(order && order.statusUpdatedAt);
}

function statusUpdatedMs(order) {
  return msOf(order && order.statusUpdatedAt);
}

function compareOrderNoDesc(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? 1 : -1;
}

function compareOrderRowsDesc(left, right) {
  const delta = statusUpdatedMs(right) - statusUpdatedMs(left);
  if (delta !== 0) {
    return delta;
  }
  return compareOrderNoDesc(textOf(right.orderNo), textOf(left.orderNo));
}

function inTimeRange(valueMs, fromMs, toMs) {
  if (fromMs && valueMs < fromMs) {
    return false;
  }
  if (toMs && valueMs > toMs) {
    return false;
  }
  return true;
}

// getCustomer 订单游标：{sortValue, orderNo}，客户端原样回传（不透明，不含任何 openid）。
function parseOrderCursor(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  const sortValue = Number(value.sortValue);
  const orderNo = textOf(value.orderNo);
  if (!Number.isFinite(sortValue) || sortValue <= 0 || !orderNo) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  return { sortValue, orderNo };
}

function isAfterOrderCursor(order, cursor) {
  if (!cursor) {
    return true;
  }
  const sortValue = statusUpdatedMs(order);
  if (sortValue !== cursor.sortValue) {
    return sortValue < cursor.sortValue;
  }
  return textOf(order.orderNo) < cursor.orderNo;
}

function orderCursorOf(order) {
  const sortValue = statusUpdatedMs(order);
  if (!sortValue) {
    return null;
  }
  return { sortValue, orderNo: textOf(order.orderNo) };
}

// 该顾客在本兼职名下的订单：按状态分桶取（每桶命中 (partnerId,status) 索引），再内存排序分页。
async function loadCustomerOrders(ctx, partnerId, customerId) {
  const rows = [];
  for (let i = 0; i < enums.ORDER_STATUS_LIST.length; i += 1) {
    const part = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: {
        partnerId,
        customerId,
        status: enums.ORDER_STATUS_LIST[i],
        isTest: isTestScope(ctx)
      },
      orderBy: [['statusUpdatedAt', 'desc'], ['orderNo', 'desc']],
      limit: MAX_ORDER_SCAN
    });
    part.forEach((row) => rows.push(row));
  }
  return rows;
}

// 统计用：本兼职全部订单（排除 isTest），按状态桶取，终态用各自时间索引排序。
async function loadPartnerOrders(ctx, partnerId) {
  const rows = [];
  for (let i = 0; i < enums.ORDER_STATUS_LIST.length; i += 1) {
    const status = enums.ORDER_STATUS_LIST[i];
    let sortField = 'statusUpdatedAt';
    if (status === enums.ORDER_STATUS.COMPLETED) {
      sortField = 'completedAt';
    } else if (status === enums.ORDER_STATUS.CANCELLED) {
      sortField = 'cancelledAt';
    }
    const part = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: { partnerId, status, isTest: false },
      orderBy: [[sortField, 'desc'], ['orderNo', 'desc']],
      limit: MAX_ORDER_SCAN
    });
    part.forEach((row) => rows.push(row));
  }
  return rows;
}

// ── 自然日/周（周一起）/月窗口（serverTime + UTC+8，与 lib/time.dayKey 同源）───────────
function shiftedDate(ms) {
  return new Date(time.toMs(ms) + TZ_OFFSET_MS);
}

function dayStartMs(nowMs) {
  const ms = time.toMs(nowMs);
  return ms - ((ms + TZ_OFFSET_MS) % DAY_MS);
}

function weekStartMs(nowMs) {
  const day = shiftedDate(nowMs).getUTCDay();
  const offset = (day + WEEK_START_DAY) % 7;
  return dayStartMs(nowMs) - offset * DAY_MS;
}

function monthStartMs(nowMs) {
  const date = shiftedDate(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - TZ_OFFSET_MS;
}

function rangeStartMs(range, nowMs) {
  if (range === 'week') {
    return weekStartMs(nowMs);
  }
  if (range === 'month') {
    return monthStartMs(nowMs);
  }
  return dayStartMs(nowMs);
}

function dayKeyOf(ms) {
  const date = shiftedDate(ms);
  return String(date.getUTCFullYear()) + '-' + time.pad2(date.getUTCMonth() + 1) + '-' + time.pad2(date.getUTCDate());
}

function dayLabelOf(ms) {
  const date = shiftedDate(ms);
  return time.pad2(date.getUTCMonth() + 1) + '-' + time.pad2(date.getUTCDate());
}

// 近 7 个自然日（最早→今天，固定 7 项、缺日补 0）；countAt(startMs) 返回该自然日完成数。
function buildSeries(nowMs, countAt) {
  const todayStart = dayStartMs(nowMs);
  const list = [];
  for (let offset = SERIES_DAYS - 1; offset >= 0; offset -= 1) {
    const start = todayStart - offset * DAY_MS;
    list.push({
      date: dayKeyOf(start),
      label: dayLabelOf(start),
      completed: countAt(start) || 0
    });
  }
  return list;
}

function inWindow(valueMs, startMs, endMs) {
  return valueMs > 0 && valueMs >= startMs && valueMs <= endMs;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_BINDINGS,
  MAX_ORDER_SCAN,
  SERIES_DAYS,
  RECENT_LIMIT,
  DAY_MS,
  scopeOf,
  nowMsOf,
  isTestScope,
  textOf,
  msOf,
  isoOf,
  sameId,
  parseLimit,
  readKeyword,
  parseTimeBound,
  requireOwnedBinding,
  countActiveOrders,
  activeCountByCustomer,
  customerRowOf,
  matchKeyword,
  parseBindingCursor,
  allocSeqOf,
  compareBindingEntries,
  isAfterBindingCursor,
  bindingCursorOf,
  orderRowOf,
  orderAnchorMs,
  statusUpdatedMs,
  compareOrderRowsDesc,
  inTimeRange,
  parseOrderCursor,
  isAfterOrderCursor,
  orderCursorOf,
  loadCustomerOrders,
  loadPartnerOrders,
  dayStartMs,
  weekStartMs,
  monthStartMs,
  rangeStartMs,
  dayKeyOf,
  dayLabelOf,
  buildSeries,
  inWindow
};
