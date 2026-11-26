// pages/partner/workbench/parts/history-flow.js · 工作台「已完结」历史分区接线（页面方法）
// 拆件来由：2026-11-26 迟到响应守卫批给三处历史回调补离页/筛选守卫后，page-actions.js 顶到门禁 #18
// 的 500 行上限 → 把历史摘要/展开/更早三段整体搬到这里（行为逐字保留，仅补 _unloaded 守卫），
// page-actions 只留动作/面板/汇总复制等入口。
// 口径：批 20（D53）已完结只放昨日及更早；P0-2/TD-073 摘要去重；UX_PARTNER §4.13。
'use strict';

const orderApi = require('../../../../api/modules/order');
const historyView = require('./history-view');
const actionFlow = require('./action-flow');

module.exports = {
  // P0-2/TD-073：历史摘要（已完结折叠入口文案）按调用计划去重——同筛选/同 counts 版本/无脏/无在途
  // 一律 0 次 request；显式刷新（下拉/刷新/重试）由页面置 _historyDirty 后才重拉。请求在途时合并。
  loadHistorySummary() {
    if (this._unloaded) {
      return Promise.resolve();
    }
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
      // 离页 / 筛选已变：迟到的摘要不落屏（旧筛选的「已完结 N+ 单」不贴到新筛选下），下次刷新重拉
      if (this._unloaded) {
        return;
      }
      if (filter !== this.data.filter) {
        this._historyDirty = true;
        return;
      }
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
      if (this._unloaded) {
        return;
      }
      this._historyRows = Array.isArray(data.list) ? data.list : [];
      // P1-4：展开成功即 hasMore=true（更早未知）；窗口内有下一页就先窗口续页，耗尽后由 onHistoryMore 转 older
      this._historyPaging = historyView.openedPaging(data);
      this.setData({ completed: Object.assign({}, this.data.completed,
        actionFlow.historyStateOf(this._historyRows, this._historyPaging, false, Date.now())) });
    }).catch((err) => {
      if (this._unloaded) {
        return;
      }
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
      if (this._unloaded) {
        return;
      }
      const applied = historyView.moreResultOf(paging, data);
      this._historyPaging = applied.paging;
      this._historyRows = historyView.mergeOlderRows(this._historyRows, applied.rows);
      this.setData({ completed: Object.assign({}, this.data.completed,
        actionFlow.historyStateOf(this._historyRows, applied.paging, false, Date.now())) });
      if (applied.notice === 'earliest') {
        this.toastMsg('已到最早的订单');
      }
    }).catch((err) => {
      if (this._unloaded) {
        return;
      }
      this.setData({ 'completed.loading': false });
      this.toastMsg((err && err.message) || '更早的订单没加载出来，检查网络后重试');
    });
  }
};
