// handlers/admin/viewAsStart.js · admin.viewAsStart（真实账号 READONLY / 测试账号 TEST_WRITE；同开发者单活）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  assertValid,
  getCustomerByNo,
  getPartnerByNo,
  getUserByOpenid,
  idempotency
} = require('./_common');
const idGenerator = require('../../lib/id-generator');
const time = require('../../lib/time');

const MAX_ACTIVE_SESSIONS_SCAN = 100;
const MAX_TICKET_ATTEMPTS = 5;

function parseRole(value) {
  const check = sharedValidate.validateRole(value);
  assertValid(check, '角色不正确');
  return check.value;
}

function parseMode(value) {
  const check = sharedValidate.validateViewMode(value);
  assertValid(check, '切换模式不正确');
  return check.value;
}

function parseTargetNo(role, raw) {
  const check = role === enums.ROLES.CUSTOMER
    ? sharedValidate.validateCustomerNo(raw)
    : sharedValidate.validatePartnerNo(raw);
  assertValid(check, role === enums.ROLES.CUSTOMER ? '顾客编号格式不正确' : '兼职编号格式不正确');
  return check.canonical;
}

async function resolveTarget(scope, role, targetNo, mode) {
  if (role === enums.ROLES.CUSTOMER) {
    const customer = await getCustomerByNo(scope, targetNo);
    if (!customer) {
      throw errors.notFound('该用户当前不可查看');
    }
    const user = await getUserByOpenid(scope, customer._id);
    if (!user || user.status !== 'ACTIVE') {
      throw errors.notFound('该用户当前不可查看');
    }
    if (mode === enums.VIEW_MODE.TEST_WRITE && user.isTestAccount !== true) {
      throw errors.forbidden('真实账号不能使用测试可写模式');
    }
    if (mode === enums.VIEW_MODE.READONLY && user.isTestAccount === true) {
      throw errors.notFound('该用户当前不可查看');
    }
    return {
      targetId: customer._id,
      targetNo: customer.customerNo || targetNo,
      targetDisplayName: customer.displayName || '',
      targetAvatarFileId: customer.avatarFileId || '',
      targetIsTest: user.isTestAccount === true
    };
  }
  const partner = await getPartnerByNo(scope, targetNo);
  if (!partner || partner.status !== enums.PARTNER_STATUS.ACTIVE) {
    throw errors.notFound('该用户当前不可查看');
  }
  const user = await getUserByOpenid(scope, partner.openid);
  if (!user || user.status !== 'ACTIVE') {
    throw errors.notFound('该用户当前不可查看');
  }
  if (mode === enums.VIEW_MODE.TEST_WRITE && user.isTestAccount !== true) {
    throw errors.forbidden('真实账号不能使用测试可写模式');
  }
  if (mode === enums.VIEW_MODE.READONLY && user.isTestAccount === true) {
    throw errors.notFound('该用户当前不可查看');
  }
  return {
    targetId: partner.openid,
    targetNo: partner.partnerNo || targetNo,
    targetDisplayName: partner.displayName || '',
    targetAvatarFileId: partner.avatarFileId || '',
    targetIsTest: user.isTestAccount === true
  };
}

function assertUsableTarget(scope, target, role, mode) {
  if (!target) {
    throw errors.notFound('该用户当前不可查看');
  }
  if (target.targetId === scope.actorOpenid) {
    throw errors.forbidden('不能查看自己的账号');
  }
  if (mode === enums.VIEW_MODE.TEST_WRITE && !target.targetIsTest) {
    throw errors.forbidden('真实账号不能使用测试可写模式');
  }
  if (role !== enums.ROLES.CUSTOMER && role !== enums.ROLES.PARTNER) {
    throw errors.validation('role', '角色不正确');
  }
}

async function endSessionOfReplaced(scope, session) {
  const now = scope.now;
  const expired = !(session.expiresAt > now);
  await scope.dao.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, session._id, {
    endedAt: expired ? session.expiresAt : now,
    updatedAt: scope.nowDate
  });
  await scope.writeAudit(
    AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
    { type: 'view_session', id: session._id },
    {
      viewMode: session.viewMode || '',
      role: session.role || '',
      targetNo: session.targetNo || '',
      targetIsTest: !!session.targetIsTest,
      reason: 'REPLACED'
    },
    'switch-replaced:' + session._id
  );
}

