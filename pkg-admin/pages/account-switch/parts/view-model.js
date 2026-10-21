// pkg-admin/pages/account-switch/parts/view-model.js · 账号切换页视图模型（纯件，零 wx）
const C = require('../../../common/constants');
const F = require('../../../common/format');

function buildTabs(activeTab) {
  return C.ACCOUNT_TABS.map(function (tab) {
    return { key: tab.key, label: tab.label, active: tab.key === activeTab };
  });
}

function buildRoleChips(activeRole) {
  return C.ROLE_OPTIONS.map(function (option) {
    return { key: option.key, label: option.label, active: option.key === activeRole };
  });
}

function roleLabel(role) {
  return C.ROLE_LABELS[role] || '—';
}

function decorateCandidate(item, isPartner) {
  const targetNo = isPartner ? item.partnerNo : item.customerNo;
  return {
    targetNo: targetNo || '—',
    rawTargetNo: targetNo || '',
    role: isPartner ? C.ROLE_PARTNER : C.ROLE_CUSTOMER,
    roleText: roleLabel(isPartner ? C.ROLE_PARTNER : C.ROLE_CUSTOMER),
    displayName: F.textOrDash(item.displayName),
    dormText: item.dormText || item.dorm || '—',
    statusText: isPartner
      ? (C.PARTNER_STATUS_LABELS[item.status] || '—')
      : (item.profileCompleted ? '资料完整' : '资料未完整'),
    extraText: isPartner ? ('绑定 ' + F.numOrZero(item.bindingCount)) : '',
    selected: false
  };
}

function decorateTestAccount(item) {
  const role = item.role === C.ROLE_PARTNER ? C.ROLE_PARTNER : C.ROLE_CUSTOMER;
  return {
    targetNo: item.targetNo || item.customerNo || item.partnerNo || '—',
    role: role,
    roleText: roleLabel(role),
    displayName: F.textOrDash(item.displayName),
    lastUsedText: item.testLastUsedAt ? F.formatTime(item.testLastUsedAt) : '未使用',
    isTestAccount: item.isTestAccount !== false
  };
}

// 真实账号搜索入参：只列 ACTIVE（停用/注销不可查看，§6.2）；顾客侧无状态筛选；测试账号一律排除
function buildRealSearchParams(options) {
  const opts = options || {};
  const isPartner = opts.role === C.ROLE_PARTNER;
  const payload = { keyword: String(opts.keyword || '').trim(), includeTest: false, limit: opts.limit };
  if (isPartner) payload.status = C.PARTNER_STATUS_ACTIVE;
  return { action: isPartner ? 'listPartners' : 'listCustomers', payload: payload };
}

// 真实账号进入确认（说明型，不属危险确认）：含角色/编号/脱敏昵称/有效期/只读与审计
function buildRealConfirmContent(selected, ttlMinutes) {
  const item = selected || {};
  return '将以' + item.roleText + ' ' + item.targetNo + ' ' + item.displayName + ' 的只读视角进入，有效期 ' +
    ttlMinutes + ' 分钟。期间不能做任何写操作，退出或到期后自动回到账号切换。确定进入？';
}

// 测试账号进入确认：必须写明"只写测试数据、不影响真实用户"
function buildTestConfirmContent(selected, ttlMinutes) {
  const item = selected || {};
  return '将以测试账号 ' + item.targetNo + '（' + item.roleText + '）进入，有效期 ' + ttlMinutes +
    ' 分钟。期间可操作，但只写入测试数据，不影响真实用户；全程审计。确定进入？';
}

const QUOTA_COPY = '每位开发者每角色最多 3 个、合计 6 个测试账号。';

// 新建额度：按角色分别计数 + 合计上限（服务端口径为唯一门槛，这里只做体验前置）
function quotaState(options) {
  const opts = options || {};
  const role = opts.role === C.ROLE_PARTNER ? C.ROLE_PARTNER : C.ROLE_CUSTOMER;
  const used = role === C.ROLE_PARTNER ? itemNum(opts.partnerUsed) : itemNum(opts.customerUsed);
  const maxPerRole = itemNum(opts.maxPerRole) || C.DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE;
  const maxTotal = itemNum(opts.maxTotal) || C.TEST_ACCOUNT_TOTAL_MAX;
  const blocked = used >= maxPerRole || itemNum(opts.totalUsed) >= maxTotal;
  return { blocked: blocked, copy: QUOTA_COPY, used: used, maxPerRole: maxPerRole, maxTotal: maxTotal };
}

function itemNum(value) {
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

// 新建测试账号昵称校验（必填、≤20 字；建议"测试-"开头不强制）
function validateCreateName(name, maxLength) {
  const text = String(name || '').trim();
  const limit = maxLength || C.LIMITS.testDisplayNameMax;
  if (!text) return { ok: false, error: '昵称不能为空且最多 20 字。' };
  if (text.length > limit) return { ok: false, error: '昵称不能为空且最多 20 字。' };
  return { ok: true, displayName: text };
}

// 删除测试账号确认（dry-run 计数 + 双条件：输入「删除」）
function buildDeleteConfirmContent(account, preview) {
  const target = account || {};
  const counts = (preview && preview.removedCounts) || {};
  const sessionsEnded = itemNum(preview && preview.sessionsEnded);
  return '删除测试账号 ' + target.targetNo + '（' + target.displayName + '）将级联删除：测试订单 ' +
    itemNum(counts.orders) + ' 条、事件 ' + itemNum(counts.events) + ' 条、留言 ' +
    itemNum(counts.messages) + ' 条、绑定 ' + itemNum(counts.bindings) + ' 条、识别失败 ' +
    itemNum(counts.failures) + ' 条、头像/原图 ' + itemNum(counts.avatarFiles) + ' 个' +
    (sessionsEnded > 0 ? '，并结束 ' + sessionsEnded + ' 个活跃切换会话' : '') +
    '。不可恢复，输入“删除”确认。';
}

// 清空测试数据确认（dry-run 计数；双条件由页面输入框 + 勾选保证）
function buildPurgeConfirmContent(counts) {
  const data = counts || {};
  return '将清空全部测试数据：测试订单 ' + itemNum(data.orders) + ' 条、留言 ' + itemNum(data.messages) +
    ' 条、绑定 ' + itemNum(data.bindings) + ' 条、识别失败 ' + itemNum(data.failures) + ' 条；' +
    '测试账号保留。此操作不可恢复。';
}

module.exports = {
  QUOTA_COPY,
  buildTabs,
  buildRoleChips,
  roleLabel,
  decorateCandidate,
  decorateTestAccount,
  buildRealSearchParams,
  buildRealConfirmContent,
  buildTestConfirmContent,
  quotaState,
  validateCreateName,
  buildDeleteConfirmContent,
  buildPurgeConfirmContent
};
