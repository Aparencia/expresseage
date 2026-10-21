// pkg-admin/pages/invite-codes/index.js · 邀请码生成/批量/整批复制/作废/状态查看
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const PAGE_SIZE = 20;

function buildTabs(activeStatus, counts) {
  return C.INVITE_STATUS_TABS.map(function (tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

function buildExpiresLabels() {
  return C.EXPIRES_OPTIONS.map(function (option) {
    return option.label;
  });
}

Page({
  data: {
    statusTabs: buildTabs('', null),
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
    expiresLabels: buildExpiresLabels(),
    expiresIndex: 2,
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
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      const counts = (result && result.counts) || null;
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        counts: counts,
        statusTabs: buildTabs(this.data.activeStatus, counts || this.data.counts),
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
    const usedByText = item.usedByPartnerNo
      ? item.usedByPartnerNo + ' ' + (item.usedByDisplayName || '')
      : '';
    return {
      invitationCode: item.invitationCode,
      codeMasked: F.maskInvitationCode(item.invitationCode),
      statusText: C.INVITE_STATUS_LABELS[item.status] || '—',
      isUnused: item.status === C.INVITE_STATUS_UNUSED,
      batchText: item.batchId || '—',
      expiresText: F.formatTime(item.expiresAt),
      createdAtText: F.formatTime(item.createdAt),
      note: item.note || '',
      usedByText: usedByText,
      usedAtText: item.usedAt ? F.formatTime(item.usedAt) : ''
    };
  },

  onTabChange(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: buildTabs(key, this.data.counts),
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
    const count = Number(this.data.form.count);
    if (!count || count < 1 || count > C.LIMITS.inviteCountMax) {
      this.setData({ createError: '单批最多生成 50 个邀请码。' });
      return;
    }
    const note = String(this.data.form.note || '').trim();
    if (note.length > C.LIMITS.inviteNoteMax) {
      this.setData({ createError: '备注最多 50 字。' });
      return;
    }
    const expires = C.EXPIRES_OPTIONS[this.data.expiresIndex] || C.EXPIRES_OPTIONS[2];
    this.setData({ submitting: true, createError: '' });
    admin.createInvites({
      count: count,
      expiresInHours: expires.value,
      note: note
    }).then((result) => {
      const codes = (result && result.codes) || [];
      this.setData({
        submitting: false,
        showCreate: false,
        showResult: true,
        result: {
          batchId: (result && result.batchId) || '',
          expiresAtText: F.formatTime(result && result.expiresAt),
          codes: codes,
          codeText: codes.join('\n'),
          count: codes.length
        }
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
      const copy = item.statusText === '已使用'
        ? '这个邀请码已被使用，不能作废。'
        : '这个邀请码已过期，无需作废。';
      feedback.toast(copy);
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
      }
      this.setData({ submitting: true });
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
