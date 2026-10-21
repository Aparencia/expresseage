// handlers/message/markRead.js · message.markRead：已读水位只前进（users.messageReadAt）
// scope='ORDER' 时同时把该订单内「对方发来的未读留言」置 readAt；重复调用自然幂等。
'use strict';

const common = require('./_common');

function forward(prev, nextMs) {
  const prevMs = common.time.toMs(prev);
  return nextMs > prevMs ? nextMs : prevMs;
}

async function markOrderMessagesRead(ctx, orderNo, nowDate) {
  const scope = common.scopeOf(ctx);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertParticipant(ctx, order);
  // CONTRACT §10 权限矩阵：开发者对订单留言仅只读（工单），不得改写对方已读状态。
  if (side === 'ADMIN') {
    throw common.errors.forbidden('后台不能代操作订单留言');
  }
  const messages = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: order._id },
    limit: 100
  });
  let updated = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.readAt) {
      continue;
    }
    if (message.fromId === scope.openid) {
      continue;
    }
    await ctx.dao.update(common.COLLECTIONS.ORDER_MESSAGES, message._id, { readAt: nowDate });
    updated += 1;
  }
  return updated;
}

module.exports = async function messageMarkRead(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const input = payload || {};
  const mode = typeof input.scope === 'string' ? input.scope.trim().toUpperCase() : '';
  if (mode !== 'ALL' && mode !== 'ORDER') {
    throw common.errors.validation('scope', '请选择已读范围');
  }
  const now = common.nowMsOf(ctx);
  const nowDate = new Date(now);
  let orderMessagesRead = 0;
  if (mode === 'ORDER') {
    const orderNo = common.normalizeOrderNoInput(input.orderNo);
    orderMessagesRead = await markOrderMessagesRead(ctx, orderNo, nowDate);
  }
  const user = await common.loadUser(ctx, scope.openid);
  const nextReadAt = forward(user && user.messageReadAt, now);
  await ctx.dao.update(common.COLLECTIONS.USERS, scope.openid, {
    messageReadAt: new Date(nextReadAt),
    updatedAt: nowDate
  });
  return {
    messageReadAt: common.toIso(nextReadAt),
    orderMessagesRead
  };
};
