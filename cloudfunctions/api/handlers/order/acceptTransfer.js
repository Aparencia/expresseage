// handlers/order/acceptTransfer.js · order.acceptTransfer：目标兼职确认 → 事务改写订单归属（唯一改写点）
// 契约：草案 §1.3 行 2；改 partnerId/partnerOpenid/partnerNo + transfer 终态，status/statusUpdatedAt/acceptedAt 不变。
// P1-1：幂等重放先做读权限复检（原履约人转派完成后重放旧 crid → FORBIDDEN）；P1-2：已取件邀请先落终态再拒。
'use strict';

const { errors } = require('../../lib/errors');
const store = require('./_store');
const transfer = require('./_transfer');
const access = require('./_transfer-access');
const expire = require('./_transfer-expire');

const ACTION = 'order.acceptTransfer';

// 幂等重放：同 clientRequestId 命中 → 当前可读视图 + duplicated:true（不二次写归属/事件）
async function replayResult(ctx, order, event) {
  const view = await access.replayViewOf(ctx, order, event);
  return {
    order: await transfer.viewOf(ctx, order, view.side, view),
    duplicated: true
  };
}

module.exports = async function orderAcceptTransfer(ctx, payload) {
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
  let order = info.order;
  // P1-2：D61 件级取件下订单可能仍 ACCEPTED 却已有件被取 → 同一事务把邀请落 EXPIRED/STATE_CHANGED，再报 INVALID_STATE
  if (transfer.isPending(order) && transfer.hasPickedAny(order)) {
    order = await expire.expireForPicked(ctx, order, nowMs);
    if (transfer.hasPickedAny(order)) {
      throw errors.invalidState('已有包裹取件，邀请已失效');
    }
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
  // 完成后目标兼职即履约人：动作条回正常 PARTNER 矩阵（P0-1），顾客身份仍按 §1.4 遮蔽（P2-11）
  const body = {
    order: await transfer.viewOf(ctx, result.order, 'PARTNER', {
      maskCustomer: await access.maskCustomerOf(ctx, result.order, partner)
    })
  };
  if (result.duplicated) {
    body.duplicated = true;
  }
  return body;
};
