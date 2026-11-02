// handlers/order/declineTransfer.js · order.declineTransfer：目标兼职拒收 → 只改 transfer 终态（归属零改动）
// 契约：草案 §1.3 行 3；事件 TRANSFER_DECLINED，orders.partnerId/partnerOpenid/partnerNo 全不变。
// P1-1：重放前读权限复检（拒收后目标仍可重放自己的结果，仅遮蔽视图；他人/原履约人按当前关系剪裁）。
'use strict';

const store = require('./_store');
const transfer = require('./_transfer');
const access = require('./_transfer-access');

const ACTION = 'order.declineTransfer';

async function replayResult(ctx, order, event) {
  const view = await access.replayViewOf(ctx, order, event);
  return {
    order: await transfer.viewOf(ctx, order, view.side, view),
    duplicated: true
  };
}

module.exports = async function orderDeclineTransfer(ctx, payload) {
  const info = await transfer.loadTransferContext(ctx, payload);
  const { partner, nowMs, config } = info;
  await transfer.consumeRate(ctx, config);
  const clientRequestId = transfer.clientRequestIdOf(ctx);
  const requestKey = transfer.requestKeyOf(info.order, ACTION, clientRequestId);
  const replayEvent = await transfer.findActionEvent(ctx, requestKey);
  if (replayEvent) {
    return replayResult(ctx, info.order, replayEvent);
  }
  access.assertExpectedVersion(ctx, info.order);
  const pending = transfer.requirePendingTarget(info.order, partner);
  const nowDate = store.toDate(nowMs);
  const block = transfer.withResolutionOf(pending, transfer.STATUS.DECLINED, nowDate, transfer.REASON.TARGET_DECLINED);
  const event = transfer.actionEventOf(ctx, info.order, {
    action: ACTION,
    clientRequestId,
    type: 'TRANSFER_DECLINED',
    nowDate,
    payload: { fromPartnerNo: block.fromPartnerNo, toPartnerNo: block.toPartnerNo }
  });
  const result = await transfer.writeTransferAction(ctx, info.order, { patch: { transfer: block }, event, nowMs });
  // 目标已不是履约人：按目标视角遮蔽（无 counterpart/customerNo），页面只做提示与刷新
  const body = { order: await transfer.viewOf(ctx, result.order, '', { transferTarget: true, maskCustomer: true }) };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
};
