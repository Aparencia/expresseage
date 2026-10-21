// cloudfunctions/cleanup/index.js · 定时触发器唯一入口（单个触发器每 10 分钟；到期判断幂等）
// 职责：cloud.init → 组装 { dao, db, now, env, cloud, config, AppError } → 串行执行 sweeps 注册表
// sweeps/* 由 cloud-orders 提供（cloudfunctions/cleanup/sweeps/**，导出 { name, run(ctx) }）；
// 注册表缺失/写坏时本轮不崩，只记录跳过，保证部署顺序不互相阻塞。
const cloud = require('wx-server-sdk');
const { createDao } = require('./db/dao');
const { COLLECTIONS, CONFIG_DOC_ID } = require('./shared/collections');

const MAX_SWEEP_NAME = 64;

class AppError extends Error {
  constructor(code, message, data) {
    super(message || '清理任务执行失败');
    this.name = 'AppError';
    this.code = code || 'INTERNAL_ERROR';
    this.data = data === undefined ? null : data;
  }
}

function toCount(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function loadSweeps() {
  try {
    const mod = require('./sweeps');
    const list = Array.isArray(mod) ? mod : (mod && Array.isArray(mod.SWEEPS) ? mod.SWEEPS : []);
    return list.filter((sweep) => (
      sweep && typeof sweep.name === 'string' && sweep.name.length > 0 &&
      sweep.name.length <= MAX_SWEEP_NAME && typeof sweep.run === 'function'
    ));
  } catch (error) {
    console.warn('[cleanup] sweeps 注册表未就绪，本轮跳过');
    return [];
  }
}

async function loadConfig(dao) {
  try {
    const doc = await dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
    return doc || {};
  } catch (error) {
    console.warn('[cleanup] 读取全局配置失败，本轮使用空配置');
    return {};
  }
}

async function runSweep(sweep, ctx) {
  try {
    const result = await sweep.run(ctx);
    return {
      name: sweep.name,
      ok: true,
      scanned: toCount(result && result.scanned),
      acted: toCount(result && result.acted),
      failed: toCount(result && result.failed)
    };
  } catch (error) {
    const code = error && error.name === 'AppError' ? error.code : 'INTERNAL_ERROR';
    console.error('[cleanup] sweep 失败', sweep.name, code);
    return { name: sweep.name, ok: false, scanned: 0, acted: 0, failed: 1, code };
  }
}

exports.main = async (event, context) => {
  const startedAt = Date.now();
  try {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    const db = cloud.database();
    const now = Date.now();
    const dao = createDao(db);
    const config = await loadConfig(dao);
    const ctx = {
      dao,
      db,
      cloud,
      env: process.env || {},
      config,
      now,
      requestId: 'cleanup-' + now.toString(36),
      AppError,
      COLLECTIONS
    };
    const sweeps = loadSweeps();
    const results = [];
    for (let i = 0; i < sweeps.length; i += 1) {
      results.push(await runSweep(sweeps[i], ctx));
    }
    const failed = results.filter((item) => !item.ok).length;
    console.log('[cleanup] 本轮完成', results.length, '个 sweep，失败', failed);
    return {
      ok: true,
      total: results.length,
      failed,
      sweeps: results,
      serverTime: now,
      durationMs: Date.now() - startedAt
    };
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
