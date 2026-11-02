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
 *   - Q 组（批27/D59 团队页）：teamCaptainDto/teamMemberDto 夹具 + teamChecks（成员/子码批次作废/移除/
 *     名额/子队员摘要/零判据静态扫；服务端 DTO 形状 = partner.listSubMembers）；
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
const partnerApi = require(path.join(ROOT, 'api/modules/partner.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const formModel = require(path.join(ROOT, 'pkg-partner/pages/create-on-behalf/parts/form-model.js'));
const teamModel = require(path.join(ROOT, 'pkg-partner/pages/team/parts/team-model.js'));
const zeroMoney = require('../zero-money-scan');

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
  'utils/customer-view.js',
  // 批 27/D59：团队页（四件套中的脚本/WXML + 纯件）纳入静态纪律扫描
  'pkg-partner/pages/team/index.js',
  'pkg-partner/pages/team/index.wxml',
  'pkg-partner/pages/team/parts/team-model.js'
];

const PAGE_SCRIPTS = [
  'pages/partner/customers/index.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/create-on-behalf/index.js',
  'pkg-partner/pages/team/index.js'
];

const PAGE_FILES = [
  'pages/partner/customers/index',
  'pkg-partner/pages/customer-detail/index',
  'pkg-partner/pages/create-on-behalf/index',
  'pkg-partner/pages/team/index'
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

// ── 批 27/D59：团队页（Q 组）夹具与静态纪律样本 ──────────────────────────────
// 服务端 DTO = partner.listSubMembers：主兼职 {members[],pendingInvites[],quota{used,reserved,max}}，
// 子队员 {team{parentPartnerNo,memberCount},members[],pendingInvites[],quota:null}
// 名额口径（批 26 收尾/W3）：reserved = 在队队员 + 未过期待用子码（与发码闸同口径），页面按 max-reserved 收窄。
const TEAM_BATCH_A = 'TB20261022-1';
const TEAM_BATCH_B = 'TB20261021-2';
const TEAM_RELS = [
  'pkg-partner/pages/team/index.js',
  'pkg-partner/pages/team/index.json',
  'pkg-partner/pages/team/index.wxml',
  'pkg-partner/pages/team/index.wxss',
  'pkg-partner/pages/team/parts/team-model.js'
];
// 队伍/邀请码状态字面量（页面层零判据：状态中文只取 shared/enums 标签表）
const TEAM_STATUS_WORDS = ['UNUSED', 'USED', 'REVOKED', 'EXPIRED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'SUB', 'DEV', 'PENDING'];
// Q 组断言数（含首红正控；实跑为准，改断言必须同步本条）
const TEAM_PAGE_ASSERTIONS = 48;

function teamCaptainDto(overrides) {
  return Object.assign({
    members: [
      { partnerNo: 'P8F3K2M', displayName: '小王', status: enums.PARTNER_STATUS.ACTIVE, teamJoinedAt: NOW - 2 * DAY },
      { partnerNo: 'P7A2B9C', displayName: '', status: enums.PARTNER_STATUS.SUSPENDED, teamJoinedAt: 0 }
    ],
    pendingInvites: [
      { codeTail: 'EFGH', expiresAt: NOW + 2 * DAY, batchId: TEAM_BATCH_A },
      { codeTail: 'JKLM', expiresAt: NOW + 3 * DAY, batchId: TEAM_BATCH_A },
      { codeTail: 'NPQR', expiresAt: NOW + DAY, batchId: TEAM_BATCH_B }
    ],
    quota: { used: 2, reserved: 5, max: 5 }
  }, overrides || {});
}

function teamMemberDto(overrides) {
  // 服务端子队员返回：team 包装 + 三个空集合 + quota:null（只看队伍摘要）
  return Object.assign({
    team: { parentPartnerNo: 'P8F3K2M', memberCount: 3 },
    members: [],
    pendingInvites: [],
    quota: null
  }, overrides || {});
}

function stripWxmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, '');
}

function teamStatusLiteralHits(text) {
  const hits = [];
  TEAM_STATUS_WORDS.forEach((word) => {
    if (new RegExp("['\"]" + word + "['\"]").test(text)) hits.push(word);
  });
  return hits;
}

async function teamChecks(t) {
  const pageSrc = textOfRel('pkg-partner/pages/team/index.js');
  const modelSrc = textOfRel('pkg-partner/pages/team/parts/team-model.js');
  const wxmlSrc = textOfRel('pkg-partner/pages/team/index.wxml');
  const jsonSrc = textOfRel('pkg-partner/pages/team/index.json');
  const settingsSrc = textOfRel('pkg-partner/pages/service-settings/index.js');
  const settingsWxml = textOfRel('pkg-partner/pages/service-settings/index.wxml');
  const apiSrc = textOfRel('api/modules/partner.js');

  // ① 视图模型基线（主兼职 / 子队员 / 名额 / 待用码）
  const initial = teamModel.initialView();
  t.eq([initial.loading, initial.hasData, initial.captain, initial.member, initial.members.length, initial.form, initial.noteMax],
    [true, false, false, false, 0, { count: 1, validity: '24H', note: '' }, 50],
    'Q1 初始视图：加载中且无假数据；默认数量 1/有效期 24 小时/备注上限 50 字');
  const view = teamModel.buildSnapshot(teamCaptainDto(), { nowMs: NOW });
  t.eq([view.captain, view.member, view.hasData, view.members.length, view.inviteGroups.length], [true, false, true, 2, 2],
    'Q2 主兼职基线：队长视角 + 2 名队员 + 2 个待用批次（服务端已排序分组，客户端不重排）');
  t.eq(view.members[0], {
    key: 'P8F3K2M',
    partnerNo: 'P8F3K2M',
    displayNameText: '小王',
    statusText: enums.PARTNER_STATUS_LABELS.ACTIVE,
    joinedText: '加入 2026-10-20'
  }, 'Q3 成员行：昵称 + 编号 + 状态中文（取 shared/enums 标签表）+ 加入日期');
  t.eq([view.members[1].displayNameText, view.members[1].statusText, view.members[1].joinedText],
    ['未填称呼', enums.PARTNER_STATUS_LABELS.SUSPENDED, ''],
    'Q4 昵称缺失回落「未填称呼」；停用成员仍列出；无加入时间不造假日');
  t.eq(Object.keys(view.members[0]).sort(), ['displayNameText', 'joinedText', 'key', 'partnerNo', 'statusText'],
    'Q5 成员行键集合恰为白名单（D59：主兼职只看到编号/昵称/状态/加入时间）');
  t.check(!/avatar|fileId|openid/i.test(JSON.stringify(view)),
    'Q6 团队页视图零头像/fileId/openid 字段（D19/D59：隐私面不扩大）');
  t.eq(view.inviteGroups.map((group) => group.batchId), [TEAM_BATCH_A, TEAM_BATCH_B],
    'Q7 待用子码按 batchId 分组、保持服务端顺序（作废以批为单位 = Lead 裁决）');
  t.eq([view.inviteGroups[0].rows.length, view.inviteGroups[0].rowCountText,
    view.inviteGroups[0].rows[0].codeTailText, view.inviteGroups[0].rows[0].expiresText],
  [2, '2 个待使用', '尾号 EFGH', '到期 2026-10-24 10:00'],
  'Q8 组内逐码只显示尾 4 位 + 到期时刻（完整码只在创建响应）');
  const available = teamModel.buildSnapshot(teamCaptainDto({ pendingInvites: [], quota: { used: 2, max: 5 } }), { nowMs: NOW });
  t.eq([available.quota.usedText, available.quota.canCreate, available.quota.disabled, available.quota.remaining],
    ['已用 2 / 5 人（含待使用邀请码）', true, false, 3],
    'Q9 名额基线：按 reserved/max 展示 + 可发码（旧服务端缺 reserved 时回退 max-used-pending=3）');
  const fullByPending = teamModel.buildSnapshot(teamCaptainDto(), { nowMs: NOW }).quota;
  const fullByMembers = teamModel.buildSnapshot(teamCaptainDto({
    pendingInvites: [],
    quota: { used: 5, reserved: 5, max: 5 }
  }), { nowMs: NOW }).quota;
  t.check(fullByPending.canCreate === false && fullByPending.disabled === true
    && fullByPending.reserved === 5 && fullByPending.fullReasonText.indexOf('队员+待用码已占用 5/5') >= 0
    && fullByPending.fullReasonText.indexOf('待用码 3 个') >= 0
    && fullByMembers.fullReasonText.indexOf('人数已达上限') >= 0 && fullByMembers.fullReasonText.indexOf('5/5') >= 0,
  'Q10 名额达上限禁用发码 + 按 reserved 给原因（队员 2 + 待用码 3 = 5/5；人数本身占满另说真话）');
  t.eq([view.countOptions, available.countOptions,
    teamModel.buildSnapshot(teamCaptainDto({ pendingInvites: [], quota: { used: 4, max: 5 } }), { nowMs: NOW }).countOptions],
  [[], [1, 2, 3], [1]], 'Q11 数量选项 1~5 内按 max-reserved 收窄；满员前最后一码仍可发');
  const reservedWins = teamModel.buildSnapshot(teamCaptainDto({ quota: { used: 1, reserved: 4, max: 5 } }), { nowMs: NOW });
  t.eq([reservedWins.quota.reserved, reservedWins.quota.remaining, reservedWins.countOptions, reservedWins.quota.usedText],
    [4, 1, [1], '已用 4 / 5 人（含待使用邀请码）'],
    'Q11b 服务端 quota.reserved=4（含 3 个待用码）→ 剩余 1、选项收窄 [1]；不再叠加本页待用码数（双计必为 0）');
  const fallbackWins = teamModel.buildSnapshot(teamCaptainDto({ quota: { used: 1, max: 5 } }), { nowMs: NOW });
  t.eq([fallbackWins.quota.reserved, fallbackWins.quota.remaining, fallbackWins.countOptions],
    [4, 1, [1]],
    'Q11c 旧服务端缺 reserved → 回退本地 used+本页待用码推导（1+3=4，剩余 1）；兼容期不放行超发');
  t.eq(view.validityOptions.map((item) => [item.key, item.label]),
    [['24H', '24 小时'], ['72H', '72 小时'], ['7D', '7 天']],
    'Q12 有效期恰三档 24h/72h/7d 且文案非空（D59）');

  // ② 发码提交体与校验转发（服务端仍唯一权威）
  t.eq(teamModel.buildCreatePayload({ count: 2, validity: '7D', note: ' 给小李 ' }),
    { ok: true, data: { count: 2, validity: '7D', note: '给小李' }, message: '' },
    'Q13 发码提交体基线：数量/有效期/备注去空白后原样转发');
  const badCounts = [0, 6, 2.5, 'abc'].map((value) => teamModel.buildCreatePayload({ count: value, validity: '24H', note: '' }));
  t.eq(badCounts.map((item) => item.ok), [false, false, false, false],
    'Q14 非法数量（0/超 5/小数/非数字串）一律本地挡住（不盲发请求）');
  t.eq([teamModel.buildCreatePayload({ count: 1, validity: '30D', note: '' }).ok,
    teamModel.buildCreatePayload({ count: 1, validity: '24H', note: '' }).ok], [false, true],
  'Q15 有效期只接受三档；备注可缺省（空备注合法提交）');
  t.eq([teamModel.buildCreatePayload({ count: 1, validity: '24H', note: '备'.repeat(51) }).message,
    teamModel.buildCreatePayload({ count: 1, validity: '24H', note: '备'.repeat(50) }).ok],
  ['备注最多 50 字', true], 'Q16 备注 >50 字被挡、恰 50 字通过（与 shared/validate teamNote 同上限）');

  // ③ 创建结果块（完整码只在本会话展示一次）
  const result = teamModel.resultOf({ batchId: TEAM_BATCH_A, codes: ['ABCD2345EFGH', 'JKLM2345NPQR'], expiresAt: NOW + DAY }, NOW);
  t.eq([result.visible, result.title, result.codeRows.map((row) => row.display)],
    [true, '已生成 2 个子邀请码', ['ABCD-2345-EFGH', 'JKLM-2345-NPQR']],
    'Q17 创建成功结果块：完整码 4-4-4 分组展示（一次性口径）');
  t.check(result.hintText.indexOf('只显示这一次') >= 0 && result.hintText.indexOf('当面告知') >= 0
    && result.expiresText === '有效期至 2026-10-23 10:00',
  'Q18 结果块提示「只显示这一次/请当面告知」并带到期时刻');
  t.eq(teamModel.resultOf({ batchId: '', codes: [], expiresAt: 0 }, NOW).visible, false,
    'Q19 空码响应不画假结果块（空集不得判绿）');

  // ④ 批次级作废 / 移除队员（二次确认 + 提交体）
  t.eq([teamModel.buildRevokePayload(view.inviteGroups[0]), teamModel.buildRevokePayload({ batchId: '' }).ok],
    [{ ok: true, data: { batchId: TEAM_BATCH_A }, message: '' }, false],
    'Q20 作废提交体按批次 {batchId}（裁决：不改完整码暴露面）；缺批次号不盲发');
  const revokeDialog = teamModel.revokeConfirmDialog(view.inviteGroups[0]);
  t.check(revokeDialog.content.indexOf('2 个未使用的邀请码') >= 0 && revokeDialog.content.indexOf('全部失效') >= 0
    && revokeDialog.content.indexOf('已使用的码不受影响') >= 0 && revokeDialog.confirmText === '确认作废',
  'Q21 作废二次确认写清后果（本批未用码全部失效、已用码不受影响）');
  t.eq([teamModel.buildRemovePayload({ partnerNo: 'P8F3K2M' }), teamModel.buildRemovePayload({ partnerNo: '' }).ok],
    [{ ok: true, data: { partnerNo: 'P8F3K2M' }, message: '' }, false],
    'Q22 移除提交体 {partnerNo}；缺编号不盲发');
  t.check(teamModel.removeConfirmDialog(view.members[0]).content.indexOf('停用') >= 0
    && teamModel.removeConfirmDialog(view.members[0]).content.indexOf('联系管理员') >= 0,
  'Q23 移除二次确认写清后果（对方被停用、恢复需联系管理员）');
  const memberView = teamModel.buildSnapshot(teamMemberDto(), { nowMs: NOW });
  t.eq([memberView.member, memberView.captain, memberView.team.parentPartnerNo, memberView.team.memberCountText,
    memberView.showCreateForm, memberView.members.length, memberView.inviteGroups.length],
  [true, false, 'P8F3K2M', '3 人', false, 0, 0],
  'Q24 子队员视角：只显示所属队伍 P-XXX / 成员数（数值「3 人」，行标签由 WXML 承载），无成员列表与发码/作废入口（D59 仅一层）');
  const readonlyView = teamModel.buildSnapshot(teamCaptainDto(), { nowMs: NOW, readonly: true });
  t.eq([readonlyView.canWrite, readonlyView.showCreateForm, readonlyView.readonlyText],
    [false, false, '开发者只读视角不能操作'],
    'Q25 READONLY：隐藏发码表单/移除/作废按钮并给只读原因（切换会话二道闸）');
  t.eq([teamModel.selectCount(view.form, 3).count, teamModel.selectCount(view.form, 9).count,
    teamModel.selectValidity(view.form, '7D').validity, teamModel.selectValidity(view.form, '30D').validity,
    Array.from(teamModel.inputNote(view.form, '备'.repeat(60)).note).length],
  [3, 1, '7D', '24H', 50],
  'Q26 交互归一：数量/有效期非法值不生效；备注超长按 50 字截断（输入框 maxlength 双保险）');
  t.eq([teamModel.revokedTextOf({ revokedCount: 2 }), teamModel.revokedTextOf({})],
    ['已作废 2 个邀请码', '邀请码已作废'], 'Q27 作废成功文案带服务端 revokedCount（不本地猜数量）');

  // ⑤ 四件套/接线/静态纪律（页面层零判据）
  const four = ['js', 'json', 'wxml', 'wxss'].map((ext) => fsutil.exists(path.join(ROOT, 'pkg-partner/pages/team/index.' + ext)));
  t.eq(four.concat([jsonSrc.indexOf('"enablePullDownRefresh": true') >= 0, pageSrc.indexOf('onPullDownRefresh()') >= 0]),
    [true, true, true, true, true, true],
    'Q28 团队页四件套齐全 + 下拉刷新 handler 与 json 开关对齐（#39 纪律）');
  t.eq(['.listSubMembers(', '.createSubInvites(', '.revokeSubInvite(', '.removeSubMember(',
    "'./parts/team-model'", 'modeGuard.canRenderWriteButton()', "'../../../api/modules/partner'"]
    .map((token) => pageSrc.indexOf(token) >= 0), [true, true, true, true, true, true, true],
  'Q29 页面接线：四个动作只经 api/modules/partner + 纯件单向依赖 + READONLY 由 modeGuard 判');
  const layerCode = [pageSrc, modelSrc].map((src) => fsutil.stripComments(src)).join('\n');
  t.eq([/wx\.cloud\./.test(layerCode), /Math\.random|\brandom\(/.test(layerCode),
    /wx\.[A-Za-z]*Storage[A-Za-z]*/.test(layerCode), /['"]partner\.[a-z]/.test(layerCode)],
  [false, false, false, false],
  'Q30 页面/纯件零 wx.cloud/random/本地存储直写/action 字符串（铁律 §2、门禁 #14/#15/#21）');
  const scanned = [fsutil.stripComments(pageSrc), stripWxmlComments(wxmlSrc), fsutil.stripComments(modelSrc)].join('\n');
  t.eq(teamStatusLiteralHits(scanned), [],
    'Q31 团队页零队伍/邀请码状态字面量（状态中文只取 shared/enums 标签表，页面层零判据）');
  t.check(teamStatusLiteralHits("code.status === 'UNUSED' && item.status === 'ACTIVE'").length === 2,
    'Q31b 有牙正控：判据能扫出状态字面量样本（不是空转全绿）');
  const privacyHits = ['avatar', 'fileid', 'openid', 'wx.cloud'].filter((token) =>
    (fsutil.stripComments(pageSrc) + stripWxmlComments(wxmlSrc) + fsutil.stripComments(modelSrc)).toLowerCase()
      .indexOf(token) >= 0);
  t.eq(privacyHits, [], 'Q32 团队页零头像/fileId/openid 痕迹（D59：主兼职看编号+昵称，无头像）');
  const teamMoneyHits = [];
  TEAM_RELS.forEach((rel) => {
    zeroMoney.scanText(textOfRel(rel)).forEach((hit) => teamMoneyHits.push(rel + ':' + hit.token));
  });
  t.eq(teamMoneyHits, [], 'Q33 团队页零金额词表零命中（门禁 #22：服务只表达做什么）');
  t.check(wxmlSrc.indexOf('<switch-bar') >= 0
    && ['onCountTap', 'onValidityTap', 'onNoteInput', 'onCreateTap', 'onRevokeTap', 'onRemoveTap']
      .every((name) => wxmlSrc.indexOf('bindtap="' + name + '"') >= 0 || wxmlSrc.indexOf('bindinput="' + name + '"') >= 0),
  'Q34 WXML：switch-bar + 六类交互接线（数量/有效期/备注/发码/作废/移除）');
  t.check(wxmlSrc.indexOf('codeTailText') >= 0 && wxmlSrc.indexOf('result.codeRows') >= 0
    && wxmlSrc.indexOf('avatar-view') < 0 && wxmlSrc.indexOf('fileId') < 0,
  'Q35 WXML：待用码只渲尾 4 位、结果块渲完整码；零头像组件与 fileId');
  t.check(settingsSrc.indexOf('goTeam()') >= 0 && settingsSrc.indexOf("'/pkg-partner/pages/team/index'") >= 0
    && settingsWxml.indexOf('我的团队') >= 0 && settingsWxml.indexOf('bindtap="goTeam"') >= 0,
  'Q36 服务设置页「我的团队」入口行：跳团队页 + 文案说明顾客只绑定本人');
  t.eq([['createSubInvites', 'revokeSubInvite', 'listSubMembers', 'removeSubMember']
    .every((name) => typeof partnerApi[name] === 'function' && apiSrc.indexOf("'partner." + name + "'") >= 0),
  client.isWriteAction('partner.createSubInvites'), client.isWriteAction('partner.revokeSubInvite'),
  client.isWriteAction('partner.listSubMembers'), client.isWriteAction('partner.removeSubMember')],
  [true, true, true, false, true],
  'Q37 API 层四动作已导出且读写登记正确（发码/作废/移除写、列表读）');
  t.eq([fsutil.countLines(path.join(ROOT, 'pkg-partner/pages/team/index.js')),
    fsutil.countLines(path.join(ROOT, 'pkg-partner/pages/team/parts/team-model.js'))].every((lines) => lines <= 500),
  true, 'Q38 团队页页面脚本/纯件均 ≤500 行（门禁 #18）');

  // ⑥ 审查修复 P2-1/P2-2：成员数不重复渲染 + 一次性完整码切后台即清 + 可复制
  t.eq([memberView.team.memberCountText.indexOf('成员数') === -1, wxmlSrc.indexOf('成员数') >= 0],
    [true, true],
    'Q39 P2-1：成员数只给数值「3 人」，行标签「成员数」只在 WXML 出现——不再渲染「成员数 成员数 3 人」');
  const resultCode = teamModel.resultOf({ batchId: TEAM_BATCH_A, codes: ['ABCD2345EFGH'], expiresAt: NOW + DAY }, NOW);
  const afterReturn = teamModel.buildSnapshot(teamCaptainDto(), { nowMs: NOW, result: null });
  const hideBody = pageSrc.slice(pageSrc.indexOf('onHide('), pageSrc.indexOf('onPullDownRefresh('));
  t.check(pageSrc.indexOf('onHide()') >= 0 && hideBody.indexOf('this.result = null') >= 0
    && hideBody.indexOf('teamModel.emptyResult()') >= 0
    && resultCode.visible === true && afterReturn.result.visible === false,
  'Q40 P2-2：切后台/离开页面 onHide 清空结果块（result=null + emptyResult），回前台重建空结果（不把旧完整码装回）');
  t.eq([/wx\.[A-Za-z]*Storage[A-Za-z]*/.test(pageSrc), /navigateTo|redirectTo/.test(pageSrc),
    /onShareAppMessage/.test(pageSrc), wxmlSrc.indexOf('open-type="share"') >= 0],
  [false, false, false, false],
  'Q41 P2-2：完整码不落本地存储/不进 URL/不放分享卡（只存在于本次结果块与剪贴板）');
  t.check(wxmlSrc.indexOf('bindtap="onCopyResultCode"') >= 0 && wxmlSrc.indexOf('bindlongpress="onCopyResultCode"') >= 0
    && wxmlSrc.indexOf('data-code="{{item.display}}"') >= 0 && pageSrc.indexOf('wx.setClipboardData(') >= 0,
  'Q42 P2-2：完整码可点「复制」+ 长按复制（剪贴板出口单一，成功提示当面告知对方）');

  // ⑦ 批次并发/限流两条服务端可见路径：错误人话直出（W3：发码事务 CAS 冲突 CONFLICT + rl:subInvite RATE_LIMITED）
  t.eq([teamModel.failureText({ code: 'CONFLICT', message: '并发生成冲突，请刷新后重试' }),
    teamModel.failureText({ code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试' }),
    teamModel.failureText({})],
  ['并发生成冲突，请刷新后重试', '操作太频繁，请稍后再试', '操作没成功，请重试'],
  'Q43 CONFLICT（并发冲突）/RATE_LIMITED（限流）走 failureText 直出服务端人话；无 message 时兜底不留空白');
  t.eq((pageSrc.match(/teamModel\.failureText\(err\)/g) || []).length, 3,
    'Q44 团队页三条写失败路径（发码/作废/移除）统一接 teamModel.failureText（不各写一份错误文案）');
  t.notEmpty(view.members, 'Q 组样本非空（防止空集全绿）');
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
  TEAM_PAGE_ASSERTIONS,
  perfChecks,
  teamChecks,
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
