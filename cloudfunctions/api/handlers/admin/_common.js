// handlers/admin/_common.js · 后台域共用件：管理员闸 / 审计 / 配置 / 分页扫描 / 载入与校验包装
// 口径：DATA_MODEL §2.11/§2.13/§7.7、ENGINEERING §4.8/§4.9/§4.11。只认中间件解析后的 ctx.identity；
// admin 动作一律不接受切换会话（中间件已拦，handler 再做一次 fail-closed）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const enums = require('../../shared/enums');
const sharedValidate = require('../../shared/validate');
const time = require('../../lib/time');
const errors = require('../../lib/errors');
const { readConfig } = require('../../db/config');
const mask = require('../../db/dto/mask');
const idempotency = require('../../middleware/idempotency');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_SCAN = 500;
const MAX_UNIQUE_ATTEMPTS = 5;
const AUDIT_DETAIL_MAX_TEXT = 120;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function toDate(ms) {
  return new Date(time.toMs(ms));
}

function readTrimmedText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.trim();
  if (text === '') {
    return '';
  }
  if (maxLength && text.length > maxLength) {
    return '';
  }
  return text;
}

// ── 管理员闸（fail-closed：中间件之外再保一道）────────────────────────────────
// allowViewMode：仅 admin.viewAsEnd（退出切换会话）使用——退出动作必须允许带会话身份执行，
// 否则开发者永远退不出视角；业务/查询类 admin 动作仍一律拒绝票据身份。
function requireAdmin(ctx, options) {
  const opts = options || {};
  const identity = (ctx && ctx.identity) || {};
  const actorOpenid = identity.actorOpenid || (ctx && ctx.openid) || '';
  if (!identity.developerNo || !actorOpenid) {
    throw errors.forbidden('当前身份无权使用开发者后台');
  }
  if (!opts.allowViewMode) {
    if (identity.viewMode || identity.viewTicketId) {
      throw errors.forbidden('切换会话不能执行开发者后台动作');
    }
    if (identity.effectiveOpenid && identity.effectiveOpenid !== actorOpenid) {
      throw errors.forbidden('切换会话不能执行开发者后台动作');
    }
  }
  return { actorOpenid, developerNo: identity.developerNo };
}

function requireClientRequestId(ctx) {
  const value = ctx && ctx.clientRequestId;
  const check = sharedValidate.validateClientRequestId(value);
  if (!check.ok) {
    throw errors.validation('clientRequestId', '请求标识缺失或格式不正确，请重试');
  }
  return value;
}

// ── 校验包装 ─────────────────────────────────────────────────────────────────
function assertValid(result, message) {
  if (!result || result.ok !== true) {
    const field = (result && result.field) || 'data';
    throw errors.validation(field, message || '参数不合法，请核对后重试');
  }
  return result;
}

function readNote(value, maxLength, field) {
  const result = sharedValidate.validateText(value, maxLength, field, false);
  assertValid(result, '备注格式不正确');
  return result.value;
}

// ── 配置 ─────────────────────────────────────────────────────────────────────
// 后台必须知道配置是否已落库（bootstrap 种子判定），因此不使用 ctx 里已补默认值的快照。
async function loadConfigOf(ctx) {
  return readConfig(ctx.dao);
}

// ── 审计 ─────────────────────────────────────────────────────────────────────
function auditKeyOf(ctx) {
  return idempotency.auditRequestKey(ctx);
}

function buildAuditRecord(scope, action, target, detail, requestKey) {
  const record = {
    adminOpenid: scope.actorOpenid,
    developerNo: scope.developerNo,
    action: action,
    target: target || { type: '', id: '' },
    detail: detail || {},
    at: scope.nowDate
  };
  // requestKey 唯一索引：无幂等键的审计用「本次请求」派生键，避免空值/缺失互相冲突。
  const key = requestKey || ('auto:' + String((scope.ctx && scope.ctx.requestId) || '') + ':' + String(action || ''));
  record.requestKey = key;
  return record;
}

