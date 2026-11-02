// handlers/partner/_team.js · D59 兼职子队员共用件（队伍读取/子码配额/发码限流/级联取消 PENDING 转派）
// 口径：CONTRACT §13 D59（批 26 冻结）+ 草案 §2.2~§2.4；DATA_MODEL §2.3/§2.8/§2.10。
// 纪律：只经 ctx.dao / scope.dao（不经数据库 SDK 原生 collection API）；DTO 时间一律毫秒；
//       完整邀请码只在 partner.createSubInvites 的本次响应返回，列表/队伍摘要只给后 4 位。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const { DEFAULT_CONFIG } = require('../../db/config');
const transferLib = require('../order/_transfer');

// 子码单批数量上限（草案 §2.3：count 1~5）；批次序号上限与 admin.createInvites 同形制（99）。
const SUB_INVITE_BATCH_MAX = 5;
const BATCH_SEQ_MAX = 99;
const TEAM_MEMBERS_PAGE = 100;
const TEAM_INVITES_PAGE = 50;
const TRANSFER_ORDERS_PAGE = 50;
// D59 出厂上限/限流默认值只来自 config/defaults.js 副本（不在此写第二份数字口径）。
const DEFAULT_TEAM_MAX_MEMBERS = DEFAULT_CONFIG.teamMaxMembers;
const DEFAULT_SUB_INVITE_RATE = DEFAULT_CONFIG.subInviteRate;
const SUB_INVITE_VALIDITY_HOURS = { '24H': 24, '72H': 72, '7D': 168 };
const TEAM_MEMBER_STATUSES = [enums.PARTNER_STATUS.ACTIVE, enums.PARTNER_STATUS.SUSPENDED];
const TRANSFER_TARGET_FIELDS = ['transfer.fromPartnerId', 'transfer.toPartnerId'];
// 平台单事务预算 100 ops（V4_ENGINEERING §8.2 / TD-055）：移除队员事务内取消 PENDING 转派按
// "订单 update 1 + TRANSFER_CANCELLED 事件 1" 计 2 ops/单 → 40 单 = 80 ops，留 20 给成员 patch/幂等键；
// 超出上界的余量不阻塞移除，靠转派 TTL 惰性过期（order/_transfer.expireIfNeeded）兜底（上界有注释、可复核）。
const TX_TRANSFER_CANCEL_LIMIT = 40;
// 并发冲突内部信号（不暴露客户端）：日批次序号 CAS 失败 = 另一并发请求已抢到同一序号 → 事务回滚。
const TX_CONFLICT_CODE = 'TX_CONFLICT';

function txConflictError() {
  const error = new Error('并发冲突：批次序号已被抢占');
  error.code = TX_CONFLICT_CODE;
  return error;
}

function isTxConflict(error) {
  return !!(error && error.code === TX_CONFLICT_CODE);
}

// ── 层级（仅一层）──────────────────────────────────────────────────────────────
function parentPartnerIdOf(partner) {
  const value = partner && partner.parentPartnerId;
  return typeof value === 'string' ? value : '';
}

function isSubMember(partner) {
  return parentPartnerIdOf(partner) !== '';
}

function assertMainPartner(partner) {
  if (isSubMember(partner)) {
    throw errors.forbidden('子队员不能管理团队，请让主兼职操作');
  }
  return partner;
}

