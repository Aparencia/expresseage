// handlers/partner/createSubInvites.js · partner.createSubInvites（D59 主兼职批量发子邀请码）
// 口径：CONTRACT §13 D59（批 26 冻结）；草案 §2.3。守卫：ACTIVE 且 parentPartnerId===''（仅一层）→ 数量 1~5 →
// 有效期 24H/72H/7D → note≤50 → 队伍名额（config.teamMaxMembers，队员数+本批 ≤ 上限）→ 限流 rl:subInvite。
// 落库：kind='SUB'/issuerPartnerId=me/createdBy='PARTNER:'+myNo；batchId='TB'+yyyyMMdd+'-'+2 位序号；
// 完整码只在本次响应返回（重放同 clientRequestId 返回同批，仍只回给发码人）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const idGenerator = require('../../lib/id-generator');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const team = require('./_team');

const SUB_INVITE_KIND = enums.INVITATION_KIND.SUB;

function batchIdOf(nowMs, seq) {
  return 'TB' + time.dayKey(nowMs) + '-' + time.pad2(seq);
}

function replayResponseOf(mapping) {
  return {
    batchId: mapping.batchId,
    expiresAt: mapping.expiresAt ? time.toMs(mapping.expiresAt) : 0,
    codes: Array.isArray(mapping.codes) ? mapping.codes.slice() : [],
    duplicated: true
  };
}

// 同 clientRequestId 重放：先读 counters 映射（batchId+完整码），命中即返回同批。
async function replayOf(ctx, requestKey) {
  const row = await team.requestReplayOf(ctx, requestKey);
  if (!row || !row.batchId) {
    return null;
  }
  if (Array.isArray(row.codes) && row.codes.length > 0) {
    return replayResponseOf(row);
  }
  const codes = await ctx.dao.find(COLLECTIONS.INVITATION_CODES, {
    where: { batchId: row.batchId },
    orderBy: [['createdAt', 'asc']],
    limit: team.SUB_INVITE_BATCH_MAX
  });
  return replayResponseOf({
    batchId: row.batchId,
    expiresAt: row.expiresAt,
    codes: codes.map((item) => item.code)
  });
}

// 名额：队员数 + 待使用子码数 + 本批数量 ≤ 上限（恰好补满可发最后一码；已达上限再发 → VALIDATION_FAILED）。
// 待用码也占名额，防"members 未满但已发出远超额度的码 → 全部激活后超员"。
async function assertQuota(ctx, partner, count, config, nowMs) {
  const used = await team.memberCountOf(ctx, partner._id);
  const pending = await team.pendingInvitesOf(ctx, partner._id, nowMs);
  const reserved = used + pending.length;
  const max = team.teamMaxMembersOf(config);
  if (reserved + count > max) {
    throw errors.validation('count', '队伍人数已达上限（最多 ' + max + ' 人），请先移除队员再生成');
  }
  return { used: used, reserved: reserved, max: max };
}

function buildCodeDoc(options) {
  const opt = options;
  return {
    code: opt.code,
    kind: SUB_INVITE_KIND,
    issuerPartnerId: opt.partner._id,
    batchId: opt.batchId,
    status: enums.INVITATION_STATUS.UNUSED,
    expiresAt: opt.expiresAt,
    usedBy: '',
    usedAt: null,
    note: opt.note,
    createdBy: 'PARTNER:' + (typeof opt.partner.partnerNo === 'string' ? opt.partner.partnerNo : ''),
    createdAt: opt.nowDate,
    revokedAt: null,
    revokedBy: '',
    updatedAt: opt.nowDate
  };
}

// 主事务：本批 N 条码 + 幂等映射（counters.key 唯一索引兜底并发重放）。
async function createBatch(ctx, options) {
  const opt = options;
  return ctx.dao.transaction(async (trx) => {
    const codes = [];
    for (let i = 0; i < opt.count; i += 1) {
      const inserted = await idGenerator.insertUnique(trx, COLLECTIONS.INVITATION_CODES, {
        field: 'code',
        generate: idGenerator.generateInviteCode,
        build: (code) => buildCodeDoc(Object.assign({}, opt, { code: code }))
      });
      codes.push(inserted.value);
    }
    await team.markRequestInTx(trx, opt.requestKey, {
      batchId: opt.batchId,
      expiresAt: opt.expiresAt,
      count: opt.count
    }, opt.nowDate);
    return codes;
  });
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  team.assertMainPartner(partner);
  team.requireClientRequestId(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const count = team.countOf(input.count);
  const validity = team.validityOf(input.validity);
  const note = team.noteOf(input.note);
  const nowMs = identity.nowMs(ctx);
  const nowDate = new Date(nowMs);
  const config = await configCommon.loadRuntimeConfig(ctx);
  const requestKey = team.requestKeyOf('subInviteReq', String(partner._id), ctx.clientRequestId);
  const replay = await replayOf(ctx, requestKey);
  if (replay) {
    return replay;
  }
  await assertQuota(ctx, partner, count, config, nowMs);
  await team.consumeSubInviteRate(ctx, nowMs, config);
  const seq = await team.nextBatchSeq(ctx, nowMs);
  const batchId = batchIdOf(nowMs, seq);
  const expiresAt = time.addHours(nowMs, validity.hours);
  let codes = null;
  try {
    codes = await createBatch(ctx, {
      partner: partner,
      count: count,
      batchId: batchId,
      expiresAt: new Date(expiresAt),
      note: note,
      requestKey: requestKey,
      nowDate: nowDate
    });
  } catch (error) {
    // 并发重放：本批映射键已被同请求抢先写入 → 回读映射返回同批（不重复发码）
    if (!ctx.dao.isDuplicateError(error)) {
      throw error;
    }
    const raced = await replayOf(ctx, requestKey);
    if (raced) {
      return raced;
    }
    throw error;
  }
  return { batchId: batchId, expiresAt: expiresAt, codes: codes };
}

module.exports = { handler };
