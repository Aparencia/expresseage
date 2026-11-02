// handlers/order/declineTransfer.js · order.declineTransfer：目标兼职拒收 → 只改 transfer 终态（归属零改动）
// 契约：草案 §1.3 行 3；事件 TRANSFER_DECLINED，orders.partnerId/partnerOpenid/partnerNo 全不变。
'use strict';

const store = require('./_store');
const transfer = require('./_transfer');

const ACTION = 'order.declineTransfer';

async function replayResult(ctx, order) {
  return {
    order: await transfer.viewOf(ctx, order, '', true),
    duplicated: true
  };
}

module.exports = async function orderDeclineTransfer(ctx, payload) {
  const info = await transfer.loadTransferContext(ctx, payload);
  const { partner, order, nowMs, config } = info;
  await transfer.consumeRate(ctx, config);
  const clientRequestId = transfer.clientRequestIdOf(ctx);
  const requestKey = transfer.requestKeyOf(order, ACTION, clientRequestId);
  if (await transfer.findActionEvent(ctx, requestKey)) {
    return replayResult(ctx, order);
  }
  const pending = transfer.requirePendingTarget(order, partner);
  const nowDate = store.toDate(nowMs);
  const block = transfer.withResolutionOf(pending, transfer.STATUS.DECLINED, nowDate, transfer.REASON.TARGET_DECLINED);
  const event = transfer.actionEventOf(ctx, order, {
    action: ACTION,
    clientRequestId,
    type: 'TRANSFER_DECLINED',
    nowDate,
    payload: { fromPartnerNo: block.fromPartnerNo, toPartnerNo: block.toPartnerNo }
  });
  const result = await transfer.writeTransferAction(ctx, order, { patch: { transfer: block }, event, nowMs });
  // 目标已不是履约人：按目标视角遮蔽（无 counterpart/customerNo），页面只做提示与刷新
  const body = { order: await transfer.viewOf(ctx, result.order, '', true) };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
};
