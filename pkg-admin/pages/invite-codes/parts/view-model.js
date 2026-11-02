// pkg-admin/pages/invite-codes/parts/view-model.js · 邀请码页视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.2/§4/§11.3——状态筛选/类型筛选/行脱敏/作废前置文案/生成表单校验。
//   D59（v1.10，CONTRACT §13）：行增类型（kind/kindText：DEV=开发者主码、SUB=主兼职子码）与
//   发码主兼职编号（SUB 行）；SUB 码后台**只读**（由主兼职在团队页按批次作废，行内无「作废」按钮）。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');
const enums = require('../../../../shared/enums');

const COUNT_MAX = C.LIMITS.inviteCountMax;
const NOTE_MAX = C.LIMITS.inviteNoteMax;
const KIND_DEV = enums.INVITATION_KIND.DEV;
const KIND_SUB = enums.INVITATION_KIND.SUB;

// 类型筛选：全部 / DEV / SUB（UX_DEVELOPER §3.2「筛选可按类型（全部/DEV/SUB）」）
const KIND_OPTIONS = [
  { key: '', label: '全部' },
  { key: KIND_DEV, label: 'DEV' },
  { key: KIND_SUB, label: 'SUB' }
];

// SUB 码只读原因（独立审查 P1-4：行内不渲染作废按钮，给只读徽标 + 原因文案）
const SUB_READONLY_HINT = '子邀请码由主兼职管理';

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

// 类型筛选的选项文案（picker range 直接消费；键在 activeKindOf 里取）
function kindLabels() {
  return KIND_OPTIONS.map(function label(option) {
    return option.label;
  });
}

// picker 索引 → 类型键；越界/非法一律回「全部」，页面不写死下标也不判类型字面量
function activeKindOf(index) {
  const option = KIND_OPTIONS[Number(index)];
  return option ? option.key : '';
}

function filterByKind(rows, kind) {
  const list = rows || [];
  if (!kind) {
    return list.slice();
  }
  return list.filter(function sameKind(row) {
    return !!row && row.kind === kind;
  });
}

// 空态文案：区分「无数据」「状态筛选空」「类型筛选空」（文案单源，wxml 不硬编码副本）
function emptyTextOf(activeStatus, activeKind) {
  if (activeKind) return '没有符合当前类型的邀请码。';
  if (activeStatus) return '没有符合当前状态的邀请码。';
  return '还没有邀请码。生成后可线下发给要开通兼职的同学。';
}

// 行：完整码只留在内存供作废用，展示一律掩码（****-****-后4）。
// D59：kind/kindText 由服务端 DTO 下发（旧记录缺 kind 按 DEV 兼容）；SUB 行展示发码主兼职编号且只读。
function decorateRow(item, options) {
  const row = item || {};
  const opts = options || {};
  const kind = row.kind === KIND_SUB ? KIND_SUB : KIND_DEV;
  const isSub = kind === KIND_SUB;
  const usedByText = row.usedByPartnerNo
    ? row.usedByPartnerNo + ' ' + (row.usedByDisplayName || '')
    : '';
  const isUnused = row.status === C.INVITE_STATUS_UNUSED;
  const issuerPartnerNo = typeof row.issuerPartnerNo === 'string' ? row.issuerPartnerNo : '';
  return {
    invitationCode: row.invitationCode || '',
    codeMasked: F.maskInvitationCode(row.invitationCode),
    status: row.status || '',
    statusText: C.INVITE_STATUS_LABELS[row.status] || '—',
    isUnused: isUnused,
    kind: kind,
    // 服务端 kindText 优先；缺省回退类型键（不复制一份中文，避免与云函数 DTO 口径漂移）
    kindText: typeof row.kindText === 'string' && row.kindText ? row.kindText : kind,
    isSub: isSub,
    issuerText: isSub && issuerPartnerNo ? '发码人 ' + issuerPartnerNo : '',
    readonlyHint: isSub ? SUB_READONLY_HINT : '',
    // 作废按钮唯一判据：仅「未使用 + DEV + 非只读会话」可点（SUB 由主兼职管理，服务端 revokeInvite 亦已 FORBIDDEN）
    canRevoke: isUnused && !isSub && opts.readonly !== true,
    batchText: row.batchId || '—',
    expiresText: F.formatTime(row.expiresAt),
    createdAtText: F.formatTime(row.createdAt),
    note: row.note || '',
    usedByText: usedByText,
    usedAtText: row.usedAt ? F.formatTime(row.usedAt) : ''
  };
}

function decorateList(list, options) {
  return (list || []).map(function each(item) {
    return decorateRow(item, options);
  });
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
  kindLabels,
  activeKindOf,
  filterByKind,
  emptyTextOf,
  decorateRow,
  decorateList,
  revokeBlockedCopy,
  validateCreate,
  pickExpires,
  buildResult
};
