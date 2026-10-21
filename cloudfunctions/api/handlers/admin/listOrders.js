// handlers/admin/listOrders.js · admin.listOrders（默认脱敏 + 默认 isTest=false；异常单可筛选）
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
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (enums.ORDER_STATUS_LIST.indexOf(value) < 0) {
    throw errors.validation('status', '订单状态不正确');
  }
  return value;
}

function normalizeNo(value, field, validator) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const check = validator(value);
  if (!check.ok) {
    throw errors.validation(field, '编号格式不正确');
  }
  return check.canonical;
}

function buildMatcher(rawKeyword) {
  const keyword = readTrimmedText(rawKeyword, 32).toUpperCase();
  if (!keyword) {
    return function matchAll() {
      return true;
    };
  }
  return function matchKeyword(row) {
    const orderNo = String(row.orderNo || '');
    if (orderNo.indexOf(keyword) === 0) {
      return true;
    }
    return String(row.customerNo || '').indexOf(keyword) === 0
      || String(row.partnerNo || '').indexOf(keyword) === 0;
  };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const page = parsePage(input);
  const status = normalizeStatus(input.status);
  const customerNo = normalizeNo(input.customerNo, 'customerNo', sharedValidate.validateCustomerNo);
  const partnerNo = normalizeNo(input.partnerNo, 'partnerNo', sharedValidate.validatePartnerNo);
  const includeTest = input.includeTest === true;
  const match = buildMatcher(input.keyword);
  const where = {};
  if (status) {
    where.status = status;
  }
  if (customerNo) {
    where.customerNo = customerNo;
  }
  if (partnerNo) {
    where.partnerNo = partnerNo;
  }
  const rows = [];
  let scanned = 0;
  while (rows.length < page.limit && scanned < MAX_SCAN) {
    const size = Math.min(Math.max(page.limit - rows.length + 10, 20), 100);
    const batch = await findPage(scope, COLLECTIONS.ORDERS, where, [['createdAt', 'desc']], page.offset + scanned, size);
    if (batch.length === 0) {
      break;
    }
    for (let i = 0; i < batch.length && rows.length < page.limit; i += 1) {
      const row = batch[i];
      if (!includeTest && row.isTest === true) {
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
  const list = rows.map((row) => dto.orderBrief(row, row.isTest === true));
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + scanned } : null;
  return { list: list, nextCursor: nextCursor, includeTest: includeTest };
}

module.exports = handler;
