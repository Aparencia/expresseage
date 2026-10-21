// cloudfunctions/cleanup/run.js · 单入口执行器（index.js 与 selftest 共用；now/dao/sweeps 可注入）
// 口径：ENGINEERING §4.7「单个定时触发器，按到期条件幂等执行全部任务」；DATA_MODEL §10.2 步骤 11
//       （admin_audit{action:'CLEANUP', detail:{counts}}）。
// 隔离：单个 sweep 抛错只记 failed，不阻断后续 sweep，也不让整轮返回 ok:false；
//       汇总审计写入失败同样不阻断本轮结果（下轮重试，requestKey 幂等）。
'use strict';

const { COLLECTIONS, CONFIG_DOC_ID } = require('./shared/collections');

const MAX_SWEEP_NAME = 64;
const CLEANUP_AUDIT_ACTION = 'CLEANUP';
const SYSTEM = 'SYSTEM';

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

function summarize(results) {
  const summary = { total: results.length, ok: 0, failed: 0, scanned: 0, acted: 0, failedItems: 0 };
  for (let i = 0; i < results.length; i += 1) {
    const item = results[i];
    if (item.ok) {
      summary.ok += 1;
    } else {
      summary.failed += 1;
    }
    summary.scanned += toCount(item.scanned);
    summary.acted += toCount(item.acted);
    summary.failedItems += toCount(item.failed);
  }
  return summary;
}

// §10.2 步骤 11：一轮一条 CLEANUP 汇总审计（detail.counts 记录本轮 total/ok/failed/scanned/acted；
// requestKey = 本轮 requestId，重跑同一轮不重复写；审计写入失败不阻断本轮）。
async function writeSummaryAudit(ctx, summary) {
  if (!ctx || !ctx.dao) {
    return false;
  }
  const requestKey = 'cleanup:' + String(ctx.requestId || ctx.now);
  try {
    const existed = await ctx.dao.findOne(COLLECTIONS.ADMIN_AUDIT, { where: { requestKey } });
    if (existed) {
      return false;
    }
    await ctx.dao.add(COLLECTIONS.ADMIN_AUDIT, {
      adminOpenid: SYSTEM,
      developerNo: SYSTEM,
      action: CLEANUP_AUDIT_ACTION,
      target: { type: 'sweep_batch', id: String(ctx.requestId || ('cleanup-' + ctx.now)) },
      detail: {
        counts: {
          total: summary.total,
          ok: summary.ok,
          failed: summary.failed,
          scanned: summary.scanned,
          acted: summary.acted
        }
      },
      at: new Date(ctx.now),
      requestKey
    });
    return true;
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      return false;
    }
    console.warn('[cleanup] 汇总审计写入失败，下轮重试');
    return false;
  }
}

async function runAll(ctx, options) {
  const opts = options || {};
  const sweeps = Array.isArray(opts.sweeps) ? opts.sweeps : loadSweeps();
  const startedAtMs = typeof opts.startedAt === 'number' && isFinite(opts.startedAt) ? opts.startedAt : Date.now();
  const results = [];
  for (let i = 0; i < sweeps.length; i += 1) {
    results.push(await runSweep(sweeps[i], ctx));
  }
  const summary = summarize(results);
  const auditWritten = await writeSummaryAudit(ctx, summary);
  return {
    ok: true,
    total: summary.total,
    failed: summary.failed,
    sweeps: results,
    auditWritten,
    serverTime: ctx.now,
    durationMs: Math.max(0, Date.now() - startedAtMs)
  };
}

module.exports = {
  AppError,
  CLEANUP_AUDIT_ACTION,
  MAX_SWEEP_NAME,
  toCount,
  loadSweeps,
  loadConfig,
  runSweep,
  summarize,
  writeSummaryAudit,
  runAll
};
