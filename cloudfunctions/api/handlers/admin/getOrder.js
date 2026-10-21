// handlers/admin/getOrder.js · admin.getOrder（脱敏订单详情 + 裁剪时间线；测试单需 includeTest）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  errors,
  createAdminScope,
  normalizeOrderNoInput,
  getOrderByNo,
  getCustomerById,
  getPartnerById
} = require('./_common');
const dto = require('./_dto');

const EVENT_LIMIT = 100;

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const orderNo = normalizeOrderNoInput(input.orderNo);
  const order = await getOrderByNo(scope, orderNo);
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  if (order.isTest === true && input.includeTest !== true) {
    throw errors.notFound('订单不存在或不可查看');
  }
  const customer = order.customerId ? await getCustomerById(scope, order.customerId) : null;
  const partner = order.partnerId ? await getPartnerById(scope, order.partnerId) : null;
  const events = await scope.dao.find(COLLECTIONS.ORDER_EVENTS, {
    where: { orderId: order._id },
    orderBy: [['at', 'asc']],
    limit: EVENT_LIMIT
  });
  return {
    order: dto.orderDetail(order, {
      customerDisplayName: customer ? customer.displayName : '',
      partnerDisplayName: partner ? partner.displayName : '',
      guestDisplayName: order.guest && order.guest.displayName ? order.guest.displayName : ''
    }),
    events: events.map(dto.eventBrief)
  };
}

module.exports = handler;