// 管理写动作审计：requestKey 唯一；重复键说明重放，返回 duplicated 由调用方决定响应。
async function writeAudit(scope, action, target, detail, requestKey) {
  const record = buildAuditRecord(scope, action, target, detail, requestKey);
  try {
    await scope.dao.add(COLLECTIONS.ADMIN_AUDIT, record);
    return { written: true, duplicated: false, record };
  } catch (error) {
    if (scope.dao.isDuplicateError(error)) {
      return { written: false, duplicated: true, record };
    }
    console.error('[admin] 审计写入失败', action, scope.ctx && scope.ctx.requestId);
    throw errors.internalError('审计写入失败，请稍后重试');
  }
}

async function findAuditByKey(scope, requestKey) {
  if (!requestKey) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.ADMIN_AUDIT, { where: { requestKey }, limit: 1 });
}

// ── 作用域（一次请求构造一次，避免各 handler 重复读配置/测试标记）──────────────
function buildScope(ctx, configResult, admin) {
  const scope = {
    ctx: ctx,
    dao: ctx.dao,
    now: nowMsOf(ctx),
    config: configResult.config || {},
    configSeeded: configResult.seeded === true,
    actorOpenid: admin.actorOpenid,
    developerNo: admin.developerNo,
    testCache: new Map()
  };
  scope.nowDate = toDate(scope.now);
  scope.auditKey = function auditKey() {
    return auditKeyOf(ctx);
  };
  scope.findAudit = function findAudit(requestKey) {
    return findAuditByKey(scope, requestKey);
  };
  scope.writeAudit = function write(action, target, detail, requestKey) {
    return writeAudit(scope, action, target, detail, requestKey);
  };
  scope.isTestAccount = function isTestAccount(openid) {
    return testFlagOf(scope, openid);
  };
  return scope;
}

async function createAdminScope(ctx, options) {
  const admin = requireAdmin(ctx, options);
  const configResult = await loadConfigOf(ctx);
  return buildScope(ctx, configResult, admin);
}

// 部署上下文（无 OPENID，如部署脚本/控制台测试）专用：仅 admin.bootstrap 等内部动作可用；
// 身份记为 SYSTEM（审计口径：系统任务 adminOpenid/developerNo = 'SYSTEM'）。
async function createInternalScope(ctx) {
  const configResult = await loadConfigOf(ctx);
  return buildScope(ctx, configResult, { actorOpenid: 'SYSTEM', developerNo: 'SYSTEM' });
}

async function testFlagOf(scope, openid) {
  if (!openid) {
    return false;
  }
  if (scope.testCache.has(openid)) {
    return scope.testCache.get(openid);
  }
  const user = await scope.dao.get(COLLECTIONS.USERS, openid);
  const value = !!(user && user.isTestAccount === true);
  scope.testCache.set(openid, value);
  return value;
}

// 批量取测试标记；返回 openid → boolean 的 Map
async function loadTestFlags(scope, openids) {
  const unique = [];
  openids.forEach((openid) => {
    if (openid && unique.indexOf(openid) < 0) {
      unique.push(openid);
    }
  });
  await Promise.all(unique.map((openid) => testFlagOf(scope, openid)));
  const flags = new Map();
  unique.forEach((openid) => {
    flags.set(openid, scope.testCache.get(openid) === true);
  });
  return flags;
}

// ── 载入 ─────────────────────────────────────────────────────────────────────
async function getUserByOpenid(scope, openid) {
  if (!openid) {
    return null;
  }
  return scope.dao.get(COLLECTIONS.USERS, openid);
}

async function getCustomerByNo(scope, customerNo) {
  if (!customerNo) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.CUSTOMERS, { where: { customerNo } });
}

async function getCustomerById(scope, customerId) {
  if (!customerId) {
    return null;
  }
  return scope.dao.get(COLLECTIONS.CUSTOMERS, customerId);
}

async function getPartnerByNo(scope, partnerNo) {
  if (!partnerNo) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.PARTNERS, { where: { partnerNo } });
}

