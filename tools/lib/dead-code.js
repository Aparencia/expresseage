'use strict';
/**
 * tools/lib/dead-code.js — 死代码扫描器（门禁 #35 未引用导出 / #36 页面死函数）
 *
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；存量白名单 = tools/dead-export-baseline.json。
 * 判据（新增即红，基线之外零容忍）：
 *   #35：生产源码每个 `module.exports` 符号必须「生产端有引用」；生产 0 引用（仅测试引用/文件内自用）
 *        的导出必须逐条登记基线并给分类理由（history/test-only/contract-slot）。基线项失效（符号已删/
 *        已出现生产引用/理由非法）同样判红，防止白名单静默腐烂。
 *   #36：页面/组件目录内「定义但 WXML/JS 均无引用」的函数（Page 方法、Component methods、顶层
 *        function）必须登记基线；平台生命周期/框架保留键不算死函数。
 *        引用判定是语法级、按目录可达性收敛的（不再用裸 token 计数）：
 *          - 同目录：`.NAME` 属性访问（含 this.NAME）、裸调用 `NAME(`、WXML 事件绑定值 `="NAME"`、
 *            间接引用（回调/别名值位置）；排除定义处（Page/Component 方法简写键、function 声明、
 *            导出对象的符号键）。同目录任意文件互相引用都算。
 *          - 跨目录：只有真实可达引用才算——`require` 目标路径（归一化后）落在定义目录内时，
 *            别名 `alias.NAME`、解构后的裸调用、内联 `require(...).NAME`；组件另认
 *            `selectComponent(...)` 选到的组件（选择器 id → WXML 标签 → usingComponents 解析）
 *            上调用/别名访问的方法。无关对象的同名属性（如 pendingInvite.clear()）不算引用。
 *          - 测试引用：只认 `require` 了该目录内文件的测试（其语法级同名引用才算存活），
 *            无关测试里的同名 token/源码字符串（如 pickerSrc.indexOf('clear()')）不算。
 *        扫描范围 = tools/lib/project.js ALL_PAGES（32 页，含 depth-2 主包页）+ components/<name>（12 个）= 44 个目录。
 *
 * 纪律：只读扫描、零写盘、零依赖、确定性输出（按文件+符号排序）；工具/文档/代码索引目录不计为生产引用。
 * 取数：node tools/lib/dead-code.js（打印完整清单与汇总，供报告留证据）。
 */
const {
  BASELINE_REL, REASONS, LIFECYCLE, FRAMEWORK_KEYS, walkRepo, isSource, loadBaseline
} = require('./dead-code-core');
const { extractExports } = require('./dead-code-parse');
const { importTargetsOf, testFilesByDir } = require('./dead-code-refs');
const { scanExports, runDeadExports } = require('./dead-code-exports');
const {
  pageDirs, functionDefsOf, functionDefsWithPositions, jsRefsOf, wxmlHandlerNames,
  scanPageFunctions, runPageDeadFunctions
} = require('./dead-code-pages');

function report() {
  const scan = walkRepo();
  const exportsFindings = scanExports(scan);
  const pageFindings = scanPageFunctions(scan);
  const baseline = loadBaseline();
  const deadExports = runDeadExports() || [];
  const deadFunctions = runPageDeadFunctions() || [];
  console.log('== tools/lib/dead-code.js · #35/#36 扫描 ==');
  console.log('生产源码导出扫描：文件 ' + scan.rels.filter(isSource).length + ' 个；生产 0 引用导出 ' + exportsFindings.length + ' 个（基线登记 ' + baseline.deadExports.size + '）');
  exportsFindings.forEach((item) => {
    const entry = baseline.deadExports.get(item.file + '#' + item.symbol);
    console.log('  #35 ' + (entry ? '[基线:' + entry.reason + ']' : '[未登记]') + ' ' + item.file + ' · ' + item.symbol
      + (item.testFiles.length ? '（测试引用: ' + item.testFiles.join(',') + '）' : ''));
  });
  console.log('页面/组件目录：' + pageDirs(scan).length + ' 个；死函数候选 ' + pageFindings.length + ' 个（基线登记 ' + baseline.pageDeadFunctions.size + '）');
  pageFindings.forEach((item) => {
    const entry = baseline.pageDeadFunctions.get(item.file + '#' + item.name);
    console.log('  #36 ' + (entry ? '[基线:' + entry.reason + ']' : '[未登记]') + ' ' + item.file + ' · ' + item.name);
  });
  console.log('#35 问题 ' + deadExports.length + ' 项；#36 问题 ' + deadFunctions.length + ' 项');
  deadExports.forEach((p) => console.log('  #35 - ' + p));
  deadFunctions.forEach((p) => console.log('  #36 - ' + p));
  return { exportsFindings, pageFindings, deadExports, deadFunctions };
}

module.exports = {
  BASELINE_REL,
  REASONS,
  LIFECYCLE,
  FRAMEWORK_KEYS,
  walkRepo,
  pageDirs,
  extractExports,
  functionDefsOf,
  functionDefsWithPositions,
  jsRefsOf,
  wxmlHandlerNames,
  importTargetsOf,
  testFilesByDir,
  scanExports,
  scanPageFunctions,
  runDeadExports,
  runPageDeadFunctions
};

if (require.main === module) {
  const result = report();
  process.exitCode = result.deadExports.length === 0 && result.deadFunctions.length === 0 ? 0 : 1;
}
