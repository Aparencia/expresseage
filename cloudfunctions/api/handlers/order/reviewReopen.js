// handlers/order/reviewReopen.js · order.reviewReopen（D92：撤销审核，回到「未审核」重审）
// 口径：CONTRACT §13 D92；允许在 SUBMITTED/ACCEPTED/PICKED 撤销（只是标记回退，不改订单状态）。
'use strict';

const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const review = require('./_review');

module.exports = async function orderReviewReopen(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.reviewReopen',
    viewOptions: review.PARTNER_RESPONSE_VIEW,
    guard(input) {
      review.assertReviewable(input.order);
      if (!review.isReviewed(input.order)) {
        throw errors.invalidState('这单还没审核，不需要撤销');
      }
      return {};
    },
    build(input) {
      return {
        set: {
          review: {
            status: orderState.REVIEW_STATUS.UNREVIEWED,
            at: null,
            byPartnerNo: ''
          }
        },
        eventType: 'ORDER_CORRECTED',
        note: '已撤销审核',
        payload: { reviewStatus: orderState.REVIEW_STATUS.UNREVIEWED }
      };
    }
  });
};
