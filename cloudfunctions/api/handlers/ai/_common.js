// handlers/ai/_common.js · AI 识别兜底共用件：身份/配额/上传票据/服务端规则快照/失败入队/DTO
// 口径：CONTRACT v0.9 §4.3；DATA_MODEL §4.9/§7.9；ENGINEERING §4.10。失败一律静默降级，不新增错误码。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const stations = require('../../shared/stations');
const time = require('../../lib/time');
const idGenerator = require('../../lib/id-generator');
const aiParse = require('../../lib/ai/parse');
const { errors } = require('../../lib/errors');

const MAX_OCR_TEXT_LENGTH = 2000;
const CONFLICT_STATION_MISMATCH = 'STATION_MISMATCH';
const CONFLICT_CODE_CONFLICT = 'CODE_CONFLICT';
const DEFAULT_RETENTION_DAYS = 30;
const CODE_CANDIDATE_RE = /[0-9A-Za-z]{4,12}/g;

function scopeOf(ctx) {
  const identity = (ctx && ctx.identity) || {};
  return {
    role: identity.role || '',
    openid: identity.effectiveOpenid || (ctx && ctx.openid) || '',
    viewMode: identity.viewMode || ''
  };
}

function assertBusinessRole(ctx) {
  const scope = scopeOf(ctx);
  if (scope.role !== enums.ROLES.CUSTOMER && scope.role !== enums.ROLES.PARTNER) {
    throw errors.forbidden('请先完成登录并选择顾客或兼职身份');
  }
  if (scope.viewMode) {
    throw errors.forbidden('切换会话不支持识别兜底，请用自己的账号操作');
  }
  return scope;
}

function assertWritable(ctx) {
  if (scopeOf(ctx).viewMode === enums.VIEW_MODE.READONLY) {
    throw errors.forbidden('开发者只读视角不能操作');
  }
}

function nowMsOf(ctx) {
  const value = ctx ? ctx.now : null;
  if (typeof value === 'function') {
    return value();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  return Date.now();
}

function normalizePayload(payload, scope) {
  const input = payload && typeof payload === 'object' ? payload : {};
  if (typeof input.ocrTextMasked !== 'string') {
    throw errors.validation('ocrTextMasked', '识别文本格式不正确，请重新拍摄截图');
  }
  const rawText = input.ocrTextMasked.trim();
  if (rawText.length > MAX_OCR_TEXT_LENGTH) {
    throw errors.validation('ocrTextMasked', '识别文本过长，请重新拍摄截图');
  }
  const role = typeof input.role === 'string' ? input.role.trim().toUpperCase() : '';
  if (enums.ROLE_LIST.indexOf(role) < 0) {
    throw errors.forbidden('请先选择顾客或兼职身份后再使用识别兜底');
  }
  if (role !== scope.role) {
    throw errors.validation('role', '识别角色与当前身份不一致，请重新进入下单页');
  }
  // 票据归属/有效期校验失败不拒绝（记 ruleResult.ticketInvalid=true 供后台排查），只要求是字符串
  const uploadTicketId = typeof input.uploadTicketId === 'string' ? input.uploadTicketId.trim() : '';
  let hintTrackingTail = '';
  if (input.hintTrackingTail !== undefined && input.hintTrackingTail !== null && input.hintTrackingTail !== '') {
    const tailCheck = validate.validateTrackingTail(input.hintTrackingTail);
    if (!tailCheck.ok) {
      throw errors.validation('hintTrackingTail', '运单尾号格式不正确');
    }
    hintTrackingTail = tailCheck.value;
  }
  return {
    ocrTextMasked: rawText,
    hintTrackingTail,
    uploadTicketId,
    role
  };
}

async function loadUploadTicket(ctx, ticketId) {
  const ticket = await ctx.dao.findOne(COLLECTIONS.UPLOAD_TICKETS, { where: { ticket: ticketId } });
  return ticket || null;
}

// 上传票据校验（不拒绝、只标记 ticketInvalid 供后台排查；DATA_MODEL §2.12/§7.9）。
// 五大失效口径：不存在 / 非本人 / purpose 不符 / 已过期 / 已消费——任一命中即 ticketInvalid=true，仍入队。
function ticketStatusOf(ticket, scope, nowMs) {
  if (!ticket) {
    return { valid: false, reason: 'MISSING' };
  }
  if (ticket.openid !== scope.openid) {
    return { valid: false, reason: 'OWNER' };
  }
  if (ticket.purpose !== enums.UPLOAD_PURPOSE.TICKET) {
    return { valid: false, reason: 'PURPOSE' };
  }
  if (ticket.usedAt) {
    return { valid: false, reason: 'USED' };
  }
  // 到期判定用「票据自带 expiresAt」严格比较（缺失/非法一律按过期，不用 Date.now 兜底）
  const rawExpires = ticket.expiresAt;
  const expiresAt = rawExpires instanceof Date
    ? rawExpires.getTime()
    : (typeof rawExpires === 'number' ? rawExpires : 0);
  if (!expiresAt || expiresAt <= nowMs) {
    return { valid: false, reason: 'EXPIRED' };
  }
  return { valid: true, reason: '' };
}

// 服务端规则快照（入队 ruleResult）：输入只有去敏文本与尾号提示，故由服务端在同一文本上重跑规则归一。
function buildRuleResult(maskedText, hintTrackingTail, ticketStatus) {
  const conflicts = [];
  const station = normalizeStationFromText(maskedText);
  if (station.conflict) {
    conflicts.push(CONFLICT_STATION_MISMATCH);
  }
  const code = normalizeCodeFromText(maskedText);
  if (code.conflict) {
    conflicts.push(CONFLICT_CODE_CONFLICT);
  }
  const pickupCode = code.value;
  const trackingTail = normalizeTailFromText(maskedText) || hintTrackingTail || '';
  return {
    stationId: station.id,
    stationName: station.name,
    pickupCode,
    trackingTail,
    lockerNo: '',
    codeStatus: pickupCode === '' ? enums.CODE_STATUS.NEED_CODE : enums.CODE_STATUS.OK,
    conflicts,
    ticketInvalid: !ticketStatus.valid
  };
}

function normalizeStationFromText(text) {
  const hits = [];
  stations.STATIONS.forEach((station) => {
    if (text.indexOf(station.name) >= 0 && hits.indexOf(station.id) < 0) {
      hits.push(station.id);
    }
  });
  stations.STATION_ALIASES.forEach((item) => {
    if (text.indexOf(item.alias) >= 0 && hits.indexOf(item.id) < 0) {
      hits.push(item.id);
    }
  });
  if (hits.length === 1) {
    return { id: hits[0], name: stations.stationNameOf(hits[0]), conflict: false };
  }
  return { id: '', name: '', conflict: hits.length > 1 };
}

function normalizeCodeFromText(text) {
  const merged = text.replace(/[\s\-_#]/g, '');
  const matches = merged.match(CODE_CANDIDATE_RE) || [];
  const accepted = [];
  matches.forEach((token) => {
    const code = aiParse.normalizePickupCode(token);
    if (code && accepted.indexOf(code) < 0) {
      accepted.push(code);
    }
  });
  if (accepted.length === 1) {
    return { value: accepted[0], conflict: false };
  }
  return { value: '', conflict: accepted.length > 1 };
}

function normalizeTailFromText(text) {
  const matches = text.match(/(?<!\d)\d{5}(?!\d)/g) || [];
  return matches.length > 0 ? matches[0] : '';
}

// 配额：rl:ai:{openid}:d{day} 5 次/人/日 + rl:ai:global:d{day} 全局日配额（超限不外呼、静默降级）
function aiQuotaKeys(openid, nowMs) {
  const day = time.dayKey(nowMs);
  return {
    user: 'rl:ai:' + openid + ':d' + day,
    global: 'rl:ai:global:d' + day
  };
}

async function readCounter(ctx, key) {
  const row = await ctx.dao.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  return row && typeof row.seq === 'number' ? row.seq : 0;
}

async function bumpCounter(ctx, key, nowMs) {
  await ctx.dao.transaction(async (trx) => {
    const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
    if (!row) {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: nowMs });
      return;
    }
    const seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowMs });
  });
}

