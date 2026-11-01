'use strict';
/**
 * tools/lib/check-helpers.js — tools/check.js 的仓库视图与判据辅助函数（批 T5-C 拆件，逐字搬移）。
 * 口径：RELS = 全仓文件清单（相对路径、排序后）；页面范围/代码扩展名常量同拆分前。
 * 各判据模块（check-rules-*.js）与本文件共享同一份仓库快照，不重复遍历磁盘。
 */
const path = require('path');
const F = require('./fsutil');
const P = require('./project');

const ROOT = F.ROOT;
const ALL = F.walk(ROOT, { exts: new Set() });
const RELS = ALL.map((f) => F.rel(f)).sort();
const REL_SET = new Set(RELS);
const PAGE_SCOPES = ['pages/', 'pkg-customer/', 'pkg-partner/', 'pkg-admin/'];
const CODE_EXT = /\.(js|json|wxml|wxss)$/;

function text(rel) {
  try {
    return F.readText(path.join(ROOT, rel));
  } catch (e) {
    return null;
  }
}
function raw(rel) {
  try {
    return F.readRaw(path.join(ROOT, rel));
  } catch (e) {
    return null;
  }
}
function exists(rel) {
  return REL_SET.has(rel) || F.exists(path.join(ROOT, rel));
}
function rels(prefix, re) {
  return RELS.filter((r) => r.startsWith(prefix) && (!re || re.test(r)));
}
function js() {
  return RELS.filter((r) => r.endsWith('.js'));
}
function pagesJs() {
  return RELS.filter((r) => PAGE_SCOPES.some((p) => r.startsWith(p)) && r.endsWith('.js'));
}
function clientFiles() {
  return RELS.filter((r) => P.CLIENT_DIRS.some((d) => r.startsWith(d + '/')) && CODE_EXT.test(r));
}
function cloudJs() {
  return RELS.filter((r) => r.startsWith('cloudfunctions/') && r.endsWith('.js'));
}
function grep(files, re, limit) {
  const hits = [];
  const max = limit || 40;
  for (const rel of files) {
    const s = text(rel);
    if (s === null) continue;
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        hits.push(rel + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 140));
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}
function missing(files) {
  return files.filter((r) => !exists(r));
}
function shortList(items, n) {
  const lim = n || 6;
  return items.slice(0, lim).concat(items.length > lim ? ['…（共 ' + items.length + ' 项）'] : []);
}
function requireRegistry(candidates) {
  for (const rel of candidates) {
    const full = path.join(ROOT, rel);
    if (!F.isFile(full)) continue;
    const r = F.tryRequire(full);
    if (!r.ok) return { rel, error: 'require 失败: ' + r.error.message };
    return { rel, value: r.value };
  }
  return null;
}
function stringsOf(value, depth) {
  const out = new Set();
  const d = depth || 0;
  if (value === null || value === undefined || d > 4) return out;
  if (typeof value === 'string') { out.add(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => stringsOf(v, d + 1).forEach((s) => out.add(s))); return out; }
  if (typeof value === 'object') {
    Object.keys(value).forEach((k) => {
      out.add(k);
      stringsOf(value[k], d + 1).forEach((s) => out.add(s));
    });
  }
  return out;
}
/** 只收集对象"值"（不收集键名），用于注册表字符串集合比对（避免导出名污染）。 */
function valuesOf(value, depth) {
  const out = new Set();
  const d = depth || 0;
  if (value === null || value === undefined || d > 4) return out;
  if (typeof value === 'string') { out.add(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => valuesOf(v, d + 1).forEach((s) => out.add(s))); return out; }
  if (typeof value === 'object') {
    Object.keys(value).forEach((k) => { valuesOf(value[k], d + 1).forEach((s) => out.add(s)); });
  }
  return out;
}
function findActionMap(value) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (!Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length >= 5 && keys.every((k) => /^[a-z][a-zA-Z]+\.[a-zA-Z]+$/.test(k))) return v;
    }
    Object.keys(v).forEach((k) => stack.push(v[k]));
  }
  return null;
}
function visibilityOf(entry) {
  if (typeof entry === 'string') return entry.toLowerCase();
  if (entry && typeof entry === 'object') {
    const v = entry.visibility || entry.mode || entry.scope || entry.access || entry.audience;
    if (typeof v === 'string') return v.toLowerCase();
  }
  return '';
}
function hasWriteFlag(entry) {
  return !!(entry && typeof entry === 'object' && typeof (entry.write === undefined ? entry.isWrite : entry.write) === 'boolean');
}

module.exports = {
  ROOT, RELS, PAGE_SCOPES, CODE_EXT,
  text, raw, exists, rels, js, pagesJs, clientFiles, cloudJs, grep, missing, shortList,
  requireRegistry, stringsOf, valuesOf, findActionMap, visibilityOf, hasWriteFlag
};
