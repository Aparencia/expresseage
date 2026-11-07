'use strict';
/**
 * tools/lib/pickup-local-cases.js — selftest-order-customer 的 D57「我的取件码（本机）」+ D64「取件码一级入口」用例集（拆分子文件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-customer.js 已满闸（TD-088 贴边），
 *   主套件只保留 §P 一行接线；宽口径纯件断言与页面/零件静态扫描放本文件。
 * 口径：D57（CONTRACT §5.6 v1.8 / §13）——本机清单只存顾客本人设备（`ex_college_v4.pickcodes`，
 *   utils/storage 单写口），零上传 / 零 wx.cloud / 零第三方 AI 外呼（端侧 OCR）、单测不 mock wx；
 *   兼职与后台（含只读视角）不可见；READONLY 不渲染且拒绝写；上限 50；清空需二次确认。
 *   D64（CONTRACT §7/§13，2026-11-02）——页面迁主包为 `pages/customer/pickcodes/index`（伪 tab，
 *   app.json tabBar.list 仍 5 项）；只显示本机取件码、**删除 D26 订单区**；首页入口卡删除；本页禁分享；
 *   底部栏视觉抽为 `components/tab-bar-view`（custom-tab-bar 薄包装 + 页面内自绘 4 格）。
 */
const path = require('path');
const fs = require('fs');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
const textOf = function textOf(rel) { return fsutil.readText(path.join(ROOT, rel)); };
const jsonOf = function jsonOf(rel) {
  try {
    return JSON.parse(textOf(rel));
  } catch (err) {
    return null;
  }
};

const localView = require(path.join(ROOT, 'pages/customer/pickcodes/parts/local-view.js'));
const localOcr = require(path.join(ROOT, 'pages/customer/pickcodes/parts/local-ocr.js'));
const ocr = require(path.join(ROOT, 'utils/ocr/index.js'));
const project = require('./project');
const sharePages = require('./share-pages');

const PAGE_JS = 'pages/customer/pickcodes/index.js';
const PAGE_WXML = 'pages/customer/pickcodes/index.wxml';
const PAGE_JSON = 'pages/customer/pickcodes/index.json';
const PAGE_WXSS = 'pages/customer/pickcodes/index.wxss';
const LOCAL_OCR = 'pages/customer/pickcodes/parts/local-ocr.js';
const TAB_DATA = 'components/tab-bar-view/tabs.js';
const TAB_VIEW_WXML = 'components/tab-bar-view/index.wxml';
const TAB_VIEW_WXSS = 'components/tab-bar-view/index.wxss';
const CUSTOM_TAB_BAR = 'custom-tab-bar/index.js';
const ICON = 'assets/tabbar/customer-pickcodes.png';
const ICON_ACTIVE = 'assets/tabbar/customer-pickcodes-active.png';

/** 本机清单硬边界扫描：上传/云调用/第三方 AI/平台存储直连 一律 0 命中（剥注释后判） */
function leakHits(code) {
  const src = fsutil.stripComments(String(code || ''));
  const hits = [];
  if (/wx\.cloud\./.test(src)) hits.push('wx.cloud');
  if (/api\/upload/.test(src)) hits.push('api/upload');
  if (/api\/modules\/ai/.test(src)) hits.push('api/modules/ai');
  if (/wx\.\w*Storage/.test(src)) hits.push('wx.*Storage');
  return hits;
}

/** 页面静态事件接线：wxml 里声明的处理器必须在页面脚本里有同名方法（漏一个就点不动） */
function missingHandlers(wxml, pageSrc) {
  const names = [];
  const re = /bind(?:tap|input|change|blur|confirm)="([A-Za-z0-9_]+)"/g;
  let match = re.exec(wxml);
  while (match) {
    if (names.indexOf(match[1]) < 0) names.push(match[1]);
    match = re.exec(wxml);
  }
  return names.filter(function absent(name) {
    return !new RegExp('\\b' + name + '\\s*\\(').test(pageSrc);
  });
}

/** PNG 头：签名 + 宽高（D64 图标必须自制 81×81，与既有 tabbar 图标一致） */
function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return {
    signatureOk: buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length
  };
}

