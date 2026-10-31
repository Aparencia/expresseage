'use strict';
/**
 * tools/check-docs.js — 设计阶段文档门禁（ENGINEERING §8.3 十二条判据）。
 *
 * 用法：node tools/check-docs.js --batch 0   # 批 0：豁免"批 1 才建立"的六件（§8.3 #1）
 *       node tools/check-docs.js            # 默认 --batch 1 = 严格不豁免
 * 汇总行必须存在（"通过 N 项；失败 M 项"）；没有汇总 = 读数作废。
 *
 * 单源登记（文件头差异说明）：
 *   - §8.3 #10①「旧口径禁词表」只在本文件定义（文档不重复字面量）；命中按"整行"判定：
 *     若同一行带"作废/旧口径/清扫/残句/原文/即缺陷/不计入扫描"等修订说明上下文，视为历史修订说明而非现行口径。
 *   - §8.3 #6「占位标记」判定形式只在本文件定义；`[D#]`/`[E#]`/`[R#]`/P1/P2/⏳ 不算占位。
 *   - §8.3 #11「可静态复算读数」的清单只在 staticGateCounts() 定义（check.js 判据数 / 本文件判据数 /
 *     selftest 套数 / 零金额白名单项数）；断言总数不可静态复算，一律要求引用 `node tools/selftest.js` 取数命令。
 *   - §8.3 #12「欠账台账结构」的列数/状态枚举/编号连续性/关闭依据只在本文件定义（TD-031 曾因单元格内
 *     未转义 `|` 致整行错位且脚本静默漏读）。
 *   - 文档范围：根 *.md + docs/**\/*.md（与零金额扫描 docs 范围一致）。
 */
const fs = require('fs');
const path = require('path');
const F = require('./lib/fsutil');
const P = require('./lib/project');
const ZM = require('./zero-money-scan');

const ROOT = F.ROOT;
const args = process.argv.slice(2);
const batchIdx = args.indexOf('--batch');
const BATCH = batchIdx >= 0 && args[batchIdx + 1] !== undefined ? Number(args[batchIdx + 1]) : 1;
const failOnly = args.includes('--fail-only');
if (![0, 1].includes(BATCH)) {
  console.error('check-docs: --batch 只支持 0 或 1');
  process.exit(2);
}

const DOCS = (() => {
  const out = [];
  fs.readdirSync(ROOT, { withFileTypes: true }).forEach((e) => {
    if (e.isFile() && /\.md$/i.test(e.name)) out.push(e.name);
  });
  const docsDir = path.join(ROOT, 'docs');
  F.walk(docsDir, { exts: new Set(['.md']) }, []).forEach((full) => out.push(F.rel(full)));
  return out.sort();
})();

const results = [];
function text(rel) {
  try {
    return F.readText(path.join(ROOT, rel));
  } catch (e) {
    return null;
  }
}
function section(src, headingRe) {
  return src === null ? null : F.section(src, headingRe);
}
function check(no, title, fn) {
  const entry = { no, title };
  try {
    const r = fn();
    if (r === null || r === undefined || r === true) entry.pass = true;
    else if (r && typeof r === 'object' && !Array.isArray(r) && r.skip) { entry.pass = true; entry.skip = r.skip; }
    else { entry.pass = false; entry.detail = Array.isArray(r) ? r : [String(r)]; }
  } catch (e) {
    entry.pass = false;
    entry.detail = ['判据执行异常: ' + e.message];
  }
  results.push(entry);
}
function shortList(items, n) {
  const lim = n || 8;
  return items.slice(0, lim).concat(items.length > lim ? ['…（共 ' + items.length + ' 项）'] : []);
}
function codeTokens(s) {
  const out = [];
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(String(s)))) out.push(m[1]);
  return out;
}
function loadModule(rel) {
  const full = path.join(ROOT, rel);
  if (!F.isFile(full)) return null;
  const r = F.tryRequire(full);
  return r.ok ? r.value : { __loadError: r.error.message };
}
function needCode(rels, what) {
  const missing = rels.filter((r) => !F.exists(path.join(ROOT, r)));
  if (missing.length === 0) return null;
  if (BATCH === 0) return { skip: '批 0 未建立代码侧：' + what + '（' + missing.join('、') + '）' };
  return missing.map((r) => '缺失: ' + r);
}

