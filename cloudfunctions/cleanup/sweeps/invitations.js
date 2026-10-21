// cloudfunctions/cleanup/sweeps/invitations.js · 过期邀请码置 EXPIRED（仅 UNUSED；不自动重新生效）
// 口径：ENGINEERING §4.7 invitationCodes；DATA_MODEL §4.3 状态机。
'use strict';

const util = require('./_util');

async function runInvitationCodes(ctx) {
  const C = util.collectionsOf(ctx);
  const rows = await util.scanPage(
    ctx,
    C.INVITATION_CODES,
    { status: util.enums.INVITATION_STATUS.UNUSED },
    [['expiresAt', 'asc']]
  );
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const code = rows[i];
    const expiresAt = util.msOf(code.expiresAt);
    if (!expiresAt || expiresAt >= ctx.now) {
      continue;
    }
    scanned += 1;
    try {
      await ctx.dao.update(C.INVITATION_CODES, code._id, {
        status: util.enums.INVITATION_STATUS.EXPIRED,
        updatedAt: util.nowDateOf(ctx)
      });
      acted += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  runInvitationCodes
};
