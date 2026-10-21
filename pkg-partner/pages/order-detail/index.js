// pkg-partner/pages/order-detail/index.js · 兼职订单详情（动作可见性来自服务端 order.actions）
const orderApi = require('../../../api/modules/order');
const messageApi = require('../../../api/modules/message');
const modeGuard = require('../../../api/mode-guard');
const orderEdit = require('../../../utils/order-edit');
const actionsPart = require('./parts/actions');
const eventView = require('./parts/event-view');

const UNDO_SECONDS = 5;
const NOTE_MAX = 100;
const MESSAGE_MAX = 200;
const CANCEL_REASONS = [
  { code: 'TOO_BUSY', label: '忙不过来' },
  { code: 'OUT_OF_RANGE', label: '不在服务范围' },
  { code: 'SERVICE_OFF', label: '服务未开' },
  { code: 'OTHER', label: '其他（备注必填）' }
];
const EXCEPTION_REASONS = [
  { code: 'CODE_INVALID', label: '取件码/柜号无效' },
  { code: 'PARCEL_NOT_FOUND', label: '驿站找不到件' },
  { code: 'CABINET_ERROR', label: '柜门/设备故障' },
  { code: 'CUSTOMER_UNREACHABLE', label: '联系不上顾客' },
  { code: 'ADDRESS_ISSUE', label: '宿舍地址问题' },
  { code: 'OTHER', label: '其他（备注必填）' }
];

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
    undo: { visible: false, remaining: 0, label: '' },
    cancelReasons: CANCEL_REASONS,
    exceptionReasons: EXCEPTION_REASONS,
    panel: '',
    reasonIndex: 0,
    reasonNote: '',
    exceptionIndex: 0,
    exceptionNote: '',
    codeEditor: { pickupCode: '', lockerNo: '', trackingTail: '' },
    messageText: '',
    sending: false,
    customerNoText: ''
  },

  onLoad(options) {
    this.setData({ orderNo: (options && options.orderNo) || '' });
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.load();
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onUnload() {
    this.clearUndoTimer();
  },

  load() {
    if (!this.data.orderNo) {
      this.setData({ loading: false, error: '没有订单号，请回工作台重试' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    return orderApi
      .get({ orderNo: this.data.orderNo })
      .then((data) => {
        const order = (data && data.order) || {};
        const customerNo = order.customerNo || (order.counterpart && order.counterpart.customerNo) || '';
        this.setData({
          order: order,
          events: eventView.buildEvents(data && data.events),
          actions: actionsPart.buildVisibleActions(order, this.data.readonly),
          customerNoText: customerNo,
          loading: false
        });
        return this.loadMessages();
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '订单没加载出来，检查网络后重试' });
      });
  },

  loadMessages() {
    return messageApi
      .list({ orderNo: this.data.orderNo })
      .then((data) => {
        this.setData({ messages: eventView.buildMessages(data && data.list) });
      })
      .catch(() => {
        this.setData({ messages: [] });
      });
  },

  guardReadonly() {
    if (modeGuard.canRenderWriteButton()) {
      return false;
    }
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return true;
  },

  onCopyOrderNo() {
    wx.setClipboardData({
      data: this.data.orderNo,
      success() {
        wx.showToast({ title: '订单号已复制', icon: 'none' });
      }
    });
  },

  onCopyCustomerNo() {
    if (!this.data.customerNoText) {
      return;
    }
    wx.setClipboardData({
      data: this.data.customerNoText,
      success() {
        wx.showToast({ title: '顾客编号已复制', icon: 'none' });
      }
    });
  },

  onViewImage() {
    orderApi
      .imageUrl({ orderNo: this.data.orderNo })
      .then((data) => {
        const url = data && data.url;
        if (!url) {
          throw new Error('截图暂时打不开');
        }
        wx.previewImage({ urls: [url], current: url });
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '截图暂时打不开', icon: 'none' });
      });
  },

  onActionTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const key = event.currentTarget.dataset.key;
    const action = (this.data.actions || []).filter((item) => item.key === key)[0];
    if (!action) {
      return;
    }
    if (action.panel === 'code') {
      this.openCodePanel();
      return;
    }
    if (action.panel === 'exception') {
      this.setData({ panel: 'exception', exceptionIndex: 0, exceptionNote: '' });
      return;
    }
    if (action.panel === 'message') {
      this.setData({ panel: 'message' });
      return;
    }
    if (action.needReason) {
      this.setData({ panel: key === 'reject' ? 'reject' : 'cancel', reasonIndex: 0, reasonNote: '' });
      return;
    }
    this.confirmAndRun(action);
  },

  confirmAndRun(action) {
    const run = () => this.runAction(action.key);
    if (!action.confirmText) {
      run();
      return;
    }
    wx.showModal({
      title: action.label,
      content: action.confirmText,
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          run();
        }
      }
    });
  },

  runAction(key) {
    const orderNo = this.data.orderNo;
    const order = this.data.order || {};
    const expectedVersion = order.version;
    if (key === 'accept') {
      return this.submit(orderApi.accept({ orderNo: orderNo, expectedVersion: expectedVersion }), false, '已接单');
    }
    if (key === 'pick') {
      return this.submit(orderApi.markPicked({ orderNo: orderNo, expectedVersion: expectedVersion }), true, '已标记取件');
    }
    if (key === 'undoPick') {
      return this.submit(orderApi.unmarkPicked({ orderNo: orderNo, expectedVersion: expectedVersion }), false, '已撤销取件');
    }
    if (key === 'deliver') {
      return this.promptDeliveryNote();
    }
    if (key === 'undoDeliver') {
      return this.submit(orderApi.unmarkDelivered({ orderNo: orderNo, expectedVersion: expectedVersion }), false, '已撤销送达');
    }
    if (key === 'resolve') {
      return this.submit(orderApi.resolveException({ orderNo: orderNo }), false, '已解除异常');
    }
    return Promise.resolve();
  },

  promptDeliveryNote() {
    wx.showModal({
      title: '标记送达',
      editable: true,
      placeholderText: '送达备注（选填，≤100 字）',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const note = (res.content || '').slice(0, NOTE_MAX);
        const order = this.data.order || {};
        this.submit(
          orderApi.markDelivered({ orderNo: this.data.orderNo, deliveryNote: note || undefined, expectedVersion: order.version }),
          true,
          '已标记送达'
        );
      }
    });
  },

  submit(promise, startUndo, successText) {
    this.setData({ sending: true });
    return promise
      .then(() => {
        this.setData({ sending: false });
        wx.showToast({ title: successText, icon: 'none' });
        if (startUndo) {
          this.startUndo(successText);
        }
        return this.load();
      })
      .catch((err) => {
        this.setData({ sending: false });
        wx.showToast({ title: (err && err.message) || '操作没成功，请重试', icon: 'none' });
        if (err && err.code === 'INVALID_TRANSITION') {
          this.load();
        }
      });
  },

  startUndo(label) {
    this.clearUndoTimer();
    const undo = { visible: true, remaining: UNDO_SECONDS, label: label };
    this.setData({ undo: undo });
    this.undoTimer = setInterval(() => {
      const remaining = this.data.undo.remaining - 1;
      if (remaining <= 0) {
        this.clearUndoTimer();
        this.setData({ undo: { visible: false, remaining: 0, label: '' } });
        return;
      }
      this.setData({ 'undo.remaining': remaining });
    }, 1000);
  },

  clearUndoTimer() {
    if (this.undoTimer) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
  },

  onUndoTap() {
    if (!this.data.undo.visible || this.guardReadonly()) {
      return;
    }
    this.clearUndoTimer();
    orderApi
      .undo({ orderNo: this.data.orderNo })
      .then(() => {
        this.setData({ undo: { visible: false, remaining: 0, label: '' } });
        wx.showToast({ title: '已撤销', icon: 'none' });
        this.load();
      })
      .catch((err) => {
        this.setData({ undo: { visible: false, remaining: 0, label: '' } });
        wx.showToast({ title: (err && err.message) || '撤销失败，订单状态已变化', icon: 'none' });
        this.load();
      });
  },

  openCodePanel() {
    const order = this.data.order || {};
    const parcel = order.parcel || {};
    this.setData({
      panel: 'code',
      codeEditor: {
        pickupCode: parcel.pickupCode || '',
        lockerNo: parcel.lockerNo || '',
        trackingTail: parcel.trackingTail || ''
      }
    });
  },

  onCodeInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ['codeEditor.' + field]: (event.detail && event.detail.value) || '' });
  },

  onCodeSave() {
    if (this.guardReadonly()) {
      return;
    }
    const order = this.data.order || {};
    const picked = order.pickedAt ? true : false;
    const checked = orderEdit.validatePatch(this.data.codeEditor, { pickedOnly: picked });
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }
    if (!Object.keys(checked.patch).length) {
      this.setData({ panel: '' });
      return;
    }
    orderApi
      .correct({ orderNo: this.data.orderNo, patch: checked.patch, expectedVersion: order.version })
      .then(() => {
        this.setData({ panel: '' });
        wx.showToast({ title: '已更正，顾客端同步', icon: 'none' });
        this.load();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
      });
  },

  onReasonChange(event) {
    this.setData({ reasonIndex: Number(event.detail.value) });
  },

  onReasonNoteInput(event) {
    this.setData({ reasonNote: ((event.detail && event.detail.value) || '').slice(0, NOTE_MAX) });
  },

  onCancelReasonSubmit() {
    if (this.guardReadonly()) {
      return;
    }
    const reason = this.data.cancelReasons[this.data.reasonIndex] || {};
    const note = this.data.reasonNote || '';
    if (reason.code === 'OTHER' && !note) {
      wx.showToast({ title: '选「其他」时备注必填', icon: 'none' });
      return;
    }
    const isReject = this.data.panel === 'reject';
    const api = isReject ? orderApi.reject : orderApi.cancel;
    api({ orderNo: this.data.orderNo, reason: reason.code, note: note || undefined })
      .then(() => {
        this.setData({ panel: '' });
        wx.showToast({ title: '已提交，顾客会看到原因', icon: 'none' });
        this.load();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none' });
      });
  },

  onExceptionChange(event) {
    this.setData({ exceptionIndex: Number(event.detail.value) });
  },

  onExceptionNoteInput(event) {
    this.setData({ exceptionNote: ((event.detail && event.detail.value) || '').slice(0, 200) });
  },

  onExceptionSubmit() {
    if (this.guardReadonly()) {
      return;
    }
    const reason = this.data.exceptionReasons[this.data.exceptionIndex] || {};
    const note = this.data.exceptionNote || '';
    if (reason.code === 'OTHER' && !note) {
      wx.showToast({ title: '选「其他」时备注必填', icon: 'none' });
      return;
    }
    orderApi
      .reportException({ orderNo: this.data.orderNo, code: reason.code, text: note || undefined })
      .then(() => {
        this.setData({ panel: '' });
        wx.showToast({ title: '已上报异常，顾客已收到提醒', icon: 'none' });
        this.load();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '上报失败，请重试', icon: 'none' });
      });
  },

  onMessageInput(event) {
    this.setData({ messageText: ((event.detail && event.detail.value) || '').slice(0, MESSAGE_MAX) });
  },

  onMessageSend() {
    if (this.guardReadonly() || !this.data.messageText) {
      return;
    }
    this.setData({ sending: true });
    messageApi
      .send({ orderNo: this.data.orderNo, text: this.data.messageText })
      .then(() => {
        this.setData({ sending: false, messageText: '' });
        return this.loadMessages();
      })
      .catch((err) => {
        this.setData({ sending: false });
        wx.showToast({ title: (err && err.message) || '留言没发出去，请重试', icon: 'none' });
      });
  },

  onOpenMessage() {
    this.setData({ panel: 'message' });
  },

  onPanelClose() {
    this.setData({ panel: '' });
  },

  noop() {}
});
