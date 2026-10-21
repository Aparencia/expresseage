// handlers/upload/prepare.js · upload.prepare（截图/头像上传票据；服务端唯一生成云存储路径）
// 口径：CONTRACT v0.9 §4.1（票据 5 分钟、purpose 绑定、路径不含 openid、≤500KB/jpg-png）、§4.2（头像
// avatars/{role}/{random}.jpg、≤config.avatarMaxBytes）；DATA_MODEL §2.12/§7.6。TEST_WRITE 归属 effectiveOpenid。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const time = require('../../lib/time');
const { generateUploadTicket, generateRandomId } = require('../../lib/id-generator');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const uploadCommon = require('./_common');

const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
const AVATAR_RANDOM_LENGTH = 20;

function resolveDraftId(value) {
  if (typeof value === 'string' && DRAFT_ID_PATTERN.test(value)) {
    return value;
  }
  return generateRandomId(24);
}

async function assertTicketUploader(ctx, scope) {
  const customer = await identity.loadCustomer(ctx, scope.openid);
  if (customer && customer.profileCompleted === true) {
    const binding = await identity.getActiveBinding(ctx, scope.openid);
    if (binding) {
      return;
    }
  }
  const partner = await identity.loadPartnerByOpenid(ctx, scope.openid);
  if (partner && partner.status === enums.PARTNER_STATUS.ACTIVE) {
    return;
  }
  throw errors.invalidState('请先完善资料并绑定兼职（或激活兼职身份）后再上传截图');
}

function assertImageInput(input, maxBytes) {
  if (input.contentType !== undefined) {
    if (enums.IMAGE_MIME_TYPES.indexOf(input.contentType) < 0) {
      throw errors.validation('contentType', '只支持 jpg 或 png 图片');
    }
  }
  if (input.size !== undefined) {
    const size = Number(input.size);
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
      throw errors.validation('size', '图片大小超出限制，请压缩后重新上传');
    }
  }
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = identity.scopeOf(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const purpose = input.purpose;
  if (purpose !== enums.UPLOAD_PURPOSE.TICKET && purpose !== enums.UPLOAD_PURPOSE.AVATAR) {
    throw errors.validation('purpose', '上传用途不正确');
  }
  const config = await configCommon.loadRuntimeConfig(ctx);
  const ticket = generateUploadTicket();
  let cloudPath = '';
  if (purpose === enums.UPLOAD_PURPOSE.AVATAR) {
    const role = scope.role || (await identity.loadPartnerByOpenid(ctx, scope.openid) ? enums.ROLES.PARTNER : enums.ROLES.CUSTOMER);
    cloudPath = uploadCommon.buildCloudPath(purpose, { role, random: generateRandomId(AVATAR_RANDOM_LENGTH) });
    assertImageInput(input, uploadCommon.avatarMaxBytes(config));
  } else {
    await assertTicketUploader(ctx, scope);
    cloudPath = uploadCommon.buildCloudPath(purpose, { ticket });
    assertImageInput(input, uploadCommon.TICKET_MAX_BYTES);
  }
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const draftId = resolveDraftId(input.draftId);
  const expiresAt = time.addMinutes(nowMs, uploadCommon.TICKET_TTL_MINUTES);
  await ctx.dao.add(COLLECTIONS.UPLOAD_TICKETS, {
    ticket,
    openid: scope.openid,
    purpose,
    cloudPath,
    draftId,
    size: input.size === undefined ? 0 : Number(input.size),
    contentType: input.contentType || '',
    expiresAt,
    usedAt: null,
    createdAt: nowDate
  });
  return {
    ticket,
    uploadTicketId: ticket,
    cloudPath,
    draftId,
    purpose,
    expiresAt
  };
}

module.exports = { handler };
