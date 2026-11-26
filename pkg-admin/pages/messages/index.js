// pkg-admin/pages/messages/index.js · 后台消息（异常工单 + 识别失败待复核摘要 + 系统状态，聚合视图）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const staleRequest = require('../../../utils/stale-request');
const vm = require('./parts/view-model');

Page({
  data: {
    loading: true,
    error: '',
    forbidden: false,
    exceptions: [],
    failures: [],
    systemLines: [],
    exceptionTotal: 0,
    failureTotal: 0,
    loadedOnce: false
  },

  onLoad() {
    this._loadToken = 0;
    this._unloaded = false;
    this.load();
  },

  onUnload() {
    // 离页位先置 + 代次作废：在飞响应不再 setData/不弹错（迟到包静默丢弃）
    this._unloaded = true;
    this._loadToken = (this._loadToken || 0) + 1;
  },

  onShow() {
    if (this.data.loadedOnce) {
      this.load();
    }
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'load');
  },

  load() {
    if (this._unloaded === true) {
      return Promise.resolve();
    }
    // 2026-11-26 审查修复（TD-100 同类）：onShow/下拉/重试可并发，只有最新代次能落地
    const taken = { token: (this._loadToken || 0) + 1 };
    this._loadToken = taken.token;
    this.setData({ loading: true, error: '' });
    return Promise.all([
      admin.listOrders({ status: C.ORDER_STATUS_EXCEPTION, limit: 20 }),
      admin.listRecognitionFailures({ status: C.FAILURE_STATUS_PENDING, limit: 5 }),
      admin.stats({})
    ]).then((result) => {
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
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
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
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
