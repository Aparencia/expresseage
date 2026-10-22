// pages/customer/parts/orders-view.js · 顾客订单列表视图模型（纯件，零 wx）
// 口径：docs/V4_UX_CUSTOMER.md §3.4/§5.1/§5.7/§8.2；AC-C-21/22/30；CONTRACT §5.2（服务端排序，客户端不重排）
// 页面层零七状态字面量：状态一律经 shared/order-state 常量比较（check #21）。
'use strict';

const state = require('../../../shared/order-state');
const enums = require('../../../shared/enums');
const format = require('./format');

// 分组 tab：只切前端；数据由服务端按 status 过滤并排序（客户端不重排）
const TAB_DEFS = [
  { key: 'ONGOING', label: '进行中', status: '', emptyText: '这里还没有进行中的订单。', emptyAction: '去下单' },
  { key: 'DONE', label: '已完成', status: state.STATUS.COMPLETED, emptyText: '还没有已完成的订单。', emptyAction: '回首页' },
  { key: 'CANCELED', label: '已取消', status: state.STATUS.CANCELLED, emptyText: '没有取消过的订单。', emptyAction: '回首页' }
];

// 服务端时间基准：store.serverTimeSkew = 本机时刻 - 服务端时刻（api/client 校时后写入）
function serverNowMs(skew, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const offset = typeof skew === 'number' && isFinite(skew) ? skew : 0;
  return now - offset;
}

function countOf(key, counts) {
  const source = counts || {};
  let value = 0;
  if (key === 'ONGOING') value = Number(source.ongoing);
  else if (key === 'DONE') value = Number(source.completed);
  else if (key === 'CANCELED') value = Number(source.cancelled);
  return isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 分组 tab 文案 + 服务端 counts（只增字段；缺失时为 0，不猜） */
function tabsWithCounts(counts) {
  return TAB_DEFS.map(function map(def) {
    return { key: def.key, label: def.label, count: countOf(def.key, counts) };
  });
}

function tabByKey(key) {
  for (let i = 0; i < TAB_DEFS.length; i += 1) {
    if (TAB_DEFS[i].key === key) return TAB_DEFS[i];
  }
  return TAB_DEFS[0];
}

/** 该 tab 的请求过滤条件（'' = 不传 status，由服务端按进行中口径过滤） */
function requestStatusOf(tabKey) {
  return tabByKey(tabKey).status || '';
}

function emptyStateOf(tabKey) {
  const tab = tabByKey(tabKey);
  return { text: tab.emptyText, actionText: tab.emptyAction };
}

/** 再次下单入口：仅终态（COMPLETED/CANCELLED，UX §5.4） */
function canReorder(order) {
  return !!order && state.isTerminal(order.status);
}

/** v1.0（D23）：orders.parcels[] 为多包裹；切换期兼容旧单 parcel */
function parcelsOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length > 0) {
    return list.map(function map(entry) {
      return entry && entry.parcel ? entry.parcel : entry || {};
    });
  }
  return order && order.parcel ? [order.parcel] : [];
}

function codeTextOf(order) {
  const parcels = parcelsOf(order);
  if (parcels.length > 1) return '共 ' + parcels.length + ' 件';
  const parcel = parcels[0] || {};
  if (parcel.codeStatus === enums.CODE_STATUS.NEED_CODE) return '需查明';
  if (typeof parcel.pickupCode === 'string' && parcel.pickupCode) return parcel.pickupCode;
  if (typeof parcel.trackingTail === 'string' && parcel.trackingTail) return '尾号 ' + parcel.trackingTail;
  return '—';
}

/** 行副标题：站点聚合（去重，最多 2 个 + 等）+ 宿舍键 */
function customerLineOf(order) {
  const parts = [];
  const stations = [];
  parcelsOf(order).forEach(function each(parcel) {
    const name = parcel && parcel.stationName ? String(parcel.stationName) : '';
    if (name && stations.indexOf(name) < 0) stations.push(name);
  });
  if (stations.length > 0) {
    parts.push(stations.slice(0, 2).join(' / ') + (stations.length > 2 ? ' 等' : ''));
  }
  const dorm = (order && order.dorm) || {};
  if (dorm.dormKey) parts.push(dorm.dormKey);
  return parts.join(' · ');
}

/** 等待接单倒计时文案（statusUpdatedAt + config.orderTimeoutMinutes，按服务端时间对齐） */
function waitingTextOf(order, nowMs, config) {
  const minutes = Number(config && config.orderTimeoutMinutes) || 0;
  const base = format.toDate(order && order.statusUpdatedAt);
  if (!base || minutes <= 0) return '等待接单';
  const current = typeof nowMs === 'number' ? nowMs : Date.now();
  const left = format.countdown(new Date(base.getTime() + minutes * 60000), new Date(current));
  if (left.expired) return '等待接单超时，即将自动取消';
  return '等待接单 ' + left.text;
}

function timeTextOf(order, nowMs, config) {
  const status = order && order.status;
  if (status === state.STATUS.SUBMITTED) return waitingTextOf(order, nowMs, config);
  if (status === state.STATUS.ACCEPTED) return '已接单，正在安排取件';
  if (status === state.STATUS.PICKED) return '已取件，配送中';
  if (status === state.STATUS.DELIVERED) return '已送达，待你确认';
  if (status === state.STATUS.EXCEPTION) return '异常待处理';
  if (status === state.STATUS.COMPLETED) return '已完成 ' + format.formatTimeAgo(order.completedAt, nowMs);
  if (status === state.STATUS.CANCELLED) return '已取消 ' + format.formatTimeAgo(order.cancelledAt, nowMs);
  return '';
}

/**
 * order DTO → 订单行组件视图模型（order-row 组件只渲染，不做业务判据）
 * @param {object} order 顾客侧 order DTO
 * @param {{nowMs?:number, config?:object}} options
 */
function rowView(order, options) {
  const item = order || {};
  const opts = options || {};
  return {
    orderNo: item.orderNo || '',
    status: item.status || '',
    codeText: codeTextOf(item),
    customerLine: customerLineOf(item),
    serviceName: (item.service && item.service.name) || '',
    timeText: timeTextOf(item, opts.nowMs, opts.config),
    statusUpdatedAt: item.statusUpdatedAt || '',
    reorderable: canReorder(item)
  };
}

/** 每秒局部刷新：只重算等待接单倒计时（其他状态文案不随秒变化） */
function tickRows(rows, nowMs, config) {
  return (rows || []).map(function map(row) {
    if (!row || row.status !== state.STATUS.SUBMITTED) return row;
    return Object.assign({}, row, { timeText: waitingTextOf(row, nowMs, config) });
  });
}

function hasPending(rows) {
  return (rows || []).some(function some(row) {
    return !!row && row.status === state.STATUS.SUBMITTED;
  });
}

/** 软删记录不展示（服务端已隐藏；客户端再挡一层，防御旧缓存/深链数据） */
function visibleRows(list) {
  return (list || []).filter(function filter(order) {
    return !!order && !order.deletedByCustomerAt;
  });
}

module.exports = {
  TAB_DEFS,
  serverNowMs,
  tabsWithCounts,
  tabByKey,
  requestStatusOf,
  emptyStateOf,
  canReorder,
  parcelsOf,
  codeTextOf,
  customerLineOf,
  waitingTextOf,
  timeTextOf,
  rowView,
  tickRows,
  hasPending,
  visibleRows
};
