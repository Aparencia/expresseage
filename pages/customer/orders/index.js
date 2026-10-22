// pages/customer/orders/index.js · 顾客订单列表（tab2）
// 分组只切前端；数据由服务端排序并分页，客户端不重排（ARCHITECTURE §5.2）；
// 分组计数取服务端 counts，SUBMITTED 行由纯件按 statusUpdatedAt + orderTimeoutMinutes 倒计时。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');
const ordersView = require('../parts/orders-view');
const tickerPatch = require('./parts/ticker-patch');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const PAGE_SIZE = 20;
// P0-11：首屏请求 ≥300ms 才显示「加载中」，快网不闪（UX_CUSTOMER §0.3 五态模板）
const LOADING_DELAY_MS = 300;

Page({
  data: {
    tabs: ordersView.tabsWithCounts({}),
    activeKey: 'ONGOING',
    emptyText: ordersView.emptyStateOf('ONGOING').text,
    emptyActionText: ordersView.emptyStateOf('ONGOING').actionText,
    list: [],
    cursor: null,
    hasMore: true,
    loading: false,
    loadingVisible: false,
    error: '',
    hasPending: false
  },

  onLoad() {
    this._loadingTimer = null;
  },

  onShow() {
    this.guard();
    this.refresh();
  },

  onHide() {
    this.stopTicker();
    this.clearLoadingTimer();
  },

  onUnload() {
    this.stopTicker();
    this.clearLoadingTimer();
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

  nowMs() {
    return ordersView.serverNowMs(store.snapshot().serverTimeSkew, Date.now());
  },

  config() {
    return store.snapshot().config || {};
  },

  refresh() {
    return this.loadPage(true);
  },

  onPullDownRefresh() {
    this.loadPage(true).then((ok) => {
      wx.stopPullDownRefresh();
      if (ok) wx.showToast({ title: '刷新成功', icon: 'none' });
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return Promise.resolve(false);
    return this.loadPage(false);
  },

  activeTabKey() {
    return this.data.activeKey || 'ONGOING';
  },

  loadPage(reset) {
    if (this.data.loading) return Promise.resolve(false);
    this.setData({ loading: true, error: '' });
    this.scheduleLoadingVisible();
    const payload = { limit: PAGE_SIZE };
    const status = ordersView.requestStatusOf(this.activeTabKey());
    if (status) payload.status = status;
    if (!reset && this.data.cursor) payload.cursor = this.data.cursor;
    return orderApi.listCustomer(payload).then((data) => {
      const counts = (data && data.counts) || {};
      const rows = ordersView.visibleRows((data && data.list) || []).map((order) => ordersView.rowView(order, {
        nowMs: this.nowMs(),
        config: this.config()
      }));
      const list = reset ? rows : this.data.list.concat(rows);
      this.clearLoadingTimer();
      this.setData({
        loading: false,
        loadingVisible: false,
        list: list,
        cursor: (data && data.nextCursor) || null,
        hasMore: !!(data && data.nextCursor),
        tabs: ordersView.tabsWithCounts(counts),
        hasPending: ordersView.hasPending(list)
      });
      this.syncTicker();
      return true;
    }).catch((err) => {
      // 失败保留旧数据（已在列表里的行不清空），顶部错误条提示可重试
      this.clearLoadingTimer();
      this.setData({ loading: false, loadingVisible: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
      return false;
    });
  },

  scheduleLoadingVisible() {
    this.clearLoadingTimer();
    this._loadingTimer = setTimeout(() => {
      this._loadingTimer = null;
      if (this.data.loading) this.setData({ loadingVisible: true });
    }, LOADING_DELAY_MS);
  },

  clearLoadingTimer() {
    if (this._loadingTimer) {
      clearTimeout(this._loadingTimer);
      this._loadingTimer = null;
    }
  },

  syncTicker() {
    if (this.data.hasPending) this.startTicker();
    else this.stopTicker();
  },

  // 本地秒级倒计时（不发网络请求；P0-6：只对时间文案变化的等待接单行做行级 path 补丁，不整表下发）
  startTicker() {
    if (this._ticker) return;
    this._ticker = setInterval(() => {
      if (!this.data.hasPending) {
        this.stopTicker();
        return;
      }
      const patch = tickerPatch.build(this.data.list, this.nowMs(), this.config());
      if (patch) this.setData(patch);
    }, 1000);
  },

  stopTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  onTabTap(e) {
    const key = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'ONGOING';
    if (key === this.data.activeKey) return;
    const empty = ordersView.emptyStateOf(key);
    this.stopTicker();
    this.setData({
      activeKey: key,
      emptyText: empty.text,
      emptyActionText: empty.actionText,
      list: [],
      cursor: null,
      hasMore: true,
      error: '',
      hasPending: false
    });
    this.refresh();
  },

  onOrderTap(e) {
    const orderNo = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderNo) || '';
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onReorderTap(e) {
    const orderNo = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderNo) || '';
    if (!orderNo) return;
    wx.navigateTo({ url: CREATE_PAGE + '?reorder=' + encodeURIComponent(orderNo) });
  },

  onEmptyAction() {
    if (this.activeTabKey() === 'ONGOING') {
      wx.navigateTo({ url: CREATE_PAGE });
      return;
    }
    wx.switchTab({ url: route.CUSTOMER_HOME });
  },

  onRetry() {
    this.refresh();
  }
});
