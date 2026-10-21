// handlers/upload/cancel.js · upload.cancel（撤销未消费的上传票据）
// 口径：DATA_MODEL §7.6（自然幂等；不存在/非本人→NOT_FOUND、已消费→INVALID_STATE）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = identity.scopeOf(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const ticketId = input.uploadTicketId || input.ticket || '';
  if (typeof ticketId !== 'string' || ticketId.trim() === '') {
    return { cancelled: false };
  }
  const ticket = await ctx.dao.findOne(COLLECTIONS.UPLOAD_TICKETS, { where: { ticket: ticketId.trim() } });
  if (!ticket) {
    return { cancelled: false };
  }
  if (ticket.openid !== scope.openid) {
    throw errors.notFound('上传凭证不存在或已失效');
  }
  if (ticket.usedAt) {
    throw errors.invalidState('上传凭证已使用，无法撤销');
  }
  await ctx.dao.remove(COLLECTIONS.UPLOAD_TICKETS, ticket._id);
  return { cancelled: true };
}

module.exports = { handler };
