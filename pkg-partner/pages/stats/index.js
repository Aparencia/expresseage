// pkg-partner/pages/stats/index.js · 单量统计（今日/本周/本月完成量、状态分布、异常数；无费用口径）
const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const summary = require('./parts/summary');

const RANGES = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' }
];

Page({
  data: {
    ranges: RANGES,
    range: 'today',
    metrics: { completed: 0, running: 0, exception: 0, canceled: 0, rateText: '0%', todayCompleted: 0 },
    bars: [],
    loading: true,
    error: ''
  },

  onLoad() {
    this.load();
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onRangeTap(event) {
    const range = event.currentTarget.dataset.range;
    if (!range || range === this.data.range) {
      return;
    }
    this.setData({ range: range });
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '' });
    const now = summary.serverNow(store.get('serverTimeSkew'));
    return Promise.all([
      orderApi.listPartner({ view: 'history', limit: 50 }),
      orderApi.listPartner({ view: 'workbench', limit: 1 })
    ])
      .then((results) => {
        const history = results[0] || {};
        const workbench = results[1] || {};
        const metrics = summary.computeStats({
          history: history.list,
          counts: workbench.counts,
          range: this.data.range,
          now: now
        });
        this.setData({
          metrics: metrics,
          bars: summary.buildWeekBars(history.list, now),
          loading: false
        });
        this.setData({ 'metrics.rateText': metrics.rateText });
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '统计没加载出来，检查网络后重试' });
      });
  }
});
