// pages/customer/home/index.js · 顾客首页（tab1）
// 数据来源：store（资料/配置/切换会话）+ bind.getCurrent（绑定与对方档案）+ order.listCustomer（进行中）。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const orderApi = require('../../../api/modules/order');
const configApi = require('../../../api/modules/config');
const messageApi = require('../../../api/modules/message');
const maintenance = require('../../../utils/maintenance');
const route = require('../../../config/route');
const format = require('../parts/format');

const BIND_PAGE = '/pkg-customer/pages/bind/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const MESSAGES_PAGE = '/pkg-customer/pages/messages/index';
const CONFIG_TTL_MS = 60 * 1000;

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

// 公告配置：{enabled,title,text}；enabled=false 一律不展示（DATA_MODEL §2.10）
function announcementOf(config) {
  const value = config && config.announcement;
  if (!value || value.enabled === false) {
    return '';
  }
  return format.announcementText(value);
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
    maintenance: { visible: false, title: '', text: '' },
    canOrder: false,
    orderDisabledReason: '',
    readonly: false,
    bindInput: ''
  },

  onLoad() {
    // 维护遮罩关闭只记本页会话态（不写本地存储）；60s 配置节流时间戳
    this._maintenanceClosed = '';
    this._maintenanceView = null;
    this._configFetchedAt = 0;
    this._off = store.subscribe(() => this.sync());
  },

  onShow() {
    this.guard();
    this.sync();
    this.refreshConfig();
    this.refresh();
    this.loadUnread();
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
    // bind.getCurrent 只回当前 ACTIVE 绑定；解绑后 binding=null（无 status 字段）
    const announcement = announcementOf(vm.config);
    const active = !!(vm.binding && vm.binding.bindingId);
    // 维护模式（UX_DEVELOPER §7.5）：全屏公告 + 写入口禁用；会话内可 ack 关闭，文案变化后重新出现
    const maintenanceView = maintenance.buildMaintenanceView(vm.config);
    this._maintenanceView = maintenanceView;
    const maintenanceClosed = maintenanceView.enabled && this._maintenanceClosed === maintenanceView.text;
    let reason = '';
    if (maintenanceView.enabled) reason = maintenanceView.title;
    else if (!customer.profileComplete) reason = '先完善资料';
    else if (!active) reason = '先绑定兼职';
    else if (readonly) reason = '开发者只读视角不能操作';
    else if (partner && partner.acceptingOrders === false) reason = '该兼职暂不接单';
    this.setData({
      readonly: readonly,
      announcement: announcement,
      servicesText: serviceText(partner, (vm.config && vm.config.serviceCatalog) || []),
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
      const badges = store.snapshot().badges || {};
      if (badges.messages === messages) return;
      store.patch({ badges: Object.assign({ workbenchPending: 0 }, badges, { messages: messages }) });
    }).catch(function ignore() {
      // 红点读取失败不影响首页浏览，下次 onShow 再试
    });
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
  }
});
