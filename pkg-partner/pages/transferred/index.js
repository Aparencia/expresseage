// pkg-partner/pages/transferred/index.js · 「转出单」页（D103，第 35 页）
// 只展示「我转出且对方已接收」的单：order.listPartner({view:'handover'})，行可点进订单详情
// （D85：转派发起人仍可继续操作）。不写库、不改取件清单 counts；页面只做接线/setData/事件转发。
'use strict';

const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');
const store = require('../../../store/index');
const view = require('./parts/transferred-view');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';

Page({
  data: {
    stage: 'loading',
    rows: [],
    nextCursor: null,
    loadingMore: false,
    summaryText: '',
    errorText: ''
  },

  onLoad() {
    this._unloaded = false;
    this._token = 0;
  },

  onUnload() {
    this._unloaded = true;
  },

  onShow() {
    if (!this.guard()) {
      return;
    }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => {
      if (!this._unloaded) {
        wx.stopPullDownRefresh();
      }
    }).catch(() => {
      if (!this._unloaded) {
        wx.stopPullDownRefresh();
      }
    });
  },

  onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return;
    }
    this.load(true);
  },

  guard() {
    const snapshot = store.snapshot();
    const session = snapshot.viewContext;
    if (session && session.role) {
      if (session.role !== 'PARTNER') {
        wx.reLaunch({ url: route.CUSTOMER_HOME });
        return false;
      }
      return true;
    }
    if (snapshot.activeRole !== 'PARTNER') {
      wx.reLaunch({ url: route.workspaceHomeOf(snapshot.activeRole) });
      return false;
    }
    return true;
  },

  refresh() {
    return this.load(false);
  },

  load(more) {
    if (this._unloaded) {
      return Promise.resolve(false);
    }
    const token = this._token + 1;
    this._token = token;
    if (more) {
      this.setData({ loadingMore: true });
    } else {
      this.setData({ stage: 'loading', errorText: '' });
    }
    const cursor = more ? this.data.nextCursor : null;
    return orderApi.listPartner(view.queryOf(cursor)).then((data) => this.apply(data, more, token))
      .catch((err) => this.fail(err, more, token));
  },

  apply(data, more, token) {
    if (this._unloaded || token !== this._token) {
      return false;
    }
    const incoming = view.rowsOf(data && data.list);
    const rows = more ? this.data.rows.concat(incoming) : incoming;
    const nextCursor = (data && data.nextCursor) || null;
    this.setData({
      stage: rows.length ? 'ready' : 'empty',
      rows: rows,
      nextCursor: nextCursor,
      loadingMore: false,
      errorText: '',
      summaryText: view.summaryOf(rows, nextCursor)
    });
    return true;
  },

  fail(err, more, token) {
    if (this._unloaded || token !== this._token) {
      return false;
    }
    const text = (err && err.message) || '转出单没加载出来，先检查网络再重试';
    if (more) {
      this.setData({ loadingMore: false });
    } else {
      this.setData({ stage: 'error', errorText: text, loadingMore: false });
    }
    wx.showToast({ title: text, icon: 'none' });
    return false;
  },

  onRetryTap() {
    this.refresh();
  },

  onRowTap(event) {
    const orderNo = (event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.orderNo : '') || '';
    if (orderNo) {
      wx.navigateTo({ url: DETAIL_PAGE + orderNo });
    }
  }
});
