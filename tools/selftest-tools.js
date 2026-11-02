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
 *      （短文案从 shared/enums.ORDER_STATUS_TEXT 派生，组件内零硬编码七状态中文）；
 *   F. 批 T2 门禁 #36 语法级引用判定：扫描范围 = ALL_PAGES 全量页面目录（含 depth-2 主包页）+ 组件目录；
 *      合成用例覆盖「跨目录无关同名属性不算引用 / 同目录 this.NAME / WXML 绑定 / 解构 require 跨目录 /
 *      depth-2 纳入扫描 / 测试引用只在 require 该目录时生效 / 页面死函数基线结构」。
 *   G. 批 24/D65 门禁 #37~#39 扫描器本体：tab 页根 `page-body--tab`（伪 tab 页缺失时记 absent 跳过）、
 *      fixed+bottom:0 必带 env/全局 token（逐条基线先绿、基线失效首红、非贴屏底不计入）、
 *      onPullDownRefresh ⇔ enablePullDownRefresh 双向（剥注释；有 handler 无开关/有开关无 handler 各一红）。
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
const PROJECT = require('./lib/project');
const { ALL_COLLECTIONS } = require(path.join(__dirname, '..', 'shared/collections.js'));

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ASSERTIONS = 50; // 实跑读数：node tools/selftest-tools.js（10 原有 + 14 批 16 + 11 批 T2 #36 + 15 批 24/D65 #37~#39 三闸）

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 合成扫描视图（#36 扫描器自检用：不落盘、不依赖实仓页面内容）。 */
function syntheticScan(files) {
  const rels = Object.keys(files).sort();
  const text = {};
  const stripped = {};
  rels.forEach((rel) => {
    text[rel] = files[rel];
    stripped[rel] = rel.endsWith('.js') ? F.stripComments(files[rel]) : files[rel];
  });
  return { rels: rels, text: text, stripped: stripped };
}

