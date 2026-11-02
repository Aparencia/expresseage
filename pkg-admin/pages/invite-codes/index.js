// pkg-admin/pages/invite-codes/index.js · 邀请码生成/批量/整批复制/作废/状态查看
// D59（v1.10）：行增类型（kind/kindText：DEV/SUB）与发码主兼职编号（SUB）；SUB 码后台只读（行内无作废）；
//   类型筛选（全部/DEV/SUB）——服务端 admin.listInvites 暂无 kind 入参，按已取页本地筛选（缺口已回报）。
const admin = require('../../../api/modules/admin');
const modeGuard = require('../../../api/mode-guard');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const PAGE_SIZE = 20;
// 本地类型筛选的续页上限：本页 0 匹配且还有下一页时自动续取，避免「空态但其实后面有该类型的码」
const MAX_SCAN_PAGES = 5;

Page({
  data: {
    statusTabs: vm.buildTabs('', null),
    activeStatus: '',
    kindLabels: vm.kindLabels(),
    kindIndex: 0,
    readonly: false,
    counts: null,
    list: [],
    nextCursor: '',
    loading: true,
    loadingMore: false,
    error: '',
    errorAt: '',
    forbidden: false,
    emptyText: vm.emptyTextOf('', ''),
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
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
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

  // 取列表（分页 + 类型本地筛选）：返回 { rows, nextCursor, counts }；nextCursor 始终是服务端原始游标，
  //   本地筛选不改变翻页口径；筛选后本页 0 匹配且还有下一页时自动续取（≤MAX_SCAN_PAGES 页）。
  collectPages(startCursor) {
    const kind = vm.activeKindOf(this.data.kindIndex);
    const readonly = this.data.readonly;
    const status = this.data.activeStatus;
    let cursor = startCursor || '';
    let rows = [];
    let counts = null;
    let nextCursor = '';
    let rounds = 0;
    const step = () => {
      const payload = { status: status, limit: PAGE_SIZE };
      if (cursor) payload.cursor = cursor;
      return admin.listInvites(payload).then((result) => {
        if (!counts) counts = (result && result.counts) || null;
        const pageRows = vm.filterByKind(
          vm.decorateList((result && result.list) || [], { readonly: readonly }), kind);
        rows = rows.concat(pageRows);
        nextCursor = (result && result.nextCursor) || '';
        cursor = nextCursor;
        rounds += 1;
        if (rows.length > 0 || !nextCursor || rounds >= MAX_SCAN_PAGES) {
          return { rows: rows, nextCursor: nextCursor, counts: counts };
        }
        return step();
      });
    };
    return step();
  },

  loadList(reset) {
    if (reset) {
      this.setData({ loading: true, error: '' });
    }
    return this.collectPages('').then((page) => {
      this.setData({
        list: reset ? page.rows : this.data.list.concat(page.rows),
        nextCursor: page.nextCursor,
        counts: page.counts,
        statusTabs: vm.buildTabs(this.data.activeStatus, page.counts || this.data.counts),
        emptyText: vm.emptyTextOf(this.data.activeStatus, vm.activeKindOf(this.data.kindIndex)),
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
    this.collectPages(this.data.nextCursor).then((page) => {
      this.setData({
        list: this.data.list.concat(page.rows),
        nextCursor: page.nextCursor,
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
      emptyText: vm.emptyTextOf(key, vm.activeKindOf(this.data.kindIndex)),
      nextCursor: ''
    });
    this.loadList(true).catch(function () {});
  },

  onKindChange(event) {
    const index = Number(event.detail.value);
    if (index === this.data.kindIndex) return;
    this.setData({
      kindIndex: index,
      emptyText: vm.emptyTextOf(this.data.activeStatus, vm.activeKindOf(index)),
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
    // 按钮只在 canRevoke（未使用 + DEV + 非只读）时渲染；此处再守一道（SUB/只读会话即便触发也只提示原因）
    if (!item.canRevoke) {
      const hint = item.readonlyHint || vm.revokeBlockedCopy(item.status);
      if (hint) feedback.toast(hint);
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
