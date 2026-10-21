// handlers/admin/revokeInvite.js · admin.revokeInvite（仅 UNUSED 可作废；REVOKED 重复调用幂等成功）
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
  codeTailOf
} = require('./_common');

const REVOCABLE_STATUSES = [enums.INVITATION_STATUS.UNUSED];
const TERMINAL_INVALID_STATUSES = [enums.INVITATION_STATUS.USED, enums.INVITATION_STATUS.EXPIRED];

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const codeCheck = assertValid(sharedValidate.validateInvitationCode(input.invitationCode), '邀请码格式不正确');
  const code = codeCheck.canonical;
  const reason = readNote(input.reason, 100, 'reason');
  const requestKey = auditKeyOf(ctx);
  const replay = await scope.findAudit(requestKey);
  if (replay) {
    return { codeTail: (replay.detail && replay.detail.codeTail) || codeTailOf(code), status: 'REVOKED', duplicated: true };
  }
  const invite = await scope.dao.findOne(COLLECTIONS.INVITATION_CODES, { where: { code: code } });
  if (!invite) {
    throw errors.notFound('邀请码不存在');
  }
  if (invite.status === enums.INVITATION_STATUS.REVOKED) {
    return { codeTail: codeTailOf(code), status: 'REVOKED', duplicated: true };
  }
  if (TERMINAL_INVALID_STATUSES.indexOf(invite.status) >= 0 || REVOCABLE_STATUSES.indexOf(invite.status) < 0) {
    throw errors.invalidState('只有未使用的邀请码可以作废');
  }
  await scope.dao.update(COLLECTIONS.INVITATION_CODES, invite._id, {
    status: enums.INVITATION_STATUS.REVOKED,
    revokedAt: scope.nowDate,
    revokedBy: scope.developerNo,
    updatedAt: scope.nowDate
  });
  await scope.writeAudit(
    AUDIT_ACTIONS.INVITE_REVOKE,
    { type: 'invitation_code', id: code },
    { codeTail: codeTailOf(code), reason: reason },
    requestKey
  );
  return { codeTail: codeTailOf(code), status: 'REVOKED' };
}

module.exports = handler;
