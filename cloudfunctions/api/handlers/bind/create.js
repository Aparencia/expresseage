// handlers/bind/create.js · bind.create（绑定唯一入口：只能顾客发起）
// 口径：CONTRACT v0.9 §4.2 铁律（①仅顾客发起 ②兼职端零入口 ③代客单不产生绑定 ⑦自绑拒绝 ⑥测试×真实拒绝）；
//       DATA_MODEL §2.4/§7.4/§9（事务内分配大写 roomTag）。
// 守卫顺序：角色（PARTNER 调用 → FORBIDDEN）→ 自绑拒绝 → 测试/真实一致性 → 资料完整/无进行中订单/无 ACTIVE 绑定。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const role = require('../../shared/role');
const ids = require('../../shared/ids');
const validate = require('../../shared/validate');
const { partnerPublic } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const tx = require('../../lib/tx');
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
    // 错前缀同源提示（CONTRACT §3.1 规则 4）：C 开头/DEV 开头/其他格式三句只取 shared/error-copy 单源，
    // 只描述格式、不暴露该编号是否存在。
    throw errors.validation('partnerNo', ids.prefixHint(input.partnerNo).message);
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
    // 幂等重放：去重键按 DATA_MODEL §4.7 = bindings.activeKey（同顾客）；同顾客+同兼职再次提交
    //（网络重试 / 同 clientRequestId 重放）返回当前对象 + duplicated=true，不报错也不再写。
    if (existingBinding.partnerId === partner._id) {
      return {
        binding: bindingDto(existingBinding),
        partnerPublic: partnerPublic(partner, { bound: true }),
        duplicated: true
      };
    }
    // 换绑（不同兼职）仍需先 release（DATA_MODEL §12#7：已绑定再绑定 → CONFLICT）
    throw errors.conflict('你已绑定兼职，如需更换请先解绑');
  }
  const activeOrder = await identity.hasActiveOrder(ctx, scope.openid, '');
  if (activeOrder) {
    throw errors.invalidState('有进行中的订单，暂不能更换绑定');
  }

  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  let binding = null;
  try {
    // roomTag 事务分配（counters 自增 + bindings.add）：并发写冲突有界重试，非冲突错误仍走下方分支。
    binding = await tx.retryOnConflict(ctx.dao, async (trx) => bindCommon.createBindingInTx(trx, {
      customer,
      partner,
      nowMs,
      nowDate
    }), { requestId: ctx.requestId });
  } catch (error) {
    // 并发重复提交：activeKey 唯一索引兜底；冲突说明同一顾客的 ACTIVE 绑定已存在，读回后幂等返回
    if (!ctx.dao.isDuplicateError(error)) {
      throw error;
    }
    const raced = await identity.getActiveBinding(ctx, scope.openid);
    if (raced && raced.partnerId === partner._id) {
      return {
        binding: bindingDto(raced),
        partnerPublic: partnerPublic(partner, { bound: true }),
        duplicated: true
      };
    }
    throw errors.conflict('你已绑定兼职，如需更换请先解绑');
  }
  return {
    binding: bindingDto(binding),
    partnerPublic: partnerPublic(partner, { bound: true })
  };
}

module.exports = { handler };
