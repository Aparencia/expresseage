'use strict';
/**
 * tools/backfill-pickup-low.js — D49 存量兼职「送至楼下」一次性回填（用户 2026-11-01 拍板 Q4=可以）。
 *
 * 背景：D41 于 2026-10-28 新增 PICKUP_LOW（送至楼下），但新类型不会自动对存量兼职生效——
 *   partners.serviceConfig.services 缺该条目 ⇒ 兼职端缺省 enabled=false，顾客端
 *   （config.serviceCatalog ∩ partnerPublic.services 取交集）看不到「送至楼下」。
 *   D49：对缺条目的存量兼职一次性补 {code:'PICKUP_LOW', enabled:true}；保留其既有启用/停用选择与顺序、
 *   不覆盖其他类型；写前导出完整备份、幂等可重跑；只能由用户/运维在真实环境执行（agent 不代跑）。
 *
 * 形态：
 *   1) 云函数形态（真实环境执行路径，用户操作）：把本文件作为临时云函数 index.js 部署，控制台测试调用
 *      事件 `{}` = dry-run（只打印将改的兼职数与逐人变化，不写）；事件 `{"apply":true}` = 写入
 *      （写前逐人打印 `[backup]` 完整原 serviceConfig）；执行完删除临时云函数。
 *   2) 本机 CLI：`--help` 用法；无参数 = 安全提示（不连接云环境、不写任何数据）；
 *      `--apply` = 守卫退出（真实回填只能在云函数环境执行，防本机误写）。
 *
 * 回滚：按 `[backup]` 行里的原 serviceConfig 逐条还原（或删除新增的 PICKUP_LOW 条目）；脚本幂等，可原地重跑。
 * 取数：node tools/backfill-pickup-low.js --help
 * 汇总行：backfill-pickup-low：扫描 N / 待改 M / 已改 K / 跳过 J
 */
const LOW_CODE = 'PICKUP_LOW';
const PAGE_SIZE = 100;

const HELP = [
  'tools/backfill-pickup-low.js — D49 存量兼职「送至楼下」一次性回填（默认 dry-run，--apply 才写）',
  '',
  '真实环境执行（只能由用户/运维在云开发控制台执行；本机不连接、不写任何数据）：',
  '  1. 云开发控制台 → 云函数 → 新建临时云函数（Node.js，任意名称如 backfill-pickup-low）',
  '  2. 把本文件全文粘贴为该云函数的 index.js，保存并部署',
  '  3. 云函数 → 测试，事件 {}（dry-run）：读返回/日志的「扫描 / 待改」与逐人 [plan] 变化，确认人数与预期一致',
  '  4. 云函数 → 测试，事件 {"apply":true}：先输出逐人 [backup] 原 serviceConfig，再写入；返回含「已改」数',
  '     备份留痕：复制全部 [backup] 行，或保存返回体里的 backup 数组（回滚依据）',
  '  5. 验证：顾客端下单页能看到「送至楼下」（兼职端服务配置 5 类齐全）；重复执行 dry-run 应为「待改 0」',
  '  6. 用完删除临时云函数（一次性脚本不进 api/cleanup 部署单元）',
  '',
  '回滚：按 [backup] 行的原 serviceConfig 逐条还原（或删除本条新增的 PICKUP_LOW 条目）。',
  '本机用法：',
  '  node tools/backfill-pickup-low.js            # 安全提示（不连接云环境、不写任何数据）',
  '  node tools/backfill-pickup-low.js --help     # 本说明',
  '  node tools/backfill-pickup-low.js --apply    # 守卫退出（真实回填只能在云函数环境执行）',
  '',
  '汇总行：backfill-pickup-low：扫描 N / 待改 M / 已改 K / 跳过 J'
].join('\n');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneOf(value) {
  return JSON.parse(JSON.stringify(value));
}

function labelOf(doc) {
  const item = doc || {};
  return textOf(item.partnerNo) || textOf(item._id) || '(无编号)';
}

/**
 * 单条兼职回填判定（纯函数）：
 *   SKIP   = 无法安全回填（已注销/服务配置缺失或非对象/服务数组缺失或为空）——不改，交人工核对；
 *   KEEP   = 已有 PICKUP_LOW 条目（无论 enabled 真假）——保留兼职自己的选择，不动；
 *   APPEND = 缺 PICKUP_LOW 条目——在既有顺序末尾追加 {code:'PICKUP_LOW', enabled:true}。
 */
