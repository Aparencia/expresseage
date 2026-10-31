// handlers/partner/listBindings.js · partner.listBindings（批 7：客户列表，服务端搜索/排序/游标分页）
// 口径：DATA_MODEL §7.4 表格 +「批 7 兼职客户与运营（只增不改语义）」①、§4.5（dormKey 自然序）、
//       §5.2（客户列表：dormKey asc → 同宿舍 allocSeq（=roomTag 大写字母序））、
//       §5.3（游标分页、单次扫描上限）；UX_PARTNER §3.5（搜索锚+编号，客户端不再二次排序）。
// 只列自己 ACTIVE 绑定；avatarFileId/displayName 只在 ACTIVE 绑定期间返回；activeOrderCount 按顾客现算。
// D42（task-20）：本页行头像随 DTO 下发 5 分钟临时 URL（src 优先），一次批量签发；avatarFileId 保留回退。
// TD-050：绑定不再固定 find(limit:100)，改为按 _id 升序分批取全量（每批 ≤100 = §5.2 扫描上限），
//   顾客资料同步按 100/批批量补（不逐顾客 N+1）；activeOrderCount 由 _customer.activeCountByCustomer
//   分页全量扫描。查询预算 = ceil(绑定/100)+1 + ceil(顾客/100) + 5×ceil(进行中/300) + 头像批量 1。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const identity = require('../user/_common');
const customer = require('./_customer');

const BINDING_SCAN_PAGE = customer.MAX_BINDINGS;
const CUSTOMER_IN_BATCH = 100;

// 取自己名下全部 ACTIVE 绑定：_id 升序 + skip 分批（有界批量，突破旧的 100 条硬上限）。
async function loadBindings(ctx, partner) {
  const rows = [];
  for (let skip = 0; ; skip += BINDING_SCAN_PAGE) {
    const part = await ctx.dao.find(COLLECTIONS.BINDINGS, {
      where: { partnerId: partner._id, status: enums.BINDING_STATUS.ACTIVE },
      orderBy: [['_id', 'asc']],
      skip,
      limit: BINDING_SCAN_PAGE
    });
    part.forEach((row) => rows.push(row));
    if (part.length < BINDING_SCAN_PAGE) {
      break;
    }
  }
  return rows;
}

// 批量补顾客资料：_id in 分批 ≤100（一次查询覆盖一批，替代逐顾客 dao.get）。
async function loadProfiles(ctx, ids) {
  const profiles = {};
  for (let i = 0; i < ids.length; i += CUSTOMER_IN_BATCH) {
    const part = await ctx.dao.find(COLLECTIONS.CUSTOMERS, {
      where: { _id: ctx.dao.command('in', ids.slice(i, i + CUSTOMER_IN_BATCH)) }
    });
    part.forEach((doc) => {
      profiles[doc._id] = doc;
    });
  }
  return profiles;
}

// 取全部 ACTIVE 绑定并批量补顾客资料；进行中单一次按状态分组（避免逐顾客 N+1）。
async function loadEntries(ctx, partner) {
  const bindings = await loadBindings(ctx, partner);
  const idSet = new Set();
  bindings.forEach((binding) => {
    if (binding.customerId) {
      idSet.add(binding.customerId);
    }
  });
  const profiles = await loadProfiles(ctx, Array.from(idSet));
  const activeCounts = await customer.activeCountByCustomer(ctx, partner._id);
  return bindings.map((binding) => ({
    row: customer.customerRowOf(
      binding,
      profiles[binding.customerId] || null,
      activeCounts[binding.customerId] || 0
    ),
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
  // 只对本页行签发（≤50 个 fileID 一次批量）；keyword 过滤不依赖头像，避免无谓外呼。
  await customer.signRowsAvatarUrls(ctx, page.map((entry) => entry.row));
  const last = page[page.length - 1];
  return {
    list: page.map((entry) => entry.row),
    nextCursor: candidates.length > limit && last ? customer.bindingCursorOf(last) : null
  };
}

module.exports = { handler };
