// pkg-partner/pages/create-on-behalf/parts/payload-model.js · 代客下单请求体纯件（零 wx、零请求）
// 口径：docs/contract/V4_CONTRACT.md §4/§5.2/§5.3 v1.0（D23/D24/D25）与 D44：order.create 单入口
//       {parcels[1~10], images[0~10], tickets?[], serviceCode, appoint, note, manualEntry, guest?/bindingId?, delivery?}
//       createBatch 已移除（一图多码 = 同一订单多包裹）；每件包裹各自输出 stationId/stationName（D44）。
// 边界：只做请求体/幂等键签名装配；校验在 form-model.validateDetailed（调用方唯一入口）。
'use strict';

const formModel = require('./form-model');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// 预约（D47）：ASAP 只带 type；LATEST 带 latestAt（UTC+8 ISO 串，服务端按 now 再收紧）
function appointOf(state) {
  return formModel.appointPayloadOf(state);
}

// 截图 0~10 张（D40/D44）：顶层 images[] + tickets[] 同序一一对应；无截图 = 空数组 + manualEntry=true
function imagesOf(state) {
  const source = state || {};
  const images = [];
  const tickets = [];
  listOf(source.files).forEach(function each(file) {
    const fileId = textOf(file && file.fileId);
    const ticket = textOf(file && file.uploadTicketId);
    if (!fileId || !ticket || images.length >= formModel.IMAGE_MAX) {
      return;
    }
    images.push({ fileId: fileId });
    tickets.push(ticket);
  });
  return { images: images, tickets: tickets };
}

// D25：代客单本单配送地址 = guest 快照（收件人=代客称呼）；已绑定路径不传，服务端按下单人宿舍默认
function deliveryOf(state) {
  if (state.customerMode !== 'GUEST') {
    return null;
  }
  const guest = state.guest || {};
  const buildingNo = Number(guest.buildingNo);
  const zone = textOf(guest.zone);
  return {
    zone: zone,
    buildingNo: buildingNo,
    room: textOf(guest.room),
    dormKey: formModel.guestDormKey(guest),
    buildingText: zone + String(buildingNo),
    recipientName: textOf(guest.displayName),
    phoneTail: textOf(guest.phoneTail)
  };
}

// D44：每件输出自己的站点（不再把页面级单值复制给所有件）；imageIndex 只在该件确实来自某张图时带上
function parcelPayloadOf(item, index, imageCount) {
  const parcel = item || formModel.emptyParcel(1);
  const row = {
    pickupCode: textOf(parcel.pickupCode),
    lockerNo: textOf(parcel.lockerNo),
    trackingTail: textOf(parcel.trackingTail),
    stationId: textOf(parcel.stationId),
    stationName: textOf(parcel.stationName) || formModel.stationNameOfItem(parcel)
  };
  const imageIndex = Number(parcel.imageIndex);
  if (Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex < imageCount) {
    row.imageIndex = imageIndex;
  }
  const failureId = textOf(parcel.failureId);
  if (failureId) {
    row.failureId = failureId;
  }
  return row;
}

// 请求体：v1.0 单入口 order.create（parcels 多件；无截图 manualEntry=true；代客单带 guest+delivery）
// options.nowMs：提交时注入的「请求时」serverNow（透传 form-model.validateDetailed，TD-084④）
function buildPayload(state, options) {
  const source = state || {};
  const detailed = formModel.validateDetailed(source, options);
  if (detailed.message) {
    return { ok: false, batch: false, data: null, message: detailed.message, step: detailed.step };
  }
  const items = listOf(source.items);
  const service = formModel.currentService(source);
  const imageParts = imagesOf(source);
  const guest = source.customerMode === 'GUEST' ? {
    displayName: textOf(source.guest.displayName),
    phoneTail: textOf(source.guest.phoneTail),
    zone: source.guest.zone,
    buildingNo: Number(source.guest.buildingNo),
    room: textOf(source.guest.room),
    dormKey: formModel.guestDormKey(source.guest)
  } : null;
  const binding = source.customerMode === 'BOUND' ? formModel.currentBinding(source) : null;
  const parcels = items.map(function each(item, index) {
    return parcelPayloadOf(item, index, imageParts.images.length);
  });
  const data = {
    parcels: parcels,
    serviceCode: service.code,
    appoint: appointOf(source),
    note: textOf(source.note),
    manualEntry: imageParts.images.length === 0
  };
  if (imageParts.images.length > 0) {
    data.images = imageParts.images;
    data.tickets = imageParts.tickets;
  }
  if (binding) {
    data.bindingId = binding.bindingId;
  }
  if (guest) {
    data.guest = guest;
    data.delivery = deliveryOf(source);
  }
  return { ok: true, batch: false, data: data, message: '', step: 0 };
}

// 提交内容签名：内容变化 → 更换幂等键（避免旧键复用导致"提交成功却报重复"）
function contentSignature(state) {
  const source = state || {};
  const binding = source.customerMode === 'BOUND' ? formModel.currentBinding(source) : null;
  const guest = source.customerMode === 'GUEST' ? (source.guest || {}) : null;
  const imageParts = imagesOf(source);
  return JSON.stringify({
    mode: source.customerMode,
    bindingId: binding ? binding.bindingId : '',
    guest: guest ? {
      displayName: textOf(guest.displayName),
      phoneTail: textOf(guest.phoneTail),
      zone: textOf(guest.zone),
      buildingNo: textOf(guest.buildingNo),
      room: textOf(guest.room)
    } : null,
    service: (formModel.currentService(source) || {}).code || '',
    appoint: formModel.appointSignatureOf(source),
    parcels: listOf(source.items).map(function map(item) {
      return [
        textOf(item && item.stationId),
        textOf(item && item.pickupCode),
        textOf(item && item.lockerNo),
        textOf(item && item.trackingTail)
      ];
    }),
    images: imageParts.images.map(function map(image) { return image.fileId; }),
    note: textOf(source.note),
    recognition: textOf(source.recognitionFailureId)
  });
}

module.exports = {
  buildPayload,
  contentSignature,
  deliveryOf,
  imagesOf,
  parcelPayloadOf
};
