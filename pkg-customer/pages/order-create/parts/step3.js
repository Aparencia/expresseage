// pkg-customer/pages/order-create/parts/step3.js · Step3 服务/预约/备注 + 配送地址（D25）页面零件
// 页面方法只做一行转发；page 形参 = 页面实例（提供 data/setData）。
'use strict';

const deliveryModel = require('./delivery');
const model = require('./model');

const NOTE_MAX = 200;

function setService(page, e) {
  const serviceIndex = Number(e.detail.value);
  const service = page.data.services[serviceIndex] || {};
  page.setData({ serviceIndex: serviceIndex, serviceCode: service.code || '', submission: model.clearSubmission() });
}

function setAppointType(page, e) {
  page.setData({ appointType: e.detail.value, submission: model.clearSubmission() });
}

function setSlot(page, e) {
  const slotIndex = Number(e.detail.value);
  const slot = page.data.slots[slotIndex] || {};
  page.setData({
    slotIndex: slotIndex,
    startAt: slot.startAt || '',
    endAt: slot.endAt || '',
    submission: model.clearSubmission()
  });
}

function setNote(page, e) {
  page.setData({ note: String((e.detail && e.detail.value) || ''), submission: model.clearSubmission() });
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

/** Step3 → Step4：整单预约/备注 + 配送地址校验后生成提交幂等键 */
function goNext(page) {
  if (page.data.appointType === 'SLOT') {
    const slot = page.data.slots[page.data.slotIndex];
    if (!slot || slot.expired) {
      wx.showToast({ title: '请选择有效预约时段', icon: 'none' });
      return;
    }
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
  page.setData({ step: 4, submission: submission, submitError: '', deliveryErrors: {} });
}

module.exports = {
  NOTE_MAX,
  setService,
  setAppointType,
  setSlot,
  setNote,
  setMode,
  setZone,
  setBuilding,
  setRoom,
  setRecipient,
  goNext
};
