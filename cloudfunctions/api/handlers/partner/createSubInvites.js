// handlers/partner/createSubInvites.js · partner.createSubInvites（D59 主兼职批量发子邀请码）
// 口径：CONTRACT §13 D59（批 26 冻结）；草案 §2.3。守卫：ACTIVE 且 parentPartnerId===''（仅一层）→ 数量 1~5 →
// 有效期 24H/72H/7D → note≤50 → 队伍名额（config.teamMaxMembers，队员+待用码+本批 ≤ 上限）→ 限流 rl:subInvite。
// 落库：kind='SUB'/issuerPartnerId=me/createdBy='PARTNER:'+myNo；batchId='TB'+yyyyMMdd+'-'+2 位序号；
// 完整码只在本次响应返回（重放同 clientRequestId 返回同批，仍只回给发码人）。
// 并发（批 26 收尾）：日批次序号 CAS + 事务内名额复核 + 事务内幂等映射 → 并发两请求恰一个落码，另一个回同批或 CONFLICT。
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

// 同 clientRequestId 重放：先读 counters 映射；映射未存 code 时回读码表补全。
// 回读必须带 issuerPartnerId 隔离（批 26 收尾）：batchId 是日序号，跨队可能撞号，只按 batchId
// 回读会把别队子码回给本请求 → 一律 issuerPartnerId + batchId 双条件。
async function replayOf(ctx, requestKey, partnerId) {
  const row = await team.requestReplayOf(ctx, requestKey);
  if (!row || !row.batchId) {
    return null;
  }
  if (Array.isArray(row.codes) && row.codes.length > 0) {
    return replayResponseOf(row);
  }
  const codes = await ctx.dao.find(COLLECTIONS.INVITATION_CODES, {
    where: { issuerPartnerId: partnerId, batchId: row.batchId },
    orderBy: [['createdAt', 'asc']],
    limit: team.SUB_INVITE_BATCH_MAX
  });
  return replayResponseOf({ batchId: row.batchId, expiresAt: row.expiresAt, codes: codes.map((item) => item.code) });
}

// 入参归一（count 1~5 / 有效期枚举 / note≤50）集中一处，handler 保持单函数行数内。
function readFields(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  return {
    count: team.countOf(input.count),
    validity: team.validityOf(input.validity),
    note: team.noteOf(input.note)
  };
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

// 主事务（顺序敏感）：① 日序号 CAS——并发发码在此互斥，抢不到抛 TX_CONFLICT 回滚（batchId 不撞号）；
// ② 事务内重算名额（TOCTOU 收口）；③ 先写幂等映射（并发同请求第二次 → 回滚，不重复插码）；④ 插本批 N 条码。
async function createBatch(ctx, options) {
  const opt = options;
  return ctx.dao.transaction(async (trx) => {
    const seq = await team.nextBatchSeqInTx(trx, opt.nowMs);
    const batchId = batchIdOf(opt.nowMs, seq);
    await team.assertQuotaInTx(trx, opt.partnerId, opt.fields.count, opt.config, opt.nowMs);
    const marked = await team.markRequestInTx(trx, opt.requestKey, {
      batchId: batchId,
      expiresAt: opt.expiresAt,
      count: opt.fields.count
    }, opt.nowDate);
    if (!marked) {
      throw team.txConflictError();
    }
    const codes = [];
    for (let i = 0; i < opt.fields.count; i += 1) {
      const inserted = await idGenerator.insertUnique(trx, COLLECTIONS.INVITATION_CODES, {
        field: 'code',
        generate: idGenerator.generateInviteCode,
        build: (code) => buildCodeDoc({
          code: code,
          partner: opt.partner,
          batchId: batchId,
          expiresAt: opt.expiresAt,
          note: opt.fields.note,
          nowDate: opt.nowDate
        })
      });
      codes.push(inserted.value);
    }
    return { batchId: batchId, codes: codes };
  });
}

// 发码编排：事务失败区分"并发重放（回同批）"与"真并发冲突（CONFLICT）"，其余错误原样上抛。
async function runCreate(ctx, options, requestKey) {
  const opt = options;
  try {
    const created = await createBatch(ctx, {
      partner: opt.partner,
      partnerId: opt.partnerId,
      fields: opt.fields,
      expiresAt: opt.expiresAt,
      config: opt.config,
      requestKey: requestKey,
      nowMs: opt.nowMs,
      nowDate: opt.nowDate
    });
    return { batchId: created.batchId, expiresAt: opt.expiresAt, codes: created.codes };
  } catch (error) {
    const raced = await replayOf(ctx, requestKey, opt.partnerId);
    if (raced) {
      return raced;
    }
    if (team.isTxConflict(error) || ctx.dao.isDuplicateError(error)) {
      throw errors.conflict('并发生成冲突，请刷新后重试');
    }
    throw error;
  }
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  team.assertMainPartner(partner);
  team.requireClientRequestId(ctx);
  const fields = readFields(payload);
  const nowMs = identity.nowMs(ctx);
  const config = await configCommon.loadRuntimeConfig(ctx);
  const partnerId = String(partner._id);
  const requestKey = team.requestKeyOf('subInviteReq', partnerId, ctx.clientRequestId);
  const replay = await replayOf(ctx, requestKey, partnerId);
  if (replay) {
    return replay;
  }
  team.assertQuotaFit(await team.quotaOf(ctx, partnerId, nowMs, config), fields.count);
  await team.consumeSubInviteRate(ctx, nowMs, config);
  return runCreate(ctx, {
    partner: partner,
    partnerId: partnerId,
    fields: fields,
    expiresAt: time.addHours(nowMs, fields.validity.hours),
    config: config,
    nowMs: nowMs,
    nowDate: new Date(nowMs)
  }, requestKey);
}

module.exports = { handler };
