// pkg-partner/pages/create-on-behalf/parts/form-model.js · 代客下单两路径纯件（零 wx、零请求）
// 口径：docs/ux/V4_UX_PARTNER.md §3.4（已绑定/新顾客两条路；字段校验；逐件站点；幂等 clientRequestId）
//      docs/contract/V4_CONTRACT.md §5.2 + D44（每件独立 stationId/stationName，默认继承首件、可逐件改、逐件必填；
//      去掉「暂不指定」默认值——服务端 _parcels-input.js 本就逐件必填，旧默认值=必然提交失败）
//      docs/data/V4_DATA_MODEL.md §7.5 批 7（order.create 兼职路径 bindingId 或 guest 二选一，都不写 bindings）
// 边界：本文件只做选项装配/逐件校验/识别预填/幂等键生命周期/失败人话；不调 wx、不发请求、不写本地存储。
'use strict';

const stations = require('../../../../shared/stations');
const zones = require('../../../../shared/zones');
const enums = require('../../../../shared/enums');
const orderState = require('../../../../shared/order-state');
const errorCopy = require('../../../../shared/error-copy');
const appointUtil = require('../../../../shared/appoint');
const appointModel = require('./appoint-model');

const NOTE_MAX = 200;
const PICKUP_CODE_MAX = 40;
const LOCKER_NO_MAX = 10;
const TRACKING_TAIL_LENGTH = 5;
const PHONE_TAIL_LENGTH = 4;
const DISPLAY_NAME_MAX = 20;
// D23/D40/D44：一单 1~10 件包裹、0~10 张截图（常量单源 shared/order-state）
const BATCH_MAX = orderState.MAX_PARCELS_PER_ORDER || 10;
const IMAGE_MAX = orderState.MAX_IMAGES_PER_ORDER || 10;
const CUSTOMER_MODES = ['BOUND', 'GUEST'];
const MODE_LABEL = { BOUND: '已绑定（对方发起）', GUEST: '新顾客（代客单）' };
const PARTNER_CLOSED_TEXT = '接单已关闭，暂时不能下单；已有订单不受影响。';
// 本地校验失败 → 回到正确步骤（D44：旧实现一律跳回第 1 步，站点/取件问题却回顾客步）
const STEP_CUSTOMER = 1;
const STEP_PARCELS = 2;
const STEP_SERVICE = 3;
const STATION_MISSING_TEXT = '请选择驿站站点';
const IMAGE_LIMIT_TEXT = '一单最多 ' + IMAGE_MAX + ' 张截图，请分多次提交';
// 一单件数上限唯一文案（TD-084③：提交校验与识别合并超限共用这一处字面量，不在别处再写一遍）
const PARCEL_LIMIT_TEXT = '一单最多 ' + BATCH_MAX + ' 件，请分单';

function textOf(value) { return typeof value === 'string' ? value.trim() : ''; }
function listOf(value) { return Array.isArray(value) ? value : []; }
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function cloneParcel(item) { return Object.assign({}, item || {}); }

function emptyGuest() { return { displayName: '', phoneTail: '', zone: '', buildingNo: '', room: '', dormKey: '' }; }

// 时间校验基准（TD-084④）：优先调用方在「请求时」注入的 serverNow（页面按 store.serverTimeSkew 现算），
// 其次页面状态快照 nowMs，最后才回退本机时钟（纯件安全回退；服务端仍是唯一权威）。
function nowMsOf(state, options) {
  const override = numberOr((options || {}).nowMs, 0);
  if (override > 0) return override;
  return numberOr((state || {}).nowMs, 0) || Date.now();
}

// 每件包裹独立站点（D44）：stationTouched=false 表示用户尚未单独改过 → 首件站点变化时继承。
// key 供 wx:key 用稳定键（不允许用 index：删除中间件时 index 会漂移，视图会错位）。
function emptyParcel(seq) {
  const order = numberOr(seq, 1);
  return {
    key: 'parcel-' + order,
    pickupCode: '',
    lockerNo: '',
    trackingTail: '',
    stationId: '',
    stationName: '',
    stationIndex: 0,
    stationTouched: false,
    imageIndex: -1
  };
}

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
    items: [emptyParcel(1)],
    parcelSeq: 1,
    files: [],
    appoint: createAppointState(0),
    nowMs: 0,
    note: '',
    recognitionFailureId: '',
    reviewText: ''
  };
}