// ── 配置口径（出厂默认来自 config/defaults.js；后台本批不可改四个键）─────────────
function positiveIntOr(value, fallback) {
  return typeof value === 'number' && isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function teamMaxMembersOf(config) {
  return positiveIntOr(config && config.teamMaxMembers, DEFAULT_TEAM_MAX_MEMBERS);
}

function subInviteRateOf(config) {
  const rate = (config && config.subInviteRate) || {};
  return {
    perMinute: positiveIntOr(rate.perMinute, DEFAULT_SUB_INVITE_RATE.perMinute),
    perDay: positiveIntOr(rate.perDay, DEFAULT_SUB_INVITE_RATE.perDay)
  };
}

// ── 入参归一（数量/有效期/备注/幂等键）──────────────────────────────────────────
function countOf(value) {
  const count = Number(value === undefined ? 1 : value);
  if (!Number.isFinite(count) || Math.floor(count) !== count || count < 1 || count > SUB_INVITE_BATCH_MAX) {
    throw errors.validation('count', '单次生成数量需为 1~5 的整数');
  }
  return count;
}

function validityOf(value) {
  const check = validate.validateSubInviteValidity(value);
  if (!check.ok) {
    throw errors.validation('validity', '有效期只支持 24/72/168 小时');
  }
  return { validity: check.value, hours: SUB_INVITE_VALIDITY_HOURS[check.value] };
}

function noteOf(value) {
  const check = validate.validateTeamNote(value);
  if (!check.ok) {
    throw errors.validation('note', '备注最多 50 字');
  }
  return check.value;
}

function requireClientRequestId(ctx) {
  const value = ctx && ctx.clientRequestId;
  const check = validate.validateClientRequestId(value);
  if (!check.ok) {
    throw errors.validation('clientRequestId', '请求标识缺失或格式不正确，请重试');
  }
  return value;
}

// ── 计数窗口（与 middleware/ratelimit 同口径：UTC+8 日桶 / 分钟分片）──────────────
function minuteWindowKeyOf(nowMs) {
  const date = new Date(time.toMs(nowMs) + time.TZ_OFFSET_MS);
  return 'w' + time.dayKey(nowMs) + time.pad2(date.getUTCHours()) + time.pad2(date.getUTCMinutes());
}

function rateKeysOf(openid, nowMs) {
  return {
    minute: 'rl:subInvite:' + openid + ':' + minuteWindowKeyOf(nowMs),
    day: 'rl:subInvite:' + openid + ':d' + time.dayKey(nowMs)
  };
}

// 限流计数行"首建"并发（真实云 DB 正确性）：counters.key 唯一索引下两请求同时首建同一 key，后到者 add 撞唯一键
// 且事务已被打 abort（Mongo 语义：冲突写后同一事务读写全部失败）→ 不能同事务"重读后 update"，只能整体回滚、
// 事务外层重试一次：第二次读到并发赢家已提交的行 → update 递增；两次仍冲突 → CONFLICT（不伪装 RATE_LIMITED）。
const RATE_BUCKET_RACE_CODE = 'RATE_BUCKET_RACE';
const RATE_BUCKET_ATTEMPTS = 2;

function rateBucketRaceError(cause) {
  const error = new Error('限流计数行首建并发冲突');
  error.code = RATE_BUCKET_RACE_CODE;
  error.cause = cause;
  return error;
}
function isRateBucketRace(error) {
  return !!(error && error.code === RATE_BUCKET_RACE_CODE);
}

async function bumpCounter(trx, key, nowDate) {
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  if (!row) {
    try {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowDate });
      return 1;
    } catch (error) {
      // 首建撞唯一索引 = 并发赢家已插同 key 行（真实库）→ 标记后交事务外层重试（同事务重读不可用）。
      if (!trx.isDuplicateError || !trx.isDuplicateError(error)) throw error;
      throw rateBucketRaceError(error);
    }
  }
  const seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
  await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowDate });
  return seq;
}

async function bumpRateCountersOnce(ctx, keys, nowDate) {
  return ctx.dao.transaction(async (trx) => {
    const minute = await bumpCounter(trx, keys.minute, nowDate);
    const day = await bumpCounter(trx, keys.day, nowDate);
    return { minute, day };
  });
}

// 限流递增（事务外层重试一次）：只重试"计数行首建撞唯一键"；其余错误原样上抛，由上层如实映射。
async function bumpRateCounters(ctx, keys, nowDate) {
  for (let attempt = 1; attempt <= RATE_BUCKET_ATTEMPTS; attempt += 1) {
    try {
      return await bumpRateCountersOnce(ctx, keys, nowDate);
    } catch (error) {
      if (!isRateBucketRace(error)) throw error;
      if (attempt === RATE_BUCKET_ATTEMPTS) throw errors.conflict('操作并发冲突，请重试');
    }
  }
  return null; // 循环内必 return/throw（RATE_BUCKET_ATTEMPTS≥1），此行为函数收口
}

// D59 限流：窗口/日两个计数器同事务递增；超阈值 → RATE_LIMITED（计数已计，与中间件同语义）。
// subject = 本请求生效身份 openid（切换会话按 effectiveOpenid 独立计，CONTRACT §10 口径）。
async function consumeSubInviteRate(ctx, nowMs, config) {
  const openid = String((ctx.identity && ctx.identity.effectiveOpenid) || ctx.openid || '');
  const rate = subInviteRateOf(config);
  const keys = rateKeysOf(openid, nowMs);
  const nowDate = new Date(time.toMs(nowMs));
  const used = await bumpRateCounters(ctx, keys, nowDate);
  if (used.minute > rate.perMinute || used.day > rate.perDay) {
    throw errors.rateLimited('操作太频繁，请稍后再试');
  }
  return used;
}

