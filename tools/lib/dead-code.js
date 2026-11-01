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
const path = require('path');
const F = require('./fsutil');
const PROJECT = require('./project');

const ROOT = F.ROOT;
const BASELINE_REL = 'tools/dead-export-baseline.json';
const SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', '.dsh-code-index', 'docs']);
// wxml 供 #36 事件绑定判定；json 供 #36 组件 selectComponent 选择器 → usingComponents 解析
const TEXT_EXTS = new Set(['.js', '.wxml', '.json']);
// #35 导出扫描范围 = 小程序生产源码（云端 `shared/` 是生成副本，只作生产引用计数、不重复登记）
const EXPORT_DIRS = [
  'api/', 'components/', 'config/', 'custom-tab-bar/', 'pages/',
  'pkg-admin/', 'pkg-customer/', 'pkg-partner/', 'shared/', 'store/', 'utils/'
];
// #36 扫描范围 = tools/lib/project.js ALL_PAGES（含 depth-2 主包页）+ components/<name>/；不写死目录数。
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

/** 取从 `{` 起点截取配平的整段对象块文本（不含外层花括号）。 */
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

/** 取从 start（'{' 下标）起配平的对象块：{ text, innerStart, innerEnd }（后二者为 code 内绝对下标）。 */
function braceBlockAt(code, start) {
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
      if (depth === 0) return { text: code.slice(start + 1, i), innerStart: start + 1, innerEnd: i };
    }
  }
  return null;
}

const REGEX_PREV = '([{,;=:!&|?+-*%^~<>';
const REGEX_KEYWORDS = /\b(?:return|typeof|instanceof|in|of|case|new|delete|void|throw|else|do|yield|await)$/;

