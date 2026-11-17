// handlers/order/reviewParcels.js · order.reviewParcels（D92：审核中增减件数）
// 口径：CONTRACT §13 D92；仅 SUBMITTED/ACCEPTED 可增减（已取件只读）；1~10 件；已取件的件禁止删除。
// 语义：整值替换 parcels[]（顺序即 itemIndex，删除后服务端自然重排）；事件复用 ORDER_CORRECTED，payload 标 reviewParcels。
'use strict';

const { errors } = require('../../lib/errors');
const common = require('./_common');
const review = require('./_review');

const ACTIONS = { ADD: 'ADD', REMOVE: 'REMOVE' };

function readAction(payload) {
  const value = payload && typeof payload === 'object' ? String(payload.action || '').toUpperCase() : '';
  if (value !== ACTIONS.ADD && value !== ACTIONS.REMOVE) {
    throw errors.validation('action', '请选择增加或删除一件');
  }
  return value;
}

function readIndex(payload) {
  const value = payload && typeof payload === 'object' ? Number(payload.index) : NaN;
  if (!Number.isInteger(value) || value < 0) {
    throw errors.validation('index', '请选择要删除的那一件');
  }
  return value;
}

module.exports = async function orderReviewParcels(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.reviewParcels',
    viewOptions: review.PARTNER_RESPONSE_VIEW,
    guard(input) {
      review.assertParcelsEditable(input.order);
      const action = readAction(input.payload);
      const list = Array.isArray(input.order.parcels) ? input.order.parcels : [];
      const next = action === ACTIONS.ADD
        ? list.concat([review.addedParcelOf(input.order)])
        : review.removedParcelsOf(input.order, readIndex(input.payload));
      return { action: action, beforeCount: list.length, afterCount: next.length, parcels: next };
    },
    build(input) {
      const checked = input.checked;
      return {
        set: { parcels: checked.parcels },
        eventType: 'ORDER_CORRECTED',
        note: checked.action === ACTIONS.ADD ? '审核中新增一件' : '审核中删除一件',
        payload: {
          reviewParcels: {
            action: checked.action,
            beforeCount: checked.beforeCount,
            afterCount: checked.afterCount
          }
        }
      };
    }
  });
};
