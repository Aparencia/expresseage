// handlers/message/send.js · message.send：订单留言（双方，text ≤200，过内容安全；30 条/日/单由中间件限流）
// 幂等：order_messages.requestKey={orderId}:message.send:{clientRequestId}（同键重放返回原留言 + duplicated）。
// 状态闸（批 5 契约 D）：只有进行中五态可发；COMPLETED/CANCELLED 只读归档 → INVALID_TRANSITION
// （与 order.get 顾客 actions 矩阵一致：终态不再给 message 动作；文案由 shared/error-copy 兜底）。
'use strict';

const common = require('./_common');

// 可留言状态 = 进行中五态（SUBMITTED/ACCEPTED/PICKED/DELIVERED/EXCEPTION；异常单可留言）
function canSendMessage(status) {
  return common.enums.ORDER_ACTIVE_STATUSES.indexOf(status) >= 0;
}

module.exports = async function messageSend(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const input = payload || {};
  const orderNo = common.normalizeOrderNoInput(input.orderNo);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertParticipant(ctx, order);
  common.assertTestOrderVisible(ctx, order);
  if (side === 'ADMIN') {
    throw common.errors.forbidden('后台不能代发订单留言');
  }
  const textResult = common.passOrThrow(common.validate.validateMessageText(input.text));
  await common.checkContentSecurity(ctx, textResult.value, 'text');
  const clientRequestId = ctx.clientRequestId || '';
  const requestKey = [String(order._id), 'message.send', clientRequestId].join(':');
  const existing = await ctx.dao.findOne(common.COLLECTIONS.ORDER_MESSAGES, { where: { requestKey } });
  if (existing) {
    return { message: common.buildMessageItem(scope, orderNo, existing), duplicated: true };
  }
  if (!canSendMessage(order.status)) {
    throw common.errors.invalidTransition();
  }
  const now = common.nowMsOf(ctx);
  const doc = {
    orderId: order._id,
    fromRole: side,
    fromId: scope.openid,
    text: textResult.value,
    templateCode: typeof input.templateCode === 'string' && input.templateCode.trim()
      ? input.templateCode.trim().slice(0, 40)
      : null,
    createdAt: new Date(now),
    readAt: null,
    requestKey
  };
  const added = await ctx.dao.add(common.COLLECTIONS.ORDER_MESSAGES, doc);
  return {
    message: common.buildMessageItem(scope, orderNo, Object.assign({}, doc, { _id: added._id }))
  };
};
