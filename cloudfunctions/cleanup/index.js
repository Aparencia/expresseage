// cloudfunctions/cleanup/index.js · 定时触发器唯一入口（单个触发器每 10 分钟；到期判断幂等）
// 职责：来源校验 → cloud.init → 组装 { dao, db, now, env, cloud, config, AppError } → 交给 run.js 串行执行 sweeps。
// 执行器（sweeps 注册/部分失败隔离/CLEANUP 汇总审计）在 run.js，便于 selftest 注入固定 now + fake DB。
// 来源校验（审查整改 M-14）：cleanup 为 internal 任务，客户端调用必带 OPENID → 直接 FORBIDDEN，不执行 sweep。
const cloud = require('wx-server-sdk');
const { createDao } = require('./db/dao');
const { COLLECTIONS, CONFIG_DOC_ID } = require('./shared/collections');
const runner = require('./run');
const guard = require('./entry-guard');

exports.main = async (event, context) => {
  const startedAt = Date.now();
  try {
    const wxContext = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : null;
    if (!guard.isInternalCaller(event, wxContext)) {
      console.warn('[cleanup] 拒绝非内部来源调用（不执行 sweep、不写审计）');
      return guard.forbiddenResult();
    }
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    const db = cloud.database();
    const now = Date.now();
    const dao = createDao(db);
    const config = await runner.loadConfig(dao);
    const ctx = {
      dao,
      db,
      cloud,
      env: process.env || {},
      config,
      now,
      requestId: 'cleanup-' + now.toString(36),
      AppError: runner.AppError,
      COLLECTIONS,
      CONFIG_DOC_ID
    };
    const result = await runner.runAll(ctx, { startedAt });
    console.log('[cleanup] 本轮完成', result.total, '个 sweep，失败', result.failed);
    return result;
  } catch (error) {
    console.error('[cleanup] 入口装配失败');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '清理任务装配失败',
      serverTime: Date.now(),
      requestId: '',
      durationMs: Date.now() - startedAt
    };
  }
};
