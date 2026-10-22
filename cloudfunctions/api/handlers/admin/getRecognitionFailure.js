// handlers/admin/getRecognitionFailure.js · admin.getRecognitionFailure（原图临时 URL 5 分钟 + 每次查看审计）
// 门禁 #27：本函数体内必须同时出现原图签名调用与 FAILURE_IMAGE_VIEW 审计写入。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  createAdminScope,
  readTrimmedText
} = require('./_common');
const dto = require('./_dto');
const review = require('./_review');
const time = require('../../lib/time');

const IMAGE_URL_TTL_MINUTES = 5;

function normalizeFailureNo(value) {
  const text = readTrimmedText(value, 32).toUpperCase();
  if (!text || !enums.FAILURE_NO_PATTERN.test(text)) {
    throw errors.validation('failureNo', '复核记录编号格式不正确');
  }
  return text;
}

// 原图临时 URL 显式 5 分钟（D17/§11.3/AC-D-25；与 order/imageUrl 的 maxAge=300 同口径，M-47）。
async function issueImageUrl(ctx, fileId) {
  const cloud = ctx && ctx.cloud;
  if (!fileId || !cloud || typeof cloud.getTempFileURL !== 'function') {
    return null;
  }
  const result = await cloud.getTempFileURL({
    fileList: [{ fileID: fileId, maxAge: IMAGE_URL_TTL_MINUTES * 60 }]
  });
  const first = result && Array.isArray(result.fileList) ? result.fileList[0] : null;
  const url = first && first.tempFileURL ? first.tempFileURL : '';
  if (!url) {
    return null;
  }
  return url;
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const failureNo = normalizeFailureNo(input.failureNo);
  const record = await scope.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo: failureNo } });
  if (!record) {
    throw errors.notFound('复核记录不存在');
  }
  const uploader = await review.loadUploader(scope, record);
  const orderNo = await review.orderNoOf(scope, record);
  const imageUrl = input.withImage === false ? '' : await issueImageUrl(ctx, record.fileId);
  if (imageUrl) {
    await scope.writeAudit(
      AUDIT_ACTIONS.FAILURE_IMAGE_VIEW,
      { type: 'recognition_failure', id: failureNo },
      {
        failureNo: failureNo,
        sourceRole: record.sourceRole || '',
        uploaderNo: uploader.no || '',
        expiresInMinutes: IMAGE_URL_TTL_MINUTES
      },
      ''
    );
  }
  const image = imageUrl
    ? { url: imageUrl, expiresAt: new Date(time.addMinutes(scope.now, IMAGE_URL_TTL_MINUTES)) }
    : null;
  return dto.failureDetail(record, {
    no: uploader.no,
    displayName: uploader.displayName,
    orderNo: orderNo
  }, image);
}

module.exports = handler;
