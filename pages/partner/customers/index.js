// pages/partner/customers/index.js · 客户列表（只列已被顾客绑定的顾客；兼职端无任何添加/绑定/导入入口）
// 口径：docs/ux/V4_UX_PARTNER.md §3.5；docs/data/V4_DATA_MODEL.md §7.4 listBindings（搜索/分页/排序全在服务端）
// 批20-C（首屏流式）：骨架 6 张灰占位 → 结果首片 ≤10 行立即 setData、其余按帧追加；
//   onShow 刷新保留旧列表 + 行级 diff（只改变动行），同 bindingId+avatarFileId 沿用旧头像 URL；
//   请求在途底部「更新中…」小字。装配与补丁计算全在 parts/list-model.js（页面只接线）。
// D67（批 24）：已筛选器 chips（全部/资料未完善/按苑/按楼栋/有备注）+ 苑/楼栋二级选择；筛选态存页面 data、
//   onShow 不丢；变化即重置 cursor 走首屏加载；空态与「筛选后无结果」文案由 parts/filter-model.js 分流。
const partnerApi = require('../../../api/modules/partner');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const listModel = require('./parts/list-model');
const shareCard = require('../../profile/parts/share-card');

const SEARCH_DEBOUNCE_MS = 350;
// 分片追加间隔：让首片先上屏（与工作台 P0-5 同套路）
const CHUNK_DELAY_MS = 16;

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
    skeletonRows: [1, 2, 3, 4, 5, 6],
    emptyText: '',
    emptyActionText: '',
    errorText: '',
    staleText: '',
    lastSuccessText: '',
    footerText: '',
    hasMore: false,
    // D67 筛选器（选中态存页面 data，onShow 刷新不丢；默认全部）
    filterChips: [],
    filterMode: 'all',
    filterZone: '',
    filterBuildingNo: 0,
    filterDesc: '',
    filterActive: false,
    showZonePicker: false,
    showBuildingPicker: false,
    zoneOptions: [],
    buildingOptions: []
  },

  onLoad() {
    this.state = listModel.createState();
    this.searchTimer = null;
    this._chunkToken = 0;
    this.setData({ partnerNo: this.partnerNoOf(), session: !!store.getViewContext() });
    this.render();
  },

  onShow() {
    this.syncTabBar();
    // 解绑/顾客新绑定后回来自动刷新（服务端已排序分页，不依赖本地缓存）
    this.setData({
      session: !!store.getViewContext(),
      readonly: !modeGuard.canRenderWriteButton(),
      partnerNo: this.partnerNoOf()
    });
    this.load(true);
  },

  // custom-tab-bar 每页一份实例：本页 onShow 显式同步选中格（客户=1）
  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) {
      tabBar.setData({ selected: 1 });
    }
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

  render(prevRows) {
    const plan = listModel.viewPlanOf(this.state, {
      partnerNo: this.data.partnerNo,
      readonly: this.data.readonly,
      session: this.data.session,
      prevRows: prevRows
    });
    this.setData(plan.setData);
    // 每个结果都作废旧分片追加：旧片不得落到新结构上
    const token = (this._chunkToken || 0) + 1;
    this._chunkToken = token;
    if (plan.chunk) {
      this.appendChunks(plan.appendPatches, token);
    }
  },

  // 首屏流式：首片已 setData，其余片按帧只发新片 rows[n]（不重发已渲染行）
  appendChunks(patches, token) {
    if (!patches || !patches.length) {
      return;
    }
    const step = (rest) => {
      if (this._chunkToken !== token || !rest.length) {
        return;
      }
      this.setData(rest[0]);
      if (rest.length > 1) {
        setTimeout(() => step(rest.slice(1)), CHUNK_DELAY_MS);
      }
    };
    setTimeout(() => step(patches), CHUNK_DELAY_MS);
  },

  // reset=true：首屏/下拉/搜索（整页替换）；false：触底追加（游标分页）
  // options.freshAvatars：头像加载失败点重试用——不沿用旧头像 URL，换服务端新签的 5 分钟 URL。
  load(reset, options) {
    const opts = options || {};
    const append = reset !== true;
    const query = append ? listModel.nextQuery(this.state) : listModel.refreshQuery(this.state);
    if (append && !query) {
      return Promise.resolve();
    }
    if (append && (this.state.loading || this.state.loadingMore)) {
      return Promise.resolve();
    }
    this.state = listModel.beginLoad(this.state, append);
    this.render(this.data.rows);
    return partnerApi.listBindings(query)
      .then((data) => {
        const prevRows = this.data.rows;
        const resultOpts = { nowMs: Date.now(), freshAvatars: opts.freshAvatars === true };
        this.state = append
          ? listModel.applyMoreResponse(this.state, data || {}, resultOpts)
          : listModel.applyResponse(this.state, data || {}, resultOpts);
        this.render(prevRows);
      })
      .catch((err) => {
        this.state = listModel.applyError(this.state, err && err.message);
        this.render(this.data.rows);
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
    this.render(this.data.rows);
    this.load(true);
  },

  onClearSearch() {
    this.clearSearchTimer();
    this.setData({ keyword: '' });
    this.state = listModel.applyKeyword(this.state, '');
    this.render(this.data.rows);
    this.load(true);
  },

  // D67：筛选选中态变化 → 纯件算新态 → 重置 cursor 走首屏加载（沿用 D54 骨架/分片/行级 diff）
  onFilterTap(event) {
    const key = (event.currentTarget.dataset && event.currentTarget.dataset.filter) || 'all';
    this.applyFilter(listModel.applyFilterChip(this.state, key));
  },

  onZoneTap(event) {
    const zone = (event.currentTarget.dataset && event.currentTarget.dataset.zone) || '';
    this.applyFilter(listModel.selectFilterZone(this.state, zone));
  },

  onBuildingTap(event) {
    const buildingNo = Number(event.currentTarget.dataset && event.currentTarget.dataset.buildingNo);
    this.applyFilter(listModel.selectFilterBuilding(this.state, buildingNo));
  },

  onClearFilters() {
    this.applyFilter(listModel.clearFilters(this.state));
  },

  // 选中态变了但请求参数没变（如刚点「按苑」还没选苑）时只更新 chips，不重拉、不闪骨架。
  applyFilter(next) {
    if (!next || next === this.state) {
      return;
    }
    const needsReload = listModel.querySignatureOf(this.state) !== listModel.querySignatureOf(next);
    this.state = next;
    this.render(this.data.rows);
    if (needsReload) {
      this.load(true);
    }
  },

  onRetry() {
    this.load(true);
  },

  // D42：头像临时 URL 过期/加载失败时点默认头像位重试——整页重拉一次（服务端重签 5 分钟 URL；
  // 批20-C：必须 freshAvatars，否则行级"沿用旧 URL"会把坏 URL 又用回去）
  onAvatarRetry() {
    this.load(true, { freshAvatars: true });
  },

  onDismissBanner() {
    this.state = listModel.dismissBanner(this.state);
    this.render();
  },

  onEmptyAction() {
    const kind = listModel.emptyActionKindOf(this.state);
    if (kind === 'clearFilter') {
      this.onClearFilters();
      return;
    }
    if (kind === 'clearSearch') {
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
