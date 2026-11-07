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
  create: 'pkg-customer/pages/order-create/index.js'
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

/**
 * F 组「页面静态」断言（批21-C 从 selftest-order-customer.js 逐字搬入，纯文本扫描；判据/条数零变更）。
 * 为什么搬：门禁 #18 主套件行数预算（≤1000 且目标 ≤950），宽口径静态扫描断言放本夹具 lib；
 * 搬移纪律：断言顺序/消息/条件一字不改，主套件只留 require + registerF 接线行。
 */
function registerF(t) {
  const control = layerHits(
    "wx.cloud.callFunction({ name: 'api' });\n"
    + "const s = 'CANCELLED';\n"
    + 'const r = Math.random();\n'
    + "client.call('order.get', {});\n"
  );
  t.eq(control.length, 4, 'F1 正控：合成违规样本被扫描命中 4 类（扫描有牙）');
  t.eq(layerHits('const x = 1; // wx.cloud.callFunction 与 Math.random 在注释里\n'), [],
    'F2 反例：注释内违规字样不误伤（剥注释后扫描）');
  const scanned = [PAGES.detail, PAGES.orders, PAGES.messages, PAGES.home];
  const pageHits = [];
  scanned.forEach(function each(rel) {
    layerHits(textOf(rel)).forEach(function push(hit) { pageHits.push(rel + ':' + hit); });
  });
  t.eq(pageHits, [], 'F3 四个页面 JS 零 wx.cloud.*/零七状态字面量/零 random/零直调 client.call');
  scanned.forEach(function each(rel) {
    t.check(textOf(rel).indexOf("api/modules/") >= 0, 'F4 ' + rel + ' 只经 api/modules 出入（action 字符串不落页面）');
  });
  const detail = textOf(PAGES.detail);
  t.check(/onShow\(\)[\s\S]*flow\.startPoll/.test(detail), 'F5 详情 onShow 恢复轮询（flow.startPoll）');
  t.check(/onHide\(\)[\s\S]*flow\.stopPoll/.test(detail) && /onUnload\(\)[\s\S]*flow\.stopPoll/.test(detail),
    'F6 详情 onHide/onUnload 必停轮询（AC-C-29：离开页面不再排程）');
  t.check(/clearTimer\(\)/.test(detail) && /setTimeout/.test(detail) && /flow\.pollDelay/.test(detail),
    'F7 浏览器定时器接线：setTimeout + flow.pollDelay，clearTimer 统一清理');
  t.check(!/\.status\s*===/.test(detail) && !/\.status\s*==/.test(detail),
    'F8 详情页无 status 字面量比较（动作/进度只消费 DTO 与 parts）');
  t.check(/writeAction\(orderApi\.cancel/.test(detail) && /writeAction\(orderApi\.confirmDelivery/.test(detail)
    && /writeAction\(orderApi\.deleteRecord/.test(detail) && /expectedVersion:\s*version/.test(detail),
  'F9 取消/确认/删除都经 writeAction 且带 expectedVersion（服务端乐观锁）');
  t.check(/onCopyOrderNo/.test(detail) && /wx\.setClipboardData/.test(detail) && /onCopyOrderNo/.test(textOf(PAGES.detailWxml)),
    'F10 头部订单号复制（wx.setClipboardData + 成功 toast）');
  t.check(/onViewImage/.test(detail) && /view\.imageErrorText/.test(detail) && /wx\.previewImage/.test(detail)
    && /image\.canView/.test(textOf(PAGES.detailWxml)),
  'F11 截图四态接线：可看（previewImage）/加载失败/过期/已清理人话（imageErrorText 单源）');
  t.check(/reorder=/.test(detail) && /actions\.reorder/.test(textOf(PAGES.detailWxml))
    && /message\.inputVisible/.test(textOf(PAGES.detailWxml)) && /message\.archiveText/.test(textOf(PAGES.detailWxml)),
  'F12 详情 WXML：再次下单入口 / 留言输入按 DTO message / 已完成归档提示');
  const orders = textOf(PAGES.orders);
  t.check(/ordersView\.tabsWithCounts/.test(orders) && /data\.counts|counts/.test(orders)
    && /(ordersView\.tickRows|tickerPatch\.build)/.test(orders) && /ordersView\.serverNowMs/.test(orders),
  'F13 列表：tab 计数取服务端 counts、倒计时按 serverTimeSkew 校时、tick 走纯件（P0-6 行级补丁）');
  t.check(/onHide\(\)[\s\S]*stopTicker/.test(orders) && /onUnload\(\)[\s\S]*stopTicker/.test(orders),
    'F14 列表 onHide/onUnload 清倒计时定时器（不在后台空转）');
  t.check(/刷新成功/.test(orders), 'F15 下拉刷新成功 toast「刷新成功」');
  t.check(/onReorderTap/.test(textOf(PAGES.ordersWxml)) && /catchtap="onReorderTap"/.test(textOf(PAGES.ordersWxml))
    && /tab-count/.test(textOf(PAGES.ordersWxml)),
  'F16 列表 WXML：分组计数 + 行内再次下单入口（catchtap 不冒泡到详情）');
  t.check(/clearBadge/.test(textOf(PAGES.messages)) && /badges/.test(textOf(PAGES.messages))
    && /messages:\s*0/.test(textOf(PAGES.messages)),
  'F17 消息中心全部已读后红点归零（store.badges.messages）');
  const home = textOf(PAGES.home);
  t.check(/messageApi\.list\(\{\s*limit:\s*1\s*\}\)/.test(home) && /unread/.test(home) && /badges/.test(home),
    'F18 首页 onShow 用 message.list({limit:1}).unread 更新 store.badges.messages（E13）');
  t.check(/vm\.badges\.messages/.test(textOf(PAGES.homeWxml)), 'F19 首页铃铛红点按 badges.messages 渲染');
  const create = textOf(PAGES.create);
  t.check(/reorder\.orderNoOf\(options\)/.test(create) && /reorder\.load\(/.test(create)
    && /reorder\.defaultsFor\(/.test(create) && /bootstrap\.load\(\)/.test(create),
  'F20 下单页 support options.reorder：预填快照/默认值装配走 parts/reorder + parts/bootstrap');
  t.check(/'\?reorder='/.test(detail) && /'\?reorder='/.test(orders),
    'F21 详情/列表的再次下单跳同一入口 order-create?reorder=orderNo');
  t.check(/switch-bar/.test(textOf(PAGES.detailWxml)) && /switch-bar/.test(textOf(PAGES.ordersWxml))
    && /switch-bar/.test(textOf(PAGES.homeWxml)), 'F22 顾客三页保留切换会话顶栏（#23 不旁路）');
  t.notEmpty(scanned, 'F 组样本非空');
}

// 2026-11-05 真机缺陷回归：多张取件截图只能看第一张、无法左右滑。
// 预览计划 = 一次给全部成功 URL + current 指向用户点的那张；全失败返回 null（页面走错误态）。
const PREVIEW_ASSERTIONS = 2;

function previewChecks(t, parcelView) {
  const plan = parcelView.previewOf(2, [
    { index: 0, url: 'https://a' },
    { index: 1, url: '' },
    { index: 2, url: 'https://c' }
  ]);
  t.eq([plan.urls, plan.current], [['https://a', 'https://c'], 'https://c'],
    'I8 多图预览：一次给全部成功 URL（可左右滑），current = 用户点的那张；单张失败不拖垮整组');
  t.eq(parcelView.previewOf(0, [{ index: 0, url: '' }]), null,
    'I9 全部签发失败 → null（页面走截图错误态，不弹空预览）');
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
  layerHits: layerHits,
  registerF: registerF,
  PREVIEW_ASSERTIONS: PREVIEW_ASSERTIONS,
  previewChecks: previewChecks
};
