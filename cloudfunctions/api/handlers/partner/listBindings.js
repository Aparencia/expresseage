// handlers/partner/listBindings.js · partner.listBindings（批 7：客户列表，服务端搜索/排序/游标分页）
// 口径：DATA_MODEL §7.4 表格 +「批 7 兼职客户与运营（只增不改语义）」①、§4.5（dormKey 自然序）、
//       §5.2（客户列表：dormKey asc → 同宿舍 allocSeq（=roomTag 大写字母序）、批量取 customers ≤100）、
//       §5.3（游标分页、单次扫描上限）；UX_PARTNER §3.5（搜索锚+编号，客户端不再二次排序）。
// 只列自己 ACTIVE 绑定；avatarFileId/displayName 只在 ACTIVE 绑定期间返回；activeOrderCount 按顾客现算。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const identity = require('../user/_common');
const customer = require('./_customer');

// 取自己名下 ACTIVE 绑定并批量补顾客资料；进行中单一次按状态分组（避免逐顾客 N+1）。
async function loadEntries(ctx, partner) {
  const bindings = await ctx.dao.find(COLLECTIONS.BINDINGS, {
    where: { partnerId: partner._id, status: enums.BINDING_STATUS.ACTIVE },
    limit: customer.MAX_BINDINGS
  });
  const profiles = await Promise.all(bindings.map((binding) => identity.loadCustomer(ctx, binding.customerId)));
  const activeCounts = await customer.activeCountByCustomer(ctx, partner._id);
  return bindings.map((binding, index) => ({
    row: customer.customerRowOf(binding, profiles[index], activeCounts[binding.customerId] || 0),
    allocSeq: customer.allocSeqOf(binding)
  }));
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const limit = customer.parseLimit(input);
  const keyword = customer.readKeyword(input.keyword);
  const cursor = customer.parseBindingCursor(input.cursor);
  const entries = await loadEntries(ctx, partner);
  const candidates = entries
    .filter((entry) => customer.matchKeyword(entry.row, keyword))
    .filter((entry) => customer.isAfterBindingCursor(entry, cursor))
    .sort(customer.compareBindingEntries);
  const page = candidates.slice(0, limit);
  const last = page[page.length - 1];
  return {
    list: page.map((entry) => entry.row),
    nextCursor: candidates.length > limit && last ? customer.bindingCursorOf(last) : null
  };
}

module.exports = { handler };
