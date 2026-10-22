// handlers/admin/listPartners.js · admin.listPartners（默认脱敏 + 默认排除测试账号；单量取可重算缓存）
// 口径：DATA_MODEL §5.2「admin 兼职列表：partnerNo 精确 / status + updatedAt desc」、§5.3 游标分页。
// 关键词=兼职编号前缀（完整/前缀均可）或昵称前缀，均为服务端 gte 范围查询；默认排除测试账号按页判定。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope,
  readTrimmedText
} = require('./_common');
const dto = require('./_dto');
const paging = require('./_paging');

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

// 关键词分派：P 开头=兼职编号前缀；其余=昵称前缀（服务端前缀匹配，列表仍脱敏）。
function queryOf(rawKeyword) {
  const keyword = readTrimmedText(rawKeyword, 32);
  if (!keyword) {
    return null;
  }
  const compact = paging.prefixOf(keyword);
  if (/^P[A-Z2-9]*$/.test(compact)) {
    return { field: 'partnerNo', prefix: compact };
  }
  return { field: 'displayName', prefix: keyword };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const query = paging.parseQuery(input);
  const status = normalizeStatus(input.status);
  const includeTest = input.includeTest === true;
  const keyword = queryOf(input.keyword);
  const where = status ? { status: status } : {};
  const accept = includeTest ? null : (row) => scope.isTestAccount(row.openid).then((isTest) => isTest !== true);
  let result = null;
  if (keyword) {
    result = await paging.pagedCollect(scope, paging.fetchPrefixPage, {
      collection: COLLECTIONS.PARTNERS,
      where: where,
      field: keyword.field,
      prefix: keyword.prefix,
      limit: query.limit,
      cursor: query.cursor
    }, accept);
  } else {
    result = await paging.pagedCollect(scope, paging.fetchOrderedPage, {
      collection: COLLECTIONS.PARTNERS,
      where: where,
      sortField: 'createdAt',
      idField: 'partnerNo',
      order: 'desc',
      idOrder: 'asc',
      limit: query.limit,
      cursor: query.cursor
    }, accept);
  }
  const list = await Promise.all(result.list.map(async (row) => {
    const bindings = await scope.dao.count(COLLECTIONS.BINDINGS, {
      where: { partnerId: row._id, status: enums.BINDING_STATUS.ACTIVE }
    });
    return dto.partnerBrief(row, {
      bindings: bindings,
      isTest: await scope.isTestAccount(row.openid)
    });
  }));
  return { list: list, nextCursor: result.nextCursor, includeTest: includeTest };
}

module.exports = handler;
