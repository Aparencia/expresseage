// pkg-partner/pages/order-detail/parts/reason-panel.js · 取消/拒单原因面板纯件（原因枚举 + OTHER 必填）
// 契约：docs/V4_UX_PARTNER.md §3.3（拒单=取消并填原因）、§4.13（取消原因枚举）、§5.2；
//       docs/V4_DATA_MODEL.md §7.5 order.reject / order.cancel（reason 必填、note 可选 ≤100）。
// 边界：原因枚举单源 = shared/enums.CANCEL_REASONS[PARTNER]，页面不复制一套文案。
const enums = require('../../../../shared/enums');

const NOTE_MAX = 100;
const OTHER = 'OTHER';
const COPY = {
  otherRequired: '选「其他」时备注必填',
  unknownReason: '请选择一个原因',
  noteTooLong: '备注最多 100 字',
  cancelTitle: '取消原因',
  rejectTitle: '拒单原因',
  cancelConfirm: '提交后订单结束，顾客会看到原因；取消后不可恢复。',
  rejectConfirm: '提交后订单结束，顾客会看到拒单原因。'
};
const REASONS = enums.CANCEL_REASONS[enums.ROLES.PARTNER].map((item) => ({ code: item.code, label: item.text }));

function buildPanel(key) {
  const isReject = key === 'reject';
  return {
    title: isReject ? COPY.rejectTitle : COPY.cancelTitle,
    isReject: isReject,
    reasons: REASONS.map((item) => ({ code: item.code, label: item.label })),
    noteMax: NOTE_MAX,
    placeholder: '备注（选「其他」时必填，≤100 字）',
    confirmText: isReject ? COPY.rejectConfirm : COPY.cancelConfirm
  };
}

// 校验：原因必须在枚举内；OTHER 必填备注；备注 ≤100
function validate(reasonCode, note) {
  const code = typeof reasonCode === 'string' ? reasonCode.trim() : '';
  const text = typeof note === 'string' ? note.trim() : '';
  if (!REASONS.some((item) => item.code === code)) {
    return { ok: false, field: 'reason', message: COPY.unknownReason, data: null };
  }
  if (text.length > NOTE_MAX) {
    return { ok: false, field: 'note', message: COPY.noteTooLong, data: null };
  }
  if (code === OTHER && text === '') {
    return { ok: false, field: 'note', message: COPY.otherRequired, data: null };
  }
  const data = { reason: code };
  if (text !== '') {
    data.note = text;
  }
  return { ok: true, field: '', message: '', data: data };
}

function successText(isReject) {
  return isReject ? '已拒单，顾客会看到原因' : '已取消，顾客会看到原因';
}

module.exports = {
  COPY,
  NOTE_MAX,
  REASONS,
  buildPanel,
  validate,
  successText
};
