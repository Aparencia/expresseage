// pkg-customer/pages/order-create/parts/step3.js · Step3 服务/预约/备注 + 配送地址（D25）页面零件
// A 批 P1-9：serviceCode=CUSTOM（其他代办）且备注去空白为空 → 行内红字 + 不可下一步（UX §3.7.3/AC-C-15）。
// 页面方法只做一行转发；page 形参 = 页面实例（提供 data/setData）。
'use strict';

const deliveryModel = require('./delivery');
const model = require('./model');
const precheck = require('./precheck');
const appointUtil = require('../../../../shared/appoint');
const enums = require('../../../../shared/enums');

const NOTE_MAX = 200;

/** 备注行内校验：CUSTOM 强制备注（判据在 precheck 纯件，页面只渲染） */
function syncNoteError(page) {
  page.setData({ noteError: precheck.noteErrorOf(page.data.serviceCode, page.data.note) });
}

// D84（2026-11-14）：附加服务预览（零金额口径）——只列"做什么"与说明，不出现任何交易/费用字段。
// 输入 = 选中 code 数组；输出固定形状 {visible,countText,items[{code,name,desc}]}，供 Step4 与测试共用。
function addonPreviewOf(addons) {
  const list = Array.isArray(addons) ? addons : [];
  const items = enums.ADDONS.filter(function hit(item) { return list.indexOf(item.code) >= 0; })
    .map(function itemOf(item) { return { code: item.code, name: item.name, desc: item.desc }; });
  return {
    visible: items.length > 0,
    countText: items.length > 0 ? '共 ' + items.length + ' 项' : '',
    items: items
  };
}

// 附加服务（D77，2026-11-08）：多选 chip，订单级 0~3 项；toggle 后清空提交幂等键
function toggleAddon(page, code) {
  const target = String(code || '');
  const current = Array.isArray(page.data.addons) ? page.data.addons : [];
  const exists = current.indexOf(target) >= 0;
  const next = exists ? current.filter(function keep(item) { return item !== target; }) : current.concat([target]);
  const options = (page.data.addonOptions || []).map(function mark(option) {
    return Object.assign({}, option, { checked: next.indexOf(option.code) >= 0 });
  });
  const names = enums.ADDONS.filter(function hit(item) { return next.indexOf(item.code) >= 0; })
    .map(function name(item) { return item.name; });
  const descs = enums.ADDONS.filter(function hit(item) { return next.indexOf(item.code) >= 0; })
    .map(function desc(item) { return item.name + '：' + item.desc; });
  page.setData({
    addons: next,
    addonOptions: options,
    addonText: names.join('、'),
    addonHintText: descs.join('；'),
    addonPreview: addonPreviewOf(next),
    submission: model.clearSubmission()
  });
}

// 预约（2026-11-08 用户指令）：新单只保留「最晚时间」，不再提供「尽快」切换
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
  // 2026-11-08：新单只允许「最晚时间」——历史预填（如再次下单带 ASAP）在进入 Step4 前强制转 LATEST
  let appoint = page.data.appoint || {};
  if (appointUtil.normalizeType(appoint.type) !== 'LATEST') {
    appoint = appointUtil.setType(appoint, 'LATEST', appointNow);
    page.setData({ appoint: appoint });
  }
  const appointCheck = appointUtil.validateOf(appoint, appointNow);
  if (!appointCheck.ok) {
    page.setData({ appoint: appointUtil.refreshState(appoint, appointNow) });
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
  page.setData({
    step: 4,
    submission: submission,
    addonPreview: addonPreviewOf(page.data.addons),
    submitError: '',
    deliveryErrors: {},
    noteError: ''
  });
}

module.exports = {
  NOTE_MAX,
  syncNoteError,
  addonPreviewOf,
  toggleAddon,
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
