// handlers/partner/activate.js · partner.activate（邀请码激活；唯一兼职准入路径）
// 口径：CONTRACT v0.9 §1/§2 D3/§10；DATA_MODEL §2.3/§2.8/§4.3/§7.4。
// 错误映射：不存在/已作废→NOT_FOUND；已过期→INVITE_EXPIRED；已使用→INVITE_USED；格式错→VALIDATION_FAILED。
// 昵称落库前过 security.msgSecCheck v2（同 saveProfile 注入点）；激活成功才生成 partnerNo（唯一索引兜底）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const zones = require('../../shared/zones');
const validate = require('../../shared/validate');
const { insertUnique, generatePartnerNo } = require('../../lib/id-generator');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const uploadCommon = require('../upload/_common');
const configCommon = require('../config/_common');

// D41（2026-10-28 用户拍板）：默认服务目录取运行时 `config.serviceCatalog`（configCommon 读层已按新 5 类归一，
// 旧库/含已停用 PICKUP_DOOR 的目录会回退新默认），保持既有「全部启用」行为；不在这里另写一份码表。
function emptyServiceConfig(config) {
  const catalog = configCommon.serviceCatalogOf(config);
  return {
    services: catalog.map((item) => ({ code: item.code, enabled: true })),
    zones: zones.ZONES.slice(),
    acceptingOrders: true
  };
}

function buildPartnerDoc(openid, payload, nowDate, config) {
  return {
    openid,
    displayName: payload.displayName,
    avatarFileId: payload.avatarFileId || '',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: emptyServiceConfig(config),
    stats: { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0, updatedAt: nowDate },
    activatedAt: nowDate,
    createdAt: nowDate,
    updatedAt: nowDate
  };
}

// 身份前置：写权限/切换会话/开发者账号（不激活业务身份）
function assertActivationAllowed(ctx) {
  identity.assertWritable(ctx);
  const scope = identity.scopeOf(ctx);
  if (scope.viewMode) {
    throw errors.forbidden('切换会话不能激活兼职身份');
  }
  if (ctx.identity && ctx.identity.developerNo) {
    throw errors.forbidden('开发者账号不激活兼职业务身份');
  }
  return scope;
}

// 入参格式闸（邀请码/昵称；昵称内容安全在外层做，保持原调用顺序）
function readActivationInput(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const codeResult = validate.validateInvitationCode(input.invitationCode);
  if (!codeResult.ok) {
    throw errors.validation('invitationCode', '邀请码格式不正确，请核对后重试');
  }
  const nameResult = validate.validateDisplayName(input.displayName);
  if (!nameResult.ok) {
    throw errors.validation('displayName', '请填写 1~20 字的昵称');
  }
  return { input, code: codeResult.canonical, displayName: nameResult.value };
}

// TD-053：已注销兼职的 openid 已在 partners 匿名化，原有「按 openid 命中既有 partner → CONFLICT」判定
// 改由 users.closedPartnerNo 标记承担（不可再激活的唯一锚点）；两者并行读，不增串行 RTT。
async function assertNotAlreadyPartner(ctx, scope) {
  const [existingPartner, user] = await Promise.all([
    identity.loadPartnerByOpenid(ctx, scope.openid),
    identity.loadUser(ctx, scope.openid)
  ]);
  if (existingPartner || identity.closedPartnerNoOf(user)) {
    throw errors.conflict('该微信号已是兼职，无需重复激活');
  }
  return user;
}

// 头像票据（可选）：消费前校验归属/路径/大小，成功后由调用方 consumeTicket
async function prepareAvatar(ctx, input, config, nowMs) {
  const ticketId = input.avatarTicket || input.avatarTicketId || '';
  if (!ticketId) {
    return { avatarTicket: null, avatarFileId: '' };
  }
  const avatarTicket = await uploadCommon.loadAvatarTicket(ctx, ticketId, nowMs);
  const avatarFileId = uploadCommon.assertAvatarFile(
    input.avatarFileId || input.fileId || '',
    avatarTicket,
    uploadCommon.avatarMaxBytes(config)
  );
  return { avatarTicket: avatarTicket, avatarFileId: avatarFileId };
}

async function handler(ctx, payload) {
  const scope = assertActivationAllowed(ctx);
  const fields = readActivationInput(payload);
  await identity.assertTextSafe(ctx, fields.displayName, 'displayName');
  const user = await assertNotAlreadyPartner(ctx, scope);
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const config = await configCommon.loadRuntimeConfig(ctx);
  const avatar = await prepareAvatar(ctx, fields.input, config, nowMs);
  const created = await activateInTransaction(ctx, {
    scope,
    user,
    code: fields.code,
    displayName: fields.displayName,
    avatarFileId: avatar.avatarFileId,
    nowMs,
    nowDate
  }, config);
  if (avatar.avatarTicket) {
    await uploadCommon.consumeTicket(ctx, avatar.avatarTicket, nowMs);
  }
  return {
    partnerNo: created.partnerNo,
    partner: {
      partnerNo: created.partnerNo,
      displayName: fields.displayName,
      avatarFileId: avatar.avatarFileId,
      status: enums.PARTNER_STATUS.ACTIVE,
      serviceConfig: created.serviceConfig
    },
    roles: created.roles
  };
}

async function activateInTransaction(ctx, options, runtimeConfig) {
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
        // 惰性过期判定（DATA_MODEL §4.3：激活时也判定）：admin.createInvites 落库的 expiresAt 是 Date，
        // 而 time.isPast 只接受毫秒数——这里显式归一 Date/number，否则 Date 直传恒判"未过期"（expiresAt 缺失不判过期）。
        const expiresAtMs = invitation.expiresAt instanceof Date ? invitation.expiresAt.getTime()
          : (typeof invitation.expiresAt === 'number' && isFinite(invitation.expiresAt) ? invitation.expiresAt : 0);
        if (invitation.status === enums.INVITATION_STATUS.EXPIRED || (expiresAtMs > 0 && expiresAtMs <= opts.nowMs)) {
          throw errors.inviteExpired('邀请码已过期，请向开发者索取新的邀请码');
        }
        const doc = buildPartnerDoc(opts.scope.openid, { displayName: opts.displayName, avatarFileId: opts.avatarFileId }, opts.nowDate, runtimeConfig);
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
