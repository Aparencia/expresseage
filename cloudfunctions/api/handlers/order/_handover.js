// handlers/order/_handover.js · D81 转派发起者「已转出」只读跟踪（最近一次转派 = 本单由我转出且已被接收）
// 口径（D81，2026-11-14 用户要求「转派发起者应能继续跟踪订单」）：
//   · 只有 transfer.fromPartnerId=本人 且 transfer.status=ACCEPTED 的原履约人可读；
//   · **只给进度**：订单号/状态/进度/当前履约人编号/时间戳/件数/转派结果；**不给顾客身份、宿舍地址、取件码、截图、动作**；
//   · 订单转出后原履约人不再是履约人，任何写动作仍 FORBIDDEN（本文件只读，不参与动作矩阵）。
'use strict';

const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const transfer = require('./_transfer');

// 可跟踪的订单状态：转出后从接单到终态都能看到进度；取消也保留（发起者需要知道结果）
const TRACKABLE_STATUSES = [
  enums.ORDER_STATUS.ACCEPTED,
  enums.ORDER_STATUS.PICKED,
  enums.ORDER_STATUS.DELIVERED,
  enums.ORDER_STATUS.COMPLETED,
  enums.ORDER_STATUS.EXCEPTION,
  enums.ORDER_STATUS.CANCELLED
];

function statusOf(order) {
  const value = order && typeof order.status === 'string' ? order.status : '';
  return value;
}

// 发起者判定：最近一次转派由本人发起、已被接收，且本人已不是当前履约人（防止"转回自己"仍走跟踪视图）
function isInitiatorOf(order, partnerId) {
  const block = transfer.transferOf(order);
  if (!block || block.status !== transfer.STATUS.ACCEPTED) {
    return false;
  }
  if (!transfer.sameId(block.fromPartnerId, partnerId)) {
    return false;
  }
  return !transfer.sameId(order && order.partnerId, partnerId);
}

function isoOf(value) {
  return transfer.isoOf(value);
}

// 跟踪视图（最小投影）：只保留"这单走到哪了"必需字段；键集合固定，新增字段必须同步 DATA_MODEL §7.5 与 selftest
function summaryOf(order) {
  const source = order || {};
  const parcels = Array.isArray(source.parcels) ? source.parcels
    : (source.parcel && typeof source.parcel === 'object' ? [source.parcel] : []);
  const pickedCount = parcels.filter((parcel) => parcel && parcel.picked === true).length;
  return {
    handover: true,
    orderNo: transfer.textOf(source.orderNo),
    status: statusOf(source),
    statusText: orderState.statusText(statusOf(source)),
    progressIndex: orderState.progressIndex(statusOf(source)),
    fulfillmentPartnerNo: transfer.textOf(source.partnerNo),
    transfer: transfer.blockOf(source, 'PARTNER'),
    service: {
      code: transfer.textOf(source.service && source.service.code),
      name: transfer.textOf(source.service && source.service.name)
    },
    parcelCount: parcels.length,
    pickedCount: pickedCount,
    allPicked: parcels.length > 0 && pickedCount === parcels.length,
    statusUpdatedAt: isoOf(source.statusUpdatedAt),
    deliveredAt: isoOf(source.deliveredAt),
    completedAt: isoOf(source.completedAt),
    cancelledAt: isoOf(source.cancelledAt)
  };
}

// 列表行（与详情同投影，避免两套字段漂移）
function rowOf(order) {
  return summaryOf(order);
}

module.exports = {
  TRACKABLE_STATUSES,
  isInitiatorOf,
  summaryOf,
  rowOf
};
