// pkg-admin/pages/order-detail/index.js · 订单详情（后台脱敏只读；仅真实异常单可介入取消）
const admin = require('../../../api/modules/admin');
const orderApi = require('../../../api/modules/order');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

Page({
  data: {
    orderNo: '',
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    notFound: false,
    submitting: false,
    order: null,
    events: [],
    canCancel: false
  },

  onLoad(query) {
    const raw = query && query.orderNo ? query.orderNo : '';
    const no = raw ? decodeURIComponent(raw) : '';
    if (!no) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ orderNo: no });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  load() {
    this.setData({ loading: true, error: '', notFound: false });
    return admin.getOrder({ orderNo: this.data.orderNo }).then((result) => {
      this.apply(result || {});
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

  apply(result) {
    const built = vm.buildDetailView(result, this.data.orderNo);
    this.setData({
      order: built.order,
      events: built.events,
      canCancel: built.canCancel
    });
  },

  onRetry() {
    this.load().catch(function () {});
  },

  onOpenCustomer() {
    const no = this.data.order && this.data.order.customerNo;
    if (!no || no === '—') return;
    feedback.go(C.PAGE_URLS.customerDetail + '?customerNo=' + encodeURIComponent(no));
  },

  onCancelAnomaly() {
    if (this.data.submitting || !this.data.canCancel) return;
    const order = this.data.order || {};
    feedback.confirm({
      title: '介入取消',
      content: vm.cancelConfirmContent(order),
      confirmText: '确认取消',
      danger: true,
      editable: true,
      placeholderText: '介入原因（必填，最多 200 字）'
    }).then((res) => {
      if (!res.confirm) return;
      const checked = vm.validateCancelNote(res.content);
      if (!checked.ok) {
        feedback.toast(checked.error);
        return;
      }
      this.submitCancel(checked.note);
    });
  },

  submitCancel(note) {
    const order = this.data.order || {};
    this.setData({ submitting: true });
    orderApi.cancel({
      orderNo: this.data.orderNo,
      reason: C.OTHER_REASON_CODE,
      note: note
    }).then(() => {
      this.setData({ submitting: false });
      feedback.toast('订单 ' + order.orderNo + ' 已取消，已记入审计。');
      this.load().catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  }
});