// 站点 picker 值域：P1~P8 直接取 shared/stations（不自建）；D44 去掉「暂不指定」——每件必须选站点
function stationOptionsOf() {
  return stations.listStations().map(function map(item) { return { id: item.id, name: item.name }; });
}

function stationIndexOf(options, stationId) {
  const list = listOf(options);
  const target = textOf(stationId).toUpperCase();
  for (let index = 0; index < list.length; index += 1) {
    if (textOf(list[index].id) === target) return index;
  }
  return 0;
}

// 服务类型：只列本兼职已启用的类型；目录名称/说明只来自公开配置或 shared/enums（名称即"做什么"，零费用语义）
function catalogDescOf(catalog, code) {
  const hit = listOf(catalog).filter(function same(item) { return textOf(item && item.code) === code; })[0];
  if (hit && textOf(hit.desc)) return textOf(hit.desc);
  const builtin = enums.SERVICES.filter(function same(item) { return item.code === code; })[0];
  return builtin ? textOf(builtin.desc) : '';
}

function serviceOptionsOf(config, partner) {
  const source = config || {};
  const partnerConfig = (partner && partner.serviceConfig) || {};
  const enabledCodes = listOf(partnerConfig.services)
    .filter(function enabled(item) { return item && item.enabled === true; })
    .map(function code(item) { return textOf(item.code); })
    .filter(function valid(code) { return code !== '' && enums.SERVICE_CODES.indexOf(code) >= 0; });
  if (!enabledCodes.length) {
    return [];
  }
  const catalog = listOf(source.serviceCatalog).length
    ? listOf(source.serviceCatalog)
    : enums.SERVICES.map(function map(item) { return { code: item.code, name: item.name, desc: item.desc }; });
  return enabledCodes.map(function build(code) {
    const hit = catalog.filter(function same(item) { return textOf(item.code) === code; })[0];
    return {
      code: code,
      name: (hit && textOf(hit.name)) || enums.SERVICE_NAME[code] || code,
      desc: catalogDescOf(catalog, code)
    };
  });
}

// 苑值域：本人服务范围 ≥1 个苑时只列范围内；缺省列五苑（与下单页同口径）
function zoneOptionsOf(config, partner) {
  const source = config || {};
  const labels = (source && source.zoneLabels) || zones.ZONE_LABELS;
  const partnerConfig = (partner && partner.serviceConfig) || {};
  const scoped = listOf(partnerConfig.zones).filter(function zone(key) { return zones.isZone(key); });
  const keys = scoped.length ? scoped : zones.ZONES.slice();
  return keys.map(function map(key) { return { key: key, label: labels[key] || zones.ZONE_LABELS[key] || key }; });
}

// 绑定档案 → 选项（代客单只带 bindingId；顾客身份/编号/宿舍由服务端按绑定反查，端侧不透传）
function buildBindingOptions(bindingList) {
  return listOf(bindingList)
    .map(function map(item) {
      const row = item || {};
      const bindingId = textOf(row.bindingId);
      if (!bindingId) return null;
      return {
        bindingId: bindingId,
        label: textOf(row.displayName) || '未填称呼',
        sub: [textOf(row.dormKey) + textOf(row.roomTag).toUpperCase(), textOf(row.phoneTail)]
          .filter(function part(value) { return !!value; }).join(' · ')
      };
    })
    .filter(function keep(item) { return item !== null; });
}

// 页面初始状态：有档案优先走已绑定路径，否则默认新顾客路径
function createInitialState(input) {
  const source = input || {};
  const state = emptyState();
  const services = serviceOptionsOf(source.config, source.partner);
  const bindingOptions = buildBindingOptions(source.bindingList);
  return Object.assign(state, {
    customerMode: bindingOptions.length ? 'BOUND' : 'GUEST',
    bindingOptions: bindingOptions,
    zones: zoneOptionsOf(source.config, source.partner),
    services: services,
    stationOptions: stationOptionsOf(),
    appoint: createAppointState(numberOr(source.nowMs, 0) || Date.now()),
    nowMs: numberOr(source.nowMs, 0) || Date.now()
  });
}

