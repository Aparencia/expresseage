// handlers/order/_transfer.js · D58 转派共用件：入参/守卫 / 惰性过期 / 事件 / 幂等键 / 限流 / 视图剪裁
// 契约：CONTRACT §13 D58 行 + DATA_MODEL §2.5 `orders.transfer`（8 子键 / 5 状态 / 5 解决原因）+ 批 26 草案 §1.2~§1.4。
// 边界：纯件优先（resolvePendingTransferOf/blockOf/isTargetOf 零 IO）；唯一"读到即落库"的惰性过期入口 = expireIfNeeded。
// 不出现数据库直连调用（数据访问唯一入口 = db/dao）；单函数 ≤50 行；四个动作 handler 只做各自的守卫/事务编排，共性全部在这里。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const defaults = require('../../shared/defaults');
const store = require('./_store');

const STATUS = enums.TRANSFER_STATUS;
const REASON = enums.TRANSFER_RESOLVE_REASON;
const RATE_SCOPE = 'transfer';
const MAX_TTL_MINUTES = 60;
const MINUTE_MS = time.MINUTE_MS;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function numberOrZero(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function sameId(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }
  return String(left) === String(right);
}

// 时间归一：number/Date/可解析字符串 → 毫秒；其余/空 → 0（'' = 没有这个时间）。
// 不能用 time.toMs：它对非 number/Date 回落 Date.now()，会把"已清空的时间"变成假时间。
function dateMsOf(value) {
  if (typeof value === 'number' && isFinite(value)) {
    return value > 0 ? value : 0;
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

function isoOf(value) {
  const ms = dateMsOf(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

// ── config 单源：读不到才用出厂默认（config/defaults.js），不写死数字 ──────────────
function ttlMinutesOf(config) {
  const raw = config && Number(config.transferTtlMinutes);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), MAX_TTL_MINUTES);
  }
  return defaults.DEFAULT_CONFIG.transferTtlMinutes;
}

function rateLimitsOf(config) {
  const source = (config && config.transferRate) || defaults.DEFAULT_CONFIG.transferRate || {};
  return { perMinute: numberOrZero(source.perMinute), perDay: numberOrZero(source.perDay) };
}

// ── 限流窗口键（CONTRACT §10 转派 scope；UTC+8）：分钟桶 wYYYYMMDDHHmm / 日桶 dYYYYMMDD ──
function minuteKeyOf(nowMs) {
  const date = new Date(time.toMs(nowMs) + time.TZ_OFFSET_MS);
  return 'w' + String(date.getUTCFullYear()) + time.pad2(date.getUTCMonth() + 1)
    + time.pad2(date.getUTCDate()) + time.pad2(date.getUTCHours()) + time.pad2(date.getUTCMinutes());
}

function dayKeyOf(nowMs) {
  return 'd' + time.dayKey(nowMs);
}

async function incrementCounter(ctx, key, nowDate) {
  return ctx.dao.transaction(async (trx) => {
    const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
    if (!row) {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowDate });
      return 1;
    }
    const seq = numberOrZero(row.seq) + 1;
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowDate });
    return seq;
  });
}

// 发起/确认/拒收/撤回共用同一 rl:transfer:{effectiveOpenid} 桶（失败尝试也计数，与 middleware/ratelimit 同形）。
async function consumeRate(ctx, config) {
  const subject = store.scopeOf(ctx).openid;
  if (!subject) {
    return;
  }
  const nowMs = store.nowMsOf(ctx);
  const nowDate = store.toDate(nowMs);
  const limits = rateLimitsOf(config);
  const buckets = [
    { key: 'rl:' + RATE_SCOPE + ':' + subject + ':' + minuteKeyOf(nowMs), limit: limits.perMinute },
    { key: 'rl:' + RATE_SCOPE + ':' + subject + ':' + dayKeyOf(nowMs), limit: limits.perDay }
  ];
  for (let i = 0; i < buckets.length; i += 1) {
    if (!(buckets[i].limit > 0)) {
      continue;
    }
    const used = await incrementCounter(ctx, buckets[i].key, nowDate);
    if (used > buckets[i].limit) {
      throw errors.rateLimited();
    }
  }
}

