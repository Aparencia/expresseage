// handlers/order/_parcel.js · 下单字段归一：取件信息 / 预约时段 / 服务类型与范围 / 代客地址 / 接单开关
// 口径：CONTRACT §4.2/§5.2/§6；DATA_MODEL §2.5/§4.5/§8.3。零交易语义，服务只表达"做什么"。
'use strict';

const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const stations = require('../../shared/stations');
const zones = require('../../shared/zones');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const { RECOGNITION_SOURCES } = require('../../lib/ai/parse');

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validationOrThrow(result, field) {
  if (!result || result.ok !== true) {
    throw errors.validation((result && result.field) || field, '参数不合法，请核对后重试');
  }
  return result;
}

// 取件信息：站点只认 P1~P8（可先空，兼职务必 order.correct 补）、码/柜号/尾号过形态闸
function normalizeParcel(input) {
  const parcel = isPlainObject(input) ? input : null;
  if (!parcel) {
    throw errors.validation('parcel', '请填写取件信息');
  }
  let stationId = '';
  let stationName = '';
  const rawStationId = typeof parcel.stationId === 'string' ? parcel.stationId.trim().toUpperCase() : '';
  const rawStationName = typeof parcel.stationName === 'string' ? parcel.stationName.trim() : '';
  if (rawStationId !== '') {
    if (!stations.isStationId(rawStationId)) {
      throw errors.validation('stationId', '驿站站点不在可选范围内，请重新选择');
    }
    stationId = rawStationId;
    stationName = stations.stationNameOf(rawStationId);
  } else if (rawStationName !== '') {
    const normalized = stations.normalizeStation(rawStationName);
    if (!normalized.ok) {
      throw errors.validation('stationId', '驿站站点不在可选范围内，请重新选择');
    }
    stationId = normalized.id;
    stationName = normalized.name;
  }
  const codeResult = validationOrThrow(validate.validatePickupCode(parcel.pickupCode), 'pickupCode');
  const lockerResult = validationOrThrow(validate.validateLockerNo(parcel.lockerNo), 'lockerNo');
  const tailResult = validationOrThrow(validate.validateTrackingTail(parcel.trackingTail), 'trackingTail');
  const pickupCode = codeResult.value;
  const codeStatus = pickupCode === '' ? enums.CODE_STATUS.NEED_CODE : enums.CODE_STATUS.OK;
  let recognitionSource = enums.RECOGNITION_SOURCE.RULE;
  if (parcel.recognitionSource !== undefined && parcel.recognitionSource !== '') {
    if (RECOGNITION_SOURCES.indexOf(parcel.recognitionSource) < 0) {
      throw errors.validation('recognitionSource', '识别来源不合法');
    }
    recognitionSource = parcel.recognitionSource;
  }
  let confidence = '';
  if (typeof parcel.confidence === 'string' && parcel.confidence !== '') {
    if (enums.CONFIDENCE_LEVEL_LIST.indexOf(parcel.confidence) < 0) {
      throw errors.validation('confidence', '识别置信度不合法');
    }
    confidence = parcel.confidence;
  }
  const normalized = {
    stationId,
    stationName,
    pickupCode,
    lockerNo: lockerResult.value,
    trackingTail: tailResult.value,
    codeStatus,
    recognitionSource
  };
  if (confidence) {
    normalized.confidence = confidence;
  }
  return normalized;
}

