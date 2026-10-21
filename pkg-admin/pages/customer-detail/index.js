// pkg-admin/pages/customer-detail/index.js · 顾客详情（脱敏资料 + 绑定关系 + 订单摘要，无写动作）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

Page({
  data: {
    customerNo: '',
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    notFound: false,
    customer: null,
    binding: null,
    orderSummaryText: '',
    recentOrders: []
  },

  onLoad(query) {
    const raw = query && query.customerNo ? query.customerNo : '';
    const no = raw ? decodeURIComponent(raw) : '';
    if (!no) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ customerNo: no });
    this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadDetail() {
    this.setData({ loading: true, error: '', notFound: false });
    return admin.getCustomer({ customerNo: this.data.customerNo }).then((result) => {
      this.applyDetail(result || {});
      this.setData({ loading: false });
    }).catch((err) => {
      if (err && err.code === 'NOT_FOUND') {
        this.setData({ loading: false, notFound: true });
        feedback.toast('记录不存在或已注销。');
        return;
      }
      feedback.handleError(this, err);
      throw err;
    });
  },

  applyDetail(result) {
    const built = vm.buildDetailView(result, this.data.customerNo);
    this.setData({
      customer: built.customer,
      binding: built.binding,
      orderSummaryText: built.orderSummaryText,
      recentOrders: built.recentOrders
    });
  },

  onRetry() {
    this.loadDetail().catch(function () {});
  },

  onOpenOrder(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  },

  onOpenSwitch() {
    const url = C.PAGE_URLS.accountSwitch +
      '?tab=' + C.ACCOUNT_TAB_REAL +
      '&role=' + C.ROLE_CUSTOMER +
      '&targetNo=' + encodeURIComponent(this.data.customerNo);
    feedback.go(url);
  }
});
