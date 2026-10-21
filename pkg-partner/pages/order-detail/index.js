// pkg-partner/pages/order-detail/index.js · 兼职订单详情（真实 DTO：order.actions 决定动作条；counterpart 只在 ACTIVE 绑定内下发）
// 契约：docs/V4_UX_PARTNER.md §3.3 / §4.4 / §4.7 / §4.13 / §4.14；docs/V4_DATA_MODEL.md §7.5（order.get/correct/undo）。
// 边界：页面零状态机判断（动作/状态/编号/凭证全部消费服务端 DTO 与 parts 纯件）；只经 api/modules 出入。
const orderApi = require('../../../api/modules/order');
const messageApi = require('../../../api/modules/message');
const modeGuard = require('../../../api/mode-guard');
const actionsPart = require('./parts/actions');
const correctPanel = require('./parts/correct-panel');
const deliveryPanel = require('./parts/delivery-panel');
const eventView = require('./parts/event-view');
const exceptionPanel = require('./parts/exception-panel');
const reasonPanel = require('./parts/reason-panel');
const undoPart = require('./parts/undo');
const viewModel = require('./parts/view-model');

const UNDO_TICK_MS = 1000;
const MESSAGE_POLL_MS = 10000;
const MESSAGE_MAX = 200;
const COPY = {
  noOrderNo: '没有订单号，请回工作台重试',
  loadFail: '订单没加载出来，检查网络后重试',
  readonly: '开发者只读视角不能操作',
  testSuffix: '（将写入测试数据）',
  copyOrder: '订单号已复制',
  copyCustomer: '顾客编号已复制',
  imageFail: '截图暂时打不开，可能已过保留期（订单完成/取消 7 天后删除）',
  submitFail: '操作没成功，请重试',
  messageEmpty: '先写点内容再发送',
  messageSent: '留言已发送',
  messageFail: '留言没发出去，请重试'
};

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + COPY.testSuffix : text;
}

