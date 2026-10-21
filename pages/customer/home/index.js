// pages/customer/home/index.js · 顾客首页（tab1）
// 数据来源：store（资料/配置/切换会话）+ bind.getCurrent（绑定与对方档案）+ order.listCustomer（进行中）。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const orderApi = require('../../../api/modules/order');
const configApi = require('../../../api/modules/config');
const route = require('../../../config/route');
const format = require('../parts/format');

const BIND_PAGE = '/pkg-customer/pages/bind/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const MESSAGES_PAGE = '/pkg-customer/pages/messages/index';

function pickVm() {
  const snapshot = store.snapshot();
  return {
    customer: snapshot.customer || { profileComplete: false },
    binding: snapshot.binding || null,
    config: snapshot.config || {},
    viewContext: snapshot.viewContext || null,
    badges: snapshot.badges || {}
  };
}

function serviceText(partnerPublic, catalog) {
  const services = (partnerPublic && partnerPublic.services) || [];
  const enabled = services.filter(function on(item) { return item.enabled !== false; });
  if (enabled.length === 0) return '';
  const names = enabled.map(function name(item) {
    const found = (catalog || []).filter(function match(entry) { return entry.code === item.code; })[0];
    return found ? found.name : item.code;
  });
  return names.slice(0, 3).join(' / ');
}

Page({
  data: {
    vm: pickVm(),
    loading: true,
    error: '',
    partnerPublic: null,
    roomTag: '',
    dormKey: '',
    servicesText: '',
    order: null,
    waitedText: '',
    announcement: '',
    announcementClosed: false,
    canOrder: false,
    orderDisabledReason: '',
    readonly: false,
    bindInput: ''
  },

  onLoad() {
    this._off = store.subscribe(() => this.sync());
  },

  onShow() {
    this.guard();
    this.sync();
    this.refresh();
  },

  onHide() {
    this.clearTicker();
  },

  onUnload() {
    if (this._off) this._off();
    this.clearTicker();
  },

  guard() {
    const snapshot = store.snapshot();
    if (snapshot.viewContext) {
      if (snapshot.viewContext.role !== 'CUSTOMER') {
        wx.reLaunch({ url: route.PARTNER_WORKBENCH });
      }
      return;
    }
    if (snapshot.activeRole !== 'CUSTOMER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
    }
  },

  sync() {
    const vm = pickVm();
    this.setData({ vm: vm });
    this.applyDerived();
  },

  applyDerived() {
    const vm = this.data.vm;
    const partner = this.data.partnerPublic;
    const customer = vm.customer || {};
    const viewContext = vm.viewContext || null;
    const readonly = !!(viewContext && viewContext.viewMode === 'READONLY');
    const announcement = (vm.config && vm.config.announcement) || '';
    const active = !!(vm.binding && vm.binding.status !== 'RELEASED');
    let reason = '';
    if (!customer.profileComplete) reason = '先完善资料';
    else if (!active) reason = '先绑定兼职';
    else if (readonly) reason = '开发者只读视角不能操作';
    else if (partner && partner.acceptingOrders === false) reason = '该兼职暂不接单';
    this.setData({
      readonly: readonly,
      announcement: announcement,
      servicesText: serviceText(partner, (vm.config && vm.config.serviceCatalog) || []),
      canOrder: reason === '',
      orderDisabledReason: reason
    });
  },

  async refresh() {
    this.setData({ loading: true, error: '' });
    const tasks = [bindApi.getCurrent(), orderApi.listCustomer({ limit: 1 })];
    if (!this.data.vm.config || !this.data.vm.config.privacyVersion) {
      tasks.push(configApi.getPublic());
    }
    try {
      const results = await Promise.all(tasks);
      const bindingData = results[0] || {};
      const listData = results[1] || {};
      if (results[2]) store.patch({ config: results[2] });
      const binding = bindingData.binding || null;
      const partnerPublic = bindingData.partnerPublic || null;
      store.patch({ binding: binding ? Object.assign({}, binding, { partnerPublic: partnerPublic }) : null });
      const order = (listData.list && listData.list.length > 0) ? listData.list[0] : null;
      this.setData({
        loading: false,
        partnerPublic: partnerPublic,
        roomTag: binding ? binding.roomTag : '',
        dormKey: binding ? binding.dormKey : '',
        order: order,
        waitedText: order ? '更新于 ' + format.formatTimeAgo(order.statusUpdatedAt) : ''
      });
      this.applyDerived();
      this.startTicker();
    } catch (err) {
      this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
    }
  },

  startTicker() {
    this.clearTicker();
    this._ticker = setInterval(() => {
      if (!this.data.order) return;
      this.setData({ waitedText: '更新于 ' + format.formatTimeAgo(this.data.order.statusUpdatedAt) });
    }, 30000);
  },

  clearTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onBindInput(e) {
    this.setData({ bindInput: String((e.detail && e.detail.value) || '') });
  },

  onBindTap() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    const value = String(this.data.bindInput || '').trim();
    const url = value ? BIND_PAGE + '?bind=' + encodeURIComponent(value) : BIND_PAGE;
    wx.navigateTo({ url: url });
  },

  onRebindTap() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: BIND_PAGE + '?mode=rebind' });
  },

  onOrderCreateTap() {
    const reason = this.data.orderDisabledReason;
    if (reason) {
      wx.showToast({ title: reason, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: CREATE_PAGE });
  },

  onOrderTap(e) {
    const orderNo = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderNo) || '';
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onMessagesTap() {
    wx.navigateTo({ url: MESSAGES_PAGE });
  },

  onProfileTap() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onCloseAnnouncement() {
    this.setData({ announcementClosed: true });
  },

  onRetry() {
    this.refresh();
  }
});
