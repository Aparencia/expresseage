// handlers/order/markPicked.js · order.markPicked：兼职标记已取件（D61 可逐件；D98 可选现场照片）
// 无 itemIndex = 整单旧行为（要求全部件有取件码或代寄 DROP_OFF；全部件写 pickedAt/pickedByNo、订单 → PICKED、事件 PICKED）。
// 带 itemIndex = 逐件取件：该件写 pickedAt/pickedByNo；全部件取完才聚合转 PICKED（事件 PICKED + lastParcel），
// 否则订单仍 ACCEPTED（显式同状态回写，statusUpdatedAt 仍更新）并记件级事件 PARCEL_PICKED。
// D98（2026-11-23）照片可选：带 pickPhotoTicket+pickPhotoFileId 则校验并写 pickProof（整单 orders / 逐件 parcels[i]），
// 不带 = 跳过、不阻断；撤销取件保留照片，重取覆盖。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const pickedState = require('./_picked');
const proof = require('./_proof');

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

// D85：转派发起人仍可操作——件级 pickedByNo / 照片 byPartnerNo 用「实际操作人」编号，
// 不用订单当前 partnerNo（接手人）；非转派场景两者相同。
function actorPartnerNoOf(input) {
  const actor = input && input.partner && typeof input.partner.partnerNo === 'string'
    ? input.partner.partnerNo : '';
  return actor || pickedState.partnerNoOf(input && input.order);
}

// 守卫（先于任何写库）：形态闸 itemIndex → 整单码闸 / 逐件存在·未取·有码闸；照片票据可选（D98）。
async function checkedOf(input) {
  const nowDate = new Date(input.now);
  const itemIndex = pickedState.readItemIndexOf(input.payload);
  const parcels = pickedState.materializeOf(input.order, nowDate);
  const dropOff = isDropOff(input.order);
  const pickedByNo = actorPartnerNoOf(input);
  const photo = await proof.readOptional(input.ctx, {
    ticket: input.payload.pickPhotoTicket,
    fileId: input.payload.pickPhotoFileId,
    ticketField: 'pickPhotoTicket',
    fileField: 'pickPhotoFileId'
  });
  if (itemIndex === null) {
    if (!dropOff && !hasEveryCode(input.order)) {
      throw errors.invalidState('还有包裹没有取件码，请先补录后再标记已取件');
    }
    return { itemIndex, parcels: pickedState.applyAll(parcels, nowDate, pickedByNo), photo };
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
  return { itemIndex, parcels: pickedState.applyOne(parcels, itemIndex, nowDate, pickedByNo), photo };
}

function buildOf(input) {
  const checked = input.checked;
  const photoOf = checked.photo && checked.photo.ticket
    ? proof.proofOf(checked.photo, actorPartnerNoOf(input), input.nowDate) : null;
  let parcels = checked.parcels;
  let set = null;
  if (photoOf && checked.itemIndex !== null) {
    parcels = parcels.map((parcel, index) => (
      index === checked.itemIndex ? Object.assign({}, parcel, { pickProof: photoOf }) : parcel
    ));
  }
  set = pickedState.patchOf(input.order, parcels);
  // 事件只标「有照片」，不落 fileId；跳过的单不增加 payload 键（保持既有事件形状）
  const eventPayload = photoOf ? { hasPhoto: true } : {};
  if (photoOf && checked.itemIndex === null) {
    set.pickProof = photoOf;
  }
  if (checked.itemIndex === null) {
    return {
      set: Object.assign(set, { pickedAt: input.nowDate }),
      toStatus: STATUS.PICKED,
      eventType: 'PICKED',
      payload: eventPayload,
      proofTicket: checked.photo.ticket
    };
  }
  const summary = pickedState.summaryOfParcels(input.order, parcels);
  if (!summary.allPicked) {
    return {
      set,
      toStatus: STATUS.ACCEPTED,
      eventType: 'PARCEL_PICKED',
      payload: Object.assign({ itemIndex: checked.itemIndex }, eventPayload),
      proofTicket: checked.photo.ticket
    };
  }
  return {
    set: Object.assign(set, { pickedAt: input.nowDate }),
    toStatus: STATUS.PICKED,
    eventType: 'PICKED',
    payload: Object.assign({ itemIndex: checked.itemIndex, lastParcel: true }, eventPayload),
    proofTicket: checked.photo.ticket
  };
}

// 事务内消费照片票据（跳过的单 ticket=null → 空操作）
async function afterOf(params) {
  await proof.consume(params.trx, params.built.proofTicket, params.nowDate);
}

module.exports = async function orderMarkPicked(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markPicked',
    acceptsBatchActionId: true,
    guard: checkedOf,
    build: buildOf,
    after: afterOf
  });
};