Page({
  data: {
    orderNo: '',
    order: null,
    events: [],
    messages: [],
    actions: [],
    loading: true,
    error: '',
    readonly: false,
    voucher: { title: '', footer: '', rows: [] },
    correctPanel: { visible: false, fields: [], stationOptions: [], stationIndex: -1 },
    exceptionPanel: { title: '', reasons: [], noteMax: 200, placeholder: '' },
    deliveryPanel: { visible: false, guest: false, quickTags: [], confirmText: '' },
    deliveredChip: '',
    guestAutoHint: '',
    undoBar: { visible: false, kind: '', remaining: 0, label: '', undoLabel: '撤销' },
    panel: '',
    correctEditor: { stationId: '', pickupCode: '', lockerNo: '', trackingTail: '' },
    correctError: '',
    exceptionIndex: 0,
    exceptionNote: '',
    exceptionError: '',
    deliveryNote: '',
    deliveryError: '',
    cancelPanel: { title: '', reasons: [], noteMax: 100, placeholder: '', confirmText: '' },
    cancelKey: '',
    reasonIndex: 0,
    reasonNote: '',
    reasonError: '',
    messageText: '',
    sending: false
  },

  onLoad(options) {
    this.setData({ orderNo: (options && options.orderNo) || '', readonly: !modeGuard.canRenderWriteButton() });
    this.load();
  },
  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    // 回前台/返回页面时刷新一次 DTO（消息/状态可能已变；轮询期间不整页重拉）
    if (this.data.order) {
      this.load();
    }
    this.startMessagePoll();
  },
  onHide() {
    this.stopMessagePoll();
    this.clearUndoTimer();
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  onUnload() {
    this.stopMessagePoll();
    this.clearUndoTimer();
  },

  // 留言 10s 轮询（页面可见时；离页停止，不在后台空转）
  startMessagePoll() {
    if (this.messageTimer || !this.data.orderNo) {
      return;
    }
    this.messageTimer = setInterval(() => {
      if (!this.data.loading) {
        this.loadMessages();
      }
    }, MESSAGE_POLL_MS);
  },
  stopMessagePoll() {
    if (this.messageTimer) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }
  },

  // 详情拉取：order.get 的 {order, events} 一次装配成页面快照（动作/凭证/面板/撤销条都由 parts 算）
  load() {
    if (!this.data.orderNo) {
      this.setData({ loading: false, error: COPY.noOrderNo });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    return orderApi.get({ orderNo: this.data.orderNo })
      .then((data) => this.applyDetail(data))
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || COPY.loadFail });
      });
  },

  applyDetail(data) {
    const order = (data && data.order) || {};
    const events = eventView.buildEvents(data && data.events);
    const view = viewModel.buildView(order, events, { readonly: this.data.readonly, nowMs: Date.now() });
    this.setData({
      order: view.order,
      events: events,
      actions: view.actions,
      voucher: view.voucher,
      correctPanel: view.correctPanel,
      exceptionPanel: view.exceptionPanel,
      deliveryPanel: view.deliveryPanel,
      deliveredChip: view.deliveredChip,
      guestAutoHint: view.guestAutoHint,
      undoBar: view.undoBar,
      customerNoText: view.customerNoText,
      loading: false
    });
    this.syncUndoTimer();
    return this.loadMessages();
  },

  loadMessages() {
    return messageApi.list({ orderNo: this.data.orderNo })
      .then((data) => this.setData({ messages: eventView.buildMessages(data && data.list) }))
      .catch(() => this.setData({ messages: [] }));
  },

  // ---------- 撤销条（5 秒窗由服务端 actions 判定，本地只做倒计时展示） ----------
  syncUndoTimer() {
    if (!this.data.undoBar.visible) {
      this.clearUndoTimer();
      return;
    }
    if (this.undoTimer) {
      return;
    }
    this.undoTimer = setInterval(() => {
      const bar = undoPart.buildBar(this.data.order, this.data.actions, Date.now());
      this.setData({ undoBar: bar });
      if (!bar.visible) {
        this.clearUndoTimer();
      }
    }, UNDO_TICK_MS);
  },
  clearUndoTimer() {
    if (this.undoTimer) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
  },

  // ---------- 只读二道闸（前端置灰 + 点击只 toast，不发请求；服务端仍二次拒绝） ----------
  guardReadonly() {
    if (modeGuard.canRenderWriteButton()) {
      return false;
    }
    wx.showToast({ title: COPY.readonly, icon: 'none' });
    return true;
  },

  onCopyOrderNo() {
    wx.setClipboardData({
      data: this.data.orderNo,
      success: () => wx.showToast({ title: COPY.copyOrder, icon: 'none' })
    });
  },
  onCopyCustomerNo() {
    const value = (this.data.order && this.data.order.customerNoText) || '';
    if (!value) {
      return;
    }
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: COPY.copyCustomer, icon: 'none' })
    });
  },
  onViewImage() {
    orderApi.imageUrl({ orderNo: this.data.orderNo })
      .then((data) => {
        const url = data && data.url;
        if (!url) {
          throw new Error(COPY.imageFail);
        }
        wx.previewImage({ urls: [url], current: url });
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || COPY.imageFail, icon: 'none' }));
  },

  // ---------- 底部动作条：只渲染/分派服务端动作，不猜状态 ----------
  onActionTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const key = event.currentTarget.dataset.key;
    const action = actionsPart.findAction(this.data.actions, key);
    if (!action) {
      return;
    }
    if (key === 'correct') {
      this.openCorrectPanel();
      return;
    }
    if (key === 'deliver') {
      this.openDeliveryPanel();
      return;
    }
    if (key === 'exception') {
      this.openExceptionPanel();
      return;
    }
    if (key === 'message') {
      this.setData({ panel: 'message' });
      return;
    }
    if (action.panel === 'reason') {
      this.openReasonPanel(key);
      return;
    }
    this.confirmAndRun(action);
  },
  confirmAndRun(action) {
    if (!action.confirmText) {
      this.runAction(action.key);
      return;
    }
    wx.showModal({
      title: action.label,
      content: action.confirmText,
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          this.runAction(action.key);
        }
      }
    });
  },
  runAction(key) {
    const orderNo = this.data.orderNo;
    const opts = { expectedVersion: this.data.order && this.data.order.version };
    if (key === 'accept') {
      return this.submitWrite(() => orderApi.accept({ orderNo: orderNo }, opts), '已接单');
    }
    if (key === 'pick') {
      return this.submitWrite(() => orderApi.markPicked({ orderNo: orderNo }, opts), '已标记取件');
    }
    if (key === 'undoPick') {
      return this.submitWrite(() => orderApi.unmarkPicked({ orderNo: orderNo }, opts), undoPart.successText('undoPick'));
    }
    if (key === 'undoDeliver') {
      return this.submitWrite(() => orderApi.unmarkDelivered({ orderNo: orderNo }, opts), undoPart.successText('undoDeliver'));
    }
    if (key === 'resolve') {
      const submit = exceptionPanel.buildResolveSubmit(this.data.order);
      return this.submitWrite(() => orderApi.resolveException(submit.data, submit.opts),
        exceptionPanel.resolveCopy(this.data.order));
    }
    return Promise.resolve();
  },

  // 写动作统一入口：loading 防重 → 成功 toast（TEST_WRITE 带测试数据提示）→ 重拉 DTO；
  // 状态/版本冲突（INVALID_TRANSITION/CONFLICT）自动刷新，不保留旧按钮态。
  submitWrite(run, successText, panelName) {
    if (this.guardReadonly()) {
      return Promise.resolve();
    }
    this.setData({ sending: true });
    return run()
      .then(() => {
        this.setData({ sending: false, panel: panelName ? '' : this.data.panel });
        wx.showToast({ title: writeHint(successText), icon: 'none' });
        return this.load();
      })
      .catch((err) => {
        const patch = { sending: false };
        if (panelName) {
          patch[panelName + 'Error'] = (err && err.message) || COPY.submitFail;
        }
        this.setData(patch);
        if (!panelName) {
          wx.showToast({ title: (err && err.message) || COPY.submitFail, icon: 'none' });
        }
        if (err && (err.code === 'INVALID_TRANSITION' || err.code === 'CONFLICT')) {
          this.load();
        }
      });
  },

  // ---------- 补码/改站点面板 ----------
  openCorrectPanel() {
    const panel = this.data.correctPanel || {};
    if (!panel.visible) {
      wx.showToast({ title: panel.blockedCopy || '当前状态不能改取件码', icon: 'none' });
      return;
    }
    this.setData({ panel: 'correct', correctEditor: correctPanel.buildEditor(this.data.order), correctError: '' });
  },
  onCorrectInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ['correctEditor.' + field]: (event.detail && event.detail.value) || '', correctError: '' });
  },
  onStationChange(event) {
    const options = (this.data.correctPanel && this.data.correctPanel.stationOptions) || [];
    const hit = options[Number(event.detail.value)];
    if (hit) {
      this.setData({ 'correctEditor.stationId': hit.id, correctError: '' });
    }
  },
  onCorrectSave() {
    const checked = correctPanel.validateSave(this.data.correctEditor, this.data.order);
    if (!checked.ok) {
      this.setData({ correctError: checked.message });
      return;
    }
    const submit = correctPanel.buildSubmit(this.data.order, checked.patch);
    this.submitWrite(() => orderApi.correct(submit.data, submit.opts),
      correctPanel.savedCopy(this.data.correctPanel), 'correct');
  },

  // ---------- 异常上报/解除 ----------
  openExceptionPanel() {
    this.setData({ panel: 'exception', exceptionIndex: 0, exceptionNote: '', exceptionError: '' });
  },
  onExceptionReasonTap(event) {
    this.setData({ exceptionIndex: Number(event.currentTarget.dataset.index), exceptionError: '' });
  },
  onExceptionNoteInput(event) {
    this.setData({
      exceptionNote: ((event.detail && event.detail.value) || '').slice(0, exceptionPanel.NOTE_MAX),
      exceptionError: ''
    });
  },
  onExceptionSubmit() {
    const reason = (this.data.exceptionPanel.reasons || [])[this.data.exceptionIndex] || {};
    const checked = exceptionPanel.validateReport(reason.code, this.data.exceptionNote);
    if (!checked.ok) {
      this.setData({ exceptionError: checked.message });
      return;
    }
    const submit = exceptionPanel.buildReportSubmit(this.data.order, checked.payload);
    this.submitWrite(() => orderApi.reportException(submit.data, submit.opts),
      exceptionPanel.COPY.report, 'exception');
  },

  // ---------- 送达浮层（deliveryNote + guest 24h 自动完成文案） ----------
  openDeliveryPanel() {
    this.setData({ panel: 'deliver', deliveryNote: '', deliveryError: '' });
  },
  onDeliveryNoteInput(event) {
    this.setData({
      deliveryNote: ((event.detail && event.detail.value) || '').slice(0, deliveryPanel.NOTE_MAX),
      deliveryError: ''
    });
  },
  onQuickTag(event) {
    this.setData({ deliveryNote: event.currentTarget.dataset.tag || '', deliveryError: '' });
  },
  onDeliverySubmit() {
    const panel = this.data.deliveryPanel || {};
    wx.showModal({
      title: panel.title || '标记送达',
      content: panel.confirmText || '',
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const submit = deliveryPanel.buildSubmit(this.data.order, this.data.deliveryNote);
        this.submitWrite(() => orderApi.markDelivered(submit.data, submit.opts),
          deliveryPanel.COPY.success, 'delivery');
      }
    });
  },

  // ---------- 取消/拒单（原因枚举 + OTHER 必填；取消不可恢复） ----------
  openReasonPanel(key) {
    this.setData({
      panel: 'reason',
      cancelKey: key,
      reasonIndex: 0,
      reasonNote: '',
      reasonError: '',
      cancelPanel: reasonPanel.buildPanel(key)
    });
  },
  onReasonChange(event) {
    this.setData({ reasonIndex: Number(event.detail.value), reasonError: '' });
  },
  onReasonNoteInput(event) {
    this.setData({ reasonNote: ((event.detail && event.detail.value) || '').slice(0, reasonPanel.NOTE_MAX), reasonError: '' });
  },
  onReasonSubmit() {
    const reasons = (this.data.cancelPanel && this.data.cancelPanel.reasons) || [];
    const reason = reasons[this.data.reasonIndex] || {};
    const checked = reasonPanel.validate(reason.code, this.data.reasonNote);
    if (!checked.ok) {
      this.setData({ reasonError: checked.message });
      return;
    }
    const data = Object.assign({ orderNo: this.data.orderNo }, checked.data);
    const opts = { expectedVersion: this.data.order && this.data.order.version };
    const isReject = this.data.cancelKey === 'reject';
    this.submitWrite(() => (isReject ? orderApi.reject(data, opts) : orderApi.cancel(data, opts)),
      reasonPanel.successText(isReject), 'reason');
  },

  // ---------- 撤销条（统一 order.undo；失败按服务端最新状态说真话） ----------
  onUndoTap() {
    if (!this.data.undoBar.visible || this.guardReadonly()) {
      return;
    }
    const kind = this.data.undoBar.kind;
    this.clearUndoTimer();
    orderApi.undo({ orderNo: this.data.orderNo })
      .then(() => {
        wx.showToast({ title: writeHint(undoPart.successText(kind)), icon: 'none' });
        return this.load();
      })
      .catch((err) => {
        this.load().then(() => {
          wx.showToast({ title: undoPart.failureText(err, this.data.order), icon: 'none' });
        });
      });
  },

  // ---------- 留言 ----------
  onOpenMessage() {
    this.setData({ panel: 'message' });
  },
  onMessageInput(event) {
    this.setData({ messageText: ((event.detail && event.detail.value) || '').slice(0, MESSAGE_MAX) });
  },
  onMessageSend() {
    if (this.guardReadonly()) {
      return;
    }
    const text = (this.data.messageText || '').trim();
    if (!text) {
      wx.showToast({ title: COPY.messageEmpty, icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    messageApi.send({ orderNo: this.data.orderNo, text: text })
      .then(() => {
        this.setData({ sending: false, messageText: '', panel: '' });
        wx.showToast({ title: writeHint(COPY.messageSent), icon: 'none' });
        return this.loadMessages();
      })
      .catch((err) => {
        this.setData({ sending: false });
        wx.showToast({ title: (err && err.message) || COPY.messageFail, icon: 'none' });
      });
  },

  onPanelClose() {
    this.setData({ panel: '', correctError: '', exceptionError: '', deliveryError: '', reasonError: '' });
  },
  noop() {}
});
