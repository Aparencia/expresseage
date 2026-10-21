// pkg-customer/pages/messages/parts/message-view.js · 消息中心视图模型（纯函数，零 wx）
// 真实 DTO：message.list 聚合项 {type,title,text,orderNo,at,read,fromRole,templateCode}
// 口径：UX_CUSTOMER §3.9/§8.2/§8.3；CONTRACT §5.3 message.list/markRead；已读水位 users.messageReadAt。
'use strict';

const format = require('../../../parts/format');

const TYPE_LABELS = {
  EVENT: '订单动态',
  MESSAGE: '订单留言',
  NOTICE: '系统通知',
  ANNOUNCEMENT: '公告'
};
const EMPTY_TEXT = '还没有消息。订单有进展时，这里会提醒你。';
const READONLY_COPY = '开发者只读视角不能操作';
const ANNOUNCEMENT_TITLE = '公告';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function atOf(row) {
  return textOf(row && row.at) || textOf(row && row.createdAt);
}

function readAtMs(value) {
  const date = format.toDate(value);
  return date ? date.getTime() : 0;
}

function idOf(type, at, orderNo, text) {
  return type + '|' + at + '|' + orderNo + '|' + text.slice(0, 24);
}

function typeLabelOf(type) {
  return TYPE_LABELS[type] || '消息';
}

function buildItem(row, now) {
  const source = row || {};
  const type = textOf(source.type) || 'MESSAGE';
  const at = atOf(source);
  const orderNo = textOf(source.orderNo);
  const text = textOf(source.text);
  return {
    id: idOf(type, at, orderNo, text),
    type: type,
    typeLabel: typeLabelOf(type),
    title: textOf(source.title) || typeLabelOf(type),
    text: text,
    orderNo: orderNo,
    unread: source.read === false,
    time: format.formatTimeAgo(at, now),
    atMs: readAtMs(at)
  };
}

function buildItems(rawList, now) {
  return (Array.isArray(rawList) ? rawList : [])
    .filter(function keep(row) {
      return !!row && (!!textOf(row.text) || !!textOf(row.title) || !!textOf(row.orderNo));
    })
    .map(function map(row) { return buildItem(row, now); });
}

// 公告卡片：标题为默认「公告」时 headline 取正文，避免「公告：公告」；具名标题则 body 放正文。
function announcementCard(title, text, at, now) {
  const name = textOf(title) || ANNOUNCEMENT_TITLE;
  const body = textOf(text);
  if (!body && name === ANNOUNCEMENT_TITLE) {
    return null;
  }
  const named = name !== ANNOUNCEMENT_TITLE;
  return {
    id: idOf('ANNOUNCEMENT', textOf(at), '', body),
    title: name,
    headline: named ? name : body,
    body: named ? body : '',
    time: format.formatTimeAgo(at, now)
  };
}

function buildAnnouncement(row, now) {
  if (!row) {
    return null;
  }
  return announcementCard(row.title, row.text, atOf(row), now);
}

// config.announcement 回落（服务端聚合项不在本页时用；enabled=false 一律不展示）。
function announcementOfConfig(value, now) {
  if (!value || typeof value !== 'object' || value.enabled === false) {
    return null;
  }
  return announcementCard(value.title, value.text, value.updatedAt, now);
}

// 首屏：公告置顶 + 列表中剔除公告项（不重复）；追加页不再产生公告卡片。
function pinAnnouncement(rawList, configAnnouncement, now) {
  const items = [];
  let pinned = null;
  buildItems(rawList, now).forEach(function each(item) {
    if (!pinned && item.type === 'ANNOUNCEMENT') {
      pinned = announcementCard(item.title, item.text, '', now);
      if (pinned) {
        pinned.id = item.id;
        pinned.time = item.time;
      }
      return;
    }
    items.push(item);
  });
  return {
    announcement: pinned || announcementOfConfig(configAnnouncement, now),
    items: items
  };
}

function countUnread(list) {
  return (Array.isArray(list) ? list : []).filter(function unread(item) { return item && item.unread; }).length;
}

function markAllRead(list) {
  return (Array.isArray(list) ? list : []).map(function mark(item) {
    return Object.assign({}, item, { unread: false });
  });
}

// 已读水位（users.messageReadAt，只进不退）：时间不晚于水位的条目视为已读；
// 水位缺失/非法时按「全部标为已读」回落（markRead scope=ALL 的服务端结果）。
function applyReadWatermark(list, value) {
  const watermark = readAtMs(value);
  if (watermark <= 0) {
    return markAllRead(list);
  }
  return (Array.isArray(list) ? list : []).map(function mark(item) {
    if (!item || !item.unread) {
      return item || {};
    }
    return Object.assign({}, item, { unread: !(item.atMs > 0 && item.atMs <= watermark) });
  });
}

// 追加页合并：按 id 去重 + 时间倒序（服务端分页期间新消息可能挤入下一页，客户端防御）。
function mergePage(previous, page) {
  const seen = {};
  const merged = [];
  (Array.isArray(previous) ? previous : []).concat(Array.isArray(page) ? page : []).forEach(function each(item) {
    if (!item || !item.id || seen[item.id]) {
      return;
    }
    seen[item.id] = true;
    merged.push(item);
  });
  return merged.sort(function desc(left, right) {
    return (right.atMs || 0) - (left.atMs || 0);
  });
}

// 红点单源：只归零 messages，其他 badge 键（如 workbenchPending）逐字节保留。
function badgePatchOf(badges) {
  return Object.assign({}, badges || {}, { messages: 0 });
}

module.exports = {
  EMPTY_TEXT,
  READONLY_COPY,
  buildItems,
  pinAnnouncement,
  applyReadWatermark,
  mergePage,
  badgePatchOf
};
