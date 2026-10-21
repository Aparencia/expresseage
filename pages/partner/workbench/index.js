// pages/partner/workbench/index.js · 取件清单（分组/排序由服务端返回，本页只渲染；批量=客户端循环+同一 batchActionId）
const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const client = require('../../../api/client');
const modeGuard = require('../../../api/mode-guard');
const storage = require('../../../utils/storage');
const groupView = require('./parts/group-view');

const POLL_MS = 30 * 1000;
const SEARCH_DEBOUNCE_MS = 300;
const UNDO_SECONDS = 5;
const GUIDE_KEY = 'PARTNER_WORKBENCH_V1';
const GUIDE_STEPS = [
  { title: '按站点看', text: '跑站先按站点看；点「多选」可一次标记一批已取件。' },
  { title: '先补码', text: '有「需查明」标记的件还没取件码，先补码再取。' },
  { title: '可撤销', text: '标错了别慌，5 秒内点「撤销」可以退回来。' }
];
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'submitted', label: '待接单' },
  { key: 'accepted', label: '待取件' },
  { key: 'picked', label: '已取件' },
  { key: 'delivered', label: '已送达' },
  { key: 'exception', label: '异常' }
];
const BATCH_ACTIONS = [
  { key: 'accept', label: '接单', confirmText: '顾客会看到进度到「已接单」。' },
  { key: 'pick', label: '已取件', confirmText: '顾客会看到「已取件·配送中」。', undoable: true },
  { key: 'deliver', label: '送达', confirmText: '顾客可确认；24h 未确认自动完成。', undoable: true },
  { key: 'undoPick', label: '撤销已取件', confirmText: '顾客会看到进度回退。' }
];

