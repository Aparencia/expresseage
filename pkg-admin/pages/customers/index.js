// pkg-admin/pages/customers/index.js · 顾客列表（默认脱敏；默认排除测试账号）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const PAGE_SIZE = 20;
const SEARCH_MIN = 2;
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
    searched: false
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
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
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
    const inProgress = F.numOrZero(item.inProgressCount);
    const total = F.numOrZero(item.totalCount);
    return {
      customerNo: item.customerNo || '—',
      displayName: F.textOrDash(item.displayName),
      dormText: item.dormText || item.dorm || '—',
      bindingText: item.bindingPartnerNo ? '已绑定 ' + item.bindingPartnerNo : '未绑定',
      profileText: item.profileCompleted ? '资料完整' : '资料未完整',
      progressText: '进行中 ' + inProgress + ' / 累计 ' + total,
      isTest: item.isTest === true
    };
  },

  onKeywordInput(event) {
    const keyword = String(event.detail.value || '');
    this.setData({ keyword: keyword });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (keyword.length === 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.loadList(true).catch(function () {});
      }, DEBOUNCE_MS);
      return;
    }
    if (keyword.length < SEARCH_MIN) {
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
