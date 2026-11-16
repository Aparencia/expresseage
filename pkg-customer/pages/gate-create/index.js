// pkg-customer/pages/gate-create/index.js · E 校门代取登记页
// 只做取参/调 api/setData/事件转发；校门点/送达摘要/幂等键/载荷在 parts/model 纯件。
// 口径：外卖员已送达校门后的二次代取；无商家、餐品选择、公开抢单、站内下单或款项字段。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const configApi = require('../../../api/modules/config');
const route = require('../../../config/route');
const privacyGate = require('../../../utils/privacy-gate');
const model = require('./parts/model');

Page({
  data: {
    loading: true,
    gateEnabled: false,
    gatePoints: [],
    pointId: '',
    note: '',
    noteMax: model.NOTE_MAX,
    profileComplete: false,
    binding: null,
    deliveryText: '',
    submitting: false,
    error: '',
    unavailable: ''
  },

  onLoad() {
    this._submission = null;
    this._configLoading = false;
  },

  onShow() {
    privacyGate.redirectIfNeeded({}).then((blocked) => {
      if (!blocked) this.enter();
    });
  },

  enter() {
    this.applySnapshot();
    const snap = store.snapshot();
    const config = snap.config || {};
    if (!config.gatePoints || typeof config.gateEnabled !== 'boolean') {
      this.fetchConfig();
    }
  },

  applySnapshot() {
    const snap = store.snapshot();
    const config = snap.config || {};
    const points = model.pointsOf(config);
    const current = points.filter((item) => item.id === this.data.pointId)[0];
    const customer = snap.customer || {};
    this.setData({
      loading: false,
      gateEnabled: config.gateEnabled === true,
      gatePoints: points,
      pointId: current ? current.id : (points[0] ? points[0].id : ''),
      profileComplete: customer.profileComplete === true,
      binding: snap.binding || null,
      deliveryText: model.deliveryTextOf(customer),
      unavailable: config.gateEnabled === true ? '' : '校门代取暂未开放，请稍后再试。'
    });
  },

  fetchConfig() {
    if (this._configLoading) return;
    this._configLoading = true;
    configApi.getPublic().then((config) => {
      this._configLoading = false;
      store.patch({ config: config });
      this.applySnapshot();
    }).catch(() => {
      this._configLoading = false;
      this.setData({ loading: false, unavailable: '配置加载失败，请下拉刷新或稍后再试。' });
    });
  },

  onPointTap(event) {
    const pointId = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
    if (!pointId || pointId === this.data.pointId) return;
    this._submission = null;
    this.setData({ pointId: pointId, error: '' });
  },

  onNoteInput(event) {
    this._submission = null;
    this.setData({ note: String((event.detail && event.detail.value) || ''), error: '' });
  },

  onProfileTap() {
    wx.navigateTo({ url: route.PROFILE_PAGE + '?edit=1' });
  },

  onBindTap() {
    wx.navigateTo({ url: route.BIND_PAGE });
  },

  onBackTap() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: route.CUSTOMER_HOME });
  },

  onRetry() {
    this.fetchConfig();
  },

  onSubmit() {
    if (this.data.submitting) return;
    const check = model.canSubmit(this.data);
    if (!check.ok) {
      wx.showToast({ title: check.reason, icon: 'none' });
      return;
    }
    this._submission = model.ensureSubmission(this._submission, model.fingerprintOf(this.data));
    this.setData({ submitting: true, error: '' });
    const payload = model.payloadOf(this.data);
    orderApi.create(payload, { clientRequestId: this._submission.id }).then((data) => {
      const order = (data && data.order) || {};
      const orderNo = order.orderNo || (data && data.orderNo) || '';
      this._submission = model.clearSubmission();
      this.setData({ submitting: false });
      wx.showToast({ title: '已提交，等待兼职接单', icon: 'success' });
      if (orderNo) {
        wx.redirectTo({ url: route.CUSTOMER_ORDER_DETAIL + '?orderNo=' + encodeURIComponent(orderNo) });
        return;
      }
      wx.switchTab({ url: route.CUSTOMER_HOME });
    }).catch((err) => {
      this.setData({
        submitting: false,
        error: (err && err.message) || '提交失败，内容还在，可以重试'
      });
    });
  }
});
