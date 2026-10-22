// pkg-partner/pages/create-on-behalf/parts/form-model.js · 代客下单两路径纯件（零 wx、零请求）
// 口径：docs/V4_UX_PARTNER.md §3.4（已绑定/新顾客两条路；字段校验；一图多码 createBatch；幂等 clientRequestId）
//      docs/V4_DATA_MODEL.md §7.5 批 7（order.create 兼职路径 bindingId 或 guest 二选一，都不写 bindings）
// 边界：本文件只做选项装配/校验/请求体/幂等键生命周期/失败人话；不调 wx、不发请求、不写本地存储。
'use strict';

const stations = require('../../../../shared/stations');
const zones = require('../../../../shared/zones');
const enums = require('../../../../shared/enums');
const errorCopy = require('../../../../shared/error-copy');

const NOTE_MAX = 200;
const PICKUP_CODE_MAX = 40;
const LOCKER_NO_MAX = 10;
const TRACKING_TAIL_LENGTH = 5;
const PHONE_TAIL_LENGTH = 4;
const DISPLAY_NAME_MAX = 20;
const BATCH_MAX = 10; // v1.0：一个订单 1~10 件包裹（CONTRACT D23；后端常量随 task-21 收口）
const CUSTOMER_MODES = ['BOUND', 'GUEST'];
const MODE_LABEL = { BOUND: '已绑定（对方发起）', GUEST: '新顾客（代客单）' };
const PARTNER_CLOSED_TEXT = '接单已关闭，暂时不能下单；已有订单不受影响。';

function textOf(value) { return typeof value === 'string' ? value.trim() : ''; }
function listOf(value) { return Array.isArray(value) ? value : []; }
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function emptyGuest() { return { displayName: '', phoneTail: '', zone: '', buildingNo: '', room: '', dormKey: '' }; }
function emptyParcel() { return { pickupCode: '', lockerNo: '', trackingTail: '' }; }

function emptyState() {
  return {
    customerMode: 'GUEST',
    presetMiss: false,
    bindingOptions: [],
    bindingIndex: 0,
    guest: emptyGuest(),
    zones: [],
    services: [],
    serviceIndex: 0,
    stationOptions: stationOptionsOf(),
    stationIndex: 0,
    items: [emptyParcel()],
    appointOptions: buildAppointOptions(0),
    appointIndex: 0,
    note: '',
    imageFileId: '',
    imageTicketId: '',
    recognitionFailureId: '',
    reviewText: ''
  };
}

// 站点 picker 值域：P1~P8 直接取 shared/stations（不自建）；空值 = 暂不指定（NEED_CODE 机制）
function stationOptionsOf() {
  return [{ id: '', name: '暂不指定（需查明）' }].concat(stations.listStations());
}

// 服务类型：只列本兼职已启用的类型；目录名称只来自公开配置或 shared/enums（名称即"做什么"）
function serviceOptionsOf(config, partner) {
  const source = config || {};
  const partnerConfig = (partner && partner.serviceConfig) || {};
  const enabledCodes = listOf(partnerConfig.services)
    .filter((item) => item && item.enabled === true)
    .map((item) => textOf(item.code))
    .filter((code) => code !== '');
  if (!enabledCodes.length) {
    return [];
  }
  const catalog = listOf(source.serviceCatalog).length
    ? listOf(source.serviceCatalog)
    : enums.SERVICES.map((item) => ({ code: item.code, name: item.name }));
  const result = [];
  enabledCodes.forEach((code) => {
    const hit = catalog.filter((item) => textOf(item.code) === code)[0];
    result.push(hit ? { code: code, name: textOf(hit.name) || enums.SERVICE_NAME[code] || code }
      : { code: code, name: enums.SERVICE_NAME[code] || code });
  });
  return result;
}

// 苑值域：本人服务范围 ≥1 个苑时只列范围内；缺省列五苑（与下单页同口径）
function zoneOptionsOf(config, partner) {
  const source = config || {};
  const labels = (source && source.zoneLabels) || zones.ZONE_LABELS;
  const partnerConfig = (partner && partner.serviceConfig) || {};
  const scoped = listOf(partnerConfig.zones).filter((zone) => zones.isZone(zone));
  const keys = scoped.length ? scoped : zones.ZONES.slice();
  return keys.map((key) => ({ key: key, label: labels[key] || zones.ZONE_LABELS[key] || key }));
}

// 绑定档案 → 选项（代客单只带 bindingId；顾客身份/编号/宿舍由服务端按绑定反查，端侧不透传）
function buildBindingOptions(bindingList) {
  return listOf(bindingList)
    .map((item) => {
      const row = item || {};
      const bindingId = textOf(row.bindingId);
      if (!bindingId) {
        return null;
      }
      return {
        bindingId: bindingId,
        label: textOf(row.displayName) || '未填称呼',
        sub: [textOf(row.dormKey) + textOf(row.roomTag).toUpperCase(), textOf(row.phoneTail)]
          .filter((part) => !!part).join(' · ')
      };
    })
    .filter((item) => item !== null);
}