function planOf(doc) {
  const item = doc || {};
  const status = textOf(item.status);
  if (status === 'CLOSED') {
    return { kind: 'SKIP', reason: '已注销（不可再绑定/接单），不改' };
  }
  const config = item.serviceConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { kind: 'SKIP', reason: 'serviceConfig 缺失或非对象，需人工核对' };
  }
  const services = Array.isArray(config.services) ? config.services : null;
  if (!services) {
    return { kind: 'SKIP', reason: 'serviceConfig.services 缺失或非数组，需人工核对' };
  }
  if (services.length === 0) {
    return { kind: 'SKIP', reason: 'serviceConfig.services 为空（无既有选择可保留），需人工核对' };
  }
  const hasLow = services.some(function find(entry) {
    return !!entry && textOf(entry.code) === LOW_CODE;
  });
  if (hasLow) {
    return { kind: 'KEEP', reason: '已有 PICKUP_LOW 条目（保留原启用状态）' };
  }
  return {
    kind: 'APPEND',
    reason: '缺 PICKUP_LOW 条目',
    partnerNo: textOf(item.partnerNo),
    label: labelOf(item),
    before: cloneOf(config),
    after: Object.assign({}, cloneOf(config), { services: services.concat([{ code: LOW_CODE, enabled: true }]) })
  };
}

function summaryLine(summary) {
  const item = summary || {};
  return 'backfill-pickup-low：扫描 ' + (item.scanned || 0) + ' / 待改 ' + (item.pending || 0)
    + ' / 已改 ' + (item.applied || 0) + ' / 跳过 ' + (item.skipped || 0);
}

function logPlanLine(log, entry) {
  const plan = entry.plan;
  if (plan.kind === 'APPEND') {
    log('[plan] ' + plan.label + '：' + plan.reason + ' → 追加 {code:' + LOW_CODE + ',enabled:true}'
      + '（既有 ' + plan.before.services.length + ' 项顺序与 enabled 不变）');
    return;
  }
  log('[' + (plan.kind === 'KEEP' ? 'keep' : 'skip') + '] ' + labelOf(entry.doc) + '：' + plan.reason);
}

// 计划汇总（扫描/待改/跳过）；applied/failed 由写入阶段回填
function summarize(entries) {
  const appends = entries.filter(function pick(entry) { return entry.plan.kind === 'APPEND'; });
  return {
    appends: appends,
    summary: {
      scanned: entries.length,
      pending: appends.length,
      applied: 0,
      skipped: entries.filter(function skip(entry) { return entry.plan.kind === 'SKIP'; }).length,
      failed: 0
    }
  };
}

function backupOf(appends) {
  return appends.map(function toBackup(entry) {
    return { partnerNo: entry.plan.partnerNo, label: entry.plan.label, serviceConfig: cloneOf(entry.plan.before) };
  });
}

function changesOf(appends) {
  return appends.map(function toChange(entry) {
    return { partnerNo: entry.plan.partnerNo, label: entry.plan.label, services: entry.plan.after.services.length };
  });
}

// 写入阶段：先打印完整备份（回滚依据），再逐条写；单条失败不中断（幂等可重跑）
async function applyAppends(deps, appends, backup, summary, log) {
  backup.forEach(function each(item) { log('[backup] ' + JSON.stringify(item)); });
  for (let i = 0; i < appends.length; i += 1) {
    const entry = appends[i];
    const label = entry.plan.label;
    try {
      await deps.updatePartner(entry.doc._id, { serviceConfig: entry.plan.after, updatedAt: deps.now() });
      summary.applied += 1;
      log('[write] ' + label + '：已追加 ' + LOW_CODE + '（enabled=true）');
    } catch (error) {
      summary.failed += 1;
      log('[fail] ' + label + '：写入失败（' + ((error && error.message) || String(error)) + '）；其余兼职继续');
    }
  }
  if (summary.failed > 0) {
    log('[fail] 共 ' + summary.failed + ' 个兼职写入失败，请按日志逐个核对后在控制台重试（幂等）');
  }
}

/**
 * 执行回填（依赖注入：fake DB 可单测；真实环境由 cloudMain 适配）
 * deps = { listPartners(): Promise<doc[]>, updatePartner(id, patch): Promise, now(): Date, log(line) }
 * options = { apply: boolean }：false=只读 dry-run（绝不调用写依赖）
 */
