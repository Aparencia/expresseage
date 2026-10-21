// handlers/admin/index.js · admin 域 handler 汇总（23 个 admin 动作 → handler(ctx, payload)）
// 注册形状冻结：模块导出 { actions: { 'admin.xxx': handler } }，由 router 按 shared/actions.js 分发。
'use strict';

const testAccounts = require('./testAccounts');

const actions = {
  'admin.createInvites': require('./createInvites'),
  'admin.revokeInvite': require('./revokeInvite'),
  'admin.listInvites': require('./listInvites'),
  'admin.listCustomers': require('./listCustomers'),
  'admin.getCustomer': require('./getCustomer'),
  'admin.listPartners': require('./listPartners'),
  'admin.setPartnerStatus': require('./setPartnerStatus'),
  'admin.listOrders': require('./listOrders'),
  'admin.getOrder': require('./getOrder'),
  'admin.listAudit': require('./listAudit'),
  'admin.updateConfig': require('./updateConfig'),
  'admin.stats': require('./stats'),
  'admin.bootstrap': require('./bootstrap'),
  'admin.viewAsStart': require('./viewAsStart'),
  'admin.viewAsEnd': require('./viewAsEnd'),
  'admin.createTestAccount': testAccounts.actions['admin.createTestAccount'],
  'admin.listTestAccounts': testAccounts.actions['admin.listTestAccounts'],
  'admin.deleteTestAccount': testAccounts.actions['admin.deleteTestAccount'],
  'admin.purgeTestData': testAccounts.actions['admin.purgeTestData'],
  'admin.listRecognitionFailures': require('./listRecognitionFailures'),
  'admin.getRecognitionFailure': require('./getRecognitionFailure'),
  'admin.fixRecognitionFailure': require('./fixRecognitionFailure'),
  'admin.ignoreRecognitionFailure': require('./ignoreRecognitionFailure')
};

module.exports = { actions: actions };
