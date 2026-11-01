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
 *
 * 纪律：只读扫描、零写盘、零依赖、确定性输出（按文件+符号排序）；工具/文档/代码索引目录不计为生产引用。
 * 取数：node tools/lib/dead-code.js（打印完整清单与汇总，供报告留证据）。
 */
const path = require('path');
const F = require('./fsutil');

const ROOT = F.ROOT;
const BASELINE_REL = 'tools/dead-export-baseline.json';
const SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', '.dsh-code-index', 'docs']);
const CODE_EXTS = new Set(['.js']);
const TEXT_EXTS = new Set(['.js', '.wxml']);
// #35 导出扫描范围 = 小程序生产源码（云端 `shared/` 是生成副本，只作生产引用计数、不重复登记）
const EXPORT_DIRS = [
  'api/', 'components/', 'config/', 'custom-tab-bar/', 'pages/',
  'pkg-admin/', 'pkg-customer/', 'pkg-partner/', 'shared/', 'store/', 'utils/'
];
// #36 页面/组件目录 = 含 index.js 的页面目录与 components/<name>/
const PAGE_ROOTS = ['pages/', 'pkg-admin/pages/', 'pkg-customer/pages/', 'pkg-partner/pages/', 'components/'];
const REASONS = new Set(['history', 'test-only', 'contract-slot']);
// 平台/框架保留键：由运行时调用，静止扫描不出显式引用，不是死函数
const FRAMEWORK_KEYS = new Set([
  'Page', 'Component', 'Behavior', 'App', 'data', 'properties', 'options', 'observers', 'methods',
  'lifetimes', 'pageLifetimes', 'behaviors', 'externalClasses', 'relations', 'export'
]);
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onResize', 'onTabItemTap', 'onAddToFavorites',
  'onSaveExitState', 'onLaunch', 'onError', 'onPageNotFound', 'onThemeChange',
  'created', 'attached', 'ready', 'moved', 'detached', 'error'
]);

function walkRepo() {
  const rels = F.walk(ROOT, { exts: TEXT_EXTS, skip: SKIP }).map((f) => F.rel(f));
  const text = {};
  const stripped = {};
  rels.forEach((rel) => {
    const raw = F.readText(path.join(ROOT, rel));
    text[rel] = raw;
    stripped[rel] = rel.endsWith('.js') ? F.stripComments(raw) : raw;
  });
  return { rels, text, stripped };
}

function isSource(rel) {
  return rel.endsWith('.js') && EXPORT_DIRS.some((dir) => rel.startsWith(dir) && rel.indexOf('/') !== -1);
}

function isTestFile(rel) {
  return rel.startsWith('tools/');
}

/** 云函数 shared/ 副本是 tools/sync-cloud-shared.js 生成的同源副本：不重复计为"生产消费"，避免自我引用掩盖死导出。 */
function isGeneratedCopy(rel) {
  return /^cloudfunctions\/(api|cleanup)\/shared\//.test(rel);
}

/** 从 `{` 起点截取配平的整段对象块文本（不含外层花括号）。 */
function blockFrom(start, code) {
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, i);
    }
  }
  return null;
}

/** 取最后一个 `module.exports = {` 的对象块（含起止 offset 与块内文本）。 */
function exportBlock(code) {
  const marker = 'module.exports';
  const at = code.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = code.slice(at + marker.length);
  if (!/^\s*=\s*\{/.test(rest)) return null;
  const start = at + marker.length + rest.indexOf('{');
  const text = blockFrom(start, code);
  if (text === null) return null;
  const end = start + text.length + 1;
  return { start, end, text };
}

/** 顶层逗号切分对象块（跳过字符串/嵌套括号）。 */
function splitTop(body) {
  const segs = [];
  let depth = 0;
  let inStr = null;
  let esc = false;
  let seg = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (inStr) {
      seg += c;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; seg += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) { segs.push(seg); seg = ''; continue; }
    seg += c;
  }
  segs.push(seg);
  return segs;
}

