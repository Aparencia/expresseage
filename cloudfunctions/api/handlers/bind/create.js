// handlers/bind/create.js · bind.create（绑定唯一入口：只能顾客发起）
// 口径：CONTRACT v0.9 §4.2 铁律（①仅顾客发起 ②兼职端零入口 ③代客单不产生绑定 ⑦自绑拒绝 ⑥测试×真实拒绝）；
//       DATA_MODEL §2.4/§7.4/§9（事务内分配大写 roomTag）。
// 守卫顺序：角色（PARTNER 调用 → FORBIDDEN）→ 自绑拒绝 → 测试/真实一致性 → 资料完整/无进行中订单/无 ACTIVE 绑定。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const role = require('../../shared/role');
const validate = require('../../shared/validate');
const { partnerPublic } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');

function bindingDto(binding) {
  return {
    roomTag: binding.roomTag,
    dormKey: binding.dormSnapshot ? binding.dormSnapshot.dormKey : '',
    buildingText: binding.dormSnapshot ? binding.dormSnapshot.buildingText : '',
    boundAt: binding.boundAt ? new Date(binding.boundAt).getTime() : 0
  };
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = identity.scopeOf(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  // CUSTOMER 角色断言：bind.create 只能由顾客发起，PARTNER 调用一律 FORBIDDEN（CONTRACT §4.2 ①）
  if (scope.role && !role.canInitiateBind(scope.role)) {
    throw errors.forbidden('兼职身份不能绑定顾客，请切换为顾客身份后发起绑定');
  }
  const { customer } = await identity.requireCustomerProfile(ctx);
  if (!customer.profileCompleted) {
    throw errors.invalidState('请先完善宿舍资料后再绑定兼职');
  }
  const codeResult = validate.validatePartnerNo(input.partnerNo);
  if (!codeResult.ok) {
    throw errors.validation('partnerNo', '兼职编号格式不正确，请核对后重试');
  }
  const partner = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { partnerNo: codeResult.canonical } });
  if (!partner || partner.deletedAt || partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.notFound('该兼职编号不存在，请核对后重试');
  }
  if (partner.status !== enums.PARTNER_STATUS.ACTIVE) {
    throw errors.partnerClosed('该兼职当前不接单（已停用）');
  }
  // self-bind guard: 不能绑定自己的兼职账号（同一 openid 兼顾客+兼职）
  const effectiveOpenid = (ctx.identity && ctx.identity.effectiveOpenid) || scope.openid;
  if (partner.openid === effectiveOpenid) {
    throw errors.forbidden('不能绑定自己的兼职账号');
  }

  const customerUser = await identity.loadUser(ctx, scope.openid);
  const partnerUser = await identity.loadUser(ctx, partner.openid);
  if (!identity.isSameTestSide(customerUser && customerUser.isTestAccount, partnerUser && partnerUser.isTestAccount)) {
    // 测试×真实互绑 → FORBIDDEN（严格隔离口径）
    throw errors.forbidden('测试账号与真实账号不能互相绑定');
  }

  const existingBinding = await identity.getActiveBinding(ctx, scope.openid);
  if (existingBinding) {
    throw errors.conflict('你已绑定兼职，如需更换请先解绑');
  }
  const activeOrder = await identity.hasActiveOrder(ctx, scope.openid, '');
  if (activeOrder) {
    throw errors.invalidState('有进行中的订单，暂不能更换绑定');
  }

  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const binding = await ctx.dao.transaction(async (trx) => bindCommon.createBindingInTx(trx, {
    customer,
    partner,
    nowMs,
    nowDate
  }));
  return {
    binding: bindingDto(binding),
    partnerPublic: partnerPublic(partner, { bound: true })
  };
}

module.exports = { handler };
