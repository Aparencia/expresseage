// handlers/admin/_dto.js · 后台 DTO（一律脱敏：无 avatarFileId、昵称脱敏、码打码、尾号后 2 位、无 openid）
// 口径：DATA_MODEL §7.7 默认脱敏函数 / §2 各集合读屏蔽 / UX_DEVELOPER 各页字段。后台不提供"显示完整"变体。
'use strict';

const mask = require('../../db/dto/mask');
const enums = require('../../shared/enums');
const sharedStations = require('../../shared/stations');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
// v1.0 订单聚合字段只读归一（新 parcels[]/images[]，历史 parcel{}/image{} 单元素回退）唯一解析口径在
// order/_store.js（Lead 裁决：直接用后端解析接口，后台不另写一份归一）。
const store = require('../order/_store');

const LEGACY_AUDIT_PREFIX = 'VIEW' + '_' + 'AS' + '_';

function dateValue(value) {
  return value === undefined ? null : value;
}

function maskedName(value) {
  return mask.maskDisplayName(value);
}

// 柜号只表示"有值"：后台列表/详情不展示可还原的柜号
function maskLockerNo(value) {
  return typeof value === 'string' && value.trim() !== '' ? '***' : '';
}

// 运单尾号：只保留后 2 位
function maskTrackingTail(value) {
  if (typeof value !== 'string' || value === '') {
    return '';
  }
  return '***' + value.slice(-2);
}

// ── 订单 v1.0 聚合字段（D23/D24/D25）─────────────────────────────────────────
// parcels[]/images[] 的只读归一（新形态 + 历史单 parcel{}/image{} 回退）由 order/_store 提供，不在本文件重复。

// 件数派生（DATA_MODEL §2.5：包裹数派生、不另存计数字段）；统计的"件数"独立指标用它。
function parcelCountOf(order) {
  return store.orderParcelsOf(order).length;
}

// 单件包裹脱敏投影（admin）：逐件打码，顺序=itemIndex；后台不提供"显示完整"变体。
function parcelBrief(parcel) {
  const doc = parcel && typeof parcel === 'object' ? parcel : {};
  return {
    stationId: doc.stationId || '',
    stationName: doc.stationName || '',
    pickupCode: mask.maskPickupCode(doc.pickupCode),
    lockerNo: maskLockerNo(doc.lockerNo),
    trackingTail: maskTrackingTail(doc.trackingTail),
    codeStatus: doc.codeStatus || ''
  };
}

// 需查明按件计数（DATA_MODEL §2.5：整单 needCode = 任一件 NEED_CODE；后台行按件呈现并标注件数）。
function needCodeCountOf(parcels) {
  const list = Array.isArray(parcels) ? parcels : [];
  return list.filter((parcel) => parcel && parcel.codeStatus === enums.CODE_STATUS.NEED_CODE).length;
}

// 本单配送地址（D25）admin 脱敏投影：只到苑+楼栋。第三方地址的收件人称呼/手机尾号/房间号/房型键
// 属于 L3，后台一律不下发（完整 L3 只在只读视角 order.get）。历史单无 delivery → null（dorm 仍脱敏展示）。
function deliveryBrief(order) {
  const delivery = order && order.delivery && typeof order.delivery === 'object' ? order.delivery : null;
  if (!delivery) {
    return null;
  }
  const zone = typeof delivery.zone === 'string' ? delivery.zone : '';
  const buildingNo = Number(delivery.buildingNo);
  const buildingText = typeof delivery.buildingText === 'string' && delivery.buildingText !== ''
    ? delivery.buildingText
    : zone + (Number.isFinite(buildingNo) ? String(buildingNo) : '');
  return {
    zone: zone,
    buildingNo: Number.isFinite(buildingNo) ? buildingNo : 0,
    buildingText: buildingText
  };
}

// 截图逐张可见性摘要（DATA_MODEL §7.6：images[]{hasImage,cleaned}，永不下发 fileId）。
function imageBriefsOf(order) {
  return store.orderImagesOf(order).map((image) => {
    const doc = image && typeof image === 'object' ? image : {};
    const cleaned = !!doc.cleanedAt;
    const hasFileId = typeof doc.fileId === 'string' && doc.fileId !== '';
    return { hasImage: hasFileId && !cleaned, cleaned: cleaned };
  });
}

