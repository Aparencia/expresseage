// handlers/partner/saveProfile.js · partner.saveProfile（兼职昵称/头像；仅本人 ACTIVE）
// 口径：CONTRACT v0.9 §4.2/§11；DATA_MODEL §2.3/§7.4。昵称落库前过 security.msgSecCheck v2；
// 头像消费 avatarTicket（purpose=AVATAR、归属 effectiveOpenid、路径前缀在 upload 域校验、≤avatarMaxBytes、jpg/png），
// 替换即删旧文件；avatarFileId='' 显式回默认头像。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const validate = require('../../shared/validate');
const { partnerSelf } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const uploadCommon = require('../upload/_common');
const configCommon = require('../config/_common');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const patch = { updatedAt: nowDate };

  if (input.displayName !== undefined) {
    const checked = validate.validateDisplayName(input.displayName);
    if (!checked.ok) {
      throw errors.validation('displayName', '请填写 1~20 字的昵称');
    }
    if (checked.value !== partner.displayName) {
      await identity.assertTextSafe(ctx, checked.value, 'displayName');
      patch.displayName = checked.value;
      patch.profileUpdatedAt = nowDate;
    }
  }

  let avatarTicket = null;
  if (input.avatarTicket || input.avatarTicketId) {
    const config = await configCommon.loadRuntimeConfig(ctx);
    avatarTicket = await uploadCommon.loadAvatarTicket(ctx, input.avatarTicket || input.avatarTicketId, nowMs);
    patch.avatarFileId = uploadCommon.assertAvatarFile(
      input.avatarFileId || input.fileId || '',
      avatarTicket,
      uploadCommon.avatarMaxBytes(config)
    );
    patch.profileUpdatedAt = nowDate;
  } else if (input.avatarFileId === '') {
    patch.avatarFileId = '';
    patch.profileUpdatedAt = nowDate;
  }

  if (Object.keys(patch).length > 1) {
    await ctx.dao.update(COLLECTIONS.PARTNERS, partner._id, patch);
  }
  if (avatarTicket) {
    if (partner.avatarFileId && partner.avatarFileId !== patch.avatarFileId) {
      await identity.tryDeleteFile(ctx, partner.avatarFileId);
    }
    await uploadCommon.consumeTicket(ctx, avatarTicket, nowMs);
  }
  const fresh = await identity.loadPartnerById(ctx, partner._id);
  return { partner: partnerSelf(fresh || partner) };
}

module.exports = { handler };
