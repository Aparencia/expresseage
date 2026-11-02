// handlers/order/unmarkPicked.js · order.unmarkPicked：兼职撤销已取件（D61 可逐件）
// 无 itemIndex = 整单旧行为（仅 PICKED 可整单撤销：清全部件 pickedAt/pickedByNo + 订单 pickedAt，记 PICKED_REVERTED）。
// 带 itemIndex = 撤销该件：订单原 PICKED → 回 ACCEPTED（记 PICKED_REVERTED + 清订单 pickedAt）；
// 订单原 ACCEPTED（部分取件）→ 状态不变（显式同状态回写），记件级事件 PARCEL_PICKED_REVERTED。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const pickedState = require('./_picked');

const STATUS = enums.ORDER_STATUS;

// 守卫（先于任何写库）：形态闸 itemIndex → 整单仅 PICKED / 逐件存在·已取；返回写回所需的件级快照。
// guard 入参没有 nowDate（只有 now 毫秒），旧单派生回退时刻按同一服务端时刻归一。
function checkedOf(input) {
  const nowDate = new Date(input.now);
  const itemIndex = pickedState.readItemIndexOf(input.payload);
  const parcels = pickedState.materializeOf(input.order, nowDate);
  if (itemIndex === null) {
    if (input.order.status !== STATUS.PICKED) {
      throw errors.invalidTransition('仅已取件订单可整单撤销，逐件撤销请在对应包裹上操作');
    }
    return { itemIndex, parcels: pickedState.applyAll(parcels, null, null) };
  }
  if (itemIndex >= parcels.length) {
    throw errors.validation('itemIndex', '包裹序号不存在，请刷新页面后重试');
  }
  if (!pickedState.isPickedOf(input.order, parcels[itemIndex])) {
    throw errors.invalidState('该件尚未标记取件，无法撤销');
  }
  return { itemIndex, parcels: pickedState.applyOne(parcels, itemIndex, null, null) };
}

function buildOf(input) {
  const checked = input.checked;
  const set = pickedState.patchOf(input.order, checked.parcels);
  if (checked.itemIndex === null) {
    const previousAt = input.order.pickedAt || null;
    return {
      set: Object.assign(set, { pickedAt: null }),
      toStatus: STATUS.ACCEPTED,
      eventType: 'PICKED_REVERTED',
      payload: { undoneAction: 'order.markPicked', previousAt: previousAt ? new Date(input.order.pickedAt) : null }
    };
  }
  if (input.order.status === STATUS.PICKED) {
    return {
      set: Object.assign(set, { pickedAt: null }),
      toStatus: STATUS.ACCEPTED,
      eventType: 'PICKED_REVERTED',
      payload: { itemIndex: checked.itemIndex, undoneAction: 'order.markPicked' }
    };
  }
  return {
    set,
    toStatus: STATUS.ACCEPTED,
    eventType: 'PARCEL_PICKED_REVERTED',
    payload: { itemIndex: checked.itemIndex }
  };
}

module.exports = async function orderUnmarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.unmarkPicked',
    guard: checkedOf,
    build: buildOf
  });
};
