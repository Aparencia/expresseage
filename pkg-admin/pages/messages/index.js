// pkg-admin/pages/messages/index.js · 后台消息（异常工单 + 识别失败待复核摘要 + 系统状态，聚合视图）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

Page({
  data: {
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    exceptions: [],
    failures: [],
    systemLines: [],
    exceptionTotal: 0,
    failureTotal: 0,
    loadedOnce: false
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (this.data.loadedOnce) {
      this.load();
    }
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  load() {
    this.setData({ loading: true, error: '' });
    return Promise.all([
      admin.listOrders({ status: C.ORDER_STATUS_EXCEPTION, limit: 20 }),
      admin.listRecognitionFailures({ status: C.FAILURE_STATUS_PENDING, limit: 5 }),
      admin.stats({})
    ]).then((result) => {
      const orderData = result[0] || {};
      const failureData = result[1] || {};
      const stats = result[2] || {};
      const exceptions = vm.decorateList(orderData.list, vm.decorateOrder);
      const failures = vm.decorateList(failureData.list, vm.decorateFailure);
      const totals = vm.buildTotals(stats, { exceptions: orderData.list || [], failures: failureData.list || [] });
      this.setData({
        exceptions: exceptions,
        failures: failures,
        exceptionTotal: totals.exceptionTotal,
        failureTotal: totals.failureTotal,
        systemLines: vm.buildSystemLines(stats.config || {}),
        loading: false,
        loadedOnce: true
      });
    }).catch((err) => {
      this.setData({ loading: false });
      feedback.handleError(this, err);
      throw err;
    });
  },

  onRetry() {
    this.load().catch(function () {});
  },

  onHandleOrder(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  },

  onReviewFailure(event) {
    const no = event.currentTarget.dataset.no;
    const url = no
      ? C.PAGE_URLS.recognitionReview + '?failureNo=' + encodeURIComponent(no)
      : C.PAGE_URLS.recognitionReview;
    feedback.go(url);
  }
});
