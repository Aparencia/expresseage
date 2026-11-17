// handlers/partner/createTransferCode.js · partner.createTransferCode（D88：签发/轮换转派码）
// 口径：CONTRACT §13 D88；DATA_MODEL §2.3（partners.transferCode/transferCodeExpiresAt）、§2.10（限流）。
// 语义：同时只保留 1 个有效码，重复签发=轮换覆盖（旧码立即失效）；惰性过期，不新增 sweep。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { errors } = require('../../lib/errors');
const idGenerator = require('../../lib/id-generator');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const transferCode = require('./_transfer-code');

const ATTEMPTS = 3;

// 6 位随机码（32 字母表）；撞到他人现有码则重抽，最多 3 次
async function pickCode(ctx, partner) {
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const code = idGenerator.generateRandomId(transferCode.CODE_LENGTH);
    const taken = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { transferCode: code } });
    if (!taken || String(taken._id) === String(partner._id)) {
      return code;
    }
  }
  return '';
}

async function handler(ctx) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const config = await configCommon.loadRuntimeConfig(ctx);
  const nowMs = identity.nowMs(ctx);
  await transferCode.consumeCodeRate(ctx, nowMs, config);
  const code = await pickCode(ctx, partner);
  if (!code) {
    throw errors.conflict('生成冲突，请重试');
  }
  const expiresAt = transferCode.expiresAtOf(nowMs, config);
  await ctx.dao.update(COLLECTIONS.PARTNERS, partner._id, {
    transferCode: code,
    transferCodeExpiresAt: new Date(expiresAt),
    updatedAt: identity.nowDate(ctx)
  });
  return { code: transferCode.displayCodeOf(code), expiresAt: expiresAt, serverTime: nowMs };
}

module.exports = { handler };
