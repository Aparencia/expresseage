// handlers/admin/listPartners.js · admin.listPartners（默认脱敏 + 默认排除测试账号；单量取可重算缓存）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  readTrimmedText,
  parsePage,
  findPage,
  loadTestFlags,
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');

const STATUS_LIST = enums.PARTNER_STATUS_LIST;

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (STATUS_LIST.indexOf(value) < 0) {
    throw errors.validation('status', '兼职状态不正确');
  }
  return value;
}

function buildMatcher(rawKeyword) {
  const keyword = readTrimmedText(rawKeyword, 32);
  if (!keyword) {
    return function matchAll() {
      return true;
    };
  }
  const noCheck = sharedValidate.validatePartnerNo(keyword);
  if (noCheck.ok) {
    return function matchNo(row) {
      return typeof row.partnerNo === 'string' && row.partnerNo.indexOf(noCheck.canonical) === 0;
    };
  }
  return function matchName(row) {
    return typeof row.displayName === 'string' && row.displayName === keyword;
  };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const page = parsePage(input);
  const status = normalizeStatus(input.status);
  const includeTest = input.includeTest === true;
  const match = buildMatcher(input.keyword);
  const where = status ? { status: status } : {};
  const rows = [];
  let scanned = 0;
  while (rows.length < page.limit && scanned < MAX_SCAN) {
    const size = Math.min(Math.max(page.limit - rows.length + 10, 20), 100);
    const batch = await findPage(scope, COLLECTIONS.PARTNERS, where, [['createdAt', 'desc']], page.offset + scanned, size);
    if (batch.length === 0) {
      break;
    }
    const flags = await loadTestFlags(scope, batch.map((row) => row.openid));
    for (let i = 0; i < batch.length && rows.length < page.limit; i += 1) {
      const row = batch[i];
      if (!includeTest && flags.get(row.openid) === true) {
        continue;
      }
      if (!match(row)) {
        continue;
      }
      rows.push(row);
    }
    scanned += batch.length;
    if (batch.length < size) {
      break;
    }
  }
  const list = await Promise.all(rows.map(async (row) => {
    const bindings = await scope.dao.count(COLLECTIONS.BINDINGS, {
      where: { partnerId: row._id, status: enums.BINDING_STATUS.ACTIVE }
    });
    return dto.partnerBrief(row, {
      bindings: bindings,
      isTest: await scope.isTestAccount(row.openid)
    });
  }));
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + scanned } : null;
  return { list: list, nextCursor: nextCursor, includeTest: includeTest };
}

module.exports = handler;
