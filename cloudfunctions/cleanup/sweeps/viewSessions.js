// cloudfunctions/cleanup/sweeps/viewSessions.js · 过期切换会话补 endedAt + 一次性审计；结束 7 天后物理删
// 口径：ENGINEERING §4.7 viewSessions / §4.8.3；DATA_MODEL §10.2 步骤 2 / §7.7。
//   过期：expiresAt<now 且未结束 → endedAt=expiresAt + 一条 ACCOUNT_SWITCH_EXPIRED（每票至多一条）；
//   物理删：endedAt<now-7d。查询分别按"未结束/已结束"过滤，避免已结束会话占满批 100 挡住过期未结束票据。
'use strict';

const util = require('./_util');

const PURGE_AFTER_DAYS = 7;
const EXPIRED_SWEEP = 'viewSessions';

async function writeExpiredAudit(ctx, session) {
  const C = util.collectionsOf(ctx);
  const requestKey = 'switch-expired:' + String(session._id);
  return util.writeAuditOnce(ctx, {
    adminOpenid: session.adminOpenid || util.SYSTEM,
    developerNo: session.developerNo || util.SYSTEM,
    action: util.audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED,
    target: { type: 'view_session', id: String(session._id) },
    detail: {
      viewMode: session.viewMode || '',
      role: session.role || '',
      targetNo: session.targetNo || '',
      targetIsTest: session.targetIsTest === true,
      reason: 'EXPIRED'
    },
    at: util.nowDateOf(ctx),
    requestKey
  });
}

// 未结束 = endedAt 为 null（契约）；兼容历史数据用 0（epoch）表示未结束。
function unendedWhere(ctx) {
  const command = util.commandOf(ctx);
  if (command && typeof command.in === 'function') {
    return { endedAt: command.in([null, 0]) };
  }
  return {};
}

function endedWhere(ctx) {
  const command = util.commandOf(ctx);
  if (command && typeof command.exists === 'function') {
    return { endedAt: command.exists(true) };
  }
  return {};
}

async function expirePass(ctx, counters) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const rows = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    where: unendedWhere(ctx),
    orderBy: [['expiresAt', 'asc']],
    limit: util.BATCH
  });
  for (let i = 0; i < rows.length; i += 1) {
    const session = rows[i];
    const expiresAt = util.msOf(session.expiresAt);
    if (session.endedAt || !expiresAt || expiresAt >= ctx.now) {
      continue;
    }
    counters.scanned += 1;
    try {
      await ctx.dao.update(C.ADMIN_VIEW_SESSIONS, session._id, {
        endedAt: new Date(expiresAt),
        updatedAt: nowDate
      });
      await writeExpiredAudit(ctx, session);
      counters.acted += 1;
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        continue;
      }
      counters.failed += 1;
    }
  }
}

async function purgePass(ctx, counters) {
  const C = util.collectionsOf(ctx);
  const purgeDeadline = util.daysBefore(ctx.now, PURGE_AFTER_DAYS);
  const rows = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    where: endedWhere(ctx),
    orderBy: [['endedAt', 'asc']],
    limit: util.BATCH
  });
  for (let i = 0; i < rows.length; i += 1) {
    const session = rows[i];
    const endedAt = util.msOf(session.endedAt);
    if (!endedAt || endedAt >= purgeDeadline) {
      continue;
    }
    counters.scanned += 1;
    try {
      await ctx.dao.remove(C.ADMIN_VIEW_SESSIONS, session._id);
      counters.acted += 1;
    } catch (error) {
      counters.failed += 1;
    }
  }
}

async function runViewSessions(ctx) {
  const counters = { scanned: 0, acted: 0, failed: 0 };
  await expirePass(ctx, counters);
  await purgePass(ctx, counters);
  return counters;
}

module.exports = {
  PURGE_AFTER_DAYS,
  EXPIRED_SWEEP,
  runViewSessions
};
