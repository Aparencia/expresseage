'use strict';
/**
 * tools/zero-money-scan.js — 零金额扫描器（词表唯一单源）
 * 口径来源：docs/V4_ENGINEERING.md §7.6（词表/白名单/判据输出）、§8.2 #22、CONTRACT §12。
 *
 * 三范围（§7.6）：
 *   1) source = 全仓库 *.js|*.json|*.wxml|*.wxss（含 cloudfunctions/）
 *   2) pages  = pages/** 与 pkg-* 下的 .js/.wxml/.wxss（页面文案，单独读数）
 *   3) docs   = 根 *.md + docs/**\/*.md（含 CONTRACT/DATA_MODEL/三份 UX/ENGINEERING/QA/隐私）
 *
 * 白名单（tools/zero-money-allowlist.json）：每项 {file,string,reason}，按"文件 + 整行原文"精确匹配；
 * 只登记三类：①口径声明 ②门禁定义块 ③固定术语「零金额」的上下文声明。禁止整文件/目录通配。
 * 「零金额」为固定术语，在文本中整体放行（任何位置出现均不计命中）。
 *
 * 扫描器自身的豁免（否则词表/白名单数据会自命中）：
 *   - tools/zero-money-scan.js（词表定义块，本文件）
 *   - tools/zero-money-allowlist.json（白名单数据）
 * 该豁免只覆盖这两个文件，其余 tools/** 照常扫描。
 *
 * 用法：
 *   node tools/zero-money-scan.js                 # 三范围全扫，命中 -> exit 1
 *   node tools/zero-money-scan.js --scope docs    # 只扫文档
 *   node tools/zero-money-scan.js --json          # 机器可读结果
 *   node tools/zero-money-scan.js --suggest       # 输出当前命中对应的白名单候选（人工评审后回写）
 *   node tools/zero-money-scan.js --explain       # 打印范围/词表/白名单统计
 * 输出纪律：零命中打印「零金额扫描：0 命中（白名单 N 项）」；命中打印 file:line 并 exit 1。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_FILE = 'tools/zero-money-allowlist.json';
const SELF_FILES = new Set(['tools/zero-money-scan.js', ALLOWLIST_FILE]);

// ---- 词表（唯一单源；文档不重复字面量）----
const ZH_TERMS = ['金额', '价格', '运费', '收款', '结算'];
// 英文按 token/标识符边界匹配，不因子串误报（payload 不是命中）
const EN_RE = /(?:^|[^A-Za-z0-9_$])(prices?|fees?|pays?|paid|payments?|payStatus|amounts?)(?![A-Za-z0-9_$])/gi;
// 标识符后缀 *Fen（如 totalFen），大小写敏感按生产约定
const FEN_RE = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*Fen)(?![A-Za-z0-9_$])/g;
const ZERO_TERM = '零金额';

const SOURCE_EXT = new Set(['.js', '.json', '.wxml', '.wxss']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'miniprogram_npm', '.dsh-code-index', 'docs']);
const SKIP_DOC_DIRS = new Set(['.git', 'node_modules', '.dsh-code-index']);

function posix(p) {
  return p.replace(/\\/g, '/');
}

function relOf(root, full) {
  return posix(path.relative(root, full));
}

function maxReadBytes() {
  return 8 * 1024 * 1024;
}

function readText(full) {
  const st = fs.statSync(full);
  if (st.size > maxReadBytes()) return null;
  let buf = fs.readFileSync(full);
  // 编译产物不得带 BOM（由 check #8 管）；扫描时剥掉 BOM 再读
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  return buf.toString('utf8');
}

function walk(root, opts, out) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || SKIP_DOC_DIRS.has(ent.name)) continue;
      walk(path.join(root, ent.name), opts, out);
    } else if (ent.isFile()) {
      const full = path.join(root, ent.name);
      if (opts.filter(full, ent.name)) out.push(full);
    }
  }
  return out;
}

/** 纯函数：扫描一段文本（供 check/selftest 复用；不读盘、无白名单）。 */
function scanText(text) {
  const hits = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // 固定术语「零金额」整体放行：掩码后再扫，避免 金额 子串误报
    const masked = raw.replace(new RegExp(ZERO_TERM, 'g'), 'ZERO_TERM');
    const seen = new Set();
    const push = (token, idx) => {
      const key = idx + ':' + token;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push({ token, line: i + 1, column: idx + 1, text: raw.trim() });
    };
    for (const term of ZH_TERMS) {
      let from = 0;
      for (;;) {
        const idx = masked.indexOf(term, from);
        if (idx === -1) break;
        push(term, idx);
        from = idx + term.length;
      }
    }
    EN_RE.lastIndex = 0;
    let m;
    while ((m = EN_RE.exec(masked)) !== null) {
      // m[1] 是词本身；m.index 指向词前一位（若存在），定位到词首
      const token = m[1];
      const idx = masked.indexOf(token, m.index);
      push(token, idx);
      EN_RE.lastIndex = m.index + m[0].length;
    }
    FEN_RE.lastIndex = 0;
    while ((m = FEN_RE.exec(masked)) !== null) {
      const token = m[1];
      const idx = masked.indexOf(token, m.index);
      push(token, idx);
      FEN_RE.lastIndex = m.index + m[0].length;
    }
  }
  return hits;
}

