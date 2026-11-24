// handlers/order/_proof.js · D97/D98 履约现场照片（PROOF 票据消费 / 订单字段 / DTO 摘要）
// 口径：CONTRACT §4.1 第 8 条 / §5.1（D97 送达必拍、D98 取件可选可跳过）、DATA_MODEL §2.12。
// 边界：本文件只管「票据 → 订单字段」的最小写读；查看 URL 由 order.imageUrl 的 kind 签发。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const store = require('./_store');
const uploadCommon = require('../upload/_common');

const PURPOSE = enums.UPLOAD_PURPOSE.PROOF;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

// 票据读取与校验（归属=effectiveOpenid、用途=PROOF、未过期未用、路径前缀 proofs/）。
// 不存在/非本人 → NOT_FOUND（不区分，避免枚举）；过期/已用 → INVALID_STATE。
async function loadTicket(ctx, ticketValue, field) {
  const value = textOf(ticketValue).trim();
  if (!value) {
    throw errors.validation(field, '请先拍一张现场照片');
  }
  const scope = store.scopeOf(ctx);
  const row = await ctx.dao.findOne(COLLECTIONS.UPLOAD_TICKETS, { where: { ticket: value } });
  const name = field || 'deliveryPhotoTicket';
  if (!row || row.openid !== scope.openid) {
    throw errors.notFound('现场照片上传凭证不存在或已失效，请重新上传');
  }
  const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  if (row.usedAt) {
    throw errors.invalidState('现场照片凭证已使用：如果你刚才已提交成功，请刷新订单查看，避免重复操作');
  }
  if (!expiresAt || expiresAt <= store.nowMsOf(ctx)) {
    throw errors.invalidState('现场照片凭证已过期，请重新拍照上传');
  }
  if (row.purpose !== PURPOSE) {
    throw errors.validation(name, '上传凭证用途不符，请重新上传现场照片');
  }
  if (textOf(row.cloudPath).indexOf(uploadCommon.PATH_PREFIX.PROOF) !== 0) {
    throw errors.validation(name, '上传凭证路径异常，请重新上传现场照片');
  }
  return row;
}

// fileId 必须恰好落在本票据 cloudPath 上（复用 upload 域单源），否则拒绝。
function resolveFileId(ticket, fileId, field) {
  const value = uploadCommon.resolveTicketFileId(ticket, fileId);
  if (!value) {
    throw errors.validation(field || 'deliveryPhotoFileId', '现场照片与上传凭证不匹配，请重新上传');
  }
  return value;
}

// guard 返回值：票据可缺省（取件跳过 / 送达旧客户端过渡期），带则全部校验。
async function readOptional(ctx, options) {
  const opts = options || {};
  const ticketValue = textOf(opts.ticket).trim();
  if (!ticketValue) {
    return { ticket: null, fileId: '', size: 0 };
  }
  const ticket = await loadTicket(ctx, ticketValue, opts.ticketField);
  const fileId = resolveFileId(ticket, opts.fileId, opts.fileField);
  const size = typeof ticket.size === 'number' && ticket.size > 0 ? ticket.size : 0;
  return { ticket, fileId, size };
}

// 送达必填（D97）：缺票据直接 VALIDATION_FAILED(field=deliveryPhotoTicket)。
async function readRequired(ctx, options) {
  const opts = options || {};
  const ticketValue = textOf(opts.ticket).trim();
  if (!ticketValue) {
    throw errors.validation('deliveryPhotoTicket', '请先拍一张送达现场照片');
  }
  return readOptional(ctx, opts);
}

// 订单字段（单值覆盖）：{fileId,size,at,byPartnerNo}；fileId 不出云（DTO 只给摘要）。
function proofOf(checked, partnerNo, nowDate) {
  return {
    fileId: checked.fileId,
    size: checked.size,
    at: nowDate,
    byPartnerNo: textOf(partnerNo)
  };
}

// 事务内消费票据：条件更新 usedAt（并发/重放时 0 行 → CONFLICT 回滚整笔）。
async function consume(trx, ticket, nowDate) {
  if (!ticket) {
    return;
  }
  const written = await trx.updateWhere(COLLECTIONS.UPLOAD_TICKETS, {
    _id: ticket._id,
    usedAt: null
  }, { usedAt: nowDate });
  if (!written || !written.updated) {
    throw errors.conflict('现场照片凭证已被使用，请重新上传');
  }
}

module.exports = {
  readOptional,
  readRequired,
  proofOf,
  consume,
  loadTicket,
  resolveFileId
};
