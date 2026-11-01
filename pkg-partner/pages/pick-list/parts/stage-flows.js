// pkg-partner/pages/pick-list/parts/stage-flows.js · 双阶段「取件清单」页面接线（阶段切换 / 待取件加载 / 复制）
// 职责：把 WXML 的阶段 chip 与复制事件接成页面 setData + 统一复制管道；判据/文案/分组在 pick-view 纯件。
// 边界：页面方法（与 index.js 合并为 Page 配置）；不判断状态机、不直连 wx 之外的服务端动作。
'use strict';

const pickView = require('./pick-view');
const view = require('./view-model');

module.exports = {
  // ---------- 待取件：加载结果落状态（分页拼接 → 站点分组 → ≤20 行分片） ----------
  applyPickResult(data, more, token) {
    if (this._unloaded || token !== this._loadToken || this.data.tab !== pickView.TAB_PICK) {
      return false;
    }
    const list = data && Array.isArray(data.list) ? data.list : [];
    const nextCursor = (data && data.nextCursor) || null;
    this._pickOrders = more ? this._pickOrders.concat(list) : list;
    this._pickGroups = pickView.buildGroups(this._pickOrders);
    const tabTexts = pickView.tabTextsOf(data);
    this.setData({
      stage: this._pickGroups.length ? 'ready' : 'empty',
      errorText: '',
      loading: false,
      loadingMore: false,
      pickNextCursor: nextCursor,
      pickChunks: view.splitChunks(this._pickGroups, view.CHUNK_ROWS),
      pickSummary: pickView.summaryLineOf(pickView.summaryOf(this._pickGroups), nextCursor),
      pickTabText: tabTexts.pick,
      deliverTabText: tabTexts.deliver
    });
    return true;
  },

  // ---------- 阶段切换：待取件 / 待送达（同页两 chip，切换即重载当前阶段；退出多选态） ----------
  onSwitchTab(event) {
    const current = event && event.currentTarget ? event.currentTarget : {};
    const dataset = current.dataset || {};
    const tab = pickView.tabOf(String(dataset.tab || ''));
    if (!tab || tab === this.data.tab) {
      return;
    }
    this._selected = {};
    this._lastBatch = null;
    this._copying = false;
    this.setData({
      tab: tab,
      selecting: false,
      selectedCount: 0,
      selectionText: '',
      batchResult: null,
      copyLoading: false
    });
    this.refresh();
  },

  // ---------- 复制（待取件）：单行 / 整组 / 全部；全部先自动拉全剩余分页，失败不复制半量 ----------
  onCopyAllPick() {
    if (this._copying || this._unloaded || this.data.copyLoading) {
      return;
    }
    const plan = pickView.copyPlanOf(this._pickGroups, this.data.pickNextCursor, 0);
    if (!plan.needMore) {
      this.copyPickPlan(plan);
      return;
    }
    this._copying = true;
    this.setData({ copyLoading: true });
    this.pullAllForPickCopy(0).then((result) => {
      this._copying = false;
      if (this._unloaded) {
        return;
      }
      this.setData({ copyLoading: false });
      if (!result.ok) {
        this.toastMsg(result.message);
        return;
      }
      this.copyPickPlan(pickView.copyPlanOf(this._pickGroups, this.data.pickNextCursor, result.pages));
    });
  },

  pullAllForPickCopy(pages) {
    if (this._unloaded) {
      return Promise.resolve({ ok: false, pages: pages, message: '' });
    }
    if (!this.data.pickNextCursor) {
      return Promise.resolve({ ok: true, pages: pages });
    }
    if (pages >= pickView.MAX_AUTO_PAGES) {
      return Promise.resolve({ ok: true, pages: pages });
    }
    return this.load({ more: true }).then((loaded) => {
      if (loaded === false) {
        return { ok: false, pages: pages, message: '清单没拉全，先不复制，请检查网络后重试' };
      }
      return this.pullAllForPickCopy(pages + 1);
    });
  },

  copyPickPlan(plan) {
    if (!plan.ok) {
      this.toastMsg(plan.message);
      return;
    }
    wx.setClipboardData({
      data: plan.text,
      success: () => this.toastMsg('已复制取件清单'),
      fail: () => this.toastMsg('复制失败，请重试')
    });
  },

  onCopyGroupPick(event) {
    const hit = this.findPickHit(event);
    if (!hit) {
      return;
    }
    this.copyPickText(pickView.groupCopyText(hit.group), '本组取件信息已复制');
  },

  onCopyRowPick(event) {
    const hit = this.findPickHit(event);
    if (!hit) {
      return;
    }
    this.copyPickText(pickView.rowCopyText(hit.row), '这单取件信息已复制');
  },

  copyPickText(text, tip) {
    if (!text) {
      this.toastMsg('当前没有可复制的清单');
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => this.toastMsg(tip),
      fail: () => this.toastMsg('复制失败，请重试')
    });
  },

  // 行/组复制定位：WXML 传行首订单号（组头按钮取首行号），在已加载分组里找命中行与所在站组
  findPickHit(event) {
    const current = event && event.currentTarget ? event.currentTarget : {};
    const dataset = current.dataset || {};
    const orderNo = String(dataset.orderNo || '');
    const groups = Array.isArray(this._pickGroups) ? this._pickGroups : [];
    for (let g = 0; g < groups.length; g += 1) {
      const rows = groups[g].rows || [];
      for (let r = 0; r < rows.length; r += 1) {
        if (rows[r].orderNo === orderNo) {
          return { group: groups[g], row: rows[r] };
        }
      }
    }
    return null;
  }
};
