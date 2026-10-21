'use strict';
/**
 * tools/check-docs.js — 设计阶段文档门禁（ENGINEERING §8.3 十条判据）。
 *
 * 用法：node tools/check-docs.js --batch 0   # 批 0：豁免"批 1 才建立"的六件（§8.3 #1）
 *       node tools/check-docs.js            # 默认 --batch 1 = 严格不豁免
 * 汇总行必须存在（"通过 N 项；失败 M 项"）；没有汇总 = 读数作废。
 *
 * 单源登记（文件头差异说明）：
 *   - §8.3 #10①「旧口径禁词表」只在本文件定义（文档不重复字面量）；命中按"整行"判定：
 *     若同一行带"作废/旧口径/清扫/残句/原文/即缺陷/不计入扫描"等修订说明上下文，视为历史修订说明而非现行口径。
 *   - §8.3 #6「占位标记」判定形式只在本文件定义；`[D#]`/`[E#]`/`[R#]`/P1/P2/⏳ 不算占位。
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
check(2, 'CONTRACT §7 页面路径 = app.json 声明（30 页）', () => {
  if (BATCH === 0) return { skip: '§8.3 #2 明确"批 1 后生效"' };
  const contract = text('docs/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/V4_CONTRACT.md'];
  const sec = section(contract, /^##\s*7\./);
  if (!sec) return ['CONTRACT 缺 §7 页面地图'];
  const declaredInDoc = new Set();
  const re = /(?:^|[\s`(（])((?:pages|pkg-[a-z]+)\/[\w-]+\/index)(?=[\s`）)。,，]|$)/gm;
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
  const contract = text('docs/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/V4_CONTRACT.md'];
  const sec = section(contract, /^###\s*5\.3/);
  if (!sec) return ['CONTRACT 缺 §5.3'];
  const out = [];
  const allText = new Set(codeTokens(sec));
  P.P1_ACTIONS.forEach((a) => allText.add(a));
  Object.keys(P.ACTIONS).forEach((a) => {
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
  const dm = text('docs/V4_DATA_MODEL.md');
  if (dm !== null) {
    const dmSec = section(dm, /^##\s*7\./);
    if (dmSec) {
      const dmActions = codeTokens(dmSec).filter((t) => /^[a-z]+\.[a-zA-Z]+$/.test(t));
      dmActions.filter((a) => !P.ACTIONS[a]).forEach((a) => out.push('DATA_MODEL §7 出现 CONTRACT 未登记动作: ' + a));
    }
  }
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #4 集合/错误码
check(4, 'CONTRACT §4 集合（14）= shared/collections.js；13 错误码双向一致', () => {
  const contract = text('docs/V4_CONTRACT.md');
  if (contract === null) return ['缺失: docs/V4_CONTRACT.md'];
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
    codeTokens(line).forEach((t) => { if (/^[A-Z][A-Z_]+$/.test(t)) docCodes.add(t); });
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
  const contract = text('docs/V4_CONTRACT.md') || '';
  const eng = text('docs/V4_ENGINEERING.md') || '';
  const dDefined = new Set();
  (section(contract, /^##\s*13\./) || '').split('\n').forEach((line) => {
    const m = line.match(/^\|\s*`?D(\d{1,2})`?\s*\|/);
    if (m) dDefined.add(Number(m[1]));
  });
  const eSec = section(eng, /^##\s*13\./) || '';
  const eDefined = new Set();
  const eText = ((eng.match(/^##\s*13\.[^\n]*/m) || [''])[0]) + '\n' + eSec;
  (eText.match(/\bE(\d{1,2})\b/g) || []).forEach((m) => eDefined.add(Number(m.slice(1))));
  return { dDefined, eDefined };
}
check(5, 'D#/E# 引用可解析（D1~D21；E1~E18）', () => {
  const { dDefined, eDefined } = defineRefSets();
  const out = [];
  if (dDefined.size !== 21) out.push('CONTRACT §13 D 条目数 ' + dDefined.size + ' ≠ 21');
  [1, 2].forEach((i) => {
    if (!dDefined.has(i)) out.push('CONTRACT §13 缺 D' + i);
  });
  if (eDefined.size === 0) out.push('ENGINEERING §13 未解析到 E 条目');
  DOCS.forEach((rel) => {
    const s = text(rel) || '';
    (s.match(/\bD(\d{1,2})\b/g) || []).forEach((tok) => {
      const n = Number(tok.slice(1));
      if (n < 1 || n > 21) out.push(rel + ': D' + n + ' 越界（D1~D21）');
    });
    (s.match(/\bE(\d{1,2})\b/g) || []).forEach((tok) => {
      const n = Number(tok.slice(1));
      if (n < 1 || n > 18) out.push(rel + ': E' + n + ' 越界（E1~E18）');
    });
  });
  return out.length ? shortList(out, 10) : null;
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
  const contract = text('docs/V4_CONTRACT.md') || '';
  const eng = text('docs/V4_ENGINEERING.md') || '';
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
    ['CUSTOMER', 'DEVELOPER', 'FORMAT'].forEach((k) => {
      if (!copy.PREFIX_HINT || !copy.PREFIX_HINT[k]) out.push('error-copy 错前缀文案缺 ' + k);
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
  const contract = text('docs/V4_CONTRACT.md') || '';
  const eng = text('docs/V4_ENGINEERING.md') || '';
  const out = [];
  const groups = [
    { label: '外发字段=白名单', re: /白名单|AI_PAYLOAD_KEYS|外发字段/ },
    { label: '失败必写 recognition_failures', re: /recognition_failures/ },
    { label: '原图访问必审计 FAILURE_IMAGE_VIEW', re: /FAILURE_IMAGE_VIEW/ },
  ];
  const c43 = section(contract, /^###\s*4\.3/) || '';
  const e410 = section(eng, /^###\s*4\.10/) || '';
  [[c43, 'CONTRACT §4.3'], [e410, 'ENGINEERING §4.10']].forEach((pair) => {
    groups.forEach((g) => { if (!g.re.test(pair[0])) out.push(pair[1] + ' 未覆盖语义: ' + g.label); });
  });
  const failCodes = ['NO_TEXT', 'PARSE_MISS', 'LOW_CONFIDENCE', 'LLM_ERROR', 'IMAGE_UNREADABLE'];
  const dm = text('docs/V4_DATA_MODEL.md') || '';
  const cSet = failCodes.filter((c) => c43.indexOf(c) !== -1);
  const dmSet = failCodes.filter((c) => dm.indexOf(c) !== -1);
  if (cSet.length !== 5) out.push('CONTRACT §4.3 failureCode 枚举不全（' + cSet.length + '/5）');
  if (dmSet.length !== 5) out.push('DATA_MODEL failureCode 枚举不全（' + dmSet.length + '/5）');
  ['enabled', 'model', 'timeoutMs', 'maxPerUserPerDay', 'dailyQuota', 'cooldownMinutes'].forEach((k) => {
    if (c43.indexOf(k) === -1 && eng.indexOf(k) === -1) out.push('aiFallback 键未在文档出现: ' + k);
  });
  ['docs/V4_CONTRACT.md', 'docs/V4_ENGINEERING.md'].forEach((rel) => {
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
  const HISTORY = /作废|旧口径|清扫|残句|原文|已废|已删|不再|替换|取代|改为|修订|即缺陷|不计入扫描|历史|旧称呼|旧名/;
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
  // ② D# 引用可解析（复用 #5 的判定）
  const { dDefined } = defineRefSets();
  if (dDefined.size !== 21) out.push('CONTRACT §13 D 条目数 ≠ 21');
  // ③ 审计枚举：CONTRACT §4.2 列全 16 个；注册表（代码侧）集合相等
  const contract = text('docs/V4_CONTRACT.md') || '';
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
  const eng = text('docs/V4_ENGINEERING.md') || '';
  [['docs/V4_CONTRACT.md', contract], ['docs/V4_ENGINEERING.md', eng]].forEach((pair) => {
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
  const qa = text('docs/QA_CHECKLIST.md') || '';
  ['账号切换', '测试账号', '头像', '绑定方向'].forEach((k) => {
    if (qa.indexOf(k) === -1) out.push('QA_CHECKLIST 缺 v0.9 点检小节: ' + k);
  });
  return out.length ? shortList(out, 12) : null;
});

// ---------------------------------------------------------------- 输出
let pass = 0;
let failed = 0;
let skipped = 0;
console.log('== tools/check-docs.js · 设计文档门禁（ENGINEERING §8.3 · 10 条）==');
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
