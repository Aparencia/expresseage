// pkg-partner/pages/messages/parts/message-view.js · 消息中心视图模型（纯件零 wx）
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timeText(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => (number < 10 ? '0' + number : String(number));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function buildMessage(item) {
  const row = item || {};
  const title = textOf(row.title) || textOf(row.templateTitle) || (row.orderNo ? '订单消息' : '系统通知');
  const orderNo = textOf(row.orderNo);
  return {
    id: textOf(row.id) || textOf(row.messageId) || textOf(row.requestKey),
    title: title,
    text: textOf(row.text) || textOf(row.content),
    kind: textOf(row.kind) || textOf(row.scope) || 'SYSTEM',
    orderNo: orderNo,
    atText: timeText(row.at || row.createdAt),
    unread: row.read !== true && row.unread !== false,
    route: orderNo ? '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo : ''
  };
}

function buildMessages(list) {
  return (Array.isArray(list) ? list : []).map(buildMessage).filter((item) => item.text || item.title);
}

function countUnread(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item.unread).length;
}

module.exports = {
  buildMessage,
  buildMessages,
  countUnread,
  timeText
};
