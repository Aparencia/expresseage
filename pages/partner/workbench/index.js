// pages/partner/workbench/index.js · 取件清单（工作台）· 页面只做取参/接线/setData，判据与流程在 parts/*
// 口径：UX_PARTNER §4（工作台专章）、§6（READONLY/TEST_WRITE）。数据源 order.listPartner；
// 行级动作只消费服务端行内 actions[]（批6-A），页面零七状态字面量、零 wx.cloud、零编号生成。
// 批 26（D58）：顶部「待接收转派」区块 + 红点复用既有 badges.workbenchPending；
// 拉取/增量渲染接线拆到 parts/load-flow，转派区块接线拆到 parts/transfer-flow（页面行数 ≤500，门禁 #18）。
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
const guideView = require('./parts/guide-view');
const dayView = require('./parts/day-view');
const transferView = require('./parts/transfer');
const share = require('../../../utils/share/handlers');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';

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
    // D58 待接收转派：count 来自服务端顶层 transferPending；rows 来自 view='transfer'（服务端过滤）
    transfer: transferView.closedState(),
    banner: { visible: false, pendingNew: 0, text: '', actionText: '去看看' },
    completed: { text: '', expanded: false, loading: false, sections: [], moreText: '', hasMore: false, nextCursor: null },
    guide: guideView.closedState(),
    empty: loadView.emptyOf({ filter: filterView.FILTER_ALL }), hasRows: false,
    maintenance: { visible: false, title: '', text: '' },
    partnerNoText: ''
  },

  onLoad(options) {
    this._list = [];
    this._page1Keys = [];
    this._historyRows = [];
    this._historyPaging = null;
    this._summary = null;
    this._summaryCounts = null;
    this._summaryDayKey = '';
    this._ack = null;
    this._chunkToken = 0;
    this._lastBatch = null;
    this._transferRows = [];
    this._transferToken = 0;
    this._maintenanceClosed = '';
    this._maintenanceView = null;
    this._configFetchedAt = 0;
    this._historyDirty = false;
    this._completedFocusDate = dayView.focusDateOf(options);
    this.syncMode();
    this.watchStore();
    this.loadGuide();
  },

  onShow() {
    this.syncTabBar();
    this.syncMode();
    this.refreshConfig();
    this.syncMaintenance();
    // onShow 也走增量：已加载过就只发变化行补丁，不整页重拉（UX §4.11）
    this.load({ poll: this.data.stage === 'ready' }).then(() => {
      this.loadHistorySummary(); this.applyCompletedFocus();
    });
    this.startPolling();
  },

  // custom-tab-bar 每页一份实例：本页 onShow 显式同步选中格（工作台=0）
  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0 });
  },

  // 统计页「今日完成」跳转：带 completedDate=今天 时落到「全部」今日流水（批 20：今日完成单只在全部）；
  // 其它日期仍复用既有 onCompletedToggle 展开已完结区。
  applyCompletedFocus() {
    const date = this._completedFocusDate;
    if (!date) {
      return;
    }
    this._completedFocusDate = '';
    if (date === dayView.dayDateKeyOf(Date.now())) {
      this.focusTodayFlow();
      return;
    }
    this.onCompletedToggle();
  },

  onHide() {
    this.stopPolling();
    this.clearUndoTimer(); this.clearSearchTimer();
    if (this.data.undo.visible) {
      this.setData({ undo: actionFlow.closedUndo() });
    }
  },

  onUnload() {
    this.stopPolling();
    this.clearUndoTimer(); this.clearSearchTimer();
    if (this.offStore) {
      this.offStore();
      this.offStore = null;
    }
  },

  onPullDownRefresh() {
    this._historyDirty = true;
    this.load({ silent: true }).then(() => { this.loadHistorySummary(); wx.stopPullDownRefresh(); })
      .catch(() => wx.stopPullDownRefresh());
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
        selectedMap: this.data.selecting ? groupView.selectionMapOf(this.data.groups) : null,
        nowMs: Date.now()
      });
      this._list = plan.list;
      // D54：分页追加同样只在今日流水（view=day）刷新「今日已送达」summary；其它 chip 不覆盖旧值
      if (this.data.filter === filterView.FILTER_ALL && data && data.summary) {
        this._summary = data.summary;
        this._summaryCounts = plan.counts;
        this._summaryDayKey = dayView.dayDateKeyOf(Date.now());
      }
      const patch = {
        groups: plan.groups,
        counts: plan.counts,
        totalRows: plan.totalRows,
        nextCursor: plan.nextCursor,
        hasRows: plan.totalRows > 0,
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

  // 好友转发：判据单源在 utils/share（兼职+非切换会话→绑定卡只带编号；其余回通用卡）
  onShareAppMessage() {
    return share.appMessage();
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
      this.syncMaintenance();
    });
  },

  // P0-11：onHide/onUnload 清理防抖定时器（切走瞬间输入不再触发卸载后请求）
  clearSearchTimer() { if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; } },

  onRefreshTap() {
    this._historyDirty = true;
    this.load({ silent: true }).then(() => { this.loadHistorySummary(); this.toastMsg('已刷新'); });
  },

  onRetryTap() {
    this._historyDirty = true;
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
      empty: loadView.emptyOf({ filter: key, keyword: this.data.keyword }),
      hasRows: false
    });
    this.load({ silent: true });
  },

  onKeywordInput(event) {
    const keyword = (event.detail && event.detail.value) || '';
    this.setData({ keyword: keyword });
    this.clearSearchTimer();
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
    } else if (result.hint) {
      this.toastMsg(result.hint);
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


  onPickListTap() {
    wx.navigateTo({ url: '/pkg-partner/pages/pick-list/index' });
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

// 维护模式挂钩以「页面方法」形态并入 base（不改 workbench 既有入口合并方式，F21 口径保持）
Object.assign(base, require('./parts/maintenance-hook'));
// 加载/轮询/增量渲染接线（批 26 拆件：原 index.js 内联方法逐字搬移）
Object.assign(base, require('./parts/load-flow'));
// D58：顶部「待接收转派」区块接线（count 取服务端 transferPending，行取 view='transfer'）
Object.assign(base, require('./parts/transfer-flow'));
// 件级取件接线（D61）：逐件「已取件/撤销已取」→ itemIndex 写请求；页面只做事件转发
Object.assign(base, require('./parts/piece-flow'));

Page(Object.assign(base, require('./parts/page-actions')));
