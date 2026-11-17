// handlers/order/_review.js · D92 审核共用件（订单级两级状态 + 件数增删）
// 口径：CONTRACT §13 D92；DATA_MODEL §2.5（orders.review）/§7.5。
// 边界：不改订单状态（to:'SAME'）；件数增删只在未取件阶段；已取件的件禁止删除；审计/事件由调用方写。
'use strict';

const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');

const REVIEW_STATUSES = [orderState.REVIEW_STATUS.UNREVIEWED, orderState.REVIEW_STATUS.REVIEWED];
// 审核范围：有截图可核对的三态（与审核页列表一致）；件数增删更窄，只到未取件
const REVIEWABLE_STATUSES = [
  enums.ORDER_STATUS.SUBMITTED, enums.ORDER_STATUS.ACCEPTED, enums.ORDER_STATUS.PICKED
];
const PARCEL_EDITABLE_STATUSES = [enums.ORDER_STATUS.SUBMITTED, enums.ORDER_STATUS.ACCEPTED];
const MAX_PARCELS = orderState.MAX_PARCELS_PER_ORDER;
// 审核写动作的响应视图：兼职侧 + 不带 actions（页面只消费 review/parcels/version，
// 不含顾客资料，避免写响应多一次 counterpart 查询）。
const PARTNER_RESPONSE_VIEW = Object.freeze({ side: 'PARTNER', withActions: false, withCounterpart: false });

function reviewOf(order) {
  const value = order && order.review;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// 未审核/已审核：旧单无字段 ⇒ 视为未审核（零迁移，与 transfer 的处理同风格）
function statusOf(order) {
  const review = reviewOf(order);
  const status = review && review.status;
  return REVIEW_STATUSES.indexOf(status) >= 0 ? status : orderState.REVIEW_STATUS.UNREVIEWED;
}

function isReviewed(order) {
  return statusOf(order) === orderState.REVIEW_STATUS.REVIEWED;
}

function statusTextOf(order) {
  return orderState.REVIEW_STATUS_TEXT[statusOf(order)] || '';
}

function atMsOf(order) {
  const review = reviewOf(order);
  const value = review && review.at;
  const ms = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return isFinite(ms) && ms > 0 ? ms : 0;
}

// 审核动作的服务端闸（引擎已按 ACTION_RULES 挡一次，这里给"更窄"的业务闸与真话文案）
function assertReviewable(order) {
  if (REVIEWABLE_STATUSES.indexOf(order.status) < 0) {
    throw errors.invalidState('当前进度不能审核（只能审待接单/已接单/已取件的单）');
  }
}

function assertParcelsEditable(order) {
  if (PARCEL_EDITABLE_STATUSES.indexOf(order.status) < 0) {
    throw errors.invalidState('已取件的订单不能再增减件数');
  }
}

function parcelsOf(order) {
  return Array.isArray(order && order.parcels) ? order.parcels : [];
}

function pickedAny(order) {
  return parcelsOf(order).some((parcel) => !!parcel && (parcel.picked === true || !!parcel.pickedAt));
}

// 增件：复制末件字段作默认（取件码留空由审核人补），新件 picked=false、无截图映射
function addedParcelOf(order) {
  const list = parcelsOf(order);
  if (list.length >= MAX_PARCELS) {
    throw errors.validation('parcels', '一单最多 ' + MAX_PARCELS + ' 件');
  }
  const base = list[list.length - 1] || {};
  return {
    stationId: base.stationId || '',
    stationName: base.stationName || '',
    pickupCode: '',
    lockerNo: '',
    trackingTail: '',
    // 与既有枚举同源：空码 = NEED_CODE（缺失/异常一律按 NEED_CODE 展示，不能落成 OK）
    codeStatus: enums.CODE_STATUS.NEED_CODE,
    recognitionSource: 'MANUAL',
    confidence: 'LOW',
    picked: false,
    pickedAt: null
  };
}

// 删件：仅未取件阶段且该件未被取（已取件件删除会丢履约证据）
function removedParcelsOf(order, index) {
  assertParcelsEditable(order);
  const list = parcelsOf(order);
  const target = list[index];
  if (!target) {
    throw errors.validation('parcelIndex', '找不到这一件，刷新后再试');
  }
  if (target.picked === true || target.pickedAt) {
    throw errors.invalidState('这一件已经取件，不能删除');
  }
  if (list.length <= 1) {
    throw errors.validation('parcels', '至少要保留 1 件；整单不要请走取消');
  }
  return list.filter((item, i) => i !== index);
}

// DTO 投影：状态 + 两个布尔（页面零判据）——不把内部字段/操作人 id 下发
function dtoOf(order) {
  const status = statusOf(order);
  return {
    status: status,
    statusText: statusTextOf(order),
    at: atMsOf(order),
    byPartnerNo: (reviewOf(order) && reviewOf(order).byPartnerNo) || '',
    canMark: status === orderState.REVIEW_STATUS.UNREVIEWED && REVIEWABLE_STATUSES.indexOf(order && order.status) >= 0,
    canReopen: status === orderState.REVIEW_STATUS.REVIEWED && REVIEWABLE_STATUSES.indexOf(order && order.status) >= 0,
    canAdjustParcels: PARCEL_EDITABLE_STATUSES.indexOf(order && order.status) >= 0 && !pickedAny(order)
  };
}

// D92 审核事件识别：ORDER_CORRECTED + payload.reviewStatus/reviewParcels = 内部审核动作
// （不改订单状态、不通知顾客）；顾客时间线与消息中心都按本判据过滤，改码事件不受影响。
function isReviewEventOf(event) {
  const payload = event && event.payload;
  if (!event || event.type !== 'ORDER_CORRECTED' || !payload || typeof payload !== 'object') {
    return false;
  }
  return !!payload.reviewStatus || !!payload.reviewParcels;
}

module.exports = {
  PARTNER_RESPONSE_VIEW,
  statusOf,
  statusTextOf,
  isReviewed,
  atMsOf,
  assertReviewable,
  assertParcelsEditable,
  addedParcelOf,
  removedParcelsOf,
  isReviewEventOf,
  dtoOf
};
