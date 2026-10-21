// handlers/upload/_common.js · 上传票据与头像文件校验（云存储路径只在本域出现，门禁 #29）
// 口径：CONTRACT v0.9 §4.1（purpose 绑定、5 分钟、路径不含 openid）、§4.2（头像 ≤200KB/jpg/png、替换删旧）；
//       DATA_MODEL §2.12（票据字段/消费规则）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

const TICKET_MAX_BYTES = 500 * 1024;
const AVATAR_MAX_BYTES_FALLBACK = 200 * 1024;
const AVATAR_FILE_EXT = '.jpg';
const TICKET_TTL_MINUTES = 5;

// 票据用途 → 云存储路径前缀（服务端唯一构造点；客户端不得自拟）
const PATH_PREFIX = {
  TICKET: 'orders/',
  AVATAR: 'avatars/'
};

function buildCloudPath(purpose, params) {
  if (purpose === enums.UPLOAD_PURPOSE.TICKET) {
    return PATH_PREFIX.TICKET + params.ticket + '/image.jpg';
  }
  const roleDir = params.role === enums.ROLES.PARTNER ? 'partner' : 'customer';
  return PATH_PREFIX.AVATAR + roleDir + '/' + params.random + AVATAR_FILE_EXT;
}

function avatarMaxBytes(config) {
  const value = config && Number(config.avatarMaxBytes);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : AVATAR_MAX_BYTES_FALLBACK;
}

// 头像票据消费：归属=effectiveOpenid、purpose=AVATAR、未过期未消费、路径前缀一致
async function loadAvatarTicket(ctx, ticketId, nowMs) {
  const value = typeof ticketId === 'string' ? ticketId.trim() : '';
  validate.validateToken(value, 'avatarTicket');
  const scope = identity.scopeOf(ctx);
  const ticket = await ctx.dao.findOne(COLLECTIONS.UPLOAD_TICKETS, { where: { ticket: value } });
  if (!ticket || ticket.openid !== scope.openid) {
    throw errors.notFound('头像上传凭证不存在或已失效');
  }
  if (ticket.usedAt || time.toMs(ticket.expiresAt) <= nowMs) {
    throw errors.invalidState('头像上传凭证已失效，请重新上传');
  }
  if (ticket.purpose !== enums.UPLOAD_PURPOSE.AVATAR) {
    throw errors.validation('avatarTicket', '上传凭证用途不符，请重新上传头像');
  }
  if (typeof ticket.cloudPath !== 'string' || ticket.cloudPath.indexOf(PATH_PREFIX.AVATAR) !== 0) {
    throw errors.validation('avatarTicket', '上传凭证路径异常，请重新上传头像');
  }
  return ticket;
}

// 头像文件校验：fileId 必须包含本票据云路径（前缀一致），并校验扩展名/大小上限
function assertAvatarFile(fileId, ticket, maxBytes) {
  const value = typeof fileId === 'string' ? fileId.trim() : '';
  if (!value || value.indexOf('cloud://') !== 0) {
    throw errors.validation('avatarFileId', '头像未上传成功，请重新上传');
  }
  const cloudPath = ticket && typeof ticket.cloudPath === 'string' ? ticket.cloudPath : '';
  if (!cloudPath || value.indexOf(cloudPath) < 0) {
    throw errors.validation('avatarFileId', '头像与上传凭证不匹配，请重新上传');
  }
  const lower = value.toLowerCase();
  if (lower.lastIndexOf(AVATAR_FILE_EXT) !== lower.length - AVATAR_FILE_EXT.length) {
    throw errors.validation('avatarFileId', '头像只支持 jpg 或 png 格式');
  }
  if (ticket && ticket.size !== undefined) {
    const size = Number(ticket.size);
    if (Number.isFinite(size) && size > 0 && size > maxBytes) {
      throw errors.validation('avatarFileId', '头像图片过大，请换一张更小的图片');
    }
  }
  return value;
}

// 消费票据（一次性）：资料保存成功后写 usedAt（与订单截图票据 usedAt 同字段口径：Date，DATA_MODEL §2.12）
async function consumeTicket(ctx, ticket, nowMs) {
  await ctx.dao.update(COLLECTIONS.UPLOAD_TICKETS, ticket._id, { usedAt: new Date(nowMs) });
}

module.exports = {
  TICKET_MAX_BYTES,
  AVATAR_MAX_BYTES_FALLBACK,
  TICKET_TTL_MINUTES,
  PATH_PREFIX,
  buildCloudPath,
  avatarMaxBytes,
  loadAvatarTicket,
  assertAvatarFile,
  consumeTicket
};