// ── transfer 块读取（旧订单无字段 ⇒ null，零迁移） ──────────────────────────────
function transferOf(order) {
  const value = order && order.transfer;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isPending(order) {
  const block = transferOf(order);
  return !!block && block.status === STATUS.PENDING;
}

function expiresAtMsOf(order) {
  const block = transferOf(order);
  return block ? dateMsOf(block.expiresAt) : 0;
}

function isExpired(order, nowMs) {
  if (!isPending(order)) {
    return false;
  }
  const deadline = expiresAtMsOf(order);
  return deadline > 0 && time.toMs(nowMs) > deadline;
}

// D61 件级取件：任一件已取即禁止发起转派（不落计数字段，逐件派生判定）
function hasPickedAny(order) {
  const picked = require('./_picked');
  return store.orderParcelsOf(order).some((parcel) => picked.isPickedOf(order, parcel));
}

// 目标兼职判定：transfer.toPartnerId = 目标本人（不是订单当前 partnerId）
function isTargetOf(order, partnerId, statuses) {
  const block = transferOf(order);
  if (!block || !sameId(block.toPartnerId, partnerId)) {
    return false;
  }
  const allow = Array.isArray(statuses) ? statuses : [STATUS.PENDING, STATUS.ACCEPTED];
  return allow.indexOf(block.status) >= 0;
}

function isPendingTargetOf(order, partnerId) {
  return isTargetOf(order, partnerId, [STATUS.PENDING]);
}

// ── DTO 可见性矩阵（草案 §1.4）：顾客仅 ACCEPTED 后见 status/toPartnerNo；双方见 7 键；admin 5 键 ──
function blockOf(order, relation) {
  const block = transferOf(order);
  if (!block) {
    return null;
  }
  if (relation === 'CUSTOMER') {
    if (block.status !== STATUS.ACCEPTED) {
      return null;
    }
    return { status: textOf(block.status), toPartnerNo: textOf(block.toPartnerNo) };
  }
  if (relation === 'ADMIN') {
    return {
      status: textOf(block.status),
      fromPartnerNo: textOf(block.fromPartnerNo),
      toPartnerNo: textOf(block.toPartnerNo),
      expiresAt: isoOf(block.expiresAt),
      resolveReason: textOf(block.resolveReason)
    };
  }
  if (relation !== 'PARTNER') {
    return null;
  }
  return {
    status: textOf(block.status),
    fromPartnerNo: textOf(block.fromPartnerNo),
    toPartnerNo: textOf(block.toPartnerNo),
    requestedAt: isoOf(block.requestedAt),
    expiresAt: isoOf(block.expiresAt),
    resolvedAt: isoOf(block.resolvedAt),
    resolveReason: textOf(block.resolveReason)
  };
}

// ── 事件 ─────────────────────────────────────────────────────────────────────
function requestKeyOf(order, action, clientRequestId) {
  return [String(order._id), action, clientRequestId].join(':');
}

async function findActionEvent(ctx, requestKey) {
  return ctx.dao.findOne(COLLECTIONS.ORDER_EVENTS, { where: { requestKey } });
}

function buildTransferEvent(order, options) {
  // 延迟 require：_common 反向依赖本文件做"订单离开 ACCEPTED"过期钩子，顶层 require 会成环
  const common = require('./_common');
  const opts = options || {};
  return common.buildEventDocument({
    orderId: order._id,
    orderNo: order.orderNo,
    type: opts.type,
    fromStatus: order.status,
    toStatus: order.status,
    actorRole: opts.actorRole,
    actorId: opts.actorId || '',
    impersonatedBy: opts.impersonatedBy || '',
    at: opts.at,
    note: '',
    payload: opts.payload || {},
    requestKey: opts.requestKey
  });
}

// 四个写动作的事件（actorRole 恒 PARTNER；TRANSFER_EXPIRED 的系统过期事件由 resolvePendingTransferOf 走 SYSTEM）
function actionEventOf(ctx, order, options) {
  const opts = options || {};
  const scope = store.scopeOf(ctx);
  return buildTransferEvent(order, {
    type: opts.type,
    actorRole: enums.ROLES.PARTNER,
    actorId: scope.openid,
    impersonatedBy: scope.impersonatedBy,
    at: opts.nowDate,
    payload: opts.payload,
    requestKey: requestKeyOf(order, opts.action, opts.clientRequestId)
  });
}

// 规范化的 8 子键 transfer 块（整值替换写入用；只改 status/resolvedAt/resolveReason）
function withResolutionOf(block, status, nowDate, reason) {
  return {
    status,
    fromPartnerId: textOf(block.fromPartnerId),
    fromPartnerNo: textOf(block.fromPartnerNo),
    toPartnerId: textOf(block.toPartnerId),
    toPartnerNo: textOf(block.toPartnerNo),
    requestedAt: block.requestedAt,
    expiresAt: block.expiresAt,
    resolvedAt: nowDate,
    resolveReason: reason
  };
}

// 纯件：把 PENDING 邀请落终态并给出事件文档。返回 null = 无 PENDING（幂等安全，重复调用不再产生事件）。
// status 只允许 CANCELLED/EXPIRED；requestKey 确定性 = {orderId}:transfer.{status}:{requestedAt 毫秒}。
function resolvePendingTransferOf(order, options) {
  if (!isPending(order)) {
    return null;
  }
  const opts = options || {};
  const block = transferOf(order);
  const status = opts.status === STATUS.CANCELLED ? STATUS.CANCELLED : STATUS.EXPIRED;
  let reason = textOf(opts.reason);
  if (!reason) {
    reason = status === STATUS.CANCELLED ? REASON.FROM_CANCELLED : REASON.EXPIRED;
  }
  const nowDate = opts.nowDate || store.toDate(store.nowMsOf({ now: opts.nowMs }));
  const next = withResolutionOf(block, status, nowDate, reason);
  const stamp = dateMsOf(block.requestedAt);
  const event = buildTransferEvent(order, {
    type: status === STATUS.CANCELLED ? 'TRANSFER_CANCELLED' : 'TRANSFER_EXPIRED',
    actorRole: enums.CANCELLED_BY.SYSTEM,
    actorId: '',
    at: nowDate,
    payload: { fromPartnerNo: next.fromPartnerNo, toPartnerNo: next.toPartnerNo },
    requestKey: opts.requestKey || [String(order._id), 'transfer', status, String(stamp)].join(':')
  });
  return { transfer: next, event };
}

// 供 runOrderAction 事务内复用：订单状态变更时把 PENDING 邀请失效为 EXPIRED/STATE_CHANGED。
function expiryOnStatusChangeOf(order, toStatus, nowDate) {
  if (!isPending(order) || toStatus === order.status) {
    return null;
  }
  const resolved = resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.STATE_CHANGED, nowDate
  });
  return resolved ? { transfer: resolved.transfer, event: resolved.event } : null;
}

