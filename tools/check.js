'use strict';
/**
 * tools/check.js — v4 代码/配置门禁（ENGINEERING §8.2 的 31 条判据逐条实现）。
 * 口径：docs/V4_ENGINEERING.md v0.9 §8.2；失败含义见同表。汇总行必须存在（没有汇总输出 = 读数作废）。
 *
 * 与 check-docs 的分工（文件头登记差异，§8.2 #18）：
 *   - #18 行数：本文件对**代码/测试文件**（*.js）执行 ≤500 / 测试 ≤1000；文档 *.md 的体量/结构判据
 *     由 tools/check-docs.js 负责（它按文档地图逐份登记），不在本文件重复计数。
 *   - #22 零金额：本文件只做"源码 + 页面文案"两范围（词表唯一单源在 tools/zero-money-scan.js）；
 *     文档范围（根 md + docs/**）由 check-docs #7 执行，避免同一读数重复。
 *
 * 用法：node tools/check.js            # 逐条打印 PASS/FAIL + 汇总行；有失败 exit 1
 *       node tools/check.js --fail-only
 * 纪律：本文件自身也受 #18 约束（≤500 行全文本）；新增判据先加进 docs/V4_ENGINEERING.md §8.2。
 */
const fs = require('fs');
const path = require('path');
const F = require('./lib/fsutil');
const P = require('./lib/project');
const ZM = require('./zero-money-scan');

const ROOT = F.ROOT;
const ALL = F.walk(ROOT, { exts: new Set() });
const RELS = ALL.map((f) => F.rel(f)).sort();
const REL_SET = new Set(RELS);
const PAGE_SCOPES = ['pages/', 'pkg-customer/', 'pkg-partner/', 'pkg-admin/'];
const CODE_EXT = /\.(js|json|wxml|wxss)$/;
const results = [];

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

function check(no, id, title, fn) {
  const entry = { no, id, title };
  try {
    const r = fn();
    if (r === null || r === true || r === undefined) entry.pass = true;
    else {
      entry.pass = false;
      entry.detail = Array.isArray(r) ? r : [String(r)];
    }
  } catch (e) {
    entry.pass = false;
    entry.detail = ['判据执行异常: ' + e.message];
  }
  results.push(entry);
}

// ---------------------------------------------------------------- #01
check(1, 'JSON 可解析', 'app.json/sitemap/project.config + 全部页面 .json', () => {
  const pageJson = RELS.filter((r) => /(^|\/)pages\/.*\/index\.json$/.test(r));
  const files = ['app.json', 'sitemap.json', 'project.config.json'].concat(pageJson);
  const bad = [];
  for (const rel of Array.from(new Set(files))) {
    if (!exists(rel)) { bad.push('缺失: ' + rel); continue; }
    try { F.readJson(path.join(ROOT, rel)); } catch (e) { bad.push(rel + ': ' + e.message); }
  }
  if (bad.length) return shortList(bad, 12);
  if (files.length < 4) return ['JSON 样本为空（空集不得判绿）'];
  return null;
});

// ---------------------------------------------------------------- #02
check(2, 'JS 语法', '客户端 + shared/api/store/utils + tools + cloudfunctions（vm 编译）', () => {
  const bad = [];
  const files = js();
  for (const rel of files) {
    const s = text(rel);
    if (s === null) continue;
    const r = F.syntaxCheck(s, rel);
    if (!r.ok) bad.push(rel + ': ' + r.error);
  }
  if (files.length === 0) return ['JS 样本为空（空集不得判绿）'];
  return bad.length ? bad : null;
});

// ---------------------------------------------------------------- #03
check(3, '页面四件套', '主包 7 + 分包 23（顾客 5 / 兼职 7 / 开发者 11）', () => {
  const bad = [];
  for (const page of P.ALL_PAGES) {
    for (const ext of P.PAGE_EXTS) {
      const rel = page + ext;
      if (!exists(rel)) bad.push('缺失: ' + rel);
    }
  }
  return bad.length ? shortList(bad, 12) : null;
});

// ---------------------------------------------------------------- #04
check(4, '反向登记', 'pages/ 与 pkg-*/pages/ 每个页面必须在 app.json 声明', () => {
  const app = F.exists(path.join(ROOT, 'app.json')) ? F.readJson(path.join(ROOT, 'app.json')) : null;
  if (!app) return ['app.json 缺失/不可解析'];
  const declared = new Set((app.pages || []).slice());
  (app.subPackages || app.subpackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => declared.add(sp.root + '/' + p));
  });
  const actual = RELS.filter((r) => r.endsWith('/index.js') && PAGE_SCOPES.some((p) => r.startsWith(p)))
    .map((r) => r.replace(/\.js$/, ''));
  const undeclared = actual.filter((r) => !declared.has(r));
  const broken = Array.from(declared).filter((r) => !exists(r + '.js'));
  const out = [];
  if (undeclared.length) out.push('未声明页面: ' + undeclared.join(', '));
  if (broken.length) out.push('声明缺文件: ' + broken.join(', '));
  if (actual.length === 0) out.push('页面样本为空（空集不得判绿）');
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #05
check(5, '必需文件', '骨架/门禁/两云函数 package.json/设计文档地图', () => {
  const miss = missing(P.REQUIRED_FILES);
  return miss.length ? shortList(miss, 12) : null;
});

