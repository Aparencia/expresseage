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
const renderPlan = require('./parts/render-plan');
const guideView = require('./parts/guide-view');
const share = require('../../../utils/share/handlers');
const sharePlatform = require('../../../utils/share/platform');
const privacyGate = require('../../../utils/privacy-gate');

const BIND_PAGE = '/pkg-customer/pages/bind/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const MESSAGES_PAGE = '/pkg-customer/pages/messages/index';
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

// 公告配置：{enabled,title,text}；enabled=false 一律不展示（DATA_MODEL §2.10）——派生物理在 parts/render-plan.js。

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
    this._hidden = false;
    if (this.data.singlePage) {
      return;
    }
    // D37 兜底（2026-10-30 用户侧复现）：朋友圈卡「前往小程序」等非 launch 首启可能直落首页；
    // 未同意隐私/版本变更时先回启动页过闸，避免用户在无同意入口的页面里反复撞写动作被拒。
    privacyGate.redirectIfNeeded({}).then((blocked) => {
      if (!blocked) this.enter();
    });
  },

  // 隐私闸放行后的首页刷新（原 onShow 主体；切换会话/单页模式不经过这里）。
  enter() {
    this.guard();
    this.syncTabBar();
    this.sync();
    this.refreshConfig();
    this.refresh();
    this.loadUnread();
    this.initGuide();
  },

  onHide() {
    this._hidden = true;
    this.clearTicker();
    this.clearLoadingTimer();
  },

  onUnload() {
    this._hidden = true;
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

  // store 通知扇出很密（每个成功响应都可能 notify，P0-4）：
  //   ① 页面隐藏 → 挂起（0 批 setData；onShow 的 enter() 会补一次同步）；
  //   ② 可见时先按引用判等，无变化 0 批；变化才 1 批下发（vm + 派生合并，不再 vm/派生各一批）。
  sync() {
    const plan = renderPlan.syncPlanOf({
      hidden: this._hidden === true,
      lastRefs: this._vmRefs,
      readVm: pickVm,
      partnerPublic: this.data.partnerPublic,
      maintenanceClosed: this._maintenanceClosed
    });
    if (!plan.apply) {
      return;
    }
    this._vmRefs = plan.refs;
    if (plan.view) {
      this._maintenanceView = plan.view;
    }
    this.setData(plan.patch);
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

  // 一次 refresh = 2 批 setData（P0-4）：第 1 批结果+派生、第 2 批 store 通知合并（详见 parts/render-plan.js）。
  async refresh() {
    if (this.data.error) {
      this.setData({ error: '' });
    }
    this.scheduleLoading();
    const tasks = [this.bindingTask(), orderApi.listCustomer({ limit: 1 })];
    if (!this.data.vm.config || !this.data.vm.config.privacyVersion) {
      tasks.push(configApi.getPublic());
    }
    try {
      const results = await Promise.all(tasks);
      this.clearLoadingTimer();
      // P2：await 期间切 tab/卸载（onHide/onUnload 已置 _hidden）→ 迟到结果不再 setData、不启动 ticker
      if (this._hidden === true) return;
      const bindingData = results[0] || {};
      const listData = results[1] || {};
      const plan = renderPlan.refreshPlanOf({
        current: {
          customer: store.get('customer'),
          config: store.get('config'),
          viewContext: store.get('viewContext'),
          badges: store.get('badges')
        },
        config: results[2] || null,
        binding: bindingData.binding || null,
        partnerPublic: bindingData.partnerPublic || null,
        order: (listData.list && listData.list.length > 0) ? listData.list[0] : null,
        counts: listData.counts,
        nowMs: ordersView.serverNowMs(store.get('serverTimeSkew'), Date.now()),
        maintenanceClosed: this._maintenanceClosed
      });
      if (plan.view) {
        this._maintenanceView = plan.view;
      }
      this.setData(plan.setData);   // 第 1 批：结果 + 派生
      // 单次 store.patch（config/binding/badges 合并）→ 一次 notify → sync 第 2 批（vm + 派生）
      // partnerPublic 一并存回 store.binding（P0-3）：其他页/下次进首页复用同一份，不重复拉
      store.patch(plan.store);
      this.startTicker();
    } catch (err) {
      this.clearLoadingTimer();
      // P2：已隐藏/已卸载页不写迟到错误（onShow 会重新 refresh，不在后台改已离开的页）
      if (this._hidden === true) return;
      this.applyMaintenanceError(err);
    }
  },

  // D42：兼职卡头像 URL 过期/加载失败 → 重拉 bind.getCurrent 拿新 5 分钟临时 URL（只读，失败保留默认头像）
  onPartnerAvatarRetry() {
    const page = this;
    return this.bindingTask().then((data) => {
      const info = data || {};
      const binding = info.binding || null;
      const partnerPublic = info.partnerPublic || null;
      // 先落页面 partnerPublic 再写 store：binding 通知触发的 sync 用新 partnerPublic 重算派生并 1 批 setData
      page.setData({ partnerPublic: partnerPublic });
      store.patch({ binding: binding ? Object.assign({}, binding, { partnerPublic: partnerPublic }) : null });
    }).catch(function ignore() {
      // 重签失败不打断首页：保留默认头像/旧 URL
    });
  },

  startTicker() {
    this.clearTicker();
    // P2：已隐藏（切 tab/卸载）不启动定时器，避免后台空转与对不可见页 setData
    if (this._hidden === true) return;
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
