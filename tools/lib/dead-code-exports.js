'use strict';
/**
 * tools/lib/dead-code-exports.js — 门禁 #35 未引用导出扫描（批 T5-C 从 tools/lib/dead-code.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；批 T5-C 从 tools/lib/dead-code.js 逐字搬移（判据/扫描范围零变更）。
 */
const { isSource, loadBaseline, shortList, walkRepo } = require('./dead-code-core');
const { buildTokenIndex, extractExports, internalRefsOf } = require('./dead-code-parse');

/** #35 全量导出使用表：`file#symbol` → { prodFiles, testFiles, internal }。 */
function scanExportUsage(scan) {
  const index = buildTokenIndex(scan);
  const usage = new Map();
  scan.rels.filter(isSource).forEach((file) => {
    const code = scan.stripped[file];
    extractExports(code).forEach((symbol) => {
      const refs = index.get(symbol) || { prod: new Set(), test: new Set() };
      usage.set(file + '#' + symbol, {
        prodFiles: Array.from(refs.prod).filter((rel) => rel !== file),
        testFiles: Array.from(refs.test),
        internal: internalRefsOf(scan, file, symbol)
      });
    });
  });
  return usage;
}

/** #35 扫描：生产 0 引用且文件内不自用的导出（仅测试引用在报告中单列）。 */
function scanExports(scan) {
  const findings = [];
  scanExportUsage(scan).forEach((item, key) => {
    if (item.prodFiles.length > 0 || item.internal > 0) return;
    findings.push({ file: key.slice(0, key.indexOf('#')), symbol: key.slice(key.indexOf('#') + 1), testFiles: item.testFiles });
  });
  return findings.sort((a, b) => (a.file + '\u0000' + a.symbol).localeCompare(b.file + '\u0000' + b.symbol));
}

/** 门禁 #35：未引用导出扫描。返回问题清单（null = 绿，check.js 判据约定）。 */
function runDeadExports() {
  const scan = walkRepo();
  const usage = scanExportUsage(scan);
  const findings = scanExports(scan);
  const baseline = loadBaseline();
  const problems = baseline.errors.slice();
  const seen = new Set();
  findings.forEach((item) => {
    const key = item.file + '#' + item.symbol;
    seen.add(key);
    const entry = baseline.deadExports.get(key);
    if (!entry) {
      const hint = item.testFiles.length
        ? '仅测试引用且未登记基线（' + item.testFiles.join(', ') + '）'
        : '生产/测试/文件内均 0 引用';
      problems.push('未引用导出: ' + item.file + ' · ' + item.symbol + '（' + hint + '）');
      return;
    }
    if (entry.reason === 'test-only' && item.testFiles.length === 0) {
      problems.push('基线理由不符: ' + key + ' 登记 test-only 但已无测试引用');
    }
  });
  baseline.deadExports.forEach((entry, key) => {
    if (seen.has(key)) return;
    const current = usage.get(key);
    // 已删除/已移出导出 = 债务已清理，基线项自动作废（不阻塞）；仍导出却已有生产引用 = 基线需删除
    if (current && current.prodFiles.length > 0) {
      problems.push('基线失效: ' + key + ' 已有生产引用，请移除基线项');
    }
  });
  return problems.length ? shortList(problems) : null;
}

module.exports = {
  scanExports,
  runDeadExports
};
