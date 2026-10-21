// pkg-customer/pages/order-create/index.js · 下单四步（截图→核对→服务→提交）
// 页面只做取参/调 api/setData/事件转发；识别与模型逻辑在 parts/ 与 utils/。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const configApi = require('../../../api/modules/config');
const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');
const model = require('./parts/model');
const ocrFlow = require('./parts/ocr-flow');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const HOME_PAGE = '/pages/customer/home/index';
const PAGE_SIZE_MAX = 5;

Page({
  data: {
    step: 1,
    readonly: false,
    profileReady: false,
    bindingReady: false,
    filePath: '',
    file: null,
    image: null,
    uploadTicketId: '',
    ocrState: 'idle',
    ocrError: '',
    failureCode: '',
    failureText: '',
    failureNext: '',
    items: [],
    stations: [],
    services: [],
    slots: [],
    appointType: 'ASAP',
    slotIndex: -1,
    note: '',
    submitting: false,
    submitError: '',
    resultOrders: [],
    resultBatch: false
  },

  onLoad() {
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this.setData({
      readonly: readonly,
      stations: model.stationOptions(),
      slots: model.appointmentSlots(new Date()),
      profileReady: !!(snapshot.customer && snapshot.customer.profileComplete),
      bindingReady: !!snapshot.binding
    });
    this.loadConfig();
    this.loadPartner();
  },

  onShow() {
    const snapshot = store.snapshot();
    if (snapshot.viewContext) return;
    if (snapshot.activeRole !== 'CUSTOMER') wx.reLaunch({ url: route.ROLE_PAGE });
  },

  loadConfig() {
    const cached = store.snapshot().config;
    if (cached && cached.privacyVersion) {
      this.applyServices(cached);
      return;
    }
    configApi.getPublic().then((config) => {
      store.patch({ config: config });
      this.applyServices(config);
    }).catch(function ignore() {
      // 配置读取失败时服务类型退化为空列表，页面仍可手填下单
    });
  },

  loadPartner() {
    bindApi.getCurrent().then((data) => {
      const partnerPublic = (data && data.partnerPublic) || null;
      this.setData({ partnerPublic: partnerPublic });
      this.applyServices(store.snapshot().config);
    }).catch(function ignore() {});
  },

  applyServices(config) {
    const services = model.serviceOptions(config || {}, this.data.partnerPublic);
    this.setData({ services: services });
    if (services.length > 0) {
      const items = this.data.items.map(function map(item) {
        if (!item.serviceCode) item.serviceCode = services[0].code;
        let index = -1;
        for (let i = 0; i < services.length; i += 1) {
          if (services[i].code === item.serviceCode) index = i;
        }
        item.serviceIndex = index >= 0 ? index : 0;
        item.serviceCode = services[item.serviceIndex].code;
        return item;
      });
      this.setData({ items: items });
    }
  },

  async onPickFile(e) {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    const files = (e.detail && e.detail.files) || [];
    if (files.length === 0) {
      this.setData({ file: null, image: null, uploadTicketId: '', filePath: '' });
      return;
    }
    const file = files[0];
    if (!file || !file.localPath) return;
    this.setData({
      file: file,
      filePath: file.localPath,
      image: { fileId: file.fileId || '', width: file.width || 0, height: file.height || 0 },
      uploadTicketId: file.uploadTicketId || '',
      ocrState: 'ocr',
      ocrError: '',
      failureText: '',
      failureNext: '',
      items: []
    });
    try {
      const result = await ocrFlow.identify(file, (state) => this.onOcrPhase(state));
      this.applyIdentify(result);
    } catch (err) {
      this.setData({ ocrState: 'failed', ocrError: (err && err.message) || '识别失败，可手动填写' });
    }
  },

  onPickError(e) {
    const detail = (e && e.detail) || {};
    this.setData({
      ocrState: 'failed',
      failureCode: detail.reason || 'IMAGE_UNREADABLE',
      failureText: detail.message || '截图上传失败。',
      failureNext: '可以重试，或手动填写后提交。',
      uploadTicketId: '',
      image: null,
      file: null
    });
  },

  onOcrPhase(state) {
    if (state && state.phase === 'upload') this.setData({ ocrState: 'upload' });
    if (state && state.phase === 'ocr') this.setData({ ocrState: 'ocr' });
    if (state && state.phase === 'ai') this.setData({ ocrState: 'ai' });
  },

  applyIdentify(result) {
    const defaults = { serviceCode: (this.data.services[0] || {}).code || '' };
    if (result && result.file) {
      this.setData({
        file: result.file,
        image: result.image,
        uploadTicketId: result.file.uploadTicketId || ''
      });
    }
    if (result && result.ok && (result.items || []).length > 0) {
      const items = result.items.slice(0, PAGE_SIZE_MAX).map(function map(item) {
        return model.makeItem(item, defaults);
      });
      this.setData({
        items: items,
        ocrState: 'done',
        ocrError: '',
        failureText: '',
        failureNext: '',
        step: 2
      });
      return;
    }
    const failureCode = (result && result.failureCode) || 'NO_TEXT';
    const copy = (result && result.failureCopy) || { text: '没识别出来。', next: '可以手动填写。' };
    const manual = model.makeItem({ trackingTail: (result && result.trackingTail) || '' }, defaults);
    this.setData({
      items: [manual],
      ocrState: 'failed',
      ocrError: '',
      failureCode: failureCode,
      failureText: copy.text,
      failureNext: copy.next,
      step: 2
    });
  },

  onRetryOcr() {
    if (!this.data.file || !this.data.file.localPath) {
      wx.showToast({ title: '请先重新选择截图', icon: 'none' });
      return;
    }
    this.onPickFile({ detail: { files: [this.data.file] } });
  },

  onManualTap() {
    const defaults = { serviceCode: (this.data.services[0] || {}).code || '' };
    this.setData({ items: [model.makeItem({}, defaults)], step: 2, ocrState: 'failed' });
  },

  onAddItem() {
    if (this.data.readonly) return;
    const defaults = { serviceCode: (this.data.services[0] || {}).code || '' };
    if (this.data.items.length >= PAGE_SIZE_MAX) {
      wx.showToast({ title: '一图最多拆 5 件', icon: 'none' });
      return;
    }
    this.setData({ items: this.data.items.concat([model.makeItem({}, defaults)]) });
  },

  onRemoveItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const items = this.data.items.slice();
    items.splice(index, 1);
    this.setData({ items: items });
  },

  onItemToggle(e) {
    const index = Number(e.currentTarget.dataset.index);
    const items = this.data.items.slice();
    items[index] = Object.assign({}, items[index], { checked: !items[index].checked });
    this.setData({ items: items });
  },

  onStationChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const station = this.data.stations[Number(e.detail.value)] || {};
    this.updateItem(index, { stationId: station.id || '', stationName: station.name || '' });
  },

  onCodeChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { pickupCode: e.detail.value });
  },

  onLockerChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { lockerNo: e.detail.value });
  },

  onTailChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { trackingTail: e.detail.value });
  },

  onServiceChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const serviceIndex = Number(e.detail.value);
    const service = this.data.services[serviceIndex] || {};
    this.updateItem(index, { serviceCode: service.code || '', serviceIndex: serviceIndex });
  },

  updateItem(index, patch) {
    if (!(index >= 0)) return;
    const items = this.data.items.slice();
    items[index] = model.revalidateItem(Object.assign({}, items[index], patch));
    this.setData({ items: items });
  },

  onAppointType(e) {
    this.setData({ appointType: e.detail.value });
  },

  onSlotChange(e) {
    this.setData({ slotIndex: Number(e.detail.value) });
  },

  onNoteInput(e) {
    this.setData({ note: String((e.detail && e.detail.value) || '') });
  },

  goStep2Next() {
    const checked = this.data.items.filter(function on(item) { return item.checked; });
    if (checked.length === 0) {
      wx.showToast({ title: '至少选择一件再继续', icon: 'none' });
      return;
    }
    for (let i = 0; i < checked.length; i += 1) {
      const item = model.revalidateItem(Object.assign({}, checked[i]));
      if (!item.stationId) {
        wx.showToast({ title: '请补全站点后再继续', icon: 'none' });
        return;
      }
      if (item.codeStatus === 'NONE') {
        wx.showToast({ title: '请补全取件码或运单后 5 位', icon: 'none' });
        return;
      }
      if (Object.keys(item.formErrors).length > 0) {
        wx.showToast({ title: item.formErrors[Object.keys(item.formErrors)[0]], icon: 'none' });
        return;
      }
    }
    this.setData({ step: 3 });
  },

  goStep3Next() {
    if (this.data.appointType === 'SLOT') {
      const slot = this.data.slots[this.data.slotIndex];
      if (!slot || slot.expired) {
        wx.showToast({ title: '请选择有效预约时段', icon: 'none' });
        return;
      }
    }
    if (this.data.note.length > 200) {
      wx.showToast({ title: '备注最多 200 字', icon: 'none' });
      return;
    }
    this.setData({ step: 4 });
  },

  goPrev() {
    this.setData({ step: Math.max(1, this.data.step - 1) });
  },

  appointPayload() {
    if (this.data.appointType !== 'SLOT') return { type: 'ASAP' };
    const slot = this.data.slots[this.data.slotIndex] || {};
    return { type: 'SLOT', startAt: slot.startAt, endAt: slot.endAt };
  },

  async onSubmit() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    const check = model.canSubmit(this.data.items);
    if (!check.ok) {
      wx.showToast({ title: check.reason, icon: 'none' });
      return;
    }
    if (!this.data.uploadTicketId || !this.data.image || !this.data.image.fileId) {
      wx.showToast({ title: '截图还没上传成功，请重新上传', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, submitError: '' });
    const payload = model.buildPayload(this.data.items, this.data.uploadTicketId, this.data.image);
    const appoint = this.appointPayload();
    const note = this.data.note;
    payload.items.forEach(function fill(item) { item.appoint = appoint; item.note = note; });
    try {
      if (payload.single) {
        const singlePayload = Object.assign({}, payload.items[0], {
          ticket: payload.ticket,
          image: payload.image
        });
        const data = await orderApi.create(singlePayload);
        const order = (data && data.order) || {};
        wx.showToast({ title: '已提交，等待兼职接单', icon: 'success' });
        setTimeout(function go() {
          wx.redirectTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(order.orderNo || '') });
        }, 600);
        return;
      }
      const data = await orderApi.createBatch({
        items: payload.items,
        ticket: payload.ticket,
        image: payload.image
      });
      this.setResult((data && data.orders) || []);
    } catch (err) {
      this.setData({ submitting: false, submitError: (err && err.message) || '提交失败，内容还在，可以重试' });
    }
  },

  setResult(orders) {
    this.setData({
      submitting: false,
      resultOrders: orders.map(function map(item) {
        return { orderNo: item.orderNo || (item.order && item.order.orderNo) || '' };
      }),
      resultBatch: true
    });
  },

  onRetrySubmit() {
    this.onSubmit();
  },

  onViewOrder(e) {
    const orderNo = e.currentTarget.dataset.orderNo;
    if (!orderNo) return;
    wx.redirectTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onBackHome() {
    wx.switchTab({ url: HOME_PAGE });
  }
});
