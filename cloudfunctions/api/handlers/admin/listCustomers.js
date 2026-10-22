// handlers/admin/listCustomers.js · admin.listCustomers（默认脱敏 + 默认排除测试账号）
// 口径：DATA_MODEL §5.2「admin 顾客列表：customerNo/dormKey 精确、displayName 前缀（idx_display_name）」、
//       §5.3「游标分页、禁 skip/全表扫描/客户端过滤」；默认排除测试账号按页批量取 users 判 isTestAccount。
// 分页：(createdAt desc, customerNo) 游标；关键词三路均下推到服务端：编号前缀/苑+楼栋/昵称前缀。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  createAdminScope,
  readTrimmedText
} = require('./_common');
const dto = require('./_dto');
const paging = require('./_paging');

const DORM_KEYWORD = /^([DXNBC])(\d{1,2})$/i;

// 关键词分派：C 开头=顾客编号前缀；苑+楼栋=精确条件；其余=昵称前缀（服务端 gte 前缀范围）。
function queryOf(rawKeyword) {
  const keyword = readTrimmedText(rawKeyword, 32);
  if (!keyword) {
    return null;
  }
  const compact = paging.prefixOf(keyword);
  if (compact.length >= 2 && /^C[A-Z2-9]*$/.test(compact)) {
    return { kind: 'prefix', field: 'customerNo', prefix: compact };
  }
  const dorm = DORM_KEYWORD.exec(keyword);
  if (dorm) {
    return { kind: 'dorm', where: { zone: dorm[1].toUpperCase(), buildingNo: Number(dorm[2]) } };
  }
  return { kind: 'prefix', field: 'displayName', prefix: keyword };
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
  const query = paging.parseQuery(input);
  const includeTest = input.includeTest === true;
  const keyword = queryOf(input.keyword);
  const accept = includeTest ? null : (row) => scope.isTestAccount(row._id).then((isTest) => isTest !== true);
  let result = null;
  if (keyword && keyword.kind === 'prefix') {
    result = await paging.pagedCollect(scope, paging.fetchPrefixPage, {
      collection: COLLECTIONS.CUSTOMERS,
      where: {},
      field: keyword.field,
      prefix: keyword.prefix,
      limit: query.limit,
      cursor: query.cursor
    }, accept);
  } else {
    result = await paging.pagedCollect(scope, paging.fetchOrderedPage, {
      collection: COLLECTIONS.CUSTOMERS,
      where: keyword && keyword.kind === 'dorm' ? keyword.where : {},
      sortField: 'createdAt',
      idField: 'customerNo',
      order: 'desc',
      idOrder: 'asc',
      limit: query.limit,
      cursor: query.cursor
    }, accept);
  }
  const list = await Promise.all(result.list.map((row) => decorate(scope, row)));
  return { list: list, nextCursor: result.nextCursor, includeTest: includeTest };
}

module.exports = handler;
