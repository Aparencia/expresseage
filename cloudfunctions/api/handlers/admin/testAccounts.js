// handlers/admin/testAccounts.js · 测试账号四动作专用 handler（#28：删除/清空只走本文件，不进业务路径）
// createTestAccount / listTestAccounts / deleteTestAccount / purgeTestData；不与真实治理动作混用。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  assertValid
} = require('./_common');
const dto = require('./_dto');
const helpers = require('./_test-accounts');

const CONFIRM_DELETE = '删除';
const CONFIRM_PURGE = '清空';

function confirmedBy(input, expected) {
  if (input.confirm === true) {
    return true;
  }
  return sharedValidate.validateConfirmText(input.confirmText, expected).ok;
}

async function createTestAccount(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const roleCheck = assertValid(sharedValidate.validateRole(input.role), '角色不正确');
  const role = roleCheck.value;
  const nameCheck = assertValid(sharedValidate.validateDisplayName(input.displayName), '昵称不能为空');
  const displayName = nameCheck.value;
  await helpers.checkTextSecurity(ctx, displayName);
  const requestKey = auditKeyOf(ctx);
  const replay = await helpers.replayCreate(scope, await scope.findAudit(requestKey));
  if (replay) {
    return replay;
  }
  const quota = await helpers.quotaOf(scope);
  if (quota.perRole[role] >= quota.maxPerRole || quota.total >= helpers.TOTAL_TEST_ACCOUNT_LIMIT) {
    throw errors.invalidState('测试账号数量已达上限（每角色 ' + quota.maxPerRole + ' 个、合计 6 个）');
  }
  const created = await helpers.createOnce(scope, role, displayName);
  await scope.writeAudit(
    AUDIT_ACTIONS.TEST_ACCOUNT_CREATE,
    { type: 'test_account', id: created.targetNo },
    {
      role: role,
      targetNo: created.targetNo,
      displayNameMasked: dto.maskedName(displayName),
      createdByDeveloperNo: scope.developerNo
    },
    requestKey
  );
  return {
    targetNo: created.targetNo,
    role: role,
    displayName: displayName,
    isTestAccount: true
  };
}

async function listTestAccounts(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  let roleFilter = '';
  if (input.role !== undefined && input.role !== null && input.role !== '') {
    const check = sharedValidate.validateRole(input.role);
    if (!check.ok) {
      throw errors.validation('role', '角色不正确');
    }
    roleFilter = check.value;
  }
  const users = await helpers.testAccountsOfDeveloper(scope);
  const list = [];
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const roles = helpers.rolesOf(user);
    if (roleFilter && roles.indexOf(roleFilter) < 0) {
      continue;
    }
    const profile = await helpers.profileOf(scope, user);
    list.push(dto.testAccountBrief(user, profile));
  }
  list.sort(function byLastUsed(a, b) {
    const aMs = a.testLastUsedAt ? new Date(a.testLastUsedAt).getTime() : 0;
    const bMs = b.testLastUsedAt ? new Date(b.testLastUsedAt).getTime() : 0;
    return bMs - aMs;
  });
  const quota = await helpers.quotaOf(scope);
  return {
    list: list,
    nextCursor: null,
    usage: {
      customer: { used: quota.perRole.CUSTOMER, max: quota.maxPerRole },
      partner: { used: quota.perRole.PARTNER, max: quota.maxPerRole },
      total: { used: quota.total, max: helpers.TOTAL_TEST_ACCOUNT_LIMIT }
    }
  };
}

