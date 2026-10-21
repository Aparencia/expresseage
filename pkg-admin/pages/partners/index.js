// pkg-admin/pages/partners/index.js · 兼职列表（脱敏检索、行内展开、停用/恢复、账号切换入口）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

function buildTabs(activeStatus) {
  return C.PARTNER_STATUS_TABS.map(function (tab) {
    return { key: tab.key, label: tab.label, active: tab.key === activeStatus };
  });
}

Page({
  data: {
    keyword: '',
    statusTabs: buildTabs(''),
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
    errorAt: '',
    forbidden: false,
    searched: false
  },

  onLoad() {
    this.loadList(true);
  },

  onUnload() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  onPullDownRefresh() {
    this.loadList(true).then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  loadList(reset) {
    if (reset) {
      this.setData({ loading: !this.data.searched, searching: this.data.searched, error: '' });
    }
    return admin.listPartners({
      keyword: this.data.keyword,
      status: this.data.activeStatus,
      includeTest: this.data.includeTest,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        loading: false,
        searching: false,
        loadingMore: false,
        searched: true
      });
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  loadMore() {
    if (this.data.loading || this.data.searching || this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    admin.listPartners({
      keyword: this.data.keyword,
      status: this.data.activeStatus,
      includeTest: this.data.includeTest,
      cursor: this.data.nextCursor,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      this.setData({
        list: this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        loadingMore: false
      });
    }).catch((err) => {
      this.setData({ loadingMore: false });
      feedback.toast(err && err.message);
    });
  },

  decorateRow(item) {
    const isTest = item.isTest === true;
    const status = item.status || '';
    return {
      partnerNo: item.partnerNo || '—',
      displayName: F.textOrDash(item.displayName),
      statusText: C.PARTNER_STATUS_LABELS[status] || '—',
      isTest: isTest,
      expanded: item.partnerNo === this.data.expandedNo,
      bindingText: '绑定 ' + F.numOrZero(item.bindingCount),
      orderText: '今日 ' + F.numOrZero(item.todayOrders) + ' / 累计 ' + F.numOrZero(item.totalOrders),
      serviceCount: F.numOrZero(item.serviceCount),
      activatedAtText: item.activatedAt ? F.formatTime(item.activatedAt) : '',
      suspendedReason: item.suspendedReason || '',
      canSuspend: !isTest && status === C.PARTNER_STATUS_ACTIVE,
      canResume: !isTest && status === C.PARTNER_STATUS_SUSPENDED
    };
  },

  onKeywordInput(event) {
    const keyword = String(event.detail.value || '');
    this.setData({ keyword: keyword });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loadList(true).catch(function () {});
    }, DEBOUNCE_MS);
  },

  onSearchConfirm() {
    this.loadList(true).catch(function () {});
  },

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: buildTabs(key),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onIncludeTestChange(event) {
    this.setData({ includeTest: event.detail.value === true });
    this.loadList(true).catch(function () {});
  },

  onRetry() {
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
    const rows = this.data.list.map((item) => this.decorateRow(item));
    this.setData({ list: rows });
  },

  onSwitch(event) {
    const item = this.data.list[Number(event.currentTarget.dataset.index)];
    if (!item) return;
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
    if (item.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '停用兼职',
      content: '停用后，' + item.displayName + '（' + item.partnerNo + '）将无法登录兼职端，名下未完成订单转异常待处理，绑定顾客暂时不能向他下单。历史订单与编号保留。确定停用？',
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
    if (!reason) {
      feedback.toast('请填写停用原因（最多 100 字）。');
      return;
    }
    if (reason.length > C.LIMITS.suspendReasonMax) {
      feedback.toast('停用原因最多 100 字。');
      return;
    }
    this.setData({ submitting: true });
    admin.setPartnerStatus({
      partnerNo: item.partnerNo,
      status: C.PARTNER_STATUS_SUSPENDED,
      reason: reason
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
    if (item.isTest) {
      feedback.toast('测试账号不能执行真实治理动作。');
      return;
    }
    feedback.confirm({
      title: '恢复兼职',
      content: '恢复后，' + item.displayName + '（' + item.partnerNo + '）可重新登录兼职端；停用期间产生的异常订单仍需逐单处理。确定恢复？',
      confirmText: '确认恢复'
    }).then((res) => {
      if (!res.confirm) return;
      this.setData({ submitting: true });
      admin.setPartnerStatus({
        partnerNo: item.partnerNo,
        status: C.PARTNER_STATUS_ACTIVE,
        reason: '后台恢复'
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
});
