// pkg-admin/pages/invite-codes/index.js · 邀请码生成/批量/整批复制/作废/状态查看
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const PAGE_SIZE = 20;

Page({
  data: {
    statusTabs: vm.buildTabs('', null),
    activeStatus: '',
    counts: null,
    list: [],
    nextCursor: '',
    loading: true,
    loadingMore: false,
    error: '',
    errorAt: '',
    forbidden: false,
    showCreate: false,
    expiresLabels: vm.buildExpiresLabels(),
    expiresIndex: C.DEFAULT_EXPIRES_INDEX,
    form: { count: '1', note: '' },
    createError: '',
    submitting: false,
    showResult: false,
    result: { batchId: '', expiresAtText: '', codes: [], codeText: '', count: 0 }
  },

  noop() {},

  onLoad() {
    this.loadList(true);
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
      this.setData({ loading: true, error: '' });
    }
    return admin.listInvites({
      status: this.data.activeStatus,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map(vm.decorateRow);
      const counts = (result && result.counts) || null;
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        counts: counts,
        statusTabs: vm.buildTabs(this.data.activeStatus, counts || this.data.counts),
        loading: false,
        loadingMore: false
      });
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    admin.listInvites({
      status: this.data.activeStatus,
      cursor: this.data.nextCursor,
      limit: PAGE_SIZE
    }).then((result) => {
      const rows = ((result && result.list) || []).map(vm.decorateRow);
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

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: vm.buildTabs(key, this.data.counts),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onRetry() {
    this.loadList(true).catch(function () {});
  },

  onOpenCreate() {
    this.setData({
      showCreate: true,
      createError: '',
      expiresIndex: 2,
      form: { count: '1', note: '' }
    });
  },

  onCloseCreate() {
    if (this.data.submitting) return;
    this.setData({ showCreate: false });
  },

  onCountInput(event) {
    this.setData({ 'form.count': event.detail.value, createError: '' });
  },

  onNoteInput(event) {
    this.setData({ 'form.note': event.detail.value, createError: '' });
  },

  onExpiresChange(event) {
    this.setData({ expiresIndex: Number(event.detail.value) });
  },

  onCreateSubmit() {
    if (this.data.submitting) return;
    const checked = vm.validateCreate(this.data.form);
    if (!checked.ok) {
      this.setData({ createError: checked.error });
      return;
    }
    const expires = vm.pickExpires(this.data.expiresIndex);
    this.setData({ submitting: true, createError: '' });
    admin.createInvites({
      count: checked.count,
      expiresInHours: expires.value,
      note: checked.note
    }).then((result) => {
      this.setData({
        submitting: false,
        showCreate: false,
        showResult: true,
        result: vm.buildResult(result)
      });
      this.loadList(true).catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false, createError: (err && err.message) || '生成失败，请重试。' });
    });
  },

  onCopyAll() {
    const text = this.data.result.codeText;
    if (!text) return;
    const count = this.data.result.count;
    wx.setClipboardData({
      data: text,
      success: function () {
        feedback.toast('已复制 ' + count + ' 个邀请码');
      },
      fail: function () {
        feedback.toast('复制失败，请长按选择或稍后重试。');
      }
    });
  },

  onCloseResult() {
    this.setData({
      showResult: false,
      result: { batchId: '', expiresAtText: '', codes: [], codeText: '', count: 0 }
    });
  },

  onRevoke(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item || this.data.submitting) return;
    if (!item.isUnused) {
      feedback.toast(vm.revokeBlockedCopy(item.status));
      return;
    }
    feedback.confirm({
      title: '作废邀请码',
      content: '作废后这个邀请码立即失效且无法恢复，兼职将无法用它激活。确定作废？',
      confirmText: '确认作废',
      danger: true,
      editable: true,
      placeholderText: '作废原因（≤100 字，可留空）'
    }).then((res) => {
      if (!res.confirm) return;
      const reason = String(res.content || '').trim() || C.REVOKE_REASON_DEFAULT;
      if (reason.length > C.LIMITS.revokeReasonMax) {
        feedback.toast('作废原因最多 100 字。');
        return;
      }      this.setData({ submitting: true });
      admin.revokeInvite({ invitationCode: item.invitationCode, reason: reason }).then(() => {
        this.setData({ submitting: false });
        feedback.toast('邀请码已作废');
        this.loadList(true).catch(function () {});
      }).catch((err) => {
        this.setData({ submitting: false });
        feedback.toast(err && err.message);
      });
    });
  }
});
