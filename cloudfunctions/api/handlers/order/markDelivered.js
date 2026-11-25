// handlers/order/markDelivered.js · order.markDelivered：兼职标记已送达 PICKED → DELIVERED（备注 ≤100）
// D91：当日已到自动完成时刻（默认 22:30，UTC+8）→ 送达即完成（同一事务再写 COMPLETED + AUTO_COMPLETED），
//      不再等 10 分钟日结批；未到时刻行为不变（DELIVERED，等当天该时刻批次）。
// D97（2026-11-23）：送达必须附 1 张现场照片（PROOF 票据）→ 写 orders.deliveryProof 并在同一事务消费票据。
'use strict';

const enums = require('../../shared/enums');
const common = require('./_common');
const autoComplete = require('./_auto-complete');
const proof = require('./_proof');

async function guardOf(input) {
  const result = common.passOrThrow(
    common.validate.validateDeliveryNote(input.payload.deliveryNote)
  );
  const photo = await proof.readRequired(input.ctx, {
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
  if (checked.photo.ticket) {
    eventPayload.hasPhoto = true;
  }
  return {
    set: {
      deliveredAt: input.nowDate,
      deliveryNote: checked.deliveryNote,
      deliveryProof: proof.proofOf(checked.photo, input.order.partnerNo, input.nowDate)
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
