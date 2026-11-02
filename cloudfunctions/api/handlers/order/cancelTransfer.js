// handlers/order/cancelTransfer.js · order.cancelTransfer：发起方撤回转派 → 只改 transfer 终态（归属零改动）
// 契约：草案 §1.3 行 4；守卫 = 仍为履约人（order.partnerId===me）且有本人发起的 PENDING 邀请。
'use strict';

const { errors } = require('../../lib/errors');
const store = require('./_store');
const transfer = require('./_transfer');

const ACTION = 'order.cancelTransfer';

async function replayResult(ctx, order) {
  return {
    order: await transfer.viewOf(ctx, order, 'PARTNER', false),
    duplicated: true
  };
}

// 撤回国只认本人发起的 PENDING（他人邀请一律 INVALID_STATE，不回带其存在性细节）
function requireCancelable(order, partner) {
  const block = transfer.transferOf(order);
  if (!block || block.status !== transfer.STATUS.PENDING || !transfer.sameId(block.fromPartnerId, partner._id)) {
    throw errors.invalidState('没有可撤回的转派邀请');
  }
  return block;
}

module.exports = async function orderCancelTransfer(ctx, payload) {
  const info = await transfer.loadTransferContext(ctx, payload);
  const { partner, order, nowMs, config } = info;
  await transfer.consumeRate(ctx, config);
  const clientRequestId = transfer.clientRequestIdOf(ctx);
  const requestKey = transfer.requestKeyOf(order, ACTION, clientRequestId);
  if (await transfer.findActionEvent(ctx, requestKey)) {
    return replayResult(ctx, order);
  }
  transfer.assertOwner(order, partner);
  const pending = requireCancelable(order, partner);
  const nowDate = store.toDate(nowMs);
  const block = transfer.withResolutionOf(pending, transfer.STATUS.CANCELLED, nowDate, transfer.REASON.FROM_CANCELLED);
  const event = transfer.actionEventOf(ctx, order, {
    action: ACTION,
    clientRequestId,
    type: 'TRANSFER_CANCELLED',
    nowDate,
    payload: { fromPartnerNo: block.fromPartnerNo, toPartnerNo: block.toPartnerNo }
  });
  const result = await transfer.writeTransferAction(ctx, order, { patch: { transfer: block }, event, nowMs });
  const body = { order: await transfer.viewOf(ctx, result.order, 'PARTNER', false) };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
};
