// pkg-admin/pages/invite-codes/parts/view-model.js · 邀请码页视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.2/§4/§11.3——状态筛选/行脱敏/作废前置文案/生成表单校验。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');
const enums = require('../../../../shared/enums');

const COUNT_MAX = C.LIMITS.inviteCountMax;
const NOTE_MAX = C.LIMITS.inviteNoteMax;

function buildTabs(activeStatus, counts) {
  return C.INVITE_STATUS_TABS.map(function mapTab(tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

function buildExpiresLabels() {
  return C.EXPIRES_OPTIONS.map(function label(option) {
    return option.label;
  });
}

// 行：完整码只留在内存供作废用，展示一律掩码（****-****-后4）
function decorateRow(item) {
  const row = item || {};
  const usedByText = row.usedByPartnerNo
    ? row.usedByPartnerNo + ' ' + (row.usedByDisplayName || '')
    : '';
  return {
    invitationCode: row.invitationCode || '',
    codeMasked: F.maskInvitationCode(row.invitationCode),
    status: row.status || '',
    statusText: C.INVITE_STATUS_LABELS[row.status] || '—',
    isUnused: row.status === C.INVITE_STATUS_UNUSED,
    batchText: row.batchId || '—',
    expiresText: F.formatTime(row.expiresAt),
    createdAtText: F.formatTime(row.createdAt),
    note: row.note || '',
    usedByText: usedByText,
    usedAtText: row.usedAt ? F.formatTime(row.usedAt) : ''
  };
}

// 作废前置：非 UNUSED 一律给「不能作废」的原因文案（按真实状态分支，不比对中文标签）
function revokeBlockedCopy(status) {
  if (!status || status === C.INVITE_STATUS_UNUSED) return '';
  if (status === enums.INVITATION_STATUS.USED) return '这个邀请码已被使用，不能作废。';
  if (status === enums.INVITATION_STATUS.EXPIRED) return '这个邀请码已过期，无需作废。';
  if (status === enums.INVITATION_STATUS.REVOKED) return '这个邀请码已作废，无需重复作废。';
  return '这个邀请码当前不可作废。';
}

// 生成表单校验（数量 1~50、备注 ≤50）；通过时回传规整入参
function validateCreate(form) {
  const input = form || {};
  const count = Number(input.count);
  if (!count || count < 1 || count > COUNT_MAX) {
    return { ok: false, error: '单批最多生成 50 个邀请码。' };
  }
  const note = String(input.note || '').trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, error: '备注最多 50 字。' };
  }
  return { ok: true, count: Math.floor(count), note: note };
}

function pickExpires(index) {
  return C.EXPIRES_OPTIONS[index] || C.EXPIRES_OPTIONS[2];
}

function buildResult(result) {
  const source = result || {};
  const codes = source.codes || [];
  return {
    batchId: source.batchId || '',
    expiresAtText: F.formatTime(source.expiresAt),
    codes: codes,
    codeText: codes.join('\n'),
    count: codes.length
  };
}

module.exports = {
  COUNT_MAX,
  NOTE_MAX,
  buildTabs,
  buildExpiresLabels,
  decorateRow,
  revokeBlockedCopy,
  validateCreate,
  pickExpires,
  buildResult
};