// 可静态复算的读数真值（#11 唯一来源）：判据/套件/白名单/文档份数。
// 期望值不抄文档、不抄现状：一律从登记表源文件现场解析；解析失败即报错（不静默 0）。
function staticGateCounts() {
  const errors = [];
  const read = (rel) => {
    const s = text(rel);
    if (s === null) errors.push('缺失（读数无法复算）: ' + rel);
    return s || '';
  };
  const countChecks = (s) => (s.match(/^check\((\d+),\s*'/gm) || []).length;
  const checkJs = countChecks(read('tools/check.js'));
  const checkDocs = countChecks(read('tools/check-docs.js'));
  const st = read('tools/selftest.js');
  const suitesAt = st.indexOf('const SUITES = [');
  let suites = 0;
  if (suitesAt === -1) errors.push('tools/selftest.js 未找到 `const SUITES = [` 注册表');
  else {
    const endAt = st.indexOf('];', suitesAt);
    const block = endAt === -1 ? '' : st.slice(suitesAt, endAt);
    suites = (block.match(/'[^'\n]+'/g) || []).length;
    if (suites === 0) errors.push('tools/selftest.js 的 SUITES 注册表解析为 0 套');
  }
  let allowlist = 0;
  const allowSrc = read('tools/zero-money-allowlist.json');
  if (allowSrc) {
    try {
      const json = JSON.parse(allowSrc);
      if (!Array.isArray(json)) errors.push('tools/zero-money-allowlist.json 不是数组');
      else allowlist = json.length;
    } catch (e) {
      errors.push('tools/zero-money-allowlist.json 不可解析: ' + e.message);
    }
  }
  [checkJs, checkDocs, allowlist].forEach((n, i) => {
    if (n === 0) errors.push(['check.js 判据数', 'check-docs 判据数', '白名单项数'][i] + ' 解析为 0');
  });
  return { errors, checkJs, checkDocs, suites, allowlist, docs: DOCS.length };
}

// ---------------------------------------------------------------- #1 文档地图
check(1, '文档地图/分阶段必需文件', () => {
  const required = BATCH === 0 ? P.DESIGN_DOCS.filter((r) => !P.BATCH0_EXEMPT.includes(r)) : P.DESIGN_DOCS.slice();
  const missing = required.filter((r) => !F.exists(path.join(ROOT, r)));
  const privacy = F.walk(path.join(ROOT, 'docs/privacy'), { exts: new Set(['.md']) }, []).length;
  const out = missing.map((r) => '缺失: ' + r);
  if (privacy === 0) out.push('缺 docs/privacy/*.md');
  if (BATCH === 0) {
    const notYet = P.BATCH0_EXEMPT.filter((r) => !F.exists(path.join(ROOT, r)));
    if (notYet.length) console.log('  · 批 0 豁免（批 1 收口前必须存在）: ' + notYet.join('、'));
  }
  return out.length ? shortList(out) : null;
});

// ---------------------------------------------------------------- #2 页面路径
check(2, 'CONTRACT §7 页面路径 = app.json 声明（页数口径 ' + P.ALL_PAGES.length + '，与 ALL_PAGES 联动）', () => {
  if (BATCH === 0) return { skip: '§8.3 #2 明确"批 1 后生效"' };
  const contract = text('docs/contract/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/contract/V4_CONTRACT.md'];
  const sec = section(contract, /^##\s*7\./);
  if (!sec) return ['CONTRACT 缺 §7 页面地图'];
  const declaredInDoc = new Set();
  const re = /(?:^|[\s`(（])((?:pages|pkg-[a-z]+)\/(?:[\w-]+\/)+index)(?=[\s`）)。,，]|$)/gm;
  let m;
  while ((m = re.exec(sec))) declaredInDoc.add(m[1]);
  const appRel = 'app.json';
  if (!F.exists(path.join(ROOT, appRel))) return ['缺失: app.json'];
  let app;
  try { app = F.readJson(path.join(ROOT, appRel)); } catch (e) { return ['app.json 不可解析: ' + e.message]; }
  const declared = new Set((app.pages || []).slice());
  (app.subPackages || app.subpackages || []).forEach((sp) => (sp.pages || []).forEach((p) => declared.add(sp.root + '/' + p)));
  const out = [];
  Array.from(declaredInDoc).filter((p) => !declared.has(p)).forEach((p) => out.push('CONTRACT 有、app.json 未声明: ' + p));
  Array.from(declared).filter((p) => !declaredInDoc.has(p)).forEach((p) => out.push('app.json 多出/未在 CONTRACT §7: ' + p));
  Array.from(declaredInDoc).filter((p) => p.startsWith('pkg-admin/')).forEach((p) => { void p; });
  if (declared.size !== P.ALL_PAGES.length) out.push('app.json 页数 ' + declared.size + ' ≠ ' + P.ALL_PAGES.length);
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #3 action 表
check(3, 'CONTRACT §5.3 action 表 = shared/actions.js；DATA_MODEL §7 ⊆ CONTRACT', () => {
  const contract = text('docs/contract/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/contract/V4_CONTRACT.md'];
  const sec = section(contract, /^###\s*5\.3/);
  if (!sec) return ['CONTRACT 缺 §5.3'];
  const out = [];
  const allText = new Set(codeTokens(sec));
  P.P1_ACTIONS.forEach((a) => allText.add(a));
  Object.keys(P.ACTIONS).filter((a) => !a.startsWith('cleanup.')).forEach((a) => {
    const name = a.slice(a.indexOf('.') + 1);
    if (!allText.has(name)) out.push('CONTRACT §5.3 未列出: ' + a);
  });
  const reg = needCode(['shared/actions.js'], 'action 注册表');
  if (reg && reg.skip) return reg;
  if (Array.isArray(reg)) return reg;
  const actions = loadModule('shared/actions.js');
  if (!actions || actions.__loadError) return ['shared/actions.js 加载失败'];
  const registered = Object.keys(actions.ACTION_MAP || {});
  Object.keys(P.ACTIONS).filter((a) => registered.indexOf(a) === -1).forEach((a) => out.push('注册表缺: ' + a));
  registered.filter((a) => !P.ACTIONS[a] && P.P1_ACTIONS.indexOf(a) === -1).forEach((a) => out.push('注册表多出: ' + a));
  const dm = text('docs/data/V4_DATA_MODEL.md');
  if (dm === null) {
    out.push('缺失: docs/data/V4_DATA_MODEL.md（§7 动作集合无法核对）');
  } else {
    const dmSec = section(dm, /^##\s*7\./);
    if (!dmSec) {
      // TD-079①：旧实现 `if (dmSec)` 命中才比对 → 删/改 §7 标题会静默跳过（空集全绿），必须判红。
      out.push('DATA_MODEL 缺 §7 章节标题（需形如 `## 7. 云函数 API 契约…`）：动作集合核对被静默跳过');
    } else {
      const MODULES = new Set(['user', 'customer', 'partner', 'bind', 'order', 'message', 'upload', 'config', 'admin',
        'ai', 'health', 'cleanup']);
      const dmActions = codeTokens(dmSec).filter((t) => {
        if (!/^[a-z]+\.[a-zA-Z]+$/.test(t)) return false;
        const mod = t.slice(0, t.indexOf('.'));
        if (!MODULES.has(mod)) return false;
        // `config.xxx` 多数是配置键（config.orderTimeoutMinutes 等），只有动作名才参与比对
        if (mod === 'config') return t === 'config.getPublic';
        return true;
      });
      if (dmActions.length === 0) out.push('DATA_MODEL §7 未解析到任何动作 token（空集不能算通过）');
      const dmSet = new Set(dmActions);
      dmActions.filter((a) => !P.ACTIONS[a]).forEach((a) => out.push('DATA_MODEL §7 出现 CONTRACT 未登记动作: ' + a));
      // 反向（TD-079①）：CONTRACT 的客户端可见动作必须在 DATA_MODEL §7 有契约行；cleanup.* 属内部 sweep，不在此表。
      Object.keys(P.ACTIONS).filter((a) => !a.startsWith('cleanup.') && !dmSet.has(a))
        .forEach((a) => out.push('DATA_MODEL §7 缺 CONTRACT 动作: ' + a));
    }
  }
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #4 集合/错误码
check(4, 'CONTRACT §4 集合（14）= shared/collections.js；13 错误码双向一致', () => {
  const contract = text('docs/contract/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/contract/V4_CONTRACT.md'];
  const out = [];
  const sec4 = section(contract, /^##\s*4\./);
  const docCollections = new Set();
  if (sec4) {
    sec4.split('\n').forEach((line) => {
      if (!line.trim().startsWith('|')) return;
      const cell = line.split('|')[1] || '';
      const tok = (cell.match(/`([^`]+)`/) || [])[1];
      if (tok && /^[a-z][a-z_]+$/.test(tok)) docCollections.add(tok);
    });
  }
  const sec53 = section(contract, /^###\s*5\.3/);
  const docCodes = new Set();
  (sec53 || '').split('\n').forEach((line) => {
    if (line.indexOf('只认这一套') === -1) return;
    // 只取"只认这一套："之后到第一个句号之间的码表，避免把 TEST_WRITE 等枚举误认成错误码
    const seg = (line.match(/只认这一套\*\*[：:]([\s\S]*?)。/) || [])[1] || '';
    codeTokens(seg).forEach((t) => { if (/^[A-Z][A-Z_]+$/.test(t)) docCodes.add(t); });
  });
  P.COLLECTIONS.filter((c) => !docCollections.has(c)).forEach((c) => out.push('CONTRACT §4 缺集合: ' + c));
  Array.from(docCollections).filter((c) => !P.COLLECTIONS.includes(c)).forEach((c) => out.push('CONTRACT §4 多出集合: ' + c));
  P.ERROR_CODES.filter((c) => !docCodes.has(c)).forEach((c) => out.push('CONTRACT §5.3 缺错误码: ' + c));
  Array.from(docCodes).filter((c) => !P.ERROR_CODES.includes(c)).forEach((c) => out.push('CONTRACT §5.3 多出错误码: ' + c));
  const need = needCode(['shared/collections.js', 'shared/error-codes.js'], '集合/错误码注册表');
  if (need && need.skip) return need;
  if (Array.isArray(need)) return need;
  const col = loadModule('shared/collections.js');
  const err = loadModule('shared/error-codes.js');
  if (col && !col.__loadError) {
    const got = new Set([].concat(col.ALL_COLLECTIONS || []));
    P.COLLECTIONS.filter((c) => !got.has(c)).forEach((c) => out.push('collections.js 缺: ' + c));
    Array.from(got).filter((c) => !P.COLLECTIONS.includes(c)).forEach((c) => out.push('collections.js 多出: ' + c));
  }
  if (err && !err.__loadError) {
    const got = new Set(err.ERROR_CODES || []);
    P.ERROR_CODES.filter((c) => !got.has(c)).forEach((c) => out.push('error-codes.js 缺: ' + c));
    Array.from(got).filter((c) => !P.ERROR_CODES.includes(c)).forEach((c) => out.push('error-codes.js 多出: ' + c));
  }
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #5 D#/E# 引用
function defineRefSets() {
  const contract = text('docs/contract/V4_CONTRACT.md') || '';
  const eng = text('docs/engineering/V4_ENGINEERING.md') || '';
  const dDefined = new Set();
  (section(contract, /^##\s*13\./) || '').split('\n').forEach((line) => {
    const m = line.match(/^\|\s*`?D(\d{1,2})`?\s*\|/);
    if (m) dDefined.add(Number(m[1]));
  });
  const eSec = section(eng, /^##\s*13\./) || '';
  const eDefined = new Set();
  // 只认 §13 表格首列（`| E7 | …` / `| E9/E10 | …`）：正文里提到 E# 不算“定义”，
  // 否则"引用不存在的 E# 不被判红"（TD-079）。定义集为空/缺号由 #5 判红。
  eSec.split('\n').forEach((line) => {
    if (!line.trim().startsWith('|')) return;
    const cell = (line.split('|')[1] || '').trim();
    const m = cell.match(/^E(\d{1,2})(?:\s*\/\s*E(\d{1,2}))?$/);
    if (!m) return;
    eDefined.add(Number(m[1]));
    if (m[2]) eDefined.add(Number(m[2]));
  });
  return { dDefined, eDefined };
}

// D 裁决编号范围（CONTRACT §13）：上限随裁决扩展而变（D22 → D26 → D29 → D35 → D36 …）。
// 条目数不写死：以 CONTRACT §13 实际 D 行为准，只要求「1..最大定义号连续、无缺号」；
// D_MAX 是引用硬上界——伪造 D43+ 引用必须判红（负向判据由 E 轴 selftest/手工钻取验证）。
const D_MAX = 42;

function dRangeProblems(dDefined) {
  const out = [];
  if (dDefined.size === 0) {
    out.push('CONTRACT §13 未解析到 D 条目');
    return out;
  }
  const max = Math.max.apply(null, Array.from(dDefined));
  for (let i = 1; i <= max; i += 1) {
    if (!dDefined.has(i)) out.push('CONTRACT §13 缺 D' + i + '（1..' + max + ' 应连续）');
  }
  if (max > D_MAX) out.push('CONTRACT §13 D 编号 ' + max + ' 超出上限 D' + D_MAX);
  return out;
}
check(5, 'D#/E# 引用可解析（D1~D' + D_MAX + ' 连续；工程缺口 E# 全定义且连续；`[E#]` 显式引用必须命中定义集）', () => {
  const { dDefined, eDefined } = defineRefSets();
  const out = dRangeProblems(dDefined);
  if (eDefined.size === 0) out.push('ENGINEERING §13 未解析到 E 条目');
  else {
    const eMax = Math.max.apply(null, Array.from(eDefined));
    for (let i = 1; i <= eMax; i += 1) {
      if (!eDefined.has(i)) out.push('ENGINEERING §13 缺 E' + i + '（1..' + eMax + ' 应连续，未启用的编号不应夹在定义集中）');
    }
  }
  DOCS.forEach((rel) => {
    const s = text(rel) || '';
    (s.match(/\bD(\d{1,2})\b/g) || []).forEach((tok) => {
      const n = Number(tok.slice(1));
      if (n < 1 || n > D_MAX) out.push(rel + ': D' + n + ' 越界（D1~D' + D_MAX + '）');
    });
    (s.match(/\bE(\d{1,2})\b/g) || []).forEach((tok) => {
      const n = Number(tok.slice(1));
      if (n < 1 || n > 18) out.push(rel + ': E' + n + ' 越界（E1~E18）');
    });
    // TD-079②：AGENTS 规定"待裁决必须显式标 [E#]"，故只把方括号显式引用视为"工程缺口引用"；
    // 散装 E# 在 QA §E / 提审材料 §5 是另一命名空间（验收条目/材料编号），不在此判据内。
    // docs/archive/** 是历史快照（其 E# 多为审查命令编号），按归档纪律不参与现行引用校验。
    if (rel.startsWith('docs/archive/')) return;
    (s.match(/\[E(\d{1,2})\b/g) || []).forEach((tok) => {
      const n = Number(tok.slice(2));
      if (!eDefined.has(n)) out.push(rel + ': [E' + n + '] 未在 ENGINEERING §13 定义（工程缺口清单）');
    });
  });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #6 占位标记
check(6, '正文无未完成占位标记', () => {
  const markers = [
    { re: /\bTODO\b/, label: '英文待办缩写 TODO' },
    { re: /\bTBD\b/, label: '英文待办缩写 TBD' },
    { re: /\bFIXME\b/, label: '英文待办缩写 FIXME' },
    { re: /以后再补/, label: '以后再补类措辞' },
    { re: /待补充/, label: '待补充类措辞' },
  ];
  const EXEMPT = /不写|禁止|不得|不算|判定|单源|豁免|计入扫描|\[D\d+\]|\bD\d+\b|待裁决/;
  const out = [];
  DOCS.forEach((rel) => {
    const s = text(rel) || '';
    s.split('\n').forEach((line, i) => {
      markers.forEach((mk) => {
        if (mk.re.test(line) && !EXEMPT.test(line)) out.push(rel + ':' + (i + 1) + ': ' + mk.label);
      });
    });
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #7 零金额文档扫描
check(7, '零金额文档扫描（docs/ + 根 md，白名单精确项）', () => {
  const r = ZM.run({ scope: 'docs' });
  if (r.allowlistIssues.length) return ['白名单校验问题: ' + r.allowlistIssues.slice(0, 3).join('；')];
  return r.hits.length ? shortList(r.hits.map((h) => h.file + ':' + h.line + ' ' + h.token), 10) : null;
});

// ---------------------------------------------------------------- #8 编号规格一致性
check(8, '编号规格四端一致（CONTRACT/ENGINEERING/ids.js/error-copy）', () => {
  const contract = text('docs/contract/V4_CONTRACT.md') || '';
  const eng = text('docs/engineering/V4_ENGINEERING.md') || '';
  const c31 = section(contract, /^##\s*3\./) || '';
  const e53 = section(eng, /^###\s*5\.3/) || '';
  const out = [];
  if (!/C-X{4}-X{4}/.test(c31)) out.push('CONTRACT §3 未见顾客编号展示式 C-XXXX-XXXX');
  if (!/P-X{3}-X{3}/.test(c31)) out.push('CONTRACT §3 未见兼职编号展示式 P-XXX-XXX');
  if (!/C-X{4}-X{4}/.test(e53) && !/C\+\s*8|C\+8/.test(e53)) out.push('ENGINEERING §5.3 未见顾客编号规格');
  if (!/P-X{3}-X{3}/.test(e53) && !/P\+\s*6|P\+6/.test(e53)) out.push('ENGINEERING §5.3 未见兼职编号规格');
  const need = needCode(['utils/ids.js', 'shared/error-copy.js'], '编号零件');
  if (need && need.skip) return need;
  if (Array.isArray(need)) return need;
  const ids = loadModule('utils/ids.js');
  if (!ids || ids.__loadError) out.push('utils/ids.js 加载失败');
  else {
    if (ids.CUSTOMER_NO_PREFIX !== 'C' || ids.CUSTOMER_NO_LENGTH !== 9) out.push('ids.js 顾客编号规格不符（C + 8 位）');
    if (ids.PARTNER_NO_PREFIX !== 'P' || ids.PARTNER_NO_LENGTH !== 7) out.push('ids.js 兼职编号规格不符（P + 6 位）');
  }
  const copy = loadModule('shared/error-copy.js');
  if (!copy || copy.__loadError) out.push('shared/error-copy.js 加载失败');
  else {
    // 三句错前缀文案：顾客编号误当兼职 / 开发者编号 / 通用格式（键名以 shared/error-copy.js 为准）
    ['CUSTOMER_PREFIX', 'DEVELOPER_PREFIX', 'FORMAT'].forEach((k) => {
      if (!copy.PREFIX_HINT || typeof copy.PREFIX_HINT[k] !== 'string' || !copy.PREFIX_HINT[k].trim()) {
        out.push('error-copy 错前缀文案缺 ' + k);
      }
    });
  }
  const cloud = F.walk(path.join(ROOT, 'cloudfunctions'), { exts: new Set(['.js']) }, []);
  if (cloud.length && BATCH >= 1) {
    const hasMapping = cloud.some((full) => {
      const s = F.readText(full);
      return s.indexOf('ADMIN_OPENIDS') !== -1 && /developerNo/.test(s);
    });
    if (!hasMapping) out.push('云侧未见 ADMIN_OPENIDS → developerNo 映射');
  }
  return out.length ? shortList(out, 8) : null;
});

// ---------------------------------------------------------------- #9 AI 兜底文档判据
check(9, 'AI 兜底文档三语义 + failureCode 5 枚举 + aiFallback 键 + 复核页路径 + 无明文 Key', () => {
  const contract = text('docs/contract/V4_CONTRACT.md') || '';
  const eng = text('docs/engineering/V4_ENGINEERING.md') || '';
  const out = [];
  const groups = [
    { label: '外发字段=白名单', re: /白名单|AI_PAYLOAD_KEYS|外发字段/ },
    { label: '失败必写 recognition_failures', re: /recognition_failures/ },
    { label: '原图访问必审计 FAILURE_IMAGE_VIEW', re: /FAILURE_IMAGE_VIEW/ },
  ];
  const c43 = section(contract, /^###\s*4\.3/) || '';
  const c113 = section(contract, /^###\s*11\.3/) || '';
  const c12 = section(contract, /^##\s*12\./) || '';
  const cAi = c43 + '\n' + c113 + '\n' + c12;
  const e410 = section(eng, /^###\s*4\.10/) || '';
  [[cAi, 'CONTRACT §4.3/§11.3/§12'], [e410, 'ENGINEERING §4.10']].forEach((pair) => {
    groups.forEach((g) => { if (!g.re.test(pair[0])) out.push(pair[1] + ' 未覆盖语义: ' + g.label); });
  });
  const failCodes = ['NO_TEXT', 'PARSE_MISS', 'LOW_CONFIDENCE', 'LLM_ERROR', 'IMAGE_UNREADABLE'];
  const dm = text('docs/data/V4_DATA_MODEL.md') || '';
  const cSet = failCodes.filter((c) => c43.indexOf(c) !== -1);
  const dmSet = failCodes.filter((c) => dm.indexOf(c) !== -1);
  if (cSet.length !== 5) out.push('CONTRACT §4.3 failureCode 枚举不全（' + cSet.length + '/5）');
  if (dmSet.length !== 5) out.push('DATA_MODEL failureCode 枚举不全（' + dmSet.length + '/5）');
  ['enabled', 'model', 'timeoutMs', 'maxPerUserPerDay', 'dailyQuota', 'cooldownMinutes'].forEach((k) => {
    if (c43.indexOf(k) === -1 && eng.indexOf(k) === -1) out.push('aiFallback 键未在文档出现: ' + k);
  });
  ['docs/contract/V4_CONTRACT.md', 'docs/engineering/V4_ENGINEERING.md'].forEach((rel) => {
    if ((text(rel) || '').indexOf('pkg-admin/pages/recognition-review/index') === -1) out.push(rel + ' 缺复核页路径');
  });
  DOCS.forEach((rel) => {
    if ((text(rel) || '').indexOf('DEEPSEEK_API_KEY') === -1 && /AI 兜底|DeepSeek|深询/.test(text(rel) || '')) void rel;
    if (/sk-[A-Za-z0-9]{16,}/.test(text(rel) || '')) out.push(rel + ': 疑似明文 Key');
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #10 v0.9 文档一致性
check(10, 'v0.9 文档一致性（旧口径禁词/审计枚举/roomTag 大写/切换会话五条/QA 点检）', () => {
  const out = [];
  // ① 旧口径禁词表（唯一单源；带修订说明上下文的历史行不算现行口径）
  const OLD_TERMS = [
    { re: /不收集头像/, label: '旧头像采集声明' },
    { re: /第二个微信号/, label: '旧双机验收说法' },
    { re: /MVP 单账号|单账号模式/, label: '旧单账号说明' },
    { re: /roomTag\s*小写|小写\s*roomTag/, label: '小写 roomTag 口径' },
    { re: /view-as/, label: '旧视角页名 view-as' },
    { re: /tagSuffix/, label: '小写 roomTag 后缀变量' },
  ];
  const HISTORY = /作废|旧口径|清扫|残句|原文|已废|已删|不再|替换|取代|改为|修订|即缺陷|不计入扫描|历史|旧称呼|旧名|→|account-switch|v0\.8|残留|无小写|无 `view-as`/;
  let exempt = 0;
  DOCS.forEach((rel) => {
    const s = text(rel) || '';
    s.split('\n').forEach((line, i) => {
      OLD_TERMS.forEach((tm) => {
        if (!tm.re.test(line)) return;
        if (HISTORY.test(line)) exempt += 1;
        else out.push(rel + ':' + (i + 1) + ': ' + tm.label);
      });
    });
  });
  if (exempt) console.log('  · 旧口径历史修订说明行（带作废/清扫上下文）' + exempt + ' 处，按修订说明豁免');
  // ② D# 引用可解析（复用 #5 的判定：D1~D29 上限 + §13 实际条目连续，不写死条目数）
  const { dDefined } = defineRefSets();
  dRangeProblems(dDefined).forEach((m) => out.push(m));
  // ③ 审计枚举：CONTRACT §4.2 列全 16 个；注册表（代码侧）集合相等
  const contract = text('docs/contract/V4_CONTRACT.md') || '';
  const auditSection = (contract.match(/\*\*admin 审计\*\*[^\n]*/) || [''])[0];
  P.AUDIT_ACTIONS.forEach((a) => { if (auditSection.indexOf(a) === -1) out.push('CONTRACT §4.2 审计列表缺: ' + a); });
  const needAudit = needCode(['shared/audit-actions.js'], '审计枚举');
  if (needAudit && needAudit.skip) { /* 批 0 跳过代码侧 */ } else if (Array.isArray(needAudit)) out.push.apply(out, needAudit);
  else {
    const reg = loadModule('shared/audit-actions.js');
    if (reg && !reg.__loadError) {
      const got = new Set(Object.keys(reg.AUDIT_ACTIONS || {}));
      P.AUDIT_ACTIONS.filter((a) => !got.has(a)).forEach((a) => out.push('audit-actions.js 缺: ' + a));
      Array.from(got).filter((a) => !P.AUDIT_ACTIONS.includes(a)).forEach((a) => out.push('audit-actions.js 多出: ' + a));
    } else out.push('shared/audit-actions.js 加载失败');
  }
  // ④ roomTag 四端一致（CONTRACT D7/§3、ENGINEERING §5.3b/§4.12、utils/room-tag.js 大写）
  const eng = text('docs/engineering/V4_ENGINEERING.md') || '';
  [['docs/contract/V4_CONTRACT.md', contract], ['docs/engineering/V4_ENGINEERING.md', eng]].forEach((pair) => {
    if (!/A…Z|A\.\.\.Z/.test(pair[1])) out.push(pair[0] + ' 缺 roomTag 大写口径 A…Z/AA…');
  });
  const rt = loadModule('utils/room-tag.js');
  if (!rt || rt.__loadError) out.push('utils/room-tag.js 加载失败（roomTag 四端一致无法核对）');
  else {
    if (rt.isValidTag('a') || !rt.isValidTag('AA')) out.push('utils/room-tag.js 非恒大写');
    if (rt.toTag(27) !== 'AA') out.push('utils/room-tag.js toTag(27) ≠ AA');
  }
  // ⑤ 切换会话五条（真实只读/测试可写/票据不落盘/删除测试账号结束会话/两种模式）
  const c13 = section(contract, /^###\s*1\.3/) || section(contract, /^##\s*1\./) || '';
  const five = [
    { label: 'viewMode ∈ {READONLY,TEST_WRITE}', re: /READONLY/ },
    { label: '测试账号可写', re: /TEST_WRITE/ },
    { label: '真实账号只读', re: /真实账号[^\n]{0,20}只读|只读[^\n]{0,20}真实账号/ },
    { label: '票据不落本地存储', re: /不落[^\n]{0,10}(存储|本地)|内存态/ },
    { label: '删除测试账号结束会话', re: /删除测试账号[^\n]{0,20}(会话|票据|结束)/ },
  ];
  five.forEach((f) => { if (!f.re.test(c13) && !f.re.test(contract)) out.push('CONTRACT §1.3 未覆盖: ' + f.label); });
  // ⑥ QA_CHECKLIST v0.9 点检项
  const qa = text('docs/delivery/V4_QA_CHECKLIST.md') || '';
  ['账号切换', '测试账号', '头像', '绑定方向'].forEach((k) => {
    if (qa.indexOf(k) === -1) out.push('QA_CHECKLIST 缺 v0.9 点检小节: ' + k);
  });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #11 总览读数
// TD-078：总览类文档的"当前读数"必须可复算——①STATE 快照行必须有日期/HEAD 锚点，
// ②可静态复算的读数（判据数/套数/白名单项数）必须等于真值，③断言总数不得裸写（须引用取数命令）。
check(11, '总览类文档读数可复算（快照日期/HEAD 锚点 + 判据数/套数/白名单一致；禁止裸写断言总数）', () => {
  const C = staticGateCounts();
  const out = C.errors.slice();
  const truth = {
    checkJs: 'node tools/check.js',
    checkDocs: 'node tools/check-docs.js',
    suites: 'node tools/selftest.js',
    allowlist: 'tools/zero-money-allowlist.json'
  };
  const state = text('STATE.md');
  if (state === null) out.push('缺失: STATE.md');
  else {
    const snapLines = state.split('\n').filter((line) => line.indexOf('快照时间') !== -1);
    if (snapLines.length === 0) out.push('STATE.md 缺「快照时间」读数行（唯一状态源必须给出最后核对锚点）');
    snapLines.forEach((line, i) => {
      const where = 'STATE.md 快照行' + (snapLines.length > 1 ? '#' + (i + 1) : '');
      if (!/20\d\d-\d\d-\d\d/.test(line)) out.push(where + ' 缺日期锚点（YYYY-MM-DD）');
      if (line.indexOf('HEAD') === -1) out.push(where + ' 缺 HEAD 锚点');
      if (/断言合计\s*[\d,]+/.test(line)) {
        out.push(where + ' 裸写断言总数：改为引用取数命令 `node tools/selftest.js` 的汇总输出');
      }
      const js = line.match(/check\.js[^\d\n]{0,8}(\d+)\/(\d+)/);
      if (js && (Number(js[1]) !== C.checkJs || Number(js[2]) !== C.checkJs)) {
        out.push(where + ' check.js 读数 ' + js[1] + '/' + js[2] + ' ≠ 实际 ' + C.checkJs + '（' + truth.checkJs + '）');
      }
      const dc = line.match(/check-docs[^\d\n]{0,8}(\d+)\/(\d+)/);
      if (dc && (Number(dc[1]) !== C.checkDocs || Number(dc[2]) !== C.checkDocs)) {
        out.push(where + ' check-docs 读数 ' + dc[1] + '/' + dc[2] + ' ≠ 实际 ' + C.checkDocs + '（' + truth.checkDocs + '）');
      }
      const st = line.match(/selftest[^\d\n]{0,8}(\d+)\s*套/);
      if (st && Number(st[1]) !== C.suites) {
        out.push(where + ' selftest 套数 ' + st[1] + ' ≠ 实际 ' + C.suites + '（' + truth.suites + '）');
      }
      const wl = line.match(/白名单\s*(\d+)\s*项/);
      if (wl && Number(wl[1]) !== C.allowlist) {
        out.push(where + ' 零金额白名单 ' + wl[1] + ' 项 ≠ 实际 ' + C.allowlist + '（' + truth.allowlist + '）');
      }
    });
  }
  // docs/README.md 的「§6 代码结构 / §7 门禁与自证」是现行读数区；§8 起为整顿记录/开放项（历史叙述不在此判据内）。
  const dr = text('docs/README.md');
  if (dr === null) out.push('缺失: docs/README.md');
  else {
    const cutAt = dr.indexOf('\n## 8.');
    if (cutAt === -1) out.push('docs/README.md 缺 §8 标题：无法界定"现行读数区"（#11 需要 §6~§7 边界）');
    const region = cutAt === -1 ? dr : dr.slice(0, cutAt);
    region.split('\n').forEach((line, i) => {
      const where = 'docs/README.md:' + (i + 1);
      const js = line.match(/check\.js`?[^\n]{0,40}?[（(]\s*(\d+)\s*条/);
      if (js) {
        if (Number(js[1]) !== C.checkJs) out.push(where + ' check.js 条数 ' + js[1] + ' ≠ 实际 ' + C.checkJs + '（' + truth.checkJs + '）');
        if (line.indexOf('tools/check.js') === -1) out.push(where + ' check.js 读数缺取数命令 `node tools/check.js`');
      }
      const dc = line.match(/check-docs\.js`?[^\n]{0,40}?[（(]\s*(\d+)\s*条/);
      if (dc) {
        if (Number(dc[1]) !== C.checkDocs) out.push(where + ' check-docs 条数 ' + dc[1] + ' ≠ 实际 ' + C.checkDocs + '（' + truth.checkDocs + '）');
        if (line.indexOf('tools/check-docs.js') === -1) out.push(where + ' check-docs 读数缺取数命令 `node tools/check-docs.js`');
      }
      const st = line.match(/selftest\.js`?[^\n]{0,40}?[（(]\s*(\d+)\s*套/);
      if (st) {
        if (Number(st[1]) !== C.suites) out.push(where + ' selftest 套数 ' + st[1] + ' ≠ 实际 ' + C.suites + '（' + truth.suites + '）');
        if (line.indexOf('tools/selftest.js') === -1) out.push(where + ' selftest 读数缺取数命令 `node tools/selftest.js`');
      }
      const fm = line.match(/断言合计\s*[\d,]+/);
      if (fm) out.push(where + ' 裸写断言总数：改为引用取数命令 `node tools/selftest.js` 的汇总输出');
    });
  }
  // README.md（对外入口）：若出现门禁读数，必须带日期锚点或取数命令，防止"对外承诺的读数"过期。
  const readme = text('README.md');
  if (readme === null) out.push('缺失: README.md');
  else {
    readme.split('\n').forEach((line, i) => {
      if (!/check\.js[^\d\n]{0,8}\d+\/\d+|check-docs[^\d\n]{0,8}\d+\/\d+|selftest[^\d\n]{0,8}\d+\s*套/.test(line)) return;
      if (!/20\d\d-\d\d-\d\d/.test(line) && line.indexOf('tools/') === -1) {
        out.push('README.md:' + (i + 1) + ' 门禁读数缺日期锚点或取数命令');
      }
    });
  }
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- #12 欠账台账
// TD-031 事故：单元格内未转义的 `|` 让整行多出一列、状态列错位，且按列解析的脚本会静默漏读该行。
// 本判据把「台账结构」变成机器判据：列数/编号格式与连续性/状态枚举/关闭依据/无重复。
check(12, '欠账台账结构完整（列数一致/编号 TD-### 连续/状态枚举/关闭依据/无重复）', () => {
  const rel = 'docs/governance/V4_TECH_DEBT.md';
  const s = text(rel);
  if (s === null) return ['缺失: ' + rel];
  const out = [];
  const lines = s.split('\n');
  const header = lines.find((line) => /^\|\s*编号\s*\|/.test(line));
  if (!header) return [rel + ': 缺表头 `| 编号 | 条目 | 影响 | 计划/批次 | 状态 | 来源 |`'];
  const cellsIn = (line) => line.split('|').length - 2;
  const cols = cellsIn(header);
  if (cols !== 6) out.push(rel + ': 表头列数 ' + cols + ' ≠ 6（编号/条目/影响/计划/状态/来源）');
  const ids = [];
  lines.forEach((line, i) => {
    if (!/^\|\s*TD-\d{3}/.test(line)) return;
    const where = rel + ':' + (i + 1);
    const cells = line.split('|');
    if (cells.length - 2 !== cols) {
      out.push(where + ' 表格列数 ' + (cells.length - 2) + ' ≠ 表头 ' + cols
        + '（单元格内出现未转义 `|` 会让整行错位）');
      return;
    }
    const id = cells[1].trim();
    const issue = cells[2].trim();
    const impact = cells[3].trim();
    const plan = cells[4].trim();
    const status = cells[5].replace(/^[\s*~]+|[\s*~]+$/g, '');
    const m = id.match(/^TD-(\d{3})$/);
    if (!m) out.push(where + ' 编号格式非 TD-###: ' + id);
    else ids.push(Number(m[1]));
    if (!issue) out.push(where + ' 条目为空');
    if (!impact) out.push(where + ' 影响为空');
    if (!/^(开放|跟踪中|已关闭)/.test(status)) {
      out.push(where + ' 状态非法（' + status + '）：只允许 开放/跟踪中/已关闭');
    } else if (/^已关闭/.test(status) && !/关闭依据|已完成|已关闭/.test(plan)) {
      out.push(where + ' 已关闭缺「关闭依据/已完成」结论');
    } else if (!/^已关闭/.test(status) && /关闭依据/.test(plan)) {
      out.push(where + ' 未关闭却含「关闭依据」（状态与结论矛盾）');
    }
  });
  if (ids.length === 0) out.push(rel + ': 未解析到任何 TD 行（空集不能算通过）');
  else {
    const seen = new Set(ids);
    const max = Math.max.apply(null, ids);
    for (let i = 1; i <= max; i += 1) {
      if (!seen.has(i)) out.push(rel + ': TD-' + String(i).padStart(3, '0') + ' 缺失（1..' + max + ' 应连续，不复用不跳号）');
    }
    ids.forEach((n, idx) => {
      if (ids.indexOf(n) !== idx) out.push(rel + ': TD-' + String(n).padStart(3, '0') + ' 重复');
    });
  }
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- 输出
let pass = 0;
let failed = 0;
let skipped = 0;
console.log('== tools/check-docs.js · 设计文档门禁（ENGINEERING §8.3 · 12 条）==');
console.log('批次：--batch ' + BATCH + (BATCH === 0 ? '（豁免批 1 才建立的六件）' : '（严格，不豁免）') + '；文档范围 ' + DOCS.length + ' 份');
for (const r of results) {
  const id = '#' + String(r.no).padStart(2, '0');
  if (r.pass) {
    pass += 1;
    if (r.skip) { skipped += 1; console.log('[PASS] ' + id + ' ' + r.title + '（SKIP：' + r.skip + '）'); }
    else if (!failOnly) console.log('[PASS] ' + id + ' ' + r.title);
  } else {
    failed += 1;
    console.log('[FAIL] ' + id + ' ' + r.title);
    (r.detail || []).forEach((d) => console.log('        - ' + d));
  }
}
console.log('------------------------------------------------------------');
console.log('check-docs（--batch ' + BATCH + '）：通过 ' + pass + ' 项；失败 ' + failed + ' 项'
  + (skipped ? '（其中跳过 ' + skipped + ' 项）' : ''));
process.exitCode = failed === 0 ? 0 : 1;
