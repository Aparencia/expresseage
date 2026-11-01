'use strict';
/**
 * tools/selftest-tools.js — 工具链本体完整性判据（M-44/R-C-02 的判据覆盖；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   A. DATA_MODEL §5.1 唯一索引权威清单可解析且非空（防空集全绿）；
 *   B. tools/seed-dev.js dry-run 计划的唯一索引 === DATA_MODEL §5.1（双向；条数取文档实际值，不硬编码）；
 *      显式覆盖 M-44 三项根因：bindings.tagKey（roomTag 并发第二道闸）/ admin_view_sessions.requestKey /
 *      admin_audit.requestKey（审计重放幂等键），且 admin_view_sessions 不再用 _id 占位；
 *   C. 计划索引目标集合全部 ∈ shared/collections 的 14 集合注册表；target 无重复；
 *      计划集合项 = 注册表全集；
 *   D. seed-dev CLI 可用：`--json` 的 stdout 是纯 JSON（可 parse）；
 *   E. 批 16 门禁 #35/#36 扫描器本体：导出提取（对象字面量/简写/别名/逐键）、页面/组件函数识别、
 *      生命周期豁免、基线结构（reasons 枚举/必填字段/无重复/非空集）；组件 status-pill 文案单源
 *      （短文案从 shared/enums.ORDER_STATUS_TEXT 派生，组件内零硬编码七状态中文）。
 *
 * 纪律：不 mock wx、不连云端、不写任何数据（dry-run）；期望值全部来自权威文档/注册表，不抄现状。
 * 取数：node tools/selftest-tools.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { createHarness, installCrashGuard } = require('./selftest');
const F = require('./lib/fsutil');
const deadCode = require('./lib/dead-code');
const { ALL_COLLECTIONS } = require(path.join(__dirname, '..', 'shared/collections.js'));

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ASSERTIONS = 24; // 实跑读数：node tools/selftest-tools.js（10 原有 + 14 批 16 #35/#36/组件单源）

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 解析 docs/data/V4_DATA_MODEL.md §5.1 的唯一索引：目标集 = `collection.field`（不写死条数）。 */
function dataModelUniqueIndexes() {
  const text = read('docs/data/V4_DATA_MODEL.md');
  const start = text.indexOf('### 5.1');
  const end = text.indexOf('### 5.2');
  if (start < 0 || end <= start) return [];
  const out = [];
  text.slice(start, end).split('\n').forEach((line) => {
    const head = line.match(/^-\s+`([a-z_]+)`[^：]*：/);
    if (!head) return;
    const re = /uk_[a-z_]+\(([A-Za-z0-9_.]+),unique\)/g;
    let m;
    while ((m = re.exec(line)) !== null) out.push(head[1] + '.' + m[1]);
  });
  return out;
}

