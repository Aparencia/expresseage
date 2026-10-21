'use strict';
/**
 * tools/lib/fsutil.js — 工具链共享文件/文本助手（无第三方依赖，纯 Node）。
 * 纪律：js 无 BOM、纯 LF、单文件 ≤500 行；本文件只做无副作用的读取/解析/统计。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', '.dsh-code-index']);

function posix(p) {
  return String(p).replace(/\\/g, '/');
}

function rel(full, root) {
  return posix(path.relative(root || ROOT, full));
}

function walk(dir, opts, out) {
  const skip = new Set((opts && opts.skip) || DEFAULT_SKIP);
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (skip.has(ent.name)) continue;
      walk(path.join(dir, ent.name), opts, out);
    } else if (ent.isFile()) {
      const name = ent.name;
      const exts = (opts && opts.exts) || new Set();
      if (exts.size === 0 || exts.has(path.extname(name).toLowerCase())) out.push(path.join(dir, name));
    }
  }
  return out;
}

function readText(full) {
  let buf = fs.readFileSync(full);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  return buf.toString('utf8');
}

function readRaw(full) {
  return fs.readFileSync(full);
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

function readJson(full) {
  return JSON.parse(readText(full));
}

function tryRequire(full) {
  try {
    return { ok: true, value: require(full) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** 编译期语法检查：只编译不执行。返回 {ok, error}。 */
function syntaxCheck(code, filename) {
  const vm = require('vm');
  try {
    new vm.Script(code, { filename: filename || 'inline.js' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 粗略剥掉 // 与 /* *\/ 注释与模板外字符串内容，保留换行；用于"剥注释后比对"。 */
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let mode = 0; // 0 普通 1 行注释 2 块注释 3 ' 4 " 5 `
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (mode === 0) {
      if (c === '/' && d === '/') { mode = 1; i += 2; out += '  '; continue; }
      if (c === '/' && d === '*') { mode = 2; i += 2; out += '  '; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = c === '"' ? 4 : c === "'" ? 3 : 5; out += c; i += 1; continue; }
      out += c;
      i += 1;
      continue;
    }
    if (mode === 1) {
      if (c === '\n') { mode = 0; out += '\n'; } else out += ' ';
      i += 1;
      continue;
    }
    if (mode === 2) {
      if (c === '*' && d === '/') { mode = 0; i += 2; out += '  '; continue; }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // 字符串：保留原文（判断与字面量相关），处理转义
    const quote = mode === 3 ? "'" : mode === 4 ? '"' : '`';
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if (c === quote) { mode = 0; out += c; i += 1; continue; }
    out += c;
    i += 1;
  }
  return out;
}

function lineCount(text) {
  if (text === '') return 0;
  const lines = String(text).split('\n');
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function grepCount(text, re) {
  const m = String(text).match(re);
  return m ? m.length : 0;
}

function countLines(full) {
  return lineCount(readText(full));
}

/** 把相对路径集合解析成绝对路径；缺失不抛错。 */
function abs(root, rels) {
  return rels.map((r) => path.join(root || ROOT, r));
}

function under(dirRel, root) {
  const dir = path.join(root || ROOT, dirRel);
  if (!exists(dir)) return [];
  return walk(dir, { exts: new Set(['.js', '.json', '.wxml', '.wxss']) });
}

/** 按行截取文档某标题到下一同级标题之间的正文（标题行含）。 */
function section(text, headingRe) {
  const lines = String(text).split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  const level = (lines[start].match(/^#+/) || ['##'])[0].length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return lines.slice(start).join('\n');
}

module.exports = {
  ROOT,
  posix,
  rel,
  walk,
  readText,
  readRaw,
  exists,
  isFile,
  readJson,
  tryRequire,
  syntaxCheck,
  stripComments,
  lineCount,
  sha256,
  grepCount,
  countLines,
  abs,
  under,
  section,
};
