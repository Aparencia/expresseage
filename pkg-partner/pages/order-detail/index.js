// pkg-partner/pages/order-detail/index.js · 兼职订单详情（真实 DTO：order.actions 决定动作条；counterpart 只在 ACTIVE 绑定内下发）
// 契约：docs/ux/V4_UX_PARTNER.md §3.3 / §4.4 / §4.7 / §4.13 / §4.14；docs/data/V4_DATA_MODEL.md §7.5（order.get/correct/undo）。
// 边界：页面零状态机判断（动作/状态/编号/凭证全部消费服务端 DTO 与 parts 纯件）；只经 api/modules 出入。
// TD-076：页面只留生命周期与 setData 编排——轮询/撤销倒计时 → parts/page-timers；浮层开关与提交 → parts/panel-actions。
const orderApi = require('../../../api/modules/order');
const messageApi = require('../../../api/modules/message');
const modeGuard = require('../../../api/mode-guard');
const client = require('../../../api/client');
const actionsPart = require('./parts/actions');
const eventView = require('./parts/event-view');
const exceptionPanel = require('./parts/exception-panel');
const transferPart = require('./parts/transfer');
const undoPart = require('./parts/undo');
const viewModel = require('./parts/view-model');
const messagePoll = require('./parts/message-poll');
const share = require('../../../utils/share/handlers');
const store = require('../../../store/index');
const MESSAGE_MAX = 200;
const COPY = {
  noOrderNo: '没有订单号，请回工作台重试',
  loadFail: '订单没加载出来，检查网络后重试',
  readonly: '开发者只读视角不能操作',
  testSuffix: '（将写入测试数据）',
  copyOrder: '订单号已复制',
  copyCustomer: '顾客编号已复制',
  submitFail: '操作没成功，请重试',
  messageEmpty: '先写点内容再发送',
  messageSent: '留言已发送',
  messageFail: '留言没发出去，请重试'
};

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + COPY.testSuffix : text;
}

