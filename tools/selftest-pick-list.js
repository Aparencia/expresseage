'use strict';
/**
 * tools/selftest-pick-list.js — 独立「取件清单」页断言套件（D46；批 20 扩双阶段；ENGINEERING §8.2 门禁纪律）
 *
 * 覆盖：
 *   A. `shared/zones.floorOf` 纯件（room≥100 → floor(room/100)；非法/越界一律 0；旧 compareDormKey 回归）
 *   B. 苑 → 栋 → 楼层 → roomTag 自然序分组（楼层由 floorOf 派生、组标题/组序/组内序、地址待同步兜底组；
 *      D25 他人配送地址不显示顾客 roomTag）
 *   C. 待送达阶段只含 PICKED（已送达/异常/取消/待接单不显示；数据源=现成 `order.listPartner` workbench 视图）
 *   D. 分页/分片 ≤20 行 + 不参与 30s 轮询（无 setInterval/超时轮询；onShow/下拉才刷新）
 *   E. 待送达复制文案只到楼栋级（D48 红线：不含房间号/roomTag/订单号/称呼/尾号/取件码；空清单不复制）
 *   F. 页面静态纪律（零 wx.cloud/random/状态字面量/action 字面量；switch-bar 首子节点；复制接线）
 *   G. 批量送达复用工作台纯件（batchView.plan/run/summary + rowActions.buildWrite）+ READONLY 禁用/TEST_WRITE 提示
 *   H. 注册与文档联动（app.json=32 页、tools/lib/project.js ALL_PAGES=32、CONTRACT §7/ARCHITECTURE/
 *      UX_PARTNER/QA/docs README 页数读数、工作台入口、sync 副本一致）
 *   I. 零金额扫描（7 文件）+ 行数闸（页面/纯件 ≤500、本套件 ≤1000）
 *   J. 修复批 T4：复制前自动拉全（P1-7）/ 批量失败重试条与取消不刷新（P1-8）/ 卸载与请求序号守卫（P2）
 *   K. 批 20 双阶段数据源（待取件 ACCEPTED / 待送达 PICKED 两条现成动作 payload；counts→chip 文案；默认阶段）
 *   L. 待取件站点分组（站点表 P1~P8 固定序、未识别站兜底排最后、组内四档动线、跨站点单只归一组、
 *      件数聚合、宿舍锚 dormKey+roomTag / D25 / 代客单 guest）
 *   M. 待取件空态与复制口径（单行/整组/全部：站点+取件码/运单尾号/柜号+宿舍锚；不含称呼/订单号/编号/手机尾号）
 *   N. 双阶段页面接线与只读（chip 切换、load 分派、上拉游标、空态文案切换、待取件块零写控件、行点击进详情）
 *
 * 纪律：纯件 + 静态接线断言；不 mock 全局 wx、不连网络；先合法基线再反例；样本非空；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-pick-list.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const zeroMoney = require('./zero-money-scan');
const project = require('./lib/project');

const EXPECTED_ASSERTIONS = 200; // 实跑读数：node tools/selftest-pick-list.js（135 + 65：批 20 双阶段 K/L/M/N + I 新增 3 行数闸）

const PAGE_DIR = 'pkg-partner/pages/pick-list';
const FILES = {
  page: PAGE_DIR + '/index.js',
  wxml: PAGE_DIR + '/index.wxml',
  wxss: PAGE_DIR + '/index.wxss',
  json: PAGE_DIR + '/index.json',
  viewModel: PAGE_DIR + '/parts/view-model.js',
  pickView: PAGE_DIR + '/parts/pick-view.js',
  stageFlows: PAGE_DIR + '/parts/stage-flows.js',
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
const pickView = safeRequire(FILES.pickView);
const stageFlows = safeRequire(FILES.stageFlows);

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

// 待取件夹具：单件视图（站点快照/取件码/运单尾号/柜号/码状态），字段形状对齐 _dto.buildParcelDto
function parcelFixture(stationId, stationName, options) {
  const opts = options || {};
  const codeStatus = opts.codeStatus || enums.CODE_STATUS.OK;
  return {
    itemIndex: opts.itemIndex || 0,
    stationId: stationId,
    stationName: stationName,
    pickupCode: opts.pickupCode === undefined ? '207-3-1014' : opts.pickupCode,
    trackingTail: opts.trackingTail || '',
    lockerNo: opts.lockerNo || '',
    codeStatus: codeStatus,
    codeStatusText: codeStatus === enums.CODE_STATUS.NEED_CODE ? '需查明' : '正常'
  };
}

// 待取件订单夹具（ACCEPTED）：默认本人宿舍 D4-522A + 一件 P4 已识别；dorm/delivery 传 null 覆盖代客单
function acceptedFixture(orderNo, options) {
  const opts = options || {};
  const defaultDorm = { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' };
  const defaultDelivery = { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' };
  return {
    orderNo: orderNo,
    status: enums.ORDER_STATUS.ACCEPTED,
    delivery: opts.delivery === undefined ? defaultDelivery : opts.delivery,
    dorm: opts.dorm === undefined ? defaultDorm : opts.dorm,
    guest: opts.guest || null,
    counterpart: { displayName: opts.name || '小王' },
    customerNo: opts.customerNo || 'C202611010001',
    phoneTail: opts.phoneTail || '6678',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    parcels: opts.parcels || [parcelFixture('P4', '北部菜鸟')],
    actions: [{ key: 'pick', label: '标记已取件' }, { key: 'exception', label: '上报异常' }],
    version: 3,
    statusUpdatedAt: '2026-11-01T02:00:00.000Z',
    acceptedAt: '2026-11-01T01:30:00.000Z'
  };
}

// 待取件基准夹具：P1/P3/P4/P8 四站 + 未识别站；P4 组内覆盖四档（需查明/快递柜/分段码/其他）+ 跨站点单
function pickFixtures() {
  return [
    acceptedFixture('20261101-1001', { parcels: [parcelFixture('P3', '西苑一栋南面', { pickupCode: '6655' })] }),
    acceptedFixture('20261101-1002', { parcels: [parcelFixture('P1', '西苑顺丰', { pickupCode: '1122' })] }),
    acceptedFixture('20261101-1003', { parcels: [parcelFixture('P8', '东苑一栋邮政', { pickupCode: '3344' })] }),
    acceptedFixture('20261101-1004', { parcels: [parcelFixture('P4', '北部菜鸟', { pickupCode: '889900' })] }),
    acceptedFixture('20261101-1005', {
      parcels: [
        parcelFixture('P4', '北部菜鸟', { pickupCode: '207-3-1014', itemIndex: 0 }),
        parcelFixture('P6', '南苑菜鸟', { pickupCode: '', trackingTail: '4455', itemIndex: 1 })
      ]
    }),
    acceptedFixture('20261101-1007', { parcels: [parcelFixture('P4', '北部菜鸟', { pickupCode: '8811', lockerNo: '5号柜' })] }),
    acceptedFixture('20261101-1009', {
      parcels: [parcelFixture('P4', '北部菜鸟', { pickupCode: '', codeStatus: enums.CODE_STATUS.NEED_CODE })]
    }),
    acceptedFixture('20261101-1008', { parcels: [parcelFixture('', '', { pickupCode: 'X-9' })] }),
  ];
}

function pickTitles(groups) {
  return groups.map((group) => group.title);
}

function pickOrdersOf(groups) {
  const out = [];
  groups.forEach((group) => {
    group.rows.forEach((row) => out.push(row.orderNo));
  });
  return out;
}

function pickGroupsOf(fixtures) {
  return pickView ? pickView.buildGroups(fixtures) : [];
}

function groupOfKey(groups, key) {
  return groups.filter((group) => group.key === key)[0] || null;
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
    t.eq(page.indexOf('view.copyPlanOf(') !== -1 && page.indexOf('setClipboardData') !== -1, true,
      'F7 复制按钮接线：纯件复制计划（拉全后）+ wx.setClipboardData');
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
    t.eq(pageJson && pageJson.navigationBarTitleText, '取件清单', 'H2 页面 json 标题正确（批 20 双阶段更名）');
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
  h.section('I 零金额扫描（7 文件）+ 行数闸（页面/纯件 ≤500、本套件 ≤1000）', (t) => {
    Object.keys(FILES).forEach((key, index) => {
      const source = readText(FILES[key]);
      t.eq(zeroMoney.scanText(source), [], 'I' + (1 + index) + ' 新文件零金额词表零命中（' + FILES[key] + '）');
    });
    t.check(linesOf(FILES.page) <= 500,
      'I8 页面 index.js ≤500 行（' + linesOf(FILES.page) + '）');
    t.check(linesOf(FILES.viewModel) <= 500,
      'I9 待送达纯件 ≤500 行（' + linesOf(FILES.viewModel) + '）');
    t.check(linesOf(FILES.pickView) <= 500,
      'I10 待取件纯件 pick-view ≤500 行（' + linesOf(FILES.pickView) + '）');
    t.check(linesOf(FILES.stageFlows) <= 500,
      'I11 双阶段接线 parts/stage-flows ≤500 行（' + linesOf(FILES.stageFlows) + '）');
    t.check(linesOf(ZONES) <= 500,
      'I12 shared/zones.js ≤500 行（' + linesOf(ZONES) + '）');
    t.check(linesOf('tools/selftest-pick-list.js') <= 1000, 'I13 本套件文件 ≤1000 行（测试行数闸）');
    t.check(linesOf(FILES.wxml) <= 500, 'I14 页面 wxml ≤500 行（' + linesOf(FILES.wxml) + '）');
  });

  // ------------------------------------------------------------ J. 修复批 T4（P1-7/P1-8/P2）
  h.section('J 复制自动拉全（P1-7）+ 失败重试条（P1-8）+ 卸载/请求序号守卫（P2）', (t) => {
    const page = readText(FILES.page);
    const wxml = readText(FILES.wxml);
    if (!view) {
      t.check(false, 'J1 楼层清单纯件缺失');
      return;
    }
    const firstGroups = view.buildGroups(view.rowsOf(floorFixtures().slice(0, 4)));
    const fullGroups = view.buildGroups(view.rowsOf(floorFixtures()));
    // P1-7：未加载完不复制半量清单；拉全后给全量文案
    const morePlan = view.copyPlanOf(firstGroups, { sortValue: 1, orderNo: '20261101-0005' }, 0);
    t.check(morePlan.ok === false && morePlan.needMore === true && morePlan.text === '',
      'J1 还有下一页 → 复制计划 needMore 且不给半量文案（P1-7 漏单场景）');
    t.eq(view.copyText(firstGroups).indexOf('共 4 单待送达') >= 0, true,
      'J2 只加载 4 单时文案只有 4 单（旧缺陷基线：复制前会漏 3 单）');
    const fullPlan = view.copyPlanOf(fullGroups, null, 0);
    t.check(fullPlan.ok === true && fullPlan.text === view.copyText(fullGroups)
      && fullPlan.text.indexOf('共 7 单待送达') !== -1,
    'J3 拉全后复制计划给全量文案（共 7 单，不再漏单）');
    const cappedPlan = view.copyPlanOf(fullGroups, { sortValue: 9 }, view.MAX_AUTO_PAGES);
    t.check(cappedPlan.ok === false && cappedPlan.needMore === true && cappedPlan.capped === true
      && cappedPlan.message.indexOf('上拉') !== -1,
    'J4 到页数上限仍有下一页 → 不复制并提示先上拉（不一次点按拉爆）');
    t.check(view.MAX_AUTO_PAGES > 0 && view.MAX_AUTO_PAGES * 20 >= 100, true,
      'J5 自动拉全页数上限为正且覆盖常规清单量（' + view.MAX_AUTO_PAGES + ' 页 × 20 行）');
    t.eq(view.copyPlanOf([], null, 0).message, '当前没有可复制的清单', 'J6 空清单复制计划给兜底提示');
    // 页头汇总：「已加载 N 单」只在还有下一页时出现
    const moreSummary = view.summaryLineOf(view.summaryOf(firstGroups), { sortValue: 1 });
    t.check(moreSummary.loadedText.indexOf('已加载 4 单') >= 0 && moreSummary.text.indexOf('共 4 单') >= 0,
      'J7 有下一页时页头明示「已加载 N 单」（不把部分清单当全量）');
    const doneSummary = view.summaryLineOf(view.summaryOf(fullGroups), null);
    t.check(doneSummary.loadedText === '' && doneSummary.text.indexOf('共 7 单') >= 0,
      'J8 加载完 → 页头不再显示「已加载」（全量口径）');
    // P1-8：持久失败重试条 + 取消不刷新
    t.check(wxml.indexOf('batchResult.failedOrderNos.length') !== -1 && wxml.indexOf('onBatchRetry') !== -1,
      'J9 wxml 有持久失败重试条并接 onBatchRetry（P1-8）');
    t.check(wxml.indexOf('单失败') !== -1 && wxml.indexOf('重试失败单') !== -1,
      'J10 重试条文案「N 单失败 · 重试失败单」');
    t.check(/showCancel: !summary\.allOk/.test(page), 'J11 部分失败弹窗保留「稍后处理」取消入口');
    t.check(/if \(summary\.allOk \|\| res\.confirm\) \{\s*this\.refresh\(\)/.test(page),
      'J12 仅成功/确认路径才 refresh（取消不刷新，保留行/勾选/失败态）');
    t.check(/batchResult: null, copyLoading: false/.test(page),
      'J13 刷新路径清 batchResult 与复制临时态（P1-8 状态不残留）');
    // P2：卸载守卫 + 请求序号
    t.check(/onUnload\(\)\s*\{[\s\S]{0,80}this\._unloaded = true/.test(page),
      'J14 onUnload 置 _unloaded（离页后迟到回调不再 setData/toast/modal）');
    t.check(/token !== this\._loadToken/.test(page) && /this\._loadToken = token/.test(page),
      'J15 refresh/分页请求序号：过期响应（含 more）丢弃不追加');
    t.check((page.match(/_unloaded/g) || []).length >= 6, 'J16 异步落点普遍先判 _unloaded（≥6 处）');
    t.check(/this\._copying/.test(page) && page.indexOf('loadPendingForCopy(') !== -1
      && page.indexOf('view.MAX_AUTO_PAGES') !== -1,
    'J17 复制防重入 + 循环拉全接线（_copying / loadPendingForCopy / MAX_AUTO_PAGES）');
    t.check(wxml.indexOf('copyLoading') !== -1 && wxml.indexOf('summary.loadedText') !== -1,
      'J18 wxml 展示复制加载提示 + 页头已加载文案');
    t.check(/applyBatchResult\(summary\)/.test(page) && /this\._selected = failedMap/.test(page)
      && /summary\.failedOrderNos\.forEach/.test(page),
    'J19 批量结果落状态：仅失败项保留勾选（成功项取消勾选，避免重复送达）');
  });

  // ------------------------------------------------------------ K. 批 20 双阶段数据源
  h.section('K 双阶段数据源（待取件 ACCEPTED / 待送达 PICKED；counts→chip；默认阶段）', (t) => {
    if (!pickView) {
      t.check(false, 'K1 待取件纯件缺失（pkg-partner/pages/pick-list/parts/pick-view.js）');
      return;
    }
    const page = readText(FILES.page);
    const wxml = readText(FILES.wxml);
    const payload = pickView.queryOf({});
    t.eq([payload.view, payload.status, payload.limit], ['workbench', enums.ORDER_STATUS.ACCEPTED, 20],
      'K1 待取件 payload = {view:workbench,status:ACCEPTED,limit:20}（现成动作、无服务端改动）');
    t.eq(payload.cursor, undefined, 'K2 首屏不带 cursor');
    t.eq(pickView.queryOf({ cursor: { sortValue: 1, orderNo: 'X' } }).cursor, { sortValue: 1, orderNo: 'X' },
      'K3 翻页 cursor 原样透传（与待送达同口径）');
    const deliverPayload = view.queryOf({});
    t.eq([deliverPayload.view, deliverPayload.status], ['workbench', enums.ORDER_STATUS.PICKED],
      'K4 待送达 payload 仍为 PICKED（阶段二行为不变）');
    t.eq(pickView.tabTextsOf({ counts: { accepted: 12, picked: 5 } }), { pick: '待取件 12', deliver: '待送达 5' },
      'K5 counts → 两 chip 文案「待取件 N」/「待送达 N」');
    t.eq(pickView.tabTextsOf(null), { pick: '待取件', deliver: '待送达' }, 'K6 未加载时 chip 只显示阶段名（不显示假 0）');
    t.eq([pickView.tabOf('pickup'), pickView.tabOf('deliver'), pickView.tabOf('x')], ['pickup', 'deliver', ''],
      'K7 tab 校验：只认两个阶段键，非法值不切换');
    t.eq([pickView.TAB_PICK, pickView.TAB_DELIVER], ['pickup', 'deliver'], 'K8 阶段键常量（页面/WXML 共用单源）');
    t.check(/tab: pickView\.TAB_PICK/.test(page) && /require\('\.\/parts\/stage-flows'\)/.test(page),
      'K9 页面默认阶段=待取件，且双阶段接线 parts 并入 Page 配置');
    t.eq((wxml.match(/class="chip /g) || []).length, 2, 'K10 页面顶部恰好两个阶段 chip（不重复渲染）');
    t.check(wxml.indexOf('data-tab="{{tabPick}}"') !== -1 && wxml.indexOf('data-tab="{{tabDeliver}}"') !== -1
      && wxml.indexOf('bindtap="onSwitchTab"') !== -1, 'K11 两 chip 均接 onSwitchTab（data-tab 传阶段键）');
  });

  // ------------------------------------------------------------ L. 待取件站点分组
  h.section('L 待取件站点分组排序（站点表 P1~P8 固定序、组内四档、跨站点单归一组、宿舍锚）', (t) => {
    if (!pickView) {
      t.check(false, 'L1 待取件纯件缺失');
      return;
    }
    const groups = pickGroupsOf(pickFixtures());
    t.eq(groups.length, 5, 'L1 8 单 → 5 个站点组（P1/P3/P4/P8 + 未识别站兜底）');
    t.eq(pickTitles(groups), ['P1 西苑顺丰', 'P3 西苑一栋南面', 'P4 北部菜鸟', 'P8 东苑一栋邮政', '站点待同步'],
      'L2 组序 = 站点表 P1~P8 固定序，未识别站兜底组排最后');
    t.eq(groups[groups.length - 1].unknown, true, 'L3 兜底组 unknown=true（不静默丢单）');
    const p4 = groupOfKey(groups, 'P4');
    t.eq([p4.count, p4.pieceCount], [4, 5], 'L4 站点组单数/件数聚合（跨站点单 2 件同组聚合）');
    t.eq(p4.rows.map((row) => row.orderNo), ['20261101-1009', '20261101-1007', '20261101-1005', '20261101-1004'],
      'L5 组内四档动线序：需查明 → 快递柜 → 分段码 → 其他');
    t.eq(p4.rows.filter((row) => row.orderNo === '20261101-1005')[0].pieces.map((piece) => piece.cross), [false, true],
      'L6 跨站点单只归首件站点组，第二件标 cross=true（行内带站点）');
    t.eq(pickOrdersOf(groups).filter((orderNo) => orderNo === '20261101-1005').length, 1,
      'L7 跨站点订单不重复出现在多个站点组');
    const needRow = p4.rows.filter((row) => row.orderNo === '20261101-1009')[0];
    t.eq([needRow.needCode, needRow.pieces[0].text], [true, '需查明'], 'L8 需查明件给占位文案（不编假取件码）');
    t.eq(p4.rows.filter((row) => row.orderNo === '20261101-1007')[0].pieces[0].text, '8811 · 5号柜',
      'L9 件行含取件码 + 柜号');
    t.eq(groupOfKey(groups, 'P3').rows[0].anchorText, 'D4-522A', 'L10 宿舍锚 = dormKey + roomTag（只到锚级）');
    const outsider = acceptedFixture('20261101-1010', {
      parcels: [parcelFixture('P4', '北部菜鸟')],
      delivery: { zone: 'D', buildingNo: 5, buildingText: 'D5', room: '602', dormKey: 'D5-602' }
    });
    t.eq(pickGroupsOf([outsider])[0].rows[0].anchorText, 'D5-602',
      'L11 D25 他人配送地址：锚取配送地址，不拼本人 roomTag（避免跑错宿舍）');
    const guestOrder = acceptedFixture('20261101-1011', {
      dorm: null,
      delivery: null,
      parcels: [parcelFixture('P4', '北部菜鸟')],
      guest: { displayName: '访客', dormKey: 'X1-303', room: '303', zone: 'X', buildingNo: 1 }
    });
    t.eq(pickGroupsOf([guestOrder])[0].rows[0].anchorText, 'X1-303', 'L12 代客单无本人宿舍 → 锚取 guest.dormKey');
    const row = groupOfKey(groups, 'P3').rows[0];
    t.eq([row.nameText, row.counterpart, row.phoneTail], [undefined, undefined, undefined],
      'L13 待取件行不落顾客称呼/头像/手机号（只保宿舍锚与件信息）');
    const summary = pickView.summaryOf(groups);
    t.eq([summary.total, summary.pieceTotal, summary.stationCount, summary.text],
      [8, 9, 4, '共 8 单 9 件待取件 · 覆盖 4 站'], 'L14 汇总=总单数+总件数+覆盖站数（未识别站不计入站数）');
    t.eq(pickView.summaryOf([]).text, '暂无待取件的单', 'L15 空清单汇总文案（不显示 0 站）');
    const more = pickView.summaryLineOf(summary, { sortValue: 1 });
    t.check(more.loadedText.indexOf('已加载 8 单') !== -1, 'L16 还有下一页时页头明示「已加载 N 单」');
    t.eq(pickView.buildGroups([]), [], 'L17 空输入返回空集（不抛错）');
    t.eq(pickView.buildGroups([{ status: enums.ORDER_STATUS.ACCEPTED }]), [], 'L18 缺订单号的脏行跳过（不产生空行）');
    const manyOrders = [];
    for (let i = 1; i <= 45; i += 1) {
      manyOrders.push(acceptedFixture('20261101-' + String(3000 + i),
        { parcels: [parcelFixture('P4', '北部菜鸟', { pickupCode: String(7000 + i) })] }));
    }
    const manyChunks = view.splitChunks(pickView.buildGroups(manyOrders), view.CHUNK_ROWS);
    t.eq([manyChunks.length, manyChunks.filter((chunk) => chunk.rows.length > 20).length,
      manyChunks.reduce((sum, chunk) => sum + chunk.rows.length, 0)], [3, 0, 45],
    'L19 待取件 45 行 → 3 片（每片 ≤20 行、无丢行；分页/分片口径与待送达一致）');
  });

  // ------------------------------------------------------------ M. 待取件空态与复制
  h.section('M 待取件空态与复制口径（站点+取件码/运单尾号/柜号+宿舍锚；不含称呼/订单号/编号/手机尾号）', (t) => {
    if (!pickView) {
      t.check(false, 'M1 待取件纯件缺失');
      return;
    }
    const groups = pickGroupsOf(pickFixtures());
    const p4 = groupOfKey(groups, 'P4');
    const needRow = p4.rows.filter((row) => row.orderNo === '20261101-1009')[0];
    const crossRow = p4.rows.filter((row) => row.orderNo === '20261101-1005')[0];
    const rowText = pickView.rowCopyText(p4.rows.filter((row) => row.orderNo === '20261101-1007')[0]);
    t.check(rowText.indexOf('P4 北部菜鸟') === 0 && rowText.indexOf('D4-522A') !== -1
      && rowText.indexOf('8811 · 5号柜') !== -1, 'M1 单行复制含站点 + 宿舍锚 + 件（码·柜号）');
    t.eq(pickView.rowCopyText(needRow), 'P4 北部菜鸟 · D4-522A\n需查明', 'M2 需查明件单行复制保留占位（不编假码）');
    t.check(pickView.rowCopyText(crossRow).indexOf('P6 南苑菜鸟 尾号4455') !== -1,
      'M3 跨站点单的单行复制带第二站点（不缺落点）');
    const groupText = pickView.groupCopyText(p4);
    t.check(groupText.indexOf('【取件清单】 P4 北部菜鸟 · 共 4 单 5 件') === 0, 'M4 整组复制组头含站点与单/件数');
    t.eq(groupText.split('\n').length, 5, 'M5 整组复制 = 组头 1 行 + 每单 1 行（4 单）');
    t.eq(pickView.groupCopyText(null), '', 'M6 空组不生成文案');
    const allText = pickView.allCopyText(groups);
    t.check(allText.indexOf('【取件清单·待取件】 共 8 单 9 件 · 4 站') === 0, 'M7 全部复制组头含总单/总件/站数');
    t.eq(['P1 西苑顺丰', 'P3 西苑一栋南面', 'P4 北部菜鸟', 'P8 东苑一栋邮政']
      .filter((title) => allText.indexOf(title) === -1), [], 'M8 全部复制覆盖每个站点组（含站点名一行）');
    t.eq(['小王', '20261101-1009', 'C202611010001', '6678'].filter((token) => allText.indexOf(token) !== -1), [],
      'M9 复制文案不含称呼/订单号/顾客编号/手机尾号（L3 最小化）');
    t.eq([allText.indexOf('207-3-1014') !== -1, allText.indexOf('4455') !== -1, allText.indexOf('5号柜') !== -1],
      [true, true, true], 'M10 复制文案含取件码/运单尾号/柜号（兼职核对必需）');
    t.eq(pickView.allCopyText([]), '', 'M11 空清单不生成文案（复制按钮兜底）');
    const fullPlan = pickView.copyPlanOf(groups, null, 0);
    t.check(fullPlan.ok === true && fullPlan.text === allText, 'M12 拉全后复制计划给全量文案');
    const morePlan = pickView.copyPlanOf(groups, { sortValue: 1 }, 0);
    t.check(morePlan.ok === false && morePlan.needMore === true && morePlan.text === ''
      && morePlan.message.indexOf('正在拉取') !== -1, 'M13 还有下一页 → needMore 且不给半量文案（P1-7 同纪律）');
    const cappedPlan = pickView.copyPlanOf(groups, { sortValue: 1 }, pickView.MAX_AUTO_PAGES);
    t.check(cappedPlan.capped === true && cappedPlan.message.indexOf('上拉') !== -1,
      'M14 到页数上限 → 不复制并提示先上拉');
    t.eq(pickView.copyPlanOf([], null, 0).message, '当前没有可复制的清单', 'M15 空清单复制计划给兜底提示');
    t.eq(pickView.EMPTY_TEXT.indexOf('当前没有待取件的单') !== -1, true, 'M16 空态文案「当前没有待取件的单」');
  });

  // ------------------------------------------------------------ N. 双阶段页面接线与只读
  h.section('N 双阶段页面接线与只读（chip/load 分派/上拉游标/空态切换/待取件块零写控件）', (t) => {
    const page = readText(FILES.page);
    const wxml = readText(FILES.wxml);
    const stageFlowsSrc = readText(FILES.stageFlows);
    t.check(page.indexOf("require('./parts/pick-view')") !== -1, 'N1 页面引待取件纯件 pick-view');
    t.check(/this\.data\.tab === pickView\.TAB_PICK \? this\.data\.pickNextCursor : this\.data\.nextCursor/.test(page),
      'N2 上拉翻页按当前阶段取游标（待取件 pickNextCursor / 待送达 nextCursor）');
    t.check(page.indexOf('pickView.queryOf({ cursor: cursor })') !== -1
      && page.indexOf('view.queryOf({ cursor: cursor })') !== -1, 'N3 加载管线按阶段分派两条现成动作 payload');
    t.check(/emptyText: pick \? pickView\.EMPTY_TEXT : EMPTY_TEXT/.test(page), 'N4 空态文案随阶段切换');
    t.check(page.indexOf('pickTabText: tabTexts.pick') !== -1 && page.indexOf('deliverTabText: tabTexts.deliver') !== -1,
      'N5 两阶段加载都刷新 chip 计数（同一 counts 响应）');
    t.check(page.indexOf('this.applyPickResult(') !== -1 && stageFlows !== null
      && typeof stageFlows.applyPickResult === 'function', 'N6 待取件落状态方法存在并接线');
    const handlers = ['onSwitchTab', 'onCopyAllPick', 'onCopyGroupPick', 'onCopyRowPick'];
    t.eq(handlers.filter((name) => !stageFlows || typeof stageFlows[name] !== 'function'), [],
      'N7 双阶段事件方法齐全（阶段切换 + 单行/整组/全部复制）');
    t.eq(handlers.filter((name) => wxml.indexOf('bindtap="' + name + '"') === -1
      && wxml.indexOf('catchtap="' + name + '"') === -1), [], 'N8 WXML 四个新事件均接线（无死方法）');
    const pickStart = wxml.indexOf('<block wx:if="{{tab === tabPick}}">');
    const pickBlock = wxml.slice(pickStart, wxml.indexOf('<block wx:else>', pickStart));
    t.eq(['已送达', 'onRowDeliver', 'onBatchDeliver', '批量送达', '多选', 'onToggleSelecting']
      .filter((token) => pickBlock.indexOf(token) !== -1), [],
    'N9 待取件块零写控件（本批只读清单，写操作只在待送达阶段）');
    t.check(pickBlock.indexOf('bindtap="onRowTap"') !== -1 && pickBlock.indexOf('wx:for="{{row.pieces}}"') !== -1,
      'N10 待取件行点击进订单详情，且逐件渲染（码/尾号/柜号）');
    t.check(wxml.indexOf('bindtap="onCopyAllPick"') !== -1 && wxml.indexOf('bindtap="onCopyGroupPick"') !== -1,
      'N11 全部/整组复制入口渲染在 wxml');
    t.check(page.indexOf('this._pickOrders = []') !== -1 && page.indexOf('this._pickGroups = []') !== -1,
      'N12 刷新路径清待取件临时态（不残留上一阶段列表）');
    t.check(stageFlowsSrc.indexOf('this._pickOrders = more ? this._pickOrders.concat(list) : list') !== -1,
      'N13 待取件分页按游标追加（不重复/不丢页）');
    t.check(stageFlowsSrc.indexOf('view.splitChunks(this._pickGroups, view.CHUNK_ROWS)') !== -1,
      'N14 待取件分片复用 ≤20 行分片纯件');
    const title = (jsonOf(FILES.json) || {}).navigationBarTitleText;
    t.check(title === '取件清单' && wxml.indexOf('>取件清单<') !== -1, 'N15 导航标题与页内标题一致「取件清单」');
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
