// pkg-admin/pages/customers/index.js · 顾客列表（默认脱敏；默认排除测试账号）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const flow = require('../../common/list-flow');
const vm = require('./parts/view-model');

const LIST = {
  request(page, params) {
    return admin.listCustomers(params);
  },
  decorate(page, result) {
    return vm.decorateList((result && result.list) || []);
  },
  patch(page) {
    return { emptyText: vm.emptyTextOf(page.data.keyword) };
  },
  keywordOfSearch(event) {
    return String(event.detail.value || '').trim();
  },
  shouldSearch(keyword) {
    return vm.shouldSearch(keyword);
  }
};

Page(Object.assign(flow.methods(LIST), {
  data: {
    keyword: '',
    includeTest: false,
    list: [],
    nextCursor: '',
    loading: true,
    loadingMore: false,
    searching: false,
    error: '',
    forbidden: false,
    searched: false,
    emptyText: '还没有顾客资料。'
  },

  onLoad() {
    this.loadList(true);
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'loadList', true);
  },

  loadList(reset) {
    return flow.loadList(this, reset, LIST);
  },

  onOpenDetail(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.customerDetail + '?customerNo=' + encodeURIComponent(no));
  }
}));
