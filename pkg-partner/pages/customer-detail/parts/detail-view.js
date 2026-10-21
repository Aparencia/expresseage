// pkg-partner/pages/customer-detail/parts/detail-view.js · 顾客详情视图装配（纯件：零 wx、零请求）
// 口径：docs/V4_UX_PARTNER.md §3.6（身份行/备注/自然日分组历史单/解绑资格/兼职编号小字）
//      档案+解绑资格 ← partner.getCustomer；历史单单一来源 ← order.listPartner({view:'customer'})
//      （两份接口的 orders/nextCursor 不双写：页面只消费 listPartner 的排序/游标，保证与工作台一致）
'use strict';

const customerView = require('../../../../utils/customer-view');
const orderState = require('../../../../shared/order-state');
const zones = require('../../../../shared/zones');
const unbindFlow = require('./unbind-flow');

const ORDERS_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_ORDER = ['today', 'yesterday', 'earlier'];
const DAY_LABEL = { today: '今天', yesterday: '昨天', earlier: '更早' };

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// 自然日分组：今天 / 昨天 / 更早（按服务端时间轴；页面传入已校时的 nowMs）
function dayKeyOf(ms, nowMs) {
  if (!ms) {
    return 'earlier';
  }
  const todayStart = startOfDay(nowMs);
  if (ms >= todayStart) {
    return 'today';
  }
  if (ms >= todayStart - DAY_MS) {
    return 'yesterday';
  }
  return 'earlier';
}

// dormKey → 苑/楼栋/宿舍（展示口径 §3；解析失败时逐级回落，不猜）
function buildDormParts(dormKey) {
  const parsed = zones.parseDormKey(textOf(dormKey));
  if (!parsed.ok) {
    return { zoneText: '', buildingText: '', roomText: '' };
  }
  return {
    zoneText: zones.zoneLabel(parsed.zone),
    buildingText: zones.buildingText(parsed.zone, parsed.buildingNo),
    roomText: parsed.room
  };
}

// 行时间：优先"该单走完的时间"，其次送达/创建；顺序与服务端 DTO 字段一致
function orderTimeOf(order) {
  const row = order || {};
  return customerView.toMs(row.completedAt) || customerView.toMs(row.cancelledAt)
    || customerView.toMs(row.deliveredAt) || customerView.toMs(row.createdAt);
}

// 历史单行：orderNo/状态中文/服务名/时间（状态文案取服务端 statusText，页面不自判）
// 行 DTO 复用 order.listPartner 的订单视图（服务名在 service.name；兼容扁平行）
function buildOrderRow(order) {
  const row = order || {};
  const ms = orderTimeOf(row);
  return {
    orderNo: textOf(row.orderNo),
    statusText: textOf(row.statusText),
    serviceName: textOf(row.serviceName) || textOf(row.service && row.service.name),
    timeText: ms ? customerView.timeText(ms) + ' ' + customerView.timeHM(ms) : ''
  };
}

// 每个自然日小计：已完成/进行中/已取消（由服务端 DTO 的 status 现算，仅用于分组行文案）
function summarize(rows) {
  let completed = 0;
  let active = 0;
  let cancelled = 0;
  listOf(rows).forEach((row) => {
    const status = (row && row.status) || '';
    if (status === orderState.STATUS.COMPLETED) {
      completed += 1;
    } else if (status === orderState.STATUS.CANCELLED) {
      cancelled += 1;
    } else if (orderState.isActiveStatus(status)) {
      active += 1;
    }
  });
  const parts = [];
  if (completed > 0) {
    parts.push('已完成 ' + completed);
  }
  if (active > 0) {
    parts.push('进行中 ' + active);
  }
  if (cancelled > 0) {
    parts.push('已取消 ' + cancelled);
  }
  return parts.join(' · ');
}

// 订单行 → 自然日分组（组内保持服务端 statusUpdatedAt desc 顺序，不再客户端排序）
function buildSections(orders, nowMs) {
  const buckets = { today: [], yesterday: [], earlier: [] };
  listOf(orders).forEach((order) => {
    const key = dayKeyOf(orderTimeOf(order), nowMs);
    buckets[key].push(order);
  });
  return DAY_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key: key,
    label: DAY_LABEL[key],
    summaryText: summarize(buckets[key]),
    rows: buckets[key].map(buildOrderRow)
  }));
}

// 游标分页合并（"查看更早"）：按 orderNo 去重，保持先来先显
function mergeOrderPages(existing, incoming) {
  const seen = {};
  const out = [];
  listOf(existing).concat(listOf(incoming)).forEach((order) => {
    const no = textOf(order && order.orderNo);
    if (!no || seen[no]) {
      return;
    }
    seen[no] = true;
    out.push(order);
  });
  return out;
}

// 档案+解绑资格：partner.getCustomer 只取这两块（其 orders 字段不消费，历史单走单一来源 listPartner）
function buildProfileQuery(bindingId) {
  return { bindingId: textOf(bindingId) };
}

// 历史订单单一来源：order.listPartner({view:'customer'})（服务端排序/游标/扫描窗与工作台一致）
function buildOrdersQuery(bindingId, cursor) {
  const query = { view: 'customer', bindingId: textOf(bindingId), limit: ORDERS_LIMIT };
  const next = textOf(cursor);
  if (next) {
    query.cursor = next;
  }
  return query;
}

function identityOf(customer) {
  const row = customerView.buildListRow(customer);
  const dorm = buildDormParts(row.dormKey);
  const boundMs = customerView.toMs(customer && customer.boundAt);
  return {
    bindingId: row.bindingId,
    customerNo: row.customerNo,
    avatarFileId: row.avatarFileId,
    displayName: row.displayName,
    displayNameText: row.displayNameText,
    anchorText: row.anchorText,
    anchorKeyText: row.anchorKeyText,
    phoneTailText: row.phoneTailText,
    activeOrderCount: row.activeOrderCount,
    activeOrderCountText: row.activeOrderCountText,
    partnerNote: row.partnerNote,
    zoneText: dorm.zoneText,
    buildingText: dorm.buildingText,
    roomText: dorm.roomText,
    boundAtText: boundMs ? customerView.timeText(boundMs) + ' ' + customerView.timeHM(boundMs) : ''
  };
}

// getCustomer(档案) + listPartner(view=customer) 订单页 → 页面快照
// 订单原始行由页面保留用于游标分页，这里只出分组视图；nextCursor 也来自订单接口（单一来源）
function buildSnapshot(data, options) {
  const opts = options || {};
  const source = data || {};
  const customer = source.customer || {};
  const rawOrders = listOf(opts.orders);
  const nextCursor = textOf(opts.nextCursor);
  const eligibility = source.unbindEligibility || {};
  return {
    view: identityOf(customer),
    sections: buildSections(rawOrders, typeof opts.nowMs === 'number' ? opts.nowMs : Date.now()),
    hasOrders: rawOrders.length > 0,
    emptyOrdersText: '还没有历史订单',
    nextCursor: nextCursor,
    showMore: nextCursor !== '',
    moreText: opts.loadingMore === true ? '正在加载…' : '查看更早',
    unbind: unbindFlow.buildBlock(customer, eligibility, { readonly: opts.readonly === true }),
    partnerNo: textOf(source.partnerNo)
  };
}

module.exports = {
  DAY_LABEL,
  ORDERS_LIMIT,
  buildDormParts,
  buildOrderRow,
  buildOrdersQuery,
  buildProfileQuery,
  buildSections,
  buildSnapshot,
  dayKeyOf,
  identityOf,
  mergeOrderPages,
  orderTimeOf,
  summarize
};
