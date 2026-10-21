// handlers/order/correct.js · order.correct：兼职改码/改站点/改柜号/改运单尾号（不改归属、不改状态）
// 允许状态：SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅 lockerNo/trackingTail（CONTRACT §5.1）。
// 识别来源：任何手改都记 MANUAL、confidence 清空（DATA_MODEL §4.9）；补码 NEED_CODE→OK 记 codeStatusChanged。
'use strict';

const enums = require('../../shared/enums');
const stations = require('../../shared/stations');
const { errors } = require('../../lib/errors');
const common = require('./_common');

const PICKED_ALLOWED_FIELDS = ['lockerNo', 'trackingTail'];

function applyStationPatch(patch, nextParcel) {
  const stationId = typeof patch.stationId === 'string' ? patch.stationId.trim().toUpperCase() : '';
  if (stationId !== '') {
    if (!stations.isStationId(stationId)) {
      throw errors.validation('stationId', '驿站站点不在可选范围内，请重新选择');
    }
    nextParcel.stationId = stationId;
    nextParcel.stationName = stations.stationNameOf(stationId);
    return true;
  }
  const stationName = typeof patch.stationName === 'string' ? patch.stationName.trim() : '';
  if (stationName !== '') {
    const normalized = stations.normalizeStation(stationName);
    if (!normalized.ok) {
      throw errors.validation('stationId', '驿站站点不在可选范围内，请重新选择');
    }
    nextParcel.stationId = normalized.id;
    nextParcel.stationName = normalized.name;
    return true;
  }
  return false;
}

function applyPatch(input) {
  const patch = input.payload.patch;
  if (!common.isPlainObject(patch)) {
    throw errors.validation('patch', '请填写要修改的字段');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw errors.validation('patch', '请至少修改一个字段');
  }
  if (input.order.status === enums.ORDER_STATUS.PICKED) {
    const illegal = keys.filter((key) => PICKED_ALLOWED_FIELDS.indexOf(key) < 0);
    if (illegal.length > 0) {
      throw errors.invalidTransition('已取件后只允许修改柜号或运单尾号');
    }
  }
  const nextParcel = Object.assign({}, input.order.parcel || {});
  const correctedFields = [];
  if (patch.stationId !== undefined || patch.stationName !== undefined) {
    if (applyStationPatch(patch, nextParcel)) {
      correctedFields.push('stationId');
    }
  }
  if (patch.pickupCode !== undefined) {
    const result = common.passOrThrow(common.validate.validatePickupCode(patch.pickupCode));
    nextParcel.pickupCode = result.value;
    nextParcel.codeStatus = result.value === ''
      ? enums.CODE_STATUS.NEED_CODE
      : enums.CODE_STATUS.OK;
    correctedFields.push('pickupCode');
  }
  if (patch.lockerNo !== undefined) {
    const result = common.passOrThrow(common.validate.validateLockerNo(patch.lockerNo));
    nextParcel.lockerNo = result.value;
    correctedFields.push('lockerNo');
  }
  if (patch.trackingTail !== undefined) {
    const result = common.passOrThrow(common.validate.validateTrackingTail(patch.trackingTail));
    nextParcel.trackingTail = result.value;
    correctedFields.push('trackingTail');
  }
  if (correctedFields.length === 0) {
    throw errors.validation('patch', '请至少修改一个有效字段');
  }
  nextParcel.recognitionSource = enums.RECOGNITION_SOURCE.MANUAL;
  nextParcel.confidence = '';
  const beforeStatus = (input.order.parcel || {}).codeStatus;
  return {
    parcel: nextParcel,
    correctedFields,
    codeStatusChanged: beforeStatus === enums.CODE_STATUS.NEED_CODE
      && nextParcel.codeStatus === enums.CODE_STATUS.OK
  };
}

function snapshotOf(parcel) {
  const source = parcel || {};
  return {
    stationId: typeof source.stationId === 'string' ? source.stationId : '',
    pickupCode: typeof source.pickupCode === 'string' ? source.pickupCode : '',
    lockerNo: typeof source.lockerNo === 'string' ? source.lockerNo : '',
    trackingTail: typeof source.trackingTail === 'string' ? source.trackingTail : ''
  };
}

module.exports = async function orderCorrect(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.correct',
    guard(input) {
      return applyPatch(input);
    },
    build(input) {
      const eventPayload = {
        before: snapshotOf(input.order.parcel),
        after: snapshotOf(input.checked.parcel)
      };
      if (input.checked.codeStatusChanged) {
        eventPayload.codeStatusChanged = true;
      }
      return {
        set: { parcel: input.checked.parcel },
        eventType: 'ORDER_CORRECTED',
        payload: eventPayload,
        correctedFields: input.checked.correctedFields
      };
    },
    extraResult(input) {
      return { correctedFields: input.built.correctedFields || [] };
    }
  });
};
