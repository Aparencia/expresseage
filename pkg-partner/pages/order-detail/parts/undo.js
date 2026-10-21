// pkg-partner/pages/order-detail/parts/undo.js · 撤销条纯件（order.undo 仅取件/送达、5 秒窗由服务端判定）
// 契约：docs/V4_UX_PARTNER.md §4.7（撤销条 5s / 文案）与 §3.3「不设接单撤销」；
//       docs/V4_DATA_MODEL.md §7.5 order.undo（PICKED/DELIVERED、5 秒窗、无后续状态变化）。
// 边界：可见性 = 服务端 actions 里出现 undoPick/undoDeliver；本文件只算倒计时与文案，不自行发起撤销。
const orderState = require('../../../../shared/order-state');
const actionsPart = require('./actions');

const COPY = {
  pickLabel: '已把 1 件标记为已取件',
  deliverLabel: '已把 1 件标记为已送达',
  undo: '撤销',
  confirmed: '顾客已确认送达，不能撤销。',
  changed: '撤销失败：订单状态已变化，请刷新后再看。',
  fallback: '撤销没成功，请刷新后再看。'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// DTO 时间是 ISO 字符串（_dto.isoOf）；兼容毫秒/Date（不在页面层复制 format 的 toMillis）
function msOf(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function baseMsOf(order, key) {
  return msOf(order && order[key]);
}

// kind：undoPick（回退取件）/ undoDeliver（回退送达）
function buildBar(order, actions, nowMs) {
  const keys = actionsPart.undoTargetKeys(actions);
  const kind = keys.length ? keys[0] : '';
  if (!kind) {
    return { visible: false, kind: '', remaining: 0, label: '', undoLabel: COPY.undo };
  }
  const baseField = kind === 'undoPick' ? 'pickedAt' : 'deliveredAt';
  const baseMs = baseMsOf(order, baseField);
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  // 服务端已判定"在 5 秒窗内"，这里只按动作时刻算剩余秒数用于展示
  const deadline = baseMs > 0 ? baseMs + orderState.UNDO_WINDOW_MS : now + orderState.UNDO_WINDOW_MS;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (remaining <= 0) {
    return { visible: false, kind: kind, remaining: 0, label: '', undoLabel: COPY.undo };
  }
  return {
    visible: true,
    kind: kind,
    remaining: remaining,
    label: kind === 'undoPick' ? COPY.pickLabel : COPY.deliverLabel,
    undoLabel: COPY.undo
  };
}

// 撤销失败文案：先刷新详情，据最新 DTO 说真话（顾客已确认 → COMPLETED；其余状态已变）
function failureText(err, refreshedOrder) {
  const code = textOf(err && err.code);
  const status = textOf(refreshedOrder && refreshedOrder.status);
  if (status === orderState.STATUS.COMPLETED) {
    return COPY.confirmed;
  }
  if (code === 'INVALID_STATE' || code === 'INVALID_TRANSITION' || code === 'CONFLICT') {
    return COPY.changed;
  }
  return textOf(err && err.message) || COPY.fallback;
}

function successText(kind) {
  if (kind === 'undoPick') {
    return '已撤销取件，订单回到「' + orderState.statusText(orderState.STATUS.ACCEPTED) + '」。';
  }
  if (kind === 'undoDeliver') {
    return '已撤销送达，订单回到「' + orderState.statusText(orderState.STATUS.PICKED) + '」。';
  }
  return '已撤销';
}

module.exports = {
  COPY,
  buildBar,
  failureText,
  successText
};
