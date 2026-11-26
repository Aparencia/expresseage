// handlers/order/markDelivered.js · order.markDelivered：兼职标记已送达 PICKED → DELIVERED（备注 ≤100）
// D91：当日已到自动完成时刻（默认 22:30，UTC+8）→ 送达即完成（同一事务再写 COMPLETED + AUTO_COMPLETED），
//      不再等 10 分钟日结批；未到时刻行为不变（DELIVERED，等当天该时刻批次）。
// D97（2026-11-23）：送达可附 1 张现场照片（PROOF 票据）→ 写 orders.deliveryProof 并在同一事务消费票据。
// D102（2026-11-26 用户指令）：送达照片改为**可选**——带票据则校验并落库；不带 = 跳过、不阻断送达。
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');
const autoComplete = require('./_auto-complete');
const proof = require('./_proof');

// D85：转派发起人仍可送达——照片/pickedBy 的归属用「实际操作人」编号，不用订单当前 partnerNo（接手人）。
function actorPartnerNoOf(input) {
  const actor = input && input.partner && typeof input.partner.partnerNo === 'string'
    ? input.partner.partnerNo : '';
  return actor || (input && input.order && typeof input.order.partnerNo === 'string' ? input.order.partnerNo : '');
}

async function guardOf(input) {
  const result = common.passOrThrow(
    common.validate.validateDeliveryNote(input.payload.deliveryNote)
  );
  const photo = await proof.readOptional(input.ctx, {
    ticket: input.payload.deliveryPhotoTicket,
    fileId: input.payload.deliveryPhotoFileId
  });
  return { deliveryNote: result.value, photo };
}

function buildOf(input) {
  const checked = input.checked;
  const eventPayload = {};
  if (checked.deliveryNote) {
    eventPayload.deliveryNote = checked.deliveryNote;
  }
  const proofOf = checked.photo && checked.photo.ticket
    ? proof.proofOf(checked.photo, actorPartnerNoOf(input), input.nowDate) : null;
  if (proofOf) {
    eventPayload.hasPhoto = true;
  }
  return {
    set: {
      deliveredAt: input.nowDate,
      deliveryNote: checked.deliveryNote,
      deliveryProof: proofOf
    },
    toStatus: enums.ORDER_STATUS.DELIVERED,
    eventType: 'DELIVERED',
    note: checked.deliveryNote,
    payload: eventPayload,
    proofTicket: checked.photo.ticket
  };
}

// 事务内先消费票据（并发/重放 0 行 → CONFLICT 整笔回滚），再走「送达即完成」（D91）。
async function afterOf(params) {
  await proof.consume(params.trx, params.built.proofTicket, params.nowDate);
  return autoComplete.completeOnDelivery(params);
}

module.exports = async function orderMarkDelivered(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.markDelivered',
    acceptsBatchActionId: true,
    guard: guardOf,
    build: buildOf,
    after: afterOf
  });
};