// 预约初始状态（D47）：判据与文案单源 shared/appoint，本文件只装配
function createAppointState(nowMs, currentType) {
  return appointModel.createState(nowMs, currentType);
}

function guestDormKey(guest) {
  const source = guest || {};
  return zones.dormKey(source.zone, Number(source.buildingNo), source.room);
}

// 当前绑定/服务/预约选项（越界回 null，不猜）
function currentBinding(state) {
  return listOf(state.bindingOptions)[numberOr(state.bindingIndex, 0)] || null;
}

function currentService(state) {
  return listOf(state.services)[numberOr(state.serviceIndex, 0)] || null;
}

function stationNameOfItem(item) {
  const value = item || {};
  const name = textOf(value.stationName);
  if (name) return name;
  return stations.isStationId(textOf(value.stationId)) ? stations.stationNameOf(textOf(value.stationId)) : '';
}

// D44：逐件站点写入 + 首件继承。首件改站点时，未单独改过的后续件跟随；单独改过的件不被覆盖。
// stationIndex = 该站点在 picker 值域里的下标（视图据此回显；不是件下标）。
function applyItemStation(state, itemIndex, optionIndex) {
  const source = state || emptyState();
  const options = listOf(source.stationOptions);
  const pickedIndex = numberOr(optionIndex, -1);
  const option = options[pickedIndex];
  const index = numberOr(itemIndex, -1);
  const items = listOf(source.items).map(cloneParcel);
  if (!option || index < 0 || index >= items.length || !stations.isStationId(textOf(option.id))) {
    return { items: items };
  }
  const chosen = { stationId: option.id, stationName: textOf(option.name), stationIndex: pickedIndex };
  const next = Object.assign({}, items[index], chosen, { stationTouched: true });
  items[index] = next;
  if (index === 0) {
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].stationTouched !== true) {
        items[i] = Object.assign({}, items[i], { stationId: next.stationId, stationName: next.stationName, stationIndex: pickedIndex });
      }
    }
  }
  return { items: items };
}

// D44：再填一件 = 追加空件并默认继承首件站点（未改过 → 之后首件换站仍跟随）
function appendParcel(state) {
  const source = state || emptyState();
  const items = listOf(source.items).map(cloneParcel);
  const seq = numberOr(source.parcelSeq, items.length) || items.length;
  if (items.length >= BATCH_MAX) {
    return { items: items, parcelSeq: seq };
  }
  const nextSeq = seq + 1;
  const fresh = emptyParcel(nextSeq);
  const first = items[0];
  if (first && stations.isStationId(textOf(first.stationId))) {
    fresh.stationId = textOf(first.stationId);
    fresh.stationName = stationNameOfItem(first);
    fresh.stationIndex = numberOr(first.stationIndex, stationIndexOf(listOf(source.stationOptions), fresh.stationId));
  }
  items.push(fresh);
  return { items: items, parcelSeq: nextSeq };
}

function removeParcel(state, index) {
  const items = listOf((state || {}).items).map(cloneParcel);
  const target = numberOr(index, -1);
  if (target > 0 && target < items.length && items.length > 1) {
    items.splice(target, 1);
  }
  return { items: items };
}

// 每个 item 的取件信息校验（逐条；一图多码时每条独立；站点必填见 validateStation）
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

// D44：逐件站点必填（服务端 _parcels-input.js 同口径：每件 stationId 必填，不放宽）
function validateStation(item, index) {
  const parcel = item || {};
  const rank = index > 0 ? '第 ' + (index + 1) + ' 件：' : '';
  return stations.isStationId(textOf(parcel.stationId)) ? '' : rank + STATION_MISSING_TEXT;
}

