// handlers/admin/listCustomers.js · admin.listCustomers（默认脱敏 + 默认排除测试账号；关键词=编号前缀/苑+楼栋/昵称精确）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  sharedValidate,
  createAdminScope,
  readTrimmedText,
  parsePage,
  findPage,
  loadTestFlags,
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');

const DORM_KEYWORD = /^([DXNBC])(\d{1,2})$/i;

function buildMatcher(rawKeyword) {
  const keyword = readTrimmedText(rawKeyword, 32);
  if (!keyword) {
    return function matchAll() {
      return true;
    };
  }
  const noCheck = sharedValidate.validateCustomerNo(keyword);
  if (noCheck.ok) {
    return function matchNo(row) {
      return typeof row.customerNo === 'string' && row.customerNo.indexOf(noCheck.canonical) === 0;
    };
  }
  const dorm = DORM_KEYWORD.exec(keyword);
  if (dorm) {
    const zone = dorm[1].toUpperCase();
    const buildingNo = Number(dorm[2]);
    return function matchDorm(row) {
      return row.zone === zone && Number(row.buildingNo) === buildingNo;
    };
  }
  return function matchName(row) {
    return typeof row.displayName === 'string' && row.displayName === keyword;
  };
}

async function decorate(scope, customer) {
  const binding = await scope.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId: customer._id, status: enums.BINDING_STATUS.ACTIVE }
  });
  const partner = binding ? await scope.dao.get(COLLECTIONS.PARTNERS, binding.partnerId) : null;
  return dto.customerBrief(customer, {
    binding: binding,
    partner: partner,
    isTest: await scope.isTestAccount(customer._id)
  });
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const page = parsePage(input);
  const includeTest = input.includeTest === true;
  const match = buildMatcher(input.keyword);
  const rows = [];
  let scanned = 0;
  while (rows.length < page.limit && scanned < MAX_SCAN) {
    const size = Math.min(Math.max(page.limit - rows.length + 10, 20), 100);
    const batch = await findPage(scope, COLLECTIONS.CUSTOMERS, {}, [['createdAt', 'desc']], page.offset + scanned, size);
    if (batch.length === 0) {
      break;
    }
    const flags = await loadTestFlags(scope, batch.map((row) => row._id));
    for (let i = 0; i < batch.length && rows.length < page.limit; i += 1) {
      const row = batch[i];
      if (!includeTest && flags.get(row._id) === true) {
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
  const list = await Promise.all(rows.map((row) => decorate(scope, row)));
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + scanned } : null;
  return { list: list, nextCursor: nextCursor, includeTest: includeTest };
}

module.exports = handler;
