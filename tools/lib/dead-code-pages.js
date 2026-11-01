'use strict';
/**
 * tools/lib/dead-code-pages.js — 门禁 #36 页面/组件死函数扫描（批 T5-C 从 tools/lib/dead-code.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；批 T5-C 从 tools/lib/dead-code.js 逐字搬移（判据/扫描范围零变更）。
 */
const path = require('path');
const PROJECT = require('./project');
const { FRAMEWORK_KEYS, LIFECYCLE, loadBaseline, shortList, walkRepo, isTestFile } = require('./dead-code-core');
const { blankQuoted, braceBlockAt, escRe, exportKeyPositionsOf, topKeyPositions } = require('./dead-code-parse');
const { crossDirRefs, testFilesByDir } = require('./dead-code-refs');

/** #36 扫描目录：ALL_PAGES 全量页面目录（含 pages/launch|profile|role 等 depth-2 主包页）+ components/<name>/。 */
function pageDirs(scan) {
  const relSet = new Set(scan.rels);
  const dirs = new Set();
  PROJECT.ALL_PAGES.forEach((page) => {
    const dir = path.posix.dirname(page);
    if (!dir || dir === '.' || dir === '/') return;
    if (relSet.has(dir + '/index.js')) dirs.add(dir);
  });
  scan.rels.forEach((rel) => {
    if (!rel.endsWith('/index.js')) return;
    const dir = rel.slice(0, rel.length - '/index.js'.length);
    if (dir.split('/').length === 2 && dir.indexOf('components/') === 0) dirs.add(dir);
  });
  return Array.from(dirs).sort();
}

/** 页面/组件函数名的定义位置：顶层 function 声明 + Page/Component 顶层键 + Component.methods 键。 */
function functionDefsWithPositions(code) {
  const defs = [];
  const push = (name, start) => { defs.push({ name: name, start: start, end: start + name.length }); };
  const fnRe = /^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  let hit = fnRe.exec(code);
  while (hit !== null) {
    push(hit[1], hit.index + hit[0].length - hit[1].length);
    hit = fnRe.exec(code);
  }
  const callBlock = (marker) => {
    const re = new RegExp('\\b' + marker + '\\s*\\(', 'g');
    let found = re.exec(code);
    while (found !== null) {
      const open = code.indexOf('{', found.index + found[0].length);
      if (open !== -1) {
        const block = braceBlockAt(code, open);
        if (block) return block;
      }
      found = re.exec(code);
    }
    return null;
  };
  const pageBlock = callBlock('Page');
  if (pageBlock) topKeyPositions(code, pageBlock).forEach((item) => push(item.name, item.offset));
  const compBlock = callBlock('Component');
  if (compBlock) {
    const keys = topKeyPositions(code, compBlock);
    keys.forEach((item) => push(item.name, item.offset));
    const methodsKey = keys.filter((item) => item.name === 'methods')[0];
    if (methodsKey) {
      const open = code.indexOf('{', methodsKey.offset);
      if (open !== -1 && open < compBlock.innerEnd) {
        const methodsBlock = braceBlockAt(code, open);
        if (methodsBlock) topKeyPositions(code, methodsBlock).forEach((item) => push(item.name, item.offset));
      }
    }
  }
  return defs;
}

/** 从源码提取「页面/组件可定义函数名」：顶层 function + Page 方法 + Component.methods（去重，保持声明顺序）。 */
function functionDefsOf(code) {
  const names = [];
  functionDefsWithPositions(code).forEach((item) => {
    if (names.indexOf(item.name) === -1) names.push(item.name);
  });
  return names;
}

