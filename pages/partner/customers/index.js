// pages/partner/customers/index.js · 客户列表（只列已被顾客绑定的顾客；兼职端无任何添加/绑定/导入入口）
// 口径：docs/V4_UX_PARTNER.md §3.5；docs/V4_DATA_MODEL.md §7.4 listBindings（搜索/分页/排序全在服务端）
const partnerApi = require('../../../api/modules/partner');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const listModel = require('./parts/list-model');
const shareCard = require('../../profile/parts/share-card');

const SEARCH_DEBOUNCE_MS = 350;

Page({
  data: {
    rows: [],
    keyword: '',
    bannerText: '',
    headingText: '客户',
    partnerNo: '',
    readonly: false,
    session: false,
    showCreateEntry: true,
    showShare: true,
    mode: 'skeleton',
    showRows: false,
    showSkeleton: true,
    showError: false,
    showEmpty: false,
    skeletonRows: [1, 2, 3],
    emptyText: '',
    emptyActionText: '',
    errorText: '',
    staleText: '',
    lastSuccessText: '',
    footerText: '',
    hasMore: false
  },

  onLoad() {
    this.state = listModel.createState();
    this.searchTimer = null;
    this.setData({ partnerNo: this.partnerNoOf(), session: !!store.getViewContext() });
    this.render();
  },

  onShow() {
    // 解绑/顾客新绑定后回来自动刷新（服务端已排序分页，不依赖本地缓存）
    this.setData({
      session: !!store.getViewContext(),
      readonly: !modeGuard.canRenderWriteButton(),
      partnerNo: this.partnerNoOf()
    });
    this.load(true);
  },

  onUnload() {
    this.clearSearchTimer();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    const query = listModel.nextQuery(this.state);
    if (!query) {
      return;
    }
    this.load(false);
  },

  partnerNoOf() {
    const partner = store.get('partner') || {};
    return partner.partnerNo || '';
  },

  clearSearchTimer() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  render() {
    this.setData(listModel.buildSnapshot(this.state, {
      partnerNo: this.data.partnerNo,
      readonly: this.data.readonly,
      session: this.data.session
    }));
  },

  // reset=true：首屏/下拉/搜索（整页替换）；false：触底追加（游标分页）
  load(reset) {
    const append = reset !== true;
    const query = append ? listModel.nextQuery(this.state) : listModel.refreshQuery(this.state);
    if (append && !query) {
      return Promise.resolve();
    }
    if (append && (this.state.loading || this.state.loadingMore)) {
      return Promise.resolve();
    }
    this.state = listModel.beginLoad(this.state, append);
    this.render();
    return partnerApi.listBindings(query)
      .then((data) => {
        this.state = append
          ? listModel.applyMoreResponse(this.state, data || {}, { nowMs: Date.now() })
          : listModel.applyResponse(this.state, data || {}, { nowMs: Date.now() });
        this.render();
      })
      .catch((err) => {
        this.state = listModel.applyError(this.state, err && err.message);
        this.render();
      });
  },

  onKeywordInput(event) {
    const keyword = (event.detail && event.detail.value) || '';
    this.setData({ keyword: keyword });
    this.clearSearchTimer();
    this.searchTimer = setTimeout(() => this.search(), SEARCH_DEBOUNCE_MS);
  },

  onKeywordConfirm() {
    this.clearSearchTimer();
    this.search();
  },

  search() {
    this.searchTimer = null;
    this.state = listModel.applyKeyword(this.state, this.data.keyword);
    this.render();
    this.load(true);
  },

  onClearSearch() {
    this.clearSearchTimer();
    this.setData({ keyword: '' });
    this.state = listModel.applyKeyword(this.state, '');
    this.render();
    this.load(true);
  },

  onRetry() {
    this.load(true);
  },

  onDismissBanner() {
    this.state = listModel.dismissBanner(this.state);
    this.render();
  },

  onEmptyAction() {
    if (this.data.keyword) {
      this.onClearSearch();
      return;
    }
    if (this.data.session) {
      wx.showToast({ title: '切换会话下不能分享', icon: 'none' });
      return;
    }
    wx.showToast({ title: '点底部「分享绑定卡片」发给顾客', icon: 'none' });
  },

  goCreateOnBehalf(event) {
    const bindingId = (event && event.currentTarget && event.currentTarget.dataset.bindingId) || '';
    if (!modeGuard.canRenderWriteButton()) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    const base = '/pkg-partner/pages/create-on-behalf/index';
    wx.navigateTo({ url: bindingId ? base + '?bindingId=' + encodeURIComponent(bindingId) : base });
  },

  onRowTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const row = (this.data.rows || [])[index];
    if (!row || !row.bindingId) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/customer-detail/index?bindingId=' + encodeURIComponent(row.bindingId) });
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

  // 分享绑定卡片 = 邀请顾客自己发起绑定（卡片只带兼职编号；切换会话隐藏分享）
  onShareAppMessage() {
    return shareCard.buildShareMessage({
      isCustomer: false,
      viewSession: this.data.session,
      partnerCard: { partnerNo: this.data.partnerNo }
    });
  }
});
