// pages/partner/workbench/parts/load-flow.js · 工作台加载/轮询/增量渲染接线（页面方法）
// 拆件来由：批 26-W4 要在 index.js 增加 D58 待接收转派接线，页面文件已 499/500 行 → 先把
// 「拉取 → 合并 → setData 计划 → 红点/横幅同步」整段页面方法搬到这里（行为逐字保留，仅新增
// transferPending 参与红点与待接收入口），index.js 只留生命周期与事件分发。
// 口径：UX_PARTNER §4.11（30s 轮询按 orderNo/version 合并、仅变化行补丁、counts 每轮都更新）、
//       §4.12（红点/页内新订单横幅）、§4.15（错误态带上次成功更新时间）、§5.3（{list,nextCursor,counts}）。
// 2026-11-26 迟到响应修复（真机反馈「数据显示乱跳、显示之前的数据」）：并发加载（30s 轮询 / 写后刷新 /
//   切 chip / 搜索防抖 / 触底分页 / 从详情返回）乱序返回时，旧响应会覆盖新状态。修法 = 每次加载领代次
//   （_loadToken），落地前用 loadView.isStaleRequest 比对「代次 + 筛选 + 搜索词 + 是否已离页」，旧包整包丢弃；
//   applyResult/loadError/loadMore 三条落地路径共用同一判据（零第二套口径）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const store = require('../../../../store/index');
const loadView = require('./load-view');
const groupView = require('./group-view');
const batchView = require('./batch-view');
const filterView = require('./filter-view');
const dayView = require('./day-view');

const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';
const CHUNK_DELAY_MS = 16;

