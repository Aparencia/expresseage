// pkg-customer/pages/pickup-list/index.js · 顾客取件清单（独立入口，D26）
// 两个区：
//   ①「我的取件码（本机）」D57——顾客自建清单，只存这台手机（utils/storage.pickcodes 单写口），
//     零上传/零外呼（截图识别=端侧 OCR）；不强制建单/绑定，兼职与后台（含只读视角）不可见；
//   ② 本人进行中订单的「快递站点 + 取件码」（按订单分组、可复制；勾选「我已取到」只写本机）。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const configApi = require('../../../api/modules/config');
const storage = require('../../../utils/storage');
const localCodes = require('../../../utils/recognize/local-codes');
const route = require('../../../config/route');
const view = require('./parts/pickup-view');
const localView = require('./parts/local-view');
const localOcr = require('./parts/local-ocr');
const share = require('../../../utils/share/handlers');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

function emptyLocalSummary() {
  return { total: 0, checked: 0, pending: 0 };
}

Page({
  data: {
    loading: true,
    error: '',
    rows: [],
    groups: [],
    summary: { total: 0, checked: 0, needCode: 0 },
    readonly: false,
    // D57 本机取件码清单（只读自本机 storage；READONLY 会话不渲染本机区、拒绝写入）
    localRows: [],
    localSummary: emptyLocalSummary(),
    localMax: storage.LOCAL_CODE_MAX,
    localBusy: false,
    localProgress: '',
    localInputOpen: false,
    localInput: '',
    // 文案单源在 local-view（页面注入 wxml，不在 wxml 硬编码重复副本）
    localTip: localView.TIP_TEXT,
    localReadonlyHint: localView.READONLY_HINT,
    localEmptyText: localView.EMPTY_TEXT,
    localNoMatchText: localView.NO_MATCH_TEXT
  },

  onShow() {
    if (!this.guard()) return;
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this.setData({ readonly: readonly });
    this.loadLocal(readonly);
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  guard() {
    const snapshot = store.snapshot();
    if (snapshot.viewContext) {
      if (snapshot.viewContext.role !== 'CUSTOMER') {
        wx.reLaunch({ url: route.PARTNER_WORKBENCH });
        return false;
      }
      return true;
    }
    if (snapshot.activeRole !== 'CUSTOMER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
      return false;
    }
    return true;
  },

  refresh() {
    this.setData({ loading: true, error: '' });
    return this.loadAll().then((orders) => {
      this.applyOrders(orders);
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '取件清单加载失败，请重试' });
      return false;
    });
  },

  // 进行中订单（服务端 status=IN_PROGRESS 不分页桶），逐页取到没有下一页为止（上限 3 页防失控）
  async loadAll() {
    const orders = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = { status: 'IN_PROGRESS', limit: PAGE_SIZE };
      if (cursor) payload.cursor = cursor;
      const data = await orderApi.listCustomer(payload);
      const list = (data && data.list) || [];
      list.forEach(function push(order) { orders.push(order); });
      cursor = (data && data.nextCursor) || null;
      if (!cursor || list.length === 0) break;
    }
    return orders;
  },

  applyOrders(orders) {
    const checks = storage.getPickupChecks() || {};
    const rows = view.rowsOf(orders, checks);
    const groups = view.groupByOrder(rows);
    this.setData({
      loading: false,
      error: '',
      rows: rows,
      groups: groups,
      summary: view.summaryOf(rows)
    });
    return true;
  },

  // 本机勾选：只存标记，不碰订单（D26）
  writeCheck(key, checked) {
    storage.setPickupCheck(key, checked === true);
  },

  onToggleCheck(event) {
    const key = String(event.currentTarget.dataset.key || '');
    const row = (this.data.rows || []).filter(function match(item) { return item.key === key; })[0];
    if (!row) return;
    const next = !row.checked;
    this.writeCheck(key, next);
    this.applyOrdersFromRows(view.toggleRow(this.data.rows, key));
  },

  onToggleGroup(event) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '');
    const group = (this.data.groups || []).filter(function match(item) { return item.orderNo === orderNo; })[0];
    if (!group) return;
    const next = !group.allChecked;
    group.rows.forEach((row) => this.writeCheck(row.key, next));
    this.applyOrdersFromRows(view.toggleGroup(this.data.rows, orderNo, next));
  },

  applyOrdersFromRows(rows) {
    const groups = view.groupByOrder(rows);
    this.setData({ rows: rows, groups: groups, summary: view.summaryOf(rows) });
  },

  onCopyCode(event) {
    const row = this.findRow(event);
    if (!row) return;
    if (!row.hasCode) {
      wx.showToast({ title: row.codeText, icon: 'none' });
      return;
    }
    this.copyText(row.codeText, '取件码已复制');
  },

  onCopyLine(event) {
    const row = this.findRow(event);
    if (!row) return;
    this.copyText(view.copyTextOf(row), '站点与取件码已复制');
  },

  onCopyAll() {
    const text = view.copyAllTextOf(this.data.groups);
    if (!text) {
      wx.showToast({ title: '当前没有可复制的取件信息', icon: 'none' });
      return;
    }
    this.copyText(text, '取件清单已复制');
  },

  copyText(text, tip) {
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: tip || '已复制', icon: 'none' });
      }
    });
  },

  findRow(event) {
    const key = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.key) || '');
    return (this.data.rows || []).filter(function match(item) { return item.key === key; })[0] || null;
  },

  onOrderTap(event) {
    const orderNo = String(event.currentTarget.dataset.orderNo || '');
    if (!orderNo) return;
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onRetry() {
    this.refresh();
  },

  // ── D57 我的取件码（本机）：只读本机 storage，READONLY 不渲染、拒绝写 ──────────
  loadLocal(readonly) {
    if (readonly) {
      this.setData({ localRows: [], localSummary: emptyLocalSummary() });
      return;
    }
    this.applyLocalCodes(storage.loadLocalCodes());
  },

  applyLocalCodes(state) {
    const items = (state && state.items) || [];
    this.setData({
      localRows: localView.rowsOf(items),
      localSummary: localView.summaryOf(items),
      localMax: storage.LOCAL_CODE_MAX
    });
  },

  canWriteLocal() {
    if (!this.data.readonly) return true;
    wx.showToast({ title: localView.READONLY_COPY, icon: 'none' });
    return false;
  },

  // 文本 → 站点归一解析（station.matchStation 单源）→ 同语义去重；手动粘贴与截图识别共用
  parseLocal(text) {
    const stations = (configApi.getCachedPublic() || {}).stations;
    const parsed = localCodes.parseCodeText(text, { stations: stations });
    return localCodes.mergeEntries((parsed && parsed.items) || []);
  },

  addCodesFromText(text) {
    const before = ((storage.loadLocalCodes() || {}).items || []).length;
    const entries = this.parseLocal(text);
    if (entries.length === 0) {
      wx.showToast({ title: this.data.localNoMatchText, icon: 'none' });
      return false;
    }
    const result = storage.addLocalCodes(entries);
    this.applyLocalCodes(result);
    const limitHint = localView.limitHintOf(result, before, entries.length, storage.LOCAL_CODE_MAX);
    wx.showToast({ title: limitHint || localView.addedTipOf(result), icon: 'none' });
    return true;
  },

  onToggleLocalInput() {
    if (!this.canWriteLocal()) return;
    this.setData({ localInputOpen: !this.data.localInputOpen });
  },

  onLocalInput(event) {
    this.setData({ localInput: String((event.detail && event.detail.value) || '') });
  },

  onSubmitLocalInput() {
    if (!this.canWriteLocal()) return;
    const text = String(this.data.localInput || '').trim();
    if (!text) {
      wx.showToast({ title: '先把取件码粘贴进来', icon: 'none' });
      return;
    }
    if (this.addCodesFromText(text)) {
      this.setData({ localInput: '', localInputOpen: false });
    }
  },

  // 截图识别 = 端侧能力（local-ocr 零上传/零外呼）；识别文本走同一解析/去重/本机存储链路
  async onRecognizeLocal() {
    if (!this.canWriteLocal()) return;
    if (this.data.localBusy) return;
    this.setData({ localBusy: true, localProgress: localOcr.progressTextOf({ phase: 'pick' }) });
    try {
      const result = await localOcr.recognizeLocal((state) => {
        this.setData({ localProgress: localOcr.progressTextOf(state) });
      });
      if (result.canceled) return;
      if (!result.joined) {
        const copy = localOcr.failureCopyOf(result.failureCode);
        wx.showToast({ title: copy.text, icon: 'none' });
        return;
      }
      this.addCodesFromText(result.joined);
    } finally {
      this.setData({ localBusy: false, localProgress: '' });
    }
  },

  findLocal(code) {
    return (this.data.localRows || []).filter(function match(row) { return row.code === code; })[0] || null;
  },

  onToggleLocalCheck(event) {
    if (!this.canWriteLocal()) return;
    const code = String(event.currentTarget.dataset.code || '');
    const row = this.findLocal(code);
    if (!row) return;
    this.applyLocalCodes(storage.setLocalCodeChecked(code, !row.checked));
  },

  onCopyLocalCode(event) {
    const row = this.findLocal(String(event.currentTarget.dataset.code || ''));
    if (!row) return;
    this.copyText(row.code, '取件码已复制');
  },

  onDeleteLocalCode(event) {
    if (!this.canWriteLocal()) return;
    const code = String(event.currentTarget.dataset.code || '');
    if (!code) return;
    const result = storage.removeLocalCode(code);
    this.applyLocalCodes(result);
    wx.showToast({ title: result && result.ok ? '已删除这条' : '删除失败，请重试', icon: 'none' });
  },

  // 一键清空：二次确认（D57 要求）；只清本机取件码键，不影响订单与本机勾选
  onClearLocal() {
    if (!this.canWriteLocal()) return;
    const total = (this.data.localSummary || {}).total || 0;
    if (total <= 0) {
      wx.showToast({ title: '本机还没有取件码', icon: 'none' });
      return;
    }
    const page = this;
    wx.showModal({
      title: '清空本机取件码？',
      content: '会删掉这台手机上的 ' + total + ' 条取件码，删了找不回来（不影响订单）。',
      confirmText: '清空',
      cancelText: '先不清',
      success(res) {
        if (!res || !res.confirm) return;
        if (!storage.clearLocalCodes()) {
          wx.showToast({ title: '清空失败，请重试', icon: 'none' });
          return;
        }
        page.applyLocalCodes({ items: [] });
        wx.showToast({ title: '已清空本机取件码', icon: 'none' });
      }
    });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
