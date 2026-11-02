// pages/partner/workbench/parts/transfer-flow.js · 工作台「待接收转派」接线（D58，页面方法）
// 口径：草案 §1.3 读路径（order.listPartner {view:'transfer'} 服务端过滤 + 顶层 transferPending）+
//       §1.4（目标兼职视图已遮蔽：无顾客昵称/头像/客户编号）。页面只做 请求→setData→跳转，
//       文案/剩余时间/排序/件数全部在 parts/transfer（纯件）。
// 计数纪律：N 只取「服务端下发的 transferPending」——主列表响应优先；万一主响应还没有该字段，
//           用待接收列表响应自带的 transferPending 兜底（同一服务端计数，客户端绝不按行数自行计数）。
// 边界：本区块只读；发起/确认接收/拒收/撤回都在订单详情页（凭 DTO transfer + actions[]）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const transferView = require('./transfer');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';

module.exports = {
  // 每次列表刷新调用：pending>0 才发一次 view='transfer' 请求（服务端过滤 PENDING，客户端零过滤）；
  // 旧响应按 token 丢弃，避免轮询竞态把旧数据落到新状态。
  applyTransfer(response) {
    const token = (this._transferToken || 0) + 1;
    this._transferToken = token;
    const known = transferView.pendingOf(response);
    if (known === 0) {
      this._transferRows = [];
      this._transferCount = 0;
      this.setData({ transfer: transferView.closedState() });
      return Promise.resolve();
    }
    // 主响应缺字段（known === null）时先按上次服务端计数占位，再拉待接收列表以响应自带计数收敛
    const cached = typeof this._transferCount === 'number' ? this._transferCount : 0;
    this.setData({ transfer: transferView.stateOf(known === null ? cached : known, this._transferRows || [], { loading: true }) });
    return orderApi.listPartner(transferView.query()).then((data) => {
      if (this._transferToken !== token) {
        return;
      }
      const fallback = transferView.pendingOf(data);
      const count = known === null ? (fallback === null ? 0 : fallback) : known;
      this._transferRows = transferView.rowsOf(data && data.list, Date.now());
      this._transferCount = count;
      this.setData({ transfer: transferView.stateOf(count, this._transferRows, {}) });
      // 红点同步既有 badges.workbenchPending：主响应未下发计数时用这里收敛到的服务端计数补一次
      this.syncBadge(this.data.counts, count);
    }).catch(() => {
      if (this._transferToken !== token) {
        return;
      }
      this.setData({ transfer: transferView.stateOf(known === null ? 0 : known, [], { loadFail: true }) });
    });
  },

  // 待接收行 → 订单详情（目标兼职视角：详情页按服务端 DTO 遮蔽，不自行补取顾客信息）
  onTransferRowTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const orderNo = String(dataset.orderNo || '');
    if (!orderNo) {
      return;
    }
    wx.navigateTo({ url: DETAIL_PAGE + orderNo });
  },

  // 区块内刷新：重拉待接收列表（计数仍以服务端响应为准，不在客户端 ++/--）
  onTransferRefreshTap() {
    this.applyTransfer({ transferPending: this.data.transfer.count });
  }
};
