'use strict';
/**
 * tools/lib/workbench-cases.js — selftest-order-workbench 的共享夹具/静态样本（TD-083 拆件）。
 *
 * 内容（从 selftest-order-workbench 纯搬移，断言不变）：
 *   - 常量：七状态字面量表 STATUS_LITERALS（F 组静态扫描样本）、状态分桶 BUCKETS、页面文件清单 PAGES、
 *     固定时间锚 ISO/DOC_MS（不读系统时间）；
 *   - 端侧 DTO 夹具：actionsFor/dto/multiDto/manualDto（字段形状 = 批 5/6 冻结 DTO；与真实 _dto 产出逐格
 *     对比见 selftest 的 G 组）；
 *   - 服务端订单文档夹具：orderDoc + FAKE_DTO_CTX（G 组真实 _dto.buildOrderDto 联调用）；
 *   - 行/组样本构造：row/rowsOf/groupsOf/selectedNames。
 *
 * 非独立套件：由 tools/selftest-order-workbench.js require（拆出以控测试文件 ≤1000 行，门禁 #18；
 * tools/lib 不参与 selftest 注册完整性闸，先例 tools/lib/workbench-day-cases.js）。
 * 纪律：夹具只读、无断言副作用；不 mock 全局 wx（沿用 ENGINEERING §6.3 ADR）。
 * 取数：node tools/selftest-order-workbench.js
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const enums = require(path.join(ROOT, 'shared/enums.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const groupView = require(path.join(ROOT, 'pages/partner/workbench/parts/group-view.js'));
const rowActions = require(path.join(ROOT, 'pages/partner/workbench/parts/row-actions.js'));

const ISO = '2026-10-22T01:20:00.000Z';
const DOC_MS = Date.parse(ISO);

const STATUS = orderState.STATUS;
const STATUS_LITERALS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
const BUCKETS = {
  SUBMITTED: 'submitted',
  ACCEPTED: 'accepted',
  PICKED: 'picked',
  DELIVERED: 'delivered',
  COMPLETED: 'history',
  CANCELLED: 'history',
  EXCEPTION: 'exception'
};
const PAGES = {
  index: 'pages/partner/workbench/index.js',
  actions: 'pages/partner/workbench/parts/page-actions.js',
  wxml: 'pages/partner/workbench/index.wxml',
  wxss: 'pages/partner/workbench/index.wxss'
};

// 服务端 DTO 夹具：字段形状 = 批 5/6 冻结 DTO（真实 _dto.buildOrderDto 产出见 G 组）
function actionsFor(status) {
  if (status === STATUS.SUBMITTED) {
    return ['accept', 'reject', 'correct', 'cancel', 'message'];
  }
  if (status === STATUS.ACCEPTED) {
    return ['pick', 'exception', 'correct', 'cancel', 'message'];
  }
  if (status === STATUS.PICKED) {
    return ['deliver', 'undoPick', 'exception', 'correct', 'cancel', 'message'];
  }
  if (status === STATUS.DELIVERED) {
    return ['undoDeliver', 'exception', 'cancel', 'message'];
  }
  if (status === STATUS.EXCEPTION) {
    return ['resolve', 'correct', 'cancel', 'message'];
  }
  return [];
}

function dto(status, extra) {
  const sample = {
    orderNo: '20261022-0031',
    status: status,
    statusText: orderState.statusText(status),
    bucket: BUCKETS[status] || '',
    version: 3,
    needCode: status === STATUS.SUBMITTED,
    source: 'CUSTOMER',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    parcel: {
      stationId: 'P4',
      stationName: '北部菜鸟驿站',
      pickupCode: status === STATUS.SUBMITTED ? '' : '27-2-7016',
      lockerNo: '',
      trackingTail: '',
      codeStatus: status === STATUS.SUBMITTED ? enums.CODE_STATUS.NEED_CODE : enums.CODE_STATUS.OK,
      codeStatusText: ''
    },
    appoint: { type: 'ASAP', typeText: '尽快' },
    note: '',
    deliveryNote: '',
    phoneTail: '6678',
    dorm: { buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    guest: null,
    exception: null,
    cancelReason: '',
    cancelReasonText: '',
    cancelledBy: '',
    cancelledAt: status === STATUS.CANCELLED ? ISO : '',
    completedAt: status === STATUS.COMPLETED ? ISO : '',
    counterpart: { displayName: '小王' },
    image: { hasImage: true, cleaned: false },
    actions: actionsFor(status).map((key) => ({ key: key, label: rowActions.ACTIONS[key].label })),
    statusUpdatedAt: ISO,
    updatedAt: ISO
  };
  return Object.assign({}, sample, extra || {});
}

// v1.0 多包裹夹具（D23/D24）：parcels[] 3 件（首件 P4 已补全、第 2 件 P6 需查明+识别失败、第 3 件 P4 柜号）
function multiDto(extra) {
  const parcels = [
    { stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', lockerNo: '', trackingTail: '', codeStatus: enums.CODE_STATUS.OK, codeStatusText: '已补全' },
    { stationId: 'P6', stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: '12345', codeStatus: enums.CODE_STATUS.NEED_CODE, codeStatusText: '需查明', failureId: 'F-1' },
    { stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '109-2-3003', lockerNo: '3号柜', trackingTail: '', codeStatus: enums.CODE_STATUS.OK, codeStatusText: '已补全' }
  ];
  const base = { orderNo: 'H-1', parcels: parcels, parcel: undefined, needCode: true, manualEntry: false };
  return dto(STATUS.ACCEPTED, Object.assign(base, extra || {}));
}

// v1.0 无截图手填夹具（D24）：images=[] + manualEntry=true + delivery
function manualDto(extra) {
  const base = {
    orderNo: 'H-2',
    parcels: [{ stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', lockerNo: '', trackingTail: '', codeStatus: enums.CODE_STATUS.OK, codeStatusText: '已补全' }],
    parcel: undefined,
    manualEntry: true,
    needCode: false
  };
  return dto(STATUS.ACCEPTED, Object.assign(base, extra || {}));
}

function row(status, extra) {
  return groupView.toRow(dto(status, extra));
}

function rowsOf(list) {
  return list.map((item) => groupView.toRow(item));
}

function groupsOf(list) {
  return groupView.buildGroups(list);
}

function selectedNames(groups) {
  return groupView.selectedRows(groups).map((item) => item.orderNo);
}

// 七种状态原始订单文档（G 组真实 _dto 联调用；字段形状与 orders 集合一致）
function orderDoc(status, extra) {
  const doc = {
    _id: 'order-' + status,
    orderNo: '20261022-0011',
    customerId: 'customer-it',
    partnerId: 'partner-it',
    customerNo: 'C-7K2M-9QX4',
    partnerNo: 'P-7K2-M9X',
    status: status,
    version: 5,
    source: 'CUSTOMER',
    parcel: {
      stationId: 'P4',
      stationName: '北部菜鸟驿站',
      pickupCode: '27-2-7016',
      lockerNo: '',
      trackingTail: '',
      codeStatus: enums.CODE_STATUS.OK,
      recognitionSource: enums.RECOGNITION_SOURCE.RULE
    },
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    note: '',
    deliveryNote: '',
    phoneTail: '6678',
    image: { fileId: 'cloud://test.env/orders/TKT/image.jpg' },
    exception: null,
    pickedAt: DOC_MS,
    deliveredAt: status === STATUS.DELIVERED ? DOC_MS : 0,
    statusUpdatedAt: DOC_MS,
    updatedAt: DOC_MS,
    createdAt: DOC_MS
  };
  return Object.assign({}, doc, extra || {});
}

const FAKE_DTO_CTX = {
  dao: {
    get: function get() {
      return Promise.resolve(null);
    },
    find: function find() {
      return Promise.resolve([]);
    },
    findOne: function findOne() {
      return Promise.resolve(null);
    }
  },
  identity: {},
  now: DOC_MS
};

module.exports = {
  ISO,
  DOC_MS,
  STATUS,
  STATUS_LITERALS,
  PAGES,
  actionsFor,
  dto,
  multiDto,
  manualDto,
  row,
  rowsOf,
  groupsOf,
  selectedNames,
  orderDoc,
  FAKE_DTO_CTX
};
