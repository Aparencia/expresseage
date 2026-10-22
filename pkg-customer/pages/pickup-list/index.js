// pkg-customer/pages/pickup-list/index.js · 顾客取件清单（独立入口，D26）
// 只显示本人**进行中订单**的「快递站点 + 取件码」，按订单分组、可复制；
// 勾选「我已取到」只写本机 storage（utils/storage.pickupChecks），不回写服务端、不影响订单状态。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const storage = require('../../../utils/storage');
const route = require('../../../config/route');
const view = require('./parts/pickup-view');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

Page({
  data: {
    loading: true,
    error: '',
    rows: [],
    groups: [],
    summary: { total: 0, checked: 0, needCode: 0 },
    readonly: false
  },

  onShow() {
    if (!this.guard()) return;
    const snapshot = store.snapshot();
    this.setData({ readonly: !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY') });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  guard() {
    const snapshot = store.snapshot();
    if (snapshot.viewContext) {
      if (snapshot.viewContext.role !== 'CUSTOMER') {
        wx.reLaunch({ url: route.PARTNER_WORKBENCH });
        return false;
      }
      return true;
    }
    if (snapshot.activeRole !== 'CUSTOMER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
      return false;
    }
    return true;
  },

  refresh() {
    this.setData({ loading: true, error: '' });
    return this.loadAll().then((orders) => {
      this.applyOrders(orders);
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '取件清单加载失败，请重试' });
      return false;
    });
  },

  // 进行中订单（服务端 status=IN_PROGRESS 不分页桶），逐页取到没有下一页为止（上限 3 页防失控）
  async loadAll() {
    const orders = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = { status: 'IN_PROGRESS', limit: PAGE_SIZE };
      if (cursor) payload.cursor = cursor;
      const data = await orderApi.listCustomer(payload);
      const list = (data && data.list) || [];
      list.forEach(function push(order) { orders.push(order); });
      cursor = (data && data.nextCursor) || null;
      if (!cursor || list.length === 0) break;
    }
    return orders;
  },

  applyOrders(orders) {
    const checks = storage.getPickupChecks() || {};
    const rows = view.rowsOf(orders, checks);
    const groups = view.groupByOrder(rows);
    this.setData({
      loading: false,
      error: '',
      rows: rows,
      groups: groups,
      summary: view.summaryOf(rows)
    });
    return true;
  },

  // 本机勾选：只存标记，不碰订单（D26）
  writeCheck(key, checked) {
    storage.setPickupCheck(key, checked === true);
  },

  onToggleCheck(event) {
    const key = String(event.currentTarget.dataset.key || '');
    const row = (this.data.rows || []).filter(function match(item) { return item.key === key; })[0];
    if (!row) return;
    const next = !row.checked;
    this.writeCheck(key, next);
    this.applyOrdersFromRows(view.toggleRow(this.data.rows, key));
  },

  onToggleGroup(event) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '');
    const group = (this.data.groups || []).filter(function match(item) { return item.orderNo === orderNo; })[0];
    if (!group) return;
    const next = !group.allChecked;
    group.rows.forEach((row) => this.writeCheck(row.key, next));
    this.applyOrdersFromRows(view.toggleGroup(this.data.rows, orderNo, next));
  },

  applyOrdersFromRows(rows) {
    const groups = view.groupByOrder(rows);
    this.setData({ rows: rows, groups: groups, summary: view.summaryOf(rows) });
  },

  onCopyCode(event) {
    const row = this.findRow(event);
    if (!row) return;
    if (!row.hasCode) {
      wx.showToast({ title: row.codeText, icon: 'none' });
      return;
    }
    this.copyText(row.codeText, '取件码已复制');
  },

  onCopyLine(event) {
    const row = this.findRow(event);
    if (!row) return;
    this.copyText(view.copyTextOf(row), '站点与取件码已复制');
  },

  onCopyAll() {
    const text = view.copyAllTextOf(this.data.groups);
    if (!text) {
      wx.showToast({ title: '当前没有可复制的取件信息', icon: 'none' });
      return;
    }
    this.copyText(text, '取件清单已复制');
  },

  copyText(text, tip) {
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: tip || '已复制', icon: 'none' });
      }
    });
  },

  findRow(event) {
    const key = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.key) || '');
    return (this.data.rows || []).filter(function match(item) { return item.key === key; })[0] || null;
  },

  onOrderTap(event) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '');
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onRetry() {
    this.refresh();
  }
});
