// pkg-partner/pages/messages/parts/message-view.js · 消息中心视图模型（真实 DTO：{type,title,text,orderNo,at,read,fromRole,templateCode}）
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const TYPE_LABELS = {
  EVENT: '订单动态',
  MESSAGE: '订单留言',
  NOTICE: '系统通知',
  ANNOUNCEMENT: '公告'
};

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function timeText(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function buildMessage(item) {
  const row = item || {};
  const type = textOf(row.type);
  const orderNo = textOf(row.orderNo);
  const text = textOf(row.text);
  const at = textOf(row.at) || textOf(row.createdAt);
  return {
    id: type + '|' + at + '|' + orderNo + '|' + text.slice(0, 16),
    type: type || 'SYSTEM',
    typeLabel: TYPE_LABELS[type] || '',
    title: textOf(row.title) || TYPE_LABELS[type] || (orderNo ? '订单消息' : '系统通知'),
    text: text,
    orderNo: orderNo,
    atText: timeText(at),
    unread: row.read !== true,
    route: orderNo ? '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo : ''
  };
}

function buildMessages(list) {
  return (Array.isArray(list) ? list : []).map(buildMessage).filter((item) => item.text || item.title);
}

function countUnread(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item.unread).length;
}

// 服务端 messageReadAt 是 ISO 字符串（旧口径可能是毫秒数）；统一成毫秒给页面比较
function readAtMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  const ms = typeof value === 'string' ? Date.parse(value) : 0;
  return ms > 0 ? ms : 0;
}

module.exports = {
  TYPE_LABELS,
  buildMessage,
  buildMessages,
  countUnread,
  readAtMs,
  timeText
};
