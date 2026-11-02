// pages/partner/workbench/parts/load-flow.js · 工作台加载/轮询/增量渲染接线（页面方法）
// 拆件来由：批 26-W4 要在 index.js 增加 D58 待接收转派接线，页面文件已 499/500 行 → 先把
// 「拉取 → 合并 → setData 计划 → 红点/横幅同步」整段页面方法搬到这里（行为逐字保留，仅新增
// transferPending 参与红点与待接收入口），index.js 只留生命周期与事件分发。
// 口径：UX_PARTNER §4.11（30s 轮询按 orderNo/version 合并、仅变化行补丁、counts 每轮都更新）、
//       §4.12（红点/页内新订单横幅）、§4.15（错误态带上次成功更新时间）、§5.3（{list,nextCursor,counts}）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const store = require('../../../../store/index');
const loadView = require('./load-view');
const groupView = require('./group-view');
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
        return;
      }
      this.setData({
        stage: 'error',
        errorText: maintenanceFallback.text,
        empty: loadView.emptyOf({ filter: this.data.filter })
      });
      return;
    }
    const text = loadView.errorTextOf(this.data.lastSuccessText);
    if (opts.poll || this.data.stage === 'ready') {
      this.setData({ syncError: text });
      return;
    }
    this.setData({ stage: 'error', errorText: text, empty: loadView.emptyOf({ filter: this.data.filter }) });
  },

  applyResult(data, options) {
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