/** 文件内对 name 的语法级引用：`.NAME` 属性访问 / 裸调用 `NAME(` / 间接引用（回调、别名等值位置）。 */
function jsRefsOf(code, name, defs) {
  const defRanges = defs.filter((item) => item.name === name);
  const exportKeys = exportKeyPositionsOf(code);
  const re = new RegExp('\\b' + escRe(name) + '\\b', 'g');
  let hit = re.exec(code);
  while (hit !== null) {
    const start = hit.index;
    const isDef = defRanges.some((item) => start >= item.start && start < item.end);
    const isExportKeyPos = exportKeys.some((item) => start >= item.start && start < item.end);
    if (!isDef && !isExportKeyPos) {
      const before = code.slice(Math.max(0, start - 48), start).replace(/\s+$/, '');
      const after = code.slice(start + name.length, start + name.length + 6);
      const isFunctionName = /\bfunction$/.test(before);
      const isExportKey = /(?:module\.exports|exports)\s*\.$/.test(before);
      const isProperty = /\.$/.test(before);
      const isObjectKey = !isProperty && /^[ \t]*:/.test(after) && /[{,]$/.test(before);
      if (!isFunctionName && !isExportKey && !isObjectKey) return true;
    }
    hit = re.exec(code);
  }
  return false;
}

/** WXML 事件绑定处理名：bindtap / bind:tap / catchtap / capture-bind:tap / mut-bind:tap 的属性值。 */
function wxmlHandlerNames(text) {
  const names = new Set();
  const re = /(?:^|[\s"'<])(?:bind|catch|capture-bind|capture-catch|mut-bind)(?::[a-zA-Z]+|[a-zA-Z]+)\s*=\s*["']([^"']+)["']/g;
  let hit = re.exec(text);
  while (hit !== null) { names.add(hit[1]); hit = re.exec(text); }
  return names;
}

/** #36 扫描：页面/组件目录内定义但 JS/WXML 均无引用的函数（语法级引用判定，按目录可达性收敛）。 */
function scanPageFunctions(scan) {
  const dirs = pageDirs(scan);
  const crossRefs = crossDirRefs(scan, dirs);
  const testRefs = testFilesByDir(scan, dirs);
  const findings = [];
  const seen = new Set();
  dirs.forEach((dir) => {
    const dirFiles = scan.rels.filter((rel) => rel.indexOf(dir + '/') === 0);
    const jsFiles = dirFiles.filter((rel) => rel.endsWith('.js'));
    const wxmlAlive = new Set();
    dirFiles.filter((rel) => rel.endsWith('.wxml')).forEach((rel) => {
      wxmlHandlerNames(scan.text[rel] || '').forEach((name) => wxmlAlive.add(name));
    });
    const crossAlive = crossRefs.get(dir) || new Set();
    const testFiles = testRefs.get(dir) || [];
    const testCode = testFiles.map((rel) => blankQuoted(scan.stripped[rel] || ''));
    jsFiles.forEach((file) => {
      const raw = scan.stripped[file] || '';
      const code = blankQuoted(raw);
      const defs = functionDefsWithPositions(raw);
      defs.forEach((def) => {
        const name = def.name;
        if (FRAMEWORK_KEYS.has(name) || LIFECYCLE.has(name)) return;
        const key = file + '#' + name;
        if (seen.has(key)) return;
        seen.add(key);
        if (wxmlAlive.has(name) || crossAlive.has(name)) return;
        const alive = jsFiles.some((rel) => jsRefsOf(rel === file ? code : blankQuoted(scan.stripped[rel] || ''),
          name, rel === file ? defs : []))
          || testCode.some((text) => jsRefsOf(text, name, []));
        if (alive) return;
        const plain = new RegExp('\\b' + escRe(name) + '\\b');
        const testHits = scan.rels.filter((rel) => isTestFile(rel) && plain.test(scan.stripped[rel] || ''));
        findings.push({ file: file, name: name, testFiles: testHits });
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

module.exports = {
  pageDirs,
  functionDefsWithPositions,
  functionDefsOf,
  jsRefsOf,
  wxmlHandlerNames,
  scanPageFunctions,
  runPageDeadFunctions
};
