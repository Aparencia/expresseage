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
    submitting: false,
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
  },

  onSuspend(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item || this.data.submitting) return;
    if (item.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '停用顾客',
      content: vm.suspendConfirmContent(item),
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
      this.submitStatus(item, C.USER_STATUS_SUSPENDED, checked.reason);
    });
  },

  onResume(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item || this.data.submitting) return;
    if (item.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '恢复顾客',
      content: vm.resumeConfirmContent(item),
      confirmText: '确认恢复'
    }).then((res) => {
      if (!res.confirm) return;
      this.submitStatus(item, C.USER_STATUS_ACTIVE, C.RESTORE_REASON_DEFAULT);
    });
  },

  submitStatus(item, status, reason) {
    this.setData({ submitting: true });
    admin.setCustomerStatus({
      customerNo: item.customerNo,
      status: status,
      reason: reason
    }).then(() => {
      this.setData({ submitting: false });
      feedback.toast((status === C.USER_STATUS_ACTIVE ? '已恢复 ' : '已停用 ') + item.displayName + '（' + item.customerNo + '）');
      this.loadList(true).catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  }
}));
