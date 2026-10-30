// pages/role/index.js · 身份选择 / 邀请码入口 / 邀请卡落地（D37：由 launch 分流进入）/ 开发者分流
// 只做：取参 → 调 api → setData → 事件转发；不出现 action 字符串与集合名。
'use strict';

const store = require('../../store/index');
const userApi = require('../../api/modules/user');
const partnerApi = require('../../api/modules/partner');
const route = require('../../config/route');
const storage = require('../../utils/storage');
const ids = require('../../utils/ids');
const previewCache = require('../../utils/preview-cache');
const pendingInvite = require('../../utils/share/pending-invite');
const share = require('../../utils/share/handlers');
const sharePlatform = require('../../utils/share/platform');
const privacyGate = require('../../utils/privacy-gate');

const ACTIVATE_PAGE = '/pkg-partner/pages/activate/index';
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
    // D38：邀请卡落地三态——bindBound=已绑定同一兼职（只提示「已绑定·去下单」，不重复 create）；
    // bindBlocked=当前是兼职身份（顾客绑定入口不渲染，只提示）；其余=可绑定。
    bindBound: false,
    bindBlocked: false,
    // 朋友圈单页模式（scene=1154）：只渲染静态介绍，点底部「前往小程序」后走正常登录/分流
    singlePage: false,
    singlePageHint: '',
    shareTip: ''
  },

  onLoad(options) {
    const opts = options || {};
    // D37：launch 传入的 bind 已是 canonical；这里再经纯件归一一次（手工深链/旧参数兜底），非法丢弃。
    const bindNo = route.entryOf(opts).bind;
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
    // D37 兜底（2026-10-30 用户侧复现）：修复前发出的分享卡 path 固化在聊天里，仍会直落本页；
    // 未同意隐私/版本变更时必须先回 launch 过闸，同意后 launch 再分流回邀请卡（参数不丢）。
    privacyGate.redirectIfNeeded({ bind: this._bindNo }).then((blocked) => {
      if (!blocked) this.enter();
    });
  },

  // 隐私闸放行后的邀请卡初始化（原 onLoad 下半段；只在闸通过后执行，未同意时不做任何绑定动作）。
  enter() {
    this.sync();
    if (this.data.vm.viewContext) {
      const role = this.data.vm.viewContext.role === 'PARTNER' ? 'PARTNER' : 'CUSTOMER';
      redirect(role === 'PARTNER' ? route.PARTNER_WORKBENCH : route.CUSTOMER_HOME);
      return;
    }
    if (this.data.vm.isDeveloper) {
      redirect(ACCOUNT_SWITCH_PAGE);
      return;
    }
    this.applyBindContext(this._bindNo || '');
    if (this._bindNo) this.loadBindCard(this._bindNo);
    if (!this.data.vm.roles || this.data.vm.roles.length === 0) this.hydrateBootstrap();
  },

  onShow() {
    if (this.data.singlePage) {
      return;
    }
    this.sync();
    this.applyBindContext(this._bindNo || '');
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
      this.applyBindContext(this._bindNo || '');
      return data;
    }).catch(function failed() {
      return null;
    });
  },

  // D38：邀请卡落地显示态判定（只读 store 快照，不改业务）：已绑定同号 / 兼职身份不可绑。
  applyBindContext(bindNo) {
    if (!bindNo) {
      this.setData({ bindBound: false, bindBlocked: false });
      return;
    }
    const vm = this.data.vm;
    const binding = store.snapshot().binding || {};
    // D37 落地卡按目标角色渲染：兼职身份不显示顾客绑定入口（顾客身份才显示）
    const partnerOnly = vm.activeRole === route.ROLES.PARTNER;
    const same = !!(binding.partnerNo && binding.partnerNo === bindNo);
    if (same || partnerOnly) {
      pendingInvite.clear();
    }
    this.setData({ bindBound: same, bindBlocked: partnerOnly });
  },

  loadBindCard(bindNo) {
    this.setData({ bindLoading: true, bindError: '' });
    partnerApi.getPublic({ partnerNo: bindNo }).then((data) => {
      // partner.getPublic 直接返回 partnerPublic DTO
      // {partnerNo,displayName,services,zones,acceptingOrders,status}；绑定前不含 avatarFileId
      const partner = data || {};
      const canonical = partner.partnerNo || bindNo;
      this._bindCanonical = canonical;
      // P1-2：这次 getPublic 的公开预览缓存给绑定页（take 后失效，避免落地双请求）
      previewCache.remember(canonical, partner);
      this.applyBindContext(canonical);
      this.setData({
        bindLoading: false,
        bindCard: {
          partnerNo: ids.displayNo(ids.NO_KIND.PARTNER, canonical) || canonical,
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

  // D38：邀请卡主 CTA 四态——已绑同号「已绑定·去下单」（不重复 create）；兼职身份不渲染；
  // 资料不完整先补资料（保存成功后由 profile 自动续跳）；已绑异号走 D28 既有换绑入口（一次确认）；
  // 未绑定且资料完整 → bind 页 ?auto=1 落地即自动绑定（仍由顾客本人 openid 发起）。
  onBindTap() {
    const canonical = this._bindCanonical || this._bindNo;
    if (!canonical || this.data.bindBlocked) {
      return;
    }
    store.set('activeRole', route.ROLES.CUSTOMER);
    storage.setLastRole(route.ROLES.CUSTOMER);
    if (this.data.bindBound) {
      pendingInvite.clear();
      wx.showToast({ title: '已绑定这位兼职，去下单吧', icon: 'none' });
      wx.switchTab({ url: route.CUSTOMER_HOME });
      return;
    }
    const customer = this.data.vm.customer || {};
    if (!customer.profileComplete) {
      pendingInvite.remember(canonical);
      wx.reLaunch({ url: route.profileEditPathOf(canonical) });
      return;
    }
    const binding = store.snapshot().binding || {};
    if (binding.partnerNo === canonical) {
      // 兜底：卡片异步加载期间 binding 才水合时也不重复 create（与按钮「已绑定·去下单」同口径）
      pendingInvite.clear();
      wx.showToast({ title: '已绑定这位兼职，去下单吧', icon: 'none' });
      wx.switchTab({ url: route.CUSTOMER_HOME });
      return;
    }
    if (binding.partnerNo) {
      // 已绑定其他兼职：沿用 D28「换绑一次确认」既有入口，不自动 create（防止误绑）；
      // 换绑由顾客在 bind 页显式确认，不保留自动续绑 pending（避免资料保存后二次触发 create）。
      pendingInvite.clear();
      wx.navigateTo({ url: route.bindPagePathOf(canonical, { mode: 'rebind' }) });
      return;
    }
    pendingInvite.clear();
    wx.navigateTo({ url: route.bindPagePathOf(canonical, { auto: true }) });
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