// 历史审计兼容映射（v0.9 前旧名只读换算；新日志只写 ACCOUNT_SWITCH_*，本文件不产生旧名）
function auditActionOf(action) {
  if (typeof action !== 'string' || action.indexOf(LEGACY_AUDIT_PREFIX) !== 0) {
    return action || '';
  }
  const suffix = action.slice(LEGACY_AUDIT_PREFIX.length);
  const mapped = {
    START: AUDIT_ACTIONS.ACCOUNT_SWITCH_START,
    END: AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
    EXPIRED: AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED
  }[suffix];
  return mapped || action;
}

// ── 顾客 ─────────────────────────────────────────────────────────────────────
function customerBrief(customer, options) {
  const doc = customer || {};
  const opts = options || {};
  const binding = opts.binding || null;
  const partner = opts.partner || null;
  const out = {
    customerNo: doc.customerNo || '',
    displayName: maskedName(doc.displayName),
    dorm: mask.maskDorm(doc),
    phoneTail: mask.maskPhoneTail(doc.phoneTail),
    profileCompleted: !!doc.profileCompleted,
    isTest: opts.isTest === true,
    binding: null,
    createdAt: dateValue(doc.createdAt),
    updatedAt: dateValue(doc.updatedAt)
  };
  if (binding) {
    out.binding = {
      status: binding.status || '',
      partnerNo: partner ? partner.partnerNo || '' : '',
      partnerDisplayName: partner ? maskedName(partner.displayName) : '',
      boundAt: dateValue(binding.boundAt)
    };
  }
  return out;
}

function customerDetail(customer, options) {
  const doc = customer || {};
  const opts = options || {};
  const out = customerBrief(doc, opts);
  out.deleted = !!doc.deletedAt;
  out.anonymized = !!doc.anonymizedAt;
  out.orderSummary = opts.orderSummary || {
    activeOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    exceptionOrders: 0,
    totalOrders: 0
  };
  out.binding = opts.binding
    ? {
      status: opts.binding.status || '',
      partnerNo: opts.partner ? opts.partner.partnerNo || '' : '',
      partnerDisplayName: opts.partner ? maskedName(opts.partner.displayName) : '',
      boundAt: dateValue(opts.binding.boundAt)
    }
    : null;
  return out;
}

// ── 兼职 ─────────────────────────────────────────────────────────────────────
function partnerBrief(partner, options) {
  const doc = partner || {};
  const opts = options || {};
  const serviceConfig = doc.serviceConfig || {};
  const services = Array.isArray(serviceConfig.services) ? serviceConfig.services : [];
  const stats = doc.stats || {};
  return {
    partnerNo: doc.partnerNo || '',
    displayName: maskedName(doc.displayName),
    status: doc.status || '',
    statusText: enums.PARTNER_STATUS_LABELS[doc.status] || '',
    acceptingOrders: !!serviceConfig.acceptingOrders,
    servicesEnabled: services.filter((item) => item && item.enabled === true).length,
    zones: Array.isArray(serviceConfig.zones) ? serviceConfig.zones.slice() : [],
    bindings: typeof opts.bindings === 'number' ? opts.bindings : 0,
    stats: {
      todayOrders: Number(stats.todayOrders) || 0,
      totalOrders: Number(stats.totalOrders) || 0,
      completedOrders: Number(stats.completedOrders) || 0
    },
    activatedAt: dateValue(doc.activatedAt),
    createdAt: dateValue(doc.createdAt),
    isTest: opts.isTest === true
  };
}

