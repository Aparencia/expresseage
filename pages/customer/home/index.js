// pages/customer/home/index.js · 顾客首页（tab1）
// 数据来源：store（资料/配置/切换会话）+ bind.getCurrent（绑定与对方档案）+ order.listCustomer（进行中）。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const orderApi = require('../../../api/modules/order');
const configApi = require('../../../api/modules/config');
const messageApi = require('../../../api/modules/message');
const maintenance = require('../../../utils/maintenance');
const storage = require('../../../utils/storage');
const route = require('../../../config/route');
const format = require('../parts/format');
const ordersView = require('../parts/orders-view');
const homeView = require('./parts/home-view');
const guideView = require('./parts/guide-view');
const share = require('../../../utils/share/handlers');
const sharePlatform = require('../../../utils/share/platform');

const BIND_PAGE = '/pkg-customer/pages/bind/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const MESSAGES_PAGE = '/pkg-customer/pages/messages/index';
const PICKUP_LIST_PAGE = '/pkg-customer/pages/pickup-list/index';
const CONFIG_TTL_MS = 60 * 1000;
// P0-11：首屏请求 ≥300ms 才置「加载」态（快网不闪、不产生多余 setData），对齐 UX_CUSTOMER §0.3
const LOADING_DELAY_MS = 300;

// 直接读 store 引用（不整份 clone）：面板只在 show 时刷新，且页面不改写这些对象
function pickVm() {
  return {
    customer: store.get('customer') || { profileComplete: false },
    binding: store.get('binding') || null,
    config: store.get('config') || {},
    viewContext: store.get('viewContext') || null,
    badges: store.get('badges') || {}
  };
}

// 公告配置：{enabled,title,text}；enabled=false 一律不展示（DATA_MODEL §2.10）
function announcementOf(config) {
  const value = config && config.announcement;
  if (!value || value.enabled === false) {
    return '';
  }
  return format.announcementText(value);
}

