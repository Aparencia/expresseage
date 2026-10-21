// pkg-admin/pages/customer-detail/index.js · 顾客详情（脱敏资料 + 绑定关系 + 订单摘要，无写动作）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

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
    const customer = result.customer || {};
    const binding = result.bindingSummary || null;
    const summary = result.orderSummary || {};
    const orders = result.recentOrders || [];
    this.setData({
      customer: {
        customerNo: customer.customerNo || this.data.customerNo,
        displayName: F.textOrDash(customer.displayName),
        dormText: customer.dormText || customer.dorm || '—',
        phoneTailText: customer.phoneTail || '—',
        profileText: customer.profileCompleted ? '资料完整' : '资料未完整',
        isTest: customer.isTest === true
      },
      binding: binding ? this.decorateBinding(binding) : null,
      orderSummaryText: this.buildSummaryText(summary),
      recentOrders: orders.map((item) => this.decorateOrder(item))
    });
  },

  decorateBinding(binding) {
    return {
      partnerNo: binding.partnerNo || '—',
      displayName: F.textOrDash(binding.displayName),
      statusText: C.PARTNER_STATUS_LABELS[binding.status] || '—',
      boundAtText: binding.boundAt ? F.formatTime(binding.boundAt) : ''
    };
  },

  buildSummaryText(summary) {
    const pick = function (value) {
      return value === undefined || value === null ? '—' : F.numOrZero(value);
    };
    return '进行中 ' + pick(summary.inProgress) +
      ' · 已完成 ' + pick(summary.completed) +
      ' · 异常 ' + pick(summary.exception);
  },

  decorateOrder(item) {
    return {
      orderNo: item.orderNo || '—',
      statusText: item.statusText || C.ORDER_STATUS_LABELS[item.status] || '—',
      serviceName: item.serviceName || item.serviceCode || '—',
      dormText: item.dormText || item.dorm || '—',
      statusUpdatedAtText: F.formatTime(item.statusUpdatedAt),
      isTest: item.isTest === true
    };
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
