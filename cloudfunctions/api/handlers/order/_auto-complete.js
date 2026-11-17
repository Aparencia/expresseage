// handlers/order/_auto-complete.js · D91：送达即完成 + 读路径补完成（判据单源 = shared/auto-complete.js）
// 契约：docs/contract/V4_CONTRACT.md §5（DELIVERED→COMPLETED）/§13 D91；docs/data/V4_DATA_MODEL.md §5.2/§7.5。
// 为什么在 api 侧做：
//   ①「该时刻（默认 22:30）之后送达即完成」——送达请求本身就能判定，不必等 10 分钟日结批（用户 2026-11-17 裁决）；
//   ②cleanup 的 10 分钟定时触发器属用户控制台配置项，未配/漏跑时送达单会永久停在「已送达」——读路径兜底补完成，
//     与既有 D58「读到即落库」（_transfer-expire.js）同一模式，保证任何一方打开订单都能看到真实终态。
// 并发安全：与日结批同样的「事务内条件更新」——where 带 version + status=DELIVERED，未命中即他端已推进，
//           本次零写零事件（不覆盖别人的状态，也不重复写 AUTO_COMPLETED）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const autoComplete = require('../../shared/auto-complete');
const defaults = require('../../shared/defaults');
const store = require('./_store');

const SYSTEM = 'SYSTEM';
// 单次读请求最多补完成 5 单：读路径是热路径，其余单由下一次读/日结批继续收敛（不放大单请求耗时）。
const READ_PATH_COMPLETE_LIMIT = 5;

// 日结批时刻文本（UTC+8 HH:MM）：配置缺失/非法回退出厂默认（唯一默认常量在 config/defaults）。
function clockTextOf(ctx) {
  const config = ctx && ctx.config ? ctx.config : {};
  return defaults.normalizeClockText(config.autoCompleteAt) || defaults.DEFAULT_CONFIG.autoCompleteAt;
}

function versionOf(order) {
  const value = order && order.version;
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : 1;
}

// 时间归一：number/Date/可解析字符串 → 毫秒，其余/空 → 0（与 cleanup sweeps/_util.msOf 同口径）。
// 不能用 time.toMs：它对 null/非法值回落 Date.now()，会把「缺 deliveredAt 的脏 DELIVERED 单」当成刚送达。
function msOf(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

// 送达时刻（锚 deliveredAt；缺时间戳的脏数据回落 statusUpdatedAt，与 cleanup sweeps/orders.js 同口径）
function deliveredAtOf(order) {
  return msOf(order && order.deliveredAt) || msOf(order && order.statusUpdatedAt);
}

function isDelivered(order) {
  return !!order && order.status === enums.ORDER_STATUS.DELIVERED;
}

// 订单是否已到日结时刻（now ≥ 该单送达日的日结时刻）
function isDueOrder(ctx, order, nowMs) {
  if (!isDelivered(order)) {
    return false;
  }
  return autoComplete.isDue(nowMs, deliveredAtOf(order), clockTextOf(ctx));
}

// 送达即完成（D91）：送达时刻本身已过当日日结时刻 → 本次送达直接算完成。
// 送达时刻 = now（markDelivered 刚写入 deliveredAt），因此等价于「今天该时刻已到」。
function isDueAtDelivery(ctx, nowMs) {
  return autoComplete.isDue(nowMs, nowMs, clockTextOf(ctx));
}

function completionPatchOf(order, nowDate) {
  return {
    status: enums.ORDER_STATUS.COMPLETED,
    completedAt: nowDate,
    statusUpdatedAt: nowDate,
    updatedAt: nowDate,
    version: versionOf(order) + 1
  };
}

// AUTO_COMPLETED 事件与 cleanup 日结批逐字段同形（actorRole/actorId/payload.scheduledBy），
// 客户端凭证卡只按 type 渲染「系统自动完成」；requestKey 按订单+版本派生，一次完成只落一条。
function autoCompletedEventOf(order, nowDate, version) {
  return {
    orderId: order._id,
    orderNo: order.orderNo || '',
    type: 'AUTO_COMPLETED',
    fromStatus: enums.ORDER_STATUS.DELIVERED,
    toStatus: enums.ORDER_STATUS.COMPLETED,
    actorRole: enums.CANCELLED_BY.SYSTEM,
    actorId: SYSTEM,
    impersonatedBy: order.impersonatedBy || '',
    at: nowDate,
    note: '',
    payload: { scheduledBy: SYSTEM },
    requestKey: [String(order._id), 'AUTO_COMPLETED', String(version)].join(':')
  };
}

// markDelivered 的事务内钩子（spec.after 入参）：当日已到日结时刻时，同一事务把订单推进到 COMPLETED。
// 未到时刻 / 条件未命中（他端已推进）一律零写，送达本身不受影响。
async function completeOnDelivery(params) {
  const input = params || {};
  const order = input.order;
  if (!order || !input.trx || !isDueAtDelivery(input.ctx, input.now)) {
    return;
  }
  const version = versionOf(order);
  const nowDate = input.nowDate;
  const patch = Object.assign({}, completionPatchOf(order, nowDate), { version: version + 2 });
  const written = await input.trx.updateWhere(COLLECTIONS.ORDERS, {
    _id: order._id,
    version: version + 1,
    status: enums.ORDER_STATUS.DELIVERED
  }, patch);
  if (!written || !written.updated) {
    return;
  }
  await input.trx.add(COLLECTIONS.ORDER_EVENTS, autoCompletedEventOf(order, nowDate, version + 2));
}

// 读路径补完成（单条）：返回最新订单对象（补完成成功 → 内存同步 COMPLETED 视图，不再二次读库）。
// 条件更新未命中（他端已推进）时返回原对象：不伪造一个本端没有写入的 COMPLETED 视图。
async function completeIfDue(ctx, order, nowMs) {
  if (!isDueOrder(ctx, order, nowMs)) {
    return order;
  }
  const nowDate = store.toDate(nowMs);
  const patch = completionPatchOf(order, nowDate);
  let changed = false;
  try {
    await ctx.dao.transaction(async (trx) => {
      const written = await trx.updateWhere(COLLECTIONS.ORDERS, {
        _id: order._id,
        version: versionOf(order),
        status: enums.ORDER_STATUS.DELIVERED
      }, patch);
      if (!written || !written.updated) {
        return;
      }
      changed = true;
      await trx.add(COLLECTIONS.ORDER_EVENTS, autoCompletedEventOf(order, nowDate, patch.version));
    });
  } catch (error) {
    // 并发补完成：另一请求已推进（唯一 requestKey 冲突 / 条件更新落空）→ 本次静默，不改变本次读结果。
    if (!(ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error))) {
      throw error;
    }
    return order;
  }
  return changed ? Object.assign({}, order, patch) : order;
}

// 读路径补完成（列表页）：行对象原地更新（同一份引用，页/summary/scan 行同时生效），最多 5 单。
async function completeDueRows(ctx, rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  let completed = 0;
  for (let i = 0; i < list.length && completed < READ_PATH_COMPLETE_LIMIT; i += 1) {
    const row = list[i];
    if (!isDueOrder(ctx, row, nowMs)) {
      continue;
    }
    const next = await completeIfDue(ctx, row, nowMs);
    if (next === row) {
      continue;
    }
    Object.assign(row, next);
    completed += 1;
  }
  return completed;
}

module.exports = {
  completeOnDelivery,
  completeIfDue,
  completeDueRows
};
