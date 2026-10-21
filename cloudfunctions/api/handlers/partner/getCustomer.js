// handlers/partner/getCustomer.js · partner.getCustomer（顾客详情：档案 + 解绑资格）
// 口径：DATA_MODEL §7.4 表格与「批 7 兼职客户与运营（只增不改语义）」②；UX_PARTNER §3.6。
// 页面参数一律 bindingId、不接受也不回传顾客 openid。
// TD-049：本接口不返回 orders（历史订单唯一来源 = order.listPartner({view:'customer'})，页面已如此），
//         也不再回 nextCursor——避免同一数据两个来源/两套游标。
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
  const activeOrderCount = await customer.countActiveOrders(ctx, partner._id, binding.customerId);
  return {
    customer: customer.customerRowOf(binding, profile, activeOrderCount),
    activeOrderCount,
    unbindEligibility: {
      canUnbind: activeOrderCount === 0,
      activeOrderCount
    },
    partnerNo: customer.textOf(partner.partnerNo)
  };
}

module.exports = { handler };
