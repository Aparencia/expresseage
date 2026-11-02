'use strict';
/**
 * tools/lib/partner-pages-cases.js — selftest-partner-pages 的共享夹具/静态扫描样本（T5-A 拆件）。
 *
 * 内容（从 selftest-partner-pages 纯搬移，断言不变）：
 *   - 固定时间锚 NOW/BOUND_MS（不读系统时间）；
 *   - 公开配置/兼职配置夹具 CONFIG/PARTNER（服务目录按 D41、服务范围按本人 serviceConfig）；
 *   - 绑定档案夹具 bindingRow/ROW_1/ROW_2（字段形状 = listBindings DTO）；
 *   - 订单行 DTO 夹具 orderRow/customerOrders（字段形状 = listPartner view=customer；时间输出 ISO）；
 *   - 顾客详情档案夹具 profileData；
 *   - 代客下单表单夹具：withStation/parcelOf/ticketFile/boundState/guestState/mutate（D44 逐件站点合法基线）；
 *   - 静态扫描样本：STATUS_LITERALS（七状态字面量样本）、MY_FILES/PAGE_SCRIPTS/PAGE_FILES（G 段静态纪律
 *     与四件套扫描清单）；
 *   - 接线小工具：textOfRel（只读源码）、stubTransport（api/client transport 注入点，唯一允许的桩）。
 *
 * 非独立套件：由 tools/selftest-partner-pages.js require（拆出以控测试文件 ≤950 行，门禁 #18；
 * tools/lib 不参与 tools/selftest.js 注册完整性闸，先例 tools/lib/workbench-cases.js）。
 * 纪律：夹具只读、无断言副作用；不 mock 全局 wx、不连真实网络（ENGINEERING §6.3 ADR）。
 * 取数：node tools/selftest-partner-pages.js
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const fsutil = require('./fsutil');
const client = require(path.join(ROOT, 'api/client.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const formModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/form-model.js'));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 22, 10, 0, 0).getTime();
const BOUND_MS = new Date(2026, 9, 18, 14, 20, 0).getTime();

// G 段静态扫描样本：七状态字面量（页面/纯件层不得出现）
const STATUS_LITERALS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];

const CONFIG = {
  zoneLabels: { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' },
  // D41（2026-10-28 用户拍板）：目录固定 5 类，CUSTOM 仍末项
  serviceCatalog: [
    { code: 'PICKUP_STD', name: '标准代取', desc: '驿站取件送到寝室门口（上楼）' },
    { code: 'PICKUP_LOW', name: '送至楼下', desc: '驿站取件送到宿舍楼下/约定地点（不上楼）' },
    { code: 'PICKUP_URGENT', name: '加急代取', desc: '优先处理，承诺更快时效' },
    { code: 'DROP_OFF', name: '代寄快递', desc: '顾客把件交给兼职，兼职送驿站寄出' },
    { code: 'CUSTOM', name: '其他代办', desc: '需备注说明；兼职可拒单' }
  ]
};
const PARTNER = {
  serviceConfig: {
    services: [
      { code: 'PICKUP_STD', enabled: true },
      { code: 'PICKUP_LOW', enabled: true },
      { code: 'DROP_OFF', enabled: false }
    ],
    zones: ['D', 'X'],
    acceptingOrders: true
  }
};

function bindingRow(id, overrides) {
  return Object.assign({
    bindingId: id,
    customerNo: 'C7K2M9QX4',
    dormKey: 'D4-522',
    roomTag: 'A',
    displayName: '小王',
    avatarFileId: 'cloud://test.env/avatars/x.jpg',
    phoneTail: '6678',
    buildingText: 'D4',
    partnerNote: '常放门口鞋柜',
    boundAt: BOUND_MS,
    activeOrderCount: 2
  }, overrides || {});
}
const ROW_1 = bindingRow('b1', { roomTag: 'a' });
const ROW_2 = bindingRow('b2', {
  customerNo: 'C9X1N2B3', dormKey: 'X2-301', roomTag: 'B', displayName: '',
  phoneTail: '', buildingText: 'X2', boundAt: 0, activeOrderCount: 0, avatarFileId: '', partnerNote: ''
});

// order.listPartner 行 DTO：状态/文案 + service{name} + ISO 时间戳（与 cloud _dto.buildOrderDto 同形）
function orderRow(orderNo, status, statusText, at, overrides) {
  const row = Object.assign({
    orderNo: orderNo,
    status: status,
    statusText: statusText,
    service: { code: 'PICKUP_STD', name: '标准代取' },
    createdAt: at,
    deliveredAt: 0,
    completedAt: 0,
    cancelledAt: 0
  }, overrides || {});
  ['createdAt', 'deliveredAt', 'completedAt', 'cancelledAt'].forEach((key) => {
    if (typeof row[key] === 'number' && row[key] > 0) {
      row[key] = new Date(row[key]).toISOString();
    }
  });
  return row;
}
// 该顾客订单（order.listPartner view=customer 的 list；历史单单一来源）
function customerOrders() {
  return [
    orderRow('20261022-0001', enums.ORDER_STATUS.COMPLETED, '已完成', NOW - 2 * HOUR, { completedAt: NOW - 2 * HOUR }),
    orderRow('20261022-0002', enums.ORDER_STATUS.ACCEPTED, '已接单', NOW - 3 * HOUR),
    orderRow('20261021-0003', enums.ORDER_STATUS.DELIVERED, '已送达·待确认', NOW - DAY - 2 * HOUR, { deliveredAt: NOW - DAY - 2 * HOUR }),
    orderRow('20261015-0004', enums.ORDER_STATUS.SUBMITTED, '待接单', NOW - 7 * DAY)
  ];
}
// partner.getCustomer 只取档案+解绑资格（orders 字段本页不消费）
function profileData(overrides) {
  return Object.assign({
    customer: ROW_1,
    activeOrderCount: 2,
    unbindEligibility: { canUnbind: false, activeOrderCount: 2 },
    partnerNo: 'P8F3K2M'
  }, overrides || {});
}
// D44：每件包裹自带站点；withStation 把件补成「合法基线件」（默认 P4，可覆盖）
function withStation(item, stationId) {
  const id = stationId || 'P4';
  const options = formModel.stationOptionsOf();
  return Object.assign({}, item, {
    stationId: id,
    stationName: stations.stationNameOf(id),
    stationIndex: formModel.stationIndexOf(options, id),
    stationTouched: true
  });
}
function parcelOf(fields) {
  const value = Object.assign({ pickupCode: '', lockerNo: '', trackingTail: '' }, fields || {});
  return withStation(value, value.stationId || 'P4');
}
function ticketFile(index) {
  const seq = String(index || 1);
  return {
    localPath: 'wxfile://tmp/ticket-' + seq + '.jpg',
    fileId: 'cloud://test.env/orders/TKT' + seq + '/image.jpg',
    uploadTicketId: 'TICKET' + seq.padStart(26, '0'),
    size: 320 * 1024,
    name: 'ticket-' + seq + '.jpg',
    type: 'image'
  };
}
function boundState() {
  const state = formModel.createInitialState({
    config: CONFIG, partner: PARTNER, bindingList: [ROW_1, ROW_2], nowMs: NOW
  });
  state.items = [parcelOf({ pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' })];
  state.files = [ticketFile(1)];
  return state;
}
function guestState() {
  const state = formModel.createInitialState({ config: CONFIG, partner: PARTNER, bindingList: [], nowMs: NOW });
  state.customerMode = 'GUEST';
  state.guest = { displayName: '小张', phoneTail: '6678', zone: 'D', buildingNo: '4', room: '522', dormKey: '' };
  state.items = [parcelOf({ pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785' })];
  state.files = [ticketFile(1)];
  return state;
}
function mutate(state, patch) {
  return Object.assign({}, state, patch);
}
function textOfRel(rel) {
  return fsutil.readText(path.join(ROOT, rel)) || '';
}
function stubTransport(fn) {
  client.setTransport(fn);
}

const MY_FILES = [
  'pages/partner/customers/index.js',
  'pages/partner/customers/index.wxml',
  'pages/partner/customers/parts/list-model.js',
  'pages/partner/customers/parts/filter-model.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/customer-detail/index.wxml',
  'pkg-partner/pages/customer-detail/parts/detail-view.js',
  'pkg-partner/pages/customer-detail/parts/unbind-flow.js',
  'pkg-partner/pages/create-on-behalf/index.js',
  'pkg-partner/pages/create-on-behalf/index.wxml',
  'pkg-partner/pages/create-on-behalf/parts/form-model.js',
  'pkg-partner/pages/create-on-behalf/parts/payload-model.js',
  'pkg-partner/pages/create-on-behalf/parts/recognize-model.js',
  'pkg-partner/pages/create-on-behalf/parts/recognize-flow.js',
  'pkg-partner/pages/create-on-behalf/parts/view-model.js',
  'pkg-partner/pages/create-on-behalf/parts/result-model.js',
  'components/image-picker/state.js',
  'components/image-picker/index.js',
  'utils/customer-view.js'
];

const PAGE_SCRIPTS = [
  'pages/partner/customers/index.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/create-on-behalf/index.js'
];

const PAGE_FILES = [
  'pages/partner/customers/index',
  'pkg-partner/pages/customer-detail/index',
  'pkg-partner/pages/create-on-behalf/index'
];

// ── 批20-C：客户页首屏流式/占位/刷新 diff/空 dormKey 置底/底部安全区（P 组；拆出控主套件 ≤950 行）──
const customerView = require(path.join(ROOT, 'utils/customer-view.js'));
const listModel = require(path.join(ROOT, 'pages/partner/customers/parts/list-model.js'));
const PERF_EXPECTED_ASSERTIONS = 39;

async function perfChecks(t) {
    const customersWxmlP = textOfRel('pages/partner/customers/index.wxml');
    const customersWxssP = textOfRel('pages/partner/customers/index.wxss');
    const customersPageP = textOfRel('pages/partner/customers/index.js');
    const serverCustomer = require(path.join(ROOT, 'cloudfunctions/api/handlers/partner/_customer.js'));
    const zonesLib = require(path.join(ROOT, 'cloudfunctions/api/shared/zones.js'));
    const rowsOf = (count) => customerView.buildListRows(
      Array.from({ length: count }, (_, index) => bindingRow('p' + index, { dormKey: 'D4-' + (500 + index) }))
    );

    // ① 首屏骨架 = 6 张灰色占位卡（与真实行同构：头像圆 + 两行灰条）
    const skeletonP = customerView.listStateOf({ rows: [], loading: true, error: '', keyword: '', nextCursor: '' });
    t.eq([skeletonP.mode, skeletonP.skeletonRows.length], ['skeleton', 6],
      'P1 首屏骨架恰 6 张灰色占位卡（用户「一次性全部出现、视觉上慢」）');
    t.check(/skeleton-avatar/.test(customersWxmlP) && (customersWxmlP.match(/skeleton-line/g) || []).length >= 2,
      'P2 占位卡结构 = 头像圆 + 两行灰条（与真实行同构，不是纯文字）');
    t.check(/\.skeleton-card\s*\{[^}]*min-height:\s*176rpx/.test(customersWxssP),
      'P3 占位卡 min-height=176rpx 与真实行同高（数据到达不跳版）');

    // ② 分片 setData：首片 ≤10 行立即渲染，其余按 rows[n] 路径逐帧追加（不一次性渲染 20 行）
    const thirteen = rowsOf(13);
    const planP = listModel.chunkPlanOf(thirteen);
    t.eq([planP.first.length, planP.rest.length, planP.rest[0].length], [10, 1, 3],
      'P4 13 行 → 首片 10 行 + 尾片 3 行（每片 ≤10 行）');
    const appendP = listModel.appendPlanOf(planP);
    t.eq(Object.keys(appendP.appendPatches[0]), ['rows[10]', 'rows[11]', 'rows[12]'],
      'P5 追加补丁只发 rows[n] 路径（不重发已渲染的 10 行）');
    t.eq(appendP.renderedCount, thirteen.length, 'P6 分片合计 = 全量行数（不重不漏）');
    t.eq(listModel.chunkPlanOf(rowsOf(20)).rest.length, 1,
      'P7 满页 20 行 = 两片 setData（首屏只渲染 10 行，剩下一帧追加）');
    t.eq([listModel.STREAM_CHUNK_ROWS, listModel.chunkPlanOf([]).first.length], [10, 0],
      'P8 分片常量 10 行；空列表不出片（不画假行）');
    const planReplace = listModel.viewPlanOf(
      listModel.applyResponse(listModel.createState(), { list: rowsOf(13), nextCursor: '' }, { nowMs: NOW }),
      { prevRows: [], partnerNo: '', readonly: false, session: false }
    );
    t.check(planReplace.mode === 'replace' && planReplace.setData.rows.length === 10
      && planReplace.appendPatches.length === 1 && planReplace.chunk !== null,
    'P9 首屏结果 = 首片 10 行 setData + 1 帧追加；页面接线 viewPlanOf/appendChunks/_chunkToken');
    t.check(customersPageP.indexOf('listModel.viewPlanOf') >= 0 && customersPageP.indexOf('appendChunks') >= 0
      && /_chunkToken/.test(customersPageP), 'P10 客户页接线：结果走 viewPlanOf、分片逐帧追加、_chunkToken 作废旧片');

    // ③ 请求在途「更新中…」+ 刷新保留旧列表（不闪骨架、不跳顶部）
    const oldRowsP = rowsOf(2);
    const loadingP = customerView.listStateOf({
      rows: oldRowsP, loading: true, error: '', keyword: '', nextCursor: '', lastSuccessAt: NOW
    });
    t.eq([loadingP.mode, loadingP.footerText], ['list', '更新中…'],
      'P11 刷新在途：保留旧列表（不切骨架），底部小字「更新中…」');
    t.check(customerView.listStateOf({ rows: oldRowsP, loading: false, error: '', keyword: '', nextCursor: '' })
      .footerText !== '更新中…', 'P12 非在途不显示「更新中…」（文案只对应真实在途）');

    // ④ 刷新行级 diff：同 bindingId+avatarFileId 沿用旧 avatarUrl；只改变动行
    const avatarRow = Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/old.jpg' });
    const firstP = listModel.applyResponse(listModel.createState(), { list: [avatarRow], nextCursor: '' }, { nowMs: NOW });
    const reSigned = listModel.applyResponse(firstP,
      { list: [Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/new.jpg' })], nextCursor: '' },
      { nowMs: NOW + 1000 });
    t.eq(reSigned.rows[0].avatarUrl, 'https://tmp.example/old.jpg',
      'P13 同 bindingId 且 avatarFileId 未变 → 沿用旧 avatarUrl（服务端重签不闪头像）');
    const retried = listModel.applyResponse(firstP,
      { list: [Object.assign({}, ROW_1, { avatarUrl: 'https://tmp.example/retry.jpg' })], nextCursor: '' },
      { nowMs: NOW + 1500, freshAvatars: true });
    t.eq(retried.rows[0].avatarUrl, 'https://tmp.example/retry.jpg',
      'P13b 头像加载失败点重试（freshAvatars）→ 换新签 URL，不沿用旧 URL');
    t.check(textOfRel('pages/partner/customers/index.js').indexOf('load(true, { freshAvatars: true })') >= 0,
      'P13c 客户页 onAvatarRetry 走 freshAvatars 分支（重试按钮真的能重签头像）');
    const fileChanged = listModel.applyResponse(firstP,
      { list: [Object.assign({}, ROW_1, { avatarFileId: 'cloud://test.env/avatars/y.jpg', avatarUrl: 'https://tmp.example/new2.jpg' })], nextCursor: '' },
      { nowMs: NOW + 1000 });
    t.eq(fileChanged.rows[0].avatarUrl, 'https://tmp.example/new2.jpg',
      'P14 avatarFileId 变了 → 换新 avatarUrl（不沿用旧头像/不张冠李戴）');
    const diffP = listModel.rowPatchesOf(firstP.rows, reSigned.rows);
    t.eq(diffP, {}, 'P15 内容未变 → 零行补丁（onShow 刷新不重发整表）');
    const renamed = reSigned.rows.map((row, index) => (index === 0 ? Object.assign({}, row, { displayNameText: '改名' }) : row));
    t.eq(Object.keys(listModel.rowPatchesOf(reSigned.rows, renamed)), ['rows[0]'],
      'P16 只有第 1 行变化 → 只发 rows[0]（行级 diff，只改变动行）');
    t.eq(listModel.rowPatchesOf(reSigned.rows, rowsOf(3)), null,
      'P17 行数/顺序变化 → 返回 null 回退整表分片（不据旧下标打补丁）');
    const planDiff = listModel.viewPlanOf(listModel.applyResponse(firstP, { list: [avatarRow], nextCursor: '' }, { nowMs: NOW + 2000 }),
      { prevRows: firstP.rows, partnerNo: '', readonly: false, session: false });
    t.check(planDiff.mode === 'diff' && planDiff.chunk === null && !('rows' in planDiff.setData),
      'P18 结构不变 → diff 计划：不整表下发 rows、不触发分片');
    const appendPlanP = listModel.viewPlanOf(
      listModel.applyResponse(firstP, { list: [avatarRow, ROW_2], nextCursor: '' }, { nowMs: NOW + 3000 }),
      { prevRows: firstP.rows, partnerNo: '', readonly: false, session: false }
    );
    t.check(appendPlanP.mode === 'append' && appendPlanP.appendPatches.length === 1
      && Object.keys(appendPlanP.appendPatches[0])[0] === 'rows[1]' && !('rows' in appendPlanP.setData),
    'P18b 触底追加：旧列表是新列表前缀 → 只发 rows[1] 追加补丁（不清空/不重发旧行）');

    // ⑤ 空 dormKey（资料未完善）置底 + 游标分页不重不漏（服务端纯件）
    const entriesP = [
      { row: { dormKey: '' }, allocSeq: 5 },
      { row: { dormKey: 'X2-301' }, allocSeq: 2 },
      { row: { dormKey: '' }, allocSeq: 3 },
      { row: { dormKey: 'D4-522' }, allocSeq: 1 },
      { row: { dormKey: 'D10-900' }, allocSeq: 0 }
    ];
    const sortedP = entriesP.slice().sort(serverCustomer.compareBindingEntries);
    t.eq(sortedP.map((entry) => [entry.row.dormKey, entry.allocSeq]),
      [['D4-522', 1], ['D10-900', 0], ['X2-301', 2], ['', 3], ['', 5]],
      'P19 空 dormKey 恒置底；非空仍按苑固定序→栋号→宿舍号数值');
    t.check(zonesLib.compareDormKey('', 'D4-522') < 0,
      'P20 基线反证：裸 compareDormKey 把空 dormKey 排最前（旧缺陷根因，判据有牙）');
    t.eq(serverCustomer.bindingCursorOf({ row: { dormKey: '' }, allocSeq: 3 }), { dormKey: '', allocSeq: 3 },
      'P21 空 dormKey 行也产游标（旧实现返回 null → 后续页丢失）');
    t.eq(serverCustomer.parseBindingCursor({ dormKey: '', allocSeq: 3 }), { dormKey: '', allocSeq: 3 },
      'P22 parseBindingCursor 接受空 dormKey 游标（分页锚；旧实现抛"游标不正确"）');
    t.eq(serverCustomer.isAfterBindingCursor({ row: { dormKey: '' }, allocSeq: 2 }, { dormKey: '', allocSeq: 3 }),
      false, 'P23 空桶游标之前的空行不再重复返回');
    t.eq(serverCustomer.isAfterBindingCursor({ row: { dormKey: 'D4-522' }, allocSeq: 9 }, { dormKey: '', allocSeq: 3 }),
      false, 'P24 已翻到空桶后非空行不再返回（空置底后不漏不重）');
    const paginateP = (list, size, cursorOf) => {
      const sorted = list.slice().sort(serverCustomer.compareBindingEntries);
      const pages = [];
      let cursor = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const rest = sorted.filter((entry) => serverCustomer.isAfterBindingCursor(entry, cursor));
        if (!rest.length) break;
        const page = rest.slice(0, size);
        pages.push(page);
        cursor = cursorOf(page[page.length - 1]);
        if (!cursor) break;
      }
      return pages;
    };
    const pagesP = paginateP(entriesP, 2, serverCustomer.bindingCursorOf);
    t.eq(pagesP.map((page) => page.length), [2, 2, 1], 'P25 空置底后游标分页：5 行 = 2+2+1 页');
    t.eq([].concat(...pagesP).map((entry) => entry.row.dormKey + ':' + entry.allocSeq),
      sortedP.map((entry) => entry.row.dormKey + ':' + entry.allocSeq),
      'P26 分页拼接 = 全序（不重不漏，尾部空 dormKey 行可达）');
    const oldCursorOf = (entry) => (entry.row.dormKey ? { dormKey: entry.row.dormKey, allocSeq: entry.allocSeq } : null);
    t.check([].concat(...paginateP(entriesP, 2, oldCursorOf)).length < entriesP.length,
      'P27 正控：旧实现（空 dormKey 不产游标）翻页丢尾部行（判据有牙）');
    t.throws(() => serverCustomer.parseBindingCursor({ dormKey: 5, allocSeq: 1 }),
      /游标/, 'P28 非法游标（dormKey 非串）仍被拒（收紧不放水）');
    t.throws(() => serverCustomer.parseBindingCursor({ dormKey: '', allocSeq: -1 }),
      /游标/, 'P29 非法游标（allocSeq 负数）仍被拒');

    // ⑥ 首页计数只扫本页顾客（≤5 次查询，不再全量扫全部进行中单）
    const countedQueries = [];
    const fakeCtxP = {
      dao: {
        command(name, value) { return { op: name, value: value }; },
        find(collection, options) {
          countedQueries.push(options);
          const status = options.where && options.where.status;
          if (status === enums.ORDER_ACTIVE_STATUSES[0]) return Promise.resolve([{ customerId: 'c1' }, { customerId: 'c1' }]);
          if (status === enums.ORDER_ACTIVE_STATUSES[1]) return Promise.resolve([{ customerId: 'c2' }]);
          return Promise.resolve([]);
        }
      }
    };
    const countsP = await serverCustomer.activeCountsOfPage(fakeCtxP, 'partner-1', ['c1', 'c2']);
    t.eq([countedQueries.length, countsP], [enums.ORDER_ACTIVE_STATUSES.length, { c1: 2, c2: 1 }],
      'P30 只按 5 个进行中状态各 1 次查询，只统计本页顾客（旧实现全量分页扫描）');
    t.check(countedQueries.every((options) => options.where.partnerId === 'partner-1'
      && options.where.customerId && options.where.customerId.op === 'in'
      && options.where.customerId.value.join(',') === 'c1,c2' && options.where.isTest === false),
    'P31 每次查询都带 partnerId 归属 + 本页 customerId in 过滤 + 测试数据隔离谓词');
    const emptyCountsP = await serverCustomer.activeCountsOfPage(fakeCtxP, 'partner-1', []);
    t.eq([emptyCountsP, countedQueries.length], [{}, enums.ORDER_ACTIVE_STATUSES.length],
      'P32 空页零查询（不空转；计数 0 不查库）');

    // ⑦ 客户端「资料未完善」标 + 底部安全区
    const emptyRowP = customerView.buildListRow(bindingRow('p-empty', { dormKey: '', buildingText: '' }));
    t.eq([emptyRowP.incompleteText, emptyRowP.anchorText], ['资料未完善', ''],
      'P33 dormKey 空的行标「资料未完善」，不显示假宿舍锚');
    t.check(customersWxmlP.indexOf('incompleteText') >= 0, 'P34 WXML 渲染「资料未完善」标（行上可见）');
    t.check(/\.bottom-actions\s*\{[^}]*120rpx[^}]*env\(safe-area-inset-bottom\)/.test(customersWxssP),
      'P35 底部按钮区 120rpx + env(safe-area-inset-bottom) 底垫（tabBar 100rpx 不挡「分享绑定卡片」）');
    t.notEmpty(entriesP, 'P 组样本非空（防止空集全绿）');
}

module.exports = {
  CONFIG,
  DAY,
  HOUR,
  MY_FILES,
  NOW,
  PAGE_FILES,
  PAGE_SCRIPTS,
  PERF_EXPECTED_ASSERTIONS,
  perfChecks,
  PARTNER,
  ROW_1,
  ROW_2,
  STATUS_LITERALS,
  bindingRow,
  boundState,
  customerOrders,
  guestState,
  mutate,
  orderRow,
  parcelOf,
  profileData,
  stubTransport,
  textOfRel,
  ticketFile,
  withStation
};
