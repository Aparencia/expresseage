'use strict';
/**
 * tools/lib/order-customer-cases.js — selftest-order-customer 的 DTO/集合文档夹具与页面扫描助手（拆分子文件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-customer.js 已满闸；D47 预约「最晚可接受时间」
 *   需在本套件补详情展示断言，故把夹具/期望值/扫描助手下沉到本文件，主套件只保留 A~L 断言段落。
 * 口径：夹具字段形状 = 批 5 冻结契约（docs/data/V4_DATA_MODEL.md §2.5/§4.1、docs/contract/V4_CONTRACT.md §5）。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
const orderState = require(path.join(ROOT, 'shared/order-state.js'));

const STATUS = orderState.STATUS;
const STATUS_LITERALS = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
const PAGES = {
  detail: 'pkg-customer/pages/order-detail/index.js',
  detailWxml: 'pkg-customer/pages/order-detail/index.wxml',
  orders: 'pages/customer/orders/index.js',
  ordersWxml: 'pages/customer/orders/index.wxml',
  messages: 'pkg-customer/pages/messages/index.js',
  home: 'pages/customer/home/index.js',
  homePlan: 'pages/customer/home/parts/render-plan.js',
  homeWxml: 'pages/customer/home/index.wxml',
  create: 'pkg-customer/pages/order-create/index.js',
  pickup: 'pkg-customer/pages/pickup-list/index.js',
  pickupWxml: 'pkg-customer/pages/pickup-list/index.wxml',
  pickupView: 'pkg-customer/pages/pickup-list/parts/pickup-view.js'
};
const ISO = '2026-10-22T12:00:00.000Z';
const NOW = Date.parse('2026-10-22T12:00:03+08:00');

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

// ── 顾客侧 order DTO 夹具（字段形状 = 批 5 冻结契约）────────────────────────────
function actionsFor(status, exceptionFrom) {
  if (status === STATUS.SUBMITTED || status === STATUS.ACCEPTED) {
    return [{ key: 'cancel', label: '取消订单' }, { key: 'message', label: '留言' }];
  }
  if (status === STATUS.PICKED) return [{ key: 'message', label: '留言' }];
  if (status === STATUS.DELIVERED) {
    return [{ key: 'confirm', label: '确认已收到' }, { key: 'message', label: '留言' }];
  }
  if (status === STATUS.COMPLETED) {
    return [{ key: 'deleteRecord', label: '删除这条记录' }, { key: 'reorder', label: '再次下单' }];
  }
  if (status === STATUS.CANCELLED) return [{ key: 'reorder', label: '再次下单' }];
  if (status === STATUS.EXCEPTION) {
    const list = [{ key: 'message', label: '留言' }];
    if (exceptionFrom === STATUS.SUBMITTED || exceptionFrom === STATUS.ACCEPTED) {
      list.unshift({ key: 'cancel', label: '取消订单' });
    }
    return list;
  }
  return [];
}

function dto(status, extra) {
  const sample = {
    orderNo: '20261022-0031',
    status: status,
    statusText: orderState.statusText(status),
    version: 3,
    needCode: false,
    service: { code: 'PICKUP_STD', name: '标准代取' },
    parcel: {
      stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3021',
      lockerNo: '', trackingTail: '', codeStatus: 'OK', codeStatusText: '有取件码',
      recognitionSource: 'RULE', recognitionSourceLabel: '截图识别', confidence: ''
    },
    appoint: { type: 'ASAP', typeText: '尽快', startAt: '', endAt: '' },
    note: '', deliveryNote: '', phoneTail: '6678',
    dorm: { buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    customerNo: 'C-7K2M-9QX4', partnerNo: 'P-7K2-M9X',
    counterpart: { displayName: '小兼', avatarFileId: 'cloud://test.env/avatars/partner/x.jpg' },
    image: { hasImage: true, cleaned: false },
    exception: null, cancelReason: '', cancelReasonText: '', cancelledBy: '', cancelledByText: '',
    actions: actionsFor(status),
    statusUpdatedAt: ISO, createdAt: ISO, updatedAt: ISO,
    acceptedAt: '', pickedAt: '', deliveredAt: '', completedAt: '', cancelledAt: '',
    deletedByCustomerAt: ''
  };
  return Object.assign(sample, extra || {});
}

function event(type, at, note) {
  return { type: type, at: at || ISO, actorRole: 'PARTNER', note: note || '' };
}

// ── orders 集合文档夹具：交给真实 _dto.buildOrderDto 生成服务端 DTO（契约联调用）──
const DOC_MS = Date.parse(ISO);
function orderDoc(status, extra) {
  const doc = {
    _id: 'order-' + status,
    orderNo: '20261022-0031',
    customerId: 'openid-it-c',
    partnerId: 'partner-it',
    customerNo: 'C-7K2M-9QX4',
    partnerNo: 'P-7K2-M9X',
    status: status,
    version: 3,
    source: 'CUSTOMER',
    parcel: {
      stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3021',
      lockerNo: '', trackingTail: '', codeStatus: 'OK', recognitionSource: 'RULE'
    },
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    note: '', deliveryNote: '', phoneTail: '6678',
    image: { fileId: 'cloud://test.env/orders/TKT/image.jpg' },
    exception: null,
    cancelReason: '', cancelledBy: '',
    statusUpdatedAt: DOC_MS, createdAt: DOC_MS, updatedAt: DOC_MS,
    acceptedAt: 0, pickedAt: 0, deliveredAt: 0, completedAt: 0, cancelledAt: 0
  };
  if (status === STATUS.EXCEPTION) {
    doc.exception = { code: 'PARCEL_NOT_FOUND', text: '驿站暂时没找到这个件', fromStatus: STATUS.ACCEPTED, by: 'PARTNER', at: DOC_MS };
  }
  if (status === STATUS.CANCELLED) {
    doc.cancelReason = 'CHANGED_MIND';
    doc.cancelledBy = 'CUSTOMER';
  }
  return Object.assign(doc, extra || {});
}

const FAKE_DTO_CTX = {
  dao: {
    get: function get() { return Promise.resolve(null); },
    find: function find() { return Promise.resolve([]); },
    findOne: function findOne() { return Promise.resolve(null); }
  },
  identity: {},
  now: DOC_MS
};

// 页面层扫描（有牙正控/反例）：只扫真实页面脚本，合成样本用于证明扫描能红
function layerHits(code) {
  const src = fsutil.stripComments(String(code || ''));
  const hits = [];
  if (/wx\.cloud\./.test(src)) hits.push('wx.cloud');
  if (/Math\.random|\brandom\(/.test(src)) hits.push('random');
  if (/client\.call\s*\(/.test(src)) hits.push('直调 client.call');
  STATUS_LITERALS.forEach(function each(status) {
    if (new RegExp("['\"]" + status + "['\"]").test(src)) hits.push('状态字面量 ' + status);
  });
  return hits;
}


module.exports = {
  ROOT: ROOT,
  STATUS: STATUS,
  STATUS_LITERALS: STATUS_LITERALS,
  PAGES: PAGES,
  ISO: ISO,
  NOW: NOW,
  DOC_MS: DOC_MS,
  textOf: textOf,
  actionsFor: actionsFor,
  dto: dto,
  event: event,
  orderDoc: orderDoc,
  FAKE_DTO_CTX: FAKE_DTO_CTX,
  layerHits: layerHits
};