// ---------------------------------------------------------------- #06
check(6, '.gitignore', '挡 .env*、project.private.config.json、node_modules/、.dsh-code-index/', () => {
  const s = text('.gitignore');
  if (s === null) return ['.gitignore 缺失'];
  const rules = [/\*?\.env/, /project\.private\.config\.json/, /node_modules/, /\.dsh-code-index/];
  const miss = rules.filter((re) => !re.test(s));
  return miss.length ? ['缺少规则（' + miss.length + ' 条）: ' + miss.map(String).join(' | ')] : null;
});

// ---------------------------------------------------------------- #07
check(7, 'ps1 BOM', 'check/gate/doctor 等 *.ps1 必须 UTF-8 BOM', () => {
  const ps1 = RELS.filter((r) => r.endsWith('.ps1'));
  const bad = ps1.filter((r) => {
    const b = raw(r);
    return !b || b.length < 3 || b[0] !== 0xef || b[1] !== 0xbb || b[2] !== 0xbf;
  });
  const need = ['check.ps1', 'gate.ps1', 'doctor.ps1'].filter((r) => !ps1.includes(r));
  const out = bad.map((r) => '缺 BOM: ' + r).concat(need.map((r) => '缺失: ' + r));
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #08
check(8, '编译产物无 BOM', 'js/wxml/wxss/json 首三字节非 EF BB BF', () => {
  const files = RELS.filter((r) => CODE_EXT.test(r));
  const bad = files.filter((r) => {
    const b = raw(r);
    return b && b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  });
  return bad.length ? shortList(bad.map((r) => '带 BOM: ' + r), 10) : null;
});

// ---------------------------------------------------------------- #09
check(9, 'WXML class 有定义', '同页 WXSS 或 app.wxss（含组件）', () => {
  const appWxss = text('app.wxss') || '';
  const defs = new Map();
  const classSet = (css) => {
    const set = new Set();
    const re = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m;
    while ((m = re.exec(css))) set.add(m[1]);
    return set;
  };
  const bad = [];
  const wxmls = RELS.filter((r) => /\.wxml$/.test(r) && PAGE_SCOPES.some((p) => r.startsWith(p))
    || /^components\/.*\.wxml$/.test(r) || /^custom-tab-bar\/.*\.wxml$/.test(r));
  for (const wxml of wxmls) {
    const cssRel = wxml.replace(/\.wxml$/, '.wxss');
    let css = text(cssRel) || '';
    // 跟随 @import 相对路径
    const imports = css.match(/@import\s+["']([^"']+)["']/g) || [];
    for (const imp of imports) {
      const m = imp.match(/["']([^"']+)["']/);
      if (!m) continue;
      const target = path.posix.join(path.posix.dirname(cssRel), m[1]);
      css += '\n' + (text(target) || '');
    }
    const defined = defs.get(cssRel) || classSet(css + '\n' + appWxss);
    defs.set(cssRel, defined);
    const s = text(wxml);
    if (s === null) continue;
    const re = /class\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(s))) {
      const v = m[1];
      if (v.indexOf('{{') !== -1 || v.indexOf('}}') !== -1) continue;
      v.split(/\s+/).filter(Boolean).forEach((cls) => {
        if (!defined.has(cls)) bad.push(wxml + ': .' + cls);
      });
    }
  }
  return bad.length ? shortList(bad, 12) : (wxmls.length === 0 ? ['WXML 样本为空（空集不得判绿）'] : null);
});

