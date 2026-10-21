// shared/order-view.js · 订单视图模型（状态中文 / 四档动线排序 / 状态桶 / counts 六项键名）
// 契约：docs/V4_CONTRACT.md v0.9 §5「列表动线排序（四档）」；docs/V4_DATA_MODEL.md §5.2/§7.5/§8.5
//       （工作台 counts 六项：submitted/accepted/picked/delivered/exception/todayCompleted）。
// 口径：排序唯一源在服务端；本文件是同一份纯逻辑的共用件（云端 listPartner 与客户端零件可共用），
//       页面不重排、只渲染。四档：①需查明 ②快递柜 ③分段码 ④其他；同档按码中数字升序 → orderNo 兜底。
'use strict';

const enums = require('./enums');

const COUNTS_KEYS = ['submitted', 'accepted', 'picked', 'delivered', 'exception', 'todayCompleted'];

// 状态桶（工作台筛选/红点/订单列表分组共用）
const STATUS_BUCKETS = {
  submitted: [enums.ORDER_STATUS.SUBMITTED],
  accepted: [enums.ORDER_STATUS.ACCEPTED],
  picked: [enums.ORDER_STATUS.PICKED],
  delivered: [enums.ORDER_STATUS.DELIVERED],
  exception: [enums.ORDER_STATUS.EXCEPTION],
  history: [enums.ORDER_STATUS.COMPLETED, enums.ORDER_STATUS.CANCELLED]
};

const PICKUP_TIERS = [
  { tier: 1, key: 'NEED_CODE', text: '需查明' },
  { tier: 2, key: 'LOCKER', text: '快递柜' },
  { tier: 3, key: 'SEGMENT', text: '分段码' },
  { tier: 4, key: 'PLAIN', text: '其他' }
];

const TIER_TEXT = {
  1: '需查明',
  2: '快递柜',
  3: '分段码',
  4: '其他'
};

function countsTemplate() {
  const counts = {};
  COUNTS_KEYS.forEach((key) => {
    counts[key] = 0;
  });
  return counts;
}

function statusText(status) {
  return enums.ORDER_STATUS_TEXT[status] || '';
}

function bucketOf(status) {
  const keys = Object.keys(STATUS_BUCKETS);
  for (let i = 0; i < keys.length; i += 1) {
    if (STATUS_BUCKETS[keys[i]].indexOf(status) !== -1) {
      return keys[i];
    }
  }
  return '';
}

function pickupCodeOf(order) {
  const parcel = (order && order.parcel) || {};
  return typeof parcel.pickupCode === 'string' ? parcel.pickupCode : '';
}

function lockerNoOf(order) {
  const parcel = (order && order.parcel) || {};
  return typeof parcel.lockerNo === 'string' ? parcel.lockerNo : '';
}

// 档位：1 需查明（codeStatus=NEED_CODE）→ 2 快递柜（lockerNo 非空）→ 3 分段码（码含非数字字符）→ 4 其他
function pickupTier(order) {
  const parcel = (order && order.parcel) || {};
  if (parcel.codeStatus === enums.CODE_STATUS.NEED_CODE) {
    return 1;
  }
  if (lockerNoOf(order) !== '') {
    return 2;
  }
  if (/[^0-9]/.test(pickupCodeOf(order))) {
    return 3;
  }
  return 4;
}

function pickupTierText(tier) {
  return TIER_TEXT[tier] || '';
}

// 码中数字作为同档排序键（无数字排最后）
function codeNumber(order) {
  const digits = pickupCodeOf(order).replace(/[^0-9]/g, '');
  if (digits === '') {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(digits);
}

function orderNoOf(order) {
  return (order && order.orderNo) || '';
}

function comparePickupRoute(a, b) {
  const tierDelta = pickupTier(a) - pickupTier(b);
  if (tierDelta !== 0) {
    return tierDelta;
  }
  const numberDelta = codeNumber(a) - codeNumber(b);
  if (numberDelta !== 0) {
    return numberDelta;
  }
  const leftNo = orderNoOf(a);
  const rightNo = orderNoOf(b);
  if (leftNo === rightNo) {
    return 0;
  }
  return leftNo < rightNo ? -1 : 1;
}

// 返回新数组（稳定：同键保持原顺序），前端不得二次重排
function sortByPickupRoute(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((order, index) => ({ order, index }))
    .sort((left, right) => comparePickupRoute(left.order, right.order) || left.index - right.index)
    .map((item) => item.order);
}

function timeOf(order, field) {
  const value = order && order[field];
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return 0;
}

// 进行中列表：statusUpdatedAt 倒序（服务端同口径，客户端不二次排序时可不调用）
function sortByStatusUpdatedDesc(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.slice().sort((a, b) => timeOf(b, 'statusUpdatedAt') - timeOf(a, 'statusUpdatedAt'));
}

// 已完成/已取消列表：completedAt/cancelledAt 倒序
function sortByFinishedDesc(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.slice().sort((a, b) => {
    const left = Math.max(timeOf(a, 'completedAt'), timeOf(a, 'cancelledAt'));
    const right = Math.max(timeOf(b, 'completedAt'), timeOf(b, 'cancelledAt'));
    return right - left;
  });
}

module.exports = {
  COUNTS_KEYS,
  STATUS_BUCKETS,
  PICKUP_TIERS,
  countsTemplate,
  statusText,
  bucketOf,
  pickupTier,
  pickupTierText,
  comparePickupRoute,
  sortByPickupRoute,
  sortByStatusUpdatedDesc,
  sortByFinishedDesc
};
