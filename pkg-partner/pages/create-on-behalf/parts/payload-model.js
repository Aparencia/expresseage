// pkg-partner/pages/create-on-behalf/parts/payload-model.js · 代客下单请求体纯件（零 wx、零请求）
// 口径：docs/V4_CONTRACT.md §4/§5.2/§5.3 v1.0（D23/D24/D25）：order.create 单入口
//       {parcels[1~10], images[0~5], tickets?[], serviceCode, appoint, note, manualEntry, guest?/bindingId?, delivery?}
//       createBatch 已移除（一图多码 = 同一订单多包裹）。
// 边界：只做请求体/幂等键签名装配；校验在 form-model.validate（调用方唯一入口）。
'use strict';

const formModel = require('./form-model');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function appointOf(state) {
  const option = formModel.currentAppoint(state);
  const appoint = { type: option.key || 'ASAP' };
  if (appoint.type === 'SLOT') {
    appoint.startAt = option.startAt;
    appoint.endAt = option.endAt;
  }
  return appoint;
}

// 截图是 0~1 张（代客单每单一张）；v1.0 顶层改 images[] + tickets[]，无截图 = 空数组 + manualEntry
function imageOf(state) {
  const ticket = textOf(state.imageTicketId);
  const fileId = textOf(state.imageFileId);
  if (!ticket || !fileId) {
    return null;
  }
  return { image: { fileId: fileId }, ticket: ticket };
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

function parcelPayloadOf(item, state) {
  const parcel = item || formModel.emptyParcel();
  const station = formModel.currentStation(state);
  return {
    pickupCode: textOf(parcel.pickupCode),
    lockerNo: textOf(parcel.lockerNo),
    trackingTail: textOf(parcel.trackingTail),
    stationId: textOf(station && station.id),
    stationName: station && station.id ? textOf(station.name) : ''
  };
}

// 请求体：v1.0 单入口 order.create（parcels 多件；无截图 manualEntry=true；代客单带 guest+delivery）
function buildPayload(state) {
  const source = state || {};
  const message = formModel.validate(source);
  if (message) {
    return { ok: false, batch: false, data: null, message: message };
  }
  const items = listOf(source.items);
  const service = formModel.currentService(source);
  const image = imageOf(source);
  const guest = source.customerMode === 'GUEST' ? {
    displayName: textOf(source.guest.displayName),
    phoneTail: textOf(source.guest.phoneTail),
    zone: source.guest.zone,
    buildingNo: Number(source.guest.buildingNo),
    room: textOf(source.guest.room),
    dormKey: formModel.guestDormKey(source.guest)
  } : null;
  const binding = source.customerMode === 'BOUND' ? formModel.currentBinding(source) : null;
  const failureId = textOf(source.recognitionFailureId);
  const parcels = items.map((item, index) => {
    const row = parcelPayloadOf(item, source);
    if (failureId && index === 0) {
      row.failureId = failureId;
    }
    return row;
  });
  const data = {
    parcels: parcels,
    serviceCode: service.code,
    appoint: appointOf(source),
    note: textOf(source.note),
    manualEntry: !image
  };
  if (image) {
    data.images = [image.image];
    data.tickets = [image.ticket];
  }
  if (binding) {
    data.bindingId = binding.bindingId;
  }
  if (guest) {
    data.guest = guest;
    data.delivery = deliveryOf(source);
  }
  return { ok: true, batch: false, data: data, message: '' };
}

// 提交内容签名：内容变化 → 更换幂等键（避免旧键复用导致"提交成功却报重复"）
function contentSignature(state) {
  const source = state || {};
  const binding = source.customerMode === 'BOUND' ? formModel.currentBinding(source) : null;
  const guest = source.customerMode === 'GUEST' ? (source.guest || {}) : null;
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
    station: (formModel.currentStation(source) || {}).id || '',
    appoint: formModel.currentAppoint(source).key || '',
    parcels: listOf(source.items).map((item) => [
      textOf(item && item.pickupCode), textOf(item && item.lockerNo), textOf(item && item.trackingTail)
    ]),
    note: textOf(source.note),
    ticket: textOf(source.imageTicketId),
    image: textOf(source.imageFileId),
    recognition: textOf(source.recognitionFailureId)
  });
}

module.exports = {
  buildPayload,
  contentSignature,
  deliveryOf,
  imageOf,
  parcelPayloadOf
};
