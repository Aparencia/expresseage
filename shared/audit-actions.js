// shared/audit-actions.js · 管理审计枚举（恰好 16 个）
// 契约：docs/ARCHITECTURE.md §4.3；docs/V4_CONTRACT.md v0.9 §4.2「admin 审计」/ §1.2/§1.3。
// 纪律：新日志只写这 16 个值；账号切换统一 ACCOUNT_SWITCH_*（旧 VIEW_AS 系列已作废，
//       历史日志的兼容换算放在 admin.listAudit 读取侧，不在本文件留旧名，避免被再次写入）。
// 调用方：云函数 admin.* handler、cleanup、admin_audit 写入与后台审计区块。
'use strict';

const AUDIT_ACTIONS = {
  // 邀请码与兼职治理
  INVITE_CREATE: 'INVITE_CREATE',
  INVITE_REVOKE: 'INVITE_REVOKE',
  PARTNER_SUSPEND: 'PARTNER_SUSPEND',
  PARTNER_RESTORE: 'PARTNER_RESTORE',
  // 配置 / 异常介入 / 初始化
  CONFIG_UPDATE: 'CONFIG_UPDATE',
  ORDER_ANOMALY_CANCEL: 'ORDER_ANOMALY_CANCEL',
  BOOTSTRAP: 'BOOTSTRAP',
  // 识别失败复核（v0.8）
  FAILURE_IMAGE_VIEW: 'FAILURE_IMAGE_VIEW',
  FAILURE_FIX: 'FAILURE_FIX',
  FAILURE_IGNORE: 'FAILURE_IGNORE',
  // 账号切换（v0.9，真实账号只读 / 测试账号可写共用；detail 记 viewMode）
  ACCOUNT_SWITCH_START: 'ACCOUNT_SWITCH_START',
  ACCOUNT_SWITCH_END: 'ACCOUNT_SWITCH_END',
  ACCOUNT_SWITCH_EXPIRED: 'ACCOUNT_SWITCH_EXPIRED',
  // 测试账号管理（v0.9）
  TEST_ACCOUNT_CREATE: 'TEST_ACCOUNT_CREATE',
  TEST_ACCOUNT_DELETE: 'TEST_ACCOUNT_DELETE',
  TEST_DATA_PURGE: 'TEST_DATA_PURGE'
};

const AUDIT_ACTION_LIST = Object.keys(AUDIT_ACTIONS).map((key) => AUDIT_ACTIONS[key]);

const AUDIT_ACTION_COUNT = 16;

function isAuditAction(action) {
  return typeof action === 'string' && AUDIT_ACTION_LIST.indexOf(action) !== -1;
}

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LIST,
  AUDIT_ACTION_COUNT,
  isAuditAction
};