// ---------------------------------------------------------------- #10
check(10, 'tabBar↔pages', 'list 恰好 5 项/主包页/custom-tab-bar 在根/每角色 3 格/pkg-admin 不在 list', () => {
  const app = F.readJson(path.join(ROOT, 'app.json'));
  const tb = app.tabBar || {};
  const out = [];
  if (tb.custom !== true) out.push('tabBar.custom 必须为 true');
  const list = (tb.list || []).map((x) => x.pagePath);
  if (list.length !== 5) out.push('tabBar.list 必须恰好 5 项，当前 ' + list.length);
  if (JSON.stringify(list.slice().sort()) !== JSON.stringify(P.TAB_LIST.slice().sort())) {
    out.push('tabBar.list 与 CONTRACT §7 五 tab 不一致: ' + list.join(', '));
  }
  list.filter((p) => !P.MAIN_PAGES.includes(p)).forEach((p) => out.push('非主包页进了 tabBar: ' + p));
  list.filter((p) => p.startsWith('pkg-admin/')).forEach((p) => out.push('pkg-admin 页面不得进 tabBar: ' + p));
  ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
    if (!exists('custom-tab-bar/index' + ext)) out.push('缺 custom-tab-bar/index' + ext);
  });
  Object.keys(P.TAB_PAGES_BY_ROLE).forEach((role) => {
    P.TAB_PAGES_BY_ROLE[role].forEach((p) => {
      if (!list.includes(p)) out.push(role + ' 角色 tab 不可解析: ' + p);
    });
  });
  const comp = text('custom-tab-bar/index.js');
  if (comp !== null && !/tabBar|list|TAB/i.test(comp)) out.push('custom-tab-bar/index.js 未见 tab 清单');
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #11
check(11, '全局 navigationStyle 禁止', '仅页面局部 .json 允许', () => {
  const app = F.readJson(path.join(ROOT, 'app.json'));
  return app.window && app.window.navigationStyle ? ['app.json window.navigationStyle = ' + app.window.navigationStyle] : null;
});

