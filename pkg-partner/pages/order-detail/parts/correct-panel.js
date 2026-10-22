// pkg-partner/pages/order-detail/parts/correct-panel.js · 补码/改站点面板纯件（字段域 + 校验 + 提交装配）
// 契约：docs/V4_UX_PARTNER.md §3.3「改码/改站点」+ §4.4「需查明」+ §5.1（PICKED 仅柜号/尾号）；
//       docs/V4_DATA_MODEL.md §7.5 order.correct（SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅 lockerNo/trackingTail）。
// 边界：站点值域只取 shared/stations（P1~P8，不自建）；形态校验复用 utils/order-edit；本文件不判断"按钮显隐"。
const enums = require('../../../../shared/enums');
const orderState = require('../../../../shared/order-state');
const stations = require('../../../../shared/stations');
const orderEdit = require('../../../../utils/order-edit');

const STATUS = orderState.STATUS;
const FIELD_LABEL = {
  stationId: '站点',
  pickupCode: '取件码',
  lockerNo: '柜号',
  trackingTail: '运单尾号'
};
// 面板标题与边界文案（wxml 只消费字段，不写死口径）
const COPY = {
  title: '补码 / 改站点',
  blocked: '已送达，不能再改取件码',
  pickedHint: '已取件，只能改柜号或运单尾号',
  save: '一次保存记一条更正记录；只改自己订单，不改订单状态与归属。',
  success: '已更正，顾客端同步',
  nothing: '没有要保存的修改',
  stationOnly: '站点只能是 P1~P8 里的取件点',
  screenOnly: '需要补码的件保持「需查明」标记，补上取件码后顾客端同步'
};
const PICKED_FIELDS = ['lockerNo', 'trackingTail'];
const FULL_FIELDS = ['stationId', 'pickupCode', 'lockerNo', 'trackingTail'];

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// v1.0 一单多包裹：逐件纠正（order.correct 带 itemIndex）；兼容历史单包裹 parcel{}
function parcelListOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length) {
    return list;
  }
  return order && order.parcel ? [order.parcel] : [];
}

function parcelAtOf(order, itemIndex) {
  const list = parcelListOf(order);
  const index = typeof itemIndex === 'number' && itemIndex >= 0 ? itemIndex : 0;
  return list[index] || list[0] || {};
}

function indexTextOf(index) {
  return '第 ' + (index + 1) + ' 件';
}

function panelItemsOf(order) {
  return parcelListOf(order).map((parcel, index) => {
    const row = parcel || {};
    return {
      index: index,
      indexText: indexTextOf(index),
      stationText: textOf(row.stationName) || '还未指定站点',
      pickupCodeText: textOf(row.pickupCode),
      lockerNoText: textOf(row.lockerNo),
      trackingTailText: textOf(row.trackingTail),
      codeStatusText: textOf(row.codeStatusText)
    };
  });
}

function statusOf(order) {
  return textOf(order && order.status);
}

// 面板是否还有入口：DELIVERED 及之后不可补码（COMPLETED/CANCELLED 亦不可）
function isBlocked(order) {
  const status = statusOf(order);
  return status === STATUS.DELIVERED || status === STATUS.COMPLETED || status === STATUS.CANCELLED;
}

// 字段域按 DTO 状态收窄：PICKED 只留柜号/运单尾号；DELIVERED 及之后整块隐藏；items 供多包裹逐件选目标
function buildPanel(order) {
  const blocked = isBlocked(order);
  const fields = blocked ? [] : (statusOf(order) === STATUS.PICKED ? PICKED_FIELDS.slice() : FULL_FIELDS.slice());
  const options = stations.listStations().map((item) => ({ id: item.id, name: item.name }));
  const items = panelItemsOf(order);
  const parcel = parcelAtOf(order, 0);
  const stationIndex = stationIndexOf(parcel, options);
  return {
    visible: !blocked,
    blocked: blocked,
    blockedCopy: blocked ? COPY.blocked : '',
    title: COPY.title,
    fields: fields,
    fieldLabels: FIELD_LABEL,
    showStation: fields.indexOf('stationId') >= 0,
    showPickupCode: fields.indexOf('pickupCode') >= 0,
    showLockerNo: fields.indexOf('lockerNo') >= 0,
    showTrackingTail: fields.indexOf('trackingTail') >= 0,
    picked: statusOf(order) === STATUS.PICKED,
    hint: statusOf(order) === STATUS.PICKED ? COPY.pickedHint : COPY.screenOnly,
    stationOptions: options,
    stationIndex: stationIndex,
    stationText: stationIndex >= 0 ? options[stationIndex].name : '请选择站点',
    codeStatusText: textOf(parcel.codeStatusText),
    items: items,
    multi: items.length > 1,
    itemIndex: 0,
    saveCopy: COPY.save,
    successCopy: COPY.success,
    pickupCodeMax: orderEdit.PICKUP_CODE_MAX,
    lockerNoMax: orderEdit.LOCKER_NO_MAX,
    trackingTailLength: orderEdit.TRACKING_TAIL_LENGTH
  };
}

