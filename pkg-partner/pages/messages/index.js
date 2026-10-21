// pkg-partner/pages/messages/index.js · 消息中心（message.list 聚合：状态事件 + 留言 + 公告；已读水位 users.messageReadAt）
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
        // 服务端 unreadMessages 覆盖全部消息（不止本页）；首屏优先用它，追加页沿用本地累计
        const serverUnread = data && typeof data.unreadMessages === 'number' ? data.unreadMessages : null;
        const unreadCount = isReset && serverUnread !== null ? serverUnread : messageView.countUnread(list);
        this.setData({
          list: list,
          nextCursor: (data && data.nextCursor) || null,
          messageReadAt: messageView.readAtMs(data && data.messageReadAt) || this.data.messageReadAt,
          unreadCount: unreadCount,
          loading: false,
          loadingMore: false
        });
        this.syncBadge(unreadCount);
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '消息没加载出来，检查网络后重试' });
      });
  },

  syncBadge(unreadCount) {
    const count = typeof unreadCount === 'number' ? unreadCount : this.data.unreadCount;
    const badges = Object.assign({}, store.get('badges') || {});
    if (badges.messages !== count) {
      badges.messages = count;
      store.set('badges', badges);
    }
  },

  applyAllRead() {
    const list = this.data.list.map((item) => Object.assign({}, item, { unread: false }));
    this.setData({ list: list, unreadCount: 0 });
    this.syncBadge(0);
  },

  onMarkAllRead() {
    messageApi
      .markRead({ scope: 'ALL' })
      .then((data) => {
        const readAt = messageView.readAtMs(data && data.messageReadAt);
        if (readAt) {
          this.setData({ messageReadAt: readAt });
        }
        this.applyAllRead();
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '标记失败，请重试', icon: 'none' });
      });
  },

  markOrderRead(orderNo) {
    return messageApi
      .markRead({ scope: 'ORDER', orderNo: orderNo })
      .then((data) => {
        const readAt = messageView.readAtMs(data && data.messageReadAt);
        const list = this.data.list.map((item) => {
          if (item.orderNo !== orderNo) {
            return item;
          }
          return Object.assign({}, item, { unread: false });
        });
        const unreadCount = messageView.countUnread(list);
        this.setData({
          list: list,
          unreadCount: unreadCount,
          messageReadAt: readAt || this.data.messageReadAt
        });
        this.syncBadge(unreadCount);
      })
      .catch(() => {
        // 已读水位失败不阻断查看订单；下次进页面会重新对齐
      });
  },

  onItemTap(event) {
    const index = event.currentTarget.dataset.index;
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
      this.onMarkAllRead();
    }
  }
});
