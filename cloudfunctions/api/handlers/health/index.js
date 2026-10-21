// handlers/health/index.js · health.check（内部动作：部署自检，不返回业务数据与敏感值）
const { COLLECTIONS, COLLECTION_COUNT } = require('../../db/collections');
const { ERROR_CODE_COUNT } = require('../../shared/error-codes');
const { CONFIG_DOC_ID } = require('../../shared/collections');

async function check(ctx) {
  const config = await ctx.dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
  const seedTotal = await ctx.dao.count(COLLECTIONS.CONFIG, { where: {} });
  return {
    ok: true,
    version: 'v4-batch1',
    time: ctx.now,
    checks: {
      dbReachable: true,
      collections: COLLECTION_COUNT,
      errorCodes: ERROR_CODE_COUNT,
      configSeeded: !!config,
      configDocs: typeof seedTotal === 'number' ? seedTotal : 0,
      adminWhitelistConfigured: !!(ctx.env && ctx.env.ADMIN_OPENIDS),
      aiKeyConfigured: !!(ctx.env && ctx.env.DEEPSEEK_API_KEY)
    }
  };
}

module.exports = {
  actions: {
    'health.check': check
  }
};
