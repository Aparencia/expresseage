// pkg-partner/pages/order-detail/parts/delivery-panel.js · 送达备注浮层纯件（deliveryNote / guest 24h 自动完成文案）
// 契约：docs/V4_UX_PARTNER.md §3.3「送达」、§4.14 代客单凭证；docs/V4_DATA_MODEL.md §7.5 order.markDelivered / §7.6 config.getPublic。
// 边界：guest 判定只读服务端 DTO.source（= ORDER_SOURCE.PARTNER）；24h 文案与自动完成时间不本地推算状态。
const enums = require('../../../../shared/enums');

const NOTE_MAX = 100;
const AUTO_COMPLETE_HOURS = 24;
const QUICK_TAGS = ['放宿舍门口', '交到室友手里', '放 3 号柜'];
const COPY = {
  title: '标记送达',
  normalConfirm: '确认已送达？顾客会看到进度到「已送达·待确认」。',
  guestConfirm: '该顾客未绑定，无需确认，系统将在 24h 后自动完成',
  guestChip: '已送达·待自动完成',
  guestHint: '代客单没有顾客确认路径；请把交接位置写进送达备注，并线下告知顾客进度。',
  notePlaceholder: '送达备注（选填，≤100 字；写清放在哪里）',
  noteTooLong: '送达备注最多 100 字',
  success: '已标记送达',
  quickTitle: '快捷填写'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// guest 单 = 兼职代客下单（source=PARTNER）：无顾客确认路径，24h 后 cleanup 自动完成
function isGuestOrder(order) {
  return textOf(order && order.source) === enums.ORDER_SOURCE.PARTNER;
}

function guestAutoCompleteText() {
  return '系统将在 ' + AUTO_COMPLETE_HOURS + 'h 后自动完成';
}

function buildPanel(order) {
  const guest = isGuestOrder(order);
  return {
    visible: true,
    title: COPY.title,
    guest: guest,
    noteMax: NOTE_MAX,
    placeholder: COPY.notePlaceholder,
    quickTags: QUICK_TAGS.slice(),
    quickTitle: COPY.quickTitle,
    confirmText: guest ? COPY.guestConfirm : COPY.normalConfirm,
    guestHint: guest ? COPY.guestHint : ''
  };
}

// 已送达的 guest 单在详情顶部给「已送达·待自动完成」chip（正常单显示服务端 statusText）
function deliveredChip(order) {
  if (!isGuestOrder(order)) {
    return '';
  }
  const status = textOf(order && order.status);
  return status === enums.ORDER_STATUS.DELIVERED ? COPY.guestChip : '';
}

function guestAutoCompleteHint(order) {
  if (!isGuestOrder(order)) {
    return '';
  }
  const status = textOf(order && order.status);
  return status === enums.ORDER_STATUS.DELIVERED ? guestAutoCompleteText() : '';
}

// 备注可空；非空时 ≤100（前端 maxlength 与服务端 shared/validate 同口径）
function validateNote(note) {
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > NOTE_MAX) {
    return { ok: false, field: 'deliveryNote', message: COPY.noteTooLong, value: '' };
  }
  return { ok: true, field: '', message: '', value: text };
}

// 提交装配：data 只放契约字段；expectedVersion 走 api 包络（乐观锁），不混进 data。
// 空备注不带 deliveryNote（服务端不写空串）。
function buildSubmit(order, note) {
  const checked = validateNote(note);
  const data = { orderNo: textOf(order && order.orderNo) };
  if (checked.value !== '') {
    data.deliveryNote = checked.value;
  }
  return {
    data: data,
    opts: {
      expectedVersion: order && typeof order.version === 'number' ? order.version : undefined
    }
  };
}

module.exports = {
  COPY,
  NOTE_MAX,
  AUTO_COMPLETE_HOURS,
  QUICK_TAGS,
  isGuestOrder,
  guestAutoCompleteText,
  buildPanel,
  deliveredChip,
  guestAutoCompleteHint,
  validateNote,
  buildSubmit
};
