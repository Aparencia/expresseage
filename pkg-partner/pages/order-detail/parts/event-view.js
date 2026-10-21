// pkg-partner/pages/order-detail/parts/event-view.js · 时间线/留言视图（纯件零 wx；文案优先取服务端字段）
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function timeText(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function fullTimeText(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function buildEvent(item) {
  const event = item || {};
  const label = textOf(event.label) || textOf(event.title) || textOf(event.note) || textOf(event.type);
  return {
    key: textOf(event.id) || label + timeText(event.at || event.createdAt),
    label: label,
    actor: textOf(event.actorText) || textOf(event.actorRole),
    atText: timeText(event.at || event.createdAt)
  };
}

function buildEvents(list) {
  return (Array.isArray(list) ? list : []).map(buildEvent).filter((item) => item.label);
}

function buildMessage(item) {
  const row = item || {};
  return {
    id: textOf(row.id) || textOf(row.messageId) || timeText(row.createdAt),
    text: textOf(row.text),
    fromText: textOf(row.fromText) || (row.fromRole === 'PARTNER' ? '我' : '顾客'),
    atText: timeText(row.createdAt)
  };
}

function buildMessages(list) {
  return (Array.isArray(list) ? list : []).map(buildMessage).filter((item) => item.text);
}

module.exports = {
  buildEvent,
  buildEvents,
  buildMessage,
  buildMessages,
  timeText,
  fullTimeText
};
