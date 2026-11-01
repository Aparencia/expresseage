'use strict';
/**
 * tools/selftest-pick-list.js — 批 17 #7 独立「楼层配送清单」页断言套件（D46；ENGINEERING §8.2 门禁纪律）
 *
 * 覆盖：
 *   A. `shared/zones.floorOf` 纯件（room≥100 → floor(room/100)；非法/越界一律 0；旧 compareDormKey 回归）
 *   B. 苑 → 栋 → 楼层 → roomTag 自然序分组（楼层由 floorOf 派生、组标题/组序/组内序、地址待同步兜底组；
 *      D25 他人配送地址不显示顾客 roomTag）
 *   C. 只含 PICKED（已送达/异常/取消/待接单不显示；数据源=现成 `order.listPartner` workbench 视图，无新动作）
 *   D. 分页/分片 ≤20 行 + 不参与 30s 轮询（无 setInterval/超时轮询；onShow/下拉才刷新）
 *   E. 复制文案只到楼栋级（D48 红线：不含房间号/roomTag/订单号/称呼/尾号/取件码；空清单不复制）
 *   F. 页面静态纪律（零 wx.cloud/random/状态字面量/action 字面量；switch-bar 首子节点；复制接线）
 *   G. 批量送达复用工作台纯件（batchView.plan/run/summary + rowActions.buildWrite）+ READONLY 禁用/TEST_WRITE 提示
 *   H. 注册与文档联动（app.json=32 页、tools/lib/project.js ALL_PAGES=32、CONTRACT §7/ARCHITECTURE/
 *      UX_PARTNER/QA/docs README 页数读数、工作台入口、sync 副本一致）
 *   I. 零金额扫描（新文件 5 件）+ 行数闸（页面/纯件 ≤500、本套件 ≤1000）
 *
 * 纪律：纯件 + 静态接线断言；不 mock 全局 wx、不连网络；先合法基线再反例；样本非空；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-pick-list.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');
const project = require('./lib/project');

const EXPECTED_ASSERTIONS = 116; // 实跑读数：node tools/selftest-pick-list.js

const PAGE_DIR = 'pkg-partner/pages/pick-list';
const FILES = {
  page: PAGE_DIR + '/index.js',
  wxml: PAGE_DIR + '/index.wxml',
  wxss: PAGE_DIR + '/index.wxss',
  json: PAGE_DIR + '/index.json',
  viewModel: PAGE_DIR + '/parts/view-model.js',
};
const CONTRACT = 'docs/contract/V4_CONTRACT.md';
const ARCH = 'docs/engineering/V4_ARCHITECTURE.md';
const UX_PARTNER = 'docs/ux/V4_UX_PARTNER.md';
const QA = 'docs/delivery/V4_QA_CHECKLIST.md';
const DOCS_README = 'docs/README.md';
const ZONES = 'shared/zones.js';

const enums = require(path.join(ROOT, 'shared/enums.js'));
const zones = require(path.join(ROOT, 'shared/zones.js'));

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return '';
  }
}

function linesOf(rel) {
  return fsutil.lineCount(readText(rel));
}

function safeRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (e) {
    return null;
  }
}

const view = safeRequire(FILES.viewModel);

function appPages() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const list = (app.pages || []).slice();
  (app.subPackages || app.subpackages || []).forEach((sub) => {
    (sub.pages || []).forEach((page) => list.push(sub.root + '/' + page));
  });
  return list;
}

function jsonOf(rel) {
  try {
    return JSON.parse(readText(rel));
  } catch (e) {
    return null;
  }
}

// 订单 DTO 夹具（字段形状对齐 order/_dto.buildOrderDto：delivery/dorm/counterpart/service/parcels/actions）
function orderFixture(orderNo, zone, buildingNo, room, options) {
  const opts = options || {};
  const buildingText = zone + buildingNo;
  const dormKey = buildingText + '-' + room;
  return {
    orderNo: orderNo,
    status: opts.status || enums.ORDER_STATUS.PICKED,
    delivery: {
      zone: zone,
      buildingNo: buildingNo,
      buildingText: buildingText,
      room: String(room),
      dormKey: dormKey
    },
    dorm: {
      zone: zone,
      buildingNo: buildingNo,
      buildingText: buildingText,
      room: String(room),
      dormKey: dormKey,
      roomTag: opts.roomTag || ''
    },
    counterpart: { displayName: opts.name || '小王' },
    service: { code: 'PICKUP_STD', name: opts.serviceName || '标准代取' },
    parcels: opts.parcels || [{ pickupCode: opts.pickupCode || '207-3-1014' }],
    actions: opts.actions || ['deliver', 'undoPick', 'exception'],
    version: 3,
    statusUpdatedAt: '2026-11-01T02:00:00.000Z',
    pickedAt: '2026-11-01T02:00:00.000Z'
  };
}

// 楼层分组基准夹具：D4 4/5/10 层、D5 6 层、X2 3 层（覆盖跨苑/跨栋/楼层数值序）
function floorFixtures() {
  return [
    orderFixture('20261101-0001', 'D', 4, 522, { roomTag: 'A' }),
    orderFixture('20261101-0002', 'D', 4, 517, { roomTag: 'B' }),
    orderFixture('20261101-0003', 'D', 4, 508, { roomTag: 'C' }),
    orderFixture('20261101-0004', 'D', 4, 410),
    orderFixture('20261101-0005', 'D', 5, 602),
    orderFixture('20261101-0006', 'X', 2, 301),
    orderFixture('20261101-0007', 'D', 4, 1001),
  ];
}

function groupTitles(groups) {
  return groups.map((group) => group.title);
}

function flattenRows(groups) {
  const out = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.rows || []).forEach((row) => out.push(row));
  });
  return out;
}

function register(h) {
  // ------------------------------------------------------------ A. floorOf 纯件
  h.section('A floorOf 纯件（room≥100 → floor(room/100)；非法 0；compareDormKey 回归）', (t) => {
    t.eq(typeof zones.floorOf, 'function', 'A1 shared/zones 导出 floorOf（新纯件）');
    t.eq(zones.floorOf(522), 5, 'A2 floorOf(522)=5');
    t.eq(zones.floorOf('522'), 5, 'A3 floorOf("522")=5（字符串同口径）');
    t.eq(zones.floorOf(100), 1, 'A4 floorOf(100)=1（最小值域）');
    t.eq(zones.floorOf('0522'), 5, 'A5 floorOf("0522")=5（前导零归一后取层）');
    t.eq(zones.floorOf(1001), 10, 'A6 floorOf(1001)=10（楼层不进位到 11）');
    t.eq(zones.floorOf(99), 0, 'A7 floorOf(99)=0（<100 非法）');
    t.eq(zones.floorOf(''), 0, 'A8 floorOf("")=0');
    t.eq(zones.floorOf(null), 0, 'A9 floorOf(null)=0');
    t.eq(zones.floorOf(522.5), 0, 'A10 floorOf(522.5)=0（非整数房号）');
    t.eq(zones.floorOf('abc'), 0, 'A11 floorOf("abc")=0（非数字）');
    t.eq(zones.floorOf('123456789'), 0, 'A12 floorOf(9 位数字)=0（超 room 位数域）');
    t.eq(zones.compareDormKey('D4-522', 'D4-517') > 0, true, 'A13 旧 compareDormKey 回归：同栋按房号数值排序（522>517）');
    t.eq(zones.compareDormKey('D4-522', 'X1-100') < 0, true, 'A14 旧 compareDormKey 回归：苑固定序 D<X');
    t.eq(readText(FILES.viewModel).indexOf('zones.floorOf(') !== -1, true, 'A15 floorOf 有生产调用（楼层清单纯件）');
  });

  // ------------------------------------------------------------ B. 分组/排序
  h.section('B 苑 → 栋 → 楼层 → roomTag 分组排序（含地址待同步兜底组）', (t) => {
    if (!view) {
      t.check(false, 'B1 楼层清单纯件缺失（pkg-partner/pages/pick-list/parts/view-model.js）');
      return;
    }
    const raw = floorFixtures();
    const rows = view.rowsOf(raw);
    const groups = view.buildGroups(rows);
    t.eq(rows.length, 7, 'B1 7 单全部进入清单（PICKED）');
    t.eq(groups.length, 5, 'B2 分组数 = 5（D4 4/5/10 层 + D5 6 层 + X2 3 层）');
    t.eq(groupTitles(groups), ['东苑 D4 · 4 层', '东苑 D4 · 5 层', '东苑 D4 · 10 层', '东苑 D5 · 6 层', '西苑 X2 · 3 层'],
      'B3 组序 = 苑序(D→X) → 栋号(4→5) → 楼层数值(4→5→10)');
    t.eq(groups.map((group) => group.count), [1, 3, 1, 1, 1], 'B4 各组单数正确');
    const floor5 = groups.filter((group) => group.floor === 5 && group.zone === 'D' && group.buildingNo === 4)[0];
    t.eq(floor5.rows.map((row) => row.roomText), ['508', '517', '522'], 'B5 组内按房号数值自然序（不是字符串序）');
    t.eq([floor5.zoneText, floor5.buildingText, floor5.floor], ['东苑', 'D4', 5], 'B6 组头含苑名/栋号/楼层（floorOf 派生）');
    t.eq(rows.filter((row) => row.orderNo === '20261101-0001')[0].groupKey, 'D|4|5', 'B7 组键=苑|栋|楼层（floor 来自 floorOf）');
    const sameRoom = [
      orderFixture('20261101-0101', 'C', 3, 301, { roomTag: 'B' }),
      orderFixture('20261101-0102', 'C', 3, 301, { roomTag: 'A' }),
    ];
    const sameRoomGroup = view.buildGroups(view.rowsOf(sameRoom))[0];
    t.eq(sameRoomGroup.rows.map((row) => row.roomTagText), ['A', 'B'], 'B8 同层同房按 roomTag 自然序（A<B）');
    const unknownRow = orderFixture('20261101-0103', 'D', 4, 99);
    const withUnknown = view.buildGroups(view.rowsOf(raw.concat([unknownRow])));
    t.eq([withUnknown[withUnknown.length - 1].key, withUnknown[withUnknown.length - 1].title],
      ['UNKNOWN', '地址待同步'], 'B9 非法房号进「地址待同步」兜底组且排最后（不静默丢单）');
    t.eq([view.buildGroups([]), view.rowsOf([])], [[], []], 'B10 空输入返回空集（不抛错）');
    const outsider = orderFixture('20261101-0104', 'D', 4, 522, { roomTag: 'A' });
    outsider.delivery = { zone: 'D', buildingNo: 5, room: '602', dormKey: 'D5-602' };
    t.eq(view.rowsOf([outsider])[0].roomTagText, '', 'B11 D25 他人配送地址不显示顾客 roomTag（避免误导）');
    t.eq(view.rowsOf([orderFixture('20261101-0105', 'D', 4, 522, { roomTag: 'A' })])[0].roomTagText, 'A',
      'B12 同址订单显示 roomTag（本人订单 L3 展示位）');
    t.eq(view.summaryOf(groups), { total: 7, buildingCount: 3, text: '共 7 单待送达 · 覆盖 3 栋' },
      'B13 汇总=总单数+覆盖栋数（文本在纯件，页面不拼判据）');
  });

  // ------------------------------------------------------------ C. 只含 PICKED
  h.section('C 只含 PICKED（已送达/异常/取消/待接单不显示；现成动作无新 action）', (t) => {
    if (!view) {
      t.check(false, 'C1 楼层清单纯件缺失');
      return;
    }
    const payload = view.queryOf({});
    t.eq([payload.view, payload.status, payload.limit], ['workbench', enums.ORDER_STATUS.PICKED, 20],
      'C1 数据源 payload = {view:workbench,status:PICKED,limit:20}（现成动作、无服务端改动）');
    t.eq(payload.cursor, undefined, 'C2 首屏不带 cursor');
    t.eq(view.queryOf({ cursor: { sortValue: 1, orderNo: 'X' } }).cursor,
      { sortValue: 1, orderNo: 'X' }, 'C3 翻页原样透传 cursor');
    const mixed = floorFixtures().concat([
      orderFixture('20261101-0201', 'D', 4, 522, { status: enums.ORDER_STATUS.DELIVERED }),
      orderFixture('20261101-0202', 'D', 4, 522, { status: enums.ORDER_STATUS.EXCEPTION }),
      orderFixture('20261101-0203', 'D', 4, 522, { status: enums.ORDER_STATUS.CANCELLED }),
      orderFixture('20261101-0204', 'D', 4, 522, { status: enums.ORDER_STATUS.SUBMITTED }),
    ]);
    const rows = view.rowsOf(mixed);
    t.eq(rows.length, 7, 'C4 混合响应只保留 PICKED 7 单（非 PICKED 全部不显示）');
    t.eq(rows.filter((row) => /02\d\d$/.test(row.orderNo)), [], 'C5 已送达/异常/取消/待接单行零残留');
    const actions = Object.keys(require(path.join(ROOT, 'shared/actions.js')).ACTION_MAP || {});
    t.eq(actions.filter((name) => /pick-?list/i.test(name)), [], 'C6 未新增服务端动作（action 注册表零 pick-list 项）');
    t.eq(readText(FILES.page).indexOf("listPartner(") !== -1 && readText(FILES.page).indexOf("view.queryOf(") !== -1,
      true, 'C7 页面经纯件 queryOf 调现成 listPartner（页面零手写查询判据）');
  });

  // ------------------------------------------------------------ D. 分页/分片/无轮询
  h.section('D 分页/分片 ≤20 行 + 不参与 30s 轮询（切页/下拉才刷新）', (t) => {
    if (!view) {
      t.check(false, 'D1 楼层清单纯件缺失');
      return;
    }
    t.check(view.CHUNK_ROWS <= 20, 'D1 渲染分片阈值 ≤20 行（CHUNK_ROWS=' + view.CHUNK_ROWS + '）');
    const many = [];
    for (let i = 1; i <= 45; i += 1) {
      many.push(orderFixture('20261101-' + String(1000 + i), 'D', 4, 500 + i));
    }
    const groups = view.buildGroups(view.rowsOf(many));
    const chunks = view.splitChunks(groups, view.CHUNK_ROWS);
    t.eq(chunks.length, 3, 'D2 45 行 → 3 片（每片 ≤20）');
    t.eq(chunks.filter((chunk) => chunk.rows.length > 20), [], 'D3 每片 rows ≤20（分片 setData 闸）');
    t.eq(chunks.reduce((sum, chunk) => sum + chunk.rows.length, 0), 45, 'D4 分片合计 = 45 行（无丢行/无重复）');
    t.eq(new Set(chunks.map((chunk) => chunk.key)).size, chunks.length, 'D5 分片 key 唯一（wx:key 稳定）');
    t.eq(view.splitChunks([], 20), [], 'D6 空分组零分片');
    const flatChunk = [];
    chunks.forEach((chunk) => chunk.rows.forEach((row) => flatChunk.push(row.orderNo)));
    t.eq(flatChunk, flattenRows(groups).map((row) => row.orderNo), 'D7 分片展开顺序 = 分组行顺序（渲染顺序一致）');
    const page = readText(FILES.page);
    t.eq(/onReachBottom\(\)\s*\{[\s\S]{0,200}nextCursor/.test(page), true, 'D8 上拉翻页走 nextCursor（服务端游标，不一次拉全量）');
    t.eq(/setInterval|setTimeout/.test(page + readText(FILES.wxml) + readText(FILES.viewModel)), false,
      'D9 页面/纯件零 setInterval/setTimeout（不参与 30s 轮询）');
    t.eq(/30\s*(秒|s|S)/.test(page + readText(FILES.wxml)), false, 'D10 页面不写 30 秒自动刷新文案（切页/下拉才刷新）');
    t.eq(/onShow\(\)\s*\{[\s\S]{0,240}refresh\(/.test(page), true, 'D11 onShow 触发一次刷新（切页回来才更新，不挂轮询）');
    t.eq(readText(FILES.wxml).indexOf('不自动刷新') !== -1, true, 'D12 页面明示「不自动刷新」（用户预期管理）');
  });

  // ------------------------------------------------------------ E. 复制文案（楼栋级）
  h.section('E 复制文案只到楼栋级（D48 红线：房间号/roomTag/订单号/称呼/尾号/取件码零泄漏）', (t) => {
    if (!view) {
      t.check(false, 'E1 楼层清单纯件缺失');
      return;
    }
    const raw = floorFixtures();
    const groups = view.buildGroups(view.rowsOf(raw));
    const copy = view.copyText(groups);
    t.check(copy.length > 0, 'E1 非空清单生成非空复制文案');
    ['东苑 D4', '东苑 D5', '西苑 X2'].forEach((building, index) => {
      t.eq(copy.indexOf(building) !== -1, true, 'E' + (2 + index) + ' 文案含楼栋级「' + building + '」');
    });
    t.eq(copy.indexOf('共 7 单待送达') !== -1, true, 'E5 文案含总单数（楼栋级聚合）');
    ['522', '517', '508', '1001', '602', '301'].forEach((room, index) => {
      t.eq(copy.indexOf(room) === -1, true, 'E' + (6 + index) + ' 文案不含房间号 ' + room + '（D48 红线）');
    });
    t.eq(/[A-Z]\d-\d/.test(copy), false, 'E12 文案不含「栋-房间」完整宿舍键（楼栋级封顶）');
    t.eq(copy.indexOf('20261101'), -1, 'E13 文案不含订单号');
    t.eq(copy.indexOf('小王'), -1, 'E14 文案不含收件人称呼（L3）');
    t.eq([copy.indexOf('207-3-1014'), copy.indexOf('6678')], [-1, -1], 'E15 文案不含取件码/尾号');
    t.eq(view.copyText([]), '', 'E16 空清单不生成文案（复制按钮兜底）');
    const unknownOnly = view.buildGroups(view.rowsOf([orderFixture('20261101-0399', 'D', 4, 99)]));
    t.eq(view.copyText(unknownOnly), '', 'E17 仅「地址待同步」组不生成楼栋级文案（无可复制楼栋）');
  });

  // ------------------------------------------------------------ F. 页面静态纪律
  h.section('F 页面静态纪律（零 wx.cloud/random/状态与 action 字面量；switch-bar；复制接线）', (t) => {
    const page = readText(FILES.page);
    const wxml = readText(FILES.wxml);
    const viewModel = readText(FILES.viewModel);
    const statuses = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
    t.eq(page.indexOf('wx.cloud') === -1, true, 'F1 页面零 wx.cloud.*（客户端不直连云）');
    t.eq(/Math\.random|\brandom\s*\(/.test(page + viewModel), false, 'F2 页面/纯件零 random（编号生成铁律）');
    const pageHits = statuses.filter((status) => new RegExp("['\"]" + status + "['\"]").test(page));
    t.eq(pageHits, [], 'F3 页面零七状态字面量（状态判据只在纯件/enums）');
    const vmHits = statuses.filter((status) => new RegExp("['\"]" + status + "['\"]").test(viewModel));
    t.eq(vmHits, [], 'F4 纯件零状态字面量（经 shared/enums.ORDER_STATUS 取值）');
    const actionRe = /['"](?:order|message|partner|admin|customer|bind|upload|config|user|ai|health|cleanup)\.[a-zA-Z]+['"]/;
    t.eq(actionRe.test(page + wxml), false, 'F5 页面零 action 字面量（只经 api/modules 方法）');
    t.eq(wxml.indexOf('<switch-bar') !== -1
      && wxml.indexOf('<switch-bar') < wxml.indexOf('<view class="head-row"'), true,
      'F6 switch-bar 为页面根节点首个子节点（门禁 #23 会话条接入）');
    t.eq(page.indexOf('view.copyText(') !== -1 && page.indexOf('setClipboardData') !== -1, true,
      'F7 复制按钮接线：纯件生成文案 + wx.setClipboardData');
    t.eq(wxml.indexOf('row.roomText') !== -1 && wxml.indexOf('row.roomTagText') !== -1, true,
      'F8 页面展示房间号/roomTag（本人订单 L3，D46 允许）');
    t.eq(page.indexOf('console.log') === -1, true, 'F9 页面无 console.log（不落 L3 日志）');
    t.eq(page.indexOf("status: enums.ORDER_STATUS") !== -1, false, 'F10 数据源 status 由纯件 queryOf 单源给出');
  });

  // ------------------------------------------------------------ G. 批量送达复用 + 只读/测试会话
  h.section('G 批量送达复用工作台纯件 + READONLY 禁用/TEST_WRITE 提示', (t) => {
    const page = readText(FILES.page);
    const wxml = readText(FILES.wxml);
    t.eq(page.indexOf('workbench/parts/batch-view') !== -1, true, 'G1 批量送达复用工作台 batch-view 纯件（不另写一套）');
    t.eq(page.indexOf('workbench/parts/row-actions') !== -1, true, 'G2 行请求构造复用工作台 row-actions 纯件');
    ['batchView.plan(', 'batchView.run(', 'batchView.summary('].forEach((token, index) => {
      t.eq(page.indexOf(token) !== -1, true, 'G' + (3 + index) + ' 批量链路使用 ' + token + '（计划/执行/逐单结果汇总）');
    });
    t.eq(page.indexOf('rowActions.buildWrite(') !== -1, true, 'G6 写请求统一经 rowActions.buildWrite（带 expectedVersion）');
    t.eq(page.indexOf('wx.showModal') !== -1, true, 'G7 批量/行内送达均有确认框');
    t.eq(page.indexOf('failedOrderNos') !== -1 && page.indexOf('retryPlan(') !== -1, true,
      'G8 失败逐单反馈并保留可重试（不把部分成功显示为全部成功）');
    t.eq(page.indexOf("'开发者只读视角不能操作'") !== -1 && (page.match(/this\.data\.readonly/g) || []).length >= 3,
      true, 'G9 READONLY 禁用写操作（提示文案与工作台口径一致）');
    t.eq(page.indexOf('isTestWrite()') !== -1 && wxml.indexOf('测试数据') !== -1, true,
      'G10 TEST_WRITE 会话提示只写测试数据');
    t.eq(page.indexOf('createRequestId(') !== -1, true, 'G11 批量送达同一 batchActionId（client.createRequestId 幂等键）');
    t.eq(page.indexOf('markDelivered') === -1, true, 'G12 页面零直写 action 键（markDelivered 只经 row-actions 映射）');
    t.eq(wxml.indexOf('onRowDeliver') !== -1 && wxml.indexOf('onBatchDeliver') !== -1, true,
      'G13 行内「已送达」与批量送达入口均接线');
  });

  // ------------------------------------------------------------ H. 注册与文档联动（31→32）
  h.section('H 注册与文档联动（app.json/project/CONTRACT §7/ARCH/UX/QA/README 31→32）', (t) => {
    const pickPath = 'pkg-partner/pages/pick-list/index';
    const four = [FILES.page, FILES.wxml, FILES.wxss, FILES.json];
    t.eq(four.filter((rel) => readText(rel) === ''), [], 'H1 页面四件套齐全且非空');
    const pageJson = jsonOf(FILES.json);
    t.eq(pageJson && pageJson.navigationBarTitleText, '楼层配送清单', 'H2 页面 json 标题正确');
    t.eq(pageJson && pageJson.enablePullDownRefresh, true, 'H3 页面启用下拉刷新（切页/下拉才刷新）');
    const pages = appPages();
    t.eq(pages.length, 32, 'H4 app.json 总页数 = 32（31→32）');
    t.eq(pages.indexOf(pickPath) !== -1, true, 'H5 app.json 声明 pkg-partner/pages/pick-list/index');
    t.eq(project.ALL_PAGES.length, 32, 'H6 tools/lib/project.js ALL_PAGES = 32（与 app.json 对帐）');
    t.eq(project.SUBPACKAGES['pkg-partner'].indexOf('pages/pick-list/index') !== -1, true,
      'H7 tools/lib/project.js pkg-partner 追加 pick-list（页数口径联动）');
    const sec7 = fsutil.section(readText(CONTRACT), /^##\s*7\./) || '';
    t.eq(sec7.indexOf(pickPath) !== -1, true, 'H8 CONTRACT §7 页面地图含第 32 页（check-docs #2 双向一致）');
    t.eq(sec7.indexOf('pkg-customer/pages/pickup-list/index') !== -1, true, 'H9 CONTRACT §7 既有页面未被删（无回归）');
    const arch = readText(ARCH);
    t.eq(arch.indexOf('32 个页面') !== -1, true, 'H10 ARCHITECTURE 页面数 31→32');
    t.eq(arch.indexOf('`pkg-partner` 8 页') !== -1, true, 'H11 ARCHITECTURE 分包页数 pkg-partner 7→8');
    t.eq(arch.indexOf(pickPath) !== -1, true, 'H12 ARCHITECTURE 页面清单含第 32 页路径');
    const ux = readText(UX_PARTNER);
    t.eq(ux.indexOf(pickPath) !== -1 && ux.indexOf('D46') !== -1, true, 'H13 UX_PARTNER 新页规格 + 导航（D46）');
    const qa = readText(QA);
    t.eq(['| F31 |', '| F32 |', '| F33 |', '| F34 |'].filter((row) => qa.indexOf(row) === -1), [],
      'H14 QA 真机项 F31~F34（楼层清单滚动/分组/复制楼栋级/批量送达）');
    const readme = readText(DOCS_README);
    t.eq(readme.indexOf('**32 页**') !== -1 && readme.indexOf('`pkg-partner` 8') !== -1, true,
      'H15 docs/README 页数读数 31→32（页面结构行）');
    const workbenchJs = readText('pages/partner/workbench/index.js');
    const workbenchWxml = readText('pages/partner/workbench/index.wxml');
    t.eq(workbenchWxml.indexOf('onPickListTap') !== -1, true, 'H16 工作台顶部入口按钮接线（wxml 1 处）');
    t.eq(workbenchJs.indexOf('onPickListTap(') !== -1 && workbenchJs.indexOf(pickPath) !== -1, true,
      'H17 工作台入口跳转（index.js 1 处）');
    t.check(linesOf('pages/partner/workbench/index.js') <= 500,
      'H18 工作台 index.js 仍 ≤500 行（' + linesOf('pages/partner/workbench/index.js') + '）');
    const zonesSrc = readText(ZONES);
    t.eq([readText('cloudfunctions/api/shared/zones.js') === zonesSrc,
      readText('cloudfunctions/cleanup/shared/zones.js') === zonesSrc], [true, true],
      'H19 云函数 shared 两套副本 = shared/zones.js（sync-cloud-shared 生成，含 floorOf）');
  });

  // ------------------------------------------------------------ I. 零金额 + 行数闸
  h.section('I 零金额扫描（新文件 5 件）+ 行数闸（页面/纯件 ≤500、本套件 ≤1000）', (t) => {
    Object.keys(FILES).forEach((key, index) => {
      const source = readText(FILES[key]);
      t.eq(zeroMoney.scanText(source), [], 'I' + (1 + index) + ' 新文件零金额词表零命中（' + FILES[key] + '）');
    });
    t.check(linesOf(FILES.page) <= 500,
      'I6 页面 index.js ≤500 行（' + linesOf(FILES.page) + '）');
    t.check(linesOf(FILES.viewModel) <= 500,
      'I7 楼层清单纯件 ≤500 行（' + linesOf(FILES.viewModel) + '）');
    t.check(linesOf(ZONES) <= 500,
      'I8 shared/zones.js ≤500 行（' + linesOf(ZONES) + '）');
    t.check(linesOf('tools/selftest-pick-list.js') <= 1000, 'I9 本套件文件 ≤1000 行（测试行数闸）');
    t.check(linesOf(FILES.wxml) <= 500, 'I10 页面 wxml ≤500 行');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-pick-list' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-pick-list');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