/** 提取 CJS 导出符号名：`module.exports = { A, B: b }`（可多次）+ `module.exports.A =` + `exports.A =`。 */
function extractExports(code) {
  const names = [];
  const add = (name) => { if (names.indexOf(name) === -1) names.push(name); };
  const dotRe = /(?:module\.exports|exports)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
  let dot = dotRe.exec(code);
  while (dot !== null) {
    add(dot[1]);
    dot = dotRe.exec(code);
  }
  const marker = 'module.exports';
  let at = code.indexOf(marker);
  while (at !== -1) {
    const rest = code.slice(at + marker.length);
    if (/^\s*=\s*\{/.test(rest)) {
      const body = blockFrom(at + marker.length + rest.indexOf('{'), code);
      if (body !== null) {
        splitTop(body).forEach((seg) => {
          const item = seg.trim();
          if (!item || item.indexOf('...') === 0) return;
          const hit = item.match(/^([A-Za-z_$][\w$]*)\s*(:|$)/);
          if (hit) add(hit[1]);
        });
      }
    }
    at = code.indexOf(marker, at + marker.length);
  }
  return names;
}

/** 定义/导出结构行下标集合（换算引用时排除，避免把声明与导出本身当使用）。 */
function structuralLines(code, symbol) {
  const lines = code.split('\n');
  const marks = new Set();
  const block = exportBlock(code);
  if (block) {
    const from = code.slice(0, block.start).split('\n').length - 1;
    const to = code.slice(0, block.end).split('\n').length - 1;
    for (let i = from; i <= to; i += 1) marks.add(i);
  }
  const defRe = new RegExp('^\\s*(?:async\\s+)?function\\s+' + symbol + '\\b|^\\s*(?:const|let|var)\\s+' + symbol + '\\s*=');
  const expRe = new RegExp('^(?:module\\.exports|exports)\\s*\\.\\s*' + symbol + '\\s*=');
  lines.forEach((line, i) => {
    if (defRe.test(line) || expRe.test(line)) marks.add(i);
  });
  return marks;
}

/** 全仓 token 索引（仅 .js 且排除生成副本：WXML 数据字段名与 shared 副本会误伤导出判定）：token → {prod, test} 文件集。 */
function buildTokenIndex(scan) {
  const index = new Map();
  scan.rels.filter((rel) => rel.endsWith('.js') && !isGeneratedCopy(rel)).forEach((rel) => {
    const tokens = scan.stripped[rel].match(/[A-Za-z_$][\w$]*/g) || [];
    const bucket = isTestFile(rel) ? 'test' : 'prod';
    tokens.forEach((token) => {
      let entry = index.get(token);
      if (!entry) {
        entry = { prod: new Set(), test: new Set() };
        index.set(token, entry);
      }
      entry[bucket].add(rel);
    });
  });
  return index;
}

/** 文件内非结构行引用计数（文件内自用识别）。 */
function internalRefsOf(scan, file, symbol) {
  const code = scan.stripped[file];
  const marks = structuralLines(code, symbol);
  const re = new RegExp('\\b' + symbol.replace(/\$/g, '\\$') + '\\b', 'g');
  let internal = 0;
  code.split('\n').forEach((line, i) => {
    if (marks.has(i)) return;
    const hit = line.match(re);
    if (hit) internal += hit.length;
  });
  return internal;
}

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

function loadBaseline() {
  const full = path.join(ROOT, BASELINE_REL);
  if (!F.isFile(full)) {
    return { errors: ['基线缺失: ' + BASELINE_REL], deadExports: new Map(), pageDeadFunctions: new Map() };
  }
  let json;
  try {
    json = JSON.parse(F.readText(full));
  } catch (e) {
    return { errors: ['基线不可解析: ' + BASELINE_REL + ' · ' + e.message], deadExports: new Map(), pageDeadFunctions: new Map() };
  }
  const errors = [];
  const deadExports = new Map();
  const pageDeadFunctions = new Map();
  const collect = (list, kind, target) => {
    if (!Array.isArray(list)) { errors.push('基线缺 ' + kind + ' 数组'); return; }
    list.forEach((item, i) => {
      const where = BASELINE_REL + ' ' + kind + '[' + i + ']';
      if (!item || typeof item.file !== 'string' || item.file === '') { errors.push(where + ' 缺 file'); return; }
      const symbol = kind === 'deadExports' ? item.symbol : item.function;
      if (typeof symbol !== 'string' || symbol === '') { errors.push(where + ' 缺 ' + (kind === 'deadExports' ? 'symbol' : 'function')); return; }
      if (!REASONS.has(item.reason)) { errors.push(where + ' 理由分类非法: ' + JSON.stringify(item.reason)); return; }
      const key = item.file + '#' + symbol;
      if (target.has(key)) { errors.push(where + ' 重复登记: ' + key); return; }
      target.set(key, item);
    });
  };
  collect(json.deadExports, 'deadExports', deadExports);
  collect(json.pageDeadFunctions, 'pageDeadFunctions', pageDeadFunctions);
  return { errors, deadExports, pageDeadFunctions };
}

function shortList(items, limit) {
  const lim = limit || 24;
  return items.slice(0, lim).concat(items.length > lim ? ['…（共 ' + items.length + ' 项）'] : []);
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

function pageDirs(scan) {
  const dirs = new Set();
  scan.rels.filter((rel) => rel.endsWith('/index.js')).forEach((rel) => {
    const dir = rel.slice(0, rel.length - '/index.js'.length);
    const parts = dir.split('/');
    const isComponent = parts.length === 2 && dir.startsWith('components/');
    const isPageDir = parts.length >= 3 && PAGE_ROOTS.some((root) => dir.startsWith(root) && root !== 'components/');
    if (isComponent || isPageDir) dirs.add(dir);
  });
  return Array.from(dirs).sort();
}

/** 取 `Page({` / `Component({` 的第一个对象块。 */
function braceBlockOf(code, marker) {
  const at = code.indexOf(marker);
  if (at === -1) return null;
  const start = code.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, i);
    }
  }
  return null;
}

