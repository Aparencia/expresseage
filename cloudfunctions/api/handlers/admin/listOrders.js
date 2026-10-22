// handlers/admin/listOrders.js · admin.listOrders（默认脱敏 + 默认 isTest=false；异常单可筛选）
// 口径：DATA_MODEL §5.2「admin 订单列表：默认 isTest=false、status 筛选、customerNo/partnerNo 精确」、
//       §5.3「游标分页、禁止 skip/where({}) 全表扫描与客户端过滤」。
// 分页：游标 {sortValue,id}（statusUpdatedAt desc + orderNo 平局），过滤条件全部进服务端 where；
// 关键词=订单号/顾客编号/兼职编号前缀，走服务端 gte(prefix) 升序游标（内存只做 startsWith 收敛）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  readTrimmedText
} = require('./_common');
const dto = require('./_dto');
const paging = require('./_paging');

const ORDER_NO_START = /^\d/;

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

// 关键词分派：数字开头=订单号前缀；C…=顾客编号前缀；P…=兼职编号前缀。
function keywordQueryOf(rawKeyword) {
  const text = readTrimmedText(rawKeyword, 40);
  if (!text) {
    return null;
  }
  const upper = text.toUpperCase();
  if (ORDER_NO_START.test(upper)) {
    return { field: 'orderNo', prefix: upper };
  }
  const compact = paging.prefixOf(upper);
  if (/^C[A-Z2-9]*$/.test(compact)) {
    return { field: 'customerNo', prefix: compact };
  }
  if (/^P[A-Z2-9]*$/.test(compact)) {
    return { field: 'partnerNo', prefix: compact };
  }
  return { field: 'orderNo', prefix: upper };
}

function buildWhere(input) {
  const where = {};
  const status = normalizeStatus(input.status);
  const customerNo = normalizeNo(input.customerNo, 'customerNo', sharedValidate.validateCustomerNo);
  const partnerNo = normalizeNo(input.partnerNo, 'partnerNo', sharedValidate.validatePartnerNo);
  if (status) {
    where.status = status;
  }
  if (customerNo) {
    where.customerNo = customerNo;
  }
  if (partnerNo) {
    where.partnerNo = partnerNo;
  }
  const includeTest = input.includeTest === true;
  if (!includeTest) {
    where.isTest = false;
  }
  return { where: where, includeTest: includeTest };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const query = paging.parseQuery(input);
  const built = buildWhere(input);
  const keyword = keywordQueryOf(input.keyword);
  let result = null;
  if (keyword) {
    result = await paging.pagedCollect(scope, paging.fetchPrefixPage, {
      collection: COLLECTIONS.ORDERS,
      where: built.where,
      field: keyword.field,
      prefix: keyword.prefix,
      limit: query.limit,
      cursor: query.cursor
    }, null);
  } else {
    result = await paging.pagedCollect(scope, paging.fetchOrderedPage, {
      collection: COLLECTIONS.ORDERS,
      where: built.where,
      sortField: 'statusUpdatedAt',
      idField: 'orderNo',
      order: 'desc',
      idOrder: 'desc',
      limit: query.limit,
      cursor: query.cursor
    }, null);
  }
  return {
    list: result.list.map((row) => dto.orderBrief(row, row.isTest === true)),
    nextCursor: result.nextCursor,
    includeTest: built.includeTest
  };
}

module.exports = handler;
