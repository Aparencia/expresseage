// pkg-customer/pages/messages/index.js · 消息中心（服务端聚合视图：状态事件+留言+公告；分页 30）
// 口径：CONTRACT §5.3 message.list/markRead；UX_CUSTOMER §3.9/§8.2/§8.3（进入即上报已读水位、
// 公告置顶且会话内可关闭、下拉刷新、分页 30、空态/错误态、READONLY 置灰不写）。
'use strict';

const store = require('../../../store/index');
const messageApi = require('../../../api/modules/message');
const modeGuard = require('../../../api/mode-guard');
const route = require('../../../config/route');
const view = require('./parts/message-view');
const share = require('../../../utils/share/handlers');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const PAGE_SIZE = 30;
const DEFAULT_BADGES = { workbenchPending: 0, messages: 0 };

Page({
  data: {
    list: [],
    announcement: null,
    announcementClosed: false,
    cursor: null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: '',
    readError: '',
    readonly: false,
    emptyText: view.EMPTY_TEXT
  },

  onLoad() {
    // 会话态：公告关闭只记在本页内存（不写本地存储，不持久化任何敏感值）
    this._closedKey = '';
  },

  onShow() {
    this.guard();
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.refresh();
  },

  // 身份闸：切换会话按目标角色、普通登录按 activeRole；不匹配回各自首页（UX_CUSTOMER §3.9 无权限态）
  guard() {
    const snapshot = store.snapshot();
    const session = snapshot.viewContext;
    if (session && session.role) {
      if (session.role !== 'CUSTOMER') {
        wx.reLaunch({ url: route.PARTNER_WORKBENCH });
      }
      return;
    }
    if (snapshot.activeRole !== 'CUSTOMER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
    }
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  onReachBottom() {
    this.loadMore();
  },

  refresh() {
    this.setData({ loading: true, error: '', readError: '' });
    return messageApi.list({ limit: PAGE_SIZE }).then((data) => {
      this.setData({ loading: false });
      this.applyFirstPage(data);
      return this.reportRead();
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '消息没加载出来，检查网络后重试' });
      return false;
    });
  },

  applyFirstPage(data) {
    const config = store.snapshot().config || {};
    const pinned = view.pinAnnouncement(data && data.list, config.announcement);
    const key = pinned.announcement ? pinned.announcement.id : '';
    this.setData({
      list: pinned.items,
      announcement: pinned.announcement,
      announcementClosed: !!key && this._closedKey === key,
      cursor: (data && data.nextCursor) || null,
      hasMore: !!(data && data.nextCursor)
    });
  },

  // 进入/下拉即上报已读水位（scope=ALL）；READONLY 不写（置灰），失败留存真话不吞
  reportRead() {
    if (this.data.readonly) {
      return Promise.resolve(false);
    }
    return messageApi.markRead({ scope: 'ALL' }).then((data) => {
      this.setData({ list: view.applyReadWatermark(this.data.list, data && data.messageReadAt) });
      this.clearBadge();
      return true;
    }).catch((err) => {
      this.setData({ readError: (err && err.message) || '已读状态没同步上，下拉刷新后重试' });
      return false;
    });
  },

  // 全部已读后红点归零（E13 / UX §8.2）：badges.messages 是首页铃铛/我的入口的唯一来源
  clearBadge() {
    const badges = store.snapshot().badges || DEFAULT_BADGES;
    if (!badges.messages) {
      return;
    }
    store.patch({ badges: view.badgePatchOf(badges) });
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || !this.data.cursor) {
      return;
    }
    this.setData({ loadingMore: true, error: '' });
    messageApi.list({ limit: PAGE_SIZE, cursor: this.data.cursor }).then((data) => {
      const page = view.buildItems(data && data.list).filter(function noAnnouncement(item) {
        return item.type !== 'ANNOUNCEMENT';
      });
      this.setData({
        loadingMore: false,
        list: view.mergePage(this.data.list, page),
        cursor: (data && data.nextCursor) || null,
        hasMore: !!(data && data.nextCursor)
      });
    }).catch((err) => {
      this.setData({ loadingMore: false, error: (err && err.message) || '下一批消息没加载出来，检查网络后重试' });
    });
  },

  onLoadMoreTap() {
    this.loadMore();
  },

  onRetry() {
    this.refresh();
  },

  onAllRead() {
    if (this.data.readonly) {
      wx.showToast({ title: view.READONLY_COPY, icon: 'none' });
      return;
    }
    this.reportRead().then((ok) => {
      wx.showToast({
        title: ok ? '已标为已读' : (this.data.readError || '标记失败，请下拉刷新后重试'),
        icon: 'none'
      });
    });
  },

  onCloseAnnouncement() {
    const announcement = this.data.announcement;
    this._closedKey = announcement ? announcement.id : '';
    this.setData({ announcementClosed: true });
  },

  onItemTap(e) {
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const orderNo = dataset.orderNo || '';
    if (!orderNo) {
      wx.showToast({ title: '这条消息没有关联订单', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
