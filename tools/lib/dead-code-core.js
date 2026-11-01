'use strict';
/**
 * tools/lib/dead-code-core.js — 死代码扫描共享上下文（仓库遍历/文件分类/基线装载/短清单；批 T5-C 从 tools/lib/dead-code.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2 #35/#36；批 T5-C 从 tools/lib/dead-code.js 逐字搬移（判据/扫描范围零变更）。
 */
const path = require('path');
const F = require('./fsutil');

const ROOT = F.ROOT;

const BASELINE_REL = 'tools/dead-export-baseline.json';
const SKIP = new Set(['.git', 'node_modules', 'miniprogram_npm', '.dsh-code-index', 'docs']);
// wxml 供 #36 事件绑定判定；json 供 #36 组件 selectComponent 选择器 → usingComponents 解析
const TEXT_EXTS = new Set(['.js', '.wxml', '.json']);
// #35 导出扫描范围 = 小程序生产源码（云端 `shared/` 是生成副本，只作生产引用计数、不重复登记）
const EXPORT_DIRS = [
  'api/', 'components/', 'config/', 'custom-tab-bar/', 'pages/',
  'pkg-admin/', 'pkg-customer/', 'pkg-partner/', 'shared/', 'store/', 'utils/'
];
// #36 扫描范围 = tools/lib/project.js ALL_PAGES（含 depth-2 主包页）+ components/<name>/；不写死目录数。
const REASONS = new Set(['history', 'test-only', 'contract-slot']);
// 平台/框架保留键：由运行时调用，静止扫描不出显式引用，不是死函数
const FRAMEWORK_KEYS = new Set([
  'Page', 'Component', 'Behavior', 'App', 'data', 'properties', 'options', 'observers', 'methods',
  'lifetimes', 'pageLifetimes', 'behaviors', 'externalClasses', 'relations', 'export'
]);
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onPageScroll', 'onResize', 'onTabItemTap', 'onAddToFavorites',
  'onSaveExitState', 'onLaunch', 'onError', 'onPageNotFound', 'onThemeChange',
  'created', 'attached', 'ready', 'moved', 'detached', 'error'
]);

function walkRepo() {
  const rels = F.walk(ROOT, { exts: TEXT_EXTS, skip: SKIP }).map((f) => F.rel(f));
  const text = {};
  const stripped = {};
  rels.forEach((rel) => {
    const raw = F.readText(path.join(ROOT, rel));
    text[rel] = raw;
    stripped[rel] = rel.endsWith('.js') ? F.stripComments(raw) : raw;
  });
  return { rels, text, stripped };
}

function isSource(rel) {
  return rel.endsWith('.js') && EXPORT_DIRS.some((dir) => rel.startsWith(dir) && rel.indexOf('/') !== -1);
}

function isTestFile(rel) {
  return rel.startsWith('tools/');
}

/** 云函数 shared/ 副本是 tools/sync-cloud-shared.js 生成的同源副本：不重复计为"生产消费"，避免自我引用掩盖死导出。 */
function isGeneratedCopy(rel) {
  return /^cloudfunctions\/(api|cleanup)\/shared\//.test(rel);
}

function loadBaseline() {
  const full = path.join(ROOT, BASELINE_REL);
  if (!F.isFile(full)) {
    return { errors: ['基线缺失: ' + BASELINE_REL], deadExports: new Map(), pageDeadFunctions: new Map() };
  }
  let json;
  try {
    json = JSON.parse(F.readText(full));
  } catch (e) {
    return { errors: ['基线不可解析: ' + BASELINE_REL + ' · ' + e.message], deadExports: new Map(), pageDeadFunctions: new Map() };
  }
  const errors = [];
  const deadExports = new Map();
  const pageDeadFunctions = new Map();
  const collect = (list, kind, target) => {
    if (!Array.isArray(list)) { errors.push('基线缺 ' + kind + ' 数组'); return; }
    list.forEach((item, i) => {
      const where = BASELINE_REL + ' ' + kind + '[' + i + ']';
      if (!item || typeof item.file !== 'string' || item.file === '') { errors.push(where + ' 缺 file'); return; }
      const symbol = kind === 'deadExports' ? item.symbol : item.function;
      if (typeof symbol !== 'string' || symbol === '') { errors.push(where + ' 缺 ' + (kind === 'deadExports' ? 'symbol' : 'function')); return; }
      if (!REASONS.has(item.reason)) { errors.push(where + ' 理由分类非法: ' + JSON.stringify(item.reason)); return; }
      const key = item.file + '#' + symbol;
      if (target.has(key)) { errors.push(where + ' 重复登记: ' + key); return; }
      target.set(key, item);
    });
  };
  collect(json.deadExports, 'deadExports', deadExports);
  collect(json.pageDeadFunctions, 'pageDeadFunctions', pageDeadFunctions);
  return { errors, deadExports, pageDeadFunctions };
}

function shortList(items, limit) {
  const lim = limit || 24;
  return items.slice(0, lim).concat(items.length > lim ? ['…（共 ' + items.length + ' 项）'] : []);
}

module.exports = {
  BASELINE_REL,
  REASONS,
  LIFECYCLE,
  FRAMEWORK_KEYS,
  walkRepo,
  isSource,
  isTestFile,
  isGeneratedCopy,
  loadBaseline,
  shortList
};