function registerP(t) {
  const NOW = Date.parse('2026-11-01T12:00:00+08:00');
  const items = [
    { code: '8-2-3021', stationId: 'P3', stationName: '菜鸟驿站-3号楼', checked: true, addedAt: NOW - 30 * 1000 },
    { code: 'A1B2C3', stationId: '', stationName: '', checked: false, addedAt: NOW - 3 * 60 * 60 * 1000 }
  ];
  const rows = localView.rowsOf(items, NOW);

  // ── 纯件：行映射 / 时间文案 / 汇总 / 空态 / 上限提示 ──────────────────────
  t.eq([rows[0].code, rows[0].stationText, rows[0].checkedText], ['8-2-3021', '菜鸟驿站-3号楼', '已取到'],
    'P1 行映射：码 / 站点名 / 勾选文案（存储条目 → 行视图）');
  t.eq([rows[1].stationText, rows[1].checked, rows[1].checkedText], ['未识别站点', false, '未取到'],
    'P2 站点缺失回退「未识别站点」、未勾选文案「未取到」');
  t.eq([rows[0].timeText, rows[1].timeText], ['刚刚', '3 小时前'],
    'P3 添加时间人话：<1 分钟「刚刚」、小时粒度「N 小时前」');
  t.eq([localView.rowsOf([{ code: 'M1', addedAt: NOW - 5 * 60 * 1000 }], NOW)[0].timeText,
    localView.rowsOf([{ code: 'M2', addedAt: Date.parse('2026-10-01T08:00:00+08:00') }], NOW)[0].timeText],
  ['5 分钟前', '10月1日'],
  'P4 时间边界：分钟粒度与跨天日期文案（经 rowsOf 断言，now 由调用方给）');
  t.eq(localView.summaryOf(items), { total: 2, checked: 1, pending: 1 },
    'P5 汇总：总数 / 已取到 / 未取到');
  t.eq([localView.rowsOf([]), localView.summaryOf([])], [[], { total: 0, checked: 0, pending: 0 }],
    'P6 空态：无条目 rowsOf 为空、summary 全 0（页面据此出空态文案）');
  t.eq(localView.limitHintOf({ ok: true, added: 1, skipped: 0, items: [{ code: 'X1' }] }, 0, 1, 50), '',
    'P7 未到上限不提示（合法基线，避免满屏「最多 50 条」）');
  const overflow = localView.limitHintOf(
    { ok: true, added: 50, skipped: 0, items: new Array(50).fill({ code: 'X1' }) }, 0, 60, 50);
  t.check(overflow.indexOf('50') >= 0 && overflow.indexOf('10') >= 0 && overflow.indexOf('清掉') >= 0,
    'P8 60 条 → 实际 50 条：提示说清上限与被挤掉条数（不谎报全部存下）');
  t.eq([localView.addedTipOf({ ok: true, added: 2, skipped: 0 }),
    localView.addedTipOf({ ok: true, added: 0, skipped: 3 })],
  ['已添加 2 条', '这些码已经在清单里了'],
  'P9 添加结果人话：新增条数 / 全是重复时不说「已添加」');
  t.eq([localView.READONLY_HINT.indexOf('本人手机') >= 0, localView.READONLY_COPY.indexOf('只读') >= 0,
    localView.TIP_TEXT.indexOf('不上传') >= 0, localView.TIP_TEXT.indexOf('换手机或清缓存会丢失') >= 0],
  [true, true, true, true],
  'P10 固定文案单源：只读解释 / 只读拒绝语 / 本机说明含「不上传」「换手机或清缓存会丢失」');

  // ── 页面与零件静态接线：零上传 / 零 wx.cloud / 零第三方 AI / 零平台存储直连 ──
  const pageSrc = textOf(PAGE_JS);
  const wxml = textOf(PAGE_WXML);
  const ocrSrc = textOf(LOCAL_OCR);
  const REQUIRED = ['utils/storage', './parts/local-view', './parts/local-ocr',
    'utils/recognize/local-codes', 'api/modules/config'];
  t.check(REQUIRED.every(function has(id) { return pageSrc.indexOf(id) >= 0; }),
    'P11 页面接线：storage（单写口）/ local-view（纯件）/ local-ocr（端侧识别）/ local-codes（解析）/ config（站点单源）');
  t.eq(leakHits(pageSrc), [], 'P12 页面零 wx.cloud / 零 api/upload / 零 api/modules/ai / 零 wx.*Storage（README：本机清单不上传）');
  t.eq(leakHits("wx.cloud.callFunction({}); require('../../../api/upload');"
    + " require('../../../api/modules/ai'); wx.getStorageSync('x');"),
  ['wx.cloud', 'api/upload', 'api/modules/ai', 'wx.*Storage'],
  'P13 P12 扫具有牙正控：合成泄漏片段四类全命中（不是恒真空集）');
  t.eq(leakHits(ocrSrc), [], 'P14 local-ocr 零泄漏：截图识别只走端侧（不上传、不 wx.cloud、不外呼 AI、不直连存储）');
  t.check(ocrSrc.indexOf("utils/ocr/wx-platform") >= 0 && ocrSrc.indexOf("utils/ocr/index") >= 0
    && /wx\.chooseMedia\s*\(/.test(ocrSrc) && /MAX_IMAGES\s*=\s*9/.test(ocrSrc)
    && /platform\.hasVision\(\)/.test(ocrSrc),
  'P15 local-ocr 平台适配单源 utils/ocr/wx-platform + 选图 wx.chooseMedia（≤9 张）+ 不支持先拦');
  t.eq(localOcr.failureCopyOf('NO_TEXT'), ocr.failureCopy('NO_TEXT'),
    'P16 无命中/识别失败复用 utils/ocr failureCopy 口径（页面不另拼文案）');
  t.check(/storage\.LOCAL_CODE_MAX/.test(pageSrc) && /\{\{localSummary\.total\}\}\/\{\{localMax\}\}/.test(wxml),
    'P17 上限常量引用 storage.LOCAL_CODE_MAX（不在页面写死 50），wxml 展示已存/上限');
  t.check(wxml.indexOf('我的取件码（本机）') >= 0 && wxml.indexOf('{{localTip}}') >= 0
    && wxml.indexOf('{{localEmptyText}}') >= 0 && wxml.indexOf('清空') >= 0
    && localView.TIP_TEXT.indexOf('不上传') >= 0 && localView.TIP_TEXT.indexOf('换手机或清缓存会丢失') >= 0,
  'P18 wxml 本机区标题/固定说明/空态与一键清空：文案单源由页面注入（wxml 不硬编码重复副本）');
  t.check(/wx:if="\{\{!readonly\}\}"/.test(wxml) && wxml.indexOf('{{localReadonlyHint}}') >= 0
    && localView.READONLY_HINT.indexOf('只读视角看不到') >= 0,
  'P19 READONLY 会话不渲染本机交互区，只留只读说明（文案常量同样单源）');
  const guarded = (pageSrc.match(/if \(!this\.canWriteLocal\(\)\) return;/g) || []).length;
  t.check(/loadLocal\(readonly\)/.test(pageSrc) && /if \(!this\.canWriteLocal\(\)\) return;/.test(pageSrc)
    && guarded >= 5 && pageSrc.indexOf('READONLY') >= 0,
  'P20 页面 READONLY 实现：onShow 传只读态 loadLocal、6 个写动作前 canWriteLocal 守卫');
  const missing = missingHandlers(wxml, pageSrc);
  t.eq(missing, [], 'P21 wxml 全部 bindtap/bindinput 处理器在页面脚本中存在（删除/清空/复制/勾选都点得动）');
  t.check(pageSrc.indexOf('localNoMatchText') >= 0 && pageSrc.indexOf('localView.addedTipOf') >= 0
    && pageSrc.indexOf('localView.limitHintOf') >= 0 && /parseCodeText/.test(pageSrc)
    && /mergeEntries/.test(pageSrc),
  'P22 解析/去重/结果人话链路：parseCodeText → mergeEntries → addLocalCodes，无命中给「没认出取件码」');
  const INTERNAL_ONLY = ['stationTextOf', 'timeTextOf', 'checkedTextOf', 'isEmptyOf', 'STATION_FALLBACK'];
  t.check(INTERNAL_ONLY.every(function hidden(name) { return localView[name] === undefined; })
    && /localView\.TIP_TEXT/.test(pageSrc) && /localView\.READONLY_HINT/.test(pageSrc)
    && /localView\.EMPTY_TEXT/.test(pageSrc) && /this\.data\.localNoMatchText/.test(pageSrc),
  'P23 文案常量由页面 setData 注入 wxml 消费；纯辅助函数不导出（门禁 #35：新增导出必须有生产调用）');

  // ── D64：页面迁主包 + 伪 tab + 删 D26 订单区 + 共用底部栏 + 禁分享 ──────────
  const FOUR = [PAGE_JS, PAGE_JSON, PAGE_WXML, PAGE_WXSS];
  t.eq(FOUR.filter(function empty(rel) { return !textOf(rel); }), [],
    'P24 D64 新页四件套齐全且非空（主包 pages/customer/pickcodes）');
  const pageJson = jsonOf(PAGE_JSON) || {};
  t.eq([pageJson.navigationBarTitleText, pageJson.enablePullDownRefresh], ['我的取件码', true],
    'P25 D64 页标题「我的取件码」+ enablePullDownRefresh（原页有 onPullDownRefresh，D65 开关对齐）');
  t.check(/^<view class="page-body page-body--tab"/.test(wxml.trim()) && /<switch-bar\s*\/>/.test(wxml),
    'P26 D64 伪 tab 页根节点 page-body page-body--tab（D65 底部安全区）+ 顶部 switch-bar');
  const ORDER_REGION = ['orderApi', 'listCustomer', 'pickupChecks', '复制全部', '本单全部勾选',
    '需查明', 'groupByOrder', '进行中订单'];
  t.eq(ORDER_REGION.filter(function present(token) {
    return pageSrc.indexOf(token) >= 0 || wxml.indexOf(token) >= 0;
  }), [], 'P27 D64 已删 D26 订单区：页面零订单接口 / 本机勾选 / 复制全部 / 需查明 / 按订单分组残留');
  t.check(!/onShareAppMessage|onShareTimeline/.test(pageSrc)
    && sharePages.APP_MESSAGE.every(function notShared(rel) { return rel.indexOf('pickcodes') === -1; }),
  'P28 D64 本页不提供分享/转发（无分享钩子、不在 D36 好友转发清单）');
  const appJson = jsonOf('app.json') || {};
  const mainPages = appJson.pages || [];
  const pkgCustomer = (appJson.subPackages || []).filter(function byRoot(sub) {
    return sub && sub.root === 'pkg-customer';
  })[0] || {};
  const subPages = (appJson.subPackages || []).reduce(function flat(list, sub) {
    return list.concat((sub && sub.pages) || []);
  }, []);
  // 页数口径动态取（单源 tools/lib/project.js ALL_PAGES），不写死数字：新增页只改 project.js
  //   与 app.json 两处，本组断言自动跟随；仍保留「app.json ⇄ project.js 对帐」的牙。
  const appTotal = mainPages.length + subPages.length;
  t.eq([mainPages.indexOf('pages/customer/pickcodes/index') >= 0,
    (pkgCustomer.pages || []).indexOf('pages/pickup-list/index') === -1,
    appTotal, ((appJson.tabBar || {}).list || []).length],
  [true, true, project.ALL_PAGES.length, 5],
  'P29 app.json：主包新增取件码页 / 分包移除 pickup-list / 总页数＝ALL_PAGES 动态对帐（'
    + project.ALL_PAGES.length + ' 页）/ tabBar.list 仍 5 项');
  t.eq([project.MAIN_PAGES.indexOf('pages/customer/pickcodes/index') >= 0,
    project.SUBPACKAGES['pkg-customer'].indexOf('pages/pickup-list/index') === -1,
    project.ALL_PAGES.length, new Set(project.ALL_PAGES).size],
  [true, true, appTotal, appTotal],
  'P30 tools/lib/project.js 镜像同步（主包新增 / 分包移除 / ALL_PAGES＝app.json 页数 '
    + appTotal + ' 页动态对帐、无重复路径）');
  const tabsData = require(path.join(ROOT, TAB_DATA));
  const customerTabs = tabsData.CUSTOMER_TABS || [];
  t.eq([customerTabs.length, customerTabs.map(function text(tab) { return tab.text; }),
    customerTabs[2] && customerTabs[2].pseudoTab, customerTabs[3] && customerTabs[3].pagePath,
    (tabsData.PARTNER_TABS || []).length],
  [4, ['首页', '订单', '取件码', '我的'], true, 'pages/profile/index', 3],
  'P31 底部栏数据单源：顾客 4 格（首页/订单/取件码/我的，取件码=伪 tab 第 3 格）+ 兼职 3 格');
  const barSrc = textOf(CUSTOM_TAB_BAR);
  t.check(barSrc.indexOf('tab-bar-view/tabs') >= 0 && barSrc.indexOf('CUSTOMER_TABS') >= 0
    && textOf('custom-tab-bar/index.wxml').indexOf('<tab-bar-view') >= 0,
  'P32 custom-tab-bar 与伪 tab 页共用同一份 tabs 数据 + 视觉组件（custom-tab-bar 只是薄包装）');
  t.check(/pseudoTab === true/.test(barSrc) && /wx\.reLaunch\(\{ url: '\/' \+ tab\.pagePath \}\)/.test(barSrc)
    && /wx\.switchTab\(\{ url: '\/' \+ tab\.pagePath \}\)/.test(barSrc),
  'P33 custom-tab-bar 跳转：伪 tab（不在 tabBar.list）用 reLaunch、真 tab 用 switchTab（D64 平台约束）');
  t.check(/<tab-bar-view/.test(wxml) && /bind:tabtap="onTabTap"/.test(wxml)
    && /wx\.switchTab\(\{ url: '\/' \+ tab\.pagePath \}\)/.test(pageSrc)
    && /tabSelected: TAB_INDEX/.test(pageSrc),
  'P34 伪 tab 页自绘共用底部栏且选中态=第 3 格，跳真 tab 走 wx.switchTab');
  const tabViewWxml = textOf(TAB_VIEW_WXML);
  const tabViewWxss = textOf(TAB_VIEW_WXSS);
  t.check(tabViewWxml.indexOf('tab-text-active') >= 0 && tabViewWxml.indexOf('item.badgeKey') >= 0
    && /position: fixed/.test(tabViewWxss) && /env\(safe-area-inset-bottom\)/.test(tabViewWxss),
  'P35 共用底部栏视觉：选中态/角标渲染 + fixed 底栏带 safe-area（D65）');
  const normalIcon = pngSize(ICON);
  const activeIcon = pngSize(ICON_ACTIVE);
  t.eq([normalIcon.signatureOk, normalIcon.width, normalIcon.height,
    activeIcon.signatureOk, activeIcon.width, activeIcon.height,
    normalIcon.bytes > 100 && activeIcon.bytes > 100,
    customerTabs[2] && customerTabs[2].icon, customerTabs[2] && customerTabs[2].activeIcon],
  [true, 81, 81, true, 81, 81, true, '/' + ICON, '/' + ICON_ACTIVE],
  'P36 D64 自制取件码 tabbar 图标：普通/选中均 81×81 PNG 且由数据单源引用');
  const homeWxml = textOf('pages/customer/home/index.wxml');
  const homeSrc = textOf('pages/customer/home/index.js');
  t.check(homeWxml.indexOf('pickup-entry') === -1 && homeWxml.indexOf('bindtap="onPickupListTap"') === -1
    && homeSrc.indexOf('PICKUP_LIST_PAGE') === -1 && homeSrc.indexOf('onPickupListTap') === -1
    && /^<view class="page-body page-body--tab"/.test(homeWxml.trim()),
  'P37 D64 首页原「取件清单」入口卡已删（卡片/处理器/路由常量零残留）+ 首页 tab 页根 class 含 page-body--tab');
  t.eq([homeWxml.indexOf('还没有进行中的订单，点「下单」上传取件码或手填。') >= 0,
    homeWxml.indexOf("'下单'") >= 0 && homeWxml.indexOf('上传取件码截图下单') === -1],
  [true, true], 'P38 D66 首页空态与主 CTA 文案统一为「下单」表述（去掉「上传截图」前置）');
  t.check(textOf('pages/role/index.wxml').indexOf('下单后请兼职代取，送到宿舍。') >= 0
    && textOf('pkg-customer/pages/help/index.js').indexOf('顾客下单，兼职接单、取件、送达') >= 0,
  'P39 D66 角色页副标题 + 帮助页首段同步「下单」表述（功能/链路不变）');
}

module.exports = { pngSize, registerP };
