// pages/customer/orders/index.js · 顾客订单列表（tab2）
// 分组只切前端；数据由服务端排序并分页，客户端不重排（ARCHITECTURE §5.2）。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');

const TABS = [
  { key: 'ONGOING', label: '进行中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELLED', label: '已取消' }
];
const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const PAGE_SIZE = 20;

Page({
  data: {
    tabs: TABS,
    activeKey: 'ONGOING',
    list: [],
    cursor: null,
    hasMore: true,
    loading: false,
    error: ''
  },

  onShow() {
    this.guard();
    this.refresh();
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

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  onReachBottom() {
    this.loadMore();
  },

  refresh() {
    return this.loadPage(true);
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return Promise.resolve();
    return this.loadPage(false);
  },

  async loadPage(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: reset ? '' : this.data.error });
    const payload = { status: this.data.activeKey, limit: PAGE_SIZE };
    if (!reset && this.data.cursor) payload.cursor = this.data.cursor;
    try {
      const data = await orderApi.listCustomer(payload);
      const page = (data && data.list) || [];
      const list = reset ? page : this.data.list.concat(page);
      this.setData({
        loading: false,
        list: list,
        cursor: (data && data.nextCursor) || null,
        hasMore: !!(data && data.nextCursor)
      });
    } catch (err) {
      this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
    }
  },

  onTabTap(e) {
    const key = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'ONGOING';
    if (key === this.data.activeKey) return;
    this.setData({ activeKey: key, list: [], cursor: null, hasMore: true });
    this.refresh();
  },

  onOrderTap(e) {
    const orderNo = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderNo) || '';
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onEmptyAction() {
    if (this.data.activeKey === 'ONGOING') {
      wx.navigateTo({ url: CREATE_PAGE });
      return;
    }
    wx.switchTab({ url: route.CUSTOMER_HOME });
  },

  onRetry() {
    this.refresh();
  }
});
