// pkg-customer/pages/order-detail/index.js · 订单详情（10s 轮询 / 进度 / 留言 / 取消 / 确认 / 删除）
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const messageApi = require('../../../api/modules/message');
const view = require('../../parts/status-view');
const format = require('../../parts/format');

const POLL_MS = 10000;

Page({
  data: {
    orderNo: '',
    order: null,
    statusText: '',
    events: [],
    messages: [],
    messageText: '',
    loading: true,
    error: '',
    imageError: '',
    readonly: false,
    actions: { cancel: false, confirm: false, deleteRecord: false, message: false, image: false },
    progress: [],
    waitingHint: '',
    cancelVisible: false,
    cancelReasons: []
  },

  onLoad(options) {
    const orderNo = String((options && options.orderNo) || '');
    const snapshot = store.snapshot();
    this.setData({
      orderNo: orderNo,
      readonly: !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY'),
      cancelReasons: view.cancelReasons()
    });
    this.applyStoreConfig();
  },

  onShow() {
    this.refresh();
    this.startPoll();
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopPoll();
  },

  applyStoreConfig() {
    this.setData({ config: store.snapshot().config || {} });
  },

  startPoll() {
    this.stopPoll();
    this._poll = setInterval(() => this.refresh(true), POLL_MS);
  },

  stopPoll() {
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = null;
    }
  },

  async refresh(silent) {
    if (!this.data.orderNo) return;
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const data = await orderApi.get({ orderNo: this.data.orderNo });
      const order = (data && data.order) || null;
      const events = (data && data.events) || [];
      if (!order) {
        this.setData({ loading: false, order: null, error: '没有找到这条订单，已回到订单列表。' });
        return;
      }
      const messages = await this.loadMessages();
      this.setData({
        loading: false,
        order: order,
        // 状态文字以服务端 DTO 为准（statusText），本地 shared/order-state 只做兜底
        statusText: order.statusText || view.statusText(order.status),
        events: events.map(function map(item, index) {
          return {
            // 事件 DTO：{type,at,actorRole,note}（无 id/toStatus）
            id: (item.type || 'EVENT') + '@' + (item.at || index),
            type: item.type,
            text: view.eventText(item),
            time: format.formatDateTime(item.at),
            note: item.note || ''
          };
        }),
        messages: messages,
        actions: {
          // 取消/留言：以服务端 actions[] 为唯一判据（含 undo 窗口等服务端规则）
          cancel: view.hasAction(order, 'cancel'),
          message: view.hasAction(order, 'message'),
          // 确认收货/删除记录：服务端动作条未列，走 shared/order-state 的顾客侧规则
          confirm: view.canConfirmDelivery(order),
          deleteRecord: view.canDeleteRecord(order),
          image: view.canViewImage(order)
        },
        progress: view.progressSteps(order),
        waitingHint: view.waitingHint(order, this.data.config, format)
      });
    } catch (err) {
      if (!silent) this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请重试' });
    }
  },

  async loadMessages() {
    try {
      const data = await messageApi.list({ orderNo: this.data.orderNo, limit: 20 });
      const list = ((data && data.list) || []).map(function map(item, index) {
        const at = item.at || item.createdAt || '';
        return {
          // 留言 DTO：{type,title,text,orderNo,at,read,fromRole}
          id: item.id || at + '@' + index,
          text: item.text || '',
          mine: item.fromRole === 'CUSTOMER',
          time: format.formatDateTime(at)
        };
      });
      if (list.length > 0 && !this.data.readonly) this.markOrderRead();
      return list;
    } catch (err) {
      return this.data.messages;
    }
  },

  // 订单内已读水位：message.markRead({scope:'ORDER',orderNo})，每页只报一次，失败不影响浏览
  markOrderRead() {
    if (this._readMarked) return;
    this._readMarked = true;
    messageApi.markRead({ scope: 'ORDER', orderNo: this.data.orderNo }).catch(function ignore() {
      // 水位上报失败不影响浏览，下次进入页面会再次上报
    });
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  onRetry() {
    this.refresh();
  },

  onBackToList() {
    wx.navigateBack({
      fail: function fallback() {
        wx.reLaunch({ url: '/pages/customer/orders/index' });
      }
    });
  },

  onViewImage() {
    if (!this.data.actions.image) return;
    orderApi.imageUrl({ orderNo: this.data.orderNo }).then((data) => {
      const url = data && data.url;
      if (!url) {
        wx.showToast({ title: '截图已过期，点这里重新加载', icon: 'none' });
        return;
      }
      wx.previewImage({ urls: [url] });
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '截图加载失败', icon: 'none' });
    });
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
        orderApi.cancel({ orderNo: this.data.orderNo, reason: reason, note: note }).then(() => {
          wx.showToast({ title: '订单已取消', icon: 'success' });
          this.refresh();
        }).catch((err) => {
          wx.showToast({ title: (err && err.message) || '取消失败，请重试', icon: 'none' });
        });
      }
    });
  },

  onConfirmDeliveryTap() {
    if (!this.data.actions.confirm) return;
    wx.showModal({
      title: '确认收货',
      content: '确认已经收到这件快递？确认后订单将完成。',
      success: (res) => {
        if (!res.confirm) return;
        orderApi.confirmDelivery({ orderNo: this.data.orderNo }).then(() => {
          wx.showToast({ title: '已确认送达', icon: 'success' });
          this.refresh();
        }).catch((err) => {
          wx.showToast({ title: (err && err.message) || '确认失败，请重试', icon: 'none' });
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
        orderApi.deleteRecord({ orderNo: orderNo }).then(() => {
          wx.showToast({ title: '已删除记录', icon: 'success' });
          wx.navigateBack();
        }).catch((err) => {
          wx.showToast({ title: (err && err.message) || '删除失败，请重试', icon: 'none' });
        });
      }
    });
  },

  onMessageInput(e) {
    this.setData({ messageText: String((e.detail && e.detail.value) || '') });
  },

  onSendMessage() {
    const text = String(this.data.messageText || '').trim();
    if (!text) return;
    if (text.length > 200) {
      wx.showToast({ title: '留言最多 200 字', icon: 'none' });
      return;
    }
    messageApi.send({ orderNo: this.data.orderNo, text: text }).then(() => {
      this.setData({ messageText: '' });
      this.loadMessages().then((messages) => this.setData({ messages: messages }));
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '留言失败，请重试', icon: 'none' });
    });
  }
});
