// handlers/partner/recentTransferTargets.js · partner.recentTransferTargets（D90：「最近使用」转派目标）
// 口径：CONTRACT §13 D90；只回「本人转派成功过」的对象（transfer.fromPartnerId=me + status=ACCEPTED），
//       去重取最近 ≤5；不构成目录（别人搜不到你的记录），也不新增集合/索引（复用 idx_transfer_from）。
// 边界：只回三键 {partnerNo,displayName,acceptingOrders}；停用/注销/异侧账号不进候选（与 requestTransfer 同口径）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const identity = require('../user/_common');
const orderCommon = require('../order/_common');
const targetScope = require('./_transfer-target');

const SCAN_LIMIT = 30; // 扫描窗：最近 30 条已转派订单足够覆盖 ≤5 个不同对象
const RECENT_LIMIT = 5; // 返回上限（D90 默认值：保留最近 5 个）

// 最近对象的编号（按「转派发起时刻」倒序去重）：只看已成功转出的单；PENDING/拒收/撤回不参与。
// 说明：查询按 statusUpdatedAt desc（索引对齐）取窗口，真正的"最近"在内存里按 transfer.requestedAt 重排。
async function codesOf(ctx, partnerId) {
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: {
      'transfer.fromPartnerId': partnerId,
      'transfer.status': enums.TRANSFER_STATUS.ACCEPTED,
      isTest: orderCommon.isTestSession(ctx)
    },
    orderBy: [['statusUpdatedAt', 'desc']],
    limit: SCAN_LIMIT
  });
  const sorted = rows.slice().sort((left, right) => requestedAtOf(right) - requestedAtOf(left));
  const codes = [];
  sorted.forEach((row) => {
    const no = String((row.transfer && row.transfer.toPartnerNo) || '');
    if (no && codes.indexOf(no) < 0 && codes.length < RECENT_LIMIT) {
      codes.push(no);
    }
  });
  return codes;
}

function requestedAtOf(order) {
  const value = order && order.transfer && order.transfer.requestedAt;
  const ms = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return isFinite(ms) ? ms : 0;
}

// 一次批量取回候选资料（≤5 条，零 N+1）
async function partnersOf(ctx, codes) {
  if (!codes.length) {
    return [];
  }
  return ctx.dao.find(COLLECTIONS.PARTNERS, {
    where: { partnerNo: ctx.dao.command('in', codes) },
    limit: codes.length
  });
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  // 防御：与检索同口径——不接受关键词/分页参数（本动作只回"我用过的对象"）
  if (typeof input.keyword === 'string' && input.keyword.trim() !== '') {
    throw orderCommon.errors.validation('keyword', '最近使用不支持搜索');
  }
  const codes = await codesOf(ctx, partner._id);
  const rows = await partnersOf(ctx, codes);
  const byNo = {};
  rows.forEach((row) => {
    if (!row || row.deletedAt || row.status !== enums.PARTNER_STATUS.ACTIVE) {
      return;
    }
    if (targetScope.isTestOpenid(row.openid) !== targetScope.isTestOpenid(partner.openid)) {
      return;
    }
    byNo[String(row.partnerNo)] = targetScope.cardOf(row);
  });
  return { list: codes.map((no) => byNo[no]).filter(Boolean) };
}

module.exports = { handler };
