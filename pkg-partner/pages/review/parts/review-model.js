// pkg-partner/pages/review/parts/review-model.js · 审核核对页纯件（零 wx、零请求）
// 口径（2026-11-08 用户指令，MVP）：兼职在工作台进入「审核」，一屏查看顾客上传的每一张取件码截图
// 与其订单信息，发现不一致可直接改订单字段（复用 order.correct），**不留审核状态、不加集合、不阻塞取件**。
// 边界：只做列表筛选/锚文案/编辑字段与 patch 归一；服务端 order.correct 仍是唯一权威校验。
'use strict';

const enums = require('../../../../shared/enums');
const roomTag = require('../../../../utils/room-tag');

// 可核对的状态：待接单/已接单/已取件（已送达/终态/异常不在此页处理）
const REVIEW_STATUSES = [
  enums.ORDER_STATUS.SUBMITTED,
  enums.ORDER_STATUS.ACCEPTED,
  enums.ORDER_STATUS.PICKED
];

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function statusOf(order, state) {
  return textOf(order && order.status) || textOf(state && state.status);
}

// 截图张数：优先 images[]；旧单 image 单图兼容
function imageCountOf(order) {
  const images = listOf(order && order.images);
  if (images.length) {
    return images.length;
  }
  const image = (order && order.image) || {};
  return image.hasImage === true || textOf(image.fileId) ? 1 : 0;
}

function anchorOf(order) {
  const dorm = (order && order.dorm) || {};
  const delivery = (order && order.delivery) || {};
  const key = textOf(dorm.dormKey) || textOf(delivery.dormKey);
  if (!key) {
    return '宿舍待同步';
  }
  const tag = textOf(dorm.roomTag);
  return roomTag.formatDormTag(key, tag) || key;
}

function parcelCountTextOf(order) {
  const count = listOf(order && order.parcels).length;
  return count > 1 ? count + ' 件' : '';
}

// 列表行（只保留「有截图 + 可核对状态」的单）
function listRowsOf(list) {
  return listOf(list).filter(function pick(order) {
    return imageCountOf(order) > 0 && REVIEW_STATUSES.indexOf(statusOf(order)) >= 0;
  }).map(function row(order) {
    return {
      orderNo: textOf(order.orderNo),
      status: statusOf(order),
      statusText: textOf(order.statusText) || statusOf(order),
      anchorText: anchorOf(order),
      imageCount: imageCountOf(order),
      imageCountText: '截图 ' + imageCountOf(order) + ' 张',
      parcelCountText: parcelCountTextOf(order),
      createdAtText: textOf(order.statusUpdatedAt) ? '' : ''
    };
  });
}

// 单件编辑字段：初值来自订单 DTO（服务端已归一）
function parcelEditorOf(parcel, index) {
  const item = parcel || {};
  return {
    index: index,
    indexText: '第 ' + (index + 1) + ' 件',
    stationId: textOf(item.stationId),
    stationName: textOf(item.stationName),
    pickupCode: textOf(item.pickupCode),
    lockerNo: textOf(item.lockerNo),
    trackingTail: textOf(item.trackingTail),
    codeStatus: textOf(item.codeStatus),
    needCode: textOf(item.codeStatus) === enums.CODE_STATUS.NEED_CODE,
    picked: item.picked === true
  };
}

function parcelEditorsOf(order) {
  return listOf(order && order.parcels).map(parcelEditorOf);
}

// 归一编辑初值（用于比较「有没有改动」）
function originOf(editor) {
  const item = editor || {};
  return {
    stationId: textOf(item.stationId),
    stationName: textOf(item.stationName),
    pickupCode: textOf(item.pickupCode),
    lockerNo: textOf(item.lockerNo),
    trackingTail: textOf(item.trackingTail)
  };
}

// 只提交改动过的字段（与工作台 code-panel 同口径：没改不发送，避免把未改的码整单驳回）
function patchOf(editor) {
  const current = editor || {};
  const origin = current.origin || originOf(current);
  const patch = {};
  if (textOf(current.pickupCode) !== textOf(origin.pickupCode)) {
    patch.pickupCode = textOf(current.pickupCode);
  }
  if (textOf(current.lockerNo) !== textOf(origin.lockerNo)) {
    patch.lockerNo = textOf(current.lockerNo);
  }
  if (textOf(current.trackingTail) !== textOf(origin.trackingTail)) {
    patch.trackingTail = textOf(current.trackingTail);
  }
  if (textOf(current.stationId) !== textOf(origin.stationId)) {
    patch.stationId = textOf(current.stationId);
    patch.stationName = textOf(current.stationName);
  }
  return patch;
}

// 本地预校验（服务端仍权威）：码/尾号至少一个；尾号恰 5 位；码/柜号长度
function validateEditor(editor) {
  const item = editor || {};
  const code = textOf(item.pickupCode);
  const tail = textOf(item.trackingTail);
  if (!code && !tail) {
    return { ok: false, reason: '取件码或运单尾号至少填一个' };
  }
  if (code.length > 40) {
    return { ok: false, reason: '取件码最多 40 个字符' };
  }
  if (textOf(item.lockerNo).length > 10) {
    return { ok: false, reason: '柜号最多 10 个字' };
  }
  if (tail && !/^[0-9]{5}$/.test(tail)) {
    return { ok: false, reason: '运单尾号要恰好 5 位数字（可空）' };
  }
  return { ok: true, reason: '' };
}

module.exports = {
  imageCountOf,
  anchorOf,
  listRowsOf,
  parcelEditorsOf,
  originOf,
  patchOf,
  validateEditor
};