async function deleteTestAccount(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const identifier = input.testAccountId || input.targetNo || '';
  const dryRun = input.dryRun === true;
  const requestKey = auditKeyOf(ctx);
  const replay = await scope.findAudit(requestKey);
  if (replay && !dryRun) {
    return {
      deleted: true,
      removedCounts: (replay.detail && replay.detail.before) || helpers.zeroCounts(),
      sessionsEnded: (replay.detail && replay.detail.sessionsEnded) || 0,
      duplicated: true
    };
  }
  if (!dryRun && !confirmedBy(input, CONFIRM_DELETE)) {
    throw errors.validation('confirmText', '请二次确认删除（确认文案需为「删除」）');
  }
  const user = await helpers.resolveTestUser(scope, identifier);
  const data = await helpers.countCascade(scope, user);
  if (dryRun) {
    return {
      dryRun: true,
      deleted: false,
      removedCounts: {
        orders: data.orders.length,
        bindings: data.bindings.length,
        failures: data.failures.length,
        tickets: data.tickets,
        events: 0,
        messages: 0,
        avatarFiles: 0
      },
      willDelete: true
    };
  }
  const before = {
    orders: data.orders.length,
    bindings: data.bindings.length,
    failures: data.failures.length,
    tickets: data.tickets,
    events: 0,
    messages: 0,
    avatarFiles: 0
  };
  const removed = await helpers.cascadeDelete(scope, user, data);
  const roles = helpers.rolesOf(user);
  const role = roles.indexOf(enums.ROLES.CUSTOMER) >= 0 ? enums.ROLES.CUSTOMER : enums.ROLES.PARTNER;
  await scope.writeAudit(
    AUDIT_ACTIONS.TEST_ACCOUNT_DELETE,
    { type: 'test_account', id: identifier },
    {
      role: role,
      before: before,
      after: helpers.zeroCounts(),
      sessionsEnded: removed.sessionsEnded,
      dryRun: false
    },
    requestKey
  );
  return { deleted: true, removedCounts: removed, sessionsEnded: removed.sessionsEnded };
}

async function purgeTestData(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const dryRun = input.dryRun === true;
  const requestKey = auditKeyOf(ctx);
  const replay = await scope.findAudit(requestKey);
  if (replay && !dryRun) {
    return {
      dryRun: false,
      purged: true,
      counts: (replay.detail && replay.detail.before) || { orders: 0, events: 0, messages: 0, bindings: 0, failures: 0 },
      duplicated: true
    };
  }
  if (!dryRun && !confirmedBy(input, CONFIRM_PURGE)) {
    throw errors.validation('confirmText', '请二次确认清空（确认文案需为「清空」）');
  }
  const users = await helpers.testAccountsOfDeveloper(scope);
  const openids = users.map(function openidOf(user) {
    return user._id;
  });
  const data = await helpers.collectTestData(scope, openids);
  if (dryRun) {
    return {
      dryRun: true,
      counts: {
        orders: data.orders.length,
        events: 0,
        messages: 0,
        bindings: data.bindings.length,
        failures: data.failures.length,
        tickets: data.tickets
      },
      purged: false
    };
  }
  let removedEvents = 0;
  let removedMessages = 0;
  for (let i = 0; i < data.orders.length; i += 1) {
    const order = data.orders[i];
    const eventResult = await scope.dao.removeWhere(COLLECTIONS.ORDER_EVENTS, { orderId: order._id });
    const messageResult = await scope.dao.removeWhere(COLLECTIONS.ORDER_MESSAGES, { orderId: order._id });
    removedEvents += eventResult.removed;
    removedMessages += messageResult.removed;
    await scope.dao.remove(COLLECTIONS.ORDERS, order._id);
  }
  for (let i = 0; i < data.bindings.length; i += 1) {
    await scope.dao.remove(COLLECTIONS.BINDINGS, data.bindings[i]._id);
  }
  for (let i = 0; i < data.failures.length; i += 1) {
    await scope.dao.remove(COLLECTIONS.RECOGNITION_FAILURES, data.failures[i]._id);
  }
  for (let i = 0; i < openids.length; i += 1) {
    await scope.dao.removeWhere(COLLECTIONS.UPLOAD_TICKETS, { openid: openids[i] });
  }
  const before = {
    orders: data.orders.length,
    events: removedEvents,
    messages: removedMessages,
    bindings: data.bindings.length,
    failures: data.failures.length
  };
  await scope.writeAudit(
    AUDIT_ACTIONS.TEST_DATA_PURGE,
    { type: 'test_account', id: 'ALL' },
    { before: before, after: { orders: 0, events: 0, messages: 0, bindings: 0, failures: 0 }, dryRun: false },
    requestKey
  );
  return { dryRun: false, purged: true, counts: before };
}

module.exports = {
  actions: {
    'admin.createTestAccount': createTestAccount,
    'admin.listTestAccounts': listTestAccounts,
    'admin.deleteTestAccount': deleteTestAccount,
    'admin.purgeTestData': purgeTestData
  }
};
