'use strict';
/**
 * tools/check-functions.js — 「单函数 ≤50 行」判据（AGENTS §4.2 纪律 / ENGINEERING §8.2 #32）。
 *
 * 用法：
 *   node tools/check-functions.js                  # 只读判定：新增长函数/超基线 → exit 1
 *   node tools/check-functions.js --baseline       # 打印当前违规基线 JSON（评审后覆盖基线文件）
 * 口径（全文本）：
 *   - 函数跨度 = 起始行（function 关键字 / 参数左括号 / 方法名行）到配对右花括号行，含空行与注释；
 *     注释、字符串、模板、正则先做等长掩码（保留换行），避免其中的括号/花括号干扰配平。
 *   - 扫描范围：生产源码 pages/ pkg-customer/ pkg-partner/ pkg-admin/ api/ store/ utils/ shared/
 *     config/ components/ cloudfunctions/ 与根 app.js；排除 cloudfunctions/*\/shared 同步副本（由
 *     sync-cloud-shared.js 生成）与 tools/（工具链/测试另档 ≤1000 行）。
 *   - 判据：当前 >50 行函数必须 ⊆ 基线（file+函数名+行数）。新增长函数 → 红；行数超基线 → 红；
 *     基线里已消失的函数不判红（允许重构删除，基线只增不减的"白名单"不成立）。
 *   - 空集保护：扫描文件数 / 违规样本为空不得判绿。
 * 取数：node tools/check-functions.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = 50;
const BASELINE_FILE = 'tools/function-length-baseline.json';
const SCAN_DIRS = ['pages', 'pkg-customer', 'pkg-partner', 'pkg-admin', 'api', 'store', 'utils',
  'shared', 'config', 'components', 'cloudfunctions'];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else',
  'try', 'typeof', 'await', 'new', 'delete', 'void', 'in', 'of', 'with', 'case']);

/** 同步副本由 sync-cloud-shared.js 生成，不参与本判据（上游 shared/ 已覆盖）。 */
function shouldSkip(rel) {
  if (/^cloudfunctions\/[^/]+\/shared\//.test(rel)) return true;
  if (/(^|\/)node_modules\//.test(rel)) return true;
  if (/\.min\.js$/.test(rel)) return true;
  return false;
}

function walk(full, rel, out) {
  let ents;
  try { ents = fs.readdirSync(full, { withFileTypes: true }); } catch (e) { return; }
  ents.forEach((ent) => {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') return;
      walk(path.join(full, ent.name), rel + '/' + ent.name, out);
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      out.push(rel + '/' + ent.name);
    }
  });
}

/** 扫描文件清单（相对路径，已排序）。 */
function jsFiles() {
  const out = [];
  SCAN_DIRS.forEach((dir) => {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full, dir, out);
  });
  if (fs.existsSync(path.join(ROOT, 'app.js'))) out.push('app.js');
  return out.filter((rel) => !shouldSkip(rel)).sort();
}

