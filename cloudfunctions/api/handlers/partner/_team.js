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

async function bumpCounter(trx, key, nowDate) {
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  if (!row) {
    await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowDate });
    return 1;
  }
  const seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
  await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowDate });
  return seq;
}

// D59 限流：窗口/日两个计数器同事务递增；超阈值 → RATE_LIMITED（计数已计，与中间件同语义）。
// subject = 本请求生效身份 openid（切换会话按 effectiveOpenid 独立计，CONTRACT §10 口径）。
async function consumeSubInviteRate(ctx, nowMs, config) {
  const openid = String((ctx.identity && ctx.identity.effectiveOpenid) || ctx.openid || '');
  const rate = subInviteRateOf(config);
  const keys = rateKeysOf(openid, nowMs);
  const nowDate = new Date(time.toMs(nowMs));
  const used = await ctx.dao.transaction(async (trx) => {
    const minute = await bumpCounter(trx, keys.minute, nowDate);
    const day = await bumpCounter(trx, keys.day, nowDate);
    return { minute, day };
  });
  if (used.minute > rate.perMinute || used.day > rate.perDay) {
    throw errors.rateLimited('操作太频繁，请稍后再试');
  }
  return used;
}

// ── 批次序号（batchId = 'TB' + yyyyMMdd + 2 位序号，与 admin.createInvites 的 B/3 位形制错开）──
async function nextBatchSeq(ctx, nowMs) {
  const key = 'subInviteBatch:' + time.dayKey(nowMs);
  const nowDate = new Date(time.toMs(nowMs));
  return ctx.dao.transaction(async (trx) => {
    const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
    if (!row) {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowDate });
      return 1;
    }
    const seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
    if (seq > BATCH_SEQ_MAX) {
      throw errors.invalidState('今日发码批次已用完，请明天再试');
    }
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowDate });
    return seq;
  });
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
  if (value instanceof Date) {
    return isFinite(value.getTime()) ? value.getTime() : 0;
  }
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }
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
  if (!key) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.COUNTERS, { where: { key: key } });
}

async function markRequestInTx(trx, key, detail, nowDate) {
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key: key } });
  if (row) {
    return false;
  }
  await trx.add(COLLECTIONS.COUNTERS, Object.assign({ key: key, updatedAt: nowDate }, detail || {}));
  return true;
}

// ── D59 级联：取消相关 PENDING 转派（单源 = order/_transfer.resolvePendingTransferOf，含 TRANSFER_CANCELLED 事件）──
// ctx.dao 既可能是普通 dao（admin 级联），也可能是 trx（removeSubMember 外层事务）：无 transaction 时直接写，
// 保证"解除隶属 + 取消邀请"同事务提交。
function applyCancellationOf(ctx, order, resolved, nowDate) {
  const apply = async (dao) => {
    await dao.update(COLLECTIONS.ORDERS, order._id, {
      transfer: resolved.transfer,
      version: (Number(order.version) || 1) + 1,
      updatedAt: nowDate
    });
    if (!resolved.event) {
      return;
    }
    try {
      await dao.add(COLLECTIONS.ORDER_EVENTS, resolved.event);
    } catch (error) {
      if (!dao.isDuplicateError || !dao.isDuplicateError(error)) {
        throw error;
      }
    }
  };
  if (typeof ctx.dao.transaction === 'function') {
    return ctx.dao.transaction(apply);
  }
  return apply(ctx.dao);
}

async function cancelPendingTransferOfOrder(ctx, order, nowDate) {
  const resolved = transferLib.resolvePendingTransferOf(order, {
    status: enums.TRANSFER_STATUS.CANCELLED,
    reason: enums.TRANSFER_RESOLVE_REASON.STATE_CHANGED,
    nowDate: nowDate
  });
  if (!resolved) {
    return false;
  }
  await applyCancellationOf(ctx, order, resolved, nowDate);
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
  nextBatchSeq,
  listTeamMembers,
  memberCountOf,
  memberBriefOf,
  pendingInvitesOf,
  teamSummaryOf,
  requestKeyOf,
  requestReplayOf,
  markRequestInTx,
  cancelPendingTransfersOf,
  cascadeSubMembers
};
