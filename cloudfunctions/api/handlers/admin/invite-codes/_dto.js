// handlers/admin/invite-codes/_dto.js · 后台邀请码行 DTO（D59：增 kind/kindText/issuerPartnerNo）
// 口径：CONTRACT §13 D59（批 26 冻结）；草案 §2.6。后台只读：SUB 码展示类别与发码主兼职编号，
// 不可作废（作废由主兼职在团队页完成，admin.revokeInvite 对 SUB 码 FORBIDDEN）。
// 脱敏：不发 openid/issuerPartnerId/内部 _id；完整邀请码仅 admin 列表可见（后台既有口径不变）。
'use strict';

const enums = require('../../../shared/enums');
const mask = require('../../../db/dto/mask');

const KIND_TEXT = { DEV: '开发者主码', SUB: '主兼职子码' };

function dateValue(value) {
  return value === undefined ? null : value;
}

function codeTailOf(code) {
  return typeof code === 'string' && code.length > 0 ? code.slice(-4) : '';
}

// 旧记录缺 kind 按 DEV 兼容（D59 零迁移）；非法值同样按 DEV 展示。
function kindOf(invite) {
  return invite && invite.kind === enums.INVITATION_KIND.SUB ? enums.INVITATION_KIND.SUB : enums.INVITATION_KIND.DEV;
}

// options:{ usedByPartner, issuerPartnerNo }（listInvites 本页批量查好传入，不逐行 N+1）
function inviteBrief(invite, options) {
  const doc = invite || {};
  const opts = options || {};
  const kind = kindOf(doc);
  const usedBy = opts.usedByPartner || null;
  return {
    invitationCode: doc.code || '',
    codeTail: codeTailOf(doc.code),
    kind: kind,
    kindText: KIND_TEXT[kind] || '',
    status: doc.status || '',
    statusText: enums.INVITATION_STATUS_LABELS[doc.status] || '',
    batchId: doc.batchId || '',
    expiresAt: dateValue(doc.expiresAt),
    usedByPartnerNo: usedBy ? usedBy.partnerNo || '' : '',
    usedByDisplayName: usedBy ? mask.maskDisplayName(usedBy.displayName) : '',
    usedAt: dateValue(doc.usedAt),
    note: typeof doc.note === 'string' ? doc.note : '',
    createdBy: doc.createdBy || '',
    // SUB 码的发码主兼职编号（DEV 为空串）；本页批量查 partners 后传入
    issuerPartnerNo: typeof opts.issuerPartnerNo === 'string' ? opts.issuerPartnerNo : '',
    createdAt: dateValue(doc.createdAt)
  };
}

module.exports = { inviteBrief };
