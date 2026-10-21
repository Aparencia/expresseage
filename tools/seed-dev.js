'use strict';
/**
 * tools/seed-dev.js — dev 环境初始化计划器（14 集合 / 索引清单 / 测试账号 / 环境断言）。
 *
 * 职责边界（AGENTS §7）：**不连真实云环境、不写库、不改控制台**。本脚本只做：
 *   1) 环境断言（node 版本、config/env.js 环境 ID 状态、git 身份、关键文件存在）；
 *   2) 生成可执行的初始化计划（集合注册表、索引清单、config 全局文档、counters、测试账号，
 *      对齐 DATA_MODEL §9 与 ENGINEERING §4.6/§4.11）；
 *   3) dry-run 输出（默认）；`--apply` 仅提示"由用户在云控制台/部署机执行"，不代做。
 *
 * 用法：
 *   node tools/seed-dev.js                 # dry-run：打印初始化计划 + 环境断言
 *   node tools/seed-dev.js --json          # 机器可读计划
 *   node tools/seed-dev.js --apply         # 守卫：本脚本不代执行真实初始化（exit 2）
 * 汇总行：`seed-dev：计划 N 项；环境断言通过 M 项/告警 W 项；dry-run 未写任何数据`
 */
const fs = require('fs');
const path = require('path');
const F = require('./lib/fsutil');
const P = require('./lib/project');

const ROOT = F.ROOT;
const args = process.argv.slice(2);
const jsonOut = args.includes('--json');

function load(rel) {
  const full = path.join(ROOT, rel);
  if (!F.isFile(full)) return null;
  const r = F.tryRequire(full);
  return r.ok ? r.value : null;
}

// ---------------------------------------------------------------- 环境断言
function envChecks() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node 主版本 ≥ 18', ok: nodeMajor >= 18, detail: 'node ' + process.versions.node });
  const envFile = path.join(ROOT, 'config/env.js');
  if (!F.isFile(envFile)) {
    checks.push({ name: 'config/env.js 存在', ok: false, detail: '缺失' });
  } else {
    const s = F.readText(envFile);
    const placeholder = /__DEV_ENV_ID__|__PROD_ENV_ID__/.test(s);
    checks.push({
      name: '云环境 ID 已回填（非占位符）',
      ok: !placeholder,
      warn: placeholder,
      detail: placeholder ? '仍是 __DEV_ENV_ID__ / __PROD_ENV_ID__ 占位（需用户在云控制台创建环境后回填）' : '已配置',
    });
  }
  const defaults = load('config/defaults.js');
  checks.push({
    name: 'config/defaults.js 可加载',
    ok: !!defaults,
    detail: defaults ? 'ok（' + Object.keys(defaults).length + ' 个导出）' : '缺失/加载失败',
  });
  const collections = load('shared/collections.js');
  checks.push({
    name: 'shared/collections.js 恰好 14 集合',
    ok: !!collections && (collections.ALL_COLLECTIONS || []).length === P.COLLECTIONS.length,
    detail: collections ? String((collections.ALL_COLLECTIONS || []).length) + ' 集合' : '缺失',
  });
  const errorCodes = load('shared/error-codes.js');
  checks.push({
    name: 'shared/error-codes.js 恰好 13 码',
    ok: !!errorCodes && (errorCodes.ERROR_CODES || []).length === P.ERROR_CODES.length,
    detail: errorCodes ? String((errorCodes.ERROR_CODES || []).length) + ' 码' : '缺失',
  });
  const gitIdent = require('child_process').execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { cwd: ROOT, encoding: 'utf8' });
  checks.push({ name: 'git 身份已显式配置', ok: !!gitIdent.trim(), detail: gitIdent.trim() });
  return checks;
}