function loadAllowlist(root) {
  const full = path.join(root || ROOT, ALLOWLIST_FILE);
  const issues = [];
  let entries = [];
  if (!fs.existsSync(full)) {
    return { entries: [], index: new Map(), issues: ['白名单文件缺失: ' + ALLOWLIST_FILE], count: 0 };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    return { entries: [], index: new Map(), issues: ['白名单 JSON 不可解析: ' + e.message], count: 0 };
  }
  if (!Array.isArray(data)) {
    return { entries: [], index: new Map(), issues: ['白名单必须是数组'], count: 0 };
  }
  const index = new Map();
  data.forEach((raw, i) => {
    const where = 'allowlist[' + i + ']';
    if (!raw || typeof raw !== 'object') { issues.push(where + ' 不是对象'); return; }
    const file = typeof raw.file === 'string' ? posix(raw.file).trim() : '';
    const str = typeof raw.string === 'string' ? raw.string : '';
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!file) { issues.push(where + ' 缺 file'); return; }
    if (/[*?[\]{}]/.test(file) || file.startsWith('/') || file.split('/').includes('..')) {
      issues.push(where + ' file 不允许通配/绝对路径/上跳: ' + file); return;
    }
    if (!str.trim()) { issues.push(where + ' 缺 string（整行原文）'); return; }
    if (!reason) { issues.push(where + ' 缺 reason'); return; }
    if (!index.has(file)) index.set(file, new Set());
    index.get(file).add(str);
    entries.push({ file, string: str, reason });
  });
  return { entries, index, issues, count: entries.length };
}

function withAllowlist(root) {
  const al = loadAllowlist(root);
  return function check(hit) {
    const set = al.index.get(hit.file);
    return !!(set && set.has(hit.text));
  };
}

function collectFiles(root, scope) {
  root = root || ROOT;
  const files = [];
  const add = (full) => {
    const rel = relOf(root, full);
    if (SELF_FILES.has(rel)) return;
    files.push(full);
  };
  if (scope === 'docs' || scope === 'all') {
    root && fs.readdirSync(root, { withFileTypes: true }).forEach((ent) => {
      if (ent.isFile() && /\.md$/i.test(ent.name)) add(path.join(root, ent.name));
    });
    const docDir = path.join(root, 'docs');
    if (fs.existsSync(docDir)) {
      const tmp = [];
      walk(docDir, { filter: (full, name) => /\.md$/i.test(name) }, tmp);
      tmp.forEach(add);
    }
  }
  if (scope === 'pages' || scope === 'source' || scope === 'all') {
    const pageFilter = (full, name) => /\.(js|wxml|wxss)$/i.test(name);
    for (const p of ['pages']) {
      const d = path.join(root, p);
      if (fs.existsSync(d)) {
        const tmp = [];
        walk(d, { filter: pageFilter }, tmp);
        tmp.forEach(add);
      }
    }
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isDirectory() && /^pkg-/.test(ent.name)) {
        const tmp = [];
        walk(path.join(root, ent.name), { filter: pageFilter }, tmp);
        tmp.forEach(add);
      }
    }
    if (scope === 'source' || scope === 'all') {
      const tmp = [];
      walk(root, { filter: (full, name) => SOURCE_EXT.has(path.extname(name).toLowerCase()) }, tmp);
      tmp.forEach(add);
    }
  }
  // 去重 + 排序
  const uniq = Array.from(new Set(files.map((f) => path.resolve(f))));
  uniq.sort();
  return uniq;
}

