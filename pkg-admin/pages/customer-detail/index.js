// pkg-admin/pages/customer-detail/index.js · 顾客详情（脱敏资料 + 绑定关系 + 订单摘要 + D68 停用/恢复治理动作）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const staleRequest = require('../../../utils/stale-request');
const vm = require('./parts/view-model');

Page({
  data: {
    customerNo: '',
    loading: true,
    error: '',
    forbidden: false,
    notFound: false,
    customer: null,
    binding: null,
    orderSummaryText: '',
    recentOrders: [],
    submitting: false
  },

  onLoad(query) {
    this._loadToken = 0;
    this._unloaded = false;
    const raw = query && query.customerNo ? query.customerNo : '';
    const no = raw ? decodeURIComponent(raw) : '';
    if (!no) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ customerNo: no });
    this.loadDetail();
  },

  onUnload() {
    // 离页位先置 + 代次作废：治理动作后的回读/下拉迟到的包不再 setData、不弹假错
    this._unloaded = true;
    this._loadToken = (this._loadToken || 0) + 1;
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'loadDetail');
  },

  loadDetail() {
    if (this._unloaded === true) {
      return Promise.resolve();
    }
    // 2026-11-26 审查修复（TD-100 同类）：下拉/重试/治理动作后回读可并发，只有最新代次能落地
    const taken = { token: (this._loadToken || 0) + 1 };
    this._loadToken = taken.token;
    const stale = () => this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken);
    this.setData({ loading: true, error: '', notFound: false });
    return admin.getCustomer({ customerNo: this.data.customerNo }).then((result) => {
      if (stale()) {
        return;
      }
      this.applyDetail(result || {});
      this.setData({ loading: false });
    }).catch((err) => {
      if (stale()) {
        return;
      }
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
  },

  onSuspend() {
    const customer = this.data.customer;
    if (!customer || this.data.submitting) return;
    if (customer.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '停用顾客',
      content: vm.suspendConfirmContent(customer),
      confirmText: '确认停用',
      danger: true,
      editable: true,
      placeholderText: '停用原因（必填，最多 100 字）'
    }).then((res) => {
      if (!res.confirm) return;
      const checked = vm.validateSuspendReason(res.content);
      if (!checked.ok) {
        feedback.toast(checked.error);
        return;
      }
      this.submitStatus(C.USER_STATUS_SUSPENDED, checked.reason);
    });
  },

  onResume() {
    const customer = this.data.customer;
    if (!customer || this.data.submitting) return;
    if (customer.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '恢复顾客',
      content: vm.resumeConfirmContent(customer),
      confirmText: '确认恢复'
    }).then((res) => {
      if (!res.confirm) return;
      this.submitStatus(C.USER_STATUS_ACTIVE, C.RESTORE_REASON_DEFAULT);
    });
  },

  submitStatus(status, reason) {
    this.setData({ submitting: true });
    admin.setCustomerStatus({
      customerNo: this.data.customerNo,
      status: status,
      reason: reason
    }).then(() => {
      this.setData({ submitting: false });
      feedback.toast(status === C.USER_STATUS_ACTIVE ? '已恢复该顾客' : '已停用该顾客');
      this.loadDetail().catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  }
});
