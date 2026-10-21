// handlers/admin/fixRecognitionFailure.js · admin.fixRecognitionFailure（只回填关联订单识别三字段；不改状态/归属）
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
  assertValid,
  readTrimmedText
} = require('./_common');
const stations = require('../../shared/stations');
const review = require('./_review');

function normalizeFailureNo(value) {
  const text = readTrimmedText(value, 32).toUpperCase();
  if (!text || !enums.FAILURE_NO_PATTERN.test(text)) {
    throw errors.validation('failureNo', '复核记录编号格式不正确');
  }
  return text;
}

function buildRecognitionFields(input) {
  const fields = {};
  const stationId = readTrimmedText(input.stationId, 8);
  const stationName = readTrimmedText(input.stationName, 40);
  if (stationId || stationName) {
    const check = stations.validateStation(stationId, stationName);
    if (!check.ok) {
      throw errors.validation('stationId', '站点必须是 P1~P8 的正式站点');
    }
    fields.stationId = check.id;
    fields.stationName = check.name;
  }
  if (input.pickupCode !== undefined && input.pickupCode !== null && input.pickupCode !== '') {
    const codeCheck = assertValid(sharedValidate.validatePickupCode(input.pickupCode), '取件码格式不正确');
    if (!codeCheck.empty) {
      fields.pickupCode = codeCheck.value;
    }
  }
  return fields;
}

function buildResolution(scope, input, fields) {
  const noteResult = sharedValidate.validateFailureNote(input.note);
  assertValid(noteResult, '备注最多 100 字');
  return {
    stationId: fields.stationId || '',
    stationName: fields.stationName || '',
    pickupCode: fields.pickupCode || '',
    note: noteResult.value || '',
    by: scope.developerNo,
    at: scope.nowDate
  };
}

async function patchOrder(scope, orderId, fields) {
  const patched = [];
  if (!orderId) {
    return { patched: patched, orderId: '' };
  }
  await scope.dao.transaction(async (trx) => {
    const order = await trx.get(COLLECTIONS.ORDERS, orderId);
    if (!order) {
      return;
    }
    const parcel = Object.assign({}, order.parcel || {}, fields, { recognitionSource: 'MANUAL' });
    await trx.update(COLLECTIONS.ORDERS, order._id, {
      parcel: parcel,
      version: (Number(order.version) || 1) + 1,
      updatedAt: scope.nowDate
    });
    Object.keys(fields).forEach(function push(field) {
      patched.push(field);
    });
  });
  return { patched: patched, orderId: orderId };
}

async function findRelatedOrderId(scope, record) {
  if (record.orderId) {
    return record.orderId;
  }
  const order = await scope.dao.findOne(COLLECTIONS.ORDERS, { where: { 'image.failureId': record._id }, limit: 1 });
  return order ? order._id : '';
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const failureNo = normalizeFailureNo(input.failureNo);
  const record = await scope.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo: failureNo } });
  if (!record) {
    throw errors.notFound('复核记录不存在');
  }
  if (record.status === enums.FAILURE_STATUS.IGNORED) {
    throw errors.invalidState('该记录已忽略，不能重复处理');
  }
  if (record.status === enums.FAILURE_STATUS.FIXED) {
    return {
      failureNo: failureNo,
      status: enums.FAILURE_STATUS.FIXED,
      resolution: record.resolution || null,
      orderPatchedFields: [],
      notified: false,
      duplicated: true
    };
  }
  const fields = buildRecognitionFields(input);
  if (Object.keys(fields).length === 0) {
    throw errors.validation('stationId', '请至少补录站点或取件码');
  }
  const resolution = buildResolution(scope, input, fields);
  const orderId = await findRelatedOrderId(scope, record);
  const patched = await patchOrder(scope, orderId, fields);
  await scope.dao.update(COLLECTIONS.RECOGNITION_FAILURES, record._id, {
    status: enums.FAILURE_STATUS.FIXED,
    resolution: resolution,
    orderId: patched.orderId || record.orderId || '',
    reviewedAt: scope.nowDate,
    updatedAt: scope.nowDate
  });
  const notified = input.notifyUploader === true
    ? await review.notifyUploader(scope, Object.assign({}, record, { orderId: patched.orderId || record.orderId }), failureNo)
    : false;
  await scope.writeAudit(
    AUDIT_ACTIONS.FAILURE_FIX,
    { type: 'recognition_failure', id: failureNo },
    {
      failureNo: failureNo,
      fields: patched.patched,
      orderPatched: patched.patched.length > 0,
      notified: notified
    },
    auditKeyOf(ctx)
  );
  return {
    failureNo: failureNo,
    status: enums.FAILURE_STATUS.FIXED,
    resolution: resolution,
    orderPatchedFields: patched.patched,
    notified: notified
  };
}

module.exports = handler;
