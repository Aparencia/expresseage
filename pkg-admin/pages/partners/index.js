// pkg-admin/pages/partners/index.js · 兼职列表（脱敏检索、行内展开、停用/恢复、账号切换入口）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const flow = require('../../common/list-flow');
const vm = require('./parts/view-model');

const LIST = {
  withStatus: true,
  request(page, params) {
    return admin.listPartners(params);
  },
  decorate(page, result) {
    return vm.decorateList((result && result.list) || [], page.data.expandedNo);
  }
};

Page(Object.assign(flow.methods(LIST), {
  data: {
    keyword: '',
    statusTabs: vm.buildTabs(''),
    activeStatus: '',
    includeTest: false,
    list: [],
    nextCursor: '',
    expandedNo: '',
    loading: true,
    loadingMore: false,
    searching: false,
    submitting: false,
    error: '',
    forbidden: false,
    searched: false
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

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: vm.buildTabs(key),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onRowTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item) return;
    this.setData({ expandedNo: this.data.expandedNo === item.partnerNo ? '' : item.partnerNo });
    this.decorateExpanded();
  },

  decorateExpanded() {
    this.setData({ list: vm.applyExpanded(this.data.list, this.data.expandedNo) });
  },

  onSwitch(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item) return;
    // 只有 ACTIVE 真实账号或测试账号可切换（停用/注销不可查看，§3.5/§6.2）
    if (!item.canSwitch) {
      feedback.toast('该用户当前不可查看，请确认对方账号处于正常状态后再试。');
      return;
    }
    const tab = item.isTest ? C.ACCOUNT_TAB_TEST : C.ACCOUNT_TAB_REAL;
    const url = C.PAGE_URLS.accountSwitch +
      '?tab=' + tab +
      '&role=' + C.ROLE_PARTNER +
      '&targetNo=' + encodeURIComponent(item.partnerNo);
    feedback.go(url);
  },

  onSuspend(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item || this.data.submitting) return;
    if (this.data.submitting) return;
    if (vm.isGovernanceBlocked(item)) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '停用兼职',
      content: vm.suspendConfirmContent(item),
      confirmText: '确认停用',
      danger: true,
      editable: true,
      placeholderText: '停用原因（必填，最多 100 字）'
    }).then((res) => {
      if (!res.confirm) return;
      this.submitSuspend(item, String(res.content || '').trim());
    });
  },

  submitSuspend(item, reason) {
    const checked = vm.validateSuspendReason(reason);
    if (!checked.ok) {
      feedback.toast(checked.error);
      return;
    }
    this.setData({ submitting: true });
    admin.setPartnerStatus({
      partnerNo: item.partnerNo,
      status: C.PARTNER_STATUS_SUSPENDED,
      reason: checked.reason
    }).then(() => {
      this.setData({ submitting: false, expandedNo: '' });
      feedback.toast('已停用 ' + item.displayName + '（' + item.partnerNo + '）');
      this.loadList(true).catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  },

  onResume(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item || this.data.submitting) return;
    if (vm.isGovernanceBlocked(item)) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '恢复兼职',
      content: vm.resumeConfirmContent(item),
      confirmText: '确认恢复'
    }).then((res) => {
      if (!res.confirm) return;
      this.setData({ submitting: true });
      admin.setPartnerStatus({
        partnerNo: item.partnerNo,
        status: C.PARTNER_STATUS_ACTIVE,
        reason: C.RESTORE_REASON_DEFAULT
      }).then(() => {
        this.setData({ submitting: false, expandedNo: '' });
        feedback.toast('已恢复 ' + item.displayName + '（' + item.partnerNo + '）');
        this.loadList(true).catch(function () {});
      }).catch((err) => {
        this.setData({ submitting: false });
        feedback.toast(err && err.message);
      });
    });
  }
}));