/** 等长掩码：注释/字符串/模板/正则替换为空格（换行保留），供配平扫描。 */
function maskCode(text) {
  const chars = text.split('');
  const n = text.length;
  const mask = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (chars[k] !== '\n') chars[k] = ' ';
  };
  const regexAllowed = (ch) => ch === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(ch) !== -1;
  let i = 0;
  let prev = '';
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      let j = i + 2;
      while (j < n && text[j] !== '\n') j += 1;
      mask(i, j);
      i = j;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      mask(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === c || text[j] === '\n') { j += 1; break; }
        j += 1;
      }
      mask(i + 1, j - 1);
      i = j;
      prev = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '`') { j += 1; break; }
        j += 1;
      }
      mask(i + 1, j - 1);
      i = j;
      prev = '`';
      continue;
    }
    if (c === '/' && regexAllowed(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') break;
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { j += 1; closed = true; break; }
        j += 1;
      }
      if (closed) {
        mask(i + 1, j - 1);
        i = j;
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return chars.join('');
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(position, starts) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function matchBrace(masked, openPos) {
  let depth = 0;
  for (let i = openPos; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchParenForward(masked, openPos) {
  let depth = 0;
  for (let i = openPos; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchParenBackward(masked, closePos) {
  let depth = 0;
  for (let i = closePos; i >= 0; i -= 1) {
    if (masked[i] === ')') depth += 1;
    else if (masked[i] === '(') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 从函数起点向前找赋值/属性名（`const name =` / `name:` / `obj.name =`）。 */
function backwardName(masked, startPos) {
  const before = masked.slice(Math.max(0, startPos - 300), startPos);
  const assign = /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?$/.exec(before);
  if (assign) return assign[1];
  const prop = /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?$/.exec(before);
  if (prop) return prop[1];
  return '';
}

/** 掩码文本中的函数跨度检测：function 声明/表达式、块体箭头、对象/类方法简写。 */
function detectFunctions(masked, text) {
  const starts = lineStarts(text);
  const found = [];
  const push = (name, startPos, bodyEnd, kind) => {
    if (startPos < 0 || bodyEnd < 0) return;
    const startLine = lineOf(startPos, starts);
    const endLine = lineOf(bodyEnd, starts);
    found.push({ name: name || '<anonymous>', kind, startLine, endLine, lines: endLine - startLine + 1 });
  };
  // A. function 声明/表达式
  const reFn = /\bfunction\b/g;
  let m;
  while ((m = reFn.exec(masked)) !== null) {
    let p = m.index + 'function'.length;
    while (masked[p] === '*' || masked[p] === ' ') p += 1;
    const nameM = /^([A-Za-z_$][\w$]*)?\s*/.exec(masked.slice(p, p + 200));
    const name = nameM && nameM[1] ? nameM[1] : '';
    p += nameM ? nameM[0].length : 0;
    if (masked[p] !== '(') {
      const q = masked.indexOf('(', p);
      if (q === -1 || q - p > 200) continue;
      p = q;
    }
    const close = matchParenForward(masked, p);
    if (close === -1) continue;
    let b = close + 1;
    while (b < masked.length && /\s/.test(masked[b])) b += 1;
    if (masked[b] !== '{') continue;
    push(name || backwardName(masked, m.index), m.index, matchBrace(masked, b), 'function');
  }
  // B. 块体箭头函数
  const reArrow = /=>/g;
  while ((m = reArrow.exec(masked)) !== null) {
    let q = m.index + 2;
    while (q < masked.length && /\s/.test(masked[q])) q += 1;
    if (masked[q] !== '{') continue;
    let back = m.index - 1;
    while (back >= 0 && /\s/.test(masked[back])) back -= 1;
    let startPos;
    if (masked[back] === ')') {
      startPos = matchParenBackward(masked, back);
      if (startPos === -1) continue;
    } else {
      let k = back;
      while (k >= 0 && /[\w$]/.test(masked[k])) k -= 1;
      startPos = k + 1;
      if (startPos > back) continue;
    }
    const name = masked[back] === ')' ? backwardName(masked, startPos) : masked.slice(startPos, back + 1);
    push(name, startPos, matchBrace(masked, q), 'arrow');
  }
  // C. 对象/类方法简写：行首缩进 + [修饰符] name(...) {
  const reMethod = /^([ \t]*)(?:(?:static|get|set|async|\*)\s+)*([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((m = reMethod.exec(masked)) !== null) {
    const name = m[2];
    if (KEYWORDS.has(name)) continue;
    const namePos = m.index + m[0].length - 1 - m[2].length;
    let prev = -1;
    for (let i = namePos - 1; i >= 0; i -= 1) {
      if (!/\s/.test(masked[i])) { prev = i; break; }
    }
    const prevCh = prev >= 0 ? masked[prev] : '';
    if (!(prev === -1 || '{,;})'.indexOf(prevCh) !== -1 || prevCh === '=' || prevCh === '>')) continue;
    const openParen = m.index + m[0].length - 1;
    const close = matchParenForward(masked, openParen);
    if (close === -1) continue;
    let b = close + 1;
    while (b < masked.length && /\s/.test(masked[b])) b += 1;
    if (masked[b] !== '{') continue;
    push(name, m.index + m[1].length, matchBrace(masked, b), 'method');
  }
  return found;
}

/** 扫描全部生产源码，返回 { files, functions, violations }。 */
function scan(root) {
  const base = root || ROOT;
  const files = (base === ROOT ? jsFiles() : jsFilesUnder(base));
  const functions = [];
  files.forEach((rel) => {
    let text;
    try { text = fs.readFileSync(path.join(base, rel), 'utf8'); } catch (e) { return; }
    if (text.length > 2 * 1024 * 1024) return;
    detectFunctions(maskCode(text), text).forEach((fn) => functions.push(Object.assign({ file: rel }, fn)));
  });
  const violations = functions.filter((fn) => fn.lines > LIMIT)
    .sort((a, b) => (a.file === b.file ? b.lines - a.lines : a.file < b.file ? -1 : 1));
  return { files: files.length, functions: functions.length, violations };
}

function jsFilesUnder(base) {
  const out = [];
  SCAN_DIRS.forEach((dir) => {
    const full = path.join(base, dir);
    if (fs.existsSync(full)) walk(full, dir, out);
  });
  if (fs.existsSync(path.join(base, 'app.js'))) out.push('app.js');
  return out.filter((rel) => !shouldSkip(rel)).sort();
}

/** 违规函数去重命名（同 file+name 重复时追加 #2/#3，保证基线键稳定可读）。 */
function keyedViolations(violations) {
  const seen = new Map();
  return violations.map((v) => {
    const base = v.file + '\u0000' + v.name;
    const k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    return Object.assign({}, v, { key: k === 1 ? v.name : v.name + '#' + k });
  });
}

function loadBaseline(root) {
  const full = path.join(root || ROOT, BASELINE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    return data && typeof data.functions === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

/** 基线判据：当前违规必须 ⊆ 基线（同 file+key，且行数 ≤ 基线行数）。 */
function baselineProblems(input) {
  const problems = [];
  const baseline = input.baseline;
  if (!baseline) return ['基线文件缺失/不可解析: ' + BASELINE_FILE];
  const keyed = keyedViolations(input.violations);
  keyed.forEach((v) => {
    const list = baseline.functions[v.file];
    const entry = Array.isArray(list) ? list.find((e) => e && e.name === v.key) : null;
    if (!entry) {
      problems.push('[新增长函数] ' + v.file + ' · ' + v.name + '（' + v.lines + ' 行 > ' + LIMIT + '）');
    } else if (v.lines > entry.lines) {
      problems.push('[超基线] ' + v.file + ' · ' + v.name + '（基线 ' + entry.lines + ' → 当前 ' + v.lines + ' 行）');
    }
  });
  if (input.files === 0) problems.push('扫描文件为空（空集不得判绿）');
  if (input.functions === 0) problems.push('函数样本为空（空集不得判绿）');
  return problems;
}

function toBaseline(input) {
  const functions = {};
  keyedViolations(input.violations).forEach((v) => {
    if (!functions[v.file]) functions[v.file] = [];
    functions[v.file].push({ name: v.key, lines: v.lines });
  });
  Object.keys(functions).forEach((f) => functions[f].sort((a, b) => (a.name < b.name ? -1 : 1)));
  return {
    limit: LIMIT,
    note: '存量 >50 行函数基线（AGENTS §4.2 / ENGINEERING §8.2 #32）。判据=当前违规 ⊆ 本基线；'
      + '重构删除后基线可保留（不判红），重新生成：node tools/check-functions.js --baseline > ' + BASELINE_FILE,
    functions,
  };
}

function run() {
  const input = scan(ROOT);
  const problems = baselineProblems({ baseline: loadBaseline(ROOT), violations: input.violations, files: input.files, functions: input.functions });
  const baseline = loadBaseline(ROOT);
  let baselineCount = 0;
  if (baseline) Object.keys(baseline.functions).forEach((f) => { baselineCount += baseline.functions[f].length; });
  return { input, problems, baselineCount };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--baseline')) {
    const input = scan(ROOT);
    console.log(JSON.stringify(toBaseline(input), null, 2));
    return 0;
  }
  const { input, problems, baselineCount } = run();
  problems.forEach((p) => console.log('[FAIL] ' + p));
  console.log('check-functions：扫描 ' + input.files + ' 个文件；函数 ' + input.functions + ' 个；>'
    + LIMIT + ' 行函数 ' + input.violations.length + ' 个（基线 ' + baselineCount + ' 项）；违规 ' + problems.length + ' 项');
  return problems.length === 0 ? 0 : 1;
}

module.exports = { LIMIT, BASELINE_FILE, scan, run, toBaseline, baselineProblems, detectFunctions, maskCode, jsFiles };

if (require.main === module) {
  process.exitCode = main(process.argv);
}
