// pkg-partner/pages/messages/index.js · 消息中心（订单事件 + 留言 + 公告聚合视图）
const messageApi = require('../../../api/modules/message');
const store = require('../../../store/index');
const messageView = require('./parts/message-view');

Page({
  data: {
    list: [],
    messageReadAt: 0,
    loading: true,
    loadingMore: false,
    error: '',
    nextCursor: null,
    unreadCount: 0
  },

  onShow() {
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return;
    }
    this.loadList(false);
  },

  loadList(reset) {
    const isReset = !!reset;
    this.setData({ loading: isReset, error: '' });
    const payload = {};
    if (!isReset && this.data.nextCursor) {
      payload.cursor = this.data.nextCursor;
    }
    return messageApi
      .list(payload)
      .then((data) => {
        const view = messageView.buildMessages(data && data.list);
        const list = isReset ? view : this.data.list.concat(view);
        const unreadCount = messageView.countUnread(list);
        const readAt = data && typeof data.messageReadAt === 'number' ? data.messageReadAt : this.data.messageReadAt;
        this.setData({
          list: list,
          nextCursor: (data && data.nextCursor) || null,
          messageReadAt: readAt,
          unreadCount: unreadCount,
          loading: false,
          loadingMore: false
        });
        this.syncBadge();
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '消息没加载出来，检查网络后重试' });
      });
  },

  syncBadge() {
    const badges = Object.assign({}, store.get('badges') || {});
    if (badges.messages !== this.data.unreadCount) {
      badges.messages = this.data.unreadCount;
      store.set('badges', badges);
    }
  },

  onMarkAllRead() {
    messageApi
      .markRead({ scope: 'ALL' })
      .then((data) => {
        const readAt = (data && data.messageReadAt) || Date.now();
        const list = this.data.list.map((item) => Object.assign({}, item, { unread: false }));
        this.setData({ list: list, unreadCount: 0, messageReadAt: readAt });
        this.syncBadge();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '标记失败，请稍后重试', icon: 'none' });
      });
  },

  onItemTap(event) {
    const index = event.currentTarget.dataset.index;
    const item = this.data.list[index];
    if (!item) {
      return;
    }
    if (item.orderNo) {
      wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + item.orderNo });
      return;
    }
    if (item.unread) {
      this.setData({ list: this.data.list.map((row) => Object.assign({}, row, { unread: false })) });
      this.syncBadge();
    }
  }
});
