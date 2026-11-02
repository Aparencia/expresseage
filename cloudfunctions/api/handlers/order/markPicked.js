// handlers/order/markPicked.js · order.markPicked：兼职标记已取件（D61 可逐件）
// 无 itemIndex = 整单旧行为（要求全部件有取件码或代寄 DROP_OFF；全部件写 pickedAt/pickedByNo、订单 → PICKED、事件 PICKED）。
// 带 itemIndex = 逐件取件：该件写 pickedAt/pickedByNo；全部件取完才聚合转 PICKED（事件 PICKED + lastParcel），
// 否则订单仍 ACCEPTED（显式同状态回写，statusUpdatedAt 仍更新）并记件级事件 PARCEL_PICKED。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const pickedState = require('./_picked');

const STATUS = enums.ORDER_STATUS;

// 代寄（DROP_OFF）无需取件码即可取件（CONTRACT §5.1 / DATA_MODEL §8.3）。
function isDropOff(order) {
  const service = (order && order.service) || {};
  return service.code === enums.DROP_OFF_SERVICE_CODE;
}

function hasPickupCode(parcel) {
  return typeof (parcel && parcel.pickupCode) === 'string' && parcel.pickupCode !== '';
}

function hasEveryCode(order) {
  const parcels = common.orderParcelsOf(order);
  return parcels.length > 0 && parcels.every(hasPickupCode);
}

// 守卫（先于任何写库）：形态闸 itemIndex → 整单码闸 / 逐件存在·未取·有码闸；返回写回所需的件级快照。
// guard 入参没有 nowDate（只有 now 毫秒），件级时间在 guard 内按同一服务端时刻归一（与 build 的 nowDate 同毫秒）。
function checkedOf(input) {
  const nowDate = new Date(input.now);
  const itemIndex = pickedState.readItemIndexOf(input.payload);
  const parcels = pickedState.materializeOf(input.order, nowDate);
  const dropOff = isDropOff(input.order);
  const pickedByNo = pickedState.partnerNoOf(input.order);
  if (itemIndex === null) {
    if (!dropOff && !hasEveryCode(input.order)) {
      throw errors.invalidState('还有包裹没有取件码，请先补录后再标记已取件');
    }
    return { itemIndex, parcels: pickedState.applyAll(parcels, nowDate, pickedByNo) };
  }
  if (itemIndex >= parcels.length) {
    throw errors.validation('itemIndex', '包裹序号不存在，请刷新页面后重试');
  }
  if (pickedState.isPickedOf(input.order, parcels[itemIndex])) {
    throw errors.invalidState('该件已标记取件，无需重复操作');
  }
  if (!dropOff && !hasPickupCode(parcels[itemIndex])) {
    throw errors.invalidState('该件还没有取件码，请先补录后再标记已取件');
  }
  return { itemIndex, parcels: pickedState.applyOne(parcels, itemIndex, nowDate, pickedByNo) };
}

function buildOf(input) {
  const checked = input.checked;
  const set = pickedState.patchOf(input.order, checked.parcels);
  if (checked.itemIndex === null) {
    return {
      set: Object.assign(set, { pickedAt: input.nowDate }),
      toStatus: STATUS.PICKED,
      eventType: 'PICKED',
      payload: {}
    };
  }
  const summary = pickedState.summaryOfParcels(input.order, checked.parcels);
  if (!summary.allPicked) {
    return {
      set,
      toStatus: STATUS.ACCEPTED,
      eventType: 'PARCEL_PICKED',
      payload: { itemIndex: checked.itemIndex }
    };
  }
  // 最后一件取完：订单级 PICKED 由「全部件已取」聚合派生（事件 payload 标 lastParcel 供流水区分）。
  return {
    set: Object.assign(set, { pickedAt: input.nowDate }),
    toStatus: STATUS.PICKED,
    eventType: 'PICKED',
    payload: { itemIndex: checked.itemIndex, lastParcel: true }
  };
}

module.exports = async function orderMarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markPicked',
    acceptsBatchActionId: true,
    guard: checkedOf,
    build: buildOf
  });
};