Page({
  data: {
    vm: pickVm(),
    loading: true,
    error: '',
    partnerPublic: null,
    // 兼职卡展示模型（头像/昵称/编号/接单状态；partnerPublic 未到时用 store.binding 字段兜底）
    partnerCard: homeView.partnerCardOf(null, null),
    servicesText: '',
    scopeText: homeView.SCOPE_ALL_TEXT,
    order: null,
    // M-21：order-row 需要视图模型（codeText/customerLine/serviceName/timeText），不能直喂服务端 DTO
    orderRow: null,
    waitedText: '',
    announcement: '',
    announcementClosed: false,
    maintenance: { visible: false, title: '', text: '' },
    guide: guideView.closedState(),
    canOrder: false,
    orderDisabledReason: '',
    readonly: false,
    bindInput: '',
    // 朋友圈单页模式（scene=1154）：无登录态/不能调云，只渲染静态预览，不做网络请求（D36）
    singlePage: false,
    singlePageHint: '',
    shareTip: ''
  },

  onLoad() {
    // 维护遮罩关闭只记本页会话态（不写本地存储）；60s 配置节流时间戳
    this._maintenanceClosed = '';
    this._maintenanceView = null;
    this._configFetchedAt = 0;
    this._loadingTimer = null;
    this._startupBindingTaken = false;
    const singlePage = sharePlatform.singlePageNow();
    this.setData({
      singlePage: singlePage,
      singlePageHint: singlePage ? share.SINGLE_PAGE_HINT : '',
      shareTip: share.SHARE_TIP
    });
    this._off = store.subscribe(() => this.sync());
  },

  onShow() {
    if (this.data.singlePage) {
      return;
    }
    this.guard();
    this.syncTabBar();
    this.sync();
    this.refreshConfig();
    this.refresh();
    this.loadUnread();
    this.initGuide();
  },

  onHide() {
    this.clearTicker();
    this.clearLoadingTimer();
  },

  onUnload() {
    if (this._off) this._off();
    this.clearTicker();
    this.clearLoadingTimer();
  },

  // custom-tab-bar 是每个 tab 页各一份实例：本页 onShow 显式同步选中格，避免底部高亮错格
  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) {
      tabBar.setData({ selected: 0 });
    }
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

  // store 通知扇出很密（每个成功响应都可能 notify）：先按引用判等，无关变化不重复 setData/派生
  sync() {
    const vm = pickVm();
    const last = this._vmRefs || {};
    const changed = last.customer !== vm.customer || last.binding !== vm.binding
      || last.config !== vm.config || last.viewContext !== vm.viewContext
      || last.badges !== vm.badges;
    if (!changed) {
      return;
    }
    this._vmRefs = {
      customer: vm.customer,
      binding: vm.binding,
      config: vm.config,
      viewContext: vm.viewContext,
      badges: vm.badges
    };
    this.setData({ vm: vm });
    this.applyDerived();
  },

  // 一次 setData 下发全部派生字段（避免逐字段 setData 触发多轮渲染）
  applyDerived() {
    const vm = this.data.vm;
    const partner = this.data.partnerPublic;
    const config = vm.config || {};
    const customer = vm.customer || {};
    const viewContext = vm.viewContext || null;
    const readonly = !!(viewContext && viewContext.viewMode === 'READONLY');
    // bind.getCurrent 只回当前 ACTIVE 绑定；解绑后 binding=null（无 status 字段）
    const announcement = announcementOf(config);
    const active = !!(vm.binding && vm.binding.bindingId);
    // 维护模式（UX_DEVELOPER §7.5）：全屏公告 + 写入口禁用；会话内可 ack 关闭，文案变化后重新出现
    const maintenanceView = maintenance.buildMaintenanceView(config);
    this._maintenanceView = maintenanceView;
    const maintenanceClosed = maintenanceView.enabled && this._maintenanceClosed === maintenanceView.text;
    // 下单前置预检（P1-6）：维护 > 资料 > 绑定 > 只读 > 接单开关 > 服务范围；本地仅预检，服务端仍是唯一权威
    const reason = homeView.orderBlockReasonOf({
      maintenanceText: maintenanceView.enabled ? maintenanceView.title : '',
      profileComplete: customer.profileComplete === true,
      bound: active === true,
      readonly: readonly,
      partnerClosed: !!(partner && partner.acceptingOrders === false),
      zoneAllowed: homeView.zoneAllowedOf(partner, customer.zone, config.zoneLabels)
    });
    this.setData({
      readonly: readonly,
      announcement: announcement,
      partnerCard: homeView.partnerCardOf(vm.binding, partner),
      servicesText: homeView.serviceTextOf(partner, config.serviceCatalog || []),
      scopeText: homeView.scopeTextOf(partner, config.zoneLabels),
      canOrder: reason === '',
      orderDisabledReason: reason,
      maintenance: {
        visible: maintenanceView.enabled && !maintenanceClosed,
        title: maintenanceView.title,
        text: maintenanceView.text
      }
    });
  },

  // 公告/维护模式 onShow 生效（UX_DEVELOPER §7.4：端侧 onShow/60 秒内）；60s 节流，失败下次再试
  refreshConfig() {
    const config = store.get('config');
    if (!config || !config.privacyVersion) {
      return;
    }
    const now = Date.now();
    if (this._configFetchedAt && now - this._configFetchedAt < CONFIG_TTL_MS) {
      return;
    }
    this._configFetchedAt = now;
    configApi.getPublic().then(function apply(cfg) {
      if (cfg) store.patch({ config: cfg });
    }).catch(() => {
      this._configFetchedAt = 0;
    });
  },

  // 维护期写入口统一拦截：文案说真话（服务端同样会以 INVALID_STATE 拒绝）
  maintenanceBlocked() {
    const view = this._maintenanceView;
    if (!view || !view.blocked) {
      return false;
    }
    wx.showToast({ title: view.copy, icon: 'none' });
    return true;
  },

  // 服务端维护闸拒读时：显示兜底维护遮罩（读闸由服务端只拦写，此处仅兜底不静默）
  applyMaintenanceError(err) {
    const maintenanceText = maintenance.writeRejectedTextOf(err);
    if (maintenanceText) {
      const fallback = maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: '' } });
      this._maintenanceView = fallback;
      this.setData({
        loading: false,
        error: maintenanceText,
        maintenance: { visible: true, title: fallback.title, text: fallback.text }
      });
      return;
    }
    this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
  },

  // P0-11：首屏请求 ≥300ms 才置「加载」态；快网请求不产生加载闪动与多余 setData
  scheduleLoading() {
    this.clearLoadingTimer();
    this._loadingTimer = setTimeout(() => {
      this._loadingTimer = null;
      this.setData({ loading: true });
    }, LOADING_DELAY_MS);
  },

  clearLoadingTimer() {
    if (this._loadingTimer) {
      clearTimeout(this._loadingTimer);
      this._loadingTimer = null;
    }
  },

  // P0-3：首页首次 refresh 复用启动期 bind.getCurrent（同一 Promise，含 partnerPublic）；
  // 之后各次 onShow/下拉仍自行重拉（离开再回来必须拿到最新绑定）。
  takeStartupBinding() {
    if (this._startupBindingTaken || store.getViewContext()) {
      return null;
    }
    this._startupBindingTaken = true;
    const app = typeof getApp === 'function' ? getApp() : null;
    if (!app || typeof app.consumeStartupBinding !== 'function') {
      return null;
    }
    return app.consumeStartupBinding();
  },

  bindingTask() {
    const pending = this.takeStartupBinding();
    if (!pending) {
      return bindApi.getCurrent();
    }
    // 启动期绑定失败（null）→ 本页重拉，保证错误不被静默吞掉
    return pending.then((data) => data || bindApi.getCurrent());
  },

  async refresh() {
    this.setData({ error: '' });
    this.scheduleLoading();
    const tasks = [this.bindingTask(), orderApi.listCustomer({ limit: 1 })];
    if (!this.data.vm.config || !this.data.vm.config.privacyVersion) {
      tasks.push(configApi.getPublic());
    }
    try {
      const results = await Promise.all(tasks);
      this.clearLoadingTimer();
      const bindingData = results[0] || {};
      const listData = results[1] || {};
      if (results[2]) store.patch({ config: results[2] });
      const binding = bindingData.binding || null;
      const partnerPublic = bindingData.partnerPublic || null;
      const order = (listData.list && listData.list.length > 0) ? listData.list[0] : null;
      this.setData({
        loading: false,
        partnerPublic: partnerPublic,
        order: order,
        orderRow: order ? ordersView.rowView(order, {
          nowMs: ordersView.serverNowMs(store.get('serverTimeSkew'), Date.now()),
          config: this.data.vm.config || {}
        }) : null,
        waitedText: order ? '更新于 ' + format.formatTimeAgo(order.statusUpdatedAt) : ''
      });
      // partnerPublic 一并存回 store.binding（P0-3）：其他页/下次进首页复用同一份，不重复拉
      store.patch({ binding: binding ? Object.assign({}, binding, { partnerPublic: partnerPublic }) : null });
      this.syncOngoingBadge(listData.counts && listData.counts.ongoing);
      this.applyDerived();
      this.startTicker();
    } catch (err) {
      this.clearLoadingTimer();
      this.applyMaintenanceError(err);
    }
  },

  startTicker() {
    this.clearTicker();
    this._ticker = setInterval(() => {
      if (!this.data.order) return;
      this.setData({ waitedText: '更新于 ' + format.formatTimeAgo(this.data.order.statusUpdatedAt) });
    }, 30000);
  },

  // 未读消息红点（E13）：message.list({limit:1}) 的 unread → store.badges.messages；失败静默不阻断首页
  loadUnread() {
    messageApi.list({ limit: 1 }).then((data) => {
      const unread = Number(data && data.unread);
      const messages = isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
      const badges = store.get('badges') || {};
      if (badges.messages === messages) return;
      store.patch({ badges: Object.assign({ workbenchPending: 0 }, badges, { messages: messages }) });
    }).catch(function ignore() {
      // 红点读取失败不影响首页浏览，下次 onShow 再试
    });
  },

  // P1-5：订单 tab 数量角标 = 进行中订单数（不清零；onShow/下拉刷新更新，不新增轮询）
  syncOngoingBadge(value) {
    const total = Number(value);
    const ongoing = isFinite(total) && total > 0 ? Math.floor(total) : 0;
    const badges = store.get('badges') || {};
    if (badges.ordersOngoing === ongoing) return;
    store.patch({ badges: Object.assign({}, badges, { ordersOngoing: ongoing }) });
  },

  // P1-7：首用三步引导（只本机记忆；「我的→重新看新手引导」清标记后再次出现）
  initGuide() {
    this.setData({ guide: guideView.showGuideOf(storage.isGuideSeen(guideView.GUIDE_KEY)) });
  },

  onGuideNext() {
    const nextState = guideView.next(this.data.guide);
    if (nextState) {
      this.setData({ guide: nextState });
      return;
    }
    this.finishGuide();
  },

  onGuideSkip() {
    this.finishGuide();
  },

  finishGuide() {
    storage.markGuideSeen(guideView.GUIDE_KEY);
    this.setData({ guide: guideView.closedState() });
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
    if (this.maintenanceBlocked()) {
      return;
    }
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    const value = String(this.data.bindInput || '').trim();
    const url = value ? BIND_PAGE + '?bind=' + encodeURIComponent(value) : BIND_PAGE;
    wx.navigateTo({ url: url });
  },

  onRebindTap() {
    if (this.maintenanceBlocked()) {
      return;
    }
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: BIND_PAGE + '?mode=rebind' });
  },

  onOrderCreateTap() {
    if (this.maintenanceBlocked()) {
      return;
    }
    const reason = this.data.orderDisabledReason;
    if (reason) {
      wx.showToast({ title: reason, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: CREATE_PAGE });
  },

  onOrderTap(e) {
    const order = (e.detail && e.detail.order) || null;
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const orderNo = dataset.orderNo || (order && order.orderNo) || '';
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onMessagesTap() {
    wx.navigateTo({ url: MESSAGES_PAGE });
  },

  // D26：取件清单独立入口（独立页面，不做 tab；只读页面，维护期也可查看）
  onPickupListTap() {
    wx.navigateTo({ url: PICKUP_LIST_PAGE });
  },

  onProfileTap() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onCloseAnnouncement() {
    this.setData({ announcementClosed: true });
  },

  // 维护公告遮罩确认：只关闭本页会话态（再次 onShow 若仍维护且文案变化会重新出现）
  onMaintenanceAck() {
    const view = this._maintenanceView;
    this._maintenanceClosed = view ? view.text : '';
    this.setData({ 'maintenance.visible': false });
  },

  onRetry() {
    this.refresh();
  },

  // 好友转发：通用邀请卡（卡片零业务值）；朋友圈：固定标题+中性封面，落地=本页单页预览
  onShareAppMessage() {
    return share.appMessage();
  },

  onShareTimeline() {
    return share.timeline();
  }
});
