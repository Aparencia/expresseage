'use strict';
/**
 * tools/lib/check-layout.js — D65 全局底部安全区/滚动修复的三条机械门禁（#37/#38/#39）
 * 口径：docs/contract/V4_CONTRACT.md §13 D65；docs/engineering/V4_ARCHITECTURE.md §3.5；
 *       docs/engineering/V4_ENGINEERING.md §8.2 #37~#39（判据表同步新增，本文件只实现判据体）。
 *
 * #37 tab 页根 class 含 page-body--tab：tab 页集合 = app.json tabBar.list + D64 伪 tab 页常量；
 *     伪 tab 页尚未创建时跳过该页（不误红），创建后自动纳入。
 * #38 wxss 中 position:fixed 且 bottom:0 的规则必须含 env(safe-area-inset-bottom) 或全局 token
 *     （var(--v4-*)）；存量「全屏居中遮罩」逐条登记 tools/lib/bottom-safe-baseline.json——
 *     禁止目录豁免、空集判红、基线失效（规则已修复/改名后条目未删）同样判红。
 * #39 页面 js 有 onPullDownRefresh ⇔ json enablePullDownRefresh:true（双向判红，剥注释后扫描）。
 *
 * 导出三个判据函数（返回 null / 问题数组 / { skip }，由 tools/check.js 装配）+ 供 selftest-tools
 * 合成用例复用的纯扫描函数（不读盘）。
 */
const path = require('path');
const F = require('./fsutil');
const { ROOT, RELS, PAGE_SCOPES, text, shortList } = require('./check-helpers');

/** D64：伪 tab 页（不在 tabBar.list，但视觉/底垫与真 tab 页同级）。 */
const PSEUDO_TAB_PAGES = ['pages/customer/pickcodes/index'];
/** 门禁 #38 存量基线：路径固定 + reason 枚举（只认「全屏居中遮罩」一类合法例外）。 */
const BOTTOM_SAFE_BASELINE = 'tools/lib/bottom-safe-baseline.json';
const BASELINE_REASONS = ['fullscreen-overlay-centered'];

