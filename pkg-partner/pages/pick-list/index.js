// pkg-partner/pages/pick-list/index.js · 独立「楼层配送清单」页（D46，第 32 页）
// 口径：CONTRACT §13-D46、UX_PARTNER §3.11；数据源 order.listPartner 工作台视图 + 已取件状态
//       （现成动作、无服务端改动）；按苑→栋→楼层分组、分页/分片 ≤20 行；不做定时轮询，onShow/下拉才刷新；
//       批量送达复用工作台 batch-view/row-actions 纯件（不新增 action）；页面只做取参/接线/setData/事件转发。
'use strict';

const orderApi = require('../../../api/modules/order');
const client = require('../../../api/client');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const route = require('../../../config/route');
const batchView = require('../../../pages/partner/workbench/parts/batch-view');
const rowActions = require('../../../pages/partner/workbench/parts/row-actions');
const share = require('../../../utils/share/handlers');
const view = require('./parts/view-model');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';
const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';
const READONLY_COPY = '开发者只读视角不能操作';
const EMPTY_TEXT = '当前没有待送达的已取件单。取件单会自动出现在这里，下拉或切回本页刷新。';

Page({
  data: {
    stage: 'loading',
    errorText: '',
    loading: false,
    loadingMore: false,
    groups: [],
    chunks: [],
    nextCursor: null,
    summary: { total: 0, buildingCount: 0, text: '' },
    readonly: false,
    testWrite: false,
    selecting: false,
    selectedCount: 0,
    selectionText: '',
    batchRunning: false,
    batchResult: null,
    emptyText: EMPTY_TEXT
  },

  onLoad() {
    this._orders = [];
    this._selected = {};
    this._lastBatch = null;
  },

  // 切页才刷新：进入/从详情返回都走 onShow 的一次加载；无定时器、不做自动轮询（D46）
  onShow() {
    this.guard();
    this.syncMode();
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); })
      .catch(function failed() { wx.stopPullDownRefresh(); });
  },

  // 好友转发：只转发中性卡片纯件（D36/D37），页面零自拼卡片
  onShareAppMessage() {
    return share.appMessage();
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.nextCursor) {
      return;
    }
    this.load({ more: true });
  },

  // 身份闸（与消息中心同口径）：切换会话按目标角色、普通登录按 activeRole；不匹配回各自首页
  guard() {
    const snapshot = store.snapshot();
    const session = snapshot.viewContext;
    if (session && session.role) {
      if (session.role !== 'PARTNER') {
        wx.reLaunch({ url: route.CUSTOMER_HOME });
      }
      return;
    }
    if (snapshot.activeRole !== 'PARTNER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
    }
  },

  syncMode() {
    this.setData({
      readonly: !modeGuard.canRenderWriteButton(),
      testWrite: modeGuard.isTestWrite()
    });
    if (this.data.readonly && this.data.selecting) {
      this.onClearSelection();
      this.setData({ selecting: false });
    }
  },

  refresh() {
    this._selected = {};
    this._lastBatch = null;
    this._orders = [];
    return this.load({ reset: true });
  },

  load(options) {
    const opts = options || {};
    const more = opts.more === true;
    if (more) {
      this.setData({ loadingMore: true });
    } else {
      this.setData({ stage: 'loading', errorText: '', loading: true });
    }
    return orderApi.listPartner(view.queryOf({ cursor: more ? this.data.nextCursor : null }))
      .then((data) => this.applyResult(data, more))
      .catch((err) => this.loadError(err, more));
  },

  applyResult(data, more) {
    const list = data && Array.isArray(data.list) ? data.list : [];
    this._orders = more ? this._orders.concat(list) : list;
    const groups = view.buildGroups(view.rowsOf(this._orders));
    const selection = view.applySelection(groups, this._selected);
    this.setData({
      stage: selection.groups.length ? 'ready' : 'empty',
      errorText: '',
      loading: false,
      loadingMore: false,
      nextCursor: (data && data.nextCursor) || null,
      groups: selection.groups,
      chunks: view.splitChunks(selection.groups, view.CHUNK_ROWS),
      summary: view.summaryOf(selection.groups),
      selectedCount: selection.selectedCount,
      selectionText: selection.selectionText
    });
  },

  loadError(err, more) {
    if (err && err.code === 'VIEW_TICKET_EXPIRED') {
      wx.showModal({
        title: '切换会话已过期',
        content: '请回「切换账号」重新开启。',
        showCancel: false,
        success: () => wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE })
      });
      return;
    }
    const text = (err && err.message) || '清单没加载出来，先检查网络再重试';
    if (more) {
      this.setData({ loadingMore: false });
      this.toastMsg(text);
      return;
    }
    this.setData({ stage: 'error', errorText: text, loading: false, loadingMore: false });
  },

  onRetryTap() {
    this.refresh();
  },

  // 复制清单：文案由纯件生成，只到楼栋级（D48 红线）；空清单不复制
  onCopyTap() {
    const text = view.copyText(this.data.groups);
    if (!text) {
      this.toastMsg('当前没有可复制的清单');
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => this.toastMsg('已复制（只到苑/栋级）'),
      fail: () => this.toastMsg('复制失败，请重试')
    });
  },

  onRowTap(event) {
    if (this.data.selecting) {
      this.onToggleRow(event);
      return;
    }
    const orderNo = event.currentTarget.dataset.orderNo;
    if (orderNo) {
      wx.navigateTo({ url: DETAIL_PAGE + orderNo });
    }
  },

  onToggleSelecting() {
    if (this.data.readonly) {
      this.toastMsg(READONLY_COPY);
      return;
    }
    const selecting = !this.data.selecting;
    if (!selecting) {
      this._selected = {};
    }
    this.applySelectionPatch({ selecting: selecting, batchResult: null });
  },

  onToggleRow(event) {
    if (!this.data.selecting) {
      return;
    }
    const orderNo = event.currentTarget.dataset.orderNo;
    this._selected = view.toggleSelection(this._selected, orderNo);
    this.applySelectionPatch({});
  },

  onSelectAll() {
    this._selected = view.selectAll(this.data.groups);
    this.applySelectionPatch({});
  },

  onClearSelection() {
    this._selected = {};
    this.applySelectionPatch({});
  },

  applySelectionPatch(patch) {
    const state = view.applySelection(this.data.groups, this._selected);
    this.setData(Object.assign({
      groups: state.groups,
      chunks: view.splitChunks(state.groups, view.CHUNK_ROWS),
      selectedCount: state.selectedCount,
      selectionText: state.selectionText
    }, patch || {}));
  },

  // 行内「已送达」：复用工作台行请求构造（expectedVersion 乐观锁），失败如实提示并刷新
  onRowDeliver(event) {
    if (this.data.readonly) {
      this.toastMsg(READONLY_COPY);
      return;
    }
    const order = this.orderOf(event.currentTarget.dataset.orderNo);
    if (!order) {
      return;
    }
    wx.showModal({
      title: '标记送达',
      content: this.writeHint('确认这单已送达？顾客端会看到进度更新。'),
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          this.deliverOne(order);
        }
      }
    });
  },

  deliverOne(order) {
    const write = rowActions.buildWrite('deliver', order, {}, '');
    return orderApi[write.method](write.payload, write.opts).then(() => {
      this.toastMsg('已标记送达');
      this.refresh();
    }).catch((err) => {
      this.toastMsg((err && err.message) || '标记失败，请刷新后重试');
      this.refresh();
    });
  },

  // 批量送达：范围=当前已加载清单的勾选行；复用 batch-view 的计划/逐单执行/失败汇总（同一 batchActionId）
  onBatchDeliver() {
    if (this.data.batchRunning || this.data.readonly) {
      if (this.data.readonly) {
        this.toastMsg(READONLY_COPY);
      }
      return;
    }
    const orders = view.selectedRows(this.data.groups)
      .map((row) => this.orderOf(row.orderNo))
      .filter((order) => !!order);
    const plan = batchView.plan('deliver', orders);
    if (!plan.ok) {
      this.toastMsg(plan.message);
      return;
    }
    wx.showModal({
      title: '批量送达',
      content: this.writeHint(plan.confirmText),
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          this.runBatch(plan);
        }
      }
    });
  },

  runBatch(plan) {
    const running = Object.assign({}, plan, { batchActionId: client.createRequestId() });
    this._lastBatch = running;
    this.setData({ batchRunning: true });
    return batchView.run(running, (row, batchActionId) => {
      const write = rowActions.buildWrite('deliver', view.writeRowOf(row), {}, batchActionId);
      return orderApi[write.method](write.payload, write.opts);
    }).then((result) => {
      const summary = batchView.summary(running, result.results);
      this.setData({ batchRunning: false, batchResult: summary });
      const content = this.writeHint(summary.text);
      wx.showModal({
        title: summary.allOk ? '批量送达完成' : '批量送达有失败',
        content: content,
        showCancel: !summary.allOk,
        confirmText: summary.allOk ? '知道了' : '重试失败单',
        cancelText: '稍后处理',
        success: (res) => {
          if (res.confirm && !summary.allOk) {
            this.onBatchRetry();
            return;
          }
          this.refresh();
        }
      });
    }).catch((err) => {
      this.setData({ batchRunning: false });
      this.toastMsg((err && err.message) || '批量送达没完成，请刷新后重试');
      this.refresh();
    });
  },

  onBatchRetry() {
    const last = this._lastBatch;
    const result = this.data.batchResult;
    if (!last || !result || !result.failedOrderNos.length) {
      this.toastMsg('没有可重试的单，刷新后再看');
      return;
    }
    const retry = batchView.retryPlan(last, result.failedOrderNos, result.failedPieceKeys || []);
    if (!retry.queue.length) {
      this.toastMsg('失败的单已不在当前列表，刷新后再试');
      return;
    }
    this.runBatch(retry);
  },

  orderOf(orderNo) {
    const list = this._orders;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].orderNo === orderNo) {
        return list[i];
      }
    }
    return null;
  },

  toastMsg(title) {
    wx.showToast({ title: title, icon: 'none' });
  },

  writeHint(text) {
    return modeGuard.isTestWrite() ? text + '（将写入测试数据）' : text;
  }
});
