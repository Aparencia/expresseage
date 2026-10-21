// pages/role/index.js · 身份选择 / 邀请码入口 / 绑定卡片落地 / 开发者分流
// 只做：取参 → 调 api → setData → 事件转发；不出现 action 字符串与集合名。
'use strict';

const store = require('../../store/index');
const userApi = require('../../api/modules/user');
const partnerApi = require('../../api/modules/partner');
const route = require('../../config/route');

const ACTIVATE_PAGE = '/pkg-partner/pages/activate/index';
const BIND_PAGE = '/pkg-customer/pages/bind/index';
const VIEW_AS_ADMIN = '/pkg-admin/pages/account-switch/index';

function pickVm() {
  const snapshot = store.snapshot();
  return {
    roles: snapshot.roles || [],
    activeRole: snapshot.activeRole || null,
    isDeveloper: snapshot.isDeveloper === true,
    customer: snapshot.customer || { profileComplete: false },
    partner: snapshot.partner || { profileComplete: false, status: '' },
    viewContext: snapshot.viewContext || null
  };
}

function redirect(url) {
  wx.reLaunch({ url: url });
}

Page({
  data: {
    vm: pickVm(),
    bindNo: '',
    bindLoading: false,
    bindCard: null,
    bindError: ''
  },

  onLoad(options) {
    const opts = options || {};
    const bindNo = String(opts.bind || '').trim();
    this._bindNo = bindNo;
    this.setData({ bindNo: bindNo });
    this.sync();
    if (this.data.vm.viewContext) {
      const role = this.data.vm.viewContext.role === 'PARTNER' ? 'PARTNER' : 'CUSTOMER';
      redirect(role === 'PARTNER' ? route.PARTNER_WORKBENCH : route.CUSTOMER_HOME);
      return;
    }
    if (this.data.vm.isDeveloper) {
      redirect(VIEW_AS_ADMIN);
      return;
    }
    if (bindNo) this.loadBindCard(bindNo);
  },

  onShow() {
    this.sync();
    const guard = this.data.vm;
    if (guard.viewContext) {
      redirect(guard.viewContext.role === 'PARTNER' ? route.PARTNER_WORKBENCH : route.CUSTOMER_HOME);
      return;
    }
    if (guard.isDeveloper) redirect(VIEW_AS_ADMIN);
  },

  onHide() {
    this._shown = false;
  },

  sync() {
    this.setData({ vm: pickVm() });
  },

  loadBindCard(bindNo) {
    this.setData({ bindLoading: true, bindError: '' });
    partnerApi.getPublic({ partnerNo: bindNo }).then((data) => {
      const partner = (data && data.partnerPublic) || data || {};
      this.setData({
        bindLoading: false,
        bindCard: {
          partnerNo: partner.partnerNo || bindNo,
          displayName: partner.displayName || '',
          status: partner.status || '',
          acceptingOrders: partner.acceptingOrders !== false,
          servicesText: (partner.services || []).filter(function on(item) { return item.enabled !== false; }).length + ' 项服务',
          zonesText: (partner.zones || []).join(' / ')
        }
      });
    }).catch((err) => {
      this.setData({ bindLoading: false, bindCard: null, bindError: (err && err.message) || '卡片信息加载失败' });
    });
  },

  onCustomerTap() {
    const customer = this.data.vm.customer || {};
    store.set('activeRole', 'CUSTOMER');
    redirect(customer.profileComplete ? route.CUSTOMER_HOME : route.PROFILE_PAGE);
  },

  onPartnerTap() {
    const partner = this.data.vm.partner || {};
    store.set('activeRole', 'PARTNER');
    if (partner.status === 'SUSPENDED' || partner.status === 'CLOSED') {
      wx.reLaunch({ url: route.PROFILE_PAGE });
      return;
    }
    if (partner.profileComplete) {
      redirect(route.PARTNER_WORKBENCH);
      return;
    }
    wx.navigateTo({ url: ACTIVATE_PAGE });
  },

  onInviteTap() {
    wx.navigateTo({ url: ACTIVATE_PAGE });
  },

  onBindTap() {
    const card = this.data.bindCard;
    if (!card) return;
    store.set('activeRole', 'CUSTOMER');
    const customer = this.data.vm.customer || {};
    if (!customer.profileComplete) {
      const target = route.PROFILE_PAGE + '?bind=' + encodeURIComponent(card.partnerNo || '');
      wx.reLaunch({ url: target });
      return;
    }
    wx.reLaunch({ url: BIND_PAGE + '?bind=' + encodeURIComponent(card.partnerNo || '') });
  },

  onRetryBootstrap() {
    userApi.bootstrap().then((data) => {
      store.hydrateFromBootstrap(data);
      this.sync();
      if (this._bindNo) this.loadBindCard(this._bindNo);
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '网络开小差了，请重试', icon: 'none' });
    });
  }
});
