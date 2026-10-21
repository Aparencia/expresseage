// handlers/partner/activate.js · partner.activate（邀请码激活；唯一兼职准入路径）
// 口径：CONTRACT v0.9 §1/§2 D3/§10；DATA_MODEL §2.3/§2.8/§4.3/§7.4。
// 错误映射：不存在/已作废→NOT_FOUND；已过期→INVITE_EXPIRED；已使用→INVITE_USED；格式错→VALIDATION_FAILED。
// 纪律：激活成功才生成 partnerNo（唯一索引兜底），邀请码 UNUSED→USED 与用户 roles 增补在同一事务内。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { insertUnique, generatePartnerNo } = require('../../lib/id-generator');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const uploadCommon = require('../upload/_common');
const configCommon = require('../config/_common');

function emptyServiceConfig() {
  return {
    services: enums.SERVICES.map((item) => ({ code: item.code, enabled: true })),
    zones: enums.ZONES ? enums.ZONES.slice() : ['D', 'X', 'N', 'B', 'C'],
    acceptingOrders: true
  };
}

function buildPartnerDoc(openid, payload, nowDate) {
  return {
    openid,
    displayName: payload.displayName,
    avatarFileId: payload.avatarFileId || '',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: emptyServiceConfig(),
    stats: { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0, updatedAt: nowDate },
    activatedAt: nowDate,
    createdAt: nowDate,
    updatedAt: nowDate
  };
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = identity.scopeOf(ctx);
  if (scope.viewMode) {
    throw errors.forbidden('切换会话不能激活兼职身份');
  }
  if (ctx.identity && ctx.identity.developerNo) {
    throw errors.forbidden('开发者账号不激活兼职业务身份');
  }
  const input = payload && typeof payload === 'object' ? payload : {};
  const codeResult = validate.validateInvitationCode(input.invitationCode);
  if (!codeResult.ok) {
    throw errors.validation('invitationCode', '邀请码格式不正确，请核对后重试');
  }
  const nameResult = validate.validateDisplayName(input.displayName);
  if (!nameResult.ok) {
    throw errors.validation('displayName', '请填写 1~20 字的昵称');
  }
  await identity.assertTextSafe(ctx, nameResult.value, 'displayName');

  const existingPartner = await identity.loadPartnerByOpenid(ctx, scope.openid);
  if (existingPartner) {
    throw errors.conflict('该微信号已是兼职，无需重复激活');
  }
  const user = await identity.loadUser(ctx, scope.openid);
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const config = await configCommon.loadRuntimeConfig(ctx);

  let avatarTicket = null;
  let avatarFileId = '';
  const avatarTicketId = input.avatarTicket || input.avatarTicketId || '';
  if (avatarTicketId) {
    avatarTicket = await uploadCommon.loadAvatarTicket(ctx, avatarTicketId, nowMs);
    avatarFileId = uploadCommon.assertAvatarFile(input.avatarFileId || input.fileId || '', avatarTicket, uploadCommon.avatarMaxBytes(config));
  }

  const created = await activateInTransaction(ctx, {
    scope,
    user,
    code: codeResult.canonical,
    displayName: nameResult.value,
    avatarFileId,
    nowMs,
    nowDate
  });

  if (avatarTicket) {
    await uploadCommon.consumeTicket(ctx, avatarTicket, nowMs);
  }
  return {
    partnerNo: created.partnerNo,
    partner: {
      partnerNo: created.partnerNo,
      displayName: nameResult.value,
      avatarFileId,
      status: enums.PARTNER_STATUS.ACTIVE,
      serviceConfig: created.serviceConfig
    },
    roles: created.roles
  };
}

async function activateInTransaction(ctx, options) {
  const opts = options;
  const attempt = async (tries) => {
    try {
      return await ctx.dao.transaction(async (trx) => {
        const invitation = await trx.findOne(COLLECTIONS.INVITATION_CODES, { where: { code: opts.code } });
        if (!invitation || invitation.status === enums.INVITATION_STATUS.REVOKED) {
          throw errors.notFound('邀请码不存在或已作废，请向开发者索取新的邀请码');
        }
        if (invitation.status === enums.INVITATION_STATUS.USED) {
          throw errors.inviteUsed('邀请码已被使用，请向开发者索取新的邀请码');
        }
        if (invitation.status === enums.INVITATION_STATUS.EXPIRED || time.isPast(invitation.expiresAt, opts.nowMs)) {
          throw errors.inviteExpired('邀请码已过期，请向开发者索取新的邀请码');
        }
        const doc = buildPartnerDoc(opts.scope.openid, { displayName: opts.displayName, avatarFileId: opts.avatarFileId }, opts.nowDate);
        const inserted = await insertUnique(trx, COLLECTIONS.PARTNERS, {
          field: 'partnerNo',
          generate: () => (ctx.ids && typeof ctx.ids.partnerNo === 'function' ? ctx.ids.partnerNo() : generatePartnerNo()),
          build: (partnerNo) => Object.assign({ partnerNo }, doc)
        });
        await trx.update(COLLECTIONS.INVITATION_CODES, invitation._id, {
          status: enums.INVITATION_STATUS.USED,
          usedBy: inserted._id,
          usedAt: opts.nowDate,
          updatedAt: opts.nowDate
        });
        const roles = opts.user && Array.isArray(opts.user.roles) ? opts.user.roles.slice() : [];
        if (roles.indexOf(enums.ROLES.PARTNER) < 0) {
          roles.push(enums.ROLES.PARTNER);
        }
        await trx.update(COLLECTIONS.USERS, opts.scope.openid, { roles, updatedAt: opts.nowDate });
        return { partnerNo: inserted.value, serviceConfig: doc.serviceConfig, roles, partnerId: inserted._id };
      });
    } catch (error) {
      if (tries > 0 && ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        return attempt(tries - 1);
      }
      throw error;
    }
  };
  return attempt(4);
}

module.exports = { handler };