// 同一开发者只保留一张有效票据：新开前结束旧的（新开覆盖旧的，审计 END 原因 REPLACED）
async function endActiveSessions(scope) {
  const rows = await scope.dao.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, {
    where: { adminOpenid: scope.actorOpenid, endedAt: null },
    orderBy: [['createdAt', 'desc']],
    limit: MAX_ACTIVE_SESSIONS_SCAN
  });
  for (let i = 0; i < rows.length; i += 1) {
    await endSessionOfReplaced(scope, rows[i]);
  }
}

function sessionPayload(session, duplicated) {
  const result = {
    viewTicket: session._id,
    viewMode: session.viewMode,
    role: session.role,
    targetNo: session.targetNo,
    targetDisplayName: session.targetDisplayName || '',
    targetIsTest: !!session.targetIsTest,
    expiresAt: session.expiresAt
  };
  if (session.targetAvatarFileId) {
    result.targetAvatarFileId = session.targetAvatarFileId;
  }
  if (duplicated) {
    result.duplicated = true;
  }
  return result;
}

async function insertSession(scope, doc, requestKey) {
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt += 1) {
    const viewTicket = idGenerator.generateViewTicket();
    try {
      await scope.dao.add(COLLECTIONS.ADMIN_VIEW_SESSIONS, Object.assign({}, doc, {
        _id: viewTicket,
        requestKey: requestKey
      }));
      return Object.assign({}, doc, { _id: viewTicket, requestKey: requestKey });
    } catch (error) {
      if (!scope.dao.isDuplicateError(error)) {
        throw error;
      }
      const existing = await scope.dao.findOne(COLLECTIONS.ADMIN_VIEW_SESSIONS, { where: { requestKey: requestKey }, limit: 1 });
      if (existing && existing.viewMode === doc.viewMode && existing.targetId === doc.targetId) {
        return existing;
      }
    }
  }
  throw errors.dependencyFailed('会话票据生成失败，请稍后重试');
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const role = parseRole(input.role);
  const mode = parseMode(input.mode);
  const targetNo = parseTargetNo(role, input.targetNo);
  const target = await resolveTarget(scope, role, targetNo, mode);
  assertUsableTarget(scope, target, role, mode);
  const requestKey = idempotency.viewSessionRequestKey(ctx);
  const existing = await scope.dao.findOne(COLLECTIONS.ADMIN_VIEW_SESSIONS, { where: { requestKey: requestKey }, limit: 1 });
  if (existing) {
    const sameTarget = existing.viewMode === mode && existing.targetId === target.targetId;
    const active = !existing.endedAt && existing.expiresAt > scope.now;
    if (sameTarget && active) {
      return sessionPayload(existing, true);
    }
    await scope.dao.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, existing._id, {
      requestKey: requestKey + ':replaced:' + scope.now,
      updatedAt: scope.nowDate
    });
  }
  const ttlMinutes = Number(scope.config.viewTicketTtlMinutes) || 30;
  const sessionDoc = {
    adminOpenid: scope.actorOpenid,
    developerNo: scope.developerNo,
    viewMode: mode,
    role: role,
    targetId: target.targetId,
    targetNo: target.targetNo,
    targetDisplayName: target.targetDisplayName,
    targetAvatarFileId: target.targetAvatarFileId,
    targetIsTest: target.targetIsTest,
    createdAt: scope.nowDate,
    expiresAt: time.addMinutes(scope.now, ttlMinutes),
    endedAt: null,
    updatedAt: scope.nowDate
  };
  await endActiveSessions(scope);
  const session = await insertSession(scope, sessionDoc, requestKey);
  await scope.writeAudit(
    AUDIT_ACTIONS.ACCOUNT_SWITCH_START,
    { type: 'view_session', id: session._id },
    {
      viewMode: mode,
      role: role,
      targetNo: target.targetNo,
      targetIsTest: target.targetIsTest,
      developerNo: scope.developerNo
    },
    idempotency.auditRequestKey(ctx)
  );
  return sessionPayload(session, false);
}

module.exports = handler;
