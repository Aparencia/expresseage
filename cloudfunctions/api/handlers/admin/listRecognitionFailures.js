// handlers/admin/listRecognitionFailures.js · admin.listRecognitionFailures（列表不含 fileId/uploaderOpenid）
// 口径：DATA_MODEL §5.2「识别失败队列：status 按 createdAt desc（idx_status_created）；failureNo 精确；
//       不提供上传人搜索」、§5.3「游标分页、禁 skip/全表扫描」。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope
} = require('./_common');
const dto = require('./_dto');
const review = require('./_review');
const paging = require('./_paging');

const STATUS_LIST = enums.FAILURE_STATUS_LIST;

function normalizeStatus(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback || '';
  }
  if (STATUS_LIST.indexOf(value) < 0) {
    throw errors.validation('status', '复核状态不正确');
  }
  return value;
}

function normalizeFailureCode(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (enums.FAILURE_CODE_LIST.indexOf(value) < 0) {
    throw errors.validation('failureCode', '失败码不正确');
  }
  return value;
}

async function countsOf(scope) {
  const list = await Promise.all(STATUS_LIST.map(function countStatus(status) {
    return scope.dao.count(COLLECTIONS.RECOGNITION_FAILURES, { where: { status: status } });
  }));
  const counts = {};
  STATUS_LIST.forEach(function setCount(status, index) {
    counts[status] = list[index] || 0;
  });
  return counts;
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const query = paging.parseQuery(input);
  const status = normalizeStatus(input.status, enums.FAILURE_STATUS.PENDING);
  const failureCode = normalizeFailureCode(input.failureCode);
  const where = { status: status };
  if (failureCode) {
    where.failureCode = failureCode;
  }
  const result = await paging.pagedCollect(scope, paging.fetchOrderedPage, {
    collection: COLLECTIONS.RECOGNITION_FAILURES,
    where: where,
    sortField: 'createdAt',
    idField: 'failureNo',
    order: 'desc',
    idOrder: 'asc',
    limit: query.limit,
    cursor: query.cursor
  }, null);
  const list = [];
  for (let i = 0; i < result.list.length; i += 1) {
    const row = result.list[i];
    const uploader = await review.loadUploader(scope, row);
    const orderNo = await review.orderNoOf(scope, row);
    list.push(dto.failureBrief(row, {
      no: uploader.no,
      displayName: uploader.displayName,
      orderNo: orderNo
    }));
  }
  return { list: list, nextCursor: result.nextCursor, counts: await countsOf(scope) };
}

module.exports = handler;
