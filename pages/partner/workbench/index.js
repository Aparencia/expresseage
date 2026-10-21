// pages/partner/workbench/index.js · 取件清单（工作台）· 页面只做取参/接线/setData，判据与流程在 parts/*
// 口径：UX_PARTNER §4（工作台专章）、§6（READONLY/TEST_WRITE）。数据源 order.listPartner；
// 行级动作只消费服务端行内 actions[]（批6-A），页面零七状态字面量、零 wx.cloud、零编号生成。
'use strict';

const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const filterView = require('./parts/filter-view');
const groupView = require('./parts/group-view');
const batchView = require('./parts/batch-view');
const selectionFlow = require('./parts/selection-flow');
const actionFlow = require('./parts/action-flow');
const loadView = require('./parts/load-view');
const historyView = require('./parts/history-view');
const guideView = require('./parts/guide-view');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';
const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';
const CHUNK_DELAY_MS = 16;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const COMPLETED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 统计页「今日完成」跳入参数：只接受 YYYY-MM-DD（其它/非法一律忽略，不改既有行为）
function focusDateOf(options) {
  const value = options && typeof options.completedDate === 'string' ? options.completedDate : '';
  return COMPLETED_DATE_RE.test(value) ? value : '';
}

// 服务端自然日日期键（UTC+8，与统计页/云端同口径）
function naturalDayKeyOf(ms) {
  const now = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

const base = {
  data: {
    filters: filterView.FILTERS,
    filter: filterView.FILTER_ALL,
    filterDesc: '',
    keyword: '',
    counts: loadView.COUNTS_FALLBACK,
    groups: [],
    totalRows: 0,
    nextCursor: null,
    stage: 'skeleton',
    errorText: '',
    syncError: '',
    updatedAtText: '',
    lastSuccessText: '',
    loadingMore: false,
    readonly: false,
    testWrite: false,
    sessionView: false,
    selecting: false,
    selectedCount: 0,
    selectableCount: 0,
    selectionText: '',
    batchActions: batchView.toolbarOf(),
    batchRunning: false,
    batchResult: null,
    panel: null,
    undo: actionFlow.closedUndo(),
    banner: { visible: false, pendingNew: 0, text: '', actionText: '去看看' },
    completed: { text: '', expanded: false, loading: false, sections: [], moreText: '', hasMore: false, nextCursor: null },
    guide: guideView.closedState(),
    empty: { title: '', text: '', actions: guideView.emptyActions() },
    partnerNoText: ''
  },

  onLoad(options) {
    this._list = [];
    this._page1Keys = [];
    this._historyRows = [];
    this._olderCursor = null;
    this._ack = null;
    this._chunkToken = 0;
    this._lastBatch = null;
    this._completedFocusDate = focusDateOf(options);
    this.setData({ empty: Object.assign({}, this.data.empty, filterView.emptyOf({ filter: this.data.filter })) });
    this.syncMode();
    this.watchStore();
    this.loadGuide();
  },

  onShow() {
    this.syncMode();
    // onShow 也走增量：已加载过就只发变化行补丁，不整页重拉（UX §4.11）
    this.load({ poll: this.data.stage === 'ready' }).then(() => {
      this.loadHistorySummary();
      this.applyCompletedFocus();
    });
    this.startPolling();
  },

  // 统计页「今日完成」跳转：带 completedDate=今天 时自动展开已完结区（复用既有 onCompletedToggle）
  applyCompletedFocus() {
    const date = this._completedFocusDate;
    if (!date) {
      return;
    }
    this._completedFocusDate = '';
    if (date !== naturalDayKeyOf(Date.now()) || this.data.completed.expanded) {
      return;
    }
    this.onCompletedToggle();
  },

  onHide() {
    this.stopPolling();
    this.clearUndoTimer();
    if (this.data.undo.visible) {
      this.setData({ undo: actionFlow.closedUndo() });
    }
  },

  onUnload() {
    this.stopPolling();
    this.clearUndoTimer();
    if (this.offStore) {
      this.offStore();
      this.offStore = null;
    }
  },

  onPullDownRefresh() {
    this.load({ silent: true }).then(() => {
      this.loadHistorySummary();
      wx.stopPullDownRefresh();
    }).catch(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.nextCursor) {
      return;
    }
    const prev = { list: this._list, page1Keys: this._page1Keys, groups: this.data.groups, counts: this.data.counts };
    const payload = loadView.queryOf({ filterKey: this.data.filter, keyword: this.data.keyword, cursor: this.data.nextCursor });
    this.setData({ loadingMore: true });
    orderApi.listPartner(payload).then((data) => {
      const plan = loadView.applyAppend(prev, data, {
        filterKey: this.data.filter,
        keyword: this.data.keyword,
        selectedMap: this.data.selecting ? groupView.selectionMapOf(this.data.groups) : null
      });
      this._list = plan.list;
      const patch = {
        groups: plan.groups,
        counts: plan.counts,
        totalRows: plan.totalRows,
        nextCursor: plan.nextCursor,
        loadingMore: false
      };
      if (this.data.selecting) {
        const applied = groupView.applySelection(plan.groups, groupView.selectionMapOf(plan.groups));
        patch.selectedCount = applied.selectedCount;
        patch.selectableCount = applied.selectableCount;
        patch.selectionText = batchView.selectionText(applied.selectedCount, applied.selectableCount);
      }
      this.setData(patch);
    }).catch((err) => {
      this.setData({ loadingMore: false });
      this.toastMsg((err && err.message) || '下一批订单没加载出来，检查网络后重试');
    });
  },

  onShareAppMessage() {
    const partnerNo = this.partnerNo();
    return {
      title: '我在做校园代取，凭兼职编号找我下单',
      path: '/pages/role/index' + (partnerNo ? '?bind=' + encodeURIComponent(partnerNo) : '')
    };
  },

  partnerNo() {
    const snapshot = store.snapshot();
    return (snapshot.partner && snapshot.partner.partnerNo) || '';
  },

  syncMode() {
    this.setData({
      readonly: !modeGuard.canRenderWriteButton(),
      testWrite: modeGuard.isTestWrite(),
      sessionView: !!store.getViewContext(),
      partnerNoText: guideView.partnerLine(this.partnerNo())
    });
  },

  watchStore() {
    this.offStore = store.subscribe(() => {
      const readonly = !modeGuard.canRenderWriteButton();
      const sessionView = !!store.getViewContext();
      if (readonly !== this.data.readonly || sessionView !== this.data.sessionView) {
        this.syncMode();
      }
    });
  },

  startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => {
      if (!this.data.batchRunning) {
        this.load({ poll: true });
      }
    }, loadView.POLL_MS);
  },

  stopPolling() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  },

  load(options) {
    const opts = options || {};
    if (!opts.poll && this.data.stage !== 'ready') {
      this.setData({ stage: 'skeleton', errorText: '' });
    }
    const payload = loadView.queryOf({ filterKey: this.data.filter, keyword: this.data.keyword });
    return orderApi.listPartner(payload).then((data) => this.applyResult(data, opts)).catch((err) => this.loadError(err, opts));
  },

  loadError(err, opts) {
    if (err && err.code === 'VIEW_TICKET_EXPIRED') {
      wx.showModal({
        title: '切换会话已过期',
        content: '请回「切换账号」重新开启。',
        showCancel: false,
        success: () => wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE })
      });
      return;
    }
    const text = loadView.errorTextOf(this.data.lastSuccessText);
    if (opts.poll || this.data.stage === 'ready') {
      this.setData({ syncError: text });
      return;
    }
    this.setData({ stage: 'error', errorText: text, empty: filterView.emptyOf({ filter: this.data.filter }) });
  },

  applyResult(data, options) {
    const opts = options || {};
    const prev = { list: this._list, page1Keys: this._page1Keys, groups: this.data.groups, counts: this.data.counts };
    const plan = loadView.applyRefresh(prev, data, {
      filterKey: this.data.filter,
      keyword: this.data.keyword,
      selectedMap: this.data.selecting ? groupView.selectionMapOf(this.data.groups) : null
    });
    this._list = plan.list;
    this._page1Keys = plan.page1Keys;
    const result = loadView.resultPatch(plan, {
      filterKey: this.data.filter,
      poll: opts.poll,
      selecting: this.data.selecting
    });
    this.setData(result.setData);
    if (result.chunk) {
      this.appendChunks(result.chunk.rest);
    }
    this.syncBadge(plan.counts);
    this.syncBanner(plan.counts);
  },

  appendChunks(chunks) {
    if (!chunks || !chunks.length) {
      return;
    }
    const token = (this._chunkToken || 0) + 1;
    this._chunkToken = token;
    const step = (rest) => {
      if (this._chunkToken !== token || !rest.length) {
        return;
      }
      this.setData({ groups: (this.data.groups || []).concat(rest[0]) });
      if (rest.length > 1) {
        setTimeout(() => step(rest.slice(1)), CHUNK_DELAY_MS);
      }
    };
    setTimeout(() => step(chunks), CHUNK_DELAY_MS);
  },

  syncBadge(counts) {
    store.patch({ badges: loadView.badgePatch(counts, store.get('badges') || {}) });
  },

  syncBanner(counts) {
    if (this._ack === null) {
      this._ack = counts.submitted;
    }
    this.setData({ banner: loadView.bannerOf(counts, this._ack) });
  },

  loadHistorySummary() {
    return orderApi.listPartner(historyView.summaryQuery(Date.now())).then((data) => {
      this.setData({ 'completed.text': historyView.collapsedState(data).text });
    }).catch(() => {});
  },

  onRefreshTap() {
    this.load({ silent: true }).then(() => {
      this.loadHistorySummary();
      this.toastMsg('已刷新');
    });
  },

  onRetryTap() {
    this.load({ silent: true }).then(() => this.loadHistorySummary());
  },

  onBannerTap() {
    this._ack = this.data.counts.submitted;
    this.setData({ banner: loadView.bannerOf(this.data.counts, this._ack) });
    this.applyFilter('submitted');
  },

  onFilterTap(event) {
    const key = event.currentTarget.dataset.filter;
    if (!key) {
      return;
    }
    if (filterView.isHistory(key)) {
      this.onCompletedToggle();
      return;
    }
    if (key !== this.data.filter) {
      this.applyFilter(key);
    }
  },

  applyFilter(key) {
    this._list = [];
    this._page1Keys = [];
    this.setData({
      filter: key,
      groups: [],
      stage: 'skeleton',
      selecting: false,
      selectedCount: 0,
      selectableCount: 0,
      selectionText: '',
      batchResult: null,
      panel: null,
      totalRows: 0,
      nextCursor: null,
      filterDesc: filterView.describe(key),
      empty: filterView.emptyOf({ filter: key, keyword: this.data.keyword })
    });
    this.load({ silent: true });
  },

  onCountTap(event) {
    const target = filterView.countTargetOf(event.currentTarget.dataset.count);
    if (!target) {
      return;
    }
    if (target.history) {
      if (!this.data.completed.expanded) {
        this.onCompletedToggle();
      }
      return;
    }
    this.applyFilter(target.filter);
  },

  onKeywordInput(event) {
    const keyword = (event.detail && event.detail.value) || '';
    this.setData({ keyword: keyword });
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this._list = [];
      this._page1Keys = [];
      this.load({ silent: true });
    }, loadView.SEARCH_DEBOUNCE_MS);
  },

  onClearKeyword() {
    if (!this.data.keyword) {
      return;
    }
    this.setData({ keyword: '' });
    this._list = [];
    this._page1Keys = [];
    this.load({ silent: true });
  },

  onToggleSelecting() {
    if (this.data.readonly) {
      this.toastMsg(actionFlow.READONLY_COPY);
      return;
    }
    const state = selectionFlow.toggle(this.data.groups);
    this.setData({
      selecting: !this.data.selecting,
      panel: null,
      batchResult: null,
      groups: state.groups,
      selectedCount: state.selectedCount,
      selectableCount: state.selectableCount,
      selectionText: state.selectionText
    });
  },

  applySelection(state) {
    this.setData({
      groups: state.groups,
      selectedCount: state.selectedCount,
      selectableCount: state.selectableCount,
      selectionText: state.selectionText
    });
  },

  onToggleRow(event) {
    if (!this.data.selecting) {
      return;
    }
    const result = selectionFlow.toggleRow(this.data.groups, event.currentTarget.dataset.orderNo);
    if (!result.ok) {
      this.toastMsg(result.message);
    }
    this.applySelection(result.state);
  },

  onSelectAll() {
    this.applySelection(selectionFlow.selectAll(this.data.groups));
  },

  onClearSelection() {
    this.applySelection(selectionFlow.clear(this.data.groups));
  },

  onSelectStation(event) {
    this.applySelection(selectionFlow.toggleStation(this.data.groups, event.currentTarget.dataset.stationId));
  },

  onRowTap(event) {
    if (!event.currentTarget.dataset.orderNo) {
      return;
    }
    if (this.data.selecting) {
      this.onToggleRow(event);
      return;
    }
    wx.navigateTo({ url: DETAIL_PAGE + event.currentTarget.dataset.orderNo });
  },


  toastMsg(title) {
    wx.showToast({ title: title, icon: 'none' });
  },

  writeHint(text) {
    return modeGuard.isTestWrite() ? text + '（将写入测试数据）' : text;
  },

  // 浮层/遮罩上的 catchtap/catchtouchmove 空处理（阻止穿透到行点击）
  noop() {}
};

Page(Object.assign(base, require('./parts/page-actions')));
