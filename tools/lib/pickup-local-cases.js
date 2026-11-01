'use strict';
/**
 * tools/lib/pickup-local-cases.js — selftest-order-customer 的 D57「我的取件码（本机）」用例集（拆分子文件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-customer.js 已 981/1000（TD-088 贴边），
 *   主套件只保留 §P 一行接线；宽口径纯件断言与页面/零件静态扫描放本文件。
 * 口径：D57（CONTRACT §5.6 v1.8 / §13）——本机清单只存顾客本人设备（`ex_college_v4.pickcodes`，
 *   utils/storage 单写口），零上传 / 零 wx.cloud / 零第三方 AI 外呼（端侧 OCR）、单测不 mock wx；
 *   兼职与后台（含只读视角）不可见；READONLY 不渲染且拒绝写；上限 50；清空需二次确认。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
const textOf = function textOf(rel) { return fsutil.readText(path.join(ROOT, rel)); };

const localView = require(path.join(ROOT, 'pkg-customer/pages/pickup-list/parts/local-view.js'));
const localOcr = require(path.join(ROOT, 'pkg-customer/pages/pickup-list/parts/local-ocr.js'));
const ocr = require(path.join(ROOT, 'utils/ocr/index.js'));

const PAGE_JS = 'pkg-customer/pages/pickup-list/index.js';
const PAGE_WXML = 'pkg-customer/pages/pickup-list/index.wxml';
const LOCAL_OCR = 'pkg-customer/pages/pickup-list/parts/local-ocr.js';

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
}

module.exports = { leakHits, missingHandlers, registerP };