// TD-076：计时器（parts/page-timers）与浮层接线（parts/panel-actions）按「页面方法」并入 Page 配置
Page(Object.assign({
  data: {
    orderNo: '',
    order: null,
    events: [],
    messages: [],
    actions: [],
    // 动作条分组（主操作一行 + 次操作/危险动作一行；分组纯件在 parts/action-bar，actions 原样保留）
    actionBar: { primary: null, secondary: [], visible: false },
    // P2-4：「改正这一件」「写留言」入口由服务端 actions[] 派生（canCorrect/canMessage），
    // 目标兼职 PENDING 视图只有转派动作时不渲染这两类写入口
    canCorrect: false,
    canMessage: false,
    // D58 转派：可见性/文案全部由 DTO actions[] 与 transfer 块驱动（纯件装配，页面零状态判据）
    transferCard: transferPart.closedCard(),
    transferPanel: transferPart.requestPanel(),
    transferInput: '',
    transferError: '',
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
    correctItemIndex: 0,
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
  // D42：头像临时 URL 过期/加载失败 → 点默认头像位重签（重拉一次 DTO，onShow 同理）
  onCounterpartAvatarRetry() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },
  onUnload() {
    this.stopMessagePoll();
    this.clearUndoTimer();
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
    const view = viewModel.buildView(order, events, { readonly: this.data.readonly, nowMs: Date.now(), config: store.get('config') });
    this.setData({
      order: view.order,
      events: events,
      actions: view.actions,
      actionBar: view.actionBar,
      transferCard: view.transferCard,
      transferPanel: view.transferPanel,
      voucher: view.voucher,
      correctPanel: view.correctPanel,
      exceptionPanel: view.exceptionPanel,
      deliveryPanel: view.deliveryPanel,
      deliveredChip: view.deliveredChip,
      guestAutoHint: view.guestAutoHint,
      undoBar: view.undoBar,
      customerNoText: view.customerNoText,
      canCorrect: view.canCorrect,
      canMessage: view.canMessage,
      loading: false
    });
    this.syncUndoTimer(); if (messagePoll.isTerminal(order)) this.stopMessagePoll();
    return this.loadMessages();
  },

  loadMessages() {
    return messageApi.list({ orderNo: this.data.orderNo })
      .then((data) => this.setData({ messages: eventView.buildMessages(data && data.list) }))
      .catch(() => this.setData({ messages: [] }));
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
      this.openCorrectPanel(0);
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

  // ---------- D58 转派（发起/确认接收/拒收/撤回）----------
  // 可见性 100% 来自 DTO：发起入口看 actions[] 是否含转派请求动作，邀请/等待/结果看 transfer 块（纯件装配）。
  // 写请求按既有形制带 clientRequestId（幂等）+ expectedVersion（乐观锁），错误文案一律用服务端 message。
  writeOpts() {
    return { expectedVersion: this.data.order && this.data.order.version };
  },
  onTransferRequestTap() {
    if (this.guardReadonly()) {
      return;
    }
    this.setData({ panel: 'transfer', transferInput: '', transferError: '' });
  },
  onTransferInput(event) {
    this.setData({ transferInput: ((event.detail && event.detail.value) || '').slice(0, transferPart.INPUT_MAX) });
  },
  // 输入完整 partnerNo → 二次确认（免责：转派后你将失去该单）→ api.order.requestTransfer
  onTransferSubmit() {
    if (this.guardReadonly()) {
      return;
    }
    const input = transferPart.inputOf(this.data.transferInput);
    if (!input.ok) {
      this.setData({ transferError: input.message });
      return;
    }
    const confirm = transferPart.requestConfirmOf(input.toPartnerNo);
    wx.showModal({
      title: confirm.title,
      content: this.writeHint(confirm.content),
      confirmText: confirm.confirmText,
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.submitWrite(() => orderApi.requestTransfer({
          orderNo: this.data.orderNo,
          toPartnerNo: input.toPartnerNo,
          clientRequestId: client.createRequestId()
        }, this.writeOpts()), transferPart.successTextOf('request'), 'transfer');
      }
    });
  },
  onTransferAcceptTap() {
    if (this.guardReadonly()) {
      return;
    }
    this.submitWrite(() => orderApi.acceptTransfer({
      orderNo: this.data.orderNo,
      clientRequestId: client.createRequestId()
    }, this.writeOpts()), transferPart.successTextOf('accept'));
  },
  onTransferDeclineTap() {
    if (this.guardReadonly()) {
      return;
    }
    const confirm = transferPart.declineConfirmOf();
    wx.showModal({
      title: confirm.title,
      content: this.writeHint(confirm.content),
      confirmText: confirm.confirmText,
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.submitWrite(() => orderApi.declineTransfer({
          orderNo: this.data.orderNo,
          clientRequestId: client.createRequestId()
        }, this.writeOpts()), transferPart.successTextOf('decline'));
      }
    });
  },
  onTransferCancelTap() {
    if (this.guardReadonly()) {
      return;
    }
    const confirm = transferPart.cancelConfirmOf();
    wx.showModal({
      title: confirm.title,
      content: this.writeHint(confirm.content),
      confirmText: confirm.confirmText,
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.submitWrite(() => orderApi.cancelTransfer({
          orderNo: this.data.orderNo,
          clientRequestId: client.createRequestId()
        }, this.writeOpts()), transferPart.successTextOf('cancel'));
      }
    });
  },

  // 写动作统一入口：loading 防重 → 成功 toast（TEST_WRITE 带测试数据提示）→ 重拉 DTO；状态/版本冲突（INVALID_TRANSITION/CONFLICT）自动刷新，不保留旧按钮态。
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
    this.setData({ panel: '', correctError: '', exceptionError: '', deliveryError: '', reasonError: '', transferError: '' });
  },
  noop() {},

  onShareAppMessage() {
    return share.appMessage();
  }
}, require('./parts/page-timers'), require('./parts/panel-actions'), require('./parts/image-actions')));