/** 跑 seed-dev dry-run（--json 不写数据），取计划；失败返回 null 让断言判红而不是跳过。 */
function seedPlan() {
  try {
    const stdout = execFileSync(process.execPath, [path.join(__dirname, 'seed-dev.js'), '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const data = JSON.parse(stdout);
    return Array.isArray(data.plan) ? data.plan : null;
  } catch (e) {
    return null;
  }
}

function register(h) {
  h.section('§7.2 工具链 · seed-dev 初始化计划与索引权威清单（M-44）', (t) => {
    const expected = dataModelUniqueIndexes();
    t.notEmpty(expected, 'DATA_MODEL §5.1 唯一索引清单解析');
    const plan = seedPlan();
    t.check(plan !== null, 'seed-dev --json 的 stdout 是纯 JSON（机器可读口径）');
    const planList = plan || [];
    const planIndexes = planList.filter((p) => p && p.kind === 'index').map((p) => p.target).sort();
    t.eq(planIndexes.join(' '), expected.slice().sort().join(' '),
      'seed-dev 计划唯一索引 === DATA_MODEL §5.1（双向；条数取文档实际值）');
    t.eq(planIndexes.filter((x, i) => planIndexes.indexOf(x) !== i), [], 'seed-dev 计划索引 target 无重复');
    const collections = ALL_COLLECTIONS || [];
    t.eq(planIndexes.map((x) => x.split('.')[0]).filter((c) => collections.indexOf(c) === -1), [],
      '计划索引的集合全部 ∈ shared/collections 注册表');
    t.check(planIndexes.indexOf('bindings.tagKey') !== -1,
      'bindings.tagKey 唯一索引在计划中（roomTag 并发第二道闸，M-44 根因）');
    t.check(planIndexes.indexOf('admin_audit.requestKey') !== -1,
      'admin_audit.requestKey 唯一索引在计划中（审计重放幂等键，M-44 根因）');
    t.check(planIndexes.indexOf('admin_view_sessions.requestKey') !== -1
      && planIndexes.indexOf('admin_view_sessions._id') === -1,
    'admin_view_sessions 用 uk_request_key（不再用 _id 占位，M-44 根因）');
    const planCollections = planList.filter((p) => p && p.kind === 'collection').map((p) => p.target).sort();
    t.eq(planCollections.join(' '), collections.slice().sort().join(' '),
      'seed-dev 计划集合 = shared/collections 14 集合注册表');
    const src = read('tools/seed-dev.js');
    t.check(src.indexOf('DATA_MODEL §5.1') !== -1 && src.indexOf('DATA_MODEL §9') === -1,
      'seed-dev 注释的索引权威节 = DATA_MODEL §5.1（旧 §9 已清理）');
  });

  // 批 16：门禁 #35/#36 扫描器本体 + 组件文案单源（判据自身可测，防空集/空转全绿）
  h.section('§8.2 #35/#36 死代码扫描器（导出提取/页面函数识别/基线结构）与组件文案单源', (t) => {
    const sample = [
      "module.exports = { Alpha, Beta: betaFn, Gamma };",
      'module.exports.Delta = deltaFn;',
      'exports.Epsilon = epsilonFn;'
    ].join('\n');
    t.eq(deadCode.extractExports(sample).slice().sort(), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma'],
      '#35 导出提取覆盖对象简写/别名/逐键导出（5 符号）');
    t.eq(deadCode.extractExports('module.exports = {\n  ...require("./x"),\n  Zeta\n};'), ['Zeta'],
      '#35 导出提取跳过 spread、保留简写');

    const pageSrc = 'function topFn() {}\nPage({\n  data: {},\n  onLoad() {},\n  onShow() {},\n  onRetry() {}\n});\n';
    const pageDefs = deadCode.functionDefsOf(pageSrc);
    t.eq(pageDefs.slice().sort(), ['data', 'onLoad', 'onRetry', 'onShow', 'topFn'].sort(),
      '#36 页面函数识别覆盖顶层 function 与 Page 方法');
    const compSrc = 'Component({\n  properties: {},\n  methods: {\n    openSource() {},\n    clear() {}\n  }\n});\n';
    t.eq(deadCode.functionDefsOf(compSrc).slice().sort(), ['clear', 'methods', 'openSource', 'properties'].sort(),
      '#36 组件函数识别：Component methods 键 + 框架保留键（生命周期在扫描时豁免）');
    t.check(deadCode.LIFECYCLE.has('onShareAppMessage') && deadCode.LIFECYCLE.has('attached')
      && deadCode.FRAMEWORK_KEYS.has('Component') && !deadCode.LIFECYCLE.has('onRetry'),
    '#36 平台生命周期/框架保留键豁免集合有牙（onRetry 不在豁免内）');

    const baselinePath = path.join(ROOT, 'tools/dead-export-baseline.json');
    t.check(fs.existsSync(baselinePath), '#35 基线文件存在: tools/dead-export-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    t.eq(Object.keys(baseline.reasons || {}).sort(), Array.from(deadCode.REASONS).sort(),
      '#35 基线 reasons 分类恰好 = 扫描器 REASONS（history/test-only/contract-slot）');
    const entries = Array.isArray(baseline.deadExports) ? baseline.deadExports : [];
    t.check(entries.length > 0, '#35 存量基线非空（防空集全绿；实测条数见 node tools/lib/dead-code.js）');
    const bad = entries.filter((e) => !e || typeof e.file !== 'string' || !e.file
      || typeof e.symbol !== 'string' || !e.symbol || !deadCode.REASONS.has(e.reason));
    t.eq(bad, [], '#35 基线每项含 file+symbol+合法 reason（缺失/理由非法判红）');
    const keys = entries.map((e) => e.file + '#' + e.symbol);
    t.eq(keys.filter((k, i) => keys.indexOf(k) !== i), [], '#35 基线无重复登记');
    const testOnly = entries.filter((e) => e.reason === 'test-only');
    t.check(testOnly.length >= 20 && testOnly.every((e) => typeof e.evidence === 'string' && /^tools\//.test(e.evidence)),
      '#35 仅测试引用项带 tools/ 证据（实测条数以扫描器输出为准）');

    const enums = require(path.join(ROOT, 'shared/enums.js'));
    const pillMeta = require(path.join(ROOT, 'components/status-pill/meta.js'));
    const pillTexts = enums.ORDER_STATUS_LIST.map((status) => pillMeta.pillMetaOf(status).text);
    t.eq(pillTexts, ['待接单', '已接单', '已取件', '已送达', '已完成', '已取消', '异常'],
      '组件 status-pill 短文案由 shared/enums.ORDER_STATUS_TEXT 派生（七状态与枚举集合一致）');
    t.eq(pillMeta.pillMetaOf('BOGUS'), { text: '', tone: 'pending' }, '组件 status-pill 未知状态回落空文案+默认色调');
    const pillJs = read('components/status-pill/index.js');
    const pillCode = F.stripComments(pillJs);
    t.eq(['待接单', '已接单', '已取件', '已送达', '已完成', '已取消', '异常'].filter((s) => pillCode.indexOf(s) !== -1), [],
      '组件 status-pill 内零硬编码七状态中文（文案单源 = shared/enums）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-tools' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-tools');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