// ---------------------------------------------------------------- 初始化计划
function buildPlan() {
  const plan = [];
  // 1) 集合（14 个）
  P.COLLECTIONS.forEach((name) => plan.push({ kind: 'collection', target: name, action: 'ensure-collection', note: '空集合起（D11 不迁移 v3 数据）' }));
  // 2) 唯一索引（DATA_MODEL §9；列名对齐集合字段）
  const indexSpec = {
    customers: [['customerNo', true]],
    partners: [['openid', true], ['partnerNo', true]],
    bindings: [['activeKey', true]],
    orders: [['orderNo', true], ['requestKey', true]],
    order_events: [['requestKey', true]],
    invitation_codes: [['code', true]],
    admin_view_sessions: [['_id', true]],
    counters: [['key', true]],
    upload_tickets: [['ticket', true]],
    recognition_failures: [['failureNo', true], ['requestKey', true]],
  };
  Object.keys(indexSpec).forEach((coll) => {
    indexSpec[coll].forEach((pair) => {
      plan.push({ kind: 'index', target: coll + '.' + pair[0], action: 'ensure-unique-index', note: '唯一索引：冲突路径由 handler 重试 ≤5 次' });
    });
  });
  // 3) config 全局文档（无费用项；字段以 CONTRACT §4 与 defaults 为准）
  plan.push({
    kind: 'document',
    target: 'config/global',
    action: 'upsert',
    note: 'serviceCatalog(5 类型，不含费用语义)/zoneLabels/orderTimeoutMinutes/autoCompleteHours/screenshotRetentionDays/'
      + 'recognitionFailureRetentionDays/aiFallback{enabled:false}/viewTicketTtlMinutes/avatarMaxBytes/'
      + 'testAccountMaxPerRole/testDataRetentionDays/privacyVersion',
  });
  // 4) 测试账号（合成身份；每角色 3、合计 6；只能与测试账号互操作）
  ['CUSTOMER', 'PARTNER'].forEach((role) => {
    for (let i = 1; i <= 3; i++) {
      plan.push({
        kind: 'testAccount',
        target: role + ' #' + i,
        action: 'admin.createTestAccount',
        note: '合成 openid=TEST-<random>；isTestAccount=true；不计统计；30 天清理',
      });
    }
  });
  // 5) 运维提醒
  plan.push({ kind: 'manual', target: 'cloud env vars', action: 'manual-only', note: 'DEEPSEEK_API_KEY / ADMIN_OPENIDS 只由用户在云控制台配置（AGENTS §7）' });
  plan.push({ kind: 'manual', target: 'cloud triggers', action: 'manual-only', note: 'cleanup 单定时触发器由用户按 RUNBOOK 配置' });
  return plan;
}

function main() {
  if (args.includes('--apply')) {
    console.error('seed-dev：本脚本只做 dry-run 计划；真实初始化由用户/Lead 在云控制台或部署机执行（AGENTS §7 禁止 agent 改控制台）');
    return 2;
  }
  const checks = envChecks();
  const plan = buildPlan();
  if (jsonOut) {
    console.log(JSON.stringify({ checks, plan }, null, 2));
  } else {
    console.log('== tools/seed-dev.js · dev 初始化计划（dry-run）==');
    console.log('环境断言：');
    checks.forEach((c) => {
      const level = c.ok ? 'PASS' : (c.warn ? 'WARN' : 'FAIL');
      console.log('  [' + level + '] ' + c.name + ' | ' + c.detail);
    });
    const counts = {};
    plan.forEach((p) => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    console.log('初始化计划：' + Object.keys(counts).map((k) => k + ' ' + counts[k]).join(' / '));
    plan.forEach((p) => console.log('  - [' + p.kind + '] ' + p.target + ' → ' + p.action + '（' + p.note + '）'));
  }
  const envFail = checks.filter((c) => !c.ok && !c.warn).length;
  const envWarn = checks.filter((c) => c.warn).length;
  console.log('seed-dev：计划 ' + plan.length + ' 项；环境断言通过 ' + (checks.length - envFail - envWarn) + ' 项/告警 '
    + envWarn + ' 项/失败 ' + envFail + ' 项；dry-run 未写任何数据');
  return envFail === 0 ? 0 : 1;
}

process.exitCode = main();
