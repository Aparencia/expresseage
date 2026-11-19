// pages/partner/workbench/parts/handover.js · D81/D95「已转出」接线（常驻入口 + 点行进详情）
// 页面零业务判据：状态/时间/接手人全部来自服务端行 DTO；本件只做请求/转发。
// D95（2026-11-19 用户指令）：从页底折叠升级为常驻区块，首次 onShow 自动拉取一次（带计数），不再需要展开。
'use strict';

const orderApi = require('../../../../api/modules/order');
const handoverView = require('./handover-view');

// D85：已转出=发起者仍可控，点行直接进订单详情（不做只读跟踪浮层）

const PAGE_SIZE = 20;
const ERROR_TEXT = '已转出订单加载失败，请稍后重试';

module.exports = {
  // 常驻入口：未加载且不在加载中才请求（多次 onShow 不重复拉）
  ensureHandover() {
    const state = this.data.handover || handoverView.closedState();
    if (state.loaded || state.loading) {
      return Promise.resolve();
    }
    return this.loadHandover();
  },

  loadHandover() {
    this.setData({ 'handover.loading': true, 'handover.error': '' });
    return orderApi.listPartner({ view: 'handover', limit: PAGE_SIZE }).then((result) => {
      const rows = handoverView.rowsOf(result && result.list);
      this.setData({
        handover: { loaded: true, loading: false, rows: rows, error: '' }
      });
    }).catch(() => {
      this.setData({ 'handover.loading': false, 'handover.error': ERROR_TEXT });
    });
  },

  onHandoverTap(event) {
    const orderNo = event.currentTarget.dataset.orderNo;
    const rows = (this.data.handover && this.data.handover.rows) || [];
    const row = rows.filter((item) => item.orderNo === orderNo)[0];
    if (!row) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + encodeURIComponent(orderNo) });
  }
};
