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
      // 条件更新（DATA_MODEL §10.2「status='UNUSED' && expiresAt<now → 条件更新 EXPIRED」）：
      // 扫描与写入之间若被 partner.activate 事务改成 USED，则命中 0 行、不改写（防 USED→EXPIRED 非法组合）。
      const result = await ctx.dao.updateWhere(C.INVITATION_CODES, {
        _id: code._id,
        status: util.enums.INVITATION_STATUS.UNUSED
      }, {
        status: util.enums.INVITATION_STATUS.EXPIRED,
        updatedAt: util.nowDateOf(ctx)
      });
      if (result.updated > 0) {
        acted += 1;
      }
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  runInvitationCodes
};
