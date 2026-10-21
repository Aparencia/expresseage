// pkg-partner/pages/messages/parts/message-view.js · 消息中心视图模型（纯函数，零 wx）
// 真实 DTO：{type,title,text,orderNo,at,read,fromRole,templateCode}；分类桶 = 全部/订单/留言/公告（UX_PARTNER §3.9）。
'use strict';

const TYPE_LABELS = {
  EVENT: '订单动态',
  MESSAGE: '订单留言',
  NOTICE: '系统通知',
  ANNOUNCEMENT: '公告'
};
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'order', label: '订单' },
  { key: 'message', label: '留言' },
  { key: 'announcement', label: '公告' }
];
const EMPTY_TEXT = '还没有消息';
const EMPTY_FILTER_TEXT = '当前分类下还没有消息';
const READONLY_COPY = '开发者只读视角不能操作';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function msOf(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  const ms = typeof value === 'string' ? Date.parse(value) : 0;
  return ms > 0 && !Number.isNaN(ms) ? ms : 0;
}

function timeText(value) {
  const ms = msOf(value);
  if (!ms) {
    return '';
  }
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

// 4 个筛选 chip 的桶：订单=状态事件；留言=订单留言+系统通知（系统通知无独立 chip，避免死条目）；公告。
function bucketOfType(type) {
  if (type === 'ANNOUNCEMENT') {
    return 'announcement';
  }
  if (type === 'MESSAGE' || type === 'NOTICE') {
    return 'message';
  }
  return 'order';
}

function buildMessage(item) {
  const row = item || {};
  const type = textOf(row.type);
  const orderNo = textOf(row.orderNo);
  const text = textOf(row.text);
  const at = textOf(row.at) || textOf(row.createdAt);
  const label = TYPE_LABELS[type];
  return {
    id: type + '|' + at + '|' + orderNo + '|' + text.slice(0, 16),
    type: type || 'SYSTEM',
    typeLabel: label || '',
    bucket: bucketOfType(type),
    title: textOf(row.title) || label || (orderNo ? '订单消息' : '系统通知'),
    text: text,
    orderNo: orderNo,
    atText: timeText(at),
    atMs: msOf(at),
    unread: row.read !== true,
    route: orderNo ? '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo : ''
  };
}

function buildMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function keep(row) {
      return !!row && (!!textOf(row.text) || !!textOf(row.title) || !!textOf(row.orderNo));
    })
    .map(buildMessage);
}

function countUnread(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item.unread).length;
}

// 红点口径 = 服务端 unreadMessages（只算 type='MESSAGE' 的未读留言）
function unreadMessageCount(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item.type === 'MESSAGE' && item.unread).length;
}

// 服务端 messageReadAt 是 ISO 字符串（旧口径可能是毫秒数）；统一成毫秒给页面比较
function readAtMs(value) {
  return msOf(value);
}

function applyAllRead(list) {
  return (Array.isArray(list) ? list : []).map((item) => Object.assign({}, item, { unread: false }));
}

// 单订单标记已读：该订单条目置读 + 状态事件按已读水位（服务端 markRead 同时前进 users.messageReadAt）。
function applyOrderRead(list, orderNo, value) {
  const watermark = readAtMs(value);
  return (Array.isArray(list) ? list : []).map((item) => {
    if (item.orderNo && item.orderNo === orderNo) {
      return Object.assign({}, item, { unread: false });
    }
    if (item.bucket === 'order' && watermark > 0 && item.atMs > 0 && item.atMs <= watermark) {
      return Object.assign({}, item, { unread: false });
    }
    return item;
  });
}

// 追加页合并：按 id 去重 + 时间倒序（分页期间新消息挤入下一页时客户端防御）
function mergeMessages(previous, page) {
  const seen = {};
  const merged = [];
  (Array.isArray(previous) ? previous : []).concat(Array.isArray(page) ? page : []).forEach((item) => {
    if (!item || !item.id || seen[item.id]) {
      return;
    }
    seen[item.id] = true;
    merged.push(item);
  });
  return merged.sort((left, right) => (right.atMs || 0) - (left.atMs || 0));
}

function filterKeyOf(key) {
  return FILTERS.some((filter) => filter.key === key) ? key : 'all';
}

function applyFilter(list, key) {
  const source = Array.isArray(list) ? list : [];
  const filter = filterKeyOf(key);
  if (filter === 'all') {
    return source.slice();
  }
  return source.filter((item) => item.bucket === filter);
}

function countsOf(list) {
  const source = Array.isArray(list) ? list : [];
  return {
    all: source.length,
    order: source.filter((item) => item.bucket === 'order').length,
    message: source.filter((item) => item.bucket === 'message').length,
    announcement: source.filter((item) => item.bucket === 'announcement').length
  };
}

function filtersWithCounts(list) {
  const counts = countsOf(list);
  return FILTERS.map((filter) => Object.assign({}, filter, { count: counts[filter.key] }));
}

function emptyTextOf(key) {
  return filterKeyOf(key) === 'all' ? EMPTY_TEXT : EMPTY_FILTER_TEXT;
}

// 红点单源：只改 messages，其他 badge 键（如 workbenchPending）逐字节保留
function badgePatchOf(badges, unreadCount) {
  const next = Object.assign({}, badges || {});
  const count = typeof unreadCount === 'number' && unreadCount > 0 ? unreadCount : 0;
  next.messages = count;
  return next;
}

module.exports = {
  EMPTY_TEXT,
  READONLY_COPY,
  timeText,
  buildMessage,
  buildMessages,
  countUnread,
  unreadMessageCount,
  readAtMs,
  applyAllRead,
  applyOrderRead,
  mergeMessages,
  filterKeyOf,
  applyFilter,
  filtersWithCounts,
  emptyTextOf,
  badgePatchOf
};
