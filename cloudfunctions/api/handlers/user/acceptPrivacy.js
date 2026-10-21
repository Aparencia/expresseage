// handlers/user/acceptPrivacy.js · user.acceptPrivacy（同意当前版本隐私指引；同版本幂等）
// 口径：CONTRACT v0.9 §11.2；DATA_MODEL §2.1（users.privacyConsent{version,at}）/§7.3。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const identity = require('./_common');
const configCommon = require('../config/_common');
const { errors } = require('../../lib/errors');

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const config = await configCommon.loadRuntimeConfig(ctx);
  const input = payload && typeof payload.version === 'string' ? payload.version.trim() : '';
  if (!input) {
    throw errors.validation('version', '缺少隐私政策版本号，请重新进入页面');
  }
  if (input !== config.privacyVersion) {
    throw errors.validation('version', '隐私政策已更新，请重新阅读后同意');
  }
  const scope = identity.scopeOf(ctx);
  const user = await identity.loadUser(ctx, scope.openid);
  const current = user && user.privacyConsent;
  if (current && current.version === input) {
    return {
      privacyConsent: { version: current.version, at: current.at ? new Date(current.at).getTime() : 0 },
      duplicated: true
    };
  }
  const at = identity.nowDate(ctx);
  await ctx.dao.update(COLLECTIONS.USERS, scope.openid, { privacyConsent: { version: input, at }, updatedAt: at });
  return { privacyConsent: { version: input, at: at.getTime() }, duplicated: false };
}

module.exports = { handler };
