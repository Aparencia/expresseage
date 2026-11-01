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

module.exports = {
  CONFIG,
  DAY,
  HOUR,
  MY_FILES,
  NOW,
  PAGE_FILES,
  PAGE_SCRIPTS,
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
