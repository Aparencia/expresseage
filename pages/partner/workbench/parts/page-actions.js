// pages/partner/workbench/parts/page-actions.js · 工作台 Page 方法（动作/浮层/批量/撤销/引导/已完结）
// 与 index.js 的 base 合并为 Page 配置（Object.assign）；职责边界：本文件只管"点下去发生什么"，
// 判据在 row-actions/batch-view/undo-view/action-flow，渲染数据在 load-view/group-view。
'use strict';

const orderApi = require('../../../../api/modules/order');
const client = require('../../../../api/client');
const store = require('../../../../store/index');
const storage = require('../../../../utils/storage');
const maintenance = require('../../../../utils/maintenance');
const rowActions = require('./row-actions');
const filterView = require('./filter-view');
const batchView = require('./batch-view');
const actionFlow = require('./action-flow');
const undoView = require('./undo-view');
const historyView = require('./history-view');
const dayView = require('./day-view');
const guideView = require('./guide-view');
const summaryCopy = require('./summary-copy');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';
const CREATE_ON_BEHALF_PAGE = '/pkg-partner/pages/create-on-behalf/index';

module.exports = {
  onNeedCodeTap(event) {
    this.dispatch(actionFlow.needCodeIntent(event.currentTarget.dataset.orderNo, this.data.groups, this.data.readonly));
  },

  onRowAction(event) {
    this.dispatch(actionFlow.rowActionIntent(
      event.currentTarget.dataset.key,
      event.currentTarget.dataset.orderNo,
      this.data.groups,
      this.data.readonly
    ));
  },

  dispatch(intent) {
    const current = intent || {};
    if (current.kind === 'navigate') {
      wx.navigateTo({ url: DETAIL_PAGE + current.orderNo });
      return;
    }
    if (current.kind === 'toast') {
      this.toastMsg(current.message);
      return;
    }
    if (current.kind === 'panel') {
      this.setData({ panel: current.panel });
      return;
    }
    if (current.kind === 'confirm') {
      wx.showModal({
        title: current.title,
        content: this.writeHint(current.content || ('确认' + current.title + '？')),
        confirmText: '确认',
        success: (res) => {
          if (res.confirm) {
            this.executeSingle(current.key, current.row, {});
          }
        }
      });
    }
  },

  onPanelPick(event) {
    this.setData({ 'panel.selected': event.currentTarget.dataset.code || '' });
  },

  // v1.0 逐件补码：面板内切件（只重算件相关字段，不改订单/动作）
  onPanelPiece(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.panel || this.data.panel.type !== 'code') {
      return;
    }
    this.setData({ panel: rowActions.switchCodePanel(this.data.panel, isFinite(index) ? index : 0) });
  },

  onPanelInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field) {
      const patch = {};
      patch['panel.' + field] = (event.detail && event.detail.value) || '';
      this.setData(patch);
    }
  },

  onPanelQuickTag(event) {
    this.setData({ 'panel.note': event.currentTarget.dataset.tag || '' });
  },

  onPanelClose() {
    this.setData({ panel: null });
  },

  onPanelSubmit() {
    const intent = actionFlow.panelSubmitIntent(this.data.panel, this.data.groups);
    if (intent.kind === 'error') {
      this.setData({ 'panel.error': intent.message });
      return;
    }
    if (intent.kind === 'toast') {
      this.setData({ panel: null });
      this.toastMsg(intent.message);
      return;
    }
    if (intent.kind === 'batchStationConfirm') {
      wx.showModal({
        title: '批量改站点',
        content: this.writeHint(intent.content),
        confirmText: '确认',
        success: (res) => {
          if (res.confirm) {
            this.setData({ panel: null });
            this.runBatch(intent.plan, intent.values);
          }
        }
      });
      return;
    }
    if (intent.kind === 'write') {
      this.executeSingle(intent.key, intent.row, intent.values);
    }
  },

  executeSingle(key, row, values) {
    const write = rowActions.buildWrite(key, row, values, '');
    if (!write.method) {
      return;
    }
    this.setData({ 'panel.error': '' });
    orderApi[write.method](write.payload, write.opts)
      .then(() => this.afterWrite(key, row, values))
      .catch((err) => this.onWriteFail(err));
  },

  onWriteFail(err) {
    // 维护模式（UX_DEVELOPER §7.5）：写接口被拒时用统一维护文案，不吞错；同时让遮罩上屏
    const maintenanceText = maintenance.writeRejectedTextOf(err);
    if (maintenanceText) {
      this.syncMaintenance();
    }
    const message = maintenanceText || rowActions.inlineError(err);
    if (this.data.panel) {
      this.setData({ 'panel.error': message });
    } else {
      this.toastMsg(message);
    }
    this.load({ poll: true });
  },

  afterWrite(key, row, values) {
    this.setData({ panel: null });
    this.load({ poll: true }).then(() => {
      const intent = actionFlow.afterWriteIntent(key, this.data.groups, row, values || {});
      this.toastMsg(intent.toastText);
      if (intent.panel) {
        this.setData({ panel: intent.panel });
      }
    });
  },

  onBatchTap(event) {
    if (this.data.batchRunning) {
      return;
    }
    // TD-083：批量确认文案里的日结批自动完成时刻取自公开配置（缺/未拉到配置时纯件回退出厂默认）
    const config = store.get('config');
    const intent = actionFlow.batchTapIntent(
      event.currentTarget.dataset.key, this.data.groups, this.data.readonly, config);
    if (intent.kind === 'toast') {
      this.toastMsg(intent.message);
      return;
    }
    if (intent.kind === 'panel') {
      this.setData({ panel: intent.panel });
      return;
    }
    if (intent.kind === 'confirm') {
      wx.showModal({
        title: intent.title,
        content: this.writeHint(intent.content),
        confirmText: '确认',
        success: (res) => {
          if (res.confirm) {
            this.runBatch(intent.plan, {});
          }
        }
      });
    }
  },

  runBatch(plan, values) {
    const running = Object.assign({}, plan, { batchActionId: plan.batch ? client.createRequestId() : '' });
    this._lastBatch = { plan: running, values: values || {} };
    this.setData({ batchRunning: true });
    // v1.0：改站点/改码逐单逐件循环（同一 batchActionId，结果按件汇总）；其余动作仍逐单循环
    const runner = running.key === 'correct' ? batchView.runCorrect : batchView.run;
    runner(running, (row, batchActionId, itemIndex) => {
      const rowValues = running.key === 'correct'
        ? { patch: (this._lastBatch.values || {}).patch || {}, itemIndex: itemIndex }
        : this._lastBatch.values;
      const write = rowActions.buildWrite(running.key, row, rowValues, batchActionId);
      return orderApi[write.method](write.payload, write.opts);
    }).then((result) => {
      const intent = actionFlow.finishBatchIntent(running, this._lastBatch.values, result.results,
        this.data.groups, this.data.readonly);
      this.setData(intent.patch);
      if (intent.undo) {
        this.startUndo(intent.undo.actionKey, intent.undo.orderNos, intent.undo.batchActionId);
      }
      wx.showModal({
        title: intent.modal.title,
        content: this.writeHint(intent.modal.content),
        showCancel: intent.modal.showCancel,
        confirmText: intent.modal.confirmText || '知道了',
        cancelText: intent.modal.cancelText || '稍后处理',
        success: (res) => {
          if (res.confirm && !intent.summary.allOk) {
            this.onBatchRetry();
          } else {
            this.load({ poll: true });
          }
        }
      });
    });
  },

  onBatchRetry() {
    const last = this._lastBatch;
    const result = this.data.batchResult;
    if (!last || !result || !result.failedOrderNos.length) {
      return;
    }
    const retry = batchView.retryPlan(last.plan, result.failedOrderNos, result.failedPieceKeys || []);
    if (!retry.queue.length) {
      this.toastMsg('失败的单已不在当前列表，刷新后再试');
      return;
    }
    this.runBatch(retry, last.values);
  },

  startUndo(actionKey, orderNos, batchActionId) {
    const state = actionFlow.undoStateOf(actionKey, orderNos, batchActionId, this.data.readonly);
    if (!state) {
      return;
    }
    this.clearUndoTimer();
    this.setData({ undo: state });
    this.undoTimer = setInterval(() => {
      const next = undoView.tick(this.data.undo);
      if (!next.visible) {
        this.clearUndoTimer();
      }
      this.setData({ undo: next });
    }, 1000);
  },

  onUndoTap() {
    const state = this.data.undo;
    if (!state.visible || this.data.readonly) {
      if (this.data.readonly) {
        this.toastMsg(actionFlow.READONLY_COPY);
      }
      return;
    }
    this.clearUndoTimer();
    this.setData({ undo: actionFlow.closedUndo() });
    undoView.run(state.orderNos, state.batchActionId, (orderNo, batchActionId) => orderApi.undo({
      orderNo: orderNo,
      batchActionId: batchActionId
    })).then((result) => {
      this.toastMsg(this.writeHint(undoView.summary(result.results, state.actionKey).text));
      this.load({ poll: true });
    });
  },

  clearUndoTimer() {
    if (this.undoTimer) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
  },

  loadGuide() {
    if (storage.isGuideSeen(guideView.GUIDE_KEY)) {
      return;
    }
    this.setData({ guide: guideView.stateOf(0) });
  },

  onGuideNext() {
    const next = guideView.next(this.data.guide);
    if (next) {
      this.setData({ guide: next });
      return;
    }
    this.finishGuide();
  },

  onGuideSkip() {
    this.finishGuide();
  },

  finishGuide() {
    storage.markGuideSeen(guideView.GUIDE_KEY);
    this.setData({ guide: guideView.closedState() });
  },

  onReplayGuide() {
    storage.clearGuideSeen(guideView.GUIDE_KEY);
    this.setData({ guide: guideView.stateOf(0) });
  },

  onEmptyCreate() {
    wx.navigateTo({ url: CREATE_ON_BEHALF_PAGE });
  },

  // P0-2/TD-073：历史摘要（已完结折叠入口文案）按调用计划去重——同筛选/同 counts 版本/无脏/无在途
  // 一律 0 次 request；显式刷新（下拉/刷新/重试）由页面置 _historyDirty 后才重拉。请求在途时合并。
  loadHistorySummary() {
    const filter = this.data.filter;
    const countsVersion = historyView.countsFingerprintOf(this.data.counts);
    const plan = historyView.summaryCallPlan({
      pending: this._historyPending === true,
      dirty: this._historyDirty === true,
      hasSummary: this._historyFilter !== undefined,
      filter: filter,
      lastFilter: this._historyFilter,
      countsVersion: countsVersion,
      lastCountsVersion: this._historyCountsVersion
    });
    if (!plan.call) {
      return Promise.resolve();
    }
    this._historyDirty = false;
    this._historyPending = true;
    return orderApi.listPartner(historyView.summaryQuery(Date.now())).then((data) => {
      this._historyPending = false;
      this._historyFilter = filter;
      this._historyCountsVersion = countsVersion;
      this.setData({ 'completed.text': historyView.collapsedState(data).text });
    }).catch(() => {
      this._historyPending = false;
    });
  },

  onCompletedToggle() {
    const current = this.data.completed;
    if (current.loading) {
      return;
    }
    if (current.expanded) {
      this.setData({ 'completed.expanded': false });
      return;
    }
    this.setData({ 'completed.loading': true, 'completed.expanded': true });
    orderApi.listPartner(historyView.expandQuery(Date.now())).then((data) => {
      this._historyRows = Array.isArray(data.list) ? data.list : [];
      // P1-4：展开成功即 hasMore=true（更早未知）；窗口内有下一页就先窗口续页，耗尽后由 onHistoryMore 转 older
      this._historyPaging = historyView.openedPaging(data);
      this.setData({ completed: Object.assign({}, this.data.completed,
        actionFlow.historyStateOf(this._historyRows, this._historyPaging, false, Date.now())) });
    }).catch((err) => {
      this.setData({ 'completed.loading': false, 'completed.expanded': false });
      this.toastMsg((err && err.message) || '历史订单没加载出来，检查网络后重试');
    });
  },

  // 批 20（D53）：已完结只放昨日及更早——单窗口游标翻页（服务端 to=今日0点-1；「更早」由同一游标继续）
  onHistoryMore() {
    const current = this.data.completed;
    const paging = this._historyPaging || historyView.pagingState();
    if (current.loading || !paging.hasMore) {
      return;
    }
    const plan = historyView.moreQueryOf(Date.now(), paging);
    this.setData({ 'completed.loading': true });
    orderApi.listPartner(plan.query).then((data) => {
      const applied = historyView.moreResultOf(paging, data);
      this._historyPaging = applied.paging;
      this._historyRows = historyView.mergeOlderRows(this._historyRows, applied.rows);
      this.setData({ completed: Object.assign({}, this.data.completed,
        actionFlow.historyStateOf(this._historyRows, applied.paging, false, Date.now())) });
      if (applied.notice === 'earliest') {
        this.toastMsg('已到最早的订单');
      }
    }).catch((err) => {
      this.setData({ 'completed.loading': false });
      this.toastMsg((err && err.message) || '更早的订单没加载出来，检查网络后重试');
    });
  },

  // D54/P1-5：复制汇总改「今日已送达」口径——优先复用页面 load 保存的 summary（点击零请求）；
  // 仅当今日 summary 缺失或 counts 版本已变（用户长时间停在其它 chip）才补拉一次 view=day 再复制。
  onCopySummaryTap() {
    if (this._copying) {
      return;
    }
    this._copying = true;
    this.ensureCopySummary().then((summary) => {
      const config = store.get('config') || {};
      const copy = summaryCopy.copyOf(summary, { zoneLabels: config.zoneLabels });
      if (!copy.visible) {
        this._copying = false;
        this.toastMsg('今天还没有送达的订单');
        return;
      }
      wx.setClipboardData({
        data: copy.text,
        success: () => this.toastMsg(copy.truncated ? '已复制（可能少报，文案已注明）' : '已复制，可发到顾客群'),
        fail: () => this.toastMsg('复制没成功，请重试'),
        complete: () => { this._copying = false; }
      });
    }).catch(() => {
      this._copying = false;
      this.toastMsg('汇总没加载出来，检查网络后重试');
    });
  },

  // 今日已送达 summary 新鲜度：当天 + counts 版本未变 → 直接复用（零请求）；否则补拉一次 view=day
  ensureCopySummary() {
    const version = historyView.countsFingerprintOf(this.data.counts);
    const lastVersion = historyView.countsFingerprintOf(this._summaryCounts);
    const today = dayView.dayDateKeyOf(Date.now());
    const fresh = !!this._summary && this._summary.scope === 'deliveredToday'
      && this._summaryDayKey === today && lastVersion === version;
    if (fresh) {
      return Promise.resolve(this._summary);
    }
    return orderApi.listPartner({ view: 'day', limit: 1 }).then((data) => {
      this._summary = (data && data.summary) || this._summary;
      this._summaryCounts = (data && data.counts) || this._summaryCounts;
      this._summaryDayKey = today;
      return this._summary;
    });
  },

  // 批 20（D53）：今日完成计数点击 → 切「全部」今日流水并 toast 说明（今日完成单只在「全部」）；
  // 其它计数照旧跳对应状态 chip（applyFilter 内部会重拉列表）。
  onCountTap(event) {
    const target = filterView.countTargetOf(event.currentTarget.dataset.count);
    if (!target) {
      return;
    }
    if (target.filter && target.filter !== this.data.filter) {
      this.applyFilter(target.filter);
    }
    if (target.toast) {
      this.toastMsg(target.toast);
    }
  },

  // 统计页「今日完成」带 completedDate=今天 跳入：今日完成单只在「全部」今日流水 → 切「全部」并说明
  focusTodayFlow() {
    if (this.data.filter !== filterView.FILTER_ALL) {
      this.applyFilter(filterView.FILTER_ALL);
    }
    this.toastMsg('今日完成的单都在「全部」里');
  },
};
