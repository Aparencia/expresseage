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
const MAX_FILE_ID_LENGTH = 512;
const CONFLICT_STATION_MISMATCH = 'STATION_MISMATCH';
const CONFLICT_CODE_CONFLICT = 'CODE_CONFLICT';
const DEFAULT_RETENTION_DAYS = 30;
// 取件码候选 token：支持 207-3-1014 这类连字符/分隔符组；掩码片段（含 *）与运单上下文先剔除，避免把 JT22 当码
const CODE_TOKEN_RE = /[0-9A-Za-z]+(?:[-—–_#][0-9A-Za-z]+)*/g;
const MASKED_TOKEN_RE = /[0-9A-Za-z]*\*[0-9A-Za-z*]*/g;
const CODE_SEPARATOR_RE = /[\s\-—–_#·]/g;
const CODE_CONTEXT_RESET_RE = /(?:取件码|取货码|提货码|取件|提货)/;
const CODE_CONTEXT_SKIP_RE = /(?:运单|快递|物流|包裹|单号|尾号)/;
const CARRIER_PREFIX_RE = /^(?:JT|SF|YT|JD)/;
const DIGIT_RE = /\d/;

// identity.roles = auth 按 users.roles 归一出的业务角色集（双角色 [CUSTOMER,PARTNER]）；
// 切换会话/手工注入 ctx 只有 role 时回落单元素集，保持单角色语义不变。
function rolesOfIdentity(identity) {
  const source = identity || {};
  const raw = Array.isArray(source.roles) ? source.roles : [];
  const roles = [];
  if (raw.indexOf(enums.ROLES.CUSTOMER) >= 0) {
    roles.push(enums.ROLES.CUSTOMER);
  }
  if (raw.indexOf(enums.ROLES.PARTNER) >= 0) {
    roles.push(enums.ROLES.PARTNER);
  }
  if (roles.length === 0
    && (source.role === enums.ROLES.CUSTOMER || source.role === enums.ROLES.PARTNER)) {
    roles.push(source.role);
  }
  return roles;
}

function scopeOf(ctx) {
  const identity = (ctx && ctx.identity) || {};
  return {
    role: identity.role || '',
    roles: rolesOfIdentity(identity),
    openid: identity.effectiveOpenid || (ctx && ctx.openid) || '',
    viewMode: identity.viewMode || ''
  };
}

function assertBusinessRole(ctx) {
  const scope = scopeOf(ctx);
  if (scope.roles.length === 0) {
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
  // users.roles 成员制：双角色按入参 role 选定本次动作域角色（identity.role 已由 auth 同口径解析），
  // 单角色仍要求与其唯一业务角色一致（与旧行为等价）。
  if (scope.roles.indexOf(role) < 0) {
    throw errors.validation('role', '识别角色与当前身份不一致，请重新进入下单页');
  }
  // 票据归属/有效期校验失败不拒绝（记 ruleResult.ticketInvalid=true 供后台排查），只要求是字符串
  const uploadTicketId = typeof input.uploadTicketId === 'string' ? input.uploadTicketId.trim() : '';
  // 原图 fileId 只作入队关联（绝不进外发 payload）；归属校验在 handler 用上传票据完成，校验失败静默置 ''
  const fileId = typeof input.fileId === 'string' ? input.fileId.trim().slice(0, MAX_FILE_ID_LENGTH) : '';
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
    fileId,
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
function buildRuleResult(maskedText, hintTrackingTail, ticketStatus, config) {
  const conflicts = [];
  const station = normalizeStationFromText(maskedText, config);
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

function normalizeStationFromText(text, config) {
  // 新版共享站点表（task-3）：多说法命中 + config.stations 自定义正式名；旧副本无该 API 时回落静态归一。
  if (typeof stations.matchStationInText === 'function') {
    const options = typeof stations.stationsFromConfig === 'function'
      ? { stations: stations.stationsFromConfig(config) }
      : {};
    const hit = stations.matchStationInText(text, options) || {};
    return { id: typeof hit.id === 'string' ? hit.id : '', name: typeof hit.name === 'string' ? hit.name : '', conflict: hit.conflict === true };
  }
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

// 候选 token 归一：去分隔符转大写、必须含数字、4~12 位、排除运单号前缀；上下文（运单/快递/单号/尾号）整段跳过。
function acceptCodeToken(token, linePrefix) {
  const value = token.replace(CODE_SEPARATOR_RE, '').toUpperCase();
  if (value.length < 4 || value.length > 12 || !DIGIT_RE.test(value)) {
    return '';
  }
  if (CARRIER_PREFIX_RE.test(value)) {
    return '';
  }
  const segments = String(linePrefix || '').split(CODE_CONTEXT_RESET_RE);
  if (CODE_CONTEXT_SKIP_RE.test(segments[segments.length - 1])) {
    return '';
  }
  return value;
}

function normalizeCodeFromText(text) {
  // 含 * 的掩码片段整段剔除（JT22****25 不是取件码，也不能与真码冲突）
  const cleaned = String(text || '').replace(MASKED_TOKEN_RE, ' ');
  const accepted = [];
  CODE_TOKEN_RE.lastIndex = 0;
  let match = CODE_TOKEN_RE.exec(cleaned);
  while (match) {
    const lineStart = cleaned.lastIndexOf('\n', match.index) + 1;
    const code = acceptCodeToken(match[0], cleaned.slice(lineStart, match.index));
    if (code && accepted.indexOf(code) < 0) {
      accepted.push(code);
    }
    match = CODE_TOKEN_RE.exec(cleaned);
  }
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
    fileId: typeof input.fileId === 'string' ? input.fileId : '',
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
