// handlers/order/acceptTransfer.js · order.acceptTransfer：目标兼职确认 → 事务改写订单归属（唯一改写点）
// 契约：草案 §1.3 行 2；改 partnerId/partnerOpenid/partnerNo + transfer 终态，status/statusUpdatedAt/acceptedAt 不变。
'use strict';

const store = require('./_store');
const transfer = require('./_transfer');

const ACTION = 'order.acceptTransfer';

// 幂等重放：同 clientRequestId 命中 → 当前 DTO + duplicated:true（不二次写归属/事件）
async function replayResult(ctx, order) {
  return {
    order: await transfer.viewOf(ctx, order, 'PARTNER', true),
    duplicated: true
  };
}

module.exports = async function orderAcceptTransfer(ctx, payload) {
  const info = await transfer.loadTransferContext(ctx, payload);
  const { partner, order, nowMs, config } = info;
  await transfer.consumeRate(ctx, config);
  const clientRequestId = transfer.clientRequestIdOf(ctx);
  const requestKey = transfer.requestKeyOf(order, ACTION, clientRequestId);
  if (await transfer.findActionEvent(ctx, requestKey)) {
    return replayResult(ctx, order);
  }
  // 目标独占：transfer.toPartnerId===me（不是当前 partnerId）；过期/状态已变由 loadTransferContext 先落 EXPIRED
  const pending = transfer.requirePendingTarget(order, partner);
  const nowDate = store.toDate(nowMs);
  const block = transfer.withResolutionOf(pending, transfer.STATUS.ACCEPTED, nowDate, transfer.REASON.TARGET_ACCEPTED);
  const patch = {
    partnerId: partner._id,
    partnerOpenid: partner.openid,
    partnerNo: partner.partnerNo,
    transfer: block
  };
  const event = transfer.actionEventOf(ctx, order, {
    action: ACTION,
    clientRequestId,
    type: 'TRANSFER_ACCEPTED',
    nowDate,
    payload: { fromPartnerNo: block.fromPartnerNo, toPartnerNo: block.toPartnerNo }
  });
  const result = await transfer.writeTransferAction(ctx, order, { patch, event, nowMs });
  // 完成后目标兼职即履约人：目标视角仍按 §1.4 遮蔽顾客昵称/头像/customerNo
  const body = { order: await transfer.viewOf(ctx, result.order, 'PARTNER', true) };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
};
