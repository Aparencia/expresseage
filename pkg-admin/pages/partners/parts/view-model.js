// pkg-admin/pages/partners/parts/view-model.js · 兼职列表视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.5/§7.2/§11.6——脱敏行、停用/恢复前置条件、确认后果句、切换入口边界。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

function buildTabs(activeStatus) {
  return C.PARTNER_STATUS_TABS.map(function mapTab(tab) {
    return { key: tab.key, label: tab.label, active: tab.key === activeStatus };
  });
}

function decorateRow(item, expandedNo) {
  const row = item || {};
  const isTest = row.isTest === true;
  const status = row.status || '';
  return {
    partnerNo: row.partnerNo || '—',
    status: status,
    displayName: F.textOrDash(row.displayName),
    statusText: C.PARTNER_STATUS_LABELS[status] || '—',
    isTest: isTest,
    expanded: row.partnerNo === expandedNo,
    bindingText: '绑定 ' + F.numOrZero(row.bindingCount),
    orderText: '今日 ' + F.numOrZero(row.todayOrders) + ' / 累计 ' + F.numOrZero(row.totalOrders),
    serviceCount: F.numOrZero(row.serviceCount),
    activatedAtText: row.activatedAt ? F.formatTime(row.activatedAt) : '',
    suspendedReason: row.suspendedReason || '',
    canSuspend: !isTest && status === C.PARTNER_STATUS_ACTIVE,
    canResume: !isTest && status === C.PARTNER_STATUS_SUSPENDED,
    // 切换会话只能选 ACTIVE 真实账号或测试账号（停用/注销不可查看，§3.5/§6.2）
    canSwitch: isTest || status === C.PARTNER_STATUS_ACTIVE
  };
}

function decorateList(list, expandedNo) {
  return (list || []).map(function mapRow(item) {
    return decorateRow(item, expandedNo);
  });
}

function isGovernanceBlocked(row) {
  return !!(row && row.isTest === true);
}

function suspendConfirmContent(row) {
  const item = row || {};
  return '停用后，' + item.displayName + '（' + item.partnerNo + '）将无法登录兼职端，名下未完成订单转异常待处理，' +
    '绑定顾客暂时不能向他下单。历史订单与编号保留。确定停用？';
}

function resumeConfirmContent(row) {
  const item = row || {};
  return '恢复后，' + item.displayName + '（' + item.partnerNo + '）可重新登录兼职端；停用期间产生的异常订单仍需逐单处理。确定恢复？';
}

function validateSuspendReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return { ok: false, error: '请填写停用原因（最多 100 字）。' };
  if (text.length > C.LIMITS.suspendReasonMax) return { ok: false, error: '停用原因最多 100 字。' };
  return { ok: true, reason: text };
}

module.exports = {
  buildTabs,
  decorateRow,
  decorateList,
  isGovernanceBlocked,
  suspendConfirmContent,
  resumeConfirmContent,
  validateSuspendReason
};
