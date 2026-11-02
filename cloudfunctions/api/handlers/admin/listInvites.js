// handlers/admin/listInvites.js · admin.listInvites（状态/批次筛选；完整码仅对 admin 返回）
// D59（批 26 冻结）：行增 kind/kindText/issuerPartnerNo（SUB 码=发码主兼职编号；DEV 为空串）；
// 本页 usedBy/issuerPartnerId 合并一次批量查 partners，不逐行 N+1；旧记录缺 kind 按 DEV 兼容。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope,
  readTrimmedText,
  parsePage,
  findPage,
  MAX_PAGE_SIZE
} = require('./_common');
const dto = require('./invite-codes/_dto');

const STATUS_LIST = [
  enums.INVITATION_STATUS.UNUSED,
  enums.INVITATION_STATUS.USED,
  enums.INVITATION_STATUS.REVOKED,
  enums.INVITATION_STATUS.EXPIRED
];

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (STATUS_LIST.indexOf(value) < 0) {
    throw errors.validation('status', '邀请码状态不正确');
  }
  return value;
}

// 本页需要展示称呼/发码编号的 partner _id（usedBy 与 SUB 码 issuerPartnerId 合并、去重）。
function partnerIdsOf(rows) {
  const ids = [];
  rows.forEach((invite) => {
    if (invite.usedBy) {
      ids.push(String(invite.usedBy));
    }
    if (invite.kind === enums.INVITATION_KIND.SUB && invite.issuerPartnerId) {
      ids.push(String(invite.issuerPartnerId));
    }
  });
  return ids.filter((id, index) => id !== '' && ids.indexOf(id) === index);
}

// 本页 partner 一次批量查（每批 ≤100，避免 SDK limit 上限；usedBy 与 SUB 码 issuer 合并去重 → 不 N+1）。
async function partnersByIds(scope, ids) {
  const map = new Map();
  for (let start = 0; start < ids.length; start += MAX_PAGE_SIZE) {
    const slice = ids.slice(start, start + MAX_PAGE_SIZE);
    const rows = await scope.dao.find(COLLECTIONS.PARTNERS, {
      where: { _id: scope.dao.command('in', slice) },
      limit: slice.length
    });
    rows.forEach((partner) => map.set(String(partner._id), partner));
  }
  return map;
}

function issuerPartnerNoOf(invite, partnerMap) {
  if (invite.kind !== enums.INVITATION_KIND.SUB || !invite.issuerPartnerId) {
    return '';
  }
  const issuer = partnerMap.get(String(invite.issuerPartnerId));
  return issuer && typeof issuer.partnerNo === 'string' ? issuer.partnerNo : '';
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const status = normalizeStatus(input.status);
  const batchId = readTrimmedText(input.batchId, 32);
  const page = parsePage(input);
  const where = {};
  if (status) {
    where.status = status;
  }
  if (batchId) {
    where.batchId = batchId;
  }
  const rows = await findPage(scope, COLLECTIONS.INVITATION_CODES, where, [['createdAt', 'desc']], page.offset, page.limit);
  const partnerMap = await partnersByIds(scope, partnerIdsOf(rows));
  const list = rows.map((invite) => dto.inviteBrief(invite, {
    usedByPartner: invite.usedBy ? partnerMap.get(String(invite.usedBy)) || null : null,
    issuerPartnerNo: issuerPartnerNoOf(invite, partnerMap)
  }));
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + rows.length } : null;
  return { list: list, nextCursor: nextCursor };
}

module.exports = handler;
