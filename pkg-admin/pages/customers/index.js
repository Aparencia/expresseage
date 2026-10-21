// pkg-admin/pages/customers/index.js · 顾客列表（默认脱敏；默认排除测试账号）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

Page({
  data: {
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
    emptyText: '还没有顾客资料。'
  },

  onLoad() {
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
    return admin.listCustomers({
      keyword: this.data.keyword,
      includeTest: this.data.includeTest,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = vm.decorateList((result && result.list) || []);
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        emptyText: vm.emptyTextOf(this.data.keyword),
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
    admin.listCustomers({
      keyword: this.data.keyword,
      includeTest: this.data.includeTest,
      cursor: this.data.nextCursor,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = vm.decorateList((result && result.list) || []);
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

  onKeywordInput(event) {
    const keyword = String(event.detail.value || '');
    this.setData({ keyword: keyword });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (!vm.shouldSearch(keyword)) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loadList(true).catch(function () {});
    }, DEBOUNCE_MS);
  },

  onSearchConfirm(event) {
    const keyword = String(event.detail.value || '').trim();
    this.setData({ keyword: keyword });
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
    feedback.go(C.PAGE_URLS.customerDetail + '?customerNo=' + encodeURIComponent(no));
  }
});
