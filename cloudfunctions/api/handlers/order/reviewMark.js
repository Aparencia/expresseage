// handlers/order/reviewMark.js · order.reviewMark（D92：订单级「已审核」标记）
// 口径：CONTRACT §13 D92；审核不改订单状态（to:'SAME'），只写 orders.review + ORDER_CORRECTED 事件（payload.reviewStatus）。
'use strict';

const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const review = require('./_review');

module.exports = async function orderReviewMark(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.reviewMark',
    // 写响应按兼职侧下发 review 块（页面用写响应重绘，不能依赖二次 order.get）
    viewOptions: review.PARTNER_RESPONSE_VIEW,
    guard(input) {
      review.assertReviewable(input.order);
      if (review.isReviewed(input.order)) {
        throw errors.invalidState('这单已经审核过了');
      }
      return {};
    },
    build(input) {
      return {
        set: {
          review: {
            status: orderState.REVIEW_STATUS.REVIEWED,
            at: input.nowDate,
            byPartnerNo: String((input.order && input.order.partnerNo) || '')
          }
        },
        eventType: 'ORDER_CORRECTED',
        note: '已标记审核',
        payload: { reviewStatus: orderState.REVIEW_STATUS.REVIEWED }
      };
    }
  });
};
