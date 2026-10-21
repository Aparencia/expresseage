// pkg-partner/pages/stats/index.js · 单量统计（今日/本周/本月；近 7 天柱 + 今日日报；零费用口径）
// 口径：docs/V4_UX_PARTNER.md §3.8（三档 tab/四格指标/自绘柱/空态）、§9（单一来源 partner.stats、
//       日报摘要可复制、页面不做历史页累加）；DATA_MODEL §7.4 partner.stats 出参（批 7 冻结）。
// 页面只做取参/接线/setData：指标、柱、日报、空/错态全部在 parts/view-model.js、parts/daily-report.js。
'use strict';

const partnerApi = require('../../../api/modules/partner');
const store = require('../../../store/index');
const route = require('../../../config/route');
const viewModel = require('./parts/view-model');
const dailyReport = require('./parts/daily-report');

Page({
  data: Object.assign(viewModel.initialView(), { report: dailyReport.emptyReport() }),

  onLoad() {
    this._rangeDto = null;
    this._todayDto = null;
    this._loadToken = 0;
  },

  onShow() {
    // 每次可见都对齐服务端；今日 DTO 也重新拉取，保证日报与今日完成是同一份数据
    this._todayDto = null;
    this.load();
  },

  onPullDownRefresh() {
    this._todayDto = null;
    this.load().then((ok) => {
      wx.stopPullDownRefresh();
      if (ok) {
        wx.showToast({ title: '已刷新', icon: 'none' });
      }
    });
  },

  onRangeTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const range = viewModel.resolveRange(dataset.range);
    if (range === this.data.range) {
      return;
    }
    // 旧值保留到新值返回（防闪空），只置 loading
    this.setData({ range: range });
    this.load();
  },

  onRetryTap() {
    this.load();
  },

  onCopyReport() {
    const report = this.data.report || {};
    if (!report.text) {
      return;
    }
    wx.setClipboardData({
      data: report.text,
      success: () => wx.showToast({ title: '日报已复制', icon: 'none' })
    });
  },

  // 「今日完成」→ 工作台已完结区：工作台是 tabBar 页，switchTab 不能带参，只能 reLaunch 带 completedDate
  onTodayCompletedTap() {
    const nowMs = viewModel.serverNow(store.get('serverTimeSkew'));
    const dateKey = viewModel.todayDateKeyOf(this._todayDto, nowMs);
    const url = viewModel.jumpUrlOf(route.PARTNER_WORKBENCH, dateKey);
    if (!url) {
      return;
    }
    wx.reLaunch({ url: url });
  },

  load() {
    const token = (this._loadToken || 0) + 1;
    this._loadToken = token;
    const range = this.data.range;
    this.setData(viewModel.loadingView());
    const rangeRequest = partnerApi.stats(viewModel.queryOf(range));
    // 日报要「今天」的数据：任一区间都单独取一次今日 DTO；今日失败不阻断区间统计
    let todayRequest = null;
    if (range !== 'today') {
      todayRequest = this._todayDto
        ? Promise.resolve(null)
        : partnerApi.stats(viewModel.queryOf('today')).catch(() => null);
    }
    return Promise.all([rangeRequest, todayRequest || Promise.resolve(null)]).then((results) => {
      if (token !== this._loadToken) {
        return false;
      }
      const nowMs = viewModel.serverNow(store.get('serverTimeSkew'));
      this._rangeDto = results[0];
      if (range === 'today') {
        this._todayDto = results[0];
      } else if (results[1]) {
        this._todayDto = results[1];
      }
      this.setData(viewModel.viewOf({
        dto: this._rangeDto,
        range: range,
        nowMs: nowMs,
        lastSuccessAt: nowMs
      }));
      this.setData({ report: dailyReport.reportOf(this._todayDto, { nowMs: nowMs }) });
      return true;
    }).catch(() => {
      if (token !== this._loadToken) {
        return false;
      }
      // 有旧值：保留上次成功数据并提示「显示的是 HH:MM 的数据」；无旧值：错误态 + 重试
      this.setData(viewModel.errorViewOf({
        hasData: !!this._rangeDto,
        updatedAtText: this.data.updatedAtText
      }));
      return false;
    });
  }
});
