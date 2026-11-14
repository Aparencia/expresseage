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

function buildRecognitionFields(input, config) {
  const fields = {};
  const stationId = readTrimmedText(input.stationId, 8);
  const stationName = readTrimmedText(input.stationName, 40);
  if (stationId || stationName) {
    // D32：站点正式名可被后台改，校验/回填都用当前配置表（缺省=内置默认）
    const options = typeof stations.stationsFromConfig === 'function'
      ? { stations: stations.stationsFromConfig(config) }
      : {};
    const check = stations.validateStation(stationId, stationName, options);
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
  const noteResult = sharedValidate.validateText(input.note, sharedValidate.TEXT_LIMITS.failureNote, 'note', false);
  assertValid(noteResult, '备注最多 100 字');
  return {
    stationId: fields.stationId || '',
    stationName: fields.stationName || '',
    pickupCode: fields.pickupCode || '',
    note: noteResult.value || '',
    // 批 39（D83）：复核归因（可选枚举；空串=未填）
    rootCause: review.normalizeRootCause(input.rootCause, errors),
    by: scope.developerNo,
    at: scope.nowDate
  };
}

// 复核补录只允许在「订单尚未取件」的状态下进行（与 order.correct 的站点/码可改状态同口径）；
// 已取件/已送达/已完成/已取消只能走「忽略」写备注——避免改动已履约记录。
const PATCHABLE_STATUS = [
  enums.ORDER_STATUS.SUBMITTED,
  enums.ORDER_STATUS.ACCEPTED,
  enums.ORDER_STATUS.EXCEPTION
];

function isEmptyOf(value) {
  return value === undefined || value === null || value === '';
}

// 复核是「修正识别错误」：识别来源（RULE/DEEPSEEK/空）可改写为复核值；
// **用户/兼职手填（recognitionSource=MANUAL）不可覆盖**——只补它的空位，避免改掉人填的数。
function patchFieldsOf(source, fields, allowOverwrite) {
  const patch = {};
  Object.keys(fields).forEach((key) => {
    if (allowOverwrite || isEmptyOf(source && source[key])) {
      patch[key] = fields[key];
    }
  });
  return Object.keys(patch).length > 0 ? patch : null;
}

// 单件是否允许复核覆盖：手填来源（MANUAL）只补空；其余（规则/AI/缺省）允许纠正
function canOverwriteOf(parcel) {
  return parcel.recognitionSource !== 'MANUAL';
}

function matchesRecordOf(parcel, recordId, itemIndex, index) {
  const byFailure = recordId !== '' && parcel.failureId === recordId;
  const byIndex = Number.isInteger(itemIndex) && itemIndex >= 0 && index === itemIndex;
  return byFailure || byIndex;
}

// v1.0（D23 逐件）：按 failureId 命中本记录的件补录；记录带 `itemIndex†`（DATA_MODEL §2.14，未建单 -1）时
// 一并按序号定位（两个定位任一命中即回填，兼容入队时尚未回填 failureId 的场次）。
// 返回 null 表示订单里没有本记录的关联件 —— 不回填（避免把码写到错误的件上）。
function patchedParcelsOf(order, record, fields) {
  const list = Array.isArray(order.parcels) ? order.parcels : null;
  if (!list) {
    return null;
  }
  const recordId = String((record && record._id) || '');
  const itemIndex = Number(record && record.itemIndex);
  let patch = null;
  const next = list.map((parcel, index) => {
    if (!parcel || typeof parcel !== 'object' || !matchesRecordOf(parcel, recordId, itemIndex, index)) {
      return parcel;
    }
    const found = patchFieldsOf(parcel, fields, canOverwriteOf(parcel));
    if (!found) {
      return parcel;
    }
    patch = patch || {};
    Object.keys(found).forEach((key) => { patch[key] = found[key]; });
    return Object.assign({}, parcel, found, { recognitionSource: 'MANUAL' });
  });
  return patch ? { next: next, patch: patch } : { next: null, patch: null };
}

async function patchOrder(scope, orderId, record, fields) {
  const patched = [];
  if (!orderId) {
    return { patched: patched, orderId: '' };
  }
  await scope.dao.transaction(async (trx) => {
    const order = await trx.get(COLLECTIONS.ORDERS, orderId);
    if (!order) {
      return;
    }
    if (PATCHABLE_STATUS.indexOf(order.status) < 0) {
      throw errors.invalidState('订单已取件或已结束，不能再改站点/取件码；如需说明请在「忽略」里写备注');
    }
    const matched = patchedParcelsOf(order, record || {}, fields);
    if (!matched && (!order.parcel || typeof order.parcel !== 'object')) {
      throw errors.validation('pickupCode', '订单没有可回填的包裹信息，请改用「忽略」并说明');
    }
    const patch = matched ? matched.patch : patchFieldsOf(order.parcel, fields, order.manualEntry !== true);
    if (!patch) {
      throw errors.validation('pickupCode', matched
        ? '未找到该记录对应的包裹（可能已删除或合并），请刷新后重试'
        : '该件是用户手填，复核不能覆盖；如需更正请让兼职改码');
    }
    const data = {
      version: (Number(order.version) || 1) + 1,
      updatedAt: scope.nowDate
    };
    if (matched) {
      data.parcels = matched.next;
    } else {
      data.parcel = Object.assign({}, order.parcel, patch, { recognitionSource: 'MANUAL' });
    }
    await trx.update(COLLECTIONS.ORDERS, order._id, data);
    Object.keys(patch).forEach(function push(field) {
      patched.push(field);
    });
  });
  return { patched: patched, orderId: orderId };
}

async function findRelatedOrderId(scope, record) {
  if (record.orderId) {
    return record.orderId;
  }
  const recordId = String(record._id || '');
  if (!recordId) {
    return '';
  }
  // 历史单单图 image.failureId；v1.0 逐件 parcels[].failureId / 逐图 images[].failureId（数组点查仅真库支持）
  const fields = ['image.failureId', 'parcels.failureId', 'images.failureId'];
  for (let i = 0; i < fields.length; i += 1) {
    const where = {};
    where[fields[i]] = recordId;
    const order = await scope.dao.findOne(COLLECTIONS.ORDERS, { where: where, limit: 1 });
    if (order) {
      return order._id;
    }
  }
  return '';
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
  const fields = buildRecognitionFields(input, scope.config);
  if (Object.keys(fields).length === 0) {
    throw errors.validation('stationId', '请至少补录站点或取件码');
  }
  const resolution = buildResolution(scope, input, fields);
  const orderId = await findRelatedOrderId(scope, record);
  const patched = await patchOrder(scope, orderId, record, fields);
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
      orderPatched: patched.patched.length > 0, rootCause: resolution.rootCause || '',
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
