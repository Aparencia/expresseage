// handlers/admin/setCustomerStatus.js · admin.setCustomerStatus（D68：顾客账号停用/恢复）
// 口径：CONTRACT §13 D68、DATA_MODEL §2.1/§7；UX_DEVELOPER §3.3/§3.4。
// 边界：只改 users.status（ACTIVE↔SUSPENDED）与 users.suspendedAt/suspendedReason，
//   **不动** customers 资料、bindings 绑定与 orders 状态（停用=冻结登录与写；恢复即原样可用）。
//   注销（DEACTIVATED）不可逆：既不能恢复也不能再停用 → INVALID_TRANSITION。
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
  assertValid,
  readNote,
  getCustomerByNo,
  getUserByOpenid
} = require('./_common');
const dto = require('./_dto');

const MANAGED_STATUSES = [enums.USER_STATUS.ACTIVE, enums.USER_STATUS.SUSPENDED];
const RESTORE_REASON_DEFAULT = '后台恢复';

function parseStatus(value) {
  if (MANAGED_STATUSES.indexOf(value) < 0) {
    throw errors.validation('status', '只能设为正常或停用');
  }
  return value;
}

function assertTransition(from, to) {
  if (from === to) return;
  if (from === enums.USER_STATUS.DEACTIVATED) {
    throw errors.invalidTransition('已注销的顾客账号不能恢复或停用');
  }
  if (to === enums.USER_STATUS.SUSPENDED && from !== enums.USER_STATUS.ACTIVE) {
    throw errors.invalidTransition('当前状态不支持停用');
  }
  if (to === enums.USER_STATUS.ACTIVE && from !== enums.USER_STATUS.SUSPENDED) {
    throw errors.invalidTransition('当前状态不支持恢复');
  }
}

async function replayOf(scope, replay) {
  if (!replay) {
    return null;
  }
  const customer = await getCustomerByNo(scope, (replay.target && replay.target.id) || '');
  if (!customer) {
    return null;
  }
  const user = await getUserByOpenid(scope, customer._id);
  return { customer: dto.customerBrief(customer, { user: user, isTest: false }), duplicated: true };
}

async function applyStatus(scope, customerId, status, reason) {
  await scope.dao.transaction(async (trx) => {
    const patch = { status: status, updatedAt: scope.nowDate };
    if (status === enums.USER_STATUS.SUSPENDED) {
      patch.suspendedAt = scope.nowDate;
      patch.suspendedReason = reason;
    } else {
      patch.suspendedAt = null;
      patch.suspendedReason = '';
    }
    await trx.update(COLLECTIONS.USERS, customerId, patch);
  });
}

async function writeStatusAudit(scope, info) {
  await scope.writeAudit(info.action, { type: 'customer', id: info.customerNo }, {
    customerNo: info.customerNo,
    from: info.from,
    to: info.status,
    toState: info.status,
    reason: info.reason,
    requestId: info.clientRequestId
  }, info.requestKey);
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const clientRequestId = requireClientRequestId(ctx);
  const input = payload || {};
  const check = assertValid(sharedValidate.validateCustomerNo(input.customerNo), '顾客编号格式不正确');
  const status = parseStatus(input.status);
  const reason = readNote(input.reason, 100, 'reason');
  if (status === enums.USER_STATUS.SUSPENDED && !reason) {
    throw errors.validation('reason', '请填写停用原因');
  }
  const requestKey = auditKeyOf(ctx);
  const replay = await replayOf(scope, await scope.findAudit(requestKey));
  if (replay) {
    return replay;
  }
  const customer = await getCustomerByNo(scope, check.canonical);
  if (!customer) {
    throw errors.notFound('顾客不存在');
  }
  if (await scope.isTestAccount(customer._id)) {
    throw errors.invalidState('测试账号不能执行真实治理动作');
  }
  const user = await getUserByOpenid(scope, customer._id);
  if (!user) {
    throw errors.notFound('顾客不存在');
  }
  const from = user.status || enums.USER_STATUS.ACTIVE;
  assertTransition(from, status);
  await applyStatus(scope, customer._id, status, reason);
  await writeStatusAudit(scope, {
    action: status === enums.USER_STATUS.ACTIVE ? AUDIT_ACTIONS.CUSTOMER_RESTORE : AUDIT_ACTIONS.CUSTOMER_SUSPEND,
    customerNo: check.canonical,
    from: from,
    status: status,
    reason: status === enums.USER_STATUS.ACTIVE ? (reason || RESTORE_REASON_DEFAULT) : reason,
    requestKey: requestKey,
    clientRequestId: clientRequestId
  });
  const fresh = await getCustomerByNo(scope, check.canonical);
  const freshUser = await getUserByOpenid(scope, customer._id);
  return { customer: dto.customerBrief(fresh || customer, { user: freshUser || user, isTest: false }) };
}

module.exports = handler;
