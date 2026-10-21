// handlers/admin/ignoreRecognitionFailure.js · admin.ignoreRecognitionFailure（备注必填；终态不可重开）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  readTrimmedText
} = require('./_common');
const review = require('./_review');

function normalizeFailureNo(value) {
  const text = readTrimmedText(value, 32).toUpperCase();
  if (!text || !enums.FAILURE_NO_PATTERN.test(text)) {
    throw errors.validation('failureNo', '复核记录编号格式不正确');
  }
  return text;
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const failureNo = normalizeFailureNo(input.failureNo);
  const noteResult = sharedValidate.validateText(input.note, sharedValidate.TEXT_LIMITS.failureNote, 'note', true);
  if (!noteResult.ok || !noteResult.value) {
    throw errors.validation('note', '请填写忽略原因（最多 100 字）');
  }
  const record = await scope.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo: failureNo } });
  if (!record) {
    throw errors.notFound('复核记录不存在');
  }
  if (record.status === enums.FAILURE_STATUS.FIXED) {
    throw errors.invalidState('该记录已补录，不能改为忽略');
  }
  if (record.status === enums.FAILURE_STATUS.IGNORED) {
    return {
      failureNo: failureNo,
      status: enums.FAILURE_STATUS.IGNORED,
      resolution: record.resolution || null,
      notified: false,
      duplicated: true
    };
  }
  const resolution = {
    note: noteResult.value,
    by: scope.developerNo,
    at: scope.nowDate
  };
  await scope.dao.update(COLLECTIONS.RECOGNITION_FAILURES, record._id, {
    status: enums.FAILURE_STATUS.IGNORED,
    resolution: resolution,
    reviewedAt: scope.nowDate,
    updatedAt: scope.nowDate
  });
  const notified = input.notifyUploader === true
    ? await review.notifyUploader(scope, record, failureNo)
    : false;
  await scope.writeAudit(
    AUDIT_ACTIONS.FAILURE_IGNORE,
    { type: 'recognition_failure', id: failureNo },
    {
      failureNo: failureNo,
      noteLength: noteResult.value.length,
      notified: notified
    },
    auditKeyOf(ctx)
  );
  return {
    failureNo: failureNo,
    status: enums.FAILURE_STATUS.IGNORED,
    resolution: resolution,
    notified: notified
  };
}

module.exports = handler;
