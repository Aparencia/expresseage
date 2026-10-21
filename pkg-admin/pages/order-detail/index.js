// pkg-admin/pages/order-detail/index.js · 订单详情（后台脱敏只读；仅真实异常单可介入取消）
const admin = require('../../../api/modules/admin');
const orderApi = require('../../../api/modules/order');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

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
    const order = result.order || {};
    const events = (result.events || []).map((item) => this.decorateEvent(item));
    this.setData({
      order: this.decorateOrder(order),
      events: events,
      canCancel: !order.isTest && order.status === C.ORDER_STATUS_EXCEPTION
    });
  },

  decorateOrder(order) {
    const parcel = order.parcel || {};
    const service = order.service || {};
    const exception = order.exception || {};
    const customer = order.customer || {};
    const partner = order.partner || {};
    return {
      orderNo: order.orderNo || this.data.orderNo,
      statusText: order.statusText || C.ORDER_STATUS_LABELS[order.status] || '—',
      serviceName: service.name || order.serviceName || service.code || '—',
      appointText: order.appointText || '—',
      note: order.note || '',
      deliveryNote: order.deliveryNote || '',
      cancelReasonText: order.cancelReasonText || '',
      customerNo: order.customerNo || '—',
      customerName: F.textOrDash(order.customerDisplayName || customer.displayName),
      partnerNo: order.partnerNo || '—',
      partnerName: F.textOrDash(order.partnerDisplayName || partner.displayName),
      stationText: [parcel.stationId, parcel.stationName].filter(Boolean).join(' ') || '—',
      pickupCodeText: F.textOrDash(parcel.pickupCode),
      lockerNoText: F.textOrDash(parcel.lockerNo),
      trackingTailText: F.textOrDash(parcel.trackingTail),
      exceptionText: exception.text || '',
      exceptionCodeText: exception.codeText || exception.code || '',
      reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : '',
      createdAtText: F.formatTime(order.createdAt),
      statusUpdatedAtText: F.formatTime(order.statusUpdatedAt),
      isTest: order.isTest === true,
      impersonatedBy: order.impersonatedBy || ''
    };
  },

  decorateEvent(item) {
    const label = item.label || item.title || item.note || item.type || '状态更新';
    return {
      label: label,
      actor: item.actorText || item.actorRole || '',
      atText: F.formatTime(item.at || item.createdAt)
    };
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
      content: '将取消订单 ' + order.orderNo + '（' + order.statusText + '）。取消后双方可见原因与状态，不可恢复。请填写介入原因（必填，最多 200 字）。',
      confirmText: '确认取消',
      danger: true,
      editable: true,
      placeholderText: '介入原因（必填，最多 200 字）'
    }).then((res) => {
      if (!res.confirm) return;
      const note = String(res.content || '').trim();
      if (!note) {
        feedback.toast('请填写介入原因（最多 200 字）。');
        return;
      }
      if (note.length > C.LIMITS.cancelReasonMax) {
        feedback.toast('介入原因最多 200 字。');
        return;
      }
      this.submitCancel(note);
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
