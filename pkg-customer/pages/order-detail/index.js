// pkg-customer/pages/order-detail/index.js · 订单详情（服务端 actions[] 单一判据 / 10s 轮询 / 进度 / 留言 / 再次下单）
// 页面只做取参/调 api/setData/事件转发：状态与进度映射在 parts/status-view，轮询在 parts/poll-policy，
// 数据编排在 parts/order-detail-flow（页面层零七状态字面量、零 wx.cloud、零 random；check #21）。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const messageApi = require('../../../api/modules/message');
const view = require('../../parts/status-view');
const flow = require('../../parts/order-detail-flow');
const format = require('../../parts/format');
const parcelView = require('./parts/parcel-view');
const share = require('../../../utils/share/handlers');

const CREATE_PAGE = '/pkg-customer/pages/order-create/index';
const ORDERS_PAGE = '/pages/customer/orders/index';
const MESSAGE_MAX = 200;

Page({
  data: {
    orderNo: '',
    requestCount: 0,
    order: null,
    loading: true,
    writing: false,
    error: '',
    pollError: '',
    lastUpdatedText: '',
    statusText: '',
    statusDesc: '',
    progress: { steps: [], mode: 'normal', branchLabel: '', branchText: '' },
    actions: view.actionsView(null, false),
    cancelGuide: '',
    image: { state: 'NONE', canView: false, text: '' },
    // v1.0（D23/D24/D25）：多包裹 / 多图 / 配送地址 / 无截图标识
    parcels: [],
    parcelCount: 0,
    deliveryText: '',
    deliveryRecipient: '',
    deliveryIsOther: false,
    manualEntryText: '',
    events: [],
    notice: { type: '', text: '' },
    exception: null,
    waitingHint: '',
    pickupCodeText: '—',
    messages: [],
    message: { inputVisible: false, archiveText: '' },
    messageText: '',
    readonly: false,
    config: {},
    cancelReasons: []
  },

  onLoad(options) {
    const orderNo = String((options && options.orderNo) || '');
    const snapshot = store.snapshot();
    this._session = flow.createSession();
    this.setData({
      orderNo: orderNo,
      readonly: !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY'),
      config: snapshot.config || {},
      cancelReasons: view.cancelReasons()
    });
  },

  onShow() {
    if (!this.data.orderNo) {
      this.setData({ loading: false, error: flow.NOT_FOUND_COPY });
      return;
    }
    // 可见即恢复轮询（失败退避计数归零），onHide/onUnload 停
    this._session = flow.startPoll(this._session);
    this.refresh();
  },

  onHide() {
    this.clearTimer();
    this._session = flow.stopPoll(this._session);
  },

  onUnload() {
    this.clearTimer();
    this._session = flow.stopPoll(this._session);
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  },

  refresh() {
    if (!this.data.orderNo) return Promise.resolve(null);
    this.clearTimer();
    const requestCount = Number(this.data.requestCount) + 1;
    this.setData({ requestCount: requestCount });
    if (!this.data.order) this.setData({ loading: true });
    return flow.refresh(this._session, {
      orderNo: this.data.orderNo,
      getOrder: orderApi.get,
      readonly: this.data.readonly,
      config: this.data.config,
      now: () => Date.now()
    }).then((session) => {
      if (requestCount !== this.data.requestCount) return session;
      this._session = session;
      this.applySession(session);
      if (session.view) this.loadMessages();
      this.schedule();
      return session;
    });
  },

  applySession(session) {
    const payload = {
      loading: false,
      error: session.error,
      pollError: session.pollError,
      lastUpdatedText: flow.lastUpdatedText(session)
    };
    if (session.view) Object.assign(payload, session.view);
    // v1.0 订单模型：parcels[]/images[]/delivery/manualEntry 由本地纯件转视图（不改共享 parts）
    if (payload.order) Object.assign(payload, parcelView.pageExtras(payload.order));
    this.setData(payload);
  },

  schedule() {
    this.clearTimer();
    const delay = flow.pollDelay(this._session);
    if (!delay) return;
    this._timer = setTimeout(() => this.refresh(), delay);
  },

  async loadMessages() {
    try {
      const data = await messageApi.list({ orderNo: this.data.orderNo, limit: 20 });
      const list = ((data && data.list) || []).map(function map(item, index) {
        const at = item.at || item.createdAt || '';
        // 留言 DTO：{type,title,text,orderNo,at,read,fromRole}
        return {
          id: item.id || at + '@' + index,
          text: item.text || '',
          mine: item.fromRole === 'CUSTOMER',
          time: format.formatDateTime(at)
        };
      });
      this.setData({ messages: list });
      if (list.length > 0 && !this.data.readonly) this.markOrderRead();
    } catch (err) {
      // 留言读取失败不覆盖已展示的留言（弱网时保留旧数据）
      return this.data.messages;
    }
    return this.data.messages;
  },

  // 订单内已读水位：message.markRead({scope:'ORDER',orderNo})，每页只报一次，失败不影响浏览
  markOrderRead() {
    if (this._readMarked) return;
    this._readMarked = true;
    messageApi.markRead({ scope: 'ORDER', orderNo: this.data.orderNo }).catch(function ignore() {
      // 水位上报失败不影响浏览，下次进入页面会再次上报
    });
  },

  onBackToList() {
    wx.navigateBack({
      fail: function fallback() {
        wx.reLaunch({ url: ORDERS_PAGE });
      }
    });
  },

  onRetry() {
    this.refresh();
  },

  onCopyOrderNo() {
    const orderNo = this.data.orderNo;
    if (!orderNo) return;
    wx.setClipboardData({
      data: orderNo,
      success() {
        wx.showToast({ title: '订单号已复制', icon: 'none' });
      }
    });
  },

  onViewImage(e) {
    const image = this.data.image || {};
    const index = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : 0) || 0;
    if (!image.canView) {
      wx.showToast({ title: image.text || '这条订单没有截图', icon: 'none' });
      return;
    }
    this.setData({ image: Object.assign({}, image, { state: 'LOADING', text: '正在加载截图…' }) });
    orderApi.imageUrl({ orderNo: this.data.orderNo, index: index }).then((data) => {
      const url = data && data.url;
      if (!url) {
        this.showImageError('NOT_FOUND', '');
        return;
      }
      const next = parcelView.imagesView(this.data.order || {});
      this.setData({ image: Object.assign({}, next, { state: 'AVAILABLE' }) });
      wx.previewImage({ urls: [url] });
    }).catch((err) => this.showImageError(err && err.code, err && err.message));
  },

  // 截图三态人话：已清理/已过期/加载失败（文案单源在 parts/status-view.imageErrorText）
  showImageError(code, message) {
    const text = view.imageErrorText(code, message);
    const canRetry = code !== 'NOT_FOUND';
    this.setData({ image: { state: canRetry ? 'FAILED' : 'EXPIRED', canView: canRetry, text: text } });
    wx.showToast({ title: text, icon: 'none' });
  },

  onReorderTap() {
    if (!this.data.actions.reorder) return;
    wx.navigateTo({ url: CREATE_PAGE + '?reorder=' + encodeURIComponent(this.data.orderNo) });
  },

  onCancelTap() {
    if (!this.data.actions.cancel) return;
    const reasons = this.data.cancelReasons;
    wx.showActionSheet({
      itemList: reasons.map(function label(item) { return item.label; }),
      success: (res) => {
        const reason = reasons[res.tapIndex];
        if (!reason) return;
        if (reason.code === 'OTHER') {
          this.promptCancelNote(reason.code);
          return;
        }
        this.doCancel(reason.code, '');
      }
    });
  },

  promptCancelNote(code) {
    wx.showModal({
      title: '其他原因',
      editable: true,
      placeholderText: '请补充说明（必填）',
      success: (res) => {
        if (!res.confirm) return;
        const note = String(res.content || '').trim();
        if (!note) {
          wx.showToast({ title: '其他原因需要补充说明', icon: 'none' });
          return;
        }
        this.doCancel(code, note);
      }
    });
  },

  doCancel(reason, note) {
    wx.showModal({
      title: '取消订单',
      content: '取消后兼职将停止处理；确定取消这份订单？',
      success: (res) => {
        if (!res.confirm) return;
        this.writeAction(orderApi.cancel, { reason: reason, note: note }).then((ok) => {
          if (!ok) return;
          wx.showToast({ title: '订单已取消', icon: 'success' });
        });
      }
    });
  },

  onConfirmDeliveryTap() {
    if (!this.data.actions.confirm) return;
    const count = this.data.parcelCount || 1;
    wx.showModal({
      title: '确认收货',
      content: count > 1
        ? '确认本单 ' + count + ' 件快递都已经收到？确认后整张订单将完成。'
        : '确认已经收到这件快递？确认后订单将完成。',
      success: (res) => {
        if (!res.confirm) return;
        this.writeAction(orderApi.confirmDelivery, {}).then((ok) => {
          if (!ok) return;
          wx.showToast({ title: '已确认送达', icon: 'success' });
        });
      }
    });
  },

  onDeleteRecordTap() {
    if (!this.data.actions.deleteRecord) return;
    const orderNo = this.data.orderNo;
    wx.showModal({
      title: '删除记录',
      content: '删除后 7 天会物理删除这条订单记录（含留言，订单号 ' + orderNo + '），确定删除？',
      success: (res) => {
        if (!res.confirm) return;
        this.writeAction(orderApi.deleteRecord, {}).then((ok) => {
          if (!ok) return;
          wx.showToast({ title: '已删除记录', icon: 'success' });
          wx.navigateBack({ fail: function fallback() { wx.reLaunch({ url: ORDERS_PAGE }); } });
        });
      }
    });
  },

  // 写动作统一入口：带 expectedVersion（乐观锁），成功后用服务端返回 order 立即重绘，不空等轮询
  writeAction(apiCall, payload) {
    if (this.data.readonly) return Promise.resolve(false);
    const session = this._session || flow.createSession();
    const order = session.order || {};
    const version = typeof order.version === 'number' ? order.version : undefined;
    this.setData({ writing: true });
    return apiCall(Object.assign({ orderNo: this.data.orderNo }, payload || {}), { expectedVersion: version })
      .then((data) => {
        this.setData({ writing: false });
        const next = data && data.order;
        if (next) {
          this._session = flow.applyOrder(this._session, next, {
            readonly: this.data.readonly,
            config: this.data.config,
            now: () => Date.now()
          });
          this.applySession(this._session);
        }
        return true;
      })
      .catch((err) => {
        this.setData({ writing: false });
        const text = (err && err.message) || '操作失败，请重试';
        wx.showToast({ title: text, icon: 'none' });
        // CONFLICT：数据已被别人更新 → 人话在 error-copy，刷新详情让操作者基于最新状态再来一次
        if (err && err.code === 'CONFLICT') this.refresh();
        return false;
      });
  },

  onMessageInput(e) {
    this.setData({ messageText: String((e.detail && e.detail.value) || '') });
  },

  onSendMessage() {
    if (!this.data.message.inputVisible) {
      wx.showToast({ title: '这条订单现在不能留言', icon: 'none' });
      return;
    }
    const text = String(this.data.messageText || '').trim();
    if (!text) return;
    if (text.length > MESSAGE_MAX) {
      wx.showToast({ title: '留言最多 ' + MESSAGE_MAX + ' 字', icon: 'none' });
      return;
    }
    messageApi.send({ orderNo: this.data.orderNo, text: text }).then(() => {
      this.setData({ messageText: '' });
      this.loadMessages();
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '留言失败，请重试', icon: 'none' });
    });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
