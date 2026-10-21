// handlers/admin/listRecognitionFailures.js · admin.listRecognitionFailures（列表不含 fileId/uploaderOpenid）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope,
  parsePage,
  findPage,
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');
const review = require('./_review');

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
  const page = parsePage(input);
  const status = normalizeStatus(input.status, enums.FAILURE_STATUS.PENDING);
  const failureCode = normalizeFailureCode(input.failureCode);
  const where = { status: status };
  if (failureCode) {
    where.failureCode = failureCode;
  }
  const rows = [];
  let scanned = 0;
  while (rows.length < page.limit && scanned < MAX_SCAN) {
    const size = Math.min(Math.max(page.limit - rows.length + 10, 20), 100);
    const batch = await findPage(scope, COLLECTIONS.RECOGNITION_FAILURES, where, [['createdAt', 'desc']], page.offset + scanned, size);
    if (batch.length === 0) {
      break;
    }
    for (let i = 0; i < batch.length && rows.length < page.limit; i += 1) {
      rows.push(batch[i]);
    }
    scanned += batch.length;
    if (batch.length < size) {
      break;
    }
  }
  const list = [];
  for (let i = 0; i < rows.length; i += 1) {
    const uploader = await review.loadUploader(scope, rows[i]);
    const orderNo = await review.orderNoOf(scope, rows[i]);
    list.push(dto.failureBrief(rows[i], {
      no: uploader.no,
      displayName: uploader.displayName,
      orderNo: orderNo
    }));
  }
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + scanned } : null;
  return { list: list, nextCursor: nextCursor, counts: await countsOf(scope) };
}

module.exports = handler;
