// handlers/partner/listBindings.js · partner.listBindings（批 7：客户列表，服务端搜索/排序/游标分页）
// 口径：DATA_MODEL §7.4 表格 +「批 7 兼职客户与运营（只增不改语义）」①、§4.5（dormKey 自然序）、
//       §5.2（客户列表：dormKey asc → 同宿舍 allocSeq（=roomTag 大写字母序））、
//       §5.3（游标分页、单次扫描上限）；UX_PARTNER §3.5（搜索锚+编号，客户端不再二次排序）。
// 只列自己 ACTIVE 绑定；avatarFileId/displayName 只在 ACTIVE 绑定期间返回；activeOrderCount 按顾客现算。
// D42（task-20）：本页行头像随 DTO 下发 5 分钟临时 URL（src 优先），一次批量签发；avatarFileId 保留回退。
// 批20-C：① 空 dormKey（顾客资料未完善）恒置底，游标同步（空桶后置后分页不重不漏）；
//   ② activeOrderCount 只对「本页」≤limit 个顾客统计（_customer.activeCountsOfPage，最多 5 次查询）。
// TD-050：绑定不再固定 find(limit:100)，改为按 _id 升序分批取全量（每批 ≤100 = §5.2 扫描上限），
//   顾客资料同步按 100/批批量补（不逐顾客 N+1）。
// D67（批 24）：只增可选入参 zone/buildingNo/profileIncomplete/hasNote（筛选链 = keyword → D67 → cursor）；
//   筛选在内存完成、无需新索引/新查询；过滤后再判定 nextCursor，分页不重不漏。
//   查询预算 = ceil(绑定/100)+1 + ceil(顾客/100) + 5（本页进行中单） + 头像批量 1（D67 不增加）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const identity = require('../user/_common');
const customer = require('./_customer');
const customerList = require('./_customer-list');

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

// 取全部 ACTIVE 绑定并批量补顾客资料（进行中单计数推迟到分页后，只算本页顾客：批20-C）。
async function loadEntries(ctx, partner) {
  const bindings = await loadBindings(ctx, partner);
  const idSet = new Set();
  bindings.forEach((binding) => {
    if (binding.customerId) {
      idSet.add(binding.customerId);
    }
  });
  const profiles = await loadProfiles(ctx, Array.from(idSet));
  return bindings.map((binding) => ({
    customerId: customer.textOf(binding.customerId),
    // 分页前先按 0 建行（排序/关键词/D67 筛选只用档案字段），本页确定后再回填真实计数
    row: customer.customerRowOf(binding, profiles[binding.customerId] || null, 0),
    allocSeq: customerList.allocSeqOf(binding)
  }));
}

// 批20-C：只统计本页顾客的进行中单（≤5 次查询），回填到行 DTO。计数是展示型字段，不参与判权/判状态。
async function attachActiveCounts(ctx, partner, page) {
  const ids = page.map((entry) => entry.customerId).filter((id) => id !== '');
  const counts = await customer.activeCountsOfPage(ctx, partner._id, ids);
  page.forEach((entry) => {
    entry.row.activeOrderCount = counts[entry.customerId] || 0;
  });
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const limit = customerList.parseLimit(input);
  const keyword = customerList.readKeyword(input.keyword);
  // D67：筛选入参非法值静默归一为「不筛」（_customer-list.readFilters 注释），不影响 keyword/cursor 的严格校验。
  const filters = customerList.readFilters(input);
  const cursor = customerList.parseBindingCursor(input.cursor);
  const entries = await loadEntries(ctx, partner);
  const candidates = entries
    .filter((entry) => customerList.matchKeyword(entry.row, keyword))
    .filter((entry) => customerList.matchFilters(entry.row, filters))
    .filter((entry) => customerList.isAfterBindingCursor(entry, cursor))
    .sort(customerList.compareBindingEntries);
  const page = candidates.slice(0, limit);
  await attachActiveCounts(ctx, partner, page);
  // 只对本页行签发（≤50 个 fileID 一次批量）；keyword/筛选不依赖头像，避免无谓外呼。
  await customer.signRowsAvatarUrls(ctx, page.map((entry) => entry.row));
  const last = page[page.length - 1];
  return {
    list: page.map((entry) => entry.row),
    nextCursor: candidates.length > limit && last ? customerList.bindingCursorOf(last) : null
  };
}

module.exports = { handler };