// 预约：尽快 + 今天未结束的时段（时段起止由端侧按服务端校时展开，服务端只收 type/startAt/endAt）
function buildAppointOptions(nowMs) {
  const now = numberOr(nowMs, 0) || Date.now();
  const base = new Date(now);
  const options = [{ key: enums.APPOINT_TYPE.ASAP, label: '尽快' }];
  const slots = [
    { label: '今天 上午 08:00-12:00', startHour: 8, endHour: 12 },
    { label: '今天 下午 12:00-18:00', startHour: 12, endHour: 18 },
    { label: '今天 晚上 18:00-22:00', startHour: 18, endHour: 22 }
  ];
  slots.forEach((slot) => {
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), slot.startHour, 0, 0, 0).getTime();
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), slot.endHour, 0, 0, 0).getTime();
    if (end > now) { options.push({ key: enums.APPOINT_TYPE.SLOT, label: slot.label, startAt: start, endAt: end }); }
  });
  return options;
}

// 页面初始状态：有档案优先走已绑定路径，否则默认新顾客路径
function createInitialState(input) {
  const source = input || {};
  const state = emptyState();
  const services = serviceOptionsOf(source.config, source.partner);
  const bindingOptions = buildBindingOptions(source.bindingList);
  const appointOptions = buildAppointOptions(source.nowMs);
  return Object.assign(state, {
    customerMode: bindingOptions.length ? 'BOUND' : 'GUEST',
    bindingOptions: bindingOptions,
    zones: zoneOptionsOf(source.config, source.partner),
    services: services,
    stationOptions: stationOptionsOf(),
    appointOptions: appointOptions,
    appointNotice: appointOptions.length > 1 ? '' : '今天的预约时段已过，只能选「尽快」；需要指定时间请稍后再约。'
  });
}

function guestDormKey(guest) {
  const source = guest || {};
  return zones.dormKey(source.zone, Number(source.buildingNo), source.room);
}

// 当前绑定选项（越界回 null，不猜）
function currentBinding(state) {
  const options = listOf(state.bindingOptions);
  const index = numberOr(state.bindingIndex, 0);
  return options[index] || null;
}

function currentService(state) {
  return listOf(state.services)[numberOr(state.serviceIndex, 0)] || null;
}

function currentStation(state) {
  return listOf(state.stationOptions)[numberOr(state.stationIndex, 0)] || null;
}

function currentAppoint(state) {
  return listOf(state.appointOptions)[numberOr(state.appointIndex, 0)] || { key: enums.APPOINT_TYPE.ASAP, label: '尽快' };
}

// 每个 item 的取件信息校验（逐条；一图多码时每条独立）
function validateParcel(item, index) {
  const parcel = item || {};
  const rank = index > 0 ? '第 ' + (index + 1) + ' 件：' : '';
  const pickupCode = textOf(parcel.pickupCode);
  const lockerNo = textOf(parcel.lockerNo);
  const trackingTail = textOf(parcel.trackingTail);
  if (!pickupCode && !trackingTail) {
    return rank + '至少填取件码或运单尾号，两者都空无法建单';
  }
  if (pickupCode.length > PICKUP_CODE_MAX) {
    return rank + '取件码最多 ' + PICKUP_CODE_MAX + ' 字';
  }
  if (lockerNo.length > LOCKER_NO_MAX) {
    return rank + '柜号最多 ' + LOCKER_NO_MAX + ' 字';
  }
  if (trackingTail && !new RegExp('^[0-9]{' + TRACKING_TAIL_LENGTH + '}$').test(trackingTail)) {
    return rank + '运单尾号必须是 ' + TRACKING_TAIL_LENGTH + ' 位数字';
  }
  return '';
}

// 顾客路径校验：BOUND 只需选中档案（身份由服务端反查）；GUEST 必须齐 dormKey 四要素
function validateCustomer(state) {
  if (state.customerMode === 'BOUND') {
    if (!currentBinding(state)) {
      return '请选择一位已绑定的顾客';
    }
    return '';
  }
  const guest = state.guest || emptyGuest();
  const name = textOf(guest.displayName);
  if (!name) {
    return '代客单需要填顾客称呼（送达时要用）';
  }
  if (name.length > DISPLAY_NAME_MAX) {
    return '称呼最多 ' + DISPLAY_NAME_MAX + ' 个字';
  }
  const tail = textOf(guest.phoneTail);
  if (tail && !new RegExp('^[0-9]{' + PHONE_TAIL_LENGTH + '}$').test(tail)) {
    return '手机尾号是 ' + PHONE_TAIL_LENGTH + ' 位数字，或留空';
  }
  if (!zones.isZone(guest.zone)) {
    return '请选择苑';
  }
  if (!zones.isBuildingNo(Number(guest.buildingNo))) {
    return '楼栋号是 1~10 的数字';
  }
  if (!zones.canonicalRoom(guest.room)) {
    return '宿舍号至少 3 位数字';
  }
  if (!guestDormKey(guest)) {
    return '宿舍信息不完整，请检查苑/楼栋/宿舍号';
  }
  return '';
}