async function checkQuota(ctx, openid, nowMs, aiConfig) {
  const keys = aiQuotaKeys(openid, nowMs);
  const userUsed = await readCounter(ctx, keys.user);
  const globalUsed = await readCounter(ctx, keys.global);
  if (userUsed >= aiConfig.maxPerUserPerDay || globalUsed >= aiConfig.dailyQuota) {
    return { allowed: false, keys };
  }
  return { allowed: true, keys };
}

async function countQuota(ctx, keys, nowMs) {
  await bumpCounter(ctx, keys.user, nowMs);
  await bumpCounter(ctx, keys.global, nowMs);
}

function retentionDaysOf(config) {
  const value = Number(config && config.recognitionFailureRetentionDays);
  if (!Number.isFinite(value) || value < 7 || value > 30) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(value);
}

// 失败入队（唯一写 recognition_failures 的位置）：任何 recognized=false 路径都必须调用；
// requestKey 唯一幂等（同 clientRequestId 重试返回同一 failureId，不重复入队）。
async function recordFailure(ctx, input) {
  const scope = scopeOf(ctx);
  const now = nowMsOf(ctx);
  const requestKey = [scope.openid, 'ai.parseParcel', ctx.clientRequestId || ''].join(':');
  const existing = await ctx.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { requestKey } });
  if (existing) {
    return { failureNo: existing.failureNo, duplicated: true };
  }
  const failureNo = ctx.ids && typeof ctx.ids.failureNo === 'function'
    ? ctx.ids.failureNo(now)
    : idGenerator.generateFailureNo(now);
  const doc = {
    failureNo,
    requestKey,
    failureCode: input.failureCode,
    sourceRole: scope.role,
    uploaderOpenid: scope.openid,
    uploadTicketId: input.uploadTicketId || '',
    fileId: '',
    orderId: '',
    ocrTextMasked: typeof input.ocrTextMasked === 'string'
      ? input.ocrTextMasked.slice(0, MAX_OCR_TEXT_LENGTH)
      : '',
    ruleResult: input.ruleResult,
    aiTried: input.aiTried === true,
    aiModel: input.aiModel || '',
    aiResult: input.aiResult || null,
    aiErrorCode: input.aiErrorCode || '',
    status: enums.FAILURE_STATUS.PENDING,
    retentionDays: retentionDaysOf(ctx.config),
    createdAt: new Date(now),
    reviewedAt: null
  };
  try {
    const added = await ctx.dao.add(COLLECTIONS.RECOGNITION_FAILURES, doc);
    return { failureNo, failureId: added._id, duplicated: false };
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      const replay = await ctx.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { requestKey } });
      if (replay) {
        return { failureNo: replay.failureNo, duplicated: true };
      }
    }
    throw error;
  }
}

module.exports = {
  MAX_OCR_TEXT_LENGTH,
  COLLECTIONS,
  enums,
  time,
  aiParse,
  scopeOf,
  assertBusinessRole,
  assertWritable,
  nowMsOf,
  normalizePayload,
  loadUploadTicket,
  ticketStatusOf,
  buildRuleResult,
  aiQuotaKeys,
  readCounter,
  checkQuota,
  countQuota,
  recordFailure,
};
