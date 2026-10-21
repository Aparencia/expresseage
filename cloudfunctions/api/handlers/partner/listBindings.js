// handlers/partner/listBindings.js · partner.listBindings（兼职客户档案：仅自己 ACTIVE 绑定）
// 口径：DATA_MODEL §2.4/§5.2/§7.4（按 dormKey asc、同 dormKey 再按 allocSeq=绑定先后；roomTag 大写展示）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const identity = require('../user/_common');
const bindCommon = require('../bind/_common');

const MAX_BINDINGS = 100;

async function handler(ctx) {
  const { partner } = await identity.requireActivePartner(ctx);
  const bindings = await ctx.dao.find(COLLECTIONS.BINDINGS, {
    where: { partnerId: partner._id, status: enums.BINDING_STATUS.ACTIVE },
    orderBy: [['dormKey', 'asc'], ['allocSeq', 'asc']],
    limit: MAX_BINDINGS
  });
  const customers = await Promise.all(bindings.map((binding) => identity.loadCustomer(ctx, binding.customerId)));
  const activeCounts = {};
  for (let i = 0; i < enums.ORDER_ACTIVE_STATUSES.length; i += 1) {
    const status = enums.ORDER_ACTIVE_STATUSES[i];
    const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
      where: { partnerId: partner._id, status },
      limit: MAX_BINDINGS
    });
    rows.forEach((row) => {
      const key = row.customerId || '';
      activeCounts[key] = (activeCounts[key] || 0) + 1;
    });
  }
  const list = bindings.map((binding, index) => bindCommon.partnerBindingRow(
    binding,
    customers[index],
    activeCounts[binding.customerId] || 0
  ));
  return { list, nextCursor: null };
}

module.exports = { handler };