// ── 订单 ─────────────────────────────────────────────────────────────────────
// 列表行（脱敏）：v1.0 只出聚合件数（件数/需查明件数/无截图标记/苑+栋地址），**不出逐件码/柜号/尾号**
// （列表是最高频出口，逐件 L3 类字段只在详情按件打码后下发，DATA_MODEL §2.5/§7.6）。
function orderBrief(order, isTest) {
  const doc = order || {};
  const parcels = store.orderParcelsOf(doc);
  const exception = doc.exception && typeof doc.exception === 'object'
    ? {
      code: doc.exception.code || '',
      text: doc.exception.text || '',
      fromStatus: doc.exception.fromStatus || '',
      at: dateValue(doc.exception.at)
    }
    : null;
  return {
    orderNo: doc.orderNo || '',
    status: doc.status || '',
    statusText: enums.ORDER_STATUS_TEXT[doc.status] || '',
    source: doc.source || '',
    service: {
      code: doc.service && doc.service.code ? doc.service.code : '',
      name: doc.service && doc.service.name ? doc.service.name : ''
    },
    dorm: mask.maskDorm(doc.dorm),
    customerNo: doc.customerNo || '',
    partnerNo: doc.partnerNo || '',
    isTest: isTest === true || doc.isTest === true,
    // v1.0（D23/D24/D25）：单量按订单计（一行=1 单），件数独立呈现；无截图手填单独标记
    parcelCount: parcels.length,
    needCodeCount: needCodeCountOf(parcels),
    manualEntry: doc.manualEntry === true,
    delivery: deliveryBrief(doc),
    exception: exception,
    statusUpdatedAt: dateValue(doc.statusUpdatedAt),
    createdAt: dateValue(doc.createdAt)
  };
}

function orderDetail(order, extra) {
  const doc = order || {};
  const opts = extra || {};
  const parcels = store.orderParcelsOf(doc).map(parcelBrief);
  const out = orderBrief(doc, doc.isTest === true);
  out.customerDisplayName = maskedName(opts.customerDisplayName);
  out.partnerDisplayName = maskedName(opts.partnerDisplayName);
  out.guestDisplayName = maskedName(opts.guestDisplayName);
  out.isTest = doc.isTest === true;
  out.impersonatedBy = doc.isTest ? doc.impersonatedBy || '' : '';
  out.phoneTail = mask.maskPhoneTail(doc.phoneTail);
  // v1.0：逐件包裹（顺序=itemIndex）+ parcel=首件兼容（旧后台页仍读 parcel；空单保留空结构）
  out.parcels = parcels;
  out.parcel = parcels[0] || parcelBrief(null);
  out.imageUploaded = store.orderImagesOf(doc).some((image) => image && typeof image.fileId === 'string' && image.fileId !== '');
  out.images = imageBriefsOf(doc);
  out.appoint = doc.appoint || null;
  out.note = typeof doc.note === 'string' ? doc.note : '';
  out.deliveryNote = typeof doc.deliveryNote === 'string' ? doc.deliveryNote : '';
  out.cancelReason = doc.cancelReason || '';
  out.cancelReasonText = doc.cancelReason ? enums.cancelReasonText(doc.cancelReason) : '';
  out.cancelledBy = doc.cancelledBy || '';
  out.createdAt = dateValue(doc.createdAt);
  out.acceptedAt = dateValue(doc.acceptedAt);
  out.pickedAt = dateValue(doc.pickedAt);
  out.deliveredAt = dateValue(doc.deliveredAt);
  out.completedAt = dateValue(doc.completedAt);
  out.cancelledAt = dateValue(doc.cancelledAt);
  out.statusUpdatedAt = dateValue(doc.statusUpdatedAt);
  out.version = Number(doc.version) || 0;
  return out;
}

function eventBrief(event) {
  const doc = event || {};
  return {
    type: doc.type || '',
    fromStatus: doc.fromStatus || '',
    toStatus: doc.toStatus || '',
    actorRole: doc.actorRole || '',
    at: dateValue(doc.at),
    note: typeof doc.note === 'string' ? doc.note : ''
  };
}

// ── 审计 / 邀请码 ────────────────────────────────────────────────────────────
function auditBrief(record) {
  const doc = record || {};
  return {
    action: auditActionOf(doc.action),
    developerNo: doc.developerNo || '',
    target: doc.target || { type: '', id: '' },
    detail: doc.detail || {},
    at: dateValue(doc.at)
  };
}

function inviteBrief(invite, partner) {
  const doc = invite || {};
  const code = doc.code || '';
  return {
    invitationCode: code,
    codeTail: code.slice(-4),
    status: doc.status || '',
    statusText: enums.INVITATION_STATUS_LABELS[doc.status] || '',
    batchId: doc.batchId || '',
    expiresAt: dateValue(doc.expiresAt),
    usedByPartnerNo: partner ? partner.partnerNo || '' : '',
    usedByDisplayName: partner ? maskedName(partner.displayName) : '',
    usedAt: dateValue(doc.usedAt),
    note: typeof doc.note === 'string' ? doc.note : '',
    createdBy: doc.createdBy || '',
    createdAt: dateValue(doc.createdAt)
  };
}

