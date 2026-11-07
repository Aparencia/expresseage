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
    forbidden: false,
    notFound: false,
    customer: null,
    binding: null,
    orderSummaryText: '',
    recentOrders: [],
    submitting: false
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
    return feedback.refresh(this, 'loadDetail');
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
