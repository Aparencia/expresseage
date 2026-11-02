// handlers/order/_picked.js · D61 件级取件纯件：件级判定 / 旧单派生 / 订单聚合 / 动作矩阵 / 写回归一
// 口径：CONTRACT §5/§5.1（D61 件级取件）、DATA_MODEL §0.6/§2.5/§8.4（parcels[].pickedAt/pickedByNo、19 事件）。
// 边界：纯函数（零 I/O / 零 wx）；markPicked/unmarkPicked/undo 与 _dto-fields 复用同一套判定，读写口径不分叉。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const store = require('./_store');

const STATUS = enums.ORDER_STATUS;
// 旧单派生（CONTRACT §5.1 D61）：这些订单状态下「全部件已取」；EXCEPTION 另看上报时的 fromStatus。
const DERIVED_PICKED_STATUSES = [STATUS.PICKED, STATUS.DELIVERED, STATUS.COMPLETED];
const DERIVED_EXCEPTION_FROM = [STATUS.PICKED, STATUS.DELIVERED];
// DATA_MODEL §2.5：一单 1~10 件 → 包裹下标 0~9（越界一律 VALIDATION_FAILED(field=itemIndex)）。
const ITEM_INDEX_MIN = 0;
const ITEM_INDEX_MAX = 9;

function hasOwnPickedAt(parcel) {
  return !!parcel && typeof parcel === 'object' && Object.prototype.hasOwnProperty.call(parcel, 'pickedAt');
}

// 时间值归一（毫秒）：只认 Date/number 的正值；null/undefined/'' 一律视为「没有这个时间」。
function timeMsOf(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  return 0;
}

// 旧单派生（无数据迁移）：PICKED/DELIVERED/COMPLETED → 全部件已取；
// EXCEPTION 且上报自 PICKED/DELIVERED → 全部件已取；其余（含 ACCEPTED）→ 未取。
function derivedPickedOf(order) {
  const status = order && order.status;
  if (DERIVED_PICKED_STATUSES.indexOf(status) >= 0) {
    return true;
  }
  if (status !== STATUS.EXCEPTION) {
    return false;
  }
  const from = order.exception && order.exception.fromStatus;
  return DERIVED_EXCEPTION_FROM.indexOf(from) >= 0;
}

// 件是否已取：件上有 pickedAt 自有属性（含 null）→ 以件为准；无该属性 → 按订单状态派生（旧单兼容）。
function isPickedOf(order, parcel) {
  if (hasOwnPickedAt(parcel)) {
    return timeMsOf(parcel.pickedAt) > 0;
  }
  return derivedPickedOf(order);
}

// 件级取件时间（毫秒；未取=0）：显式件值优先，旧单回退订单 pickedAt（不发明当前时钟，避免假时间）。
function pickedAtMsOf(order, parcel) {
  if (hasOwnPickedAt(parcel)) {
    return timeMsOf(parcel.pickedAt);
  }
  return derivedPickedOf(order) ? timeMsOf(order && order.pickedAt) : 0;
}

// 订单聚合字段（DTO pickedCount/parcelCount/allPicked）：件数派生、不另存计数字段（DATA_MODEL §2.5）。
function summaryOfParcels(order, parcels) {
  const list = Array.isArray(parcels) ? parcels : [];
  const pickedCount = list.filter((parcel) => isPickedOf(order, parcel)).length;
  return { pickedCount, parcelCount: list.length, allPicked: list.length > 0 && pickedCount === list.length };
}

// 每件动作（string[]，仅 PARTNER 侧）：ACCEPTED 未取 → markPicked；ACCEPTED/PICKED 已取 → unmarkPicked；其它 []。
function actionsOf(order, side, picked) {
  if (side !== enums.ROLES.PARTNER) {
    return [];
  }
  const status = order && order.status;
  if (status === STATUS.ACCEPTED) {
    return [picked ? 'unmarkPicked' : 'markPicked'];
  }
  if (status === STATUS.PICKED && picked) {
    return ['unmarkPicked'];
  }
  return [];
}

// 取件兼职编号快照（DATA_MODEL §2.5 parcels[].pickedByNo；缺省为空串，不阻断取件）。
function partnerNoOf(order) {
  return order && typeof order.partnerNo === 'string' ? order.partnerNo : '';
}

// 可选包裹序号：缺省/空 → null（整单旧行为）；非整数或超出 0~9 → VALIDATION_FAILED(field=itemIndex)。
function readItemIndexOf(payload) {
  const value = payload && typeof payload === 'object' ? payload.itemIndex : undefined;
  if (value === undefined || value === null) {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < ITEM_INDEX_MIN || num > ITEM_INDEX_MAX) {
    throw errors.validation('itemIndex', '包裹序号不正确，请刷新页面后重试');
  }
  return num;
}

// 写库前把件级取件状态显式化：旧单按订单状态派生补 pickedAt/pickedByNo（只写本单，不做批量迁移）。
function materializeOf(order, nowDate) {
  const derived = derivedPickedOf(order);
  const pickedByNo = partnerNoOf(order);
  const orderMs = timeMsOf(order && order.pickedAt) || timeMsOf(nowDate);
  return store.orderParcelsOf(order).map((parcel) => {
    const next = Object.assign({}, parcel && typeof parcel === 'object' ? parcel : {});
    if (!hasOwnPickedAt(parcel)) {
      next.pickedAt = derived ? new Date(orderMs) : null;
      next.pickedByNo = derived ? pickedByNo : null;
    }
    return next;
  });
}

// 写回 patch：新订单写 parcels[]；历史单仍写单包裹 parcel{}，避免把兼容形态改成混合态（同 order.correct）。
function patchOf(order, parcels) {
  if (Array.isArray(order.parcels)) {
    return { parcels };
  }
  return { parcel: parcels[0] };
}

// 整单取件/撤销：全部件 pickedAt/pickedByNo 统一置为入参值（null = 未取）。
function applyAll(parcels, pickedAt, pickedByNo) {
  return parcels.map((parcel) => Object.assign({}, parcel, { pickedAt, pickedByNo }));
}

// 逐件取件/撤销：只动 itemIndex 那件，其余件保持现值（不清掉别件已落库的件级进度）。
function applyOne(parcels, itemIndex, pickedAt, pickedByNo) {
  return parcels.map((parcel, index) => (
    index === itemIndex ? Object.assign({}, parcel, { pickedAt, pickedByNo }) : parcel
  ));
}

module.exports = {
  hasOwnPickedAt,
  derivedPickedOf,
  isPickedOf,
  pickedAtMsOf,
  summaryOfParcels,
  actionsOf,
  partnerNoOf,
  readItemIndexOf,
  materializeOf,
  patchOf,
  applyAll,
  applyOne
};
