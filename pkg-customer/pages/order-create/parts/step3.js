// pkg-customer/pages/order-create/parts/step3.js · Step3 服务/预约/备注 + 配送地址（D25）页面零件
// A 批 P1-9：serviceCode=CUSTOM（其他代办）且备注去空白为空 → 行内红字 + 不可下一步（UX §3.7.3/AC-C-15）。
// 页面方法只做一行转发；page 形参 = 页面实例（提供 data/setData）。
'use strict';

const deliveryModel = require('./delivery');
const model = require('./model');
const precheck = require('./precheck');
const appointUtil = require('../../../../shared/appoint');

const NOTE_MAX = 200;

/** 备注行内校验：CUSTOM 强制备注（判据在 precheck 纯件，页面只渲染） */
function syncNoteError(page) {
  page.setData({ noteError: precheck.noteErrorOf(page.data.serviceCode, page.data.note) });
}

function setService(page, e) {
  const serviceIndex = Number(e.detail.value);
  const service = page.data.services[serviceIndex] || {};
  const serviceCode = service.code || '';
  page.setData({
    serviceIndex: serviceIndex,
    serviceCode: serviceCode,
    noteError: precheck.noteErrorOf(serviceCode, page.data.note),
    submission: model.clearSubmission()
  });
}

// 预约（D47）：切换尽快/最晚时间、选日期/时间/预设后都清空提交幂等键（内容变了要换键）
function setAppointType(page, e) {
  page.setData({
    appoint: appointUtil.setType(page.data.appoint, e.detail.value, Date.now()),
    submission: model.clearSubmission()
  });
}

function setLatestDate(page, e) {
  page.setData({
    appoint: appointUtil.setDate(page.data.appoint, e.detail.value, Date.now()),
    submission: model.clearSubmission()
  });
}

function setLatestTime(page, e) {
  const times = page.data.appoint.times || [];
  const option = times[Number(e.detail.value)] || {};
  page.setData({
    appoint: appointUtil.setTime(page.data.appoint, option.value || '', Date.now()),
    submission: model.clearSubmission()
  });
}

function setLatestPreset(page, e) {
  const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
  const time = String(dataset.time || '');
  page.setData({
    appoint: appointUtil.pickPreset(page.data.appoint, time, Date.now()),
    submission: model.clearSubmission()
  });
}

function setNote(page, e) {
  const note = String((e.detail && e.detail.value) || '');
  page.setData({
    note: note,
    noteError: precheck.noteErrorOf(page.data.serviceCode, note),
    submission: model.clearSubmission()
  });
}

function setMode(page, e) {
  const delivery = Object.assign({}, page.data.delivery, { mode: e.detail.value });
  page.setData({
    delivery: delivery,
    deliveryText: deliveryModel.displayText(delivery),
    deliveryErrors: {},
    submission: model.clearSubmission()
  });
}

function updateDelivery(page, patch, indexPatch) {
  const delivery = Object.assign({}, page.data.delivery);
  delivery.other = Object.assign({}, delivery.other, patch || {});
  if (indexPatch) Object.assign(delivery, indexPatch);
  page.setData({
    delivery: delivery,
    deliveryText: deliveryModel.displayText(delivery),
    deliveryErrors: {},
    submission: model.clearSubmission()
  });
}

function setZone(page, e) {
  const zone = (page.data.deliveryZones[Number(e.detail.value)] || {}).value || '';
  updateDelivery(page, { zone: zone }, { zoneIndex: Number(e.detail.value) });
}

function setBuilding(page, e) {
  const building = page.data.deliveryBuildings[Number(e.detail.value)] || {};
  updateDelivery(page, { buildingNo: Number(building.value) || 0 }, { buildingIndex: Number(e.detail.value) });
}

function setRoom(page, e) {
  updateDelivery(page, { room: String((e.detail && e.detail.value) || '') });
}

function setRecipient(page, e) {
  updateDelivery(page, { recipientName: String((e.detail && e.detail.value) || '') });
}

/** Step3 → Step4：CUSTOM 备注 → 整单预约/备注 → 配送地址 校验通过后生成提交幂等键 */
function goNext(page) {
  const noteError = precheck.noteErrorOf(page.data.serviceCode, page.data.note);
  if (noteError) {
    page.setData({ noteError: noteError });
    wx.showToast({ title: precheck.CUSTOM_NOTE_TOAST, icon: 'none' });
    return;
  }
  const appointNow = Date.now();
  const appointCheck = appointUtil.validateOf(page.data.appoint, appointNow);
  if (!appointCheck.ok) {
    page.setData({ appoint: appointUtil.refreshState(page.data.appoint, appointNow) });
    wx.showToast({ title: appointCheck.reason, icon: 'none' });
    return;
  }
  if (String(page.data.note || '').length > NOTE_MAX) {
    wx.showToast({ title: '备注最多 ' + NOTE_MAX + ' 字', icon: 'none' });
    return;
  }
  const deliveryCheck = deliveryModel.validate(page.data.delivery);
  if (!deliveryCheck.ok) {
    page.setData({ deliveryErrors: deliveryCheck.errors });
    const first = deliveryCheck.errors[Object.keys(deliveryCheck.errors)[0]];
    wx.showToast({ title: first, icon: 'none' });
    return;
  }
  const submission = model.ensureSubmission(page.data.submission, page.submitFingerprint());
  page.setData({ step: 4, submission: submission, submitError: '', deliveryErrors: {}, noteError: '' });
}

module.exports = {
  NOTE_MAX,
  syncNoteError,
  setService,
  setAppointType,
  setLatestDate,
  setLatestTime,
  setLatestPreset,
  setNote,
  setMode,
  setZone,
  setBuilding,
  setRoom,
  setRecipient,
  goNext
};