function nowText() {
  const date = new Date();
  const pad = (value) => (value < 10 ? '0' + value : String(value));
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

Page({
  data: {
    filters: FILTERS,
    filter: 'all',
    keyword: '',
    counts: { submitted: 0, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 0 },
    groups: [],
    totalRows: 0,
    loading: true,
    error: '',
    updatedAtText: '',
    readonly: false,
    selecting: false,
    selected: {},
    selectedCount: 0,
    batchActions: BATCH_ACTIONS,
    batchRunning: false,
    undo: { visible: false, remaining: 0, label: '', orderNos: [] },
    guide: { visible: false, step: 0, total: GUIDE_STEPS.length, title: '', text: '' }
  },

  onLoad() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.watchStore();
    this.loadGuide();
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.load();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
    this.clearUndoTimer();
  },

  onUnload() {
    this.stopPolling();
    this.clearUndoTimer();
    if (this.offStore) {
      this.offStore();
      this.offStore = null;
    }
  },

  watchStore() {
    this.offStore = store.subscribe((snapshot) => {
      const readonly = !modeGuard.canRenderWriteButton();
      if (readonly !== this.data.readonly) {
        this.setData({ readonly: readonly });
      }
    });
  },

  startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => {
      if (!this.batchRunning) {
        this.load(true);
      }
    }, POLL_MS);
  },

  stopPolling() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load(silent) {
    if (!silent) {
      this.setData({ loading: true, error: '' });
    }
    const payload = { view: 'workbench', limit: 100 };
    if (this.data.keyword) {
      payload.keyword = this.data.keyword;
    }
    return orderApi
      .listPartner(payload)
      .then((data) => {
        const groups = groupView.toGroups(data);
        const viewGroups = groupView.filterRows(groups, this.data.filter);
        let total = 0;
        viewGroups.forEach((group) => {
          total += group.rows.length;
        });
        this.setData({
          groups: viewGroups,
          counts: Object.assign({}, this.data.counts, (data && data.counts) || {}),
          totalRows: total,
          loading: false,
          updatedAtText: nowText()
        });
        this.syncSelected(viewGroups);
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '订单没加载出来，检查网络后重试' });
      });
  },

  syncSelected(groups) {
    const visible = {};
    groups.forEach((group) => {
      group.rows.forEach((row) => {
        if (this.data.selected[row.orderNo]) {
          visible[row.orderNo] = true;
        }
      });
    });
    const selectedCount = groupView.countSelected(visible);
    this.setData({ selected: visible, selectedCount: selectedCount });
  },

  onFilterTap(event) {
    const filter = event.currentTarget.dataset.filter;
    if (!filter || filter === this.data.filter) {
      return;
    }
    this.setData({ filter: filter, selecting: false, selected: {}, selectedCount: 0 });
    this.load();
  },

  onKeywordInput(event) {
    const keyword = (event.detail && event.detail.value) || '';
    this.setData({ keyword: keyword });
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  },

  onToggleSelecting() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    const next = !this.data.selecting;
    this.setData({ selecting: next, selected: {}, selectedCount: 0 });
  },

  onToggleRow(event) {
    if (!this.data.selecting) {
      return;
    }
    const orderNo = event.currentTarget.dataset.orderNo;
    if (!orderNo) {
      return;
    }
    const selected = Object.assign({}, this.data.selected);
    selected[orderNo] = !selected[orderNo];
    this.setData({ selected: selected, selectedCount: groupView.countSelected(selected) });
  },

  onSelectGroup(event) {
    const index = Number(event.currentTarget.dataset.index);
    const group = this.data.groups[index];
    if (!group) {
      return;
    }
    const selected = Object.assign({}, this.data.selected);
    let allSelected = true;
    group.rows.forEach((row) => {
      if (!selected[row.orderNo]) {
        allSelected = false;
      }
    });
    group.rows.forEach((row) => {
      selected[row.orderNo] = !allSelected;
    });
    this.setData({ selected: selected, selectedCount: groupView.countSelected(selected) });
  },

  onRowTap(event) {
    const orderNo = event.currentTarget.dataset.orderNo;
    if (!orderNo) {
      return;
    }
    if (this.data.selecting) {
      this.onToggleRow(event);
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo });
  },

  onNeedCodeTap(event) {
    const orderNo = event.currentTarget.dataset.orderNo;
    if (!orderNo) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo });
  },

  onBatchTap(event) {
    if (this.data.readonly || this.data.batchRunning) {
      return;
    }
    const key = event.currentTarget.dataset.key;
    const action = this.data.batchActions.filter((item) => item.key === key)[0];
    if (!action) {
      return;
    }
    const rows = groupView.selectedRows(this.data.groups, this.data.selected);
    if (!rows.length) {
      wx.showToast({ title: '先勾选要处理的订单', icon: 'none' });
      return;
    }
    wx.showModal({
      title: action.label,
      content: '将 ' + rows.length + ' 单标记为「' + action.label + '」。' + action.confirmText,
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          this.runBatch(action, rows);
        }
      }
    });
  },

  runBatch(action, rows) {
    this.batchRunning = true;
    this.setData({ batchRunning: true });
    const batchActionId = client.createRequestId();
    const results = [];
    const runNext = (index) => {
      if (index >= rows.length) {
        this.finishBatch(action, results);
        return;
      }
      this.callBatchAction(action.key, rows[index].orderNo, batchActionId)
        .then(() => {
          results.push({ orderNo: rows[index].orderNo, ok: true, message: '' });
          runNext(index + 1);
        })
        .catch((err) => {
          results.push({
            orderNo: rows[index].orderNo,
            ok: false,
            message: (err && err.message) || '失败'
          });
          runNext(index + 1);
        });
    };
    runNext(0);
  },

  callBatchAction(key, orderNo, batchActionId) {
    if (key === 'accept') {
      return orderApi.accept({ orderNo: orderNo });
    }
    if (key === 'pick') {
      return orderApi.markPicked({ orderNo: orderNo, batchActionId: batchActionId });
    }
    if (key === 'deliver') {
      return orderApi.markDelivered({ orderNo: orderNo, batchActionId: batchActionId });
    }
    if (key === 'undoPick') {
      return orderApi.unmarkPicked({ orderNo: orderNo, batchActionId: batchActionId });
    }
    return Promise.reject(new Error('未知动作'));
  },

  finishBatch(action, results) {
    this.batchRunning = false;
    const okRows = results.filter((item) => item.ok);
    const failRows = results.filter((item) => !item.ok);
    this.setData({ batchRunning: false, selecting: false, selected: {}, selectedCount: 0 });
    const content =
      '成功 ' + okRows.length + ' · 失败 ' + failRows.length + (failRows.length ? '（失败项已保留，可重试）' : '');
    wx.showModal({
      title: '批量结果',
      content: content,
      showCancel: false,
      success: () => {
        if (action.undoable && okRows.length) {
          this.startUndo(action.label, okRows.map((item) => item.orderNo));
        }
        this.load();
        this.flashFailures(failRows);
      }
    });
  },

  flashFailures(failRows) {
    if (!failRows.length) {
      return;
    }
    const first = failRows[0];
    wx.showToast({
      title: first.orderNo + ' ' + first.message,
      icon: 'none'
    });
  },

  startUndo(label, orderNos) {
    this.clearUndoTimer();
    this.setData({ undo: { visible: true, remaining: UNDO_SECONDS, label: label, orderNos: orderNos } });
    this.undoTimer = setInterval(() => {
      const remaining = this.data.undo.remaining - 1;
      if (remaining <= 0) {
        this.hideUndo();
        return;
      }
      this.setData({ 'undo.remaining': remaining });
    }, 1000);
  },

  hideUndo() {
    this.clearUndoTimer();
    this.setData({ undo: { visible: false, remaining: 0, label: '', orderNos: [] } });
  },

  clearUndoTimer() {
    if (this.undoTimer) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
  },

  onUndoTap() {
    if (!this.data.undo.visible || this.data.readonly) {
      return;
    }
    const orderNos = this.data.undo.orderNos.slice();
    this.hideUndo();
    const results = [];
    const runNext = (index) => {
      if (index >= orderNos.length) {
        const okCount = results.filter((item) => item.ok).length;
        const failCount = results.length - okCount;
        wx.showToast({
          title: '撤销成功 ' + okCount + (failCount ? ' · 失败 ' + failCount : ''),
          icon: 'none'
        });
        this.load();
        return;
      }
      orderApi
        .undo({ orderNo: orderNos[index] })
        .then(() => {
          results.push({ ok: true });
          runNext(index + 1);
        })
        .catch(() => {
          results.push({ ok: false });
          runNext(index + 1);
        });
    };
    runNext(0);
  },

  loadGuide() {
    const done = storage.isGuideSeen(GUIDE_KEY);
    if (done) {
      return;
    }
    this.setData({
      guide: { visible: true, step: 0, total: GUIDE_STEPS.length, title: GUIDE_STEPS[0].title, text: GUIDE_STEPS[0].text }
    });
  },

  onGuideNext() {
    const next = this.data.guide.step + 1;
    if (next >= GUIDE_STEPS.length) {
      this.finishGuide();
      return;
    }
    this.setData({ guide: { visible: true, step: next, total: GUIDE_STEPS.length, title: GUIDE_STEPS[next].title, text: GUIDE_STEPS[next].text } });
  },

  onGuideSkip() {
    this.finishGuide();
  },

  finishGuide() {
    storage.markGuideSeen(GUIDE_KEY);
    this.setData({ guide: { visible: false, step: 0, total: GUIDE_STEPS.length, title: '', text: '' } });
  },

  onRefreshTap() {
    this.load();
    wx.showToast({ title: '已刷新', icon: 'none' });
  }
});