/** 对象块顶层键名（方法简写/`key: value` 都算）。 */
function topKeys(body) {
  return splitTop(body).map((seg) => {
    const item = seg.trim();
    const hit = item.match(/^([A-Za-z_$][\w$]*)\s*(?::|\(|$)/);
    return hit ? hit[1] : '';
  }).filter((name) => name !== '');
}

/** 从源码提取「页面/组件可定义函数名」：顶层 function + Page 方法 + Component.methods。 */
function functionDefsOf(code) {
  const names = [];
  const add = (name) => { if (name && names.indexOf(name) === -1) names.push(name); };
  (code.match(/^\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gm) || []).forEach((line) => {
    const hit = line.match(/function\s+([A-Za-z_$][\w$]*)/);
    if (hit) add(hit[1]);
  });
  const pageBody = braceBlockOf(code, 'Page(');
  if (pageBody) topKeys(pageBody).forEach(add);
  const compBody = braceBlockOf(code, 'Component(');
  if (compBody) {
    topKeys(compBody).forEach(add);
    const methodsBody = braceBlockOf(compBody, 'methods:');
    if (methodsBody) topKeys(methodsBody).forEach(add);
  }
  return names;
}

/** #36 扫描：页面/组件目录内定义但 JS/WXML 均无引用的函数（含跨目录生产引用，组件方法可被父页调用）。 */
function scanPageFunctions(scan) {
  const findings = [];
  const prodTokenFiles = new Map();
  scan.rels.filter((rel) => !isTestFile(rel) && !isGeneratedCopy(rel)).forEach((rel) => {
    (scan.stripped[rel].match(/[A-Za-z_$][\w$]*/g) || []).forEach((token) => {
      let set = prodTokenFiles.get(token);
      if (!set) { set = new Set(); prodTokenFiles.set(token, set); }
      set.add(rel);
    });
  });
  pageDirs(scan).forEach((dir) => {
    const files = scan.rels.filter((rel) => rel.startsWith(dir + '/'));
    files.filter((rel) => rel.endsWith('.js')).forEach((file) => {
      functionDefsOf(scan.stripped[file]).forEach((name) => {
        if (FRAMEWORK_KEYS.has(name) || LIFECYCLE.has(name)) return;
        const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g');
        let inside = 0;
        files.forEach((rel) => {
          const hit = scan.stripped[rel].match(re);
          if (hit) inside += hit.length;
        });
        if (inside > 1) return;
        const outside = Array.from(prodTokenFiles.get(name) || []).filter((rel) => !rel.startsWith(dir + '/'));
        if (outside.length > 0) return;
        const plain = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
        const testFiles = scan.rels.filter((rel) => isTestFile(rel) && plain.test(scan.stripped[rel]));
        findings.push({ file, name, testFiles });
      });
    });
  });
  return findings.sort((a, b) => (a.file + '\u0000' + a.name).localeCompare(b.file + '\u0000' + b.name));
}

/** 门禁 #36：页面死函数扫描。返回问题清单（null = 绿，check.js 判据约定）。 */
function runPageDeadFunctions() {
  const scan = walkRepo();
  const findings = scanPageFunctions(scan);
  const baseline = loadBaseline();
  const problems = baseline.errors.slice();
  const seen = new Set();
  findings.forEach((item) => {
    const key = item.file + '#' + item.name;
    seen.add(key);
    if (!baseline.pageDeadFunctions.has(key)) {
      problems.push('页面死函数: ' + item.file + ' · ' + item.name + '（WXML/JS 均无引用）');
    }
  });
  baseline.pageDeadFunctions.forEach((entry, key) => {
    if (seen.has(key)) return;
    const file = key.slice(0, key.indexOf('#'));
    const name = key.slice(key.indexOf('#') + 1);
    // 文件或函数已删除 = 债务已清理，基线项自动作废（不阻塞）
    if (!scan.stripped[file] || functionDefsOf(scan.stripped[file]).indexOf(name) === -1) return;
    const dirMatch = pageDirs(scan).filter((dir) => file.startsWith(dir + '/'))[0] || '';
    if (!dirMatch) return;
    problems.push('基线失效: 页面死函数 ' + key + ' 已有引用/不再命中，请移除基线项');
  });
  return problems.length ? shortList(problems) : null;
}

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
  extractExports,
  functionDefsOf,
  scanExports,
  scanPageFunctions,
  runDeadExports,
  runPageDeadFunctions
};

if (require.main === module) {
  const result = report();
  process.exitCode = result.deadExports.length === 0 && result.deadFunctions.length === 0 ? 0 : 1;
}