function scanFiles(files, root, allow) {
  const hits = [];
  for (const full of files) {
    let text;
    try {
      text = readText(full);
    } catch (e) {
      continue;
    }
    if (text === null) continue;
    const rel = relOf(root, full);
    for (const h of scanText(text)) {
      const hit = { file: rel, line: h.line, column: h.column, token: h.token, text: h.text };
      if (allow && allow(hit)) { hit.allowed = true; continue; }
      hits.push(hit);
    }
  }
  return hits;
}

function run(opts) {
  const root = opts.root || ROOT;
  const scope = opts.scope || 'all';
  const allow = withAllowlist(root);
  const al = loadAllowlist(root);
  const files = collectFiles(root, scope);
  const allHits = scanFiles(files, root, allow);
  const hits = allHits.filter((h) => !h.allowed);
  return { root, scope, files: files.length, allowlistCount: al.count, allowlistIssues: al.issues, hits };
}

function printHuman(result) {
  const group = { docs: '文档', pages: '页面文案', source: '源码' };
  for (const h of result.hits) {
    console.log(h.file + ':' + h.line + ': ' + h.token + '  | ' + h.text.slice(0, 160));
  }
  if (result.allowlistIssues.length) {
    console.log('白名单校验问题 ' + result.allowlistIssues.length + ' 条：');
    result.allowlistIssues.slice(0, 20).forEach((s) => console.log('  - ' + s));
  }
  if (result.hits.length === 0) {
    console.log('零金额扫描：0 命中（白名单 ' + result.allowlistCount + ' 项）');
  } else {
    console.log('零金额扫描：' + result.hits.length + ' 命中（白名单 ' + result.allowlistCount + ' 项）');
  }
}

function main(argv) {
  const args = argv.slice(2);
  const has = (name) => args.includes(name);
  const val = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
  };
  const opts = { scope: val('--scope', 'all'), root: ROOT };
  if (has('--explain')) {
    const al = loadAllowlist(ROOT);
    console.log('零金额扫描器（词表唯一单源：tools/zero-money-scan.js）');
    console.log('中文词：' + ZH_TERMS.join('、') + '（固定术语「' + ZERO_TERM + '」整体放行）');
    console.log('英文词：price(s)/fee(s)/pay/pays/paid/payment(s)/payStatus/amount(s)；后缀：*Fen');
    console.log('白名单：' + ALLOWLIST_FILE + '，' + al.count + ' 项（{file,string,reason} 精确整行匹配）');
    al.entries.forEach((e) => console.log('  - ' + e.file + ' | ' + e.reason));
    return 0;
  }
  if (!['all', 'source', 'docs', 'pages'].includes(opts.scope)) {
    console.error('未知 --scope: ' + opts.scope + '（all|source|docs|pages）');
    return 2;
  }
  const result = run(opts);
  if (has('--suggest')) {
    const seen = new Set();
    const out = [];
    for (const h of result.hits) {
      const key = h.file + '\u0000' + h.text;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ file: h.file, string: h.text, reason: '待评审：' + h.token });
    }
    console.log(JSON.stringify(out, null, 2));
    return 1;
  }
  if (has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  return result.hits.length === 0 ? 0 : 1;
}

module.exports = {
  ROOT,
  ALLOWLIST_FILE,
  ZH_TERMS,
  ZERO_TERM,
  scanText,
  loadAllowlist,
  collectFiles,
  scanFiles,
  run,
  printHuman,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv);
}
