// pkg-partner/pages/stats/index.js · 单量统计（今日/本周/本月；近 7 天柱 + 今日日报；零费用口径）
// 口径：docs/ux/V4_UX_PARTNER.md §3.8（三档 tab/四格指标/自绘柱/空态）、§9（单一来源 partner.stats、
//       日报摘要可复制、页面不做历史页累加）；DATA_MODEL §7.4 partner.stats 出参（批 7 冻结）。
// D48（批 17）：新增「复制汇总」——点击时按需调一次 order.listPartner({view:'workbench',limit:1}) 取服务端
//       summary（按需生成、不在 onShow 预拉、页面不本地聚合），文案纯件单源在主包
//       pages/partner/workbench/parts/summary-copy.js（统计页与工作台共用，先例 pick-list → batch-view）。
// P1-6（修复批 T3）：summary.truncated（服务端扫描触顶、可能少报）时纯件在文案末尾注明，toast 同步提示。
// 页面只做取参/接线/setData：指标、柱、日报、汇总文案、空/错态全部在 parts/。
'use strict';

const partnerApi = require('../../../api/modules/partner');
const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const route = require('../../../config/route');
const viewModel = require('./parts/view-model');
const dailyReport = require('./parts/daily-report');
const summaryCopy = require('../../../pages/partner/workbench/parts/summary-copy');
const share = require('../../../utils/share/handlers');

Page({
  data: Object.assign(viewModel.initialView(), { report: dailyReport.emptyReport() }),

  onLoad() {
    this._rangeDto = null;
    this._todayDto = null;
    this._loadToken = 0;
    this._copying = false;
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

  // D48/D54 复制汇总（顾客群口径）：点击时按需取一次今日流水 summary（view=day，非 onShow 预拉），纯件生成文案。
  // 批 20 起口径 = 今日已送达（deliveredAt 落在今日、DELIVERED/COMPLETED、排除取消单；隐私口径同工作台纯件，
  // 不含房间号/取件码/尾号/昵称）。无今日送达不复制假文案；剪贴板失败如实提示并可重试；
  // truncated 时文案与 toast 都如实说明可能少报。
  onCopySummaryTap() {
    if (this._copying) {
      return;
    }
    this._copying = true;
    wx.showLoading({ title: '正在生成汇总', mask: true });
    orderApi.listPartner({ view: 'day', limit: 1 }).then((dto) => {
      wx.hideLoading();
      const config = store.get('config') || {};
      const copy = summaryCopy.copyOf(dto && dto.summary, { zoneLabels: config.zoneLabels });
      if (!copy.visible) {
        wx.showToast({ title: '今天还没有送达的订单', icon: 'none' });
        return;
      }
      wx.setClipboardData({
        data: copy.text,
        success: () => wx.showToast({
          title: copy.truncated ? '已复制（可能少报，文案已注明）' : '已复制，可发到顾客群',
          icon: 'none'
        }),
        fail: () => wx.showToast({ title: '复制没成功，请重试', icon: 'none' })
      });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '没连上服务器，汇总没生成，请重试', icon: 'none' });
    }).then(() => {
      this._copying = false;
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
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
