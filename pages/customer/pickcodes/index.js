// pages/customer/pickcodes/index.js · 顾客「取件码」（D64 一级入口 = 伪 tab）
// D64：由 pkg-customer/pages/pickup-list 迁入主包并改名；**只显示顾客自建「我的取件码（本机）」**（D57）：
//   写入：手动粘贴 / 端侧识别截图 / 「我已取到」本机标记；删除：单条 / 一键清空（二次确认）；另可复制。
//   不显示订单（D26 订单区已删；订单详情仍逐件显示站点+取件码）；本页不提供分享/转发。
// 底部 4 格由共用视觉组件 components/tab-bar-view 页面内自绘（真 tab 走 wx.switchTab）。
// 本机边界（D57）：只存这台手机（utils/storage 单写口）、零上传/零外呼；READONLY 只渲染说明卡且拒写。
'use strict';

const store = require('../../../store/index');
const configApi = require('../../../api/modules/config');
const storage = require('../../../utils/storage');
const localCodes = require('../../../utils/recognize/local-codes');
const route = require('../../../config/route');
const localView = require('./parts/local-view');
const localOcr = require('./parts/local-ocr');
const tabsData = require('../../../components/tab-bar-view/tabs');

// D64：顾客 4 格中「取件码」为第 3 格（0 首页 / 1 订单 / 2 取件码 / 3 我的）
const TAB_INDEX = 2;

function emptyLocalSummary() {
  return { total: 0, checked: 0, pending: 0 };
}

Page({
  data: {
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
    localNoMatchText: localView.NO_MATCH_TEXT,
    // D64 伪 tab：自绘底部栏 4 格（数据单源 components/tab-bar-view/tabs.js）
    tabs: tabsData.CUSTOMER_TABS,
    tabSelected: TAB_INDEX,
    badges: {}
  },

  onShow() {
    if (!this.guard()) return;
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this.setData({ readonly: readonly, badges: snapshot.badges || {} });
    this.loadLocal(readonly);
  },

  // 本机数据即显：下拉刷新只重读本机清单（无网络请求，页面零订单区）
  onPullDownRefresh() {
    this.loadLocal(this.data.readonly === true);
    wx.stopPullDownRefresh();
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

  // ── D64 伪 tab 底部栏：点真 tab 页走 switchTab；点当前格无动作 ──────────────────
  onTabTap(event) {
    const detail = (event && event.detail) || {};
    const tab = detail.tab || (this.data.tabs || [])[detail.index] || null;
    if (!tab || !tab.pagePath || tab.pagePath === 'pages/customer/pickcodes/index') return;
    wx.switchTab({ url: '/' + tab.pagePath });
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

  copyText(text, tip) {
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: tip || '已复制', icon: 'none' });
      }
    });
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
  }
});
