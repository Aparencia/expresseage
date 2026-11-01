'use strict';
/**
 * tools/lib/dead-code-refs.js — 跨文件引用解析（require/selectComponent/测试可达性；批 T5-C 从 tools/lib/dead-code.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；批 T5-C 从 tools/lib/dead-code.js 逐字搬移（判据/扫描范围零变更）。
 */
const path = require('path');
const { isGeneratedCopy, isTestFile } = require('./dead-code-core');
const { blankQuoted, escRe, splitTop } = require('./dead-code-parse');

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

module.exports = {
  crossDirRefs,
  importTargetsOf,
  testFilesByDir
};