/** 把字符串/正则/模板字面量内容替换为等长空格（保留引号/斜杠/换行与 `${}` 表达式代码），避免字面量里的名字被当引用。 */
function blankQuoted(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      out += c;
      i += 1;
      while (i < code.length) {
        const d = code[i];
        if (d === '\\') { out += '  '; i += 2; continue; }
        if (d === c) { out += d; i += 1; break; }
        out += d === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (c === '`') {
      out += c;
      i += 1;
      while (i < code.length) {
        const d = code[i];
        if (d === '\\') { out += '  '; i += 2; continue; }
        if (d === '`') { out += '`'; i += 1; break; }
        if (d === '$' && code[i + 1] === '{') {
          const start = i;
          let depth = 0;
          let inStr = null;
          let esc = false;
          let j = i + 1;
          for (; j < code.length; j += 1) {
            const e = code[j];
            if (inStr) {
              if (esc) { esc = false; continue; }
              if (e === '\\') { esc = true; continue; }
              if (e === inStr) inStr = null;
              continue;
            }
            if (e === '"' || e === "'" || e === '`') { inStr = e; continue; }
            if (e === '{') depth += 1;
            else if (e === '}') {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          out += code.slice(start, j + 1);
          i = j + 1;
          continue;
        }
        out += d === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && code[i + 1] !== '/' && code[i + 1] !== '*') {
      const prev = out.replace(/\s+$/, '');
      const prevChar = prev.slice(-1);
      const isRegex = prevChar === '' || REGEX_PREV.indexOf(prevChar) !== -1
        || REGEX_KEYWORDS.test(prev.slice(-16));
      if (isRegex) {
        out += '/';
        i += 1;
        let inClass = false;
        while (i < code.length) {
          const d = code[i];
          if (d === '\\') { out += '  '; i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          if (d === '/' && !inClass) { out += '/'; i += 1; break; }
          out += d === '\n' ? '\n' : ' ';
          i += 1;
        }
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 正则字面量转义。 */
function escRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** 顶层逗号切分（带段起始 offset）：用于对象块顶层键定位。 */
function splitTopWithOffsets(body) {
  const segs = [];
  let depth = 0;
  let inStr = null;
  let esc = false;
  let segStart = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) { segs.push({ text: body.slice(segStart, i), start: segStart }); segStart = i + 1; }
  }
  segs.push({ text: body.slice(segStart), start: segStart });
  return segs;
}

/** 对象块顶层键的位置（`key: value` / 方法简写 / 裸键）：返回 [{ name, offset }]（offset 为 code 内绝对下标）。 */
function topKeyPositions(code, block) {
  const out = [];
  splitTopWithOffsets(block.text).forEach((seg) => {
    const lead = seg.text.length - seg.text.replace(/^\s+/, '').length;
    const hit = seg.text.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|\(|$)/);
    if (hit) out.push({ name: hit[1], offset: block.innerStart + seg.start + lead });
  });
  return out;
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

/** 导出对象的顶层键位置（`module.exports = { NAME }` / `{ NAME() {} }`）：导出列表本身不算引用，但其内部函数体照常计。 */
function exportKeyPositionsOf(code) {
  const out = [];
  const marker = 'module.exports';
  let at = code.indexOf(marker);
  while (at !== -1) {
    const rest = code.slice(at + marker.length);
    if (/^\s*=\s*\{/.test(rest)) {
      const start = at + marker.length + rest.indexOf('{');
      const block = braceBlockAt(code, start);
      if (block) {
        topKeyPositions(code, block).forEach((item) => {
          out.push({ start: item.offset, end: item.offset + item.name.length });
        });
      }
    }
    at = code.indexOf(marker, at + marker.length);
  }
  return out;
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

/** require 字符串 → 仓库相对路径（去 .js；非相对 spec 返回空串）。 */
function resolveRequire(rel, spec) {
  if (typeof spec !== 'string' || spec.charAt(0) !== '.') return '';
  let target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
  if (target.slice(-3) === '.js') target = target.slice(0, -3);
  if (target === '..' || target.indexOf('../') === 0) return '';
  return target;
}

/** 文件内 require 绑定 → 被导入符号名（跨目录可达性）：[{ target, symbols:[...] }]。 */
function requireRefsOf(scan, rel) {
  const code = scan.stripped[rel];
  if (!code) return [];
  const blank = blankQuoted(code);
  const out = [];
  const re = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  let hit = re.exec(code);
  while (hit !== null) {
    const target = resolveRequire(rel, hit[2]);
    if (target) {
      const symbols = [];
      const prefix = code.slice(Math.max(0, hit.index - 240), hit.index);
      const destructured = prefix.match(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*$/);
      const alias = prefix.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
      if (destructured) {
        destructured[1].split(',').forEach((part) => {
          const item = part.trim();
          if (!item) return;
          const pair = item.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
          const exported = pair ? pair[1] : (/^[A-Za-z_$][\w$]*$/.test(item) ? item : '');
          const binding = pair ? pair[2] : exported;
          if (!exported || !binding) return;
          if (new RegExp('(^|[^.\\w$])' + escRe(binding) + '\\s*\\(').test(blank)) symbols.push(exported);
        });
      } else if (alias) {
        const propRe = new RegExp('\\b' + escRe(alias[1]) + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
        let prop = propRe.exec(blank);
        while (prop !== null) { symbols.push(prop[1]); prop = propRe.exec(blank); }
      } else {
        const inline = code.slice(hit.index + hit[0].length).match(/^\s*\.\s*([A-Za-z_$][\w$]*)/);
        if (inline) symbols.push(inline[1]);
      }
      if (symbols.length) out.push({ target: target, symbols: symbols });
    }
    hit = re.exec(code);
  }
  return out;
}

/** JSON 文本（scan.text）→ usingComponents 映射；坏 JSON 返回空表。 */
function usingComponentsOf(scan, jsonRel) {
  const text = scan.text[jsonRel];
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    return (json && json.usingComponents) || {};
  } catch (e) {
    return {};
  }
}

/** 选择器 → WXML 标签名：'#id' 反查全仓 WXML 中带该 id 的元素标签；标签选择器直接返回。 */
function tagOfSelector(scan, selector) {
  if (!selector) return '';
  if (selector.charAt(0) !== '#') return /^[A-Za-z][\w-]*$/.test(selector) ? selector : '';
  const id = selector.slice(1);
  const idRe = new RegExp('id\\s*=\\s*(["\'])' + escRe(id) + '\\1');
  const wxmls = scan.rels.filter((rel) => rel.endsWith('.wxml'));
  for (let i = 0; i < wxmls.length; i += 1) {
    const text = scan.text[wxmls[i]] || '';
    const hit = idRe.exec(text);
    if (!hit) continue;
    const open = text.slice(0, hit.index).lastIndexOf('<');
    if (open === -1) continue;
    const tag = text.slice(open + 1).match(/^([A-Za-z][\w-]*)/);
    if (tag) return tag[1];
  }
  return '';
}

/** 标签 → 组件目录（页面/全局 usingComponents 解析；解析不到按 components/<tag> 约定回落）。 */
function componentDirOfTag(scan, rel, tag) {
  if (!tag) return '';
  const chains = [];
  let dir = path.posix.dirname(rel);
  while (dir && dir !== '.' && dir !== '/') {
    if (scan.rels.indexOf(dir + '/index.json') !== -1) {
      chains.push({ base: dir, json: dir + '/index.json' });
      break;
    }
    dir = path.posix.dirname(dir);
  }
  chains.push({ base: '', json: 'app.json' });
  for (let i = 0; i < chains.length; i += 1) {
    const value = usingComponentsOf(scan, chains[i].json)[tag];
    if (typeof value !== 'string') continue;
    let target = value.charAt(0) === '/' ? value.slice(1) : path.posix.normalize(path.posix.join(chains[i].base, value));
    if (target.slice(-6) === '/index') target = target.slice(0, -6);
    if (target && scan.rels.indexOf(target + '/index.js') !== -1) return target;
  }
  if (scan.rels.indexOf('components/' + tag + '/index.js') !== -1) return 'components/' + tag;
  return '';
}

/** 外部文件通过 selectComponent 选到组件后实际调用的方法名：[{ dir, symbol }]（选择器可解析才计）。 */
function selectComponentRefsOf(scan, rel) {
  const code = scan.stripped[rel];
  if (!code || code.indexOf('selectComponent') === -1) return [];
  const blank = blankQuoted(code);
  const dirs = new Set();
  const callRe = /selectComponent\s*\(\s*(["\'])([^"\']+)\1\s*\)/g;
  let hit = callRe.exec(code);
  while (hit !== null) {
    const dir = componentDirOfTag(scan, rel, tagOfSelector(scan, hit[2]));
    if (dir) dirs.add(dir);
    hit = callRe.exec(code);
  }
  if (!dirs.size) return [];
  const symbols = [];
  const chainRe = /selectComponent\s*\([^)]*\)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  let chain = chainRe.exec(code);
  while (chain !== null) { symbols.push(chain[1]); chain = chainRe.exec(code); }
  const aliasRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*selectComponent\s*\(/g;
  let alias = aliasRe.exec(code);
  while (alias !== null) {
    const propRe = new RegExp('\\b' + escRe(alias[1]) + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
    let prop = propRe.exec(blank);
    while (prop !== null) { symbols.push(prop[1]); prop = propRe.exec(blank); }
    alias = aliasRe.exec(code);
  }
  const out = [];
  dirs.forEach((dir) => symbols.forEach((symbol) => out.push({ dir: dir, symbol: symbol })));
  return out;
}

/** 跨目录真实可达引用：dir → 被外部生产文件引用到的符号名集合。 */
function crossDirRefs(scan, dirs) {
  const map = new Map();
  const add = (dir, symbol) => {
    let set = map.get(dir);
    if (!set) { set = new Set(); map.set(dir, set); }
    set.add(symbol);
  };
  const dirOf = (target) => dirs.filter((dir) => target === dir || target.indexOf(dir + '/') === 0)
    .sort((a, b) => b.length - a.length)[0] || '';
  scan.rels.filter((rel) => rel.endsWith('.js') && !isTestFile(rel) && !isGeneratedCopy(rel)).forEach((rel) => {
    requireRefsOf(scan, rel).forEach((req) => {
      const dir = dirOf(req.target);
      if (!dir || rel.indexOf(dir + '/') === 0) return;
      req.symbols.forEach((symbol) => add(dir, symbol));
    });
    selectComponentRefsOf(scan, rel).forEach((item) => add(item.dir, item.symbol));
  });
  return map;
}

/** 去 .js 后缀（import 目标归一化）。 */
function stripJsSuffix(target) {
  return target.slice(-3) === '.js' ? target.slice(0, -3) : target;
}

/** 文件内字符串常量（`const NAME = '...'`）：path.join 变量拼接解析用。 */
function stringConstsOf(code) {
  const map = {};
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/g;
  let hit = re.exec(code);
  while (hit !== null) {
    map[hit[1]] = hit[3];
    hit = re.exec(code);
  }
  return map;
}

/** 从 path.join(...) 参数解析仓库相对路径候选：字面量/字符串常量拼接；ROOT 等未知前缀按仓库根、__dirname 按文件目录。 */
function pathJoinTargets(args, rel, consts) {
  const at = args.indexOf('path.join(');
  if (at === -1) return [];
  const open = args.indexOf('(', at);
  let depth = 0;
  let inStr = null;
  let esc = false;
  let end = -1;
  for (let i = open; i >= 0 && i < args.length; i += 1) {
    const c = args[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return [];
  const segs = [];
  let base = 'file';
  splitTop(args.slice(open + 1, end)).forEach((part) => {
    const item = part.trim();
    if (!item) return;
    const lit = item.match(/^(['"])([^'"]*)\1$/);
    if (lit) { segs.push(lit[2]); return; }
    if (!/^[A-Za-z_$][\w$]*$/.test(item)) return;
    if (item === '__dirname') { base = 'dir'; return; }
    if (Object.prototype.hasOwnProperty.call(consts, item)) { segs.push(consts[item]); return; }
    if (segs.length === 0) base = 'root';
  });
  if (!segs.length) return [];
  const joined = segs.join('/').replace(/^\//, '');
  const target = base === 'root' ? joined
    : path.posix.normalize(path.posix.join(path.posix.dirname(rel), joined));
  return [stripJsSuffix(target)];
}

/** require(...) 参数里的路径 → 仓库相对路径候选（覆盖 require('./x') 与 require(path.join(ROOT,'x'))）。 */
function importTargetsOf(scan, rel) {
  const code = scan.stripped[rel];
  if (!code) return new Set();
  const consts = stringConstsOf(code);
  const out = new Set();
  const re = /\brequire\s*\(/g;
  let hit = re.exec(code);
  while (hit !== null) {
    const open = code.indexOf('(', hit.index);
    let depth = 0;
    let inStr = null;
    let esc = false;
    let end = -1;
    for (let i = open; i < code.length; i += 1) {
      const c = code[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    hit = re.exec(code);
    if (end === -1) continue;
    const args = code.slice(open + 1, end);
    const literal = args.trim().match(/^(['"])([^'"]+)\1$/);
    if (literal) {
      const spec = literal[2];
      let target = '';
      if (spec.charAt(0) === '.') target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      else if (spec.indexOf('/') !== -1) target = spec.replace(/^\//, '');
      if (target) out.add(stripJsSuffix(target));
      continue;
    }
    pathJoinTargets(args, rel, consts).forEach((target) => out.add(target));
  }
  return out;
}

/** 测试引用范围：只认 require 了该目录内文件的测试（其语法级同名引用才算存活；无关测试的同名 token 不算）。 */
function testFilesByDir(scan, dirs) {
  const map = new Map();
  scan.rels.filter((rel) => rel.endsWith('.js') && isTestFile(rel)).forEach((rel) => {
    const targets = Array.from(importTargetsOf(scan, rel));
    dirs.forEach((dir) => {
      const hit = targets.some((t) => t === dir || t.indexOf(dir + '/') === 0);
      if (!hit) return;
      let list = map.get(dir);
      if (!list) { list = []; map.set(dir, list); }
      list.push(rel);
    });
  });
  return map;
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
