// pages/role/index.js · 身份选择 / 邀请码入口 / 绑定卡片落地 / 开发者分流
// 只做：取参 → 调 api → setData → 事件转发；不出现 action 字符串与集合名。
'use strict';

const store = require('../../store/index');
const userApi = require('../../api/modules/user');
const partnerApi = require('../../api/modules/partner');
const route = require('../../config/route');
const storage = require('../../utils/storage');
const previewCache = require('../../utils/preview-cache');
const share = require('../../utils/share/handlers');
const sharePlatform = require('../../utils/share/platform');

const ACTIVATE_PAGE = '/pkg-partner/pages/activate/index';
const BIND_PAGE = '/pkg-customer/pages/bind/index';
const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';

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

// 「上次使用」建议由显示层读取（lastRole 只经 utils/storage，不进 store/URL/请求体）；
// lastRole 不在当前角色列表里时不给建议（换账号/清缓存后不自作主张）。
function readSuggestedRole(vm) {
  return route.suggestedRoleOf(vm && vm.roles, storage.getLastRole());
}

function redirect(url) {
  wx.reLaunch({ url: url });
}

Page({
  data: {
    vm: pickVm(),
    suggestedRole: readSuggestedRole(pickVm()),
    bindNo: '',
    bindLoading: false,
    bindCard: null,
    bindError: '',
    // 朋友圈单页模式（scene=1154）：只渲染静态介绍，点底部「前往小程序」后走正常登录/分流
    singlePage: false,
    singlePageHint: '',
    shareTip: ''
  },

  onLoad(options) {
    const opts = options || {};
    const bindNo = String(opts.bind || '').trim();
    const singlePage = sharePlatform.singlePageNow();
    this._bindNo = bindNo;
    this.setData({
      bindNo: bindNo,
      singlePage: singlePage,
      singlePageHint: singlePage ? share.SINGLE_PAGE_HINT : '',
      shareTip: share.SHARE_TIP
    });
    this.sync();
    if (singlePage) {
      return;
    }
    if (this.data.vm.viewContext) {
      const role = this.data.vm.viewContext.role === 'PARTNER' ? 'PARTNER' : 'CUSTOMER';
      redirect(role === 'PARTNER' ? route.PARTNER_WORKBENCH : route.CUSTOMER_HOME);
      return;
    }
    if (this.data.vm.isDeveloper) {
      redirect(ACCOUNT_SWITCH_PAGE);
      return;
    }
    if (bindNo) this.loadBindCard(bindNo);
    if (!this.data.vm.roles || this.data.vm.roles.length === 0) this.hydrateBootstrap();
  },

  onShow() {
    if (this.data.singlePage) {
      return;
    }
    this.sync();
    const guard = this.data.vm;
    if (guard.viewContext) {
      redirect(guard.viewContext.role === 'PARTNER' ? route.PARTNER_WORKBENCH : route.CUSTOMER_HOME);
      return;
    }
    if (guard.isDeveloper) redirect(ACCOUNT_SWITCH_PAGE);
  },

  onHide() {
    this._shown = false;
  },

  sync() {
    const vm = pickVm();
    this.setData({ vm: vm, suggestedRole: readSuggestedRole(vm) });
  },

  hydrateBootstrap() {
    // user.bootstrap 平铺 DTO 的唯一水合口在 store（roles/customer/partner/binding/configPublic），
    // 页面不再自己猜字段名拼接嵌套快照。
    return userApi.bootstrap().then((data) => {
      store.hydrateFromBootstrap(data);
      this.sync();
      return data;
    }).catch(function failed() {
      return null;
    });
  },

  loadBindCard(bindNo) {
    this.setData({ bindLoading: true, bindError: '' });
    partnerApi.getPublic({ partnerNo: bindNo }).then((data) => {
      // partner.getPublic 直接返回 partnerPublic DTO
      // {partnerNo,displayName,services,zones,acceptingOrders,status}；绑定前不含 avatarFileId
      const partner = data || {};
      // P1-2：这次 getPublic 的公开预览缓存给绑定页（take 后失效，避免落地双请求）
      previewCache.remember(partner.partnerNo || bindNo, partner);
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
    store.set('activeRole', route.ROLES.CUSTOMER);
    storage.setLastRole(route.ROLES.CUSTOMER);
    redirect(customer.profileComplete ? route.CUSTOMER_HOME : route.PROFILE_PAGE);
  },

  onPartnerTap() {
    const partner = this.data.vm.partner || {};
    store.set('activeRole', route.ROLES.PARTNER);
    storage.setLastRole(route.ROLES.PARTNER);
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
    store.set('activeRole', route.ROLES.CUSTOMER);
    storage.setLastRole(route.ROLES.CUSTOMER);
    const customer = this.data.vm.customer || {};
    if (!customer.profileComplete) {
      const target = route.PROFILE_PAGE + '?bind=' + encodeURIComponent(card.partnerNo || '');
      wx.reLaunch({ url: target });
      return;
    }
    wx.reLaunch({ url: BIND_PAGE + '?bind=' + encodeURIComponent(card.partnerNo || '') });
  },

  onRetryBootstrap() {
    this.hydrateBootstrap().then((data) => {
      if (!data) {
        wx.showToast({ title: '网络开小差了，请重试', icon: 'none' });
        return;
      }
      if (this._bindNo) this.loadBindCard(this._bindNo);
    });
  },

  // 好友转发：通用邀请卡（path=/pages/role/index，零业务值）；朋友圈：固定标题+中性封面
  onShareAppMessage() {
    return share.appMessage();
  },

  onShareTimeline() {
    return share.timeline();
  }
});
