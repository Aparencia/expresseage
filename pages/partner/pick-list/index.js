// pages/partner/pick-list/index.js · 独立「取件清单」页（D46，第 32 页；批 20 扩为双阶段）
// 口径：CONTRACT §13-D46、UX_PARTNER §3.11；数据源 order.listPartner 工作台视图（现成动作、无服务端改动）：
//       阶段一「待取件」= 已接单状态 → 按取件站点 P1~P8 分组（parts/pick-view，只读清单 + 单行/整组/全部复制）；
//       阶段二「待送达」= 已取件状态 → 按苑→栋→楼层分组（parts/view-model，批量送达复用工作台纯件）。
//       两阶段分页/分片 ≤20 行；不做定时轮询，onShow/下拉/切阶段才刷新；页面只做接线/setData/事件转发。
'use strict';

const orderApi = require('../../../api/modules/order');
const client = require('../../../api/client');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const route = require('../../../config/route');
const batchView = require('../../../pages/partner/workbench/parts/batch-view');
const rowActions = require('../../../pages/partner/workbench/parts/row-actions');
const share = require('../../../utils/share/handlers');
const proofPhoto = require('../../../utils/proof-photo');
const view = require('./parts/view-model');
const pickView = require('./parts/pick-view');
const tabWiring = require('./parts/tab-wiring');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';
const ACCOUNT_SWITCH_PAGE = '/pkg-admin/pages/account-switch/index';
const READONLY_COPY = '开发者只读视角不能操作';
const EMPTY_TEXT = '当前没有待送达的已取件单。取件单会自动出现在这里，下拉或切回本页刷新。';