// ── 测试账号 ─────────────────────────────────────────────────────────────────
function testAccountBrief(user, profile) {
  const doc = user || {};
  const profileDoc = profile || {};
  const roles = Array.isArray(doc.roles) ? doc.roles : [];
  const role = roles.length === 1 ? roles[0] : '';
  return {
    targetNo: profileDoc.customerNo || profileDoc.partnerNo || '',
    role: role,
    roleText: enums.ROLE_LABELS[role] || '',
    displayName: profileDoc.displayName || '',
    createdByDeveloperNo: doc.createdByDeveloperNo || '',
    testLastUsedAt: dateValue(doc.testLastUsedAt),
    createdAt: dateValue(doc.createdAt),
    isTestAccount: true
  };
}

// ── 识别失败复核 ─────────────────────────────────────────────────────────────
function failureBrief(record, uploader) {
  const doc = record || {};
  const person = uploader || {};
  return {
    failureNo: doc.failureNo || '',
    failureCode: doc.failureCode || '',
    sourceRole: doc.sourceRole || '',
    uploaderNo: person.no || '',
    uploaderDisplayName: maskedName(person.displayName),
    orderNo: person.orderNo || '',
    status: doc.status || '',
    hasImage: typeof doc.fileId === 'string' && doc.fileId !== '',
    aiTried: doc.aiTried === true,
    aiErrorCode: doc.aiErrorCode || '',
    createdAt: dateValue(doc.createdAt),
    reviewedAt: dateValue(doc.reviewedAt)
  };
}

function failureDetail(record, uploader, image) {
  const doc = record || {};
  const person = uploader || {};
  const out = failureBrief(doc, person);
  out.ocrTextMasked = typeof doc.ocrTextMasked === 'string' ? doc.ocrTextMasked : '';
  out.ruleResult = doc.ruleResult || {};
  out.aiModel = doc.aiModel || '';
  out.aiResult = doc.aiResult || null;
  out.resolution = doc.resolution || null;
  out.retentionDays = typeof doc.retentionDays === 'number' ? doc.retentionDays : 0;
  out.orderNo = person.orderNo || '';
  if (image && image.url) {
    out.imageUrl = image.url;
    out.expiresAt = image.expiresAt;
  }
  return out;
}

// ── 配置（后台读全量：aiFallback 只读展示，永不下发客户端）────────────────────
function configForAdmin(config) {
  const source = config || {};
  return {
    zoneLabels: source.zoneLabels || {},
    // v1.1（D32）：站点正式名（固定 P1~P8；缺省/非法条目回退内置默认，后台配置页据此回填 8 行输入）
    stations: sharedStations.stationsFromConfig(source),
    serviceCatalog: Array.isArray(source.serviceCatalog) ? source.serviceCatalog.slice() : [],
    announcement: source.announcement,
    maintenance: source.maintenance || { enabled: false, text: '' },
    orderTimeoutMinutes: source.orderTimeoutMinutes,
    autoCompleteHours: source.autoCompleteHours,
    // v1.0（D23）：合并窗口（0~60，默认 10，0=关闭）——服务端治理参数，后台配置页可读可编辑；不下发客户端
    orderMergeWindowMinutes: source.orderMergeWindowMinutes,
    screenshotRetentionDays: source.screenshotRetentionDays,
    recognitionFailureRetentionDays: source.recognitionFailureRetentionDays,
    viewTicketTtlMinutes: source.viewTicketTtlMinutes,
    avatarMaxBytes: source.avatarMaxBytes,
    testAccountMaxPerRole: source.testAccountMaxPerRole,
    testDataRetentionDays: source.testDataRetentionDays,
    privacyVersion: source.privacyVersion || '',
    aiFallback: source.aiFallback || {},
    updatedAt: dateValue(source.updatedAt)
  };
}

module.exports = {
  auditActionOf,
  maskLockerNo,
  maskTrackingTail,
  maskedName,
  parcelCountOf,
  customerBrief,
  customerDetail,
  partnerBrief,
  orderBrief,
  orderDetail,
  eventBrief,
  auditBrief,
  inviteBrief,
  testAccountBrief,
  failureBrief,
  failureDetail,
  configForAdmin
};
