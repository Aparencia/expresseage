// handlers/partner/revokeSubInvite.js · partner.revokeSubInvite（D59 主兼职按批次作废未使用子邀请码）
// 口径：Lead 2026-11-03 契约修订（W7 接口缺口）：入参 {batchId, clientRequestId}，按 issuerPartnerId===me +
// batchId 匹配该批全部 status='UNUSED' 的码批量置 REVOKED（revokedAt/revokedBy=myNo）。
// 他人批次/不存在 → NOT_FOUND（同文案，防枚举）；该批无未用码（已用/已作废）→ INVALID_STATE。
// 幂等：counters requestKey（同 clientRequestId 重放返回同批 revokedCount + duplicated:true）；限流同 rl:subInvite。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const team = require('./_team');

// 本域自产批次号形制：'TB' + yyyyMMdd + '-' + 2 位序号（createSubInvites.batchIdOf 单源）。
const SUB_BATCH_PATTERN = /^TB\d{8}-\d{2}$/;

function batchIdOf(payload) {
  const value = payload && payload.batchId;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!SUB_BATCH_PATTERN.test(text)) {
    throw errors.validation('batchId', '发码批次格式不正确，请刷新页面后重试');
  }
  return text;
}

function replayResponseOf(mapping) {
  return {
    batchId: mapping.batchId,
    revokedCount: Number(mapping.revokedCount) || 0,
    duplicated: true
  };
}

async function replayOf(ctx, requestKey) {
  const row = await team.requestReplayOf(ctx, requestKey);
  if (!row || !row.batchId) {
    return null;
  }
  return replayResponseOf(row);
}

// 事务内：本批未用码批量 REVOKED（条件更新只在仍为 UNUSED 时命中，防与激活并发互踩）+ 幂等映射。
async function revokeBatchInTx(ctx, options) {
  return ctx.dao.transaction(async (trx) => {
    const rows = await trx.find(COLLECTIONS.INVITATION_CODES, {
      where: { issuerPartnerId: options.partnerId, batchId: options.batchId },
      limit: team.SUB_INVITE_BATCH_MAX
    });
    if (rows.length === 0) {
      throw errors.notFound('该发码批次不存在');
    }
    let revokedCount = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].status !== enums.INVITATION_STATUS.UNUSED) {
        continue;
      }
      const result = await trx.updateWhere(COLLECTIONS.INVITATION_CODES, {
        _id: rows[i]._id,
        status: enums.INVITATION_STATUS.UNUSED
      }, {
        status: enums.INVITATION_STATUS.REVOKED,
        revokedAt: options.nowDate,
        revokedBy: options.revokedBy,
        updatedAt: options.nowDate
      });
      if (result.updated === 1) {
        revokedCount += 1;
      }
    }
    if (revokedCount === 0) {
      throw errors.invalidState('该批子邀请码已使用或已作废，无需再作废');
    }
    await team.markRequestInTx(trx, options.requestKey, {
      batchId: options.batchId,
      revokedCount: revokedCount
    }, options.nowDate);
    return revokedCount;
  });
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  team.assertMainPartner(partner);
  team.requireClientRequestId(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const batchId = batchIdOf(input);
  const nowMs = identity.nowMs(ctx);
  const nowDate = new Date(time.toMs(nowMs));
  const config = await configCommon.loadRuntimeConfig(ctx);
  const requestKey = team.requestKeyOf('subInviteRevokeReq', String(partner._id), ctx.clientRequestId);
  const replay = await replayOf(ctx, requestKey);
  if (replay) {
    return replay;
  }
  await team.consumeSubInviteRate(ctx, nowMs, config);
  let revokedCount = 0;
  try {
    revokedCount = await revokeBatchInTx(ctx, {
      partnerId: String(partner._id),
      batchId: batchId,
      revokedBy: typeof partner.partnerNo === 'string' ? partner.partnerNo : '',
      requestKey: requestKey,
      nowDate: nowDate
    });
  } catch (error) {
    // 并发重放：映射键被同请求抢先写入 → 回读返回同批
    if (!ctx.dao.isDuplicateError(error)) {
      throw error;
    }
    const raced = await replayOf(ctx, requestKey);
    if (raced) {
      return raced;
    }
    throw error;
  }
  return { batchId: batchId, revokedCount: revokedCount };
}

module.exports = { handler };
