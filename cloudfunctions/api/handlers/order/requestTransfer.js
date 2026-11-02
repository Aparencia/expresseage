// handlers/order/requestTransfer.js · order.requestTransfer：ACCEPTED 且一件未取时凭目标完整 partnerNo 发起转派
// 契约：草案 §1.3 行 1 + 裁决 Q3/Q8/Q9；事务只写 orders.transfer + version/updatedAt（status/partnerId 零改动）。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const store = require('./_store');
const transfer = require('./_transfer');

const ACTION = 'order.requestTransfer';

// 目标可用性：不存在/已注销 → NOT_FOUND（不暴露存在性）；SUSPENDED → PARTNER_CLOSED（Q8：仅校验 ACTIVE）
async function loadTarget(ctx, toPartnerNo) {
  const target = await ctx.dao.findOne(store.COLLECTIONS.PARTNERS, { where: { partnerNo: toPartnerNo } });
  if (!target || target.deletedAt || target.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.notFound('目标兼职不存在');
  }
  if (target.status !== enums.PARTNER_STATUS.ACTIVE) {
    throw errors.partnerClosed('目标兼职已停用，无法转派');
  }
  return target;
}

// 真实×测试隔离（CONTRACT §4.2:212）：发起方与目标账号类型必须一致，否则 FORBIDDEN（orders 零写入）
async function sameAccountSide(ctx, meOpenid, targetOpenid) {
  const me = await store.getUser(ctx, meOpenid);
  const target = await store.getUser(ctx, targetOpenid);
  return (me && me.isTestAccount === true) === (target && target.isTestAccount === true);
}

// Q9：主兼职可转任意 ACTIVE；子队员只可转本队（主兼职本人或同队子队员）
function assertTeamScope(myPartner, target) {
  const myParent = transfer.textOf(myPartner.parentPartnerId);
  if (!myParent) {
    return;
  }
  const targetParent = transfer.textOf(target.parentPartnerId);
  const isMyParent = transfer.sameId(target._id, myParent);
  const sameTeam = targetParent !== '' && targetParent === myParent;
  if (!isMyParent && !sameTeam) {
    throw errors.forbidden('子队员只能转派给本队成员');
  }
}

// 状态守卫链（顺序 = 工单 §2.1）：本人履约人 → ACCEPTED → 一件未取 → 无进行中邀请
async function loadCheckedTarget(ctx, info, payload) {
  const order = info.order;
  const partner = info.partner;
  transfer.assertOwner(order, partner);
  if (order.status !== enums.ORDER_STATUS.ACCEPTED) {
    throw errors.invalidState('只有已接单且未取件的订单可以转派');
  }
  if (transfer.hasPickedAny(order)) {
    throw errors.invalidState('已有包裹取件，不能转派');
  }
  if (transfer.isPending(order)) {
    throw errors.invalidState('已有转派进行中');
  }
  const toPartnerNo = transfer.readToPartnerNo(payload);
  const target = await loadTarget(ctx, toPartnerNo);
  if (transfer.sameId(target._id, partner._id)) {
    throw errors.validation('toPartnerNo', '不能转派给自己');
  }
  if (!(await sameAccountSide(ctx, partner.openid, target.openid))) {
    throw errors.forbidden('真实与测试账号之间不能转派');
  }
  assertTeamScope(partner, target);
  return target;
}

// 幂等重放：同 clientRequestId/same (from,to) → 返回当前 DTO + duplicated:true（零二次写）
async function duplicatedResult(ctx, order) {
  return {
    order: await transfer.viewOf(ctx, order, 'PARTNER', false),
    transfer: transfer.blockOf(order, 'PARTNER'),
    duplicated: true
  };
}

// 事务编排（从主函数拆出控单函数行数）：写 orders.transfer + TRANSFER_REQUESTED，返回 DTO + transfer 块
async function writeRequest(ctx, info, target) {
  const partner = info.partner;
  const order = info.order;
  const nowMs = info.nowMs;
  const block = {
    status: transfer.STATUS.PENDING,
    fromPartnerId: partner._id,
    fromPartnerNo: partner.partnerNo,
    toPartnerId: target._id,
    toPartnerNo: target.partnerNo,
    requestedAt: store.toDate(nowMs),
    expiresAt: new Date(nowMs + transfer.ttlMinutesOf(info.config) * transfer.MINUTE_MS),
    resolvedAt: '',
    resolveReason: ''
  };
  const event = transfer.actionEventOf(ctx, order, {
    action: ACTION,
    clientRequestId: info.clientRequestId,
    type: 'TRANSFER_REQUESTED',
    nowDate: store.toDate(nowMs),
    payload: {
      fromPartnerNo: block.fromPartnerNo,
      toPartnerNo: block.toPartnerNo,
      expiresAt: block.expiresAt
    }
  });
  const result = await transfer.writeTransferAction(ctx, order, { patch: { transfer: block }, event, nowMs });
  const body = {
    order: await transfer.viewOf(ctx, result.order, 'PARTNER', false),
    transfer: transfer.blockOf(result.order, 'PARTNER')
  };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
}

module.exports = async function orderRequestTransfer(ctx, payload) {
  const info = await transfer.loadTransferContext(ctx, payload);
  await transfer.consumeRate(ctx, info.config);
  info.clientRequestId = transfer.clientRequestIdOf(ctx);
  const requestKey = transfer.requestKeyOf(info.order, ACTION, info.clientRequestId);
  if (await transfer.findActionEvent(ctx, requestKey)) {
    return duplicatedResult(ctx, info.order);
  }
  const target = await loadCheckedTarget(ctx, info, payload);
  return writeRequest(ctx, info, target);
};
