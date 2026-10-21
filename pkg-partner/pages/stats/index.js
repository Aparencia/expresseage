// pkg-partner/pages/stats/index.js · 单量统计（listPartner counts + history 分页累加；无费用口径）
const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const summary = require('./parts/summary');

const HISTORY_PAGE_LIMIT = 100;
const MAX_HISTORY_PAGES = 4;

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
    loadedCount: 0,
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

  // 历史订单按服务端 cursor 翻页（最多 MAX_HISTORY_PAGES 页，避免一次统计打满调用）
  fetchHistory() {
    const rows = [];
    let pages = 0;
    const step = (cursor) => {
      const payload = { view: 'history', limit: HISTORY_PAGE_LIMIT };
      if (cursor) {
        payload.cursor = cursor;
      }
      return orderApi.listPartner(payload).then((data) => {
        const page = (data && data.list) || [];
        page.forEach((item) => rows.push(item));
        pages += 1;
        const nextCursor = (data && data.nextCursor) || null;
        if (!nextCursor || pages >= MAX_HISTORY_PAGES) {
          return rows;
        }
        return step(nextCursor);
      });
    };
    return step(null);
  },

  load() {
    this.setData({ loading: true, error: '' });
    const now = summary.serverNow(store.get('serverTimeSkew'));
    return Promise.all([
      this.fetchHistory(),
      orderApi.listPartner({ view: 'workbench', limit: 1 })
    ])
      .then((results) => {
        const history = results[0] || [];
        const workbench = results[1] || {};
        const metrics = summary.computeStats({
          history: history,
          counts: workbench.counts,
          range: this.data.range,
          now: now
        });
        this.setData({
          metrics: metrics,
          bars: summary.buildWeekBars(history, now),
          loadedCount: history.length,
          loading: false
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '统计没加载出来，检查网络后重试' });
      });
  }
});