// 提交前整体校验（服务类型启用/站点值域/逐件取件信息/备注/截图票据成对）
function validate(state) {
  const source = state || emptyState();
  if (!listOf(source.services).length) {
    return '还没有启用任何服务类型，先去「服务类型与范围」启用后再代客下单';
  }
  const customerText = validateCustomer(source);
  if (customerText) {
    return customerText;
  }
  const station = currentStation(source);
  const stationId = textOf(station && station.id);
  if (stationId !== '' && !stations.isStationId(stationId)) {
    return '驿站站点不在可选范围内，请重新选择';
  }
  const items = listOf(source.items);
  if (!items.length) {
    return '至少填一件取件信息';
  }
  if (items.length > BATCH_MAX) {
    return '一图多码最多 ' + BATCH_MAX + ' 件，请分次提交';
  }
  for (let index = 0; index < items.length; index += 1) {
    const parcelText = validateParcel(items[index], index);
    if (parcelText) {
      return parcelText;
    }
  }
  const note = textOf(source.note);
  if (note.length > NOTE_MAX) {
    return '备注最多 ' + NOTE_MAX + ' 字';
  }
  const ticket = textOf(source.imageTicketId);
  const fileId = textOf(source.imageFileId);
  if ((ticket === '') !== (fileId === '')) {
    return '截图票据缺失，请重新选择截图';
  }
  return '';
}

// 幂等键生命周期：同内容复用上次键（失败重试不重复建单）；内容变了重新生成（helpers 由页面注入 api/client 单源）
function ensureRequestKey(previous, signature, helpers) {
  const prev = previous || {};
  const utils = helpers || {};
  const same = prev.signature === signature && typeof prev.clientRequestId === 'string';
  const valid = same ? (typeof utils.isValid === 'function' ? utils.isValid(prev.clientRequestId) : true) : false;
  if (valid) {
    return { clientRequestId: prev.clientRequestId, signature: signature };
  }
  const makeId = typeof utils.makeId === 'function' ? utils.makeId : null;
  if (!makeId) {
    return { clientRequestId: '', signature: signature };
  }
  return { clientRequestId: makeId(), signature: signature };
}

// 识别响应 → 表单预填（只填空白字段，不覆盖用户已填；站点只在命中 P1~P8 时选中）
function applyRecognition(state, dto) {
  const source = state || emptyState();
  const data = dto || {};
  const items = listOf(source.items).map((item) => Object.assign({}, item || emptyParcel()));
  if (!items.length) {
    items.push(emptyParcel());
  }
  const first = items[0];
  if (data.recognized) {
    if (data.pickupCode) {
      first.pickupCode = textOf(first.pickupCode) || textOf(data.pickupCode);
    }
    if (data.lockerNo) {
      first.lockerNo = textOf(first.lockerNo) || textOf(data.lockerNo);
    }
    if (data.trackingTail) {
      first.trackingTail = textOf(first.trackingTail) || textOf(data.trackingTail);
    }
  }
  const stationOptions = listOf(source.stationOptions);
  let stationIndex = numberOr(source.stationIndex, 0);
  const stationId = textOf(data.stationId).toUpperCase();
  if (stationId) {
    for (let index = 0; index < stationOptions.length; index += 1) {
      if (stationOptions[index].id === stationId) {
        stationIndex = index;
        break;
      }
    }
  }
  return {
    items: items,
    stationIndex: stationIndex,
    recognitionFailureId: textOf(data.failureId),
    reviewText: data.recognized
      ? '已按截图预填，请核对（以手填为准）'
      : '这次没认出取件码/站点，已反馈开发者复核；可手填，或稍后看复核结果'
  };
}

// 失败分类人话（§3.4：PARTNER_CLOSED/FORBIDDEN/RATE_LIMITED/VALIDATION_FAILED/INTERNAL_ERROR）
function failureText(err) {
  const error = err || {};
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === 'PARTNER_CLOSED') {
    return PARTNER_CLOSED_TEXT;
  }
  if (code === 'VALIDATION_FAILED' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return (errorCopy.CODE_COPY && errorCopy.CODE_COPY[code]) || errorCopy.UNKNOWN_CODE_COPY;
}

module.exports = {
  BATCH_MAX,
  CUSTOMER_MODES,
  DISPLAY_NAME_MAX,
  LOCKER_NO_MAX,
  MODE_LABEL,
  NOTE_MAX,
  PICKUP_CODE_MAX,
  TRACKING_TAIL_LENGTH,
  buildAppointOptions,
  buildBindingOptions,
  createInitialState,
  currentAppoint,
  currentBinding,
  currentService,
  currentStation,
  emptyParcel,
  ensureRequestKey,
  failureText,
  guestDormKey,
  serviceOptionsOf,
  stationOptionsOf,
  validate,
  validateCustomer,
  validateParcel,
  zoneOptionsOf,
  applyRecognition
};
