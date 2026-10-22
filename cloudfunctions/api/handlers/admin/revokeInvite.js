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
  // 条件更新（DATA_MODEL §4.3 状态机：仅 UNUSED→REVOKED）：读后写之间若被激活事务改成 USED，
  // 条件更新命中 0 行 → 回读判定实际状态（已作废=幂等成功；其它终态=INVALID_STATE），不覆盖非法组合。
  const updated = await scope.dao.updateWhere(COLLECTIONS.INVITATION_CODES, {
    _id: invite._id,
    status: enums.INVITATION_STATUS.UNUSED
  }, {
    status: enums.INVITATION_STATUS.REVOKED,
    revokedAt: scope.nowDate,
    revokedBy: scope.developerNo,
    updatedAt: scope.nowDate
  });
  if (updated.updated !== 1) {
    const fresh = await scope.dao.get(COLLECTIONS.INVITATION_CODES, invite._id);
    if (fresh && fresh.status === enums.INVITATION_STATUS.REVOKED) {
      return { codeTail: codeTailOf(code), status: 'REVOKED', duplicated: true };
    }
    throw errors.invalidState('邀请码状态已变化，请刷新后重试');
  }
  await scope.writeAudit(
    AUDIT_ACTIONS.INVITE_REVOKE,
    { type: 'invitation_code', id: code },
    { codeTail: codeTailOf(code), reason: reason },
    requestKey
  );
  return { codeTail: codeTailOf(code), status: 'REVOKED' };
}

module.exports = handler;
