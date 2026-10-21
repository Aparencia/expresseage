// handlers/partner/getPublic.js · partner.getPublic（凭完整 partnerNo 的公开预览）
// 口径：CONTRACT v0.9 §5.3/§4.2；DATA_MODEL §2.3 读屏蔽：未绑定可预览、绑定前只回昵称不回头像；
// 测试账号对真实顾客返回 NOT_FOUND（仅同一 TEST_WRITE 会话内可预览）；限流 5 次/日/顾客由中间件承担。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { partnerPublic } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

async function handler(ctx, payload) {
  const scope = identity.scopeOf(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const codeResult = validate.validatePartnerNo(input.partnerNo);
  if (!codeResult.ok) {
    throw errors.validation('partnerNo', '兼职编号格式不正确，请核对后重试');
  }
  const partner = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { partnerNo: codeResult.canonical } });
  if (!partner) {
    throw errors.notFound('该兼职编号不存在，请核对后重试');
  }
  const partnerUser = await identity.loadUser(ctx, partner.openid);
  if (partnerUser && partnerUser.isTestAccount === true && !scope.testWrite) {
    throw errors.notFound('该兼职编号不存在，请核对后重试');
  }
  if (partner.status === enums.PARTNER_STATUS.CLOSED) {
    throw errors.notFound('该兼职编号不存在，请核对后重试');
  }
  let bound = false;
  if (scope.role === enums.ROLES.CUSTOMER || scope.role === '') {
    const binding = await identity.getActiveBinding(ctx, scope.openid);
    bound = !!(binding && binding.partnerId === partner._id);
  }
  return partnerPublic(partner, { bound });
}

module.exports = { handler };