Page(Object.assign({
  data: Object.assign({
    stage: 'loading',
    tab: pickView.TAB_PICK,
    tabPick: pickView.TAB_PICK,
    tabDeliver: pickView.TAB_DELIVER,
    pickTabText: pickView.tabTextsOf(null).pick,
    deliverTabText: pickView.tabTextsOf(null).deliver,
    errorText: '',
    loading: false,
    loadingMore: false,
    groups: [],
    chunks: [],
    nextCursor: null,
    summary: { total: 0, buildingCount: 0, text: '' },
    pickChunks: [],
    pickNextCursor: null,
    pickSummary: { total: 0, pieceTotal: 0, stationCount: 0, text: '', loadedText: '' },
    readonly: false,
    testWrite: false,
    selecting: false,
    selectedCount: 0,
    selectionText: '',
    batchRunning: false,
    batchResult: null,
    copyLoading: false,
    emptyText: EMPTY_TEXT,
    // D103：已转出且对方已接收的单不在本清单展示，数量由服务端 handoverHidden 下发（计数不变）
    handoverHidden: 0
  }, tabWiring.TAB_DATA),

  onLoad() {
    this._orders = [];
    this._pickOrders = [];
    this._pickGroups = [];
    this._selected = {};
    this._lastBatch = null;
    // P2：卸载守卫 + 请求序号（refresh 与上拉分页共用；旧响应不追加、不 setData）
    this._unloaded = false;
    this._loadToken = 0;
    this._copying = false;
  },

  // P2：离页后不再 setData/toast/refresh 弹窗（加载/批量/复制中的迟到回调一律丢弃）
  onUnload() {
    this._unloaded = true;
    this._copying = false;
  },

  // 切页才刷新：进入/从详情返回都走 onShow 的一次加载；无定时器、不做自动轮询（D46）
  onShow() {
    this.guard();
    this.syncMode();
    // 伪 tab：选中格与角标（工作台待接单/我的消息）跟随 store；本页不自带 custom-tab-bar 实例
    this.syncTabState();
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => { if (!this._unloaded) { wx.stopPullDownRefresh(); } })
      .catch(() => { if (!this._unloaded) { wx.stopPullDownRefresh(); } });
  },

  // 好友转发：只转发中性卡片纯件（D36/D37），页面零自拼卡片
  onShareAppMessage() {
    return share.appMessage();
  },

  onReachBottom() {
    const cursor = this.data.tab === pickView.TAB_PICK ? this.data.pickNextCursor : this.data.nextCursor;
    if (this.data.copyLoading || this.data.loadingMore || !cursor) {
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
      wx.reLaunch({ url: route.workspaceHomeOf(snapshot.activeRole) });
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
    this._pickOrders = [];
    this._pickGroups = [];
    // 刷新路径清掉上次批量的失败态与复制中的临时态（P1-8/P2）
    this.setData({ batchResult: null, copyLoading: false });
    return this.load({ reset: true });
  },

  // P2：每次请求领一个序号；任何 setData/toast 落点先比对（旧分页响应不追加到新列表）
  // 双阶段共用一条加载管线：payload/落状态按当前 tab 分派（待取件 → pick-view；待送达 → view-model）
  load(options) {
    if (this._unloaded) {
      return Promise.resolve(false);
    }
    const opts = options || {};
    const more = opts.more === true;
    const token = this._loadToken + 1;
    this._loadToken = token;
    const pick = this.data.tab === pickView.TAB_PICK;
    if (more) {
      this.setData({ loadingMore: true });
    } else {
      this.setData({
        stage: 'loading',
        errorText: '',
        loading: true,
        emptyText: pick ? pickView.EMPTY_TEXT : EMPTY_TEXT
      });
    }
    const cursor = more ? (pick ? this.data.pickNextCursor : this.data.nextCursor) : null;
    return orderApi.listPartner(pick ? pickView.queryOf({ cursor: cursor }) : view.queryOf({ cursor: cursor }))
      .then((data) => (pick ? this.applyPickResult(data, more, token) : this.applyResult(data, more, token)))
      .catch((err) => this.loadError(err, more, token));
  },

  applyResult(data, more, token) {
    if (this._unloaded || token !== this._loadToken) {
      return false;
    }
    const list = data && Array.isArray(data.list) ? data.list : [];
    const nextCursor = (data && data.nextCursor) || null;
    this._orders = more ? this._orders.concat(list) : list;
    const groups = view.buildGroups(view.rowsOf(this._orders));
    const selection = view.applySelection(groups, this._selected);
    const tabTexts = pickView.tabTextsOf(data);
    const hidden = more
      ? this.data.handoverHidden
      : (data && typeof data.handoverHidden === 'number' ? data.handoverHidden : 0);
    this.setData({
      stage: selection.groups.length ? 'ready' : 'empty',
      errorText: '',
      loading: false,
      loadingMore: false,
      nextCursor: nextCursor,
      groups: selection.groups,
      chunks: view.splitChunks(selection.groups, view.CHUNK_ROWS),
      summary: view.summaryLineOf(view.summaryOf(selection.groups), nextCursor),
      selectedCount: selection.selectedCount,
      selectionText: selection.selectionText,
      pickTabText: tabTexts.pick,
      deliverTabText: tabTexts.deliver,
      handoverHidden: hidden
    });
    return true;
  },

  loadError(err, more, token) {
    if (this._unloaded || token !== this._loadToken) {
      return false;
    }
    if (err && err.code === 'VIEW_TICKET_EXPIRED') {
      wx.showModal({
        title: '切换会话已过期',
        content: '请回「切换账号」重新开启。',
        showCancel: false,
        success: () => wx.reLaunch({ url: ACCOUNT_SWITCH_PAGE })
      });
      return false;
    }
    const text = (err && err.message) || '清单没加载出来，先检查网络再重试';
    if (more) {
      this.setData({ loadingMore: false });
      this.toastMsg(text);
      return false;
    }
    this.setData({ stage: 'error', errorText: text, loading: false, loadingMore: false });
    return false;
  },

  onRetryTap() {
    this.refresh();
  },

  // 复制清单（P1-7）：先把剩余分页自动拉全再复制，避免只复制已加载页导致漏单漏栋；
  // 文案由纯件生成，只到楼栋级（D48 红线）；复制中防重入，拉取失败/卸载一律不复制
  onCopyTap() {
    if (this._copying || this._unloaded) {
      return;
    }
    const plan = view.copyPlanOf(this.data.groups, this.data.nextCursor, 0);
    if (!plan.needMore) {
      this.copyPlan(plan);
      return;
    }
    this._copying = true;
    this.setData({ copyLoading: true });
    this.loadPendingForCopy(0).then((result) => {
      this._copying = false;
      if (this._unloaded) {
        return;
      }
      this.setData({ copyLoading: false });
      if (!result.ok) {
        this.toastMsg(result.message);
        return;
      }
      this.copyPlan(view.copyPlanOf(this.data.groups, this.data.nextCursor, result.pages));
    });
  },

  // 复制前循环拉全：≤MAX_AUTO_PAGES 页、失败即中止（不复制半量清单）、离页即停
  loadPendingForCopy(pages) {
    if (this._unloaded) {
      return Promise.resolve({ ok: false, pages: pages, message: '' });
    }
    if (!this.data.nextCursor) {
      return Promise.resolve({ ok: true, pages: pages });
    }
    if (pages >= view.MAX_AUTO_PAGES) {
      return Promise.resolve({ ok: true, pages: pages });
    }
    return this.load({ more: true }).then((loaded) => {
      if (loaded === false) {
        return { ok: false, pages: pages, message: '清单没拉全，先不复制，请检查网络后重试' };
      }
      return this.loadPendingForCopy(pages + 1);
    });
  },

  copyPlan(plan) {
    if (!plan.ok) {
      this.toastMsg(plan.message);
      return;
    }
    wx.setClipboardData({
      data: plan.text,
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

  // D103：已转出单独立页（信息 + 可进详情；不在取件清单两个 tab 内）
  onHandoverTap() {
    wx.navigateTo({ url: '/pkg-partner/pages/transferred/index' });
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
    // 不在这里清 batchResult：失败重试条要跨「退出/再进入多选」保留（P1-8，刷新/成功才清）
    this.applySelectionPatch({ selecting: selecting });
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
        if (res.confirm && !this._unloaded) {
          this.deliverOne(order);
        }
      }
    });
  },

  // 批量结果落状态：失败项保留勾选（成功项取消勾选，避免重复送达）；不刷新列表，失败态可重试
  applyBatchResult(summary) {
    const failedMap = {};
    summary.failedOrderNos.forEach((orderNo) => {
      failedMap[orderNo] = true;
    });
    this._selected = failedMap;
    const state = view.applySelection(this.data.groups, this._selected);
    this.setData({
      batchRunning: false,
      batchResult: summary,
      groups: state.groups,
      chunks: view.splitChunks(state.groups, view.CHUNK_ROWS),
      selectedCount: state.selectedCount,
      selectionText: state.selectionText
    });
  },

  onBatchRetry() {
    if (this._unloaded || this.data.batchRunning) {
      return;
    }
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
    // 待取件阶段订单在 _pickOrders、待送达阶段在 _orders：两个列表都要查，
    // 否则点「已取件」会误报「订单已不在当前清单」且不写库。
    const list = view.findOrderOf([this._orders, this._pickOrders], orderNo);
    if (list) {
      return list;
    }
    return null;
  },

  toastMsg(title) {
    wx.showToast({ title: title, icon: 'none' });
  },

  writeHint(text) {
    return modeGuard.isTestWrite() ? text + '（将写入测试数据）' : text;
  }
}, require('./parts/stage-flows'), require('./parts/deliver-actions'), tabWiring));
