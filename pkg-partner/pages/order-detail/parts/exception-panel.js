// pkg-partner/pages/order-detail/parts/exception-panel.js · 异常上报/解除面板纯件
// 契约：docs/V4_UX_PARTNER.md §4.13（六原因 + 备注 ≤200 + OTHER 必填）、§3.3、§5.1（解除回到 fromStatus）；
//       docs/V4_DATA_MODEL.md §7.5 order.reportException / order.resolveException。
// 边界：原因枚举单源 = shared/enums.EXCEPTION_CODES；解除目标只读服务端 DTO 的 exception.fromStatus。
const enums = require('../../../../shared/enums');
const orderState = require('../../../../shared/order-state');
const actionsPart = require('./actions');

const NOTE_MAX = 200;
const OTHER = 'OTHER';
const COPY = {
  title: '上报异常',
  report: '已上报异常，顾客已收到提醒。',
  reportConfirm: '上报后顾客会看到「异常待处理」，你可以在解决后恢复。',
  notePlaceholder: '备注（选「其他」时必填，≤200 字）',
  noteTooLong: '备注最多 200 字',
  noteRequired: '选「其他」时备注必填',
  unknownReason: '请选择一个异常原因',
  resolveTitle: '解除异常',
  resolvePrefix: '已解除异常，订单恢复到「',
  resolveSuffix: '」。'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 六原因枚举（服务端同一份 shared/enums，页面不复制字符串）
function reasons() {
  return enums.EXCEPTION_CODES.map((item) => ({ code: item.code, label: item.text }));
}

function buildPanel() {
  return {
    visible: true,
    title: COPY.title,
    reasons: reasons(),
    noteMax: NOTE_MAX,
    placeholder: COPY.notePlaceholder,
    confirmText: COPY.reportConfirm
  };
}

function validateReport(code, note) {
  const reasonCode = textOf(code);
  const text = typeof note === 'string' ? note.trim() : '';
  const known = enums.EXCEPTION_CODES.filter((item) => item.code === reasonCode);
  if (!known.length) {
    return { ok: false, field: 'code', message: COPY.unknownReason, payload: null };
  }
  if (text.length > NOTE_MAX) {
    return { ok: false, field: 'text', message: COPY.noteTooLong, payload: null };
  }
  if (reasonCode === OTHER && text === '') {
    return { ok: false, field: 'text', message: COPY.noteRequired, payload: null };
  }
  const payload = { code: reasonCode };
  if (text !== '') {
    payload.text = text;
  }
  return { ok: true, field: '', message: '', payload: payload };
}

// 解除异常：恢复到服务端记录的 fromStatus（非法/缺失时服务端回落 ACCEPTED，见 order-state.resolveExceptionTo）
function resolveTargetStatus(order) {
  return orderState.resolveExceptionTo((order && order.exception) || {});
}

function resolveTargetText(order) {
  return orderState.statusText(resolveTargetStatus(order));
}

function resolveConfirmText(order) {
  return '恢复到「' + resolveTargetText(order) + '」？顾客会看到进度恢复。';
}

function resolveCopy(order) {
  return COPY.resolvePrefix + resolveTargetText(order) + COPY.resolveSuffix;
}

function buildResolve(order) {
  const target = resolveTargetText(order);
  return {
    visible: true,
    title: COPY.resolveTitle,
    targetStatusText: target,
    confirmText: resolveConfirmText(order),
    successCopy: resolveCopy(order),
    actionsLabel: (actionsPart.ACTIONS.resolve || {}).label || '解除异常'
  };
}

// 上报/解除提交装配：data 只放契约字段；expectedVersion 走 api 包络（乐观锁），不混进 data
function buildReportSubmit(order, payload) {
  const data = Object.assign({}, payload || {});
  data.orderNo = textOf(order && order.orderNo);
  return {
    data: data,
    opts: {
      expectedVersion: order && typeof order.version === 'number' ? order.version : undefined
    }
  };
}

function buildResolveSubmit(order) {
  return {
    data: { orderNo: textOf(order && order.orderNo) },
    opts: {
      expectedVersion: order && typeof order.version === 'number' ? order.version : undefined
    }
  };
}

module.exports = {
  COPY,
  NOTE_MAX,
  reasons,
  buildPanel,
  validateReport,
  resolveTargetStatus,
  resolveTargetText,
  resolveConfirmText,
  resolveCopy,
  buildResolve,
  buildReportSubmit,
  buildResolveSubmit
};
