// handlers/user/deleteAccount.js · user.deleteAccount（顾客注销申请；有进行中订单则拒绝）
// 口径：CONTRACT v0.9 §11.4；DATA_MODEL §2.1/§10.4（users.deletionRequestedAt，cleanup 30 天内物理删）。
// 副作用：撤销 ACTIVE 绑定（CUSTOMER_ACCOUNT_CLOSED）+ 用户置 DEACTIVATED；资料匿名化与文件删除由 cleanup 执行。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const identity = require('./_common');
const bindCommon = require('../bind/_common');
const { errors } = require('../../lib/errors');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = await identity.assertBusinessRole(ctx, enums.ROLES.CUSTOMER);
  const input = payload || {};
  const confirm = validate.validateConfirmText(input.confirmText, '注销');
  if (!confirm.ok) {
    throw errors.validation('confirmText', '请输入「注销」确认操作');
  }
  const user = await identity.loadUser(ctx, scope.openid);
  if (user && user.deletionRequestedAt) {
    return { deletionRequestedAt: new Date(user.deletionRequestedAt).getTime(), duplicated: true };
  }
  const activeOrder = await identity.hasActiveOrder(ctx, scope.openid, '');
  if (activeOrder) {
    throw errors.invalidState('还有进行中的订单，请完成或取消后再注销');
  }
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const binding = await identity.getActiveBinding(ctx, scope.openid);
  await ctx.dao.transaction(async (trx) => {
    if (binding) {
      await bindCommon.releaseBindingInTx(trx, binding, {
        reason: 'CUSTOMER_ACCOUNT_CLOSED',
        note: input.reason && typeof input.reason === 'string' ? input.reason.slice(0, 100) : '',
        releasedBy: enums.CANCELLED_BY.CUSTOMER,
        nowDate
      });
    }
    await trx.update(COLLECTIONS.USERS, scope.openid, {
      status: enums.USER_STATUS.DEACTIVATED,
      deletionRequestedAt: nowDate,
      updatedAt: nowDate
    });
  });
  return { deletionRequestedAt: nowMs, duplicated: false };
}

module.exports = { handler };
