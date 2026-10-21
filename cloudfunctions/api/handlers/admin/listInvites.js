// handlers/admin/listInvites.js · admin.listInvites（状态/批次筛选；完整码仅对 admin 返回）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope,
  readTrimmedText,
  parsePage,
  findPage
} = require('./_common');
const dto = require('./_dto');

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
  const list = [];
  for (let i = 0; i < rows.length; i += 1) {
    const invite = rows[i];
    let partner = null;
    if (invite.usedBy) {
      partner = await scope.dao.get(COLLECTIONS.PARTNERS, invite.usedBy);
    }
    list.push(dto.inviteBrief(invite, partner));
  }
  const nextCursor = rows.length >= page.limit ? { offset: page.offset + rows.length } : null;
  return { list: list, nextCursor: nextCursor };
}

module.exports = handler;
