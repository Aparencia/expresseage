// pkg-partner/pages/customer-detail/index.js · 顾客详情（档案/私有备注/自然日历史单/解绑；参数只带 bindingId）
// 数据来源：档案+解绑资格 = partner.getCustomer({bindingId})；历史单 = order.listPartner({view:'customer'})
//          （单一来源：排序/游标/扫描窗与工作台一致；getCustomer 的 orders 字段不消费）
const partnerApi = require('../../../api/modules/partner');
const orderApi = require('../../../api/modules/order');
const modeGuard = require('../../../api/mode-guard');
const detailView = require('./parts/detail-view');
const unbindFlow = require('./parts/unbind-flow');
const share = require('../../../utils/share/handlers');

const DEFAULT_NOTE_MAX = unbindFlow.NOTE_MAX;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + '（测试数据）' : text;
}

Page({
  data: {
    bindingId: '',
    view: null,
    sections: [],
    hasOrders: false,
    emptyOrdersText: '还没有历史订单',
    showMore: false,
    moreText: '查看更早',
    unbind: null,
    partnerNo: '',
    loading: true,
    loadingMore: false,
    error: '',
    readonly: false,
    noteEditing: false,
    noteValue: '',
    noteMax: DEFAULT_NOTE_MAX,
    savingNote: false,
    unbinding: false
  },

  onLoad(options) {
    this.rawOrders = [];
    this.profile = null;
    this.nextCursor = '';
    const bindingId = textOf(options && options.bindingId);
    this.setData({ bindingId: bindingId, readonly: !modeGuard.canRenderWriteButton() });
    this.load();
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    if (!this.data.bindingId) {
      this.setData({ loading: false, error: '没有找到这位顾客，请回客户列表重试' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    // 档案与订单并行取；订单失败同样走错误卡重试（不拿档案里的旧 orders 兜底，保持单一来源）
    return Promise.all([
      partnerApi.getCustomer(detailView.buildProfileQuery(this.data.bindingId)),
      orderApi.listPartner(detailView.buildOrdersQuery(this.data.bindingId))
    ])
      .then((results) => {
        this.profile = results[0] || {};
        const ordersPage = results[1] || {};
        this.rawOrders = ordersPage.list || [];
        this.nextCursor = textOf(ordersPage.nextCursor);
        this.applyData(false);
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '顾客资料没加载出来，检查网络后重试' });
      });
  },

  applyData(loadingMore) {
    const snapshot = detailView.buildSnapshot(this.profile || {}, {
      orders: this.rawOrders,
      nextCursor: this.nextCursor,
      nowMs: Date.now(),
      readonly: this.data.readonly,
      loadingMore: loadingMore === true
    });
    this.setData(Object.assign({}, snapshot, {
      loading: false,
      loadingMore: loadingMore === true,
      error: '',
      noteValue: snapshot.view.partnerNote
    }));
  },

  // "查看更早"：同一 order.listPartner(view=customer) 带服务端 nextCursor（不换接口、不本地截断）
  onLoadMore() {
    const cursor = textOf(this.data.nextCursor);
    if (!cursor || this.data.loadingMore) {
      return;
    }
    this.setData({ loadingMore: true });
    orderApi.listPartner(detailView.buildOrdersQuery(this.data.bindingId, cursor))
      .then((ordersPage) => {
        const page = ordersPage || {};
        this.rawOrders = detailView.mergeOrderPages(this.rawOrders, page.list || []);
        this.nextCursor = textOf(page.nextCursor);
        this.applyData(true);
      })
      .catch((err) => {
        this.setData({ loadingMore: false });
        wx.showToast({ title: (err && err.message) || '更早的订单没加载出来，请重试', icon: 'none' });
      });
  },

  guardReadonly() {
    if (modeGuard.canRenderWriteButton()) {
      return false;
    }
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return true;
  },

  onEditNote() {
    if (this.guardReadonly()) {
      return;
    }
    this.setData({ noteEditing: true });
  },

  onNoteInput(event) {
    const raw = (event.detail && event.detail.value) || '';
    this.setData({ noteValue: raw.slice(0, this.data.noteMax) });
  },

  onCancelNote() {
    this.setData({ noteEditing: false, noteValue: (this.data.view && this.data.view.partnerNote) || '' });
  },

  onSaveNote() {
    if (this.data.savingNote || this.guardReadonly()) {
      return;
    }
    this.setData({ savingNote: true });
    partnerApi.saveCustomerNote({ bindingId: this.data.bindingId, partnerNote: textOf(this.data.noteValue) })
      .then((data) => {
        const saved = data && typeof data.partnerNote === 'string' ? data.partnerNote : textOf(this.data.noteValue);
        this.setData({
          'view.partnerNote': saved,
          noteValue: saved,
          noteEditing: false,
          savingNote: false
        });
        wx.showToast({ title: writeHint('已保存，仅自己可见'), icon: 'none' });
      })
      .catch((err) => {
        this.setData({ savingNote: false });
        wx.showToast({ title: (err && err.message) || '备注没保存成功，请重试', icon: 'none' });
      });
  },

  onUnbindTap() {
    if (this.data.unbinding || this.guardReadonly()) {
      return;
    }
    const block = this.data.unbind || {};
    if (block.disabled) {
      wx.showToast({ title: block.lockText || '现在不能解绑', icon: 'none' });
      return;
    }
    wx.showModal(Object.assign({}, unbindFlow.firstDialog(), {
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const checked = unbindFlow.validateNote(res.content || '');
        if (!checked.ok) {
          wx.showToast({ title: checked.message, icon: 'none' });
          return;
        }
        this.confirmUnbind(checked.note);
      }
    }));
  },

  confirmUnbind(note) {
    const built = unbindFlow.buildPayload(this.data.bindingId, note);
    if (!built.ok) {
      wx.showToast({ title: built.message, icon: 'none' });
      return;
    }
    wx.showModal(Object.assign({}, unbindFlow.confirmDialog(), {
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ unbinding: true });
        partnerApi.unbindCustomer(built.data)
          .then(() => {
            wx.showToast({ title: unbindFlow.successText(modeGuard.isTestWrite()), icon: 'none' });
            setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
          })
          .catch((err) => {
            this.setData({ unbinding: false });
            wx.showToast({ title: unbindFlow.failureText(err), icon: 'none' });
          });
      }
    }));
  },

  onOrderTap(event) {
    const orderNo = textOf(event.currentTarget.dataset.orderNo);
    if (!orderNo) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + encodeURIComponent(orderNo) });
  },

  goCreateOnBehalf() {
    if (this.guardReadonly()) {
      return;
    }
    wx.navigateTo({
      url: '/pkg-partner/pages/create-on-behalf/index?bindingId=' + encodeURIComponent(this.data.bindingId)
    });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
