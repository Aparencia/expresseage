// pkg-customer/pages/messages/index.js · 消息中心（服务端聚合视图；分页 30）
'use strict';

const store = require('../../../store/index');
const messageApi = require('../../../api/modules/message');
const format = require('../../parts/format');

const DETAIL_PAGE = '/pkg-customer/pages/order-detail/index';
const PAGE_SIZE = 30;

function mapItem(item) {
  const row = item || {};
  const at = row.at || row.createdAt || '';
  const text = row.text || '';
  return {
    // message.list 聚合项：{type,title,text,orderNo,at,read}（服务端已剔除 _id）
    id: row.id || row.messageId || (row.type || 'ORDER') + '@' + at + '@' + text.slice(0, 8),
    type: row.type || 'MESSAGE',
    title: row.title || (row.type === 'ANNOUNCEMENT' ? '公告' : '订单动态'),
    text: text,
    orderNo: row.orderNo || '',
    unread: row.read === false,
    time: format.formatTimeAgo(at)
  };
}

Page({
  data: {
    list: [],
    cursor: null,
    hasMore: true,
    loading: true,
    error: '',
    announcement: ''
  },

  onLoad() {
    const config = store.snapshot().config || {};
    this.setData({ announcement: format.announcementText(config.announcement) });
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(function done() { wx.stopPullDownRefresh(); });
  },

  onReachBottom() {
    this.loadMore();
  },

  refresh() {
    this.setData({ loading: true, error: '' });
    return messageApi.list({ limit: PAGE_SIZE }).then((data) => {
      const list = ((data && data.list) || []).map(mapItem);
      this.setData({
        loading: false,
        list: list,
        cursor: (data && data.nextCursor) || null,
        hasMore: !!(data && data.nextCursor)
      });
      this.markRead();
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '网络开小差了，请下拉重试' });
    });
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore || !this.data.cursor) return;
    this.setData({ loading: true });
    messageApi.list({ limit: PAGE_SIZE, cursor: this.data.cursor }).then((data) => {
      const page = ((data && data.list) || []).map(mapItem);
      this.setData({
        loading: false,
        list: this.data.list.concat(page),
        cursor: (data && data.nextCursor) || null,
        hasMore: !!(data && data.nextCursor)
      });
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '加载失败，请重试' });
    });
  },

  markRead() {
    return messageApi.markRead({ scope: 'ALL' }).then((data) => {
      if (data && data.messageReadAt) store.patch({ messageReadAt: data.messageReadAt });
      this.markAllReadLocally();
      this.clearBadge();
      return true;
    }).catch(function ignore() {
      // 水位上报失败不影响浏览，下次进入会再次上报
      return false;
    });
  },

  // 全部已读后红点归零（E13 / UX §8.2）：badges.messages 是首页铃铛红点的唯一来源
  clearBadge() {
    const snapshot = store.snapshot();
    const badges = snapshot.badges || {};
    if (!badges.messages) return;
    store.patch({ badges: Object.assign({ workbenchPending: 0 }, badges, { messages: 0 }) });
  },

  markAllReadLocally() {
    const list = this.data.list.map(function mark(item) {
      return Object.assign({}, item, { unread: false });
    });
    this.setData({ list: list });
  },

  onItemTap(e) {
    const orderNo = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.orderNo) || '';
    if (!orderNo) {
      wx.showToast({ title: '这是一条公告，没有关联订单', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: DETAIL_PAGE + '?orderNo=' + encodeURIComponent(orderNo) });
  },

  onRetry() {
    this.refresh();
  },

  onAllRead() {
    this.markRead().then((ok) => {
      wx.showToast({ title: ok ? '已标为已读' : '标记失败，请稍后重试', icon: 'none' });
    });
  }
});
