// handlers/order/correct.js · order.correct：兼职改码/改站点/改柜号/改运单尾号（不改归属、不改状态）
// 允许状态：SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅 lockerNo/trackingTail（CONTRACT §5.1）。
// v1.0 一单多包裹（D23）：按 itemIndex 逐包裹纠正（缺省 0；越界 VALIDATION_FAILED），不设包裹级状态。
// 识别来源：任何手改都记 MANUAL、confidence 清空（DATA_MODEL §4.9）；补码 NEED_CODE→OK 记 codeStatusChanged，
// 并在事件 note 落「兼职已补齐取件码」供流水分辨（其它更正留下空串，客户端有通用文案）。
'use strict';

const enums = require('../../shared/enums');
const stations = require('../../shared/stations');
const { errors } = require('../../lib/errors');
const common = require('./_common');

const PICKED_ALLOWED_FIELDS = ['lockerNo', 'trackingTail'];
const CODE_FILLED_NOTE = '兼职已补齐取件码';

// 逐包裹纠正的包裹序号：缺省 0；负数/小数/字符串一律 VALIDATION_FAILED（不静默改第 0 件）
function readItemIndex(payload) {
  const value = payload && typeof payload === 'object' ? payload.itemIndex : undefined;
  if (value === undefined || value === null) {
    return 0;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw errors.validation('itemIndex', '包裹序号不正确，请刷新页面后重试');
  }
  return num;
}

// 包裹数组副本（新订单 parcels[]；历史单 parcel{} → 单元素数组，按原形态写回）
function parcelListOf(order) {
  return common.orderParcelsOf(order).map((parcel) => Object.assign({}, parcel && typeof parcel === 'object' ? parcel : {}));
}

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

// 逐字段改动（站点/取件码/柜号/运单尾号）：返回本次实际改动的字段名列表（空 = 无有效字段）
function applyParcelPatch(patch, nextParcel) {
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
  return correctedFields;
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
  const itemIndex = readItemIndex(input.payload);
  const parcels = parcelListOf(input.order);
  if (itemIndex >= parcels.length) {
    throw errors.validation('itemIndex', '包裹序号不存在，请刷新页面后重试');
  }
  const beforeParcel = Object.assign({}, parcels[itemIndex]);
  const nextParcel = parcels[itemIndex];
  const correctedFields = applyParcelPatch(patch, nextParcel);
  if (correctedFields.length === 0) {
    throw errors.validation('patch', '请至少修改一个有效字段');
  }
  nextParcel.recognitionSource = enums.RECOGNITION_SOURCE.MANUAL;
  nextParcel.confidence = '';
  return {
    parcels,
    itemIndex,
    beforeParcel,
    correctedFields,
    codeStatusChanged: beforeParcel.codeStatus === enums.CODE_STATUS.NEED_CODE
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
    acceptsBatchActionId: true,
    guard(input) {
      return applyPatch(input);
    },
    build(input) {
      const checked = input.checked;
      // 新订单写 parcels[]（整值替换）；历史单仍写单包裹 parcel{}，避免把兼容形态改成混合态
      const set = Array.isArray(input.order.parcels)
        ? { parcels: checked.parcels }
        : { parcel: checked.parcels[checked.itemIndex] };
      const eventPayload = {
        itemIndex: checked.itemIndex,
        before: snapshotOf(checked.beforeParcel),
        after: snapshotOf(checked.parcels[checked.itemIndex])
      };
      if (checked.codeStatusChanged) {
        eventPayload.codeStatusChanged = true;
      }
      return {
        set,
        eventType: 'ORDER_CORRECTED',
        note: checked.codeStatusChanged ? CODE_FILLED_NOTE : '',
        payload: eventPayload,
        correctedFields: checked.correctedFields,
        itemIndex: checked.itemIndex
      };
    },
    extraResult(input) {
      return {
        correctedFields: input.built.correctedFields || [],
        itemIndex: input.built.itemIndex
      };
    }
  });
};