// ── 批次序号（batchId = 'TB' + yyyyMMdd + 2 位序号，与 admin.createInvites 的 B/3 位形制错开）──
// 并发口径（批 26 收尾）：读-改-写改为 CAS（updateWhere 带旧 seq 条件）——并发发码在序号计数器上互斥，
// 抢不到的一个抛 TX_CONFLICT 回滚（handler 回读幂等映射/返回 CONFLICT），既防 batchId 撞号，
// 也让紧随其后的名额复核不存在"两个请求各自过闸"的 TOCTOU 窗口。必须由调用方放在同一事务的最前面。
async function nextBatchSeqInTx(trx, nowMs) {
  const key = 'subInviteBatch:' + time.dayKey(nowMs);
  const nowDate = new Date(time.toMs(nowMs));
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  if (!row) {
    try {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowDate });
      return 1;
    } catch (error) {
      // 并发首建：唯一键冲突 → 让事务回滚，按并发冲突处理（幂等映射/客户端重试兜底）
      if (trx.isDuplicateError && trx.isDuplicateError(error)) {
        throw txConflictError();
      }
      throw error;
    }
  }
  const seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
  if (seq > BATCH_SEQ_MAX) {
    throw errors.invalidState('今日发码批次已用完，请明天再试');
  }
  const result = await trx.updateWhere(COLLECTIONS.COUNTERS, { key, seq: row.seq }, { seq, updatedAt: nowDate });
  if (!result || result.updated !== 1) {
    throw txConflictError();
  }
  return seq;
}

// ── 队伍成员（仅一层：parentPartnerId === 主兼职 _id；CLOSED 不返回）──────────────
async function listTeamMembers(ctx, parentPartnerId) {
  const rows = await ctx.dao.find(COLLECTIONS.PARTNERS, {
    where: { parentPartnerId: parentPartnerId },
    orderBy: [['teamJoinedAt', 'asc']],
    limit: TEAM_MEMBERS_PAGE
  });
  return rows.filter((row) => TEAM_MEMBER_STATUSES.indexOf(row.status) >= 0);
}

async function memberCountOf(ctx, parentPartnerId) {
  const members = await listTeamMembers(ctx, parentPartnerId);
  return members.length;
}

// 主兼职可见子队员 partnerNo + displayName（D59 裁决 Q7：无头像/fileId）。
function memberBriefOf(member) {
  return {
    partnerNo: typeof member.partnerNo === 'string' ? member.partnerNo : '',
    displayName: typeof member.displayName === 'string' ? member.displayName : '',
    status: member.status,
    teamJoinedAt: member.teamJoinedAt ? time.toMs(member.teamJoinedAt) : 0
  };
}

// 期限归一：库里可能是 Date（管理端写）或毫秒数；无值/非法归 0（0 = 无期限，不算过期）。
function deadlineMsOf(value) {
  if (value instanceof Date) return isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// 待使用子码：只回后 4 位；已过期码按失效处理不返回（惰性判定，不写库）。
async function pendingInvitesOf(ctx, issuerPartnerId, nowMs) {
  const rows = await ctx.dao.find(COLLECTIONS.INVITATION_CODES, {
    where: { issuerPartnerId: issuerPartnerId, status: enums.INVITATION_STATUS.UNUSED },
    orderBy: [['createdAt', 'desc']],
    limit: TEAM_INVITES_PAGE
  });
  const now = time.toMs(nowMs);
  const out = [];
  rows.forEach((row) => {
    const deadline = deadlineMsOf(row.expiresAt);
    if (deadline > 0 && deadline <= now) {
      return;
    }
    out.push({
      codeTail: String(row.code || '').slice(-4),
      expiresAt: deadline,
      batchId: typeof row.batchId === 'string' ? row.batchId : ''
    });
  });
  return out;
}

// ── 名额口径（单源）：reserved = 在队队员 + 未过期待用子码；上限 = config.teamMaxMembers，后台不可超 10 ──
// 发码闸、事务内复核、团队摘要 quota 三处共用同一算法，杜绝"页面放行 / 服务端拒绝"的口径漂移（批 26 收尾）。
function quotaViewOf(used, pendingCount, max) {
  return { used: used, reserved: used + pendingCount, max: max };
}

async function quotaOf(ctx, partnerId, nowMs, config) {
  const used = await memberCountOf(ctx, partnerId);
  const pending = await pendingInvitesOf(ctx, partnerId, nowMs);
  return quotaViewOf(used, pending.length, teamMaxMembersOf(config));
}

function assertQuotaFit(quota, count) {
  if (quota.reserved + count > quota.max) {
    throw errors.validation('count', '队伍人数已达上限（最多 ' + quota.max + ' 人），请先移除队员再生成');
  }
}

// 事务内名额复核（TOCTOU 收口）：不用事务外快照，必须在拿稳日批次序号 CAS 之后调用。
async function assertQuotaInTx(trx, partnerId, count, config, nowMs) {
  assertQuotaFit(await quotaOf({ dao: trx }, partnerId, nowMs, config), count);
}

// 子队员视角的队伍摘要（parentPartnerNo + memberCount；不含成员明细/quota）。
async function teamSummaryOf(ctx, subPartner) {
  const parentId = parentPartnerIdOf(subPartner);
  const parent = parentId ? await ctx.dao.get(COLLECTIONS.PARTNERS, parentId) : null;
  return {
    team: {
      parentPartnerNo: parent && typeof parent.partnerNo === 'string' ? parent.partnerNo : '',
      memberCount: await memberCountOf(ctx, parentId)
    }
  };
}

// ── 请求幂等（counters 唯一键；子码批次/移除队员这类无 audit 的写动作走这里）─────────
function requestKeyOf(prefix, partnerId, clientRequestId) {
  return prefix + ':' + partnerId + ':' + clientRequestId;
}

async function requestReplayOf(ctx, key) {
  if (!key) return null;
  return ctx.dao.findOne(COLLECTIONS.COUNTERS, { where: { key: key } });
}

async function markRequestInTx(trx, key, detail, nowDate) {
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key: key } });
  if (row) return false;
  await trx.add(COLLECTIONS.COUNTERS, Object.assign({ key: key, updatedAt: nowDate }, detail || {}));
  return true;
}

