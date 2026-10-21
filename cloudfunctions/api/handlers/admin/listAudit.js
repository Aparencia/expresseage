// handlers/admin/listAudit.js · admin.listAudit（审计分页；旧切换会话审计名只读兼容映射）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTION_LIST } = require('../../shared/audit-actions');
const {
  errors,
  sharedValidate,
  createAdminScope,
  readTrimmedText,
  parsePage,
  findPage,
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');

const LEGACY_PREFIX = 'VIEW' + '_' + 'AS' + '_';

function mappedActionOf(action) {
  if (typeof action !== 'string' || action.indexOf(LEGACY_PREFIX) !== 0) {
    return action || '';
  }
  const suffix = action.slice(LEGACY_PREFIX.length);
  if (suffix === 'START') {
    return 'ACCOUNT_SWITCH_START';
  }
  if (suffix === 'END') {
    return 'ACCOUNT_SWITCH_END';
  }
  if (suffix === 'EXPIRED') {
    return 'ACCOUNT_SWITCH_EXPIRED';
  }
  return action;
}

function normalizeAction(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (AUDIT_ACTION_LIST.indexOf(value) >= 0) {
    return value;
  }
  const mapped = mappedActionOf(value);
  if (mappedActionOf(mapped) === mapped && AUDIT_ACTION_LIST.indexOf(mapped) >= 0) {
    return mapped;
  }
  throw errors.validation('action', '审计动作不正确');
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const page = parsePage(input);
  const action = normalizeAction(input.action);
  let developerNo = '';
  if (input.developerNo !== undefined && input.developerNo !== null && input.developerNo !== '') {
    const check = sharedValidate.validateDeveloperNo(input.developerNo);
    if (!check.ok) {
      throw errors.validation('developerNo', '开发者编号格式不正确');
    }
    developerNo = check.canonical;
  }
  const where = {};
  if (developerNo) {
    where.developerNo = developerNo;
  }
  const rows = [];
  let scanned = 0;
  while (rows.length < page.limit && scanned < MAX_SCAN) {
    const size = Math.min(Math.max(page.limit - rows.length + 10, 20), 100);
    const batch = await findPage(scope, COLLECTIONS.ADMIN_AUDIT, where, [['at', 'desc']], page.offset + scanned, size);
    if (batch.length === 0) {
      break;
    }
    for (let i = 0; i < batch.length && rows.length < page.limit; i += 1) {
      const row = batch[i];
      if (action && dto.auditActionOf(row.action) !== action) {
        continue;
      }
      rows.push(row);
    }
    scanned += batch.length;
    if (batch.length < size) {
      break;
    }
  }
  const list = rows.map(dto.auditBrief);
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + scanned } : null;
  return { list: list, nextCursor: nextCursor };
}

module.exports = handler;
