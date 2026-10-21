// pkg-admin/pages/orders/index.js · 订单总览/异常工单（脱敏只读、默认过滤测试数据）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

function buildTabs(activeStatus, counts) {
  return C.ORDER_STATUS_TABS.map(function (tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

Page({
  data: {
    statusTabs: buildTabs('', null),
    activeStatus: '',
    counts: null,
    keyword: '',
    includeTest: false,
    list: [],
    nextCursor: '',
    loading: true,
    loadingMore: false,
    searching: false,
    error: '',
    errorAt: '',
    forbidden: false,
    searched: false,
    emptyText: '当前筛选下没有订单。'
  },

  onLoad(query) {
    const raw = query && query.status ? query.status : '';
    const status = raw ? decodeURIComponent(raw) : '';
    if (status) {
      this.setData({ activeStatus: status, statusTabs: buildTabs(status, null) });
    }
    this.loadList(true);
  },

  onUnload() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  onPullDownRefresh() {
    this.loadList(true).then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  loadList(reset) {
    if (reset) {
      this.setData({ loading: !this.data.searched, searching: this.data.searched, error: '' });
    }
    return admin.listOrders({
      status: this.data.activeStatus,
      keyword: this.data.keyword,
      includeTest: this.data.includeTest,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      const counts = (result && result.counts) || null;
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        counts: counts,
        statusTabs: buildTabs(this.data.activeStatus, counts || this.data.counts),
        emptyText: this.buildEmptyText(),
        loading: false,
        searching: false,
        loadingMore: false,
        searched: true
      });
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  loadMore() {
    if (this.data.loading || this.data.searching || this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    admin.listOrders({
      status: this.data.activeStatus,
      keyword: this.data.keyword,
      includeTest: this.data.includeTest,
      cursor: this.data.nextCursor,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      this.setData({
        list: this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        loadingMore: false
      });
    }).catch((err) => {
      this.setData({ loadingMore: false });
      feedback.toast(err && err.message);
    });
  },

  decorateRow(item) {
    const exception = item.exception || {};
    const exceptionText = exception.codeText || exception.code || '';
    return {
      orderNo: item.orderNo || '—',
      statusText: item.statusText || C.ORDER_STATUS_LABELS[item.status] || '—',
      serviceName: item.serviceName || item.serviceCode || '—',
      dormText: item.dormText || item.dorm || '—',
      statusUpdatedAtText: F.formatTime(item.statusUpdatedAt),
      isTest: item.isTest === true,
      exceptionText: exceptionText,
      partnerNo: item.partnerNo || '',
      reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : ''
    };
  },

  onKeywordInput(event) {
    const keyword = String(event.detail.value || '');
    this.setData({ keyword: keyword });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loadList(true).catch(function () {});
    }, DEBOUNCE_MS);
  },

  onSearchConfirm() {
    this.loadList(true).catch(function () {});
  },

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: buildTabs(key, this.data.counts),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onIncludeTestChange(event) {
    this.setData({ includeTest: event.detail.value === true });
    this.loadList(true).catch(function () {});
  },

  onRetry() {
    this.loadList(true).catch(function () {});
  },

  onOpenDetail(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  }
});
