// cloudfunctions/cleanup/sweeps/viewSessions.js · 过期切换会话补 endedAt + 一次性审计；结束 7 天后物理删
// 口径：ENGINEERING §4.7 viewSessions / §4.8.3；审计名 ACCOUNT_SWITCH_EXPIRED（每票至多一条）。
'use strict';

const util = require('./_util');

const PURGE_AFTER_DAYS = 7;
const EXPIRED_SWEEP = 'viewSessions';

async function writeExpiredAudit(ctx, session) {
  const C = util.collectionsOf(ctx);
  const requestKey = 'switch-expired:' + String(session._id);
  const existing = await ctx.dao.findOne(C.ADMIN_AUDIT, { where: { requestKey } });
  if (existing) {
    return false;
  }
  await ctx.dao.add(C.ADMIN_AUDIT, {
    adminOpenid: session.adminOpenid || 'SYSTEM',
    developerNo: session.developerNo || 'SYSTEM',
    action: 'ACCOUNT_SWITCH_EXPIRED',
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
  return true;
}

async function runViewSessions(ctx) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const rows = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    orderBy: [['expiresAt', 'asc']],
    limit: util.BATCH
  });
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const session = rows[i];
    const expiresAt = util.msOf(session.expiresAt);
    if (session.endedAt || !expiresAt || expiresAt >= ctx.now) {
      continue;
    }
    scanned += 1;
    try {
      await ctx.dao.update(C.ADMIN_VIEW_SESSIONS, session._id, {
        endedAt: session.expiresAt,
        updatedAt: nowDate
      });
      await writeExpiredAudit(ctx, session);
      acted += 1;
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        continue;
      }
      failed += 1;
    }
  }
  const purgeDeadline = util.daysBefore(ctx.now, PURGE_AFTER_DAYS);
  const ended = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    orderBy: [['endedAt', 'asc']],
    limit: util.BATCH
  });
  for (let i = 0; i < ended.length; i += 1) {
    const session = ended[i];
    const endedAt = util.msOf(session.endedAt);
    if (!endedAt || endedAt >= purgeDeadline) {
      continue;
    }
    scanned += 1;
    try {
      await ctx.dao.remove(C.ADMIN_VIEW_SESSIONS, session._id);
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  PURGE_AFTER_DAYS,
  EXPIRED_SWEEP,
  runViewSessions
};
