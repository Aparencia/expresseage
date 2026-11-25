// tools/lib/proof-fixtures.js · D97/D98 现场照片票据测试夹具（fake DB 种子 + 入参片段）
// 纪律：只在测试侧拼装 PROOF 票据与 cloud:// fileId；生产路径由 upload.prepare 生成（零硬编码入包）。
'use strict';

let seq = 0;

function ticketOf(prefix) {
  seq += 1;
  const head = (prefix || 'PROOF').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const tail = String(seq).padStart(6, '0');
  const body = (head + tail + 'X'.repeat(32)).slice(0, 32);
  return body;
}

/**
 * 在 fake DB 种一张 PROOF 票据，并返回 markDelivered / markPicked 需要的入参片段。
 * @param {object} db fake DB（需有 seed）
 * @param {string} openid 票据归属（effectiveOpenid）
 * @param {object} [options] {now,size,ticket,expired,used,purpose,cloudPath}
 * @returns {{deliveryPhotoTicket:string, deliveryPhotoFileId:string, ticket:string, fileId:string, cloudPath:string}}
 */
function proofPayload(db, openid, options) {
  const opts = options || {};
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const ticket = opts.ticket || ticketOf(opts.prefix);
  const cloudPath = opts.cloudPath || ('proofs/' + ticket + '/image.jpg');
  const row = {
    _id: 'ut-' + ticket,
    ticket,
    openid,
    purpose: opts.purpose || 'PROOF',
    cloudPath,
    size: typeof opts.size === 'number' ? opts.size : 1024,
    contentType: 'image/jpeg',
    expiresAt: new Date(now + (opts.expired ? -60000 : 5 * 60 * 1000)),
    usedAt: opts.used ? new Date(now) : null,
    createdAt: new Date(now)
  };
  if (db && typeof db.seed === 'function') {
    db.seed('upload_tickets', [row]);
  }
  const fileId = 'cloud://env.bucket/' + cloudPath;
  return {
    deliveryPhotoTicket: ticket,
    deliveryPhotoFileId: fileId,
    pickPhotoTicket: ticket,
    pickPhotoFileId: fileId,
    ticket,
    fileId,
    cloudPath
  };
}

module.exports = { proofPayload, ticketOf };
