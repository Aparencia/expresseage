// handlers/message/list.js · message.list：订单留言 / 消息中心聚合
// 订单模式：{orderNo,cursor?,limit?} → 该订单留言倒序；消息中心模式：{cursor?,limit?} → 状态事件 + 留言 + 公告。
// 只读：切换会话 READONLY/TEST_WRITE 白名单内可读（目标本人视角）。
'use strict';

const common = require('./_common');

async function listOrderMessages(ctx, payload) {
  const scope = common.scopeOf(ctx);
  const orderNo = common.normalizeOrderNoInput(payload.orderNo);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertParticipant(ctx, order);
  const limit = common.parseLimit(payload);
  const cursor = common.parseCursor(payload);
  const rows = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: order._id },
    orderBy: [['createdAt', 'desc']],
    limit: Math.min(limit * 3, 200)
  });
  const items = rows
    .map((message) => Object.assign(common.buildMessageItem(scope, orderNo, message), {
      _id: String(message._id || '')
    }))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const filtered = items.filter((item) => {
    if (!cursor) {
      return true;
    }
    const ms = itemTime(item);
    if (ms !== cursor.sortValue) {
      return ms < cursor.sortValue;
    }
    return item._id < cursor.tie;
  });
  const page = filtered.slice(0, limit);
  const user = await common.loadUser(ctx, scope.openid);
  const last = page[page.length - 1];
  return {
    list: page.map((item) => {
      const copy = Object.assign({}, item);
      delete copy._id;
      return copy;
    }),
    nextCursor: filtered.length > limit && last
      ? { sortValue: itemTime(last), tie: last._id }
      : null,
    messageReadAt: common.toIso(user && user.messageReadAt),
    orderNo,
    side
  };
}

function itemTime(item) {
  const ms = item && item.at ? Date.parse(item.at) : 0;
  return isNaN(ms) ? 0 : ms;
}

async function myOrders(ctx, scope) {
  if (scope.role === common.enums.ROLES.CUSTOMER) {
    return ctx.dao.find(common.COLLECTIONS.ORDERS, {
      where: { customerId: scope.openid },
      orderBy: [['statusUpdatedAt', 'desc']],
      limit: common.MAX_ORDERS_SCAN
    });
  }
  if (scope.role === common.enums.ROLES.PARTNER) {
    const partner = await ctx.dao.findOne(common.COLLECTIONS.PARTNERS, {
      where: { openid: scope.openid }
    });
    if (!partner) {
      return [];
    }
    return ctx.dao.find(common.COLLECTIONS.ORDERS, {
      where: { partnerId: partner._id },
      orderBy: [['statusUpdatedAt', 'desc']],
      limit: common.MAX_ORDERS_SCAN
    });
  }
  return [];
}

async function listCenter(ctx, payload) {
  const scope = common.scopeOf(ctx);
  if (scope.role !== common.enums.ROLES.CUSTOMER && scope.role !== common.enums.ROLES.PARTNER) {
    throw common.errors.forbidden('当前身份没有消息中心');
  }
  const limit = common.parseLimit(payload);
  const cursor = common.parseCursor(payload);
  const user = await common.loadUser(ctx, scope.openid);
  const readWatermarkMs = common.time.toMs(user && user.messageReadAt);
  const config = await common.loadConfig(ctx);
  const orders = await myOrders(ctx, scope);
  const items = [];
  const recentOrders = orders
    .filter((order) => !order.deletedByCustomerAt)
    .slice(0, common.MAX_ORDERS_SCAN);
  for (let i = 0; i < recentOrders.length; i += 1) {
    const order = recentOrders[i];
    const orderNo = order.orderNo || '';
    const events = await ctx.dao.find(common.COLLECTIONS.ORDER_EVENTS, {
      where: { orderId: order._id },
      orderBy: [['at', 'desc']],
      limit: common.EVENTS_PER_ORDER
    });
    events.forEach((event) => {
      items.push(common.buildEventItem(scope, orderNo, event, readWatermarkMs));
    });
    const messages = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
      where: { orderId: order._id },
      orderBy: [['createdAt', 'desc']],
      limit: common.MESSAGES_PER_ORDER
    });
    messages.forEach((message) => {
      items.push(common.buildMessageItem(scope, orderNo, message));
    });
  }
  const announcement = common.buildAnnouncementItem(config);
  if (announcement) {
    items.push(announcement);
  }
  const sorted = common.sortItemsDesc(items).filter((item) => common.afterCursor(item, cursor));
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];
  const unreadMessages = sorted.filter((item) => item.type === 'MESSAGE' && !item.read).length;
  return {
    list: page,
    nextCursor: sorted.length > limit && last ? common.makeListCursor(last) : null,
    messageReadAt: common.toIso(user && user.messageReadAt),
    unread: unreadMessages,
    unreadMessages
  };
}

module.exports = async function messageList(ctx, payload) {
  const input = payload || {};
  if (typeof input.orderNo === 'string' && input.orderNo !== '') {
    return listOrderMessages(ctx, input);
  }
  return listCenter(ctx, input);
};