// 顾客路径校验：BOUND 只需选中档案（身份由服务端反查）；GUEST 必须齐 dormKey 四要素
function validateCustomer(state) {
  if (state.customerMode === 'BOUND') {
    return currentBinding(state) ? '' : '请选择一位已绑定的顾客';
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

// 截图与票据必须成对（0~IMAGE_MAX 张；旧实现固定 1 张）
function imagePairErrorOf(state) {
  const files = listOf((state || {}).files);
  if (files.length > IMAGE_MAX) {
    return IMAGE_LIMIT_TEXT;
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] || {};
    if ((textOf(file.fileId) === '') !== (textOf(file.uploadTicketId) === '')) {
      return '截图票据缺失，请重新选择截图';
    }
  }
  return '';
}

// 校验明细：message + 失败步骤（D44：本地校验失败回到正确步骤，不再一律跳第 1 步）
// options.nowMs：提交时注入的「请求时」serverNow（TD-084④：长停留后预约校验不拿旧快照放行）
function validateDetailed(state, options) {
  const source = state || emptyState();
  if (!listOf(source.services).length) {
    return { message: '还没有启用任何服务类型，先去「服务类型与范围」启用后再代客下单', step: STEP_SERVICE };
  }
  const customerText = validateCustomer(source);
  if (customerText) {
    return { message: customerText, step: STEP_CUSTOMER };
  }
  const items = listOf(source.items);
  if (!items.length) {
    return { message: '至少填一件取件信息', step: STEP_PARCELS };
  }
  if (items.length > BATCH_MAX) {
    return { message: PARCEL_LIMIT_TEXT, step: STEP_PARCELS };
  }
  for (let index = 0; index < items.length; index += 1) {
    const stationText = validateStation(items[index], index);
    if (stationText) {
      return { message: stationText, step: STEP_PARCELS };
    }
    const parcelText = validateParcel(items[index], index);
    if (parcelText) {
      return { message: parcelText, step: STEP_PARCELS };
    }
  }
  const note = textOf(source.note);
  if (note.length > NOTE_MAX) {
    return { message: '备注最多 ' + NOTE_MAX + ' 字', step: STEP_SERVICE };
  }
  const appointCheck = appointUtil.validateOf(source.appoint, nowMsOf(source, options));
  if (!appointCheck.ok) {
    return { message: appointCheck.reason, step: STEP_SERVICE };
  }
  const pairText = imagePairErrorOf(source);
  if (pairText) {
    return { message: pairText, step: STEP_PARCELS };
  }
  return { message: '', step: 0 };
}

// 提交前整体校验（服务类型启用/逐件站点/逐件取件信息/备注/截图票据成对）
function validate(state, options) {
  return validateDetailed(state, options).message;
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

// 站点摘要（核对页逐件展示；第 n 件 + 站点名，未选站点如实说）
function stationLinesOf(state) {
  return listOf((state || {}).items).map(function map(item, index) {
    const row = item || {};
    return {
      key: textOf(row.key) || 'parcel-' + (index + 1),
      index: index + 1,
      text: stationNameOfItem(row) || '未选站点'
    };
  });
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
  IMAGE_MAX,
  LOCKER_NO_MAX,
  MODE_LABEL,
  NOTE_MAX,
  PARCEL_LIMIT_TEXT,
  PICKUP_CODE_MAX,
  STEP_CUSTOMER,
  STEP_PARCELS,
  STEP_SERVICE,
  TRACKING_TAIL_LENGTH,
  appendParcel,
  applyItemStation,
  appointPatchWithDate: appointModel.patchWithDate,
  appointPatchWithPreset: appointModel.patchWithPreset,
  appointPatchWithTime: appointModel.patchWithTime,
  appointPatchWithType: appointModel.patchWithType,
  appointPayloadOf: appointModel.payloadOf,
  appointSignatureOf: appointModel.signatureOf,
  appointViewOf: appointModel.viewOf,
  buildBindingOptions,
  createAppointState,
  createInitialState,
  currentBinding,
  currentService,
  emptyParcel,
  ensureRequestKey,
  failureText,
  guestDormKey,
  removeParcel,
  serviceOptionsOf,
  stationIndexOf,
  stationLinesOf,
  stationNameOfItem,
  stationOptionsOf,
  validate,
  validateCustomer,
  validateDetailed,
  validateParcel,
  validateStation,
  zoneOptionsOf
};
