// handlers/partner/getCustomer.js · partner.getCustomer（顾客详情：档案 + 该顾客订单分页 + 解绑资格）
// 口径：DATA_MODEL §7.4 表格与「批 7 兼职客户与运营（只增不改语义）」②；UX_PARTNER §3.6。
// 页面参数一律 bindingId、不接受也不回传顾客 openid；订单行只含 orderNo/status/statusText/serviceName/时间戳。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const customer = require('./_customer');

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const binding = await customer.requireOwnedBinding(ctx, partner, input.bindingId);
  if (binding.status !== enums.BINDING_STATUS.ACTIVE) {
    throw errors.invalidState('该顾客已解除绑定，历史订单可在订单列表中查看');
  }
  const profile = await identity.loadCustomer(ctx, binding.customerId);
  if (!profile) {
    throw errors.forbidden('绑定关系不存在或不属于你');
  }
  const limit = customer.parseLimit(input);
  const cursor = customer.parseOrderCursor(input.cursor);
  const fromMs = customer.parseTimeBound(input.from, 'from');
  const toMs = customer.parseTimeBound(input.to, 'to');
  const activeOrderCount = await customer.countActiveOrders(ctx, partner._id, binding.customerId);
  const rows = await customer.loadCustomerOrders(ctx, partner._id, binding.customerId);
  const candidates = rows
    .filter((order) => customer.inTimeRange(customer.orderAnchorMs(order), fromMs, toMs))
    .filter((order) => customer.isAfterOrderCursor(order, cursor))
    .sort(customer.compareOrderRowsDesc);
  const page = candidates.slice(0, limit);
  const last = page[page.length - 1];
  return {
    customer: customer.customerRowOf(binding, profile, activeOrderCount),
    orders: page.map(customer.orderRowOf),
    nextCursor: candidates.length > limit && last ? customer.orderCursorOf(last) : null,
    activeOrderCount,
    unbindEligibility: {
      canUnbind: activeOrderCount === 0,
      activeOrderCount
    },
    partnerNo: customer.textOf(partner.partnerNo)
  };
}

module.exports = { handler };