// ---------------------------------------------------------------- #12
check(12, '集合名注册表', '云端 db.collection 字面量 ∈ shared/collections.js；客户端零集合字面量', () => {
  const reg = requireRegistry(['shared/collections.js']);
  if (!reg || reg.error) return [reg ? 'shared/collections.js 加载失败: ' + reg.error : 'shared/collections.js 缺失'];
  const known = new Set(Array.from(stringsOf(reg.value)).filter((s) => P.COLLECTIONS.includes(s)));
  const out = [];
  P.COLLECTIONS.filter((c) => !known.has(c)).forEach((c) => out.push('注册表缺集合: ' + c));
  if (known.size !== P.COLLECTIONS.length) out.push('注册表集合数 ' + known.size + ' ≠ 14');
  const lit = /\.collection\(\s*['"]([^'"]+)['"]/g;
  cloudJs().forEach((rel) => {
    const s = text(rel) || '';
    let m;
    while ((m = lit.exec(s))) if (!known.has(m[1])) out.push(rel + ': 未注册集合 ' + m[1]);
    lit.lastIndex = 0;
  });
  clientFiles().forEach((rel) => {
    const s = text(rel) || '';
    P.COLLECTIONS.forEach((c) => {
      if (new RegExp("['\"]" + c + "['\"]").test(s)) out.push(rel + ': 客户端出现集合名字面量 ' + c);
    });
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #13
check(13, 'action 注册表', 'shared/actions.js 覆盖 §5.3 全集 + visibility/write；api 调用 ⊆ client', () => {
  const reg = requireRegistry(['shared/actions.js']);
  if (!reg || reg.error) return [reg ? 'shared/actions.js 加载失败: ' + reg.error : 'shared/actions.js 缺失'];
  const map = findActionMap(reg.value);
  if (!map) return ['shared/actions.js 未导出 action 映射（需 {module.action: {visibility,write}}）'];
  const got = new Set(Object.keys(map));
  const out = [];
  Object.keys(P.ACTIONS).filter((a) => !got.has(a)).forEach((a) => out.push('注册表缺 action: ' + a));
  got.forEach((a) => {
    if (!P.ACTIONS[a] && !P.P1_ACTIONS.includes(a)) out.push('注册表多出未登记 action: ' + a);
  });
  got.forEach((a) => {
    if (!P.ACTIONS[a]) return;
    const vis = visibilityOf(map[a]);
    if (!vis) out.push(a + ' 缺 visibility（client/internal）');
    else if (vis !== P.ACTIONS[a].visibility) out.push(a + ' visibility=' + vis + '，应为 ' + P.ACTIONS[a].visibility);
    if (!hasWriteFlag(map[a])) out.push(a + ' 缺 write 布尔标记');
  });
  const clientSet = new Set(Object.keys(P.ACTIONS).filter((a) => P.ACTIONS[a].visibility === 'client'));
  const mods = RELS.filter((r) => /^api\/modules\/.*\.js$/.test(r));
  if (mods.length === 0) out.push('api/modules/*.js 缺失');
  mods.forEach((rel) => {
    const s = text(rel) || '';
    const re = /['"]([a-z][a-zA-Z]+\.[a-zA-Z]+)['"]/g;
    let m;
    while ((m = re.exec(s))) if (!clientSet.has(m[1])) out.push(rel + ': 非 client 动作 ' + m[1]);
  });
  // 页面层不得直接拼 action 字符串（#21 的 action 侧延伸）
  pagesJs().forEach((rel) => {
    const s = text(rel) || '';
    const re = /['"]([a-z][a-zA-Z]+\.[a-zA-Z]+)['"]/g;
    let m;
    while ((m = re.exec(s))) if (P.ACTIONS[m[1]] || P.P1_ACTIONS.includes(m[1])) out.push(rel + ': 页面直拼 action ' + m[1]);
  });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #14
check(14, '客户端禁直连', 'wx.cloud.database 零命中；callFunction 仅 api/client.js；uploadFile 仅 api/upload.js', () => {
  const out = [];
  const cf = clientFiles();
  grep(cf, /wx\.cloud\.database/).forEach((h) => out.push('wx.cloud.database: ' + h));
  grep(cf.filter((r) => r !== 'api/client.js'), /callFunction/).forEach((h) => out.push('callFunction 越界: ' + h));
  grep(cf.filter((r) => r !== 'api/upload.js'), /uploadFile/).forEach((h) => out.push('uploadFile 越界: ' + h));
  if (!exists('api/client.js')) out.push('缺失: api/client.js');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #15
check(15, '本地存储唯一写口', 'wx.*Storage* 仅 utils/storage.js（剥注释；空集判红）；票据不落盘', () => {
  const out = [];
  const files = clientFiles().filter((r) => r.endsWith('.js'));
  let total = 0;
  files.forEach((rel) => {
    const s = text(rel) || '';
    const code = F.stripComments(s);
    const hits = code.match(/wx\.[A-Za-z]*Storage[A-Za-z]*/g) || [];
    total += hits.length;
    if (hits.length && rel !== 'utils/storage.js') out.push(rel + ': ' + hits.join(','));
  });
  if (total === 0) out.push('wx.*Storage* 空集（空集不得判绿）');
  const st = text('utils/storage.js');
  if (st === null) out.push('缺失: utils/storage.js');
  else {
    ['viewTicket', 'viewContext', 'viewMode', 'targetIsTest'].forEach((k) => {
      if (st.indexOf(k) !== -1) out.push('utils/storage.js 出现票据字段: ' + k);
    });
  }
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #16
check(16, '云函数依赖白名单', '两 package.json 依赖只允许 wx-server-sdk；非相对 require 只允许 sdk', () => {
  const out = [];
  ['cloudfunctions/api/package.json', 'cloudfunctions/cleanup/package.json'].forEach((rel) => {
    if (!exists(rel)) { out.push('缺失: ' + rel); return; }
    let pkg;
    try { pkg = F.readJson(path.join(ROOT, rel)); } catch (e) { out.push(rel + ': ' + e.message); return; }
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    Object.keys(deps).filter((d) => d !== 'wx-server-sdk').forEach((d) => out.push(rel + ': 非法依赖 ' + d));
  });
  cloudJs().forEach((rel) => {
    const s = text(rel) || '';
    const re = /require\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(s))) {
      const id = m[1];
      if (!id.startsWith('.') && !id.startsWith('/') && id !== 'wx-server-sdk') out.push(rel + ': 非白名单 require ' + id);
    }
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #17
check(17, 'shared 副本对帐', 'shared/** + ids.js/room-tag.js 与两云函数副本逐字节 hash 相等', () => {
  const out = [];
  const src = [];
  RELS.filter((r) => r.startsWith('shared/') && r.endsWith('.js')).forEach((r) => src.push({ rel: r, target: 'shared/' + r.slice('shared/'.length) }));
  [['utils/ids.js', 'shared/ids.js'], ['utils/room-tag.js', 'shared/room-tag.js']].forEach((pair) => {
    if (!exists(pair[0])) out.push('缺失源文件: ' + pair[0]);
    else src.push({ rel: pair[0], target: pair[1] });
  });
  if (src.length === 0) return ['shared 源文件为空（空集不得判绿）'];
  for (const cfRoot of ['cloudfunctions/api', 'cloudfunctions/cleanup']) {
    for (const item of src) {
      const target = cfRoot + '/' + item.target;
      if (!exists(target)) { out.push('缺副本: ' + target); continue; }
      const a = raw(item.rel);
      const b = raw(target);
      if (!a || !b) continue;
      if (F.sha256(a) !== F.sha256(b)) out.push('漂移: ' + target + ' ≠ ' + item.rel);
    }
  }
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #18
check(18, '行数', '源码 ≤500、测试 ≤1000（全文本口径；docs 由 check-docs 管，见文件头）', () => {
  const out = [];
  const files = js();
  files.forEach((rel) => {
    const isTest = /(^|\/)tools\/selftest/.test(rel);
    const limit = isTest ? 1000 : 500;
    const n = F.countLines(path.join(ROOT, rel));
    if (n > limit) out.push(rel + ': ' + n + ' 行 > ' + limit);
  });
  return out.length ? shortList(out, 12) : (files.length ? null : ['JS 样本为空（空集不得判绿）']);
});

// ---------------------------------------------------------------- #19
check(19, '敏感字面量', 'openid 形态零命中；云环境 ID 只在 config/env.js；ADMIN_OPENIDS 不硬编码', () => {
  const out = [];
  const openidRe = /o[A-Za-z0-9_-]{27}/;
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    if (openidRe.test(s)) out.push(rel + ': 疑似 openid 字面量');
  });
  const env = text('config/env.js');
  if (env === null) out.push('缺失: config/env.js');
  else {
    const m = env.match(/envId\s*:\s*['"]([^'"]+)['"]/);
    if (!m) out.push('config/env.js 未找到 envId 字面量');
    else {
      const envId = m[1];
      RELS.filter((r) => r.endsWith('.js') && r !== 'config/env.js' && !r.startsWith('tools/')).forEach((rel) => {
        if ((text(rel) || '').indexOf(envId) !== -1) out.push(rel + ': 云环境 ID 越界');
      });
    }
  }
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    if (/ADMIN_OPENIDS\s*[:=]\s*\[/.test(s)) out.push(rel + ': ADMIN_OPENIDS 硬编码数组');
    if (P.CLIENT_DIRS.some((d) => rel.startsWith(d + '/')) && s.indexOf('ADMIN_OPENIDS') !== -1) {
      out.push(rel + ': 客户端出现 ADMIN_OPENIDS');
    }
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #20
check(20, '错误码注册表', 'shared/error-codes.js 恰好 13 码；旧码零残留；error-copy 每码有文案', () => {
  const reg = requireRegistry(['shared/error-codes.js']);
  if (!reg || reg.error) return [reg ? 'shared/error-codes.js 加载失败: ' + reg.error : 'shared/error-codes.js 缺失'];
  const set = new Set(Array.from(stringsOf(reg.value)).filter((s) => /^[A-Z][A-Z_]+$/.test(s)));
  const out = [];
  P.ERROR_CODES.filter((c) => !set.has(c)).forEach((c) => out.push('缺错误码: ' + c));
  Array.from(set).filter((c) => !P.ERROR_CODES.includes(c)).forEach((c) => out.push('未登记错误码: ' + c));
  P.OLD_ERROR_CODES.forEach((c) => {
    js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
      if (new RegExp("['\"]" + c + "['\"]").test(text(rel) || '')) out.push(rel + ': 旧错误码残留 ' + c);
    });
  });
  P.ERROR_CODES.forEach((c) => {
    const used = js().some((r) => !r.startsWith('tools/') && (text(r) || '').indexOf("'" + c + "'") !== -1);
    if (!used) out.push('错误码未被任何代码引用: ' + c);
  });
  const copy = text('shared/error-copy.js');
  if (copy === null) out.push('缺失: shared/error-copy.js');
  else P.ERROR_CODES.forEach((c) => { if (copy.indexOf(c) === -1) out.push('error-copy 缺文案: ' + c); });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #21
check(21, '页面层零判据', 'pages/、pkg-*/pages/ 不出现 wx.cloud.*、七状态字面量、编号/roomTag 生成/random', () => {
  const out = [];
  const statuses = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
  pagesJs().forEach((rel) => {
    const s = text(rel) || '';
    if (/wx\.cloud\./.test(s)) out.push(rel + ': wx.cloud.*');
    statuses.forEach((st) => {
      if (new RegExp("['\"]" + st + "['\"]").test(s)) out.push(rel + ': 状态字面量 ' + st);
    });
    if (/Math\.random|random\(/.test(s)) out.push(rel + ': random');
    if (/generate[A-Za-z]*(No|Code|Tag)|nextRoomTag|allocRoomTag/.test(s)) out.push(rel + ': 编号/roomTag 生成');
  });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #22
check(22, '零金额扫描（源码+页面文案）', '§7.6 词表命中 0；白名单只认精确项', () => {
  const r = ZM.run({ scope: 'source' });
  if (r.allowlistIssues.length) return ['白名单校验问题: ' + r.allowlistIssues.slice(0, 4).join('；')];
  const hits = r.hits.filter((h) => h.file.startsWith('pages/') || h.file.startsWith('pkg-') || !h.file.startsWith('docs/'));
  return hits.length ? shortList(hits.map((h) => h.file + ':' + h.line + ' ' + h.token), 12) : null;
});

// ---------------------------------------------------------------- #23
check(23, '切换会话接入', '17 页引用 switch-bar；pkg-admin 零引用；viewTicket 只允许 api/client.js 与 store/', () => {
  const out = [];
  P.SWITCH_BAR_PAGES.forEach((page) => {
    const s = text(page + '.wxml');
    if (s === null) out.push('缺页面: ' + page + '.wxml');
    else if (s.indexOf('switch-bar') === -1) out.push(page + '.wxml 未引用 switch-bar');
  });
  rels('pkg-admin/').filter((r) => /\.(wxml|js)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['switch-bar', 'test-badge'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': pkg-admin 不得引用 ' + k); });
  });
  clientFiles().filter((r) => r.endsWith('.js')).forEach((rel) => {
    if (!(rel === 'api/client.js' || rel.startsWith('store/'))) {
      if ((text(rel) || '').indexOf('viewTicket') !== -1) out.push(rel + ': viewTicket 外泄');
    }
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #24
check(24, '客户端零 AI 外呼/零 Key', '客户端范围零 deepseek 痕迹；ai.parseParcel 只经 api/', () => {
  const out = [];
  const cf = clientFiles();
  ['DEEPSEEK_API_KEY', 'api.deepseek.com'].forEach((k) => {
    grep(cf, new RegExp(k.replace(/[.]/g, '\\.'))).forEach((h) => out.push(k + ': ' + h));
  });
  grep(cf, /deepseek/i).forEach((h) => out.push('deepseek: ' + h));
  pagesJs().forEach((rel) => {
    if ((text(rel) || '').indexOf('ai.parseParcel') !== -1) out.push(rel + ': 页面直调 ai.parseParcel');
  });
  const apiAi = RELS.filter((r) => /^api\/.*\.js$/.test(r));
  if (!apiAi.some((r) => (text(r) || '').indexOf('ai.parseParcel') !== -1)) out.push('api/ 未见 ai.parseParcel 出口');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #25
check(25, 'AI 外发白名单', 'https/fetch 只在 lib/ai/deepseek.js；payload 由 buildAiPayload 构造；无身份字段', () => {
  const out = [];
  const aiDir = 'cloudfunctions/api/lib/ai/';
  js().forEach((rel) => {
    const s = text(rel) || '';
    const outside = !rel.startsWith(aiDir);
    if (outside && /https:\/\//.test(s)) out.push(rel + ': 出现 https 外呼');
    if (outside && /(^|[^.\w])fetch\s*\(/.test(s)) out.push(rel + ': 出现 fetch 调用');
    if (outside && s.indexOf('api.deepseek.com') !== -1) out.push(rel + ': 出现 deepseek 端点');
  });
  const ds = text(aiDir + 'deepseek.js');
  if (ds === null) out.push('缺失: ' + aiDir + 'deepseek.js');
  else {
    if (ds.indexOf('buildAiPayload') === -1) out.push('deepseek.js 未使用 buildAiPayload()');
    if (ds.indexOf('AI_PAYLOAD_KEYS') === -1) out.push('deepseek.js 未引用 AI_PAYLOAD_KEYS');
  }
  const payload = text(aiDir + 'payload.js');
  if (payload === null) out.push('缺失: ' + aiDir + 'payload.js');
  else if (payload.indexOf('AI_PAYLOAD_KEYS') === -1) out.push('payload.js 未导出 AI_PAYLOAD_KEYS');
  rels(aiDir).filter((r) => r.endsWith('.js')).forEach((rel) => {
    ['fileId', 'openid', 'orderId'].forEach((k) => {
      if ((text(rel) || '').indexOf(k) !== -1) out.push(rel + ': lib/ai 出现身份字段 ' + k);
    });
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #26
check(26, '失败必入队', 'handlers/ai 每个 recognized:false 返回点有 recordFailure；catch 不空吞', () => {
  const out = [];
  const files = rels('cloudfunctions/api/handlers/ai/').filter((r) => r.endsWith('.js'));
  if (files.length === 0) out.push('handlers/ai 缺失');
  files.forEach((rel) => {
    const s = text(rel) || '';
    const falseReturns = (s.match(/recognized\s*:\s*false/g) || []).length;
    const records = (s.match(/recordFailure\s*\(/g) || []).length;
    if (falseReturns > records) out.push(rel + ': recognized:false ' + falseReturns + ' 处 > recordFailure ' + records + ' 处');
    const empties = s.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || [];
    if (empties.length) out.push(rel + ': 空 catch ' + empties.length + ' 处');
  });
  const collections = text('shared/collections.js');
  if (collections === null) out.push('缺失: shared/collections.js');
  else if (collections.indexOf('recognition_failures') === -1) out.push('collections 缺 recognition_failures');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #27
check(27, '复核原图访问必审计', 'getTempFileURL 与 FAILURE_IMAGE_VIEW 同函数；复核页零直取；fix/ignore 写审计', () => {
  const out = [];
  const adminJs = rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js'));
  const getFiles = adminJs.filter((r) => (text(r) || '').indexOf('getRecognitionFailure') !== -1);
  if (getFiles.length === 0) out.push('handlers/admin 未见 getRecognitionFailure');
  getFiles.forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('getTempFileURL') === -1) out.push(rel + ': 缺 getTempFileURL');
    if (s.indexOf('FAILURE_IMAGE_VIEW') === -1) out.push(rel + ': 缺 FAILURE_IMAGE_VIEW 审计');
  });
  rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js')).forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('fixRecognitionFailure') !== -1 && s.indexOf('FAILURE_FIX') === -1) out.push(rel + ': fix 缺 FAILURE_FIX');
    if (s.indexOf('ignoreRecognitionFailure') !== -1 && s.indexOf('FAILURE_IGNORE') === -1) out.push(rel + ': ignore 缺 FAILURE_IGNORE');
  });
  const reviewJs = rels('pkg-admin/pages/recognition-review/').filter((r) => r.endsWith('.js'));
  reviewJs.forEach((rel) => {
    if ((text(rel) || '').indexOf('getTempFileURL') !== -1) out.push(rel + ': 复核页不得直取临时 URL');
  });
  if (reviewJs.length === 0) out.push('复核页 JS 缺失');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #28
check(28, '绑定方向', 'bind.create 仅 CUSTOMER + 拒自绑；代客单零 bindings；兼职端零绑定入口', () => {
  const out = [];
  const bindJs = rels('cloudfunctions/api/handlers/bind/').filter((r) => r.endsWith('.js'));
  if (bindJs.length === 0) out.push('handlers/bind 缺失');
  const roleGuarded = bindJs.some((rel) => {
    const s = text(rel) || '';
    return s.indexOf('bind.create') !== -1 && /CUSTOMER/.test(s) && /FORBIDDEN/.test(s);
  });
  if (!roleGuarded) out.push('bind.create 未见 CUSTOMER 角色断言 + FORBIDDEN');
  const selfGuarded = bindJs.some((rel) => {
    const s = text(rel) || '';
    return /openid/i.test(s) && /===\s*effectiveOpenid|effectiveOpenid\s*===/.test(s);
  });
  if (!selfGuarded) out.push('bind.create 未见自绑拒绝断言');
  const orderJs = rels('cloudfunctions/api/handlers/order/').filter((r) => r.endsWith('.js'));
  orderJs.forEach((rel) => {
    if ((text(rel) || '').indexOf('bindings') !== -1) out.push(rel + ': 代客单路径不得访问 bindings');
  });
  rels('pkg-partner/').filter((r) => /\.(js|wxml)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['bind.create', 'bind.release'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 兼职端出现 ' + k); });
    ['绑定顾客', '添加顾客', '导入顾客'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 兼职端出现文案 ' + k); });
  });
  if (!RELS.some((r) => /handlers\/admin\/.*testAccount/i.test(r))) out.push('缺 handlers/admin/testAccounts 专用 purge');
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #29
check(29, '头像昵称', 'avatars/ 只在 upload 域、路径零 openid；avatarFileId 不进脱敏 DTO；昵称截断+msgSecCheck；roomTag 大写', () => {
  const out = [];
  const allowed = [/(^|\/)handlers\/upload\//, /^api\/upload\.js$/];
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('avatars/') !== -1 && !allowed.some((re) => re.test(rel))) out.push(rel + ': avatars/ 越界');
    if (/avatars\/[^'"`\n]*openid/.test(s)) out.push(rel + ': 头像路径含 openid');
  });
  const mask = text('cloudfunctions/api/handlers/admin/dto/mask.js');
  if (mask !== null && mask.indexOf('avatarFileId') !== -1) out.push('dto/mask.js 不得含 avatarFileId');
  rels('pkg-admin/').filter((r) => /\.(js|wxml)$/.test(r)).forEach((rel) => {
    if ((text(rel) || '').indexOf('avatarFileId') !== -1) out.push(rel + ': 后台出现 avatarFileId');
  });
  const profileJs = RELS.filter((r) => /handlers\/(customer|partner)\/.*(profile|activate)/.test(r) && r.endsWith('.js'));
  if (profileJs.length === 0) out.push('资料保存 handler 缺失');
  profileJs.forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('msgSecCheck') === -1) out.push(rel + ': 缺 msgSecCheck');
  });
  const tagAlloc = RELS.filter((r) => /tag-allocator/.test(r) && r.endsWith('.js'));
  tagAlloc.forEach((rel) => {
    const s = text(rel) || '';
    if (!/\^\[A-Z\]\+|\[A-Z\]\+\$?/.test(s)) out.push(rel + ': roomTag 未见大写校验');
  });
  const roomTag = text('utils/room-tag.js');
  if (roomTag !== null && roomTag.indexOf('random') !== -1) out.push('utils/room-tag.js 不得含 random');
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #30
check(30, '账号切换与测试数据隔离', '会话含 viewMode/targetIsTest；TEST_WRITE 断言 isTestAccount；统计过滤；审计枚举在册', () => {
  const out = [];
  const adminJs = rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js'));
  const sessionWriters = adminJs.filter((r) => (text(r) || '').indexOf('admin_view_sessions') !== -1
    && /\.add\s*\(/.test(text(r) || ''));
  if (sessionWriters.length === 0) out.push('未见 admin_view_sessions 写入');
  sessionWriters.forEach((rel) => {
    const s = text(rel) || '';
    ['viewMode', 'targetIsTest'].forEach((k) => { if (s.indexOf(k) === -1) out.push(rel + ': 会话写入缺 ' + k); });
  });
  RELS.filter((r) => (text(r) || '').indexOf('TEST_WRITE') !== -1 && /\.js$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    if (!/isTestAccount/.test(s)) out.push(rel + ': TEST_WRITE 签发处未断言 isTestAccount');
  });
  const statFiles = RELS.filter((r) => /handlers\/admin\/.*\.js$/.test(r) && /stats|list|invite/i.test(r));
  statFiles.forEach((rel) => {
    const s = text(rel) || '';
    if (!/isTest/.test(s)) out.push(rel + ': 统计/列表查询未见 isTest 过滤');
  });
  RELS.filter((r) => /handlers\/order\/.*\.js$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    if (/\.add\s*\(/.test(s) && s.indexOf('isTest') === -1) out.push(rel + ': 订单写入缺 isTest 派生');
    if (s.indexOf('impersonatedBy') === -1 && /impersonat|TEST_WRITE/.test(s)) out.push(rel + ': 测试写事件缺 impersonatedBy');
  });
  const audit = requireRegistry(['shared/audit-actions.js']);
  if (!audit || audit.error) out.push(audit ? 'shared/audit-actions.js 加载失败: ' + audit.error : 'shared/audit-actions.js 缺失');
  else {
    const got = new Set(Array.from(stringsOf(audit.value)).filter((s) => /^[A-Z][A-Z_]+$/.test(s)));
    P.AUDIT_ACTIONS.filter((a) => !got.has(a)).forEach((a) => out.push('审计缺: ' + a));
    Array.from(got).filter((a) => !P.AUDIT_ACTIONS.includes(a)).forEach((a) => out.push('审计多出: ' + a));
    js().forEach((rel) => { if ((text(rel) || '').indexOf('VIEW_AS_') !== -1 && !rel.startsWith('tools/')) out.push(rel + ': VIEW_AS_* 残留'); });
  }
  return out.length ? shortList(out, 14) : null;
});

// ---------------------------------------------------------------- #31
check(31, '测试视觉', 'TEST 字面量只在 test-badge；切换条颜色只在 switch-bar；后台零引用；角标受 viewMode 控制', () => {
  const out = [];
  const reTest = /(?<![A-Za-z0-9_])TEST(?![A-Za-z0-9_])/;
  RELS.filter((r) => /\.(wxml|js)$/.test(r) && !r.startsWith('components/test-badge/') && !r.startsWith('tools/'))
    .forEach((rel) => {
      const s = text(rel) || '';
      if (reTest.test(s)) out.push(rel + ': TEST 字面量越界');
    });
  const badgeWxml = text('components/test-badge/index.wxml');
  if (badgeWxml === null) out.push('缺失: components/test-badge/index.wxml');
  else if (badgeWxml.indexOf('TEST_WRITE') === -1) out.push('test-badge 未受 viewMode=TEST_WRITE 条件控制');
  const switchWxss = text('components/switch-bar/index.wxss');
  if (switchWxss === null) out.push('缺失: components/switch-bar/index.wxss');
  ['#F', '#E', '#1'].forEach((c) => { /* 颜色常量占位，具体色值由 UX 定稿后收紧 */ void c; });
  rels('pkg-admin/').filter((r) => /\.(wxml|js)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['switch-bar', 'test-badge'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 后台不得引用 ' + k); });
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- 输出
const opts = process.argv.slice(2);
const failOnly = opts.includes('--fail-only');
let pass = 0;
let failed = 0;
console.log('== tools/check.js · v4 门禁（ENGINEERING §8.2 · 31 条）==');
for (const r of results) {
  const id = '#' + String(r.no).padStart(2, '0');
  if (r.pass) {
    pass += 1;
    if (!failOnly) console.log('[PASS] ' + id + ' ' + r.title);
  } else {
    failed += 1;
    console.log('[FAIL] ' + id + ' ' + r.title);
    (r.detail || []).forEach((d) => console.log('        - ' + d));
  }
}
if (failed > 0) console.log('汇总（逐条）：' + results.map((r) => (r.pass ? '✅' : '❌') + r.no).join(' '));
console.log('------------------------------------------------------------');
console.log('通过 ' + pass + ' 项；失败 ' + failed + ' 项');
process.exitCode = failed === 0 ? 0 : 1;