async function runBackfill(deps, options) {
  const apply = !!(options && options.apply === true);
  const log = typeof deps.log === 'function' ? deps.log : function noop() {};
  const docs = await deps.listPartners();
  const entries = (Array.isArray(docs) ? docs : []).map(function map(doc) {
    return { doc: doc, plan: planOf(doc) };
  });
  const picked = summarize(entries);
  const summary = picked.summary;
  log('[scan] 扫描 ' + summary.scanned + ' 个兼职；待改 ' + summary.pending + ' 个；跳过 ' + summary.skipped + ' 个');
  entries.forEach(function each(entry) { logPlanLine(log, entry); });
  const backup = backupOf(picked.appends);
  const result = { summary: summary, backup: backup, changes: changesOf(picked.appends) };
  if (!apply) {
    log('[dry-run] 未写任何数据（加 {"apply":true} 才写入）');
    log(summaryLine(summary));
    return result;
  }
  await applyAppends(deps, picked.appends, backup, summary, log);
  log(summaryLine(summary));
  return result;
}

// ---------------------------------------------------------------- 云函数形态（真实环境）
function loadCloudSdk() {
  try {
    return require('wx-server-sdk');
  } catch (error) {
    return null;
  }
}

function createCloudDeps(cloud) {
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const db = cloud.database();
  return {
    listPartners: async function listPartners() {
      const all = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const res = await db.collection('partners').skip(offset).limit(PAGE_SIZE)
          .field({ partnerNo: true, status: true, serviceConfig: true }).get();
        const list = (res && Array.isArray(res.data)) ? res.data : [];
        list.forEach(function each(doc) { all.push(doc); });
        if (list.length < PAGE_SIZE) break;
      }
      return all;
    },
    updatePartner: async function updatePartner(id, patch) {
      if (!id) throw new Error('缺少兼职 _id');
      await db.collection('partners').doc(id).update({ data: patch });
    },
    now: function now() { return new Date(); },
    log: function logger(line) { console.log(line); }
  };
}

/** 云函数 handler 主体（sdk 依赖由调用方注入，便于本地 fake 断言；不代跑真实环境） */
async function cloudMain(event, deps) {
  const input = event && typeof event === 'object' ? event : {};
  const result = await runBackfill(deps, { apply: input.apply === true });
  return {
    ok: result.summary.failed === 0,
    dryRun: input.apply !== true,
    summary: result.summary,
    summaryLine: summaryLine(result.summary),
    backup: result.backup,
    changes: result.changes
  };
}

async function main(event) {
  const cloud = loadCloudSdk();
  if (!cloud) {
    return { ok: false, code: 'NO_CLOUD', message: '未在云函数环境运行：请部署到云开发云函数后调用（见 --help）' };
  }
  try {
    return await cloudMain(event, createCloudDeps(cloud));
  } catch (error) {
    console.error('[backfill] 执行失败', (error && (error.stack || error.message)) || String(error));
    return { ok: false, code: 'INTERNAL_ERROR', message: '回填执行失败，请查看云函数日志（幂等，可重跑）' };
  }
}

// ---------------------------------------------------------------- 本机 CLI（不连接真实环境）
function runCli(args, io) {
  const argv = Array.isArray(args) ? args : [];
  const out = io && typeof io.log === 'function' ? io.log : console.log;
  const err = io && typeof io.error === 'function' ? io.error : console.error;
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) {
    out(HELP);
    return 0;
  }
  if (argv.indexOf('--apply') >= 0) {
    err('backfill-pickup-low：拒绝在本机执行写入——真实回填只能由用户在云开发控制台临时云函数里执行'
      + '（事件 {"apply":true}；步骤见 --help）。本机未连接、未写任何数据。');
    return 2;
  }
  if (argv.length > 0) {
    err('backfill-pickup-low：未知参数 ' + argv.join(' ') + '（仅支持 --help / --apply；dry-run 请用空参数）');
    return 2;
  }
  out('backfill-pickup-low：本机不连接云环境，也不写任何数据。真实环境执行方式见 --help（临时云函数 + 控制台测试）。');
  out(summaryLine({ scanned: 0, pending: 0, applied: 0, skipped: 0 }) + '（未连接真实环境；dry-run 未写任何数据）');
  return 0;
}

module.exports = {
  LOW_CODE,
  HELP,
  planOf,
  runBackfill,
  runCli,
  summaryLine,
  cloudMain,
  createCloudDeps,
  main
};

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
