// handlers/partner/saveCustomerNote.js · partner.saveCustomerNote（兼职私有备注，顾客不可见）
// 口径：CONTRACT v0.9 §5.2（≤100 字）；DATA_MODEL §2.4（bindings.partnerNote，随顾客注销删除）、
//       §7.4 表格与「批 7」④（bindingId 必须属于当前兼职且 status=ACTIVE；已释放→NOT_FOUND；同值不写）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const customer = require('./_customer');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const binding = await customer.requireOwnedBinding(ctx, partner, input.bindingId);
  if (binding.status !== enums.BINDING_STATUS.ACTIVE) {
    throw errors.notFound('绑定关系不存在或已解除');
  }
  const checked = validate.validatePartnerNote(input.partnerNote);
  if (!checked.ok) {
    throw errors.validation('partnerNote', '备注不能超过 100 字');
  }
  if (checked.value !== customer.textOf(binding.partnerNote)) {
    await ctx.dao.update(COLLECTIONS.BINDINGS, binding._id, {
      partnerNote: checked.value,
      updatedAt: identity.nowDate(ctx)
    });
  }
  return { partnerNote: checked.value };
}

module.exports = { handler };
