// pages/partner/workbench/parts/handover.js · D81「已转出」接线（折叠加载 + 点行开只读进度浮层）
// 页面零业务判据：状态/时间/接手人全部来自服务端行 DTO；本件只做请求/展开/浮层转发。
'use strict';

const orderApi = require('../../../../api/modules/order');
const handoverView = require('./handover-view');

const PAGE_SIZE = 20;
const ERROR_TEXT = '已转出订单加载失败，请稍后重试';

module.exports = {
  onHandoverToggle() {
    const state = this.data.handover || handoverView.closedState();
    if (state.expanded) {
      this.setData({ 'handover.expanded': false });
      return;
    }
    if (state.loaded) {
      this.setData({ 'handover.expanded': true });
      return;
    }
    this.loadHandover();
  },

  loadHandover() {
    this.setData({ 'handover.loading': true, 'handover.error': '' });
    return orderApi.listPartner({ view: 'handover', limit: PAGE_SIZE }).then((result) => {
      const rows = handoverView.rowsOf(result && result.list);
      this.setData({
        handover: { loaded: true, expanded: true, loading: false, rows: rows, error: '' }
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
    this.setData({ panel: handoverView.panelOf(row) });
  }
};
