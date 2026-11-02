'use strict';
/**
 * tools/lib/admin-invite-cases.js — 后台邀请码页用例（C 组，从 selftest-admin-pages.js 拆出：门禁 #18 ≤1000 行）。
 * 口径：UX_DEVELOPER §3.2/§4/§11.3；CONTRACT §13 D59（DEV=开发者主码 / SUB=主兼职子码；后台对 SUB 码只读、不可作废）。
 * 覆盖：状态筛选/掩码/作废前置/生成表单（既有）+ D59 类型列 kind/kindText、SUB 发码主兼职编号、SUB 无作废按钮、
 *       类型筛选（全部/DEV/SUB）、READONLY 隐藏写入口、行投影零 openid/issuerPartnerId 泄漏。
 * 服务端缺口（只报告不改）：admin.listInvites 入参仅 status/batchId/cursor/limit，尚无 kind 筛选 → 端侧本地筛选。
 * 非独立套件：由 selftest-admin-pages 的 C 组注册，断言数计入其 EXPECTED_ASSERTIONS。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '..', '..');
const inviteVm = require(path.join(ROOT, 'pkg-admin/pages/invite-codes/parts/view-model.js'));
const C = require(path.join(ROOT, 'pkg-admin/common/constants.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));

const PAGE_JS = 'pkg-admin/pages/invite-codes/index.js';
const PAGE_WXML = 'pkg-admin/pages/invite-codes/index.wxml';

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel)) || '';
}

// 行投影键白名单：DTO 只带 kind/kindText/issuerPartnerNo，行模型不搬运任何内部标识
const ROW_KEYS = ['batchText', 'canRevoke', 'codeMasked', 'createdAtText', 'expiresText', 'invitationCode',
  'isSub', 'isUnused', 'issuerText', 'kind', 'kindText', 'note', 'readonlyHint', 'status', 'statusText',
  'usedAtText', 'usedByText'];

function devRow(extra) {
  return Object.assign({
    invitationCode: 'ABCD-EFGH-9XYZ', kind: 'DEV', kindText: '开发者主码', status: 'UNUSED',
    batchId: 'B1', expiresAt: Date.now(), createdAt: Date.now(), note: '首批'
  }, extra || {});
}

function subRow(extra) {
  return Object.assign({
    invitationCode: 'ABCD-EFGH-1AAA', kind: 'SUB', kindText: '主兼职子码', issuerPartnerNo: 'P-8F3-K2M',
    status: 'UNUSED', batchId: 'TB20261103-1'
  }, extra || {});
}

// C 组：既有口径 + D59 新增（t 为 selftest 分段 API）
function registerC(t) {
  const tabs = inviteVm.buildTabs('UNUSED', { '': 32, UNUSED: 20 });
  const activeTab = tabs.filter(function findActive(tab) { return tab.active; })[0];
  t.check(tabs.length === C.INVITE_STATUS_TABS.length && activeTab.key === 'UNUSED' && activeTab.countText === ' 20',
    '状态筛选 tab 覆盖全部注册状态、高亮当前状态、计数取服务端 counts');
  const unusedRow = inviteVm.decorateRow(devRow());
  t.check(unusedRow.codeMasked.indexOf('9XYZ') >= 0 && unusedRow.codeMasked.indexOf('ABCD') < 0
    && unusedRow.invitationCode === 'ABCD-EFGH-9XYZ',
  '列表只展示掩码（****-****-后4），完整码只留在内存供作废调用');
  t.check(unusedRow.isUnused === true && unusedRow.statusText === C.INVITE_STATUS_LABELS.UNUSED,
    '未使用行展示中文状态并可作废');
  const usedRow = inviteVm.decorateRow({
    invitationCode: 'ABCD-EFGH-1AAA', status: 'USED', usedByPartnerNo: 'P-7K2-M9X',
    usedByDisplayName: '小**', usedAt: Date.now()
  });
  t.check(usedRow.isUnused === false && usedRow.usedByText.indexOf('P-7K2-M9X') >= 0,
    '已使用行只读展示使用人兼职编号+脱敏昵称');
  t.eq([
    inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.USED),
    inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.EXPIRED),
    inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.REVOKED),
    inviteVm.revokeBlockedCopy(enums.INVITATION_STATUS.UNUSED)
  ], [
    '这个邀请码已被使用，不能作废。',
    '这个邀请码已过期，无需作废。',
    '这个邀请码已作废，无需重复作废。',
    ''
  ], '作废前置按真实状态分支（已使用/已过期/已作废/可作废）');
  const createMatrix = [
    inviteVm.validateCreate({ count: '0', note: '' }).ok,
    inviteVm.validateCreate({ count: '51', note: '' }).ok,
    inviteVm.validateCreate({ count: '50', note: '' }).ok,
    inviteVm.validateCreate({ count: '1', note: 'x'.repeat(51) }).ok,
    inviteVm.validateCreate({ count: '3', note: '  首批  ' }).note
  ];
  t.eq(createMatrix, [false, false, true, false, '首批'], '生成表单校验：数量 1~50、备注 ≤50、提交前去空白');
  t.check(inviteVm.pickExpires(2).label.indexOf('7') >= 0, '默认有效期 = 7 天（索引 2）');
  const result = inviteVm.buildResult({ batchId: 'B2', expiresAt: Date.now(), codes: ['AAA', 'BBB'] });
  t.check(result.count === 2 && result.codeText === 'AAA\nBBB' && result.batchId === 'B2',
    '批量结果整批可复制（换行拼接）+ 批次号展示');

  // ── D59：类型列（kind/kindText）+ 发码主兼职编号 + SUB 只读（后台不可作废）────────────
  const dev = inviteVm.decorateRow(devRow());
  t.eq([dev.kind, dev.kindText, dev.isSub, dev.canRevoke, dev.issuerText, dev.readonlyHint],
    ['DEV', '开发者主码', false, true, '', ''],
    'D1 DEV 未使用行：kind/kindText 由 DTO 单源下发、可作废、无发码人与只读原因');
  const sub = inviteVm.decorateRow(subRow());
  t.eq([sub.kind, sub.kindText, sub.isSub, sub.canRevoke, sub.issuerText, sub.readonlyHint],
    ['SUB', '主兼职子码', true, false, '发码人 P-8F3-K2M', '子邀请码由主兼职管理'],
    'D2 SUB 行：类型+发码主兼职编号+只读原因；canRevoke=false（后台不可作废，服务端 revokeInvite 亦 FORBIDDEN）');
  const legacy = inviteVm.decorateRow({ invitationCode: 'ABCD-EFGH-3CCC', status: 'UNUSED' });
  t.eq([legacy.kind, legacy.kindText, legacy.canRevoke], ['DEV', 'DEV', true],
    'D3 旧记录缺 kind 按 DEV 兼容；缺 kindText 回退类型键（不在端侧复制一份中文，避免与云函数口径漂移）');
  const devReadonly = inviteVm.decorateRow(devRow(), { readonly: true });
  t.eq([
    inviteVm.decorateRow(devRow({ status: 'USED' })).canRevoke,
    sub.canRevoke,
    devReadonly.canRevoke,
    dev.canRevoke
  ], [false, false, false, true],
  'D4 作废按钮矩阵：仅「未使用 + DEV + 非只读会话」为 true（USED / SUB / READONLY 一律 false）');
  const subNoIssuer = inviteVm.decorateRow({ invitationCode: 'ABCD-EFGH-4DDD', kind: 'SUB', status: 'UNUSED' });
  const subBadIssuer = inviteVm.decorateRow({ invitationCode: 'ABCD-EFGH-5EEE', kind: 'SUB', issuerPartnerNo: 123 });
  t.eq([subNoIssuer.issuerText, subBadIssuer.issuerText], ['', ''],
    'D5 SUB 缺发码主兼职编号/键非字符串时省略发码人行（不渲染空「发码人」、不把非字符串拼上屏）');
  t.check(sub.invitationCode === 'ABCD-EFGH-1AAA' && sub.codeMasked.indexOf('1AAA') >= 0
    && sub.codeMasked.indexOf('ABCD') < 0,
  'D6 SUB 行同样只展示掩码、完整码只留内存（既有展示口径与作废锚不回归）');
  t.eq([inviteVm.kindLabels(), [0, 1, 2, 9].map(inviteVm.activeKindOf)],
    [['全部', 'DEV', 'SUB'], ['', 'DEV', 'SUB', '']],
    'D7 类型筛选选项 = 全部/DEV/SUB（UX_DEVELOPER §3.2）；picker 下标越界回「全部」，页面不写死下标');
  const mixed = [dev, sub, legacy];
  t.eq([
    inviteVm.filterByKind(mixed, '').length,
    inviteVm.filterByKind(mixed, 'SUB').length,
    inviteVm.filterByKind(mixed, 'DEV').length,
    inviteVm.filterByKind(mixed, 'NOPE').length
  ], [3, 1, 2, 0],
  'D8 类型筛选纯件：全部=全量、SUB 只留子码、DEV 只留主码、未知键过滤为空集（脏值不误显示全部）');
  t.eq([
    inviteVm.emptyTextOf('', ''),
    inviteVm.emptyTextOf('UNUSED', ''),
    inviteVm.emptyTextOf('', 'SUB')
  ], [
    '还没有邀请码。生成后可线下发给要开通兼职的同学。',
    '没有符合当前状态的邀请码。',
    '没有符合当前类型的邀请码。'
  ], 'D9 空态文案区分「无数据 / 状态筛选空 / 类型筛选空」（单源在纯件，wxml 不硬编码副本）');
  t.eq(Object.keys(dev).sort(), ROW_KEYS.slice().sort(),
    'D10 行投影键白名单固定（不搬运 openid/issuerPartnerId/_id 等内部标识）');
  t.check(JSON.stringify([dev, sub]).toLowerCase().indexOf('openid') < 0
    && JSON.stringify([dev, sub]).indexOf('issuerPartnerId') < 0,
  'D11 行投影零内部标识泄漏（openid/issuerPartnerId 不上屏）');
  const pageSrc = fsutil.stripComments(textOf(PAGE_JS));
  t.check(pageSrc.indexOf('modeGuard.canRenderWriteButton()') >= 0
    && pageSrc.indexOf('vm.filterByKind(') >= 0 && pageSrc.indexOf('vm.activeKindOf(') >= 0
    && pageSrc.indexOf('{ readonly: readonly }') >= 0 && pageSrc.indexOf('item.canRevoke') >= 0,
  'D12 页面接线：READONLY 取 modeGuard、类型筛选走纯件 filterByKind/activeKindOf、作废前守 canRevoke');
  const wxml = textOf(PAGE_WXML);
  t.check(wxml.indexOf('{{item.kindText}}') >= 0 && wxml.indexOf('{{item.issuerText}}') >= 0
    && wxml.indexOf('{{item.readonlyHint}}') >= 0 && wxml.indexOf('wx:if="{{item.canRevoke}}"') >= 0
    && wxml.indexOf('wx:if="{{item.isSub}}"') >= 0 && wxml.indexOf('只读') >= 0
    && wxml.indexOf('bindchange="onKindChange"') >= 0 && wxml.indexOf('kindLabels[kindIndex]') >= 0
    && wxml.indexOf('{{emptyText}}') >= 0,
  'D13 WXML：类型列/发码人行/SUB「只读」徽标+原因/作废仅 canRevoke 渲染/类型筛选与空态接线');
  t.check(wxml.indexOf('{{item.isUnused}}') < 0 && wxml.indexOf('wx:if="{{!readonly}}"') >= 0,
    'D14 作废按钮不再直接判 isUnused（SUB/READONLY 由 canRevoke 单源）；READONLY 隐藏「生成邀请码」写入口');
  t.check(pageSrc.indexOf('nextCursor') >= 0 && pageSrc.indexOf('onReachBottom') >= 0
    && pageSrc.indexOf('onCopyAll') >= 0 && pageSrc.indexOf('limit: PAGE_SIZE') >= 0,
  'D15 分页/上拉加载更多/整批复制行为保留（本地筛选不改变服务端 nextCursor 口径）');
}

const CLIENT_ASSERTIONS = 8 + 15;

module.exports = { CLIENT_ASSERTIONS, registerC };