// ── 惰性过期（读到 PENDING 且 now>expiresAt ⇒ 落一次 EXPIRED + 事件）──────────────
async function persistResolvedTransfer(ctx, order, resolved, nowMs) {
  const nowDate = store.toDate(nowMs);
  try {
    await ctx.dao.transaction(async (trx) => {
      await trx.update(COLLECTIONS.ORDERS, order._id, {
        transfer: resolved.transfer,
        version: numberOrZero(order.version) + 1,
        updatedAt: nowDate
      });
      await trx.add(COLLECTIONS.ORDER_EVENTS, resolved.event);
    });
  } catch (error) {
    // 并发读到同一过期邀请：唯一 requestKey 撞索引 = 另一请求已落库（不再二次写）
    if (!(ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error))) {
      throw error;
    }
  }
  const fresh = await store.getOrderById(ctx, order._id);
  return fresh || order;
}

async function expireIfNeeded(ctx, order, nowMs) {
  if (!isExpired(order, nowMs)) {
    return order;
  }
  const resolved = resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.EXPIRED, nowDate: store.toDate(nowMs)
  });
  return resolved ? persistResolvedTransfer(ctx, order, resolved, nowMs) : order;
}

// Q4：订单已不在 ACCEPTED 却仍 PENDING（历史脏数据/他端越过钩子）→ 先落 EXPIRED/STATE_CHANGED 再报错
async function expireForStateChange(ctx, order, nowMs) {
  if (!isPending(order) || order.status === enums.ORDER_STATUS.ACCEPTED) {
    return order;
  }
  const resolved = resolvePendingTransferOf(order, {
    status: STATUS.EXPIRED, reason: REASON.STATE_CHANGED, nowDate: store.toDate(nowMs)
  });
  return resolved ? persistResolvedTransfer(ctx, order, resolved, nowMs) : order;
}

// ── 入参 / 载入 / 视图 ───────────────────────────────────────────────────────
function readOrderNo(payload) {
  return store.normalizeOrderNoInput(payload && payload.orderNo);
}

