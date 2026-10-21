// pages/partner/customers/index.js · 客户档案（绑定只能由顾客发起；兼职端无添加/绑定/导入顾客入口）
const partnerApi = require('../../../api/modules/partner');
const store = require('../../../store/index');
const customerView = require('../../../utils/customer-view');
const shareCard = require('../../profile/parts/share-card');

Page({
  data: {
    list: [],
    keyword: '',
    total: 0,
    loading: true,
    error: '',
    partnerNo: '',
    session: false,
    guideVisible: false
  },

  onLoad() {
    const partner = store.get('partner') || {};
    this.setData({ partnerNo: partner.partnerNo || '' });
    this.refreshSession();
  },

  onShow() {
    this.refreshSession();
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  refreshSession() {
    const view = store.getViewContext();
    this.setData({ session: !!view });
  },

  load() {
    this.setData({ loading: true, error: '' });
    return partnerApi
      .listBindings()
      .then((data) => {
        this.allViews = customerView.buildCustomerViews(data && data.list);
        this.applyFilter();
        this.setData({ loading: false, total: this.allViews.length, guideVisible: this.allViews.length === 0 });
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '客户没加载出来，检查网络后重试' });
      });
  },

  applyFilter() {
    const filtered = customerView.filterByKeyword(this.allViews || [], this.data.keyword);
    this.setData({ list: filtered });
  },

  onKeywordInput(event) {
    this.setData({ keyword: (event.detail && event.detail.value) || '' });
    this.applyFilter();
  },

  onKeywordConfirm(event) {
    this.onKeywordInput(event);
  },

  goCreateOnBehalf() {
    wx.navigateTo({ url: '/pkg-partner/pages/create-on-behalf/index' });
  },

  onShareTap() {
    if (this.data.session) {
      wx.showToast({ title: '切换会话下不能分享', icon: 'none' });
      return;
    }
    wx.showToast({ title: '点底部「分享绑定卡片」发给顾客', icon: 'none' });
  },

  onRowTap(event) {
    const index = event.currentTarget.dataset.index;
    const item = this.data.list[index];
    if (!item || !item.bindingId) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/customer-detail/index?bindingId=' + item.bindingId });
  },

  onCopyPartnerNo() {
    if (!this.data.partnerNo) {
      wx.showToast({ title: '还没有兼职编号，激活后才有', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.partnerNo,
      success() {
        wx.showToast({ title: '兼职编号已复制', icon: 'none' });
      }
    });
  },

  // 分享绑定卡片：判据/encode/path 全部来自 parts/share-card 纯件（单一来源；无编号回通用分享）
  onShareAppMessage() {
    return shareCard.buildShareMessage({
      isCustomer: false,
      viewSession: !!this.data.session,
      partnerCard: { partnerNo: this.data.partnerNo || '' }
    });
  }
});
