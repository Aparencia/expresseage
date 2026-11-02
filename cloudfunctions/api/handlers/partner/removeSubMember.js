// handlers/partner/removeSubMember.js · partner.removeSubMember（D59 主兼职移除子队员）
// 口径：CONTRACT §13 D59（裁决 Q11）：解除隶属（parentPartnerId=''）+ status='SUSPENDED'
// （suspendedReason='TEAM_REMOVED'，恢复需 admin）；同事务结束该队员的 PENDING 转派（CANCELLED/STATE_CHANGED）。
// 守卫：主兼职（parentPartnerId===''）/ 目标 parentPartnerId===me（否则 NOT_FOUND）/ 无进行中订单（否则 INVALID_STATE）；
// 幂等：counters requestKey（同 clientRequestId 重放返回成功，不因已移除而变 NOT_FOUND）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const team = require('./_team');

const TEAM_REMOVED_REASON = 'TEAM_REMOVED';

function partnerNoOf(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const check = validate.validatePartnerNo(input.partnerNo);
  if (!check.ok) {
    throw errors.validation('partnerNo', '兼职编号格式不正确，请核对后重试');
  }
  return check.canonical;
}

// 进行中订单守卫：订单归属在 orders.partnerId（不按 openid 快照，避免注销/匿名化干扰）。
async function hasActiveOrders(ctx, partnerId) {
  for (let i = 0; i < enums.ORDER_ACTIVE_STATUSES.length; i += 1) {
    const row = await ctx.dao.findOne(COLLECTIONS.ORDERS, {
      where: { partnerId: partnerId, status: enums.ORDER_ACTIVE_STATUSES[i] },
      limit: 1
    });
    if (row) {
      return true;
    }
  }
  return false;
}

function suspendedPatchOf(target, nowDate) {
  return {
    parentPartnerId: '',
    status: enums.PARTNER_STATUS.SUSPENDED,
    suspendedAt: nowDate,
    suspendedReason: TEAM_REMOVED_REASON,
    serviceConfig: Object.assign({}, target.serviceConfig || {}, { acceptingOrders: false }),
    updatedAt: nowDate
  };
}

// 单事务：解除隶属 + 停用 + 取消该队员 PENDING 转派（同事务保证"人已移出但邀请还挂着"不会出现）。
async function removeInTx(options) {
  const opt = options;
  return opt.ctx.dao.transaction(async (trx) => {
    await trx.update(COLLECTIONS.PARTNERS, opt.target._id, suspendedPatchOf(opt.target, opt.nowDate));
    await team.cancelPendingTransfersOf({ dao: trx }, [String(opt.target._id)], opt.nowMs);
    await team.markRequestInTx(trx, opt.requestKey, {
      partnerNo: opt.partnerNo,
      status: enums.PARTNER_STATUS.SUSPENDED
    }, opt.nowDate);
  });
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  team.assertMainPartner(partner);
  team.requireClientRequestId(ctx);
  const partnerNo = partnerNoOf(payload);
  const nowMs = identity.nowMs(ctx);
  const nowDate = new Date(time.toMs(nowMs));
  const requestKey = team.requestKeyOf('subMemberReq', String(partner._id), ctx.clientRequestId);
  const replay = await team.requestReplayOf(ctx, requestKey);
  if (replay) {
    return {
      partnerNo: typeof replay.partnerNo === 'string' ? replay.partnerNo : partnerNo,
      status: typeof replay.status === 'string' ? replay.status : enums.PARTNER_STATUS.SUSPENDED,
      duplicated: true
    };
  }
  const target = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { partnerNo: partnerNo } });
  if (!target || team.parentPartnerIdOf(target) !== String(partner._id)) {
    throw errors.notFound('该队员不存在或不在你的队伍中');
  }
  if (target.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.notFound('该队员不存在或不在你的队伍中');
  }
  if (await hasActiveOrders(ctx, target._id)) {
    throw errors.invalidState('该队员有进行中的订单，暂不能移除');
  }
  try {
    await removeInTx({
      ctx: ctx,
      target: target,
      partnerNo: partnerNo,
      nowMs: nowMs,
      nowDate: nowDate,
      requestKey: requestKey
    });
  } catch (error) {
    if (!ctx.dao.isDuplicateError(error)) {
      throw error;
    }
    const raced = await team.requestReplayOf(ctx, requestKey);
    if (raced) {
      return { partnerNo: partnerNo, status: enums.PARTNER_STATUS.SUSPENDED, duplicated: true };
    }
    throw error;
  }
  return { partnerNo: partnerNo, status: enums.PARTNER_STATUS.SUSPENDED };
}

module.exports = { handler };
