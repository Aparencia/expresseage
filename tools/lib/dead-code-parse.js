'use strict';
/**
 * tools/lib/dead-code-parse.js — JS/CJS 源码解析原语（配平截取/顶层切分/导出提取/文件内引用；批 T5-C 从 tools/lib/dead-code.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；批 T5-C 从 tools/lib/dead-code.js 逐字搬移（判据/扫描范围零变更）。
 */
const { isGeneratedCopy, isTestFile } = require('./dead-code-core');

const REGEX_PREV = '([{,;=:!&|?+-*%^~<>';
const REGEX_KEYWORDS = /\b(?:return|typeof|instanceof|in|of|case|new|delete|void|throw|else|do|yield|await)$/;

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

module.exports = {
  braceBlockAt,
  blankQuoted,
  escRe,
  splitTop,
  topKeyPositions,
  extractExports,
  buildTokenIndex,
  internalRefsOf,
  exportKeyPositionsOf
};
