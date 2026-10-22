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
  common.assertTestOrderVisible(ctx, order);
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

async function customerOrders(ctx, scope, isTest) {
  return ctx.dao.find(common.COLLECTIONS.ORDERS, {
    where: { customerId: scope.openid, isTest },
    orderBy: [['statusUpdatedAt', 'desc']],
    limit: common.MAX_ORDERS_SCAN
  });
}

async function partnerOrders(ctx, scope, isTest) {
  const partner = await ctx.dao.findOne(common.COLLECTIONS.PARTNERS, {
    where: { openid: scope.openid }
  });
  if (!partner) {
    return [];
  }
  return ctx.dao.find(common.COLLECTIONS.ORDERS, {
    where: { partnerId: partner._id, isTest },
    orderBy: [['statusUpdatedAt', 'desc']],
    limit: common.MAX_ORDERS_SCAN
  });
}

// 我的订单 = users.roles 含哪侧就取哪侧（双角色两侧合并去重，不依赖 activeRole）
async function myOrders(ctx, scope) {
  const isTest = scope.testWrite;
  const roles = Array.isArray(scope.roles) ? scope.roles : [];
  const lists = [];
  if (roles.indexOf(common.enums.ROLES.CUSTOMER) >= 0) {
    lists.push(await customerOrders(ctx, scope, isTest));
  }
  if (roles.indexOf(common.enums.ROLES.PARTNER) >= 0) {
    lists.push(await partnerOrders(ctx, scope, isTest));
  }
  if (lists.length !== 2) {
    return lists.length === 1 ? lists[0] : [];
  }
  const seen = {};
  const merged = [];
  lists.forEach((list) => list.forEach((order) => {
    const key = String(order._id || '');
    if (!key || seen[key]) {
      return;
    }
    seen[key] = true;
    merged.push(order);
  }));
  merged.sort((left, right) => common.time.toMs(right.statusUpdatedAt) - common.time.toMs(left.statusUpdatedAt));
  return merged;
}

async function customerPartnerOpenids(ctx, scope) {
  const bindings = await ctx.dao.find(common.COLLECTIONS.BINDINGS, {
    where: { customerId: scope.openid },
    limit: 20
  });
  const openids = [];
  for (let i = 0; i < bindings.length; i += 1) {
    const partner = await ctx.dao.get(common.COLLECTIONS.PARTNERS, bindings[i].partnerId);
    if (partner && typeof partner.openid === 'string' && partner.openid && openids.indexOf(partner.openid) < 0) {
      openids.push(partner.openid);
    }
  }
  return openids;
}

// 系统通知：orderId=''（解绑/停用等无关联订单的通知），按历史绑定兼职来源过滤归属
async function systemNoticeItems(ctx, scope) {
  const roles = Array.isArray(scope.roles) ? scope.roles : [];
  if (roles.indexOf(common.enums.ROLES.CUSTOMER) < 0) {
    return [];
  }
  const partnerOpenids = await customerPartnerOpenids(ctx, scope);
  if (partnerOpenids.length === 0) {
    return [];
  }
  const rows = await ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: '' },
    orderBy: [['createdAt', 'desc']],
    limit: 30
  });
  return rows
    .filter((row) => (row.isTest === true) === common.isTestSession(ctx))
    .filter((row) => partnerOpenids.indexOf(row.fromId) >= 0)
    .map((row) => common.buildMessageItem(scope, '', row));
}

async function listCenter(ctx, payload) {
  const scope = common.scopeOf(ctx);
  if (scope.roles.length === 0) {
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
  const notices = await systemNoticeItems(ctx, scope);
  notices.forEach((notice) => items.push(notice));
  const all = common.sortItemsDesc(items);
  const sorted = all.filter((item) => common.afterCursor(item, cursor));
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];
  // 未读数与分页游标无关（DATA_MODEL §5.2：未读 = 合并视图内 order_messages.readAt=null 的计数）
  const unreadMessages = all.filter((item) => item.type === 'MESSAGE' && !item.read).length;
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
