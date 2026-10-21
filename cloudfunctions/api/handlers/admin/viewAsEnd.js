// handlers/admin/viewAsEnd.js · admin.viewAsEnd（结束切换会话；幂等；仅票据发起人可结束）
// 写入集合：admin_view_sessions（置 endedAt；随后写 ACCOUNT_SWITCH_END 审计）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  errors,
  sharedValidate,
  createAdminScope,
  assertValid
} = require('./_common');

async function handler(ctx, payload) {
  // 退出会话是唯一允许「带切换会话身份」执行的 admin 动作：只结束本开发者自己的票据，
  // 不写任何业务数据（其余 admin 动作仍由 requireAdmin 默认拒绝票据身份）。
  const scope = await createAdminScope(ctx, { allowViewMode: true });
  const input = payload || {};
  const ticketCheck = assertValid(sharedValidate.validateToken(input.viewTicket, 'viewTicket'), '会话标识不正确');
  const viewTicket = ticketCheck.value;
  const session = await scope.dao.get(COLLECTIONS.ADMIN_VIEW_SESSIONS, viewTicket);
  if (!session || session.adminOpenid !== scope.actorOpenid) {
    throw errors.forbidden('无权结束该切换会话');
  }
  if (session.endedAt) {
    return { endedAt: session.endedAt, duplicated: true };
  }
  await scope.dao.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, viewTicket, {
    endedAt: scope.nowDate,
    updatedAt: scope.nowDate
  });
  await scope.writeAudit(
    AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
    { type: 'view_session', id: viewTicket },
    {
      viewMode: session.viewMode || '',
      role: session.role || '',
      targetNo: session.targetNo || '',
      targetIsTest: !!session.targetIsTest,
      reason: 'EXIT'
    },
    'switch-end:' + viewTicket
  );
  return { endedAt: scope.nowDate };
}

module.exports = handler;
