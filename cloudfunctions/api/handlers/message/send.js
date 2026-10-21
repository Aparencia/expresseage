// handlers/message/send.js · message.send：订单留言（双方，text ≤200，过内容安全；30 条/日/单由中间件限流）
// 幂等：order_messages.requestKey={orderId}:message.send:{clientRequestId}（同键重放返回原留言 + duplicated）。
'use strict';

const common = require('./_common');

module.exports = async function messageSend(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const input = payload || {};
  const orderNo = common.normalizeOrderNoInput(input.orderNo);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertParticipant(ctx, order);
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
