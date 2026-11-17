// handlers/partner/resolveTransferCode.js · partner.resolveTransferCode（D88：凭码解析目标兼职）
// 口径：CONTRACT §13 D88；D58 的转派校验（排除自己/同侧账号/子队员限本队）在此提前做一遍，
//       真正的权威仍是 order.requestTransfer——本动作只把「码」换成「编号+昵称」，不消费码、不改任何订单。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const team = require('./_team');
const targetScope = require('./_transfer-target');
const transferCode = require('./_transfer-code');

// 不存在/已注销/非 ACTIVE 一律同一句文案（不暴露存在性）
async function loadByCode(ctx, code) {
  const target = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { transferCode: code } });
  if (!target || target.deletedAt || target.status !== enums.PARTNER_STATUS.ACTIVE) {
    throw errors.notFound(transferCode.COPY.invalid);
  }
  return target;
}

// 与 D58 转派同口径的提前校验：过期 / 自己 / 真实×测试 / 子队员限本队
function assertReachable(me, target, nowMs) {
  if (transferCode.isExpired(target.transferCodeExpiresAt, nowMs)) {
    throw errors.notFound(transferCode.COPY.invalid);
  }
  if (String(target._id) === String(me._id)) {
    throw errors.validation('code', transferCode.COPY.self);
  }
  if (targetScope.isTestOpenid(target.openid) !== targetScope.isTestOpenid(me.openid)) {
    throw errors.forbidden('真实与测试账号之间不能转派');
  }
  const mainPartnerId = team.isSubMember(me) ? team.parentPartnerIdOf(me) : targetScope.TEAM_SCOPE_MAIN;
  if (!targetScope.canReach(target, mainPartnerId)) {
    throw errors.forbidden('子队员只能转派给本队成员');
  }
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const config = await configCommon.loadRuntimeConfig(ctx);
  const nowMs = identity.nowMs(ctx);
  await transferCode.consumeCodeRate(ctx, nowMs, config);
  const code = transferCode.normalizeCode(input.code);
  if (!code) {
    throw errors.notFound(transferCode.COPY.invalid);
  }
  const target = await loadByCode(ctx, code);
  assertReachable(partner, target, nowMs);
  return {
    partnerNo: String(target.partnerNo || ''),
    displayName: String(target.displayName || ''),
    expiresAt: transferCode.msOf(target.transferCodeExpiresAt)
  };
}

module.exports = { handler };
