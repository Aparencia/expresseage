// pkg-partner/pages/order-detail/parts/delivery-panel.js · 送达备注浮层纯件（deliveryNote / guest 送达自动完成文案）
// 契约：docs/ux/V4_UX_PARTNER.md §3.3「送达」、§4.14 代客单凭证；docs/data/V4_DATA_MODEL.md §7.5 order.markDelivered / §7.6 config.getPublic。
// 边界：guest 判定只读服务端 DTO.source（= ORDER_SOURCE.PARTNER）；自动完成时刻（D51：每天该时刻结批）按调用方注入的公开配置
//       config.autoCompleteAt 生成文案（缺配置/非法才回退出厂默认，默认值唯一单源 = config/defaults.DEFAULT_CONFIG）；
//       本零件不推算状态、不等同服务端 AUTO_COMPLETED 事件（文案只说明口径，配置改动以服务端为准）。
const defaults = require('../../../../config/defaults');
const enums = require('../../../../shared/enums');

const NOTE_MAX = 100;
const QUICK_TAGS = ['放宿舍门口', '交到室友手里', '放 3 号柜'];
const COPY = {
  title: '标记送达',
  normalConfirm: '确认已送达？顾客会看到进度到「已送达·待确认」。',
  guestChip: '已送达·待自动完成',
  guestConfirmPrefix: '该顾客未绑定，无需确认；系统每天 ',
  guestHintPrefix: '代客单没有顾客确认路径；系统每天 ',
  notePlaceholder: '送达备注（选填，≤100 字；写清放在哪里）',
  noteTooLong: '送达备注最多 100 字',
  success: '已标记送达',
  quickTitle: '快捷填写'
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// D43/D51（CONTRACT §13）：UTC+8 的完成时刻 config.autoCompleteAt（HH:MM）；
// 缺配置/非法一律回退出厂默认（唯一默认常量在 config/defaults，本零件不再写第二处处所时刻字面量）。
function autoCompleteAtOf(config) {
  const source = config && typeof config === 'object' ? config : {};
  return defaults.normalizeClockText(source.autoCompleteAt) || defaults.DEFAULT_CONFIG.autoCompleteAt;
}

// guest 单 = 兼职代客下单（source=PARTNER）：无顾客确认路径，送达后由系统每天该时刻自动完成
function isGuestOrder(order) {
  return textOf(order && order.source) === enums.ORDER_SOURCE.PARTNER;
}

function guestAutoCompleteText(config) {
  const at = autoCompleteAtOf(config);
  return '系统每天 ' + at + ' 自动完成（该时刻前送达的当天完成；该时刻后送达的下一轮自动完成）';
}

function guestConfirmText(config) {
  return COPY.guestConfirmPrefix + autoCompleteAtOf(config) + ' 自动完成';
}

function guestHintText(config) {
  const at = autoCompleteAtOf(config);
  return COPY.guestHintPrefix + at + ' 自动完成（该时刻前送达的当天完成；该时刻后送达的下一轮自动完成），'
    + '请把交接位置写进送达备注，并线下告知顾客进度。';
}

function buildPanel(order, config) {
  const guest = isGuestOrder(order);
  return {
    visible: true,
    title: COPY.title,
    guest: guest,
    noteMax: NOTE_MAX,
    placeholder: COPY.notePlaceholder,
    quickTags: QUICK_TAGS.slice(),
    quickTitle: COPY.quickTitle,
    confirmText: guest ? guestConfirmText(config) : COPY.normalConfirm,
    guestHint: guest ? guestHintText(config) : ''
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

function guestAutoCompleteHint(order, config) {
  if (!isGuestOrder(order)) {
    return '';
  }
  const status = textOf(order && order.status);
  return status === enums.ORDER_STATUS.DELIVERED ? guestAutoCompleteText(config) : '';
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
  QUICK_TAGS,
  isGuestOrder,
  guestAutoCompleteText,
  buildPanel,
  deliveredChip,
  guestAutoCompleteHint,
  validateNote,
  buildSubmit
};