/** #36 findings 的可读键（file#name）。 */
function findingKeys(list) {
  return list.map((item) => item.file + '#' + item.name);
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

  // 批 T2：门禁 #36 语法级引用判定 + 全页覆盖（合成用例先红后绿；防「裸 token 计数」假阴性回归）
  h.section('§8.2 #36 页面死函数扫描：语法级引用判定与扫描范围（T2）', (t) => {
    const realScan = deadCode.walkRepo();
    const realDirs = deadCode.pageDirs(realScan);
    const pageDirList = realDirs.filter((dir) => dir.indexOf('components/') !== 0);
    const componentDirList = realDirs.filter((dir) => dir.indexOf('components/') === 0);
    t.eq(pageDirList.length, PROJECT.ALL_PAGES.length,
      '#36 实仓扫描页面目录数 = project.ALL_PAGES 条数（含 depth-2 主包页；不写死）');
    t.check(componentDirList.length > 0, '#36 实仓扫描组件目录数 > 0（防空集全绿）');
    const depth2Dirs = PROJECT.ALL_PAGES.map((page) => page.slice(0, page.lastIndexOf('/')))
      .filter((dir) => dir.split('/').length === 2);
    t.eq(depth2Dirs.filter((dir) => realDirs.indexOf(dir) === -1), [],
      '#36 pageDirs 覆盖全部 depth-2 主包页目录（pages/launch|profile|role 不再漏扫）');

    const scanUnrelated = syntheticScan({
      'pages/launch/index.js': 'Page({\n  data: {},\n  clear() {\n    return 1;\n  }\n});\n',
      'pages/launch/index.wxml': '<view class="x"></view>\n',
      'utils/other.js': 'function tidy(invite) {\n  return invite.clear();\n}\nmodule.exports = { tidy };\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanUnrelated)), ['pages/launch/index.js#clear'],
      '#36(i) 跨目录无关对象同名属性（invite.clear()）不算引用，页面 clear() 仍判死（防假阴性回归）');

    const scanThis = syntheticScan({
      'pages/role/index.js': 'Page({\n  data: {},\n  clear() {\n    return 1;\n  },\n  onTap() {\n    this.clear();\n  }\n});\n',
      'pages/role/index.wxml': '<view bindtap="onTap"></view>\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanThis)), [],
      '#36(ii) 同目录 this.NAME() 引用 → 函数存活（clear/onTap 均不计死）');

    const scanWxml = syntheticScan({
      'pages/profile/index.js': 'Page({\n  data: {},\n  onOpen() {\n    return 1;\n  }\n});\n',
      'pages/profile/index.wxml': '<view bind:tap="onOpen"></view>\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanWxml)), [],
      '#36(iii) WXML 事件绑定 bind:tap="NAME" → 函数存活（不误判事件处理器）');

    const scanRequire = syntheticScan({
      'pages/profile/index.js': 'Page({\n  data: {}\n});\n',
      'pages/profile/index.wxml': '<view></view>\n',
      'pages/profile/parts/helper.js': 'function formatName(value) {\n  return String(value || "").trim();\n}\nmodule.exports = { formatName };\n',
      'pkg-partner/pages/pick-list/index.js': 'const { formatName } = require("../../../pages/profile/parts/helper");\nPage({\n  data: {},\n  onLoad() {\n    formatName("x");\n  }\n});\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanRequire)), [],
      '#36(iv) 解构 require 跨目录调用 → 函数存活（require 目标归一化后落在定义目录才计）');

    const scanDepth2 = syntheticScan({
      'pages/launch/index.js': 'Page({\n  data: {},\n  onTap() {\n    return 1;\n  }\n});\n',
      'pages/launch/index.wxml': '<view></view>\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanDepth2)), ['pages/launch/index.js#onTap'],
      '#36(v) depth-2 主包页目录（pages/launch）纳入扫描：未绑定的 onTap 被判死');

    const scanTestRef = syntheticScan({
      'pages/launch/index.js': 'Page({\n  data: {},\n  clear() {\n    return 1;\n  }\n});\n',
      'pages/launch/index.wxml': '<view></view>\n',
      'tools/selftest-other.js': 'function tidy(invite) {\n  return invite.clear();\n}\nmodule.exports = { tidy };\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanTestRef)), ['pages/launch/index.js#clear'],
      '#36 未 require 该目录的测试同名 token（invite.clear）不算测试引用');

    const scanTestCall = syntheticScan({
      'pages/launch/index.js': 'Page({\n  data: {},\n  clear() {\n    return 1;\n  }\n});\n',
      'pages/launch/index.wxml': '<view></view>\n',
      'tools/selftest-page.js': 'const page = require(path.join(ROOT, "pages/launch/index.js"));\npage.clear();\n'
    });
    t.eq(findingKeys(deadCode.scanPageFunctions(scanTestCall)), [],
      '#36 require 该目录的测试里 .clear() 调用 → 存活（测试覆盖的页面函数不算死函数）');

    const pageBaseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/dead-export-baseline.json'), 'utf8'));
    const pageEntries = Array.isArray(pageBaseline.pageDeadFunctions) ? pageBaseline.pageDeadFunctions : [];
    t.eq(pageEntries.filter((e) => !e || typeof e.file !== 'string' || !e.file || typeof e.function !== 'string'
      || !e.function || !deadCode.REASONS.has(e.reason) || typeof e.evidence !== 'string'), [],
    '#36 页面死函数基线每项含 file+function+合法 reason+evidence（缺失/理由非法判红）');
  });

  // 批 24/D65：门禁 #37/#38/#39 扫描器本体（合成合法基线先绿 + 反例首红；判据自身可测，防空集/空转全绿）
  h.section('§8.2 #37/#38/#39 D65 底部安全区三闸（tab 根类/固定底条/下拉开关）', (t) => {
    const layout = require('./lib/check-layout');

    const rootOk = layout.scanTabPageRoots([
      { page: 'pages/a/index', wxml: '<!-- 注释 -->\n<view class="page-body page-body--tab">\n</view>\n' }
    ]);
    t.eq(rootOk.bad, [], '#37 tab 页根 class 含 page-body--tab → 通过（注释先剥）');
    const rootBad = layout.scanTabPageRoots([{ page: 'pages/a/index', wxml: '<view class="page-body">\n</view>\n' }]);
    t.eq(rootBad.bad.length, 1, '#37 根 class 缺 page-body--tab → 判红');
    const rootAbsent = layout.scanTabPageRoots([{ page: 'pages/customer/pickcodes/index', wxml: null }]);
    t.eq(rootAbsent.absent, ['pages/customer/pickcodes/index'], '#37 伪 tab 页未创建时记 absent 跳过（不误红）');

    const badBar = layout.scanFixedBottomSafe({ 'pkg/x.wxss': '.bar {\n  position: fixed;\n  bottom: 0;\n  color: #000;\n}\n' }, []);
    t.eq(badBar.offenders, ['pkg/x.wxss::.bar'], '#38 fixed+bottom:0 无安全区底垫 → 判红');
    const okBar = layout.scanFixedBottomSafe({ 'pkg/x.wxss': '.bar {\n  position: fixed;\n  bottom: 0;\n  padding-bottom: env(safe-area-inset-bottom);\n}\n' }, []);
    t.eq(okBar.offenders, [], '#38 同一规则含 env(safe-area-inset-bottom) → 通过');
    const tokenBar = layout.scanFixedBottomSafe({ 'pkg/x.wxss': '.bar {\n  position: fixed;\n  bottom: 0;\n  padding-bottom: var(--v4-inset-bar);\n}\n' }, []);
    t.eq(tokenBar.offenders, [], '#38 显式使用全局 token（var(--v4-*)）→ 通过');
    const masked = layout.scanFixedBottomSafe(
      { 'pkg/mask.wxss': '.m {\n  position: fixed;\n  top: 0;\n  bottom: 0;\n}\n' },
      [{ file: 'pkg/mask.wxss', selector: '.m', key: 'pkg/mask.wxss::.m' }]
    );
    t.eq([masked.offenders, masked.stale], [[], []], '#38 全屏居中遮罩逐条基线登记 → 通过且不算基线失效');
    const stale = layout.scanFixedBottomSafe(
      { 'pkg/x.wxss': '.bar { position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom); }\n' },
      [{ file: 'pkg/x.wxss', selector: '.bar', key: 'pkg/x.wxss::.bar' }]
    );
    t.eq(stale.stale, ['pkg/x.wxss::.bar'], '#38 基线条目已修复/改名 → 基线失效判红');
    const nonZero = layout.scanFixedBottomSafe({ 'pkg/x.wxss': '.undo { position: fixed; bottom: 160rpx; }\n' }, []);
    t.eq(nonZero.fixedBottomRules, 0, '#38 非贴屏底（bottom:160rpx）不计入本判据');

    const realBaseline = JSON.parse(read('tools/lib/bottom-safe-baseline.json'));
    const realCheck = layout.validateBaseline(realBaseline);
    t.eq(realCheck.problems, [], '#38 实仓基线结构合法（file+selector+reason 枚举，无重复）');
    t.check(realCheck.entries.length > 0, '#38 实仓基线非空（只逐条登记全屏遮罩，禁止目录豁免）');

    const pdClean = layout.scanPullDown([
      { page: 'pages/a/index', js: 'Page({\n  onPullDownRefresh() {}\n});\n', json: { enablePullDownRefresh: true } }
    ]);
    t.eq(pdClean.issues, [], '#39 handler 与 json 开关一致 → 通过');
    const pdNoFlag = layout.scanPullDown([
      { page: 'pages/a/index', js: 'Page({\n  onPullDownRefresh() {}\n});\n', json: {} }
    ]);
    t.eq(pdNoFlag.issues.length, 1, '#39 有 handler 未开开关 → 判红（下拉无响应）');
    const pdNoHandler = layout.scanPullDown([
      { page: 'pages/a/index', js: 'Page({\n  data: {}\n});\n', json: { enablePullDownRefresh: true } }
    ]);
    t.eq(pdNoHandler.issues.length, 1, '#39 开了开关无 handler → 判红（下拉空转）');
    const pdComment = layout.scanPullDown([
      { page: 'pages/a/index', js: 'Page({\n  // onPullDownRefresh() {}\n  data: {}\n});\n', json: {} }
    ]);
    t.eq([pdComment.handlers, pdComment.issues], [0, []], '#39 注释里的 onPullDownRefresh 不算 handler（剥注释后判定）');
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