/** 取 wxml 根节点 <view> 的 class 值（先剥注释）；根不是 view/无 class 返回 null。 */
function rootClassOf(wxml) {
  const stripped = String(wxml || '').replace(/<!--[\s\S]*?-->/g, '');
  const m = stripped.match(/^\s*<view\b[^>]*?\bclass\s*=\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/** 扁平 WXSS 规则（剥注释；@keyframes 内层各自成条，不影响 fixed+bottom 判定）。 */
function wxssRules(css) {
  const out = [];
  const stripped = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

/** 规则体是否「固定贴在屏底」：position:fixed + bottom:0（0/0rpx/0px）。 */
function isFixedBottomZero(body) {
  const fixed = /(?:^|[;\s])position\s*:\s*fixed\b/.test(body);
  const bottom = /(?:^|[;\s])bottom\s*:\s*0(?:rpx|px)?\s*(?:;|$)/.test(body);
  return fixed && bottom;
}

/** 规则体是否自带安全区底垫或显式引用全局 token（--v4-*）。 */
function hasSafeBottom(body) {
  return /env\(\s*safe-area-inset-bottom\s*\)/.test(body) || /var\(\s*--v4-/.test(body);
}

/** 校验 #38 基线结构：file+selector+合法 reason、无重复、非空集。 */
function validateBaseline(data) {
  const problems = [];
  const entries = [];
  const list = data && Array.isArray(data.entries) ? data.entries : [];
  const seen = new Set();
  list.forEach((item, i) => {
    const where = BOTTOM_SAFE_BASELINE + '[' + i + ']';
    if (!item || typeof item !== 'object') { problems.push(where + ': 不是对象'); return; }
    if (typeof item.file !== 'string' || !item.file) problems.push(where + ': 缺 file');
    if (typeof item.selector !== 'string' || !item.selector) problems.push(where + ': 缺 selector');
    if (BASELINE_REASONS.indexOf(item.reason) === -1) {
      problems.push(where + ': reason 不在枚举 ' + BASELINE_REASONS.join('/'));
    }
    const key = item.file + '::' + item.selector;
    if (seen.has(key)) problems.push(where + ': 重复登记 ' + key);
    seen.add(key);
    entries.push({ file: item.file, selector: item.selector, key: key });
  });
  if (list.length === 0) {
    problems.push(BOTTOM_SAFE_BASELINE + ': 空基线（只允许逐条登记全屏遮罩，不允许空集/目录豁免）');
  }
  return { entries: entries, problems: problems };
}

/**
 * #38 纯扫描（合成用例可复用）：files = {rel: css}，baselineEntries = validateBaseline 结果。
 * 返回 { offenders, stale, fixedBottomRules, scanned }——fixedBottomRules 为 0 说明扫描器失效。
 */
function scanFixedBottomSafe(files, baselineEntries) {
  const known = new Set((baselineEntries || []).map((e) => e.key || (e.file + '::' + e.selector)));
  const used = new Set();
  const offenders = [];
  let fixedBottomRules = 0;
  Object.keys(files).sort().forEach((rel) => {
    wxssRules(files[rel]).forEach((rule) => {
      if (!isFixedBottomZero(rule.body)) return;
      fixedBottomRules += 1;
      const key = rel + '::' + rule.selector;
      if (hasSafeBottom(rule.body)) return;
      if (known.has(key)) { used.add(key); return; }
      offenders.push(key);
    });
  });
  return {
    offenders: offenders,
    stale: Array.from(known).filter((key) => !used.has(key)),
    fixedBottomRules: fixedBottomRules,
    scanned: Object.keys(files).length
  };
}

/** #37 纯判定：pages = [{ page, wxml }]（wxml 为 null 表示文件不存在 → 记 absent）。 */
function scanTabPageRoots(pages) {
  const bad = [];
  const absent = [];
  pages.forEach((item) => {
    if (item.wxml === null || item.wxml === undefined) { absent.push(item.page); return; }
    const cls = rootClassOf(item.wxml);
    if (cls === null) { bad.push(item.page + ': 根节点不是 <view class="...">，无法判定'); return; }
    if (cls.split(/\s+/).indexOf('page-body--tab') === -1) {
      bad.push(item.page + ': 根 class 缺 page-body--tab（当前 "' + cls + '"）');
    }
  });
  return { bad: bad, absent: absent };
}

/** #39 纯判定：pages = [{ page, js, json }]（js 原文、json 解析结果或 null）。 */
function scanPullDown(pages) {
  const issues = [];
  let handlers = 0;
  pages.forEach((item) => {
    const jsText = F.stripComments(String(item.js || ''));
    const hasHandler = /onPullDownRefresh\s*\(/.test(jsText);
    if (hasHandler) handlers += 1;
    const flagged = !!(item.json && item.json.enablePullDownRefresh === true);
    if (hasHandler && !flagged) {
      issues.push(item.page + ': js 有 onPullDownRefresh 但 json 未开 enablePullDownRefresh:true（下拉无响应）');
    }
    if (!hasHandler && flagged) {
      issues.push(item.page + ': json 开了 enablePullDownRefresh:true 但 js 无 onPullDownRefresh（下拉空转）');
    }
  });
  return { issues: issues, handlers: handlers };
}

/** 全仓真实页面（以磁盘 index.js 为准，避免 project.js 并行改动造成滞后）。 */
function diskPages() {
  return RELS.filter((r) => PAGE_SCOPES.some((p) => r.startsWith(p)) && /\/index\.js$/.test(r))
    .map((r) => r.slice(0, -3));
}

// ---------------------------------------------------------------- #37
function tabPageRootTabClass() {
  let app;
  try {
    app = F.readJson(path.join(ROOT, 'app.json'));
  } catch (e) {
    return ['app.json 缺失/不可解析: ' + e.message];
  }
  const list = ((app.tabBar || {}).list || []).map((x) => x.pagePath).filter(Boolean);
  if (list.length === 0) return ['tabBar.list 为空（空集不得判绿）'];
  const pages = list.concat(PSEUDO_TAB_PAGES).map((page) => ({ page: page, wxml: text(page + '.wxml') }));
  const scan = scanTabPageRoots(pages);
  if (scan.bad.length) return shortList(scan.bad, 12);
  if (scan.absent.length) {
    return { skip: 'D64 伪 tab 页尚未创建：' + scan.absent.join(', ') + '（创建后自动纳入本判据）' };
  }
  return null;
}

// ---------------------------------------------------------------- #38
function fixedBottomSafeArea() {
  const files = {};
  RELS.filter((r) => r.endsWith('.wxss')).forEach((r) => { files[r] = text(r) || ''; });
  if (Object.keys(files).length === 0) return ['WXSS 样本为空（空集不得判绿）'];
  let data;
  try {
    data = F.readJson(path.join(ROOT, BOTTOM_SAFE_BASELINE));
  } catch (e) {
    return [BOTTOM_SAFE_BASELINE + ' 缺失/不可解析: ' + e.message];
  }
  const base = validateBaseline(data);
  const scan = scanFixedBottomSafe(files, base.entries);
  const out = base.problems.slice();
  scan.offenders.forEach((key) => out.push(
    '固定底条缺安全区底垫: ' + key + '（须含 env(safe-area-inset-bottom) 或 var(--v4-*)；全屏遮罩走基线逐条登记）'
  ));
  scan.stale.forEach((key) => out.push('基线失效（规则已修复/改名，须删该条）: ' + key));
  if (scan.fixedBottomRules === 0) out.push('全仓未扫描到任何 position:fixed + bottom:0 规则（扫描器失效，空集不得判绿）');
  return out.length ? shortList(out, 12) : null;
}

// ---------------------------------------------------------------- #39
function pullDownRefreshAligned() {
  const pages = diskPages();
  if (pages.length === 0) return ['页面样本为空（空集不得判绿）'];
  const items = [];
  const out = [];
  pages.forEach((page) => {
    let json = null;
    try {
      json = F.readJson(path.join(ROOT, page + '.json'));
    } catch (e) {
      out.push(page + '.json 缺失/不可解析: ' + e.message);
    }
    items.push({ page: page, js: text(page + '.js') || '', json: json });
  });
  const scan = scanPullDown(items);
  const all = out.concat(scan.issues);
  if (scan.handlers === 0) all.push('全仓没有页面声明 onPullDownRefresh（扫描器失效，空集不得判绿）');
  return all.length ? shortList(all, 12) : null;
}

module.exports = {
  PSEUDO_TAB_PAGES,
  BOTTOM_SAFE_BASELINE,
  BASELINE_REASONS,
  rootClassOf,
  wxssRules,
  isFixedBottomZero,
  hasSafeBottom,
  validateBaseline,
  scanFixedBottomSafe,
  scanTabPageRoots,
  scanPullDown,
  tabPageRootTabClass,
  fixedBottomSafeArea,
  pullDownRefreshAligned
};
