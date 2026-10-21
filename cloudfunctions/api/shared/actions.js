// shared/actions.js · 云函数 action 注册表（CONTRACT v0.9 §5.3 全集）
// 契约：docs/ARCHITECTURE.md §4.3；docs/ENGINEERING §4.2「动作注册纪律」。
// 每条 = action 名 → { visibility: 'client'|'internal', write: boolean }：
//   · visibility=client 才允许被小程序调用（router 对 internal 一律 FORBIDDEN）；
//   · write=true 表示会产生写入/外呼（READONLY 切换会话据此拒绝，客户端据此不做自动重试）。
// internal 仅 admin.bootstrap / health.check / cleanup.*（cleanup 只由定时触发器调用）。
// 调用方：api/client.js（重试判定）、api/mode-guard.js、云函数 router、switch-session 中间件、tools 门禁双向核对。
'use strict';

function defineRules(visibility, pairs) {
  const map = {};
  pairs.forEach((pair) => {
    map[pair[0]] = { visibility, write: pair[1] === true };
  });
  return map;
}

// ── 客户端可见动作（读 false / 写 true）───────────────────────────────────────
const CLIENT_RULES = defineRules('client', [
  // user
  ['user.bootstrap', false],
  ['user.acceptPrivacy', true],
  ['user.deleteAccount', true],
  // customer
  ['customer.saveProfile', true],
  ['customer.getProfile', false],
  // partner
  ['partner.activate', true],
  ['partner.saveProfile', true],
  ['partner.saveServiceConfig', true],
  ['partner.getPublic', false],
  ['partner.listBindings', false],
  ['partner.unbindCustomer', true],
  ['partner.saveCustomerNote', true],
  // bind（create 仅顾客可调；claimGuestOrder 为 P1 预留）
  ['bind.create', true],
  ['bind.release', true],
  ['bind.getCurrent', false],
  ['bind.claimGuestOrder', true],
  // order
  ['order.create', true],
  ['order.createBatch', true],
  ['order.get', false],
  ['order.listCustomer', false],
  ['order.listPartner', false],
  ['order.accept', true],
  ['order.reject', true],
  ['order.markPicked', true],
  ['order.unmarkPicked', true],
  ['order.markDelivered', true],
  ['order.unmarkDelivered', true],
  ['order.reportException', true],
  ['order.resolveException', true],
  ['order.cancel', true],
  ['order.confirmDelivery', true],
  ['order.correct', true],
  ['order.undo', true],
  ['order.deleteRecord', true],
  ['order.imageUrl', false],
  // message
  ['message.send', true],
  ['message.list', false],
  ['message.markRead', true],
  // upload
  ['upload.prepare', true],
  ['upload.cancel', true],
  // config
  ['config.getPublic', false],
  // ai（唯一外呼出口；写复核队列）
  ['ai.parseParcel', true],
  // admin（后台动作仍属 client 可见；白名单在 auth 层校验，切换会话票据不能当后台凭据）
  ['admin.createInvites', true],
  ['admin.revokeInvite', true],
  ['admin.listInvites', false],
  ['admin.listCustomers', false],
  ['admin.getCustomer', false],
  ['admin.listPartners', false],
  ['admin.setPartnerStatus', true],
  ['admin.listOrders', false],
  ['admin.getOrder', false],
  ['admin.listAudit', false],
  ['admin.updateConfig', true],
  ['admin.stats', false],
  ['admin.viewAsStart', true],
  ['admin.viewAsEnd', true],
  ['admin.createTestAccount', true],
  ['admin.listTestAccounts', false],
  ['admin.deleteTestAccount', true],
  ['admin.purgeTestData', true],
  ['admin.listRecognitionFailures', false],
  ['admin.getRecognitionFailure', false],
  ['admin.fixRecognitionFailure', true],
  ['admin.ignoreRecognitionFailure', true]
]);

// ── 内部动作（不注册给客户端；api 收到即 FORBIDDEN）──────────────────────────
const INTERNAL_RULES = defineRules('internal', [
  ['admin.bootstrap', true],
  ['health.check', false],
  // cleanup 定时任务（ENGINEERING §4.2 的 12 个 sweep + 删除测试账号级联 sweep）
  ['cleanup.orderTimeout', true],
  ['cleanup.autoComplete', true],
  ['cleanup.files', true],
  ['cleanup.tickets', true],
  ['cleanup.viewSessions', true],
  ['cleanup.retention', true],
  ['cleanup.accountDeletion', true],
  ['cleanup.invitationCodes', true],
  ['cleanup.rateLimits', true],
  ['cleanup.recomputeStats', true],
  ['cleanup.recognitionFailures', true],
  ['cleanup.testData', true],
  ['cleanup.testAccountsDeletion', true]
]);

const ACTION_MAP = {};
Object.keys(CLIENT_RULES).forEach((action) => {
  ACTION_MAP[action] = CLIENT_RULES[action];
});
Object.keys(INTERNAL_RULES).forEach((action) => {
  ACTION_MAP[action] = INTERNAL_RULES[action];
});

const CLIENT_ACTIONS = Object.keys(CLIENT_RULES);
const INTERNAL_ACTIONS = Object.keys(INTERNAL_RULES);
const ALL_ACTIONS = Object.keys(ACTION_MAP);

const ACTION_COUNT = ALL_ACTIONS.length;

function actionMeta(action) {
  return ACTION_MAP[action] || null;
}

function isRegisteredAction(action) {
  return Object.prototype.hasOwnProperty.call(ACTION_MAP, action);
}

function isClientAction(action) {
  return isRegisteredAction(action) && ACTION_MAP[action].visibility === 'client';
}

function isInternalAction(action) {
  return isRegisteredAction(action) && ACTION_MAP[action].visibility === 'internal';
}

function isWriteAction(action) {
  const meta = actionMeta(action);
  return !!(meta && meta.write);
}

module.exports = {
  ACTION_MAP,
  CLIENT_ACTIONS,
  INTERNAL_ACTIONS,
  ALL_ACTIONS,
  ACTION_COUNT,
  actionMeta,
  isRegisteredAction,
  isClientAction,
  isInternalAction,
  isWriteAction
};
