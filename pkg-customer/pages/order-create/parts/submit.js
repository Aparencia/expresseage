// pkg-customer/pages/order-create/parts/submit.js · Step4 提交（order.create v1.0 单入口）页面零件
// 页面方法只做一行转发；page 形参 = 页面实例（提供 data/setData）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const store = require('../../../../store/index');
const deliveryModel = require('./delivery');
const model = require('./model');
const filesFlow = require('./files-flow');
const precheck = require('./precheck');
const appointUtil = require('../../../../shared/appoint');
const subscribe = require('../../../../utils/subscribe');
const modeGuard = require('../../../../api/mode-guard');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';

/**
 * A 批 P1-6：提交前本地服务范围预检（只读 store 快照，不新增请求）。
 * 服务端 order.create 的 assertServiceRange 仍是唯一权威——本地只在必失败时提前拦，省一次失败请求。
 */
function rangeBlockOf(page) {
  const snapshot = store.snapshot();
  const binding = snapshot.binding || null;
  const partnerPublic = (binding && binding.partnerPublic) || page.data.partnerPublic || null;
  const customer = snapshot.customer || null;
  return precheck.rangeCheckOf({ zone: customer ? customer.zone : '', partnerPublic: partnerPublic });
}

/** 提交内容指纹（含图片/票据/配送地址）→ clientRequestId 生命周期；shot 缺省时读页面识别快照 */
function fingerprintOf(page, shot) {
  const images = shot ? shot.images : page.data.images;
  const tickets = shot ? shot.tickets : page.data.tickets;
  return model.submissionFingerprint(page.data.items, {
    images: images,
    tickets: tickets,
    serviceCode: page.data.serviceCode,
    addons: (page.data.addons || []).join(','),
    appointType: page.data.appoint.type,
    latestAt: appointUtil.payloadOf(page.data.appoint).latestAt || '',
    note: page.data.note,
    deliveryFingerprint: deliveryModel.fingerprintOf(page.data.delivery),
    manualEntry: images.length === 0
  });
}

/** order.create v1.0 载荷：parcels[]/images[]/tickets[]/serviceCode/appoint/note/delivery?/manualEntry */
function buildPayloadOf(page, shot) {
  return model.buildPayload({
    items: page.data.items,
    images: shot ? shot.images : page.data.images,
    tickets: shot ? shot.tickets : page.data.tickets,
    serviceCode: page.data.serviceCode,
    addons: page.data.addons,
    appoint: appointUtil.payloadOf(page.data.appoint, Date.now()),
    note: page.data.note,
    delivery: deliveryModel.toPayload(page.data.delivery)
  });
}

function imagesReady(page) {
  const images = page.data.images || [];
  const tickets = page.data.tickets || [];
  if (images.length === 0) return true;
  const broken = images.some(function bad(image) { return !image.fileId; });
  return !broken && tickets.length === images.length;
}

// 批 31（D73）：下单点击内请求「送达通知」授权（每单一次；勾「总是保持」后静默）。
// 订阅未启用/缺模板 ID 时静默跳过（不每次提交打日志，出厂默认不打扰）；失败/拒绝不阻断下单。
async function requestSubscribe(configSnapshot) {
  const ids = subscribe.planForOrderSubmit(configSnapshot);
  if (!ids.length) return null;
  const result = await subscribe.request(ids);
  if (!result.ok) {
    // 静默降级，但留排障线索（不打扰用户；devtools/vConsole 可见）
    console.warn('[subscribe] request failed', result.skipped,
      (result.error && (result.error.errCode || result.error.errMsg)) || '');
  }
  return result;
}

async function onSubmit(page) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  if (page.data.submitting) return;
  // D97：有截图（识别快照或已上传文件）时站点/取件码/运单尾号可留空；无截图手填仍必须填全
  const shot = filesFlow.imageSnapshotOf(page);
  const check = model.canSubmit(page.data.items, { allowIncomplete: shot.images.length > 0 });
  if (!check.ok) {
    wx.showToast({ title: check.reason, icon: 'none' });
    return;
  }
  if (!imagesReady(page)) {
    wx.showToast({ title: '截图还没上传成功，请重新上传', icon: 'none' });
    return;
  }
  // P1-6：必失败的提交提前拦下（不上送、不产生失败请求）；服务端校验仍是唯一权威
  const range = rangeBlockOf(page);
  if (!range.ok) {
    page.setData({ submitError: range.reason });
    wx.showToast({ title: range.reason, icon: 'none' });
    return;
  }
  page.setData({ submitting: true, submitError: '' });
  const configSnapshot = store.get('config');
  const submission = model.ensureSubmission(page.data.submission, fingerprintOf(page, shot));
  page.setData({ submission: submission });
  const payload = buildPayloadOf(page, shot);
  try {
    // TEST_WRITE 测试会话不请求微信授权（不污染测试账号的订阅状态）。
    // requestSubscribe 在 try 内同步发起（无前置 await，保留点击手势），15s 兜底保证 submitting 不永久卡死。
    const testWrite = page.data.testWrite === true || modeGuard.isTestWrite();
    const subscribeResult = testWrite ? null : await requestSubscribe(configSnapshot);
    const data = await orderApi.create(payload, { clientRequestId: submission.id });
    const order = (data && data.order) || ((data && data.orders) || [])[0] || {};
    const merged = !!(data && data.merged === true);
    page.setData({
      submitting: false,
      submission: model.clearSubmission(),
      resultOrderNo: order.orderNo || '',
      resultMerged: merged
    });
    wx.showToast({ title: merged ? '已并入最近订单' : '已提交，等待兼职接单', icon: 'success' });
    // 20004：用户关闭了「订阅消息」主开关；下单成功后再引导，不阻断提交。
    if (subscribe.isMainSwitchOff(subscribeResult)) subscribe.guideMainSwitch('customer');
  } catch (err) {
    page.setData({ submitting: false, submitError: (err && err.message) || '提交失败，内容还在，可以重试' });
  }
}

function onViewOrder(page) {
  if (!page.data.resultOrderNo) return;
  wx.redirectTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(page.data.resultOrderNo) });
}

module.exports = {
  fingerprintOf,
  buildPayloadOf,
  imagesReady,
  rangeBlockOf,
  onSubmit,
  onViewOrder
};