function stationIndexOf(parcel, options) {
  const stationId = textOf(parcel && parcel.stationId);
  for (let i = 0; i < options.length; i += 1) {
    if (options[i].id === stationId) {
      return i;
    }
  }
  return -1;
}

// 打开面板时的编辑初值 = 服务端当前值（L3 只在原位展示，不跨页不落盘）
function buildEditor(order, itemIndex) {
  const parcel = parcelAtOf(order, itemIndex);
  return {
    stationId: textOf(parcel.stationId),
    pickupCode: textOf(parcel.pickupCode),
    lockerNo: textOf(parcel.lockerNo),
    trackingTail: textOf(parcel.trackingTail)
  };
}

// 差异提交：只带"确实变化"的字段（未变化字段带上会被判非法字段）
function diffPatch(editor, order, itemIndex) {
  const next = editor || {};
  const parcel = parcelAtOf(order, itemIndex);
  const patch = {};
  FULL_FIELDS.forEach((field) => {
    const after = textOf(next[field]);
    const before = textOf(parcel[field]);
    if (after !== before) {
      patch[field] = after;
    }
  });
  return patch;
}

// 校验：状态收窄 → 差异 → 形态（站点 P1~P8 / 取件码 ≤40 / 柜号 ≤10 / 尾号恰 5 位数字）
function validateSave(editor, order, itemIndex) {
  if (isBlocked(order)) {
    return { ok: false, field: '', message: COPY.blocked, patch: {} };
  }
  const patch = diffPatch(editor, order, itemIndex);
  if (!Object.keys(patch).length) {
    return { ok: false, field: '', message: COPY.nothing, patch: {} };
  }
  const checked = orderEdit.validatePatch(patch, { pickedOnly: statusOf(order) === STATUS.PICKED });
  if (!checked.ok) {
    return { ok: false, field: checked.field, message: checked.message, patch: {} };
  }
  const stationError = stationMessageOf(checked.patch);
  if (stationError) {
    return { ok: false, field: 'stationId', message: stationError, patch: {} };
  }
  return { ok: true, field: '', message: '', patch: checked.patch };
}

function stationMessageOf(patch) {
  if (!patch || (patch.stationId === undefined && patch.stationName === undefined)) {
    return '';
  }
  const checked = stations.validateStation(patch.stationId || '', patch.stationName || '');
  return checked.ok ? '' : COPY.stationOnly;
}

// 提交装配：data 只放契约字段（page → api/modules/order.correct；v1.0 逐件带 itemIndex，缺省 0 不传）。
// 服务端 data 层"未登记字段拒绝"，所以 version 绝不能混进 patch/data。
function buildSubmit(order, patch, itemIndex) {
  const data = {
    orderNo: textOf(order && order.orderNo),
    patch: patch || {}
  };
  if (typeof itemIndex === 'number' && itemIndex > 0) {
    data.itemIndex = itemIndex;
  }
  return {
    data: data,
    opts: {
      expectedVersion: order && typeof order.version === 'number' ? order.version : undefined
    }
  };
}

// 保存成功后的措辞：codeStatus 以服务端为准（保存后重拉 DTO），本地不派生
function savedCopy(panel) {
  const codeState = textOf(panel && panel.codeStatusText);
  return codeState ? COPY.success + '（' + codeState + '）' : COPY.success;
}

// 需查明单补上码后的下一次刷新提示（服务端事件 note 由 _dto 下发，页面只展示）
function stillNeedCodeText(order) {
  const parcel = parcelAtOf(order, 0);
  return textOf(parcel.codeStatus) === enums.CODE_STATUS.NEED_CODE ? COPY.screenOnly : '';
}

module.exports = {
  COPY,
  FIELD_LABEL,
  PICKED_FIELDS,
  FULL_FIELDS,
  isBlocked,
  buildPanel,
  buildEditor,
  diffPatch,
  validateSave,
  buildSubmit,
  savedCopy,
  stillNeedCodeText,
  stationIndexOf,
  parcelListOf,
  parcelAtOf,
  panelItemsOf,
  indexTextOf
};
