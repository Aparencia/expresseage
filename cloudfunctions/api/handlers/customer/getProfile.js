// handlers/customer/getProfile.js · customer.getProfile（本人/切换会话目标视角；不返回 openid）
// 口径：DATA_MODEL §2.2/§7.3（顾客读自己全字段；切换会话按目标本人 DTO 返回）。
'use strict';

const enums = require('../../shared/enums');
const { customerSelf } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  if (scope.role && scope.role !== enums.ROLES.CUSTOMER) {
    throw errors.forbidden('当前身份不能查看顾客资料');
  }
  const customer = await identity.loadCustomer(ctx, scope.openid);
  if (!customer) {
    throw errors.notFound('顾客资料不存在，请先完善资料');
  }
  return customerSelf(customer);
}

module.exports = { handler };
