// pkg-partner/pages/messages/index.js · 消息中心（message.list 聚合：状态事件+留言+公告；已读水位 users.messageReadAt）
// 口径：UX_PARTNER §3.9（全部/订单/留言/公告分类、未读圆点、全部已读、下拉刷新+30s 轮询、READONLY 置灰）。
// 红点（D29）：未读留言+未读状态事件；工作台 tab 红点=待接单数量，两者不合并。
'use strict';

const messageApi = require('../../../api/modules/message');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const route = require('../../../config/route');
const view = require('./parts/message-view');
const share = require('../../../utils/share/handlers');

const PAGE_SIZE = 30;
const POLL_MS = 30000;

Page({
  data: {
    filters: view.filtersWithCounts([]),
    filter: 'all',
    list: [],
    loading: true,
    loadingMore: false,
    error: '',
    emptyText: view.EMPTY_TEXT,
    nextCursor: null,
    unreadCount: 0,
    readonly: false
  },

  onLoad() {
    this._items = [];
    this._serverUnread = 0;
    this._poller = null;
  },

  onShow() {
    this.guard();
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.loadList(true);
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  onPullDownRefresh() {
    this.loadList(true).then(function done() { wx.stopPullDownRefresh(); });
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.nextCursor) {
      return;
    }
    this.loadList(false);
  },

  // 身份闸：切换会话按目标角色、普通登录按 activeRole；不匹配回各自首页
  guard() {
    const snapshot = store.snapshot();
    const session = snapshot.viewContext;
    if (session && session.role) {
      if (session.role !== 'PARTNER') {
        wx.reLaunch({ url: route.CUSTOMER_HOME });
      }
      return;
    }
    if (snapshot.activeRole !== 'PARTNER') {
      wx.reLaunch({ url: route.ROLE_PAGE });
    }
  },

  // 30s 轮询（页面可见时）：只刷新首屏；已翻到第二页以后不打断分页，等下拉刷新
  startPolling() {
    this.stopPolling();
    this._poller = setInterval(() => this.poll(), POLL_MS);
  },

  stopPolling() {
    if (this._poller) {
      clearInterval(this._poller);
      this._poller = null;
    }
  },

  poll() {
    if (this.data.loading || this.data.loadingMore || this.data.error) {
      return;
    }
    if (this._items.length > PAGE_SIZE) {
      return;
    }
    this.loadList(true, { silent: true });
  },

  loadList(reset, options) {
    const isReset = !!reset;
    const silent = !!(options && options.silent);
    if (!silent) {
      this.setData({ loading: isReset, error: isReset ? '' : this.data.error });
    }
    const payload = {};
    if (!isReset && this.data.nextCursor) {
      payload.cursor = this.data.nextCursor;
    }
    return messageApi
      .list(payload)
      .then((data) => {
        const page = view.buildMessages(data && data.list);
        this._items = isReset ? page : view.mergeMessages(this._items, page);
        this._serverUnread = this.serverUnreadOf(data, this._items);
        this.setData({
          loading: false,
          loadingMore: false,
          nextCursor: (data && data.nextCursor) || null
        });
        this.applyDerived();
      })
      .catch((err) => {
        if (silent) {
          return;
        }
        this.setData({
          loading: false,
          loadingMore: false,
          error: (err && err.message) || '消息没加载出来，检查网络后重试'
        });
      });
  },

  // 红点单源（D29）：服务端 unread（未读留言+未读状态事件）优先；无该字段才回落本地新口径计数
  serverUnreadOf(data, items) {
    return view.serverUnreadOf(data, items);
  },

  applyDerived() {
    const filter = this.data.filter;
    this.setData({
      list: view.applyFilter(this._items, filter),
      filters: view.filtersWithCounts(this._items),
      emptyText: view.emptyTextOf(filter),
      unreadCount: this._serverUnread
    });
    this.syncBadge(this._serverUnread);
  },

  // 红点单源：只改 badges.messages，保留 workbenchPending 等其他键（不互相覆盖）
  syncBadge(count) {
    const current = store.get('badges') || {};
    if (current.messages === count) {
      return;
    }
    store.patch({ badges: view.badgePatchOf(current, count) });
  },

  onFilterTap(event) {
    const key = event.currentTarget.dataset.filter;
    if (!key || key === this.data.filter) {
      return;
    }
    this.setData({ filter: view.filterKeyOf(key) });
    this.applyDerived();
  },

  onMarkAllRead() {
    if (this.data.readonly) {
      wx.showToast({ title: view.READONLY_COPY, icon: 'none' });
      return;
    }
    return messageApi.markRead({ scope: 'ALL' }).then(() => {
      this._items = view.applyAllRead(this._items);
      this._serverUnread = 0;
      this.applyDerived();
      wx.showToast({ title: '已标为已读', icon: 'none' });
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || '标记失败，请下拉刷新后重试', icon: 'none' });
    });
  },

  // 单订单已读：订单内条目置读 + 状态事件按水位；红点按「服务端未读数 − 本单未读留言+状态事件」收敛
  // （不为负；服务端 markRead 前进全局水位，跨单事件一并清零属 D29 水位语义）
  markOrderRead(orderNo) {
    if (this.data.readonly) {
      return Promise.resolve(false);
    }
    const target = this._items.filter((item) => item.orderNo === orderNo);
    const before = view.unreadBadgeCount(target);
    return messageApi.markRead({ scope: 'ORDER', orderNo: orderNo }).then((data) => {
      this._items = view.applyOrderRead(this._items, orderNo, data && data.messageReadAt);
      this._serverUnread = Math.max(0, this._serverUnread - before);
      this.applyDerived();
      return true;
    }).catch(() => false);
  },

  onItemTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item) {
      return;
    }
    if (item.orderNo) {
      if (item.unread) {
        this.markOrderRead(item.orderNo);
      }
      wx.navigateTo({ url: item.route });
      return;
    }
    if (item.unread) {
      // 无单条已读接口（markRead 仅 ALL/ORDER）：系统通知按全部已读处理
      this.onMarkAllRead();
    }
  },

  onRetry() {
    this.loadList(true);
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
