// handlers/message/list.js · message.list：订单留言 / 消息中心聚合
// 订单模式：{orderNo,cursor?,limit?} → 该订单留言倒序；消息中心模式：{cursor?,limit?} → 状态事件 + 留言 + 公告。
// 只读：切换会话 READONLY/TEST_WRITE 白名单内可读（目标本人视角）。
'use strict';

const common = require('./_common');
const review = require('../order/_review');

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
  const partnerIds = [];
  bindings.forEach((binding) => {
    if (binding.partnerId && partnerIds.indexOf(binding.partnerId) < 0) {
      partnerIds.push(binding.partnerId);
    }
  });
  if (partnerIds.length === 0) {
    return [];
  }
  // P0-13：逐绑定查兼职改为一次 `_id in` 批量，再按绑定顺序回填（归属过滤口径不变）。
  const partners = await ctx.dao.find(common.COLLECTIONS.PARTNERS, {
    where: { _id: ctx.dao.command('in', partnerIds) },
    limit: partnerIds.length
  });
  const byId = {};
  partners.forEach((partner) => {
    byId[partner._id] = partner;
  });
  const openids = [];
  partnerIds.forEach((partnerId) => {
    const partner = byId[partnerId];
    if (partner && typeof partner.openid === 'string' && partner.openid && openids.indexOf(partner.openid) < 0) {
      openids.push(partner.openid);
    }
  });
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

// D58（批 26）：消息中心/红点拉黑 4 个私有转派事件——**仅顾客侧**拉黑；兼职侧全量留痕（发起/撤回/拒收/过期）。
// P2-8：按订单侧别过滤（同一双角色账号在两单里可以是不同侧，不能按全局角色一刀切）。
// D92：审核事件（ORDER_CORRECTED + payload.reviewStatus/reviewParcels）属内部动作，顾客侧不展示、不计未读。
function visibleEventRowsOf(events, side) {
  const hidden = side === 'CUSTOMER' ? (common.enums.MESSAGE_HIDDEN_EVENT_TYPES || []) : [];
  return (Array.isArray(events) ? events : [])
    .filter((event) => hidden.indexOf(event.type) < 0)
    .filter((event) => !(side === 'CUSTOMER' && review.isReviewEventOf(event)));
}

// D58：TRANSFER_ACCEPTED 给可理解人话（CONTRACT §5.4「由 P-XXX-XXX 接手履约」；服务端单源 title，
// 不退化成状态名「已接单」）。编号来自事件 payload 的 toPartnerNo 快照（无 openid/内部 id）。
const TRANSFER_ACCEPTED_TITLE = '订单已转派';

function eventItemOf(scope, orderNo, event, readWatermarkMs) {
  const item = common.buildEventItem(scope, orderNo, event, readWatermarkMs);
  if (event && event.type === 'TRANSFER_ACCEPTED') {
    const toPartnerNo = common.textOf(event.payload && event.payload.toPartnerNo);
    item.title = TRANSFER_ACCEPTED_TITLE;
    item.text = toPartnerNo ? '由 ' + toPartnerNo + ' 接手履约' : '订单已由其他兼职接手履约';
  }
  return item;
}

// P0-13（2026-11-26 性能审查）：逐单「事件 + 留言」两条查询互不依赖，按并发 5 分波并行；
// 结果仍按 recentOrders 顺序、单内「事件在前留言在后」归并（排序/分页语义与串行版逐字一致。
const PER_ORDER_CONCURRENCY = 5;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workerCount = Math.min(limit, items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function perOrderItems(ctx, scope, order, readWatermarkMs) {
  const orderNo = order.orderNo || '';
  const [events, messages] = await Promise.all([
    ctx.dao.find(common.COLLECTIONS.ORDER_EVENTS, {
      where: { orderId: order._id },
      orderBy: [['at', 'desc']],
      limit: common.EVENTS_PER_ORDER
    }),
    ctx.dao.find(common.COLLECTIONS.ORDER_MESSAGES, {
      where: { orderId: order._id },
      orderBy: [['createdAt', 'desc']],
      limit: common.MESSAGES_PER_ORDER
    })
  ]);
  const side = common.orderSideOf(ctx, order);
  const rows = [];
  visibleEventRowsOf(events, side).forEach((event) => {
    rows.push(eventItemOf(scope, orderNo, event, readWatermarkMs));
  });
  messages.forEach((message) => {
    rows.push(common.buildMessageItem(scope, orderNo, message));
  });
  return rows;
}

async function collectOrderItems(ctx, scope, recentOrders, readWatermarkMs) {
  const perOrder = await mapLimit(recentOrders, PER_ORDER_CONCURRENCY,
    (order) => perOrderItems(ctx, scope, order, readWatermarkMs));
  const items = [];
  perOrder.forEach((rows) => rows.forEach((item) => items.push(item)));
  return items;
}

async function listCenter(ctx, payload) {
  const scope = common.scopeOf(ctx);
  if (scope.roles.length === 0) {
    throw common.errors.forbidden('当前身份没有消息中心');
  }
  const limit = common.parseLimit(payload);
  const cursor = common.parseCursor(payload);
  const [user, orders] = await Promise.all([
    common.loadUser(ctx, scope.openid),
    common.myOrders(ctx, scope)
  ]);
  const readWatermarkMs = common.watermarkMsOf(user);
  const config = await common.loadConfig(ctx);
  const recentOrders = orders
    .filter((order) => !order.deletedByCustomerAt)
    .slice(0, common.MAX_ORDERS_SCAN);
  const items = await collectOrderItems(ctx, scope, recentOrders, readWatermarkMs);
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
