// pages/customer/orders/index.js · 顾客订单列表（tab2）
// 分组只切前端；数据由服务端排序并分页，客户端不重排（ARCHITECTURE §5.2）；
// 分组计数取服务端 counts，SUBMITTED 行由纯件按 statusUpdatedAt + orderTimeoutMinutes 倒计时。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');
const ordersView = require('../parts/orders-view');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const PAGE_SIZE = 20;

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
    error: '',
    hasPending: false
  },

  onShow() {
    this.guard();
    this.refresh();
  },

  onHide() {
    this.stopTicker();
  },

  onUnload() {
    this.stopTicker();
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
      this.setData({
        loading: false,
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
      this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
      return false;
    });
  },

  syncTicker() {
    if (this.data.hasPending) this.startTicker();
    else this.stopTicker();
  },

  // 本地秒级倒计时（不发网络请求；只更新等待接单行的时间文案）
  startTicker() {
    if (this._ticker) return;
    this._ticker = setInterval(() => {
      if (!this.data.hasPending) {
        this.stopTicker();
        return;
      }
      this.setData({ list: ordersView.tickRows(this.data.list, this.nowMs(), this.config()) });
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
