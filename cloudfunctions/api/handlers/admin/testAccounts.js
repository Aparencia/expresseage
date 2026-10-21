// handlers/admin/testAccounts.js · 测试账号四动作专用 handler（#28：删除/清空只走本文件，不进业务路径）
// createTestAccount / listTestAccounts / deleteTestAccount / purgeTestData；不与真实治理动作混用。
// 口径：ENGINEERING §4.11、DATA_MODEL §2.1/§4.10/§7.6/§7.7。
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
const ops = require('./_test-account-ops');

const CONFIRM_DELETE = '删除';
const CONFIRM_PURGE = '清空';

function confirmedBy(input, expected) {
  if (input.confirm === true) {
    return true;
  }
  return sharedValidate.validateConfirmText(input.confirmText, expected).ok;
}

// admin_audit.requestKey 唯一，但同一 requestKey 也可能来自其它 admin 动作；
// 重放判定必须核对动作名，否则会把别人的审计当成本动作的重放（假 duplicated、真实写入丢失）。
async function replayOf(scope, action) {
  const record = await scope.findAudit(scope.auditKey());
  if (!record || record.action !== action) {
    return null;
  }
  return record;
}

function roleOfUser(user) {
  const roles = helpers.rolesOf(user);
  return roles.indexOf(enums.ROLES.CUSTOMER) >= 0 ? enums.ROLES.CUSTOMER : enums.ROLES.PARTNER;
}

function deleteCountsOf(data, files) {
  return {
    orders: data.orders.length,
    events: data.events,
    messages: data.messages,
    bindings: data.bindings.length,
    failures: data.failures.length,
    tickets: data.tickets,
    avatarFiles: files
  };
}

function purgeCountsOf(data) {
  return {
    orders: data.orders.length,
    events: data.events,
    messages: data.messages,
    bindings: data.bindings.length,
    failures: data.failures.length,
    tickets: data.tickets
  };
}

function zeroPurgeCounts() {
  return { orders: 0, events: 0, messages: 0, bindings: 0, failures: 0, tickets: 0 };
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
  const replay = await helpers.replayCreate(scope, await replayOf(scope, AUDIT_ACTIONS.TEST_ACCOUNT_CREATE));
  if (replay) {
    return replay;
  }
  const quota = await helpers.quotaOf(scope);
  if (quota.perRole[role] >= quota.maxPerRole || quota.total >= helpers.TOTAL_TEST_ACCOUNT_LIMIT) {
    // 配额超限按 DATA_MODEL §4.10/§7.6 映射 VALIDATION_FAILED（不新增错误码）
    throw errors.validation('role', '测试账号数量已达上限（每角色 ' + quota.maxPerRole + ' 个、合计 6 个）');
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
    customerNo: role === enums.ROLES.CUSTOMER ? created.targetNo : '',
    partnerNo: role === enums.ROLES.PARTNER ? created.targetNo : '',
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
  const replay = await replayOf(scope, AUDIT_ACTIONS.TEST_ACCOUNT_DELETE);
  if (replay && !dryRun) {
    return {
      deleted: true,
      targetNo: (replay.target && replay.target.id) || identifier,
      removedCounts: (replay.detail && replay.detail.before) || ops.zeroCounts(),
      sessionsEnded: (replay.detail && replay.detail.sessionsEnded) || 0,
      duplicated: true
    };
  }
  if (!dryRun && !confirmedBy(input, CONFIRM_DELETE)) {
    throw errors.validation('confirmText', '请二次确认删除（确认文案需为「删除」）');
  }
  const user = await ops.resolveTestUser(scope, identifier);
  await ops.assertNoRealReference(scope, user);
  const data = await ops.countCascade(scope, user);
  const files = ops.filesOf(data).length;
  const sessionsEnded = await ops.countSessionsOfTargets(scope, [user._id]);
  const counts = deleteCountsOf(data, files);
  const role = roleOfUser(user);
  const targetNo = role === enums.ROLES.CUSTOMER
    ? (data.customer && data.customer.customerNo) || ''
    : (data.partner && data.partner.partnerNo) || '';
  if (dryRun) {
    return {
      dryRun: true,
      deleted: false,
      targetNo: targetNo || identifier,
      removedCounts: counts,
      sessionsEnded: sessionsEnded,
      willDelete: true
    };
  }
  const removed = await ops.cascadeDelete(scope, user, data);
  await scope.writeAudit(
    AUDIT_ACTIONS.TEST_ACCOUNT_DELETE,
    { type: 'test_account', id: targetNo || identifier },
    {
      role: role,
      targetNo: targetNo,
      before: counts,
      after: ops.zeroCounts(),
      sessionsEnded: removed.sessionsEnded,
      dryRun: false
    },
    requestKey
  );
  return {
    deleted: true,
    targetNo: targetNo || identifier,
    removedCounts: removed,
    sessionsEnded: removed.sessionsEnded
  };
}

async function purgeTestData(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const dryRun = input.dryRun === true;
  const requestKey = auditKeyOf(ctx);
  const replay = await replayOf(scope, AUDIT_ACTIONS.TEST_DATA_PURGE);
  if (replay && !dryRun) {
    return {
      dryRun: false,
      purged: true,
      counts: (replay.detail && replay.detail.before) || zeroPurgeCounts(),
      sessionsEnded: (replay.detail && replay.detail.sessionsEnded) || 0,
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
  await ops.assertNoRealReferenceToOpenids(scope, openids);
  const data = await ops.collectTestData(scope, openids);
  const sessionsEnded = await ops.countSessionsOfTargets(scope, openids);
  const before = purgeCountsOf(data);
  if (dryRun) {
    return {
      dryRun: true,
      purged: false,
      accounts: openids.length,
      counts: before,
      sessionsEnded: sessionsEnded
    };
  }
  const removed = await ops.purgeCollectedData(scope, openids, data);
  await scope.writeAudit(
    AUDIT_ACTIONS.TEST_DATA_PURGE,
    { type: 'test_account', id: 'ALL' },
    {
      accounts: openids.length,
      before: before,
      after: zeroPurgeCounts(),
      sessionsEnded: removed.sessionsEnded,
      dryRun: false
    },
    requestKey
  );
  return {
    dryRun: false,
    purged: true,
    counts: before,
    sessionsEnded: removed.sessionsEnded
  };
}

module.exports = {
  actions: {
    'admin.createTestAccount': createTestAccount,
    'admin.listTestAccounts': listTestAccounts,
    'admin.deleteTestAccount': deleteTestAccount,
    'admin.purgeTestData': purgeTestData
  }
};
