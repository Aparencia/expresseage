// pkg-customer/pages/order-create/parts/submit.js · Step4 提交（order.create v1.0 单入口）页面零件
// 页面方法只做一行转发；page 形参 = 页面实例（提供 data/setData）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const store = require('../../../../store/index');
const deliveryModel = require('./delivery');
const model = require('./model');
const precheck = require('./precheck');

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

/** 提交内容指纹（含图片/票据/配送地址）→ clientRequestId 生命周期 */
function fingerprintOf(page) {
  return model.submissionFingerprint(page.data.items, {
    images: page.data.images,
    tickets: page.data.tickets,
    serviceCode: page.data.serviceCode,
    appointType: page.data.appointType,
    startAt: page.data.startAt,
    endAt: page.data.endAt,
    note: page.data.note,
    deliveryFingerprint: deliveryModel.fingerprintOf(page.data.delivery),
    manualEntry: page.data.images.length === 0
  });
}

/** order.create v1.0 载荷：parcels[]/images[]/tickets[]/serviceCode/appoint/note/delivery?/manualEntry */
function buildPayloadOf(page) {
  return model.buildPayload({
    items: page.data.items,
    images: page.data.images,
    tickets: page.data.tickets,
    serviceCode: page.data.serviceCode,
    appoint: model.appointPayloadOf(page.data.appointType, page.data.slots[page.data.slotIndex]),
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

async function onSubmit(page) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  if (page.data.submitting) return;
  const check = model.canSubmit(page.data.items);
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
  const submission = model.ensureSubmission(page.data.submission, fingerprintOf(page));
  page.setData({ submission: submission });
  const payload = buildPayloadOf(page);
  try {
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
