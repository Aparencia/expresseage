// handlers/order/_dto-fields.js · 订单 DTO 聚合字段纯件（v1.0 一单多包裹：parcels[]/images[]/delivery/manualEntry）
// 口径：CONTRACT v1.0 §4/§5.2（D23/D24/D25）；历史单 parcel{}/image{} 只在这里归一（不写库）。
// 边界：纯映射（零 DB/零 wx）；由 _dto.js 组装订单视图，避免主 DTO 文件超 500 行。
'use strict';

const enums = require('../../shared/enums');
const mask = require('../../db/dto/mask');
const time = require('../../lib/time');
const store = require('./_store');
const pickedState = require('./_picked');
const { recognitionSourceLabel } = require('../../lib/ai/parse');

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function numberOrZero(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

// 时间归一（DTO 单源）：number/Date/非空字符串 → 毫秒；其余/空 → 0。
// 不能直接用 time.toMs：它对非 number/Date 回落 Date.now()，会把"已清空的时间戳"序列化成当前真实时钟。
function msOf(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const ms = time.toMs(value);
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

function isoOf(value) {
  const ms = msOf(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

// 单件包裹视图（v1.0 parcels[] 的元素，itemIndex=包裹序号；历史单 parcel{} 也走同一归一）
// D61 件级取件：picked/pickedAt（毫秒，未取=0）+ actions[]（仅 PARTNER 侧，固定契约矩阵）。
function buildParcelDto(parcel, index, context) {
  const source = parcel && typeof parcel === 'object' ? parcel : {};
  const order = context && context.order;
  const picked = order ? pickedState.isPickedOf(order, source) : false;
  const codeStatus = source.codeStatus === enums.CODE_STATUS.NEED_CODE
    ? enums.CODE_STATUS.NEED_CODE
    : enums.CODE_STATUS.OK;
  const recognitionSource = textOf(source.recognitionSource) || enums.RECOGNITION_SOURCE.RULE;
  const dto = {
    itemIndex: typeof index === 'number' && index >= 0 ? index : 0,
    stationId: textOf(source.stationId),
    stationName: textOf(source.stationName),
    pickupCode: textOf(source.pickupCode),
    lockerNo: textOf(source.lockerNo),
    trackingTail: textOf(source.trackingTail),
    codeStatus,
    codeStatusText: enums.CODE_STATUS_TEXT[codeStatus],
    recognitionSource,
    recognitionSourceLabel: recognitionSourceLabel(recognitionSource),
    confidence: textOf(source.confidence),
    picked,
    pickedAt: order ? pickedState.pickedAtMsOf(order, source) : 0,
    actions: order ? pickedState.actionsOf(order, context.side, picked) : []
  };
  if (typeof source.failureId === 'string' && source.failureId) {
    dto.failureHint = true;
  }
  return dto;
}

function buildParcelDtos(order, side) {
  return store.orderParcelsOf(order).map((parcel, index) => buildParcelDto(parcel, index, { order, side }));
}

// 单张截图可见性（批 5 契约 B）：status=CLEANED 已按隐私策略清理（cleanup 写该张图片 cleanedAt）、
// AVAILABLE 可看、MISSING 无 fileId。hasImage/cleaned 为旧口径兼容键（历史单 image{} 同构）。
// 不下发 fileId：客户端预览只经 order.imageUrl({index}) 鉴权签发（DTO_BANNED_KEYS + 存储私有口径）。
function buildImageDto(image, index) {
  const source = image && typeof image === 'object' ? image : {};
  const cleaned = !!source.cleanedAt;
  const hasFileId = typeof source.fileId === 'string' && source.fileId !== '';
  return {
    index: typeof index === 'number' && index >= 0 ? index : 0,
    status: cleaned ? 'CLEANED' : (hasFileId ? 'AVAILABLE' : 'MISSING'),
    hasImage: hasFileId && !cleaned,
    cleaned
  };
}

function buildImageDtos(order) {
  return store.orderImagesOf(order).map((image, index) => buildImageDto(image, index));
}

// 本单配送地址（D25）：新订单 delivery 快照；历史单按 dorm（下单人宿舍）归一，保持前端统一读取。
function buildDeliveryDto(delivery) {
  if (!delivery || typeof delivery !== 'object') {
    return null;
  }
  const out = {
    zone: textOf(delivery.zone),
    buildingNo: numberOrZero(delivery.buildingNo),
    buildingText: textOf(delivery.buildingText),
    room: textOf(delivery.room),
    dormKey: textOf(delivery.dormKey)
  };
  if (textOf(delivery.recipientName)) {
    out.recipientName = textOf(delivery.recipientName);
  }
  if (textOf(delivery.phoneTail)) {
    out.phoneTail = textOf(delivery.phoneTail);
  }
  return out;
}

function deliveryOf(order) {
  return buildDeliveryDto(order && order.delivery) || buildDeliveryDto(order && order.dorm);
}

function needCodeOf(order) {
  return store.orderParcelsOf(order).some((parcel) => parcel && parcel.codeStatus === enums.CODE_STATUS.NEED_CODE);
}

function failureHintOf(order) {
  const inParcels = store.orderParcelsOf(order).some((parcel) => typeof (parcel && parcel.failureId) === 'string'
    && parcel.failureId !== '');
  return inParcels || !!(order && order.image && order.image.failureId);
}

// admin 真实会话 delivery 脱敏：只保留苑/栋快照与脱敏称呼/尾号，room/dormKey 不返回精确值
function maskDeliveryDto(delivery) {
  if (!delivery) {
    return null;
  }
  const out = {
    zone: delivery.zone,
    buildingNo: delivery.buildingNo,
    buildingText: mask.maskDorm(delivery),
    room: '',
    dormKey: ''
  };
  if (delivery.recipientName) {
    out.recipientName = mask.maskDisplayName(delivery.recipientName);
  }
  if (delivery.phoneTail) {
    out.phoneTail = mask.maskPhoneTail(delivery.phoneTail);
  }
  return out;
}

module.exports = {
  textOf,
  numberOrZero,
  msOf,
  isoOf,
  buildParcelDto,
  buildParcelDtos,
  buildImageDto,
  buildImageDtos,
  buildDeliveryDto,
  deliveryOf,
  needCodeOf,
  failureHintOf,
  maskDeliveryDto
};
