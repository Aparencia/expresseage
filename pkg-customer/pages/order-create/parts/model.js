// pkg-customer/pages/order-create/parts/model.js · 下单四步视图模型（纯函数，零 wx）
'use strict';

const recognize = require('../../../../utils/recognize/index');

const STEP_TITLES = ['截图', '核对', '服务', '提交'];
const MAX_BATCH = 5;

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function dateAt(base, dayOffset, hour) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
  return date;
}

function iso(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':00+08:00';
}

/** 六个预约时段：今天/明天 × 上午/下午/晚上（服务端按 serverTime 再校验未来） */
function appointmentSlots(now) {
  const base = now || new Date();
  const defs = [
    { day: 0, label: '今天', from: 8, to: 12 },
    { day: 0, label: '今天', from: 12, to: 18 },
    { day: 0, label: '今天', from: 18, to: 22 },
    { day: 1, label: '明天', from: 8, to: 12 },
    { day: 1, label: '明天', from: 12, to: 18 },
    { day: 1, label: '明天', from: 18, to: 22 }
  ];
  return defs.map(function map(def, index) {
    const start = dateAt(base, def.day, def.from);
    const end = dateAt(base, def.day, def.to);
    return {
      index: index,
      label: def.label + ' ' + pad(def.from) + ':00-' + pad(def.to) + ':00',
      startAt: iso(start),
      endAt: iso(end),
      expired: end.getTime() <= base.getTime()
    };
  });
}

function stationOptions() {
  return recognize.station.listStations();
}

function stationName(id) {
  return recognize.station.stationName(id);
}

function serviceOptions(config, partnerPublic) {
  const catalog = (config && config.serviceCatalog) || [];
  const enabled = ((partnerPublic && partnerPublic.services) || [])
    .filter(function on(item) { return item.enabled !== false; })
    .map(function code(item) { return item.code; });
  const list = catalog.filter(function filter(item) {
    return enabled.length === 0 || enabled.indexOf(item.code) >= 0;
  }).map(function map(item) {
    return { code: item.code, name: item.name, desc: item.desc || '' };
  });
  return list;
}

let itemSeq = 0;

function nextItemKey() {
  itemSeq += 1;
  return 'item_' + itemSeq;
}

function makeItem(partial, defaults) {
  const base = recognize.makeEmptyParcel();
  const item = Object.assign({}, base, partial || {});
  item.key = nextItemKey();
  item.checked = true;
  item.serviceCode = (defaults && defaults.serviceCode) || '';
  item.serviceIndex = 0;
  item.appointType = 'ASAP';
  item.slotIndex = -1;
  item.note = '';
  const result = recognize.validateParcel(item);
  item.codeStatus = result.codeStatus;
  item.formErrors = result.errors;
  return item;
}

function revalidateItem(item) {
  const result = recognize.validateParcel(item);
  item.codeStatus = result.codeStatus;
  item.formErrors = result.errors;
  return item;
}

function canSubmit(items) {
  const checked = (items || []).filter(function on(item) { return item.checked; });
  if (checked.length === 0) return { ok: false, reason: '至少选择一件再提交' };
  if (checked.length > MAX_BATCH) return { ok: false, reason: '一图最多拆 5 件' };
  for (let i = 0; i < checked.length; i += 1) {
    const item = revalidateItem(checked[i]);
    if (!item.stationId) return { ok: false, reason: '请补全站点后再提交', index: items.indexOf(item) };
    if (item.codeStatus === 'NONE') return { ok: false, reason: '请补全取件码或运单后 5 位', index: items.indexOf(item) };
    if (Object.keys(item.formErrors).length > 0) {
      return { ok: false, reason: item.formErrors[Object.keys(item.formErrors)[0]], index: items.indexOf(item) };
    }
  }
  return { ok: true, items: checked };
}

function buildPayload(items, ticket, image, recognition) {
  const list = (items || []).filter(function on(item) { return item.checked; }).map(function map(item) {
    const payload = {
      parcel: {
        stationId: item.stationId,
        stationName: item.stationName || stationName(item.stationId),
        pickupCode: item.pickupCode || '',
        lockerNo: item.lockerNo || '',
        trackingTail: item.trackingTail || '',
        codeStatus: recognize.validateParcel(item).codeStatus
      },
      serviceCode: item.serviceCode,
      appoint: item.appointType === 'SLOT'
        ? { type: 'SLOT', startAt: item.startAt, endAt: item.endAt }
        : { type: 'ASAP' },
      note: item.note || ''
    };
    return payload;
  });
  // 识别失败关联：order.create/createBatch 认 payload.recognition.failureId（AI 兜底失败记录号）
  const failureId = recognition && typeof recognition.failureId === 'string' ? recognition.failureId : '';
  return {
    ticket: ticket,
    image: image,
    items: list,
    recognition: failureId ? { failureId: failureId } : null,
    single: list.length === 1,
    batch: list.length > 1
  };
}

function summaryText(item) {
  return recognize.summarizeParcel(revalidateItem(item)) || '待补充';
}

function stepTitle(step) {
  return STEP_TITLES[step - 1] || '';
}

module.exports = {
  STEP_TITLES,
  MAX_BATCH,
  appointmentSlots,
  stationOptions,
  stationName,
  serviceOptions,
  makeItem,
  revalidateItem,
  canSubmit,
  buildPayload,
  summaryText,
  stepTitle
};
