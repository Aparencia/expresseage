// pages/partner/workbench/parts/transfer-flow.js · 工作台「待接收转派」接线（D58，页面方法）
// 口径：草案 §1.3 读路径（order.listPartner {view:'transfer'} 服务端过滤 + 顶层 transferPending）+
//       §1.4（目标兼职视图已遮蔽：无顾客昵称/头像/客户编号）。页面只做 请求→setData→跳转，
//       文案/剩余时间/行字段/行顺序全部在 parts/transfer（纯件）。
// 计数纪律：N 只取「服务端下发的 transferPending」——主列表响应优先；万一主响应还没有该字段，
//           用待接收列表响应自带的 transferPending 兜底（同一服务端计数，客户端绝不按行数自行计数）。
// P2-3：两处都缺字段 = 未知（不是 0）——保留上次服务端计数；一次都没有过则显示不可用态，绝不写 0。
// 红点纪律（P1-3）：待接收数不计入 tabBar 待接单红点（红点只取 counts.submitted），区块标题角标单独承载。
// 边界：本区块只读；发起/确认接收/拒收/撤回都在订单详情页（凭 DTO transfer + actions[]）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const transferView = require('./transfer');

const DETAIL_PAGE = '/pkg-partner/pages/order-detail/index?orderNo=';

// 上次已知计数：只有 number 才算「已知」，null/undefined 一律未知（不把未知当 0 用）
function cachedCountOf(page) {
  return typeof page._transferCount === 'number' ? page._transferCount : null;
}

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
    // 主响应缺字段（known === null）= 未知：有上次服务端计数就先保留，否则给加载/不可用占位（不写 0）
    const cached = cachedCountOf(this);
    this.setData({
      transfer: transferView.stateOf(known === null ? cached : known, this._transferRows || [], { loading: true })
    });
    return orderApi.listPartner(transferView.query()).then((data) => {
      if (this._transferToken !== token) {
        return;
      }
      const fallback = transferView.pendingOf(data);
      // 两处都缺 → 先保留上次服务端计数，从来没有过则保持 null（未知态），绝不落 0
      const count = known !== null ? known : (fallback !== null ? fallback : cachedCountOf(this));
      this._transferRows = transferView.rowsOf(data && data.list, Date.now());
      this._transferCount = count;
      this.setData({ transfer: transferView.stateOf(count, this._transferRows, {}) });
    }).catch(() => {
      if (this._transferToken !== token) {
        return;
      }
      // 失败：仍保留上次计数/未知态，只把区块提示换成可重试的下一步（红点不因此清零）
      const count = known !== null ? known : cachedCountOf(this);
      this.setData({ transfer: transferView.stateOf(count, [], { loadFail: true }) });
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

  // 区块内刷新：重拉待接收列表（计数仍以服务端响应为准，不在客户端 ++/--）；
  // 当前计数未知时传空响应（不伪造 0），由服务端列表响应重新收敛。
  onTransferRefreshTap() {
    const count = this.data.transfer && this.data.transfer.count;
    this.applyTransfer(typeof count === 'number' ? { transferPending: count } : {});
  }
};
