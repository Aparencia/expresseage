// handlers/message/markRead.js · message.markRead：已读水位只前进（users.messageReadAt）+ 留言置读（D29）
// scope='ORDER'：该单对方未读留言置 readAt；scope='ALL'：本人订单集内对方未读留言置 readAt（清空红点）。
// 水位读-判-写全部在 ctx.dao.transaction 内（CAS：prev<now 才条件写，只进不退）；并发被先行推进时
// 以事务内读到的更大值为准（事务串行化 + 旧值等值条件写兜底，条件写落空则重读重试）。
'use strict';

const common = require('./_common');

const CAS_ATTEMPTS = 3;
const MESSAGES_SCAN_LIMIT = 100;

// CAS 条件：只在「读到的那份旧水位」上换新值；字段缺失时用 exists(false) 兜底（避免换掉并发写入）。
function watermarkWhere(trx, openid, user) {
  const raw = user ? user.messageReadAt : undefined;
  if (raw === undefined) {
    return { _id: openid, messageReadAt: trx.command('exists', false) };
  }
  return { _id: openid, messageReadAt: raw };
}

// 事务内前进水位：读 user → next=max(prev,now) → 仅当 next>prev 时写；条件写落空（并发已改）则重读。
async function advanceWatermark(ctx, openid, nowMs) {
  const nowDate = new Date(nowMs);
  return ctx.dao.transaction(async (trx) => {
    let seenMs = 0;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const user = await trx.get(common.COLLECTIONS.USERS, openid);
      if (!user) {
        return { messageReadAt: nowMs };
      }
      const prevMs = common.watermarkMsOf(user);
      seenMs = Math.max(seenMs, prevMs);
      if (nowMs <= prevMs) {
        return { messageReadAt: prevMs };
      }
      const updated = await trx.updateWhere(common.COLLECTIONS.USERS,
        watermarkWhere(trx, openid, user), { messageReadAt: nowDate, updatedAt: nowDate });
      if (updated && updated.updated === 1) {
        return { messageReadAt: nowMs };
      }
    }
    return { messageReadAt: Math.max(seenMs, nowMs) };
  });
}

// 对方发来的未读留言置 readAt（fromId=本人 effectiveOpenid 的留言不写；已读幂等跳过）。
async function markMessagesRead(ctx, scope, messages, nowDate) {
  let updated = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.readAt || message.fromId === scope.openid) {
      continue;
    }
    await ctx.dao.update(common.COLLECTIONS.ORDER_MESSAGES, message._id, { readAt: nowDate });
    updated += 1;
  }
  return updated;
}

async function markOrderMessagesRead(ctx, scope, orderNo, nowDate) {
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertParticipant(ctx, order);
  // CONTRACT §10 权限矩阵：开发者对订单留言仅只读（工单），不得改写对方已读状态。
  if (side === 'ADMIN') {
    throw common.errors.forbidden('后台不能代操作订单留言');
  }
  const messages = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: order._id },
    limit: MESSAGES_SCAN_LIMIT
  });
  return markMessagesRead(ctx, scope, messages, nowDate);
}

// ALL：与消息中心聚合同一「本人最近订单」扫描集，置读其中对方未读留言（已软删单不进消息中心，跳过）。
async function markAllMessagesRead(ctx, scope, nowDate) {
  const orders = await common.myOrders(ctx, scope);
  let updated = 0;
  for (let i = 0; i < orders.length; i += 1) {
    const order = orders[i];
    if (order.deletedByCustomerAt) {
      continue;
    }
    const messages = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
      where: { orderId: order._id },
      limit: MESSAGES_SCAN_LIMIT
    });
    updated += await markMessagesRead(ctx, scope, messages, nowDate);
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
    orderMessagesRead = await markOrderMessagesRead(ctx, scope, orderNo, nowDate);
  } else {
    orderMessagesRead = await markAllMessagesRead(ctx, scope, nowDate);
  }
  const advanced = await advanceWatermark(ctx, scope.openid, now);
  return {
    messageReadAt: common.toIso(advanced.messageReadAt),
    orderMessagesRead
  };
};
