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

module.exports = {
  buildTabs,
  buildRoleChips,
  roleLabel,
  decorateCandidate,
  decorateTestAccount
};
