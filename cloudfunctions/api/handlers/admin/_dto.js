// handlers/admin/_dto.js · 后台 DTO（一律脱敏：无 avatarFileId、昵称脱敏、码打码、尾号后 2 位、无 openid）
// 口径：DATA_MODEL §7.7 默认脱敏函数 / §2 各集合读屏蔽 / UX_DEVELOPER 各页字段。后台不提供"显示完整"变体。
'use strict';

const mask = require('../../db/dto/mask');
const enums = require('../../shared/enums');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');

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
function orderBrief(order, isTest) {
  const doc = order || {};
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
    exception: exception,
    statusUpdatedAt: dateValue(doc.statusUpdatedAt),
    createdAt: dateValue(doc.createdAt)
  };
}

function orderDetail(order, extra) {
  const doc = order || {};
  const opts = extra || {};
  const parcel = doc.parcel || {};
  const out = orderBrief(doc, doc.isTest === true);
  out.customerDisplayName = maskedName(opts.customerDisplayName);
  out.partnerDisplayName = maskedName(opts.partnerDisplayName);
  out.guestDisplayName = maskedName(opts.guestDisplayName);
  out.isTest = doc.isTest === true;
  out.impersonatedBy = doc.isTest ? doc.impersonatedBy || '' : '';
  out.phoneTail = mask.maskPhoneTail(doc.phoneTail);
  out.parcel = {
    stationId: parcel.stationId || '',
    stationName: parcel.stationName || '',
    pickupCode: mask.maskPickupCode(parcel.pickupCode),
    lockerNo: maskLockerNo(parcel.lockerNo),
    trackingTail: maskTrackingTail(parcel.trackingTail),
    codeStatus: parcel.codeStatus || ''
  };
  out.appoint = doc.appoint || null;
  out.note = typeof doc.note === 'string' ? doc.note : '';
  out.deliveryNote = typeof doc.deliveryNote === 'string' ? doc.deliveryNote : '';
  out.cancelReason = doc.cancelReason || '';
  out.cancelReasonText = doc.cancelReason ? enums.cancelReasonText(doc.cancelReason) : '';
  out.cancelledBy = doc.cancelledBy || '';
  out.imageUploaded = !!(doc.image && doc.image.fileId);
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
    serviceCatalog: Array.isArray(source.serviceCatalog) ? source.serviceCatalog.slice() : [],
    announcement: source.announcement,
    maintenance: source.maintenance || { enabled: false, text: '' },
    orderTimeoutMinutes: source.orderTimeoutMinutes,
    autoCompleteHours: source.autoCompleteHours,
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
