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
  const readWatermarkMs = common.watermarkMsOf(user);
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
    messageReadAt: readWatermarkMs > 0 ? new Date(readWatermarkMs).toISOString() : '',
    orderNo,
    side
  };
}

function itemTime(item) {
  const ms = item && item.at ? Date.parse(item.at) : 0;
  return isNaN(ms) ? 0 : ms;
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

// D29 未读口径：unread = 合并视图内「未读留言 + 未读状态事件」（公告/NOTICE/测试数据/软删单已在聚合时排除）；
// unreadMessages 为旧字段（仅 MESSAGE）供旧调用方；两者都与分页游标无关。
function unreadOf(all) {
  const isCounted = (item) => item.type === 'MESSAGE' || item.type === 'EVENT';
  return {
    unread: all.filter((item) => isCounted(item) && !item.read).length,
    unreadMessages: all.filter((item) => item.type === 'MESSAGE' && !item.read).length
  };
}

async function listCenter(ctx, payload) {
  const scope = common.scopeOf(ctx);
  if (scope.roles.length === 0) {
    throw common.errors.forbidden('当前身份没有消息中心');
  }
  const limit = common.parseLimit(payload);
  const cursor = common.parseCursor(payload);
  const user = await common.loadUser(ctx, scope.openid);
  const readWatermarkMs = common.watermarkMsOf(user);
  const config = await common.loadConfig(ctx);
  const orders = await common.myOrders(ctx, scope);
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
  const unread = unreadOf(all);
  return {
    list: page,
    nextCursor: sorted.length > limit && last ? common.makeListCursor(last) : null,
    messageReadAt: readWatermarkMs > 0 ? new Date(readWatermarkMs).toISOString() : '',
    unread: unread.unread,
    unreadMessages: unread.unreadMessages
  };
}

module.exports = async function messageList(ctx, payload) {
  const input = payload || {};
  if (typeof input.orderNo === 'string' && input.orderNo !== '') {
    return listOrderMessages(ctx, input);
  }
  return listCenter(ctx, input);
};
