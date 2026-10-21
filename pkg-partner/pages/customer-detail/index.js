// pkg-partner/pages/customer-detail/index.js · 顾客档案（头像/昵称/编号/备注/历史单/解绑；绑定只能由顾客发起）
const partnerApi = require('../../../api/modules/partner');
const orderApi = require('../../../api/modules/order');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const customerView = require('../../../utils/customer-view');

const RELEASE_REASON = 'PARTNER_INITIATED';
const NOTE_MAX = 100;

function noteText(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > NOTE_MAX ? value.slice(0, NOTE_MAX) : value;
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// 服务端时间是 ISO 字符串；历史单展示到分钟即可
function timeTextOf(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

// order.listPartner(history) 的 DTO 行 → 历史单展示行（statusText 由服务端下发，页面不自判状态）
function buildHistoryRows(list) {
  return (Array.isArray(list) ? list : []).map((order) => {
    const item = order || {};
    const parcel = item.parcel || {};
    return {
      orderNo: item.orderNo || '',
      statusText: item.statusText || '',
      codeText: parcel.pickupCode || '',
      timeText: timeTextOf(item.completedAt || item.cancelledAt || item.statusUpdatedAt)
    };
  });
}

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + '（将写入测试数据）' : text;
}

Page({
  data: {
    bindingId: '',
    view: null,
    orders: [],
    loading: true,
    error: '',
    readonly: false,
    noteEditing: false,
    noteValue: '',
    savingNote: false,
    unbinding: false,
    releaseReasonLabel: '兼职主动解绑'
  },

  onLoad(options) {
    const bindingId = (options && options.bindingId) || '';
    this.setData({ bindingId: bindingId });
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
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
    return partnerApi
      .listBindings()
      .then((data) => {
        const views = customerView.buildCustomerViews(data && data.list);
        const view = customerView.findById(views, this.data.bindingId);
        if (!view) {
          this.setData({ loading: false, error: '这位顾客已不在绑定关系中（可能已解绑）' });
          return null;
        }
        this.setData({ view: view, noteValue: view.partnerNote, loading: false });
        return orderApi.listPartner({ view: 'history', keyword: view.customerNo, limit: 20 }).then((result) => {
          this.setData({ orders: buildHistoryRows(result && result.list) });
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '顾客资料没加载出来，检查网络后重试' });
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
    this.setData({ noteValue: noteText((event.detail && event.detail.value) || '') });
  },

  onCancelNote() {
    this.setData({ noteEditing: false, noteValue: (this.data.view && this.data.view.partnerNote) || '' });
  },

  onSaveNote() {
    if (this.data.savingNote || this.guardReadonly()) {
      return;
    }
    this.setData({ savingNote: true });
    partnerApi
      .saveCustomerNote({ bindingId: this.data.bindingId, partnerNote: this.data.noteValue })
      .then((data) => {
        const saved = data && typeof data.partnerNote === 'string' ? data.partnerNote : this.data.noteValue;
        const view = Object.assign({}, this.data.view, { partnerNote: saved });
        this.setData({ view: view, noteValue: saved, noteEditing: false, savingNote: false });
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
    const view = this.data.view || {};
    if (view.activeOrderCount > 0) {
      wx.showToast({ title: '还有进行中的订单，完成后才能解绑', icon: 'none' });
      return;
    }
    this.promptUnbindNote();
  },

  promptUnbindNote() {
    wx.showModal({
      title: '填写解绑原因',
      editable: true,
      placeholderText: '原因（必填，≤100 字）',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const note = noteText(res.content || '');
        if (!note) {
          wx.showToast({ title: '原因必填，写一句就好', icon: 'none' });
          return;
        }
        this.confirmUnbind(note);
      }
    });
  },

  confirmUnbind(note) {
    wx.showModal({
      title: '确认解绑',
      content: '解绑后顾客需重新发起绑定才能下单，历史订单保留；双方将不再看到对方头像与昵称。',
      confirmText: '确认解绑',
      confirmColor: '#E54D42',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ unbinding: true });
        partnerApi
          .unbindCustomer({ bindingId: this.data.bindingId, reason: RELEASE_REASON, note: note })
          .then(() => {
            wx.showToast({ title: writeHint('已解绑，已通知顾客'), icon: 'none' });
            setTimeout(() => wx.navigateBack({ delta: 1 }), 600);
          })
          .catch((err) => {
            this.setData({ unbinding: false });
            wx.showToast({ title: (err && err.message) || '解绑失败，请重试', icon: 'none' });
          });
      }
    });
  },

  onOrderTap(event) {
    const orderNo = event.currentTarget.dataset.orderNo;
    if (!orderNo) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo });
  },

  onCopyCustomerNo() {
    const view = this.data.view || {};
    if (!view.customerNo) {
      return;
    }
    wx.setClipboardData({
      data: view.customerNo,
      success() {
        wx.showToast({ title: '顾客编号已复制', icon: 'none' });
      }
    });
  }
});