module.exports = {
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

  // 请求上下文快照：代次 + 筛选 + 搜索词 + 是否已离页。落地前与发起时快照比对（loadView.isStaleRequest 单源）。
  requestContextOf() {
    return {
      unloaded: this._unloaded === true,
      token: this._loadToken || 0,
      filterKey: this.data.filter,
      keyword: this.data.keyword
    };
  },

  load(options) {
    const opts = options || {};
    // 离页后不再发请求（onUnload 置位；返回 false 不 reject，调用方 .then 里的收尾按需再判 _unloaded）
    if (this._unloaded) {
      return Promise.resolve(false);
    }
    if (!opts.poll && this.data.stage !== 'ready') {
      this.setData({ stage: 'skeleton', errorText: '' });
    }
    // 每次加载领一个代次：并发时只有最新那一次的响应能落地，旧响应整包丢弃
    const taken = this.requestContextOf();
    taken.token = taken.token + 1;
    this._loadToken = taken.token;
    const payload = loadView.queryOf({ filterKey: taken.filterKey, keyword: taken.keyword });
    return orderApi.listPartner(payload)
      .then((data) => this.applyResult(data, opts, taken))
      .catch((err) => this.loadError(err, opts, taken));
  },

  loadError(err, opts, taken) {
    if (loadView.isStaleRequest(this.requestContextOf(), taken)) {
      return false;
    }
    if (err && err.code === 'VIEW_TICKET_EXPIRED') {
      wx.showModal({
        title: '切换会话已过期',
        content: '请回「切换账号」重新开启。',
        showCancel: false,
        success: () => wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE })
      });
      return false;
    }
    // 维护闸拒读兜底（正常口径读放行，此处只保证不把 INVALID_STATE 吞成网络错误）
    const maintenanceFallback = this.maintenanceFallbackOf(err);
    if (maintenanceFallback) {
      this.setData({
        maintenance: {
          visible: true,
          title: maintenanceFallback.view.title,
          text: maintenanceFallback.view.text
        }
      });
      if (opts.poll || this.data.stage === 'ready') {
        this.setData({ syncError: maintenanceFallback.text });
        return false;
      }
      this.setData({
        stage: 'error',
        errorText: maintenanceFallback.text,
        empty: loadView.emptyOf({ filter: this.data.filter })
      });
      return false;
    }
    const text = loadView.errorTextOf(this.data.lastSuccessText);
    if (opts.poll || this.data.stage === 'ready') {
      this.setData({ syncError: text });
      return false;
    }
    this.setData({ stage: 'error', errorText: text, empty: loadView.emptyOf({ filter: this.data.filter }) });
    return false;
  },

  applyResult(data, options, taken) {
    // 旧响应（代次被更新 / 筛选或搜索词已变 / 已离页）整包丢弃：不 setData、不改红点、不弹错
    if (loadView.isStaleRequest(this.requestContextOf(), taken)) {
      return false;
    }
    const opts = options || {};
    const prev = { list: this._list, page1Keys: this._page1Keys, groups: this.data.groups, counts: this.data.counts };
    const plan = loadView.applyRefresh(prev, data, {
      filterKey: this.data.filter,
      keyword: this.data.keyword,
      selectedMap: this.data.selecting ? groupView.selectionMapOf(this.data.groups) : null,
      nowMs: Date.now()
    });
    this._list = plan.list;
    this._page1Keys = plan.page1Keys;
    // D54：今日流水（view=day）的 summary 才是「今日已送达」口径；其它 chip 的旧 D48 summary 不覆盖它
    if (this.data.filter === filterView.FILTER_ALL && data && data.summary) {
      this._summary = data.summary;
      this._summaryCounts = plan.counts;
      this._summaryDayKey = dayView.dayDateKeyOf(Date.now());
    }
    const result = loadView.resultPatch(plan, {
      filterKey: this.data.filter,
      poll: opts.poll,
      selecting: this.data.selecting,
      prevGroups: prev.groups,
      nowMs: Date.now()
    });
    this.setData(result.setData);
    // P0-5：每个结果都作废旧分片追加（旧片不得落到新结构上)；replace 结果才继续分帧追加
    const token = (this._chunkToken || 0) + 1;
    this._chunkToken = token;
    if (result.chunk) {
      this.appendChunks(result.appendPatches, token);
    }
    // D58：转派待接收数由服务端顶层 transferPending 下发（客户端不自算），只喂顶部区块；
    // 红点按冻结口径只取 counts.submitted（待接收不计入 tabBar 红点，UX §4.12）。
    this.syncBadge(plan.counts);
    this.syncBanner(plan.counts);
    this.applyTransfer(data);
    return true;
  },

  // onReachBottom 追加下一页（原 index.js 内联，2026-11-26 迁入以共用代次守卫）：刷新插队时旧页响应不得追加
  loadMore() {
    if (this._unloaded || this.data.loadingMore || !this.data.nextCursor) {
      return Promise.resolve(false);
    }
    const taken = this.requestContextOf();
    const prev = { list: this._list, page1Keys: this._page1Keys, groups: this.data.groups, counts: this.data.counts };
    const payload = loadView.queryOf({ filterKey: taken.filterKey, keyword: taken.keyword, cursor: this.data.nextCursor });
    this.setData({ loadingMore: true });
    return orderApi.listPartner(payload).then((data) => {
      if (this.applyAppendResult(data, prev, taken)) {
        return true;
      }
      return false;
    }).catch((err) => {
      if (loadView.isStaleRequest(this.requestContextOf(), taken)) {
        if (!this._unloaded) {
          this.setData({ loadingMore: false });
        }
        return false;
      }
      this.setData({ loadingMore: false });
      this.toastMsg((err && err.message) || '下一批订单没加载出来，检查网络后重试');
      return false;
    });
  },

  // 下一页响应落地（与 loadMore 拆开守单函数 ≤50 行）：迟到响应只复位 loadingMore，不追加旧行
  applyAppendResult(data, prev, taken) {
    if (loadView.isStaleRequest(this.requestContextOf(), taken)) {
      if (!this._unloaded) {
        this.setData({ loadingMore: false });
      }
      return false;
    }
    const plan = loadView.applyAppend(prev, data, {
      filterKey: taken.filterKey,
      keyword: taken.keyword,
      selectedMap: this.data.selecting ? groupView.selectionMapOf(this.data.groups) : null,
      nowMs: Date.now()
    });
    this._list = plan.list;
    // D54：分页追加同样只在今日流水（view=day）刷新「今日已送达」summary；其它 chip 不覆盖旧值
    if (taken.filterKey === filterView.FILTER_ALL && data && data.summary) {
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
    return true;
  },

  // P0-5：分片追加只发新片 `groups[n]` 路径补丁，不 concat 重发已渲染组
  appendChunks(patches, token) {
    if (!patches || !patches.length) {
      return;
    }
    const step = (rest) => {
      if (this._chunkToken !== token || !rest.length) {
        return;
      }
      this.setData(rest[0]);
      if (rest.length > 1) {
        setTimeout(() => step(rest.slice(1)), CHUNK_DELAY_MS);
      }
    };
    setTimeout(() => step(patches), CHUNK_DELAY_MS);
  },

  // P0-6：先判等再 store.patch（轮询无变化时零通知，隐藏页/其他订阅者不再重算）
  // 冻结口径（UX §4.12）：红点 = counts.submitted（待接单数）；待接收转派数只在顶部区块标题角标，不进红点
  syncBadge(counts) {
    const current = store.get('badges') || {};
    const next = loadView.badgePatch(counts, current);
    if (next.workbenchPending === current.workbenchPending && next.messages === current.messages) return;
    store.patch({ badges: next });
  },

  syncBanner(counts) {
    if (this._ack === null) {
      this._ack = counts.submitted;
    }
    this.setData({ banner: loadView.bannerOf(counts, this._ack) });
  }
};