async function getPartnerById(scope, partnerId) {
  if (!partnerId) {
    return null;
  }
  return scope.dao.get(COLLECTIONS.PARTNERS, partnerId);
}

async function getPartnerByOpenid(scope, openid) {
  if (!openid) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid } });
}

async function getActiveBindingOfCustomer(scope, customerId) {
  if (!customerId) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId: customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

function normalizeOrderNoInput(value) {
  const orderNo = readTrimmedText(value, 32).toUpperCase();
  if (!orderNo || !enums.ORDER_NO_PATTERN.test(orderNo)) {
    throw errors.validation('orderNo', '订单号格式不正确，请核对后重试');
  }
  return orderNo;
}

async function getOrderByNo(scope, orderNo) {
  if (!orderNo) {
    return null;
  }
  return scope.dao.findOne(COLLECTIONS.ORDERS, { where: { orderNo } });
}

// ── 分页（offset 游标；先按排序扫描，再在内存做测试标记/关键词过滤）────────────
function parsePage(payload) {
  const input = isPlainObject(payload) ? payload : {};
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  let offset = 0;
  if (input.cursor && typeof input.cursor === 'object' && Number.isFinite(Number(input.cursor.offset))) {
    offset = Math.max(0, Math.floor(Number(input.cursor.offset)));
  }
  return { limit, offset };
}

// fetchPage(offset, size) → rows[]；match(row) → boolean（缺省全通过）
async function scanPaged(options) {
  const opts = options || {};
  const limit = opts.limit || DEFAULT_PAGE_SIZE;
  const start = opts.offset || 0;
  const maxScan = opts.maxScan || MAX_SCAN;
  const fetchPage = opts.fetchPage;
  const match = typeof opts.match === 'function' ? opts.match : function pass() { return true; };
  const rows = [];
  let scanned = 0;
  while (rows.length < limit && scanned < maxScan) {
    const size = Math.min(Math.max(limit - rows.length + 10, 20), MAX_PAGE_SIZE);
    const page = await fetchPage(start + scanned, size);
    const list = Array.isArray(page) ? page : [];
    if (list.length === 0) {
      break;
    }
    for (let i = 0; i < list.length && rows.length < limit; i += 1) {
      if (match(list[i])) {
        rows.push(list[i]);
      }
    }
    scanned += list.length;
    if (list.length < size) {
      break;
    }
  }
  const nextOffset = scanned > 0 ? start + scanned : 0;
  return {
    rows: rows,
    nextCursor: rows.length >= limit ? { offset: nextOffset } : null
  };
}

function findPage(scope, collection, where, orderBy, offset, size) {
  return scope.dao.find(collection, {
    where: where || {},
    orderBy: orderBy || [],
    skip: offset,
    limit: size
  });
}

function startOfDayMs(nowMs) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function maskText(value) {
  return mask.maskDisplayName(value);
}

function codeTailOf(code) {
  if (typeof code !== 'string' || code.length === 0) {
    return '';
  }
  return code.slice(-4);
}

function truncateDetail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.length > AUDIT_DETAIL_MAX_TEXT ? value.slice(0, AUDIT_DETAIL_MAX_TEXT) : value;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SCAN,
  MAX_UNIQUE_ATTEMPTS,
  AUDIT_ACTIONS,
  enums,
  sharedValidate,
  errors,
  mask,
  idempotency,
  isPlainObject,
  nowMsOf,
  toDate,
  readTrimmedText,
  requireAdmin,
  requireClientRequestId,
  assertValid,
  readNote,
  loadConfigOf,
  auditKeyOf,
  writeAudit,
  findAuditByKey,
  createAdminScope,
  createInternalScope,
  testFlagOf,
  loadTestFlags,
  getUserByOpenid,
  getCustomerByNo,
  getCustomerById,
  getPartnerByNo,
  getPartnerById,
  getPartnerByOpenid,
  getActiveBindingOfCustomer,
  normalizeOrderNoInput,
  getOrderByNo,
  parsePage,
  scanPaged,
  findPage,
  startOfDayMs,
  maskText,
  codeTailOf,
  truncateDetail
};
