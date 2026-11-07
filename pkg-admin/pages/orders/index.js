// pkg-admin/pages/orders/index.js · 订单总览/异常工单（脱敏只读、默认过滤测试数据）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const flow = require('../../common/list-flow');
const vm = require('./parts/view-model');

const LIST = {
  withStatus: true,
  request(page, params) {
    return admin.listOrders(params);
  },
  decorate(page, result) {
    return vm.decorateList((result && result.list) || []);
  },
  patch(page, result) {
    const counts = (result && result.counts) || null;
    return {
      counts: counts,
      statusTabs: vm.buildTabs(page.data.activeStatus, counts || page.data.counts),
      emptyText: vm.buildEmptyText({ keyword: page.data.keyword, activeStatus: page.data.activeStatus })
    };
  }
};

Page(Object.assign(flow.methods(LIST), {
  data: {
    statusTabs: vm.buildTabs('', null),
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
    forbidden: false,
    searched: false,
    emptyText: vm.buildEmptyText({})
  },

  onLoad(query) {
    const raw = query && query.status ? query.status : '';
    const status = raw ? decodeURIComponent(raw) : '';
    if (status) {
      this.setData({ activeStatus: status, statusTabs: vm.buildTabs(status, null) });
    }
    this.loadList(true);
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'loadList', true);
  },

  loadList(reset) {
    return flow.loadList(this, reset, LIST);
  },

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: vm.buildTabs(key, this.data.counts),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onOpenDetail(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  }
}));