// ── D59 级联：取消相关 PENDING 转派（单源 = order/_transfer.resolvePendingTransferOf，含 TRANSFER_CANCELLED 事件）──
// ctx.dao 既可能是普通 dao（admin 级联），也可能是 trx（removeSubMember 外层事务）：opts.inTx（或 dao 无
// transaction 能力）时直接写，保证"解除隶属 + 取消转派"同事务提交；否则按单订单开小事务（admin 级联既有口径）。
function applyCancellationOf(ctx, order, resolved, nowDate, inTx) {
  const apply = async (dao) => {
    await dao.update(COLLECTIONS.ORDERS, order._id, {
      transfer: resolved.transfer,
      version: (Number(order.version) || 1) + 1,
      updatedAt: nowDate
    });
    if (!resolved.event) return;
    try {
      await dao.add(COLLECTIONS.ORDER_EVENTS, resolved.event);
    } catch (error) {
      if (!dao.isDuplicateError || !dao.isDuplicateError(error)) {
        throw error;
      }
    }
  };
  if (!inTx && typeof ctx.dao.transaction === 'function') {
    return ctx.dao.transaction(apply);
  }
  return apply(ctx.dao);
}

async function cancelPendingTransferOfOrder(ctx, order, nowDate, inTx) {
  const resolved = transferLib.resolvePendingTransferOf(order, {
    status: enums.TRANSFER_STATUS.CANCELLED,
    reason: enums.TRANSFER_RESOLVE_REASON.STATE_CHANGED,
    nowDate: nowDate
  });
  if (!resolved) {
    return false;
  }
  await applyCancellationOf(ctx, order, resolved, nowDate, inTx);
  return true;
}

async function cancelPendingTransfersOf(ctx, partnerIds, nowMs) {
  const nowDate = new Date(time.toMs(nowMs));
  const ids = (partnerIds || []).filter((id) => typeof id === 'string' && id !== '');
  let cancelled = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let f = 0; f < TRANSFER_TARGET_FIELDS.length; f += 1) {
      const where = {};
      where[TRANSFER_TARGET_FIELDS[f]] = ids[i];
      where['transfer.status'] = enums.TRANSFER_STATUS.PENDING;
      const orders = await ctx.dao.find(COLLECTIONS.ORDERS, { where: where, limit: TRANSFER_ORDERS_PAGE });
      for (let k = 0; k < orders.length; k += 1) {
        if (await cancelPendingTransferOfOrder(ctx, orders[k], nowDate)) {
          cancelled += 1;
        }
      }
    }
  }
  return cancelled;
}