function readToPartnerNo(payload) {
  const value = payload && typeof payload === 'object' ? payload.toPartnerNo : undefined;
  const checked = validate.validatePartnerNo(value);
  if (!checked.ok) {
    throw errors.validation('toPartnerNo', '目标兼职编号格式不正确，请核对后重试');
  }
  return checked.canonical;
}

function clientRequestIdOf(ctx) {
  const value = textOf(ctx && ctx.clientRequestId).trim();
  if (!value) {
    throw errors.validation('clientRequestId', '缺少请求标识，请重试');
  }
  return value;
}

// 四个动作共用前半段：可写身份 → 订单可见性/测试隔离 → 兼职身份 ACTIVE → 配置 → 惰性过期落库
async function loadTransferContext(ctx, payload) {
  store.assertWritable(ctx);
  const orderNo = readOrderNo(payload);
  const order = await store.getOrderByNo(ctx, orderNo);
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  store.assertTestOrderVisible(ctx, order);
  const partner = await store.loadWritablePartner(ctx);
  const nowMs = store.nowMsOf(ctx);
  const config = await store.loadConfig(ctx);
  const normalized = await expireIfNeeded(ctx, order, nowMs);
  return {
    partner,
    order: await expireForStateChange(ctx, normalized, nowMs),
    nowMs,
    config
  };
}

function assertOwner(order, partner) {
  if (!sameId(order.partnerId, partner._id)) {
    throw errors.forbidden('当前订单不属于你，无法转派');
  }
}

// PENDING 邀请的目标本人守卫（不依赖当前 partnerId；过期已由 loadTransferContext 惰性落库）
function requirePendingTarget(order, partner) {
  const block = transferOf(order);
  if (!block || !sameId(block.toPartnerId, partner._id)) {
    throw errors.forbidden('没有待你确认的转派邀请');
  }
  if (block.status !== STATUS.PENDING) {
    throw errors.invalidState(block.status === STATUS.EXPIRED ? '邀请已过期' : '邀请已失效');
  }
  if (order.status !== enums.ORDER_STATUS.ACCEPTED) {
    throw errors.invalidState('订单已不在可转派状态');
  }
  return block;
}

// 事务写（orders 单文档 + 1 条事件同事务）；唯一键冲突按幂等重放处理，返回 duplicated 标记
async function writeTransferAction(ctx, order, options) {
  const opts = options || {};
  const nowDate = store.toDate(opts.nowMs);
  try {
    await ctx.dao.transaction(async (trx) => {
      await trx.update(COLLECTIONS.ORDERS, order._id, Object.assign({}, opts.patch, {
        version: numberOrZero(order.version) + 1,
        updatedAt: nowDate
      }));
      await trx.add(COLLECTIONS.ORDER_EVENTS, opts.event);
    });
    const fresh = await store.getOrderById(ctx, order._id);
    return { order: fresh || order, duplicated: false };
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      const fresh = await store.getOrderById(ctx, order._id);
      return { order: fresh || order, duplicated: true };
    }
    throw error;
  }
}

// 订单视图（side = PARTNER 履约人全量；transferTarget = 转派目标视角，按 §1.4 遮蔽 customerNo/对方昵称头像）
async function viewOf(ctx, order, side, transferTarget) {
  const dto = require('./_dto');
  return dto.buildOrderDto(ctx, order, {
    side: side || '',
    transferTarget: transferTarget === true
  });
}

module.exports = {
  STATUS,
  REASON,
  RATE_SCOPE,
  MAX_TTL_MINUTES,
  MINUTE_MS,
  textOf,
  numberOrZero,
  sameId,
  dateMsOf,
  isoOf,
  ttlMinutesOf,
  rateLimitsOf,
  minuteKeyOf,
  dayKeyOf,
  consumeRate,
  transferOf,
  isPending,
  expiresAtMsOf,
  isExpired,
  hasPickedAny,
  isTargetOf,
  isPendingTargetOf,
  blockOf,
  requestKeyOf,
  findActionEvent,
  actionEventOf,
  buildTransferEvent,
  withResolutionOf,
  resolvePendingTransferOf,
  expiryOnStatusChangeOf,
  persistResolvedTransfer,
  expireIfNeeded,
  expireForStateChange,
  readOrderNo,
  readToPartnerNo,
  clientRequestIdOf,
  loadTransferContext,
  assertOwner,
  requirePendingTarget,
  writeTransferAction,
  viewOf
};