function parseSlotTime(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

// 预约：ASAP 不填时间；SLOT 必填未来时段且 start < end（下单后不可改，改时间需取消重下）
function normalizeAppoint(input, nowMs) {
  const appoint = isPlainObject(input) ? input : {};
  const type = appoint.type === enums.APPOINT_TYPE.SLOT ? enums.APPOINT_TYPE.SLOT : enums.APPOINT_TYPE.ASAP;
  if (type === enums.APPOINT_TYPE.ASAP) {
    return { type };
  }
  const startAt = parseSlotTime(appoint.startAt);
  const endAt = parseSlotTime(appoint.endAt);
  if (!startAt || !endAt || startAt < nowMs || endAt <= startAt) {
    throw errors.validation('appoint', '预约时段不合法，请选择未来的时间段');
  }
  return { type, startAt: new Date(startAt), endAt: new Date(endAt) };
}

function findServiceEntry(partner, serviceCode) {
  const config = (partner && partner.serviceConfig) || {};
  const services = Array.isArray(config.services) ? config.services : [];
  return services.filter((item) => item && item.code === serviceCode)[0] || null;
}

// 服务类型：必须在兼职已启用列表内；名称由服务端按 config.serviceCatalog/枚举下发（不信任客户端）
function pickService(config, partner, serviceCode) {
  if (typeof serviceCode !== 'string' || serviceCode === '') {
    throw errors.validation('serviceCode', '请选择服务类型');
  }
  if (enums.SERVICE_CODES.indexOf(serviceCode) < 0) {
    throw errors.validation('serviceCode', '服务类型不在可选范围内');
  }
  const entry = findServiceEntry(partner, serviceCode);
  if (!entry || entry.enabled !== true) {
    throw errors.validation('serviceCode', '该兼职未启用此服务类型，请更换后重试');
  }
  const catalog = config && Array.isArray(config.serviceCatalog) ? config.serviceCatalog : [];
  const hit = catalog.filter((item) => item && item.code === serviceCode)[0];
  const name = hit && typeof hit.name === 'string' && hit.name
    ? hit.name
    : enums.serviceNameOf(serviceCode);
  return { code: serviceCode, name };
}

// 服务范围：苑级范围（serviceConfig.zones 是唯一事实源）
function assertServiceRange(partner, zone) {
  const config = (partner && partner.serviceConfig) || {};
  const zones = Array.isArray(config.zones) ? config.zones : [];
  if (zones.indexOf(zone) < 0) {
    throw errors.validation('zone', '该兼职暂不服务你所在宿舍楼，请更换兼职或联系兼职调整范围');
  }
}

// 接单开关：acceptingOrders=false ⇒ PARTNER_CLOSED（顾客端入口置灰只是提示，服务端仍拦）
function assertAcceptingOrders(partner) {
  const config = (partner && partner.serviceConfig) || {};
  if (config.acceptingOrders !== true) {
    throw errors.partnerClosed('该兼职暂不接单，请稍后再试');
  }
}

function assertPartnerOpen(partner) {
  if (!partner) {
    throw errors.invalidState('绑定关系异常，请重新绑定后下单');
  }
  if (partner.deletedAt || partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.partnerClosed('兼职已注销，无法接单');
  }
  if (partner.status === enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.partnerClosed('兼职已停用，暂不接单');
  }
}

function customerDorm(customer, roomTag) {
  const zone = typeof customer.zone === 'string' ? customer.zone : '';
  const buildingNo = typeof customer.buildingNo === 'number' ? customer.buildingNo : 0;
  return {
    zone,
    buildingNo,
    room: typeof customer.room === 'string' ? customer.room : '',
    dormKey: typeof customer.dormKey === 'string' ? customer.dormKey : '',
    buildingText: zones.buildingText(zone, buildingNo),
    roomTag: typeof roomTag === 'string' ? roomTag : ''
  };
}

// 代客单地址：顾客不在场时由兼职填写；dormKey/建筑文案由服务端 derive
function normalizeGuest(input) {
  const guest = isPlainObject(input) ? input : null;
  if (!guest) {
    throw errors.validation('guest', '代客单请填写收件人信息');
  }
  const dorm = validationOrThrow(validate.validateDormIdentity(guest), 'dorm');
  const nameResult = validationOrThrow(validate.validateDisplayName(guest.displayName), 'displayName');
  const tailResult = validationOrThrow(validate.validatePhoneTail(guest.phoneTail), 'phoneTail');
  return {
    displayName: nameResult.value,
    phoneTail: tailResult.value,
    zone: dorm.zone,
    buildingNo: dorm.buildingNo,
    room: dorm.room,
    buildingText: dorm.buildingText,
    dormKey: dorm.dormKey
  };
}

// 订单备注 ≤200（顾客备注与代客单备注同口径）
function normalizeOrderNote(value) {
  const result = validationOrThrow(validate.validateNote(value), 'note');
  return result.value;
}

// 代客单展示名不允许写进订单快照的口径从这里收口（订单只存 guest/编号快照）
function guestPhoneTail(guest) {
  return guest && typeof guest.phoneTail === 'string' ? guest.phoneTail : '';
}

module.exports = {
  isPlainObject,
  normalizeParcel,
  normalizeAppoint,
  pickService,
  assertServiceRange,
  assertAcceptingOrders,
  assertPartnerOpen,
  customerDorm,
  normalizeGuest,
  normalizeOrderNote,
  guestPhoneTail,
  parseSlotTime,
  time
};