// 移除队员事务内的"定向取消"：只按 transfer.toPartnerId 读（被移除者只能作为转派目标；作为发起方的单
// 已被"进行中订单"闸挡在事务外），单次上限 TX_TRANSFER_CANCEL_LIMIT 单（见文件头 ops 预算注释）；
// 返回取消条数（事件写入与订单 update 同事务，测试按 ORDER_EVENTS 条数断言）。
async function cancelIncomingTransfersInTx(trx, partnerId, nowDate) {
  if (!partnerId) {
    return 0;
  }
  const orders = await trx.find(COLLECTIONS.ORDERS, {
    where: { 'transfer.toPartnerId': partnerId, 'transfer.status': enums.TRANSFER_STATUS.PENDING },
    limit: TX_TRANSFER_CANCEL_LIMIT
  });
  let cancelled = 0;
  for (let i = 0; i < orders.length; i += 1) {
    if (await cancelPendingTransferOfOrder({ dao: trx }, orders[i], nowDate, true)) {
      cancelled += 1;
    }
  }
  return cancelled;
}

// 主兼职 SUSPENDED/CLOSED 级联（D59）：同 parentPartnerId 子队员一并停用/关闭，并取消该队 PENDING 转派。
// hooks 由 admin 域注入（suspendMember/closeMember 复用该域既有分批事务与幂等语义，避免两份实现）。
async function cascadeSubMembers(scope, mainPartner, status, reason, hooks) {
  const members = await listTeamMembers(scope, mainPartner._id);
  const isClose = status === enums.PARTNER_STATUS.CLOSED;
  let affectedMembers = 0;
  for (let i = 0; i < members.length; i += 1) {
    const member = members[i];
    if (isClose) {
      await hooks.closeMember(member);
      affectedMembers += 1;
    } else if (member.status === enums.PARTNER_STATUS.ACTIVE) {
      await hooks.suspendMember(member, reason);
      affectedMembers += 1;
    }
  }
  const ids = [mainPartner._id].concat(members.map((member) => member._id));
  const nowMs = scope && typeof scope.now === 'number' ? scope.now : Date.now();
  const cancelledTransfers = await cancelPendingTransfersOf(scope, ids, nowMs);
  return { affectedMembers: affectedMembers, cancelledTransfers: cancelledTransfers };
}

// 批 26 收尾：admin 恢复子队员时的悬挂上级清理。上级已注销/停用/不存在时，恢复后不能留下
// parentPartnerId 指向不可用上级（会同时触发"子队员禁代客单"且永不能转出）→ 解除隶属视为主兼职；
// 返回被解除的上级 _id（'' = 无需处理，上级仍 ACTIVE）。只改 partners 一单条，审计由调用方写 detail。
async function detachOrphanParent(scope, subPartner) {
  const parentId = parentPartnerIdOf(subPartner);
  if (!parentId) {
    return '';
  }
  const parent = await scope.dao.get(COLLECTIONS.PARTNERS, parentId);
  if (parent && parent.status === enums.PARTNER_STATUS.ACTIVE && !parent.deletedAt) {
    return '';
  }
  await scope.dao.update(COLLECTIONS.PARTNERS, subPartner._id, {
    parentPartnerId: '',
    teamJoinedAt: '',
    updatedAt: scope.nowDate
  });
  return parentId;
}

// admin 治理编排（单源）：SUSPENDED/CLOSED 级联子队员 + 取消该队 PENDING 转派；ACTIVE 恢复时清理悬挂上级。
// hooks 由 admin 域注入（复用该域既有分批事务/幂等语义）；返回 affectedMembers/cancelledTransfers/detachedParentId。
async function cascadeOrDetachForAdmin(scope, partner, status, reason, hooks) {
  const outcome = { affectedMembers: 0, cancelledTransfers: 0, detachedParentId: '' };
  if (status === enums.PARTNER_STATUS.ACTIVE) {
    outcome.detachedParentId = await detachOrphanParent(scope, partner);
    return outcome;
  }
  const cascaded = await cascadeSubMembers(scope, partner, status, reason, hooks);
  return Object.assign(outcome, cascaded);
}

module.exports = {
  SUB_INVITE_BATCH_MAX,
  parentPartnerIdOf,
  isSubMember,
  assertMainPartner,
  teamMaxMembersOf,
  countOf,
  validityOf,
  noteOf,
  requireClientRequestId,
  consumeSubInviteRate,
  nextBatchSeqInTx,
  listTeamMembers,
  memberCountOf,
  memberBriefOf,
  pendingInvitesOf,
  quotaViewOf,
  quotaOf,
  assertQuotaFit,
  assertQuotaInTx,
  teamSummaryOf,
  requestKeyOf,
  requestReplayOf,
  markRequestInTx,
  txConflictError,
  isTxConflict,
  cancelPendingTransfersOf,
  cancelIncomingTransfersInTx,
  cascadeSubMembers,
  cascadeOrDetachForAdmin
};
