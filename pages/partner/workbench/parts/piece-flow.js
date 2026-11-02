// pages/partner/workbench/parts/piece-flow.js · 工作台件级取件接线（D61，页面方法）
// 口径：CONTRACT §5/§5.1（D61：逐件取件/撤销带 `itemIndex`；**免二次确认**、**无 5 秒撤销条**，用该件「撤销已取」回退）、
//       UX_PARTNER §4.3/§4.16（每件行尾独立按钮，只消费服务端 `parcel.actions`）。
// 边界：页面只做事件→请求→toast/重拉；动作可见性/请求形状/文案在 parts/piece-actions（纯件）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const client = require('../../../../api/client');
const groupView = require('./group-view');
const pieceActions = require('./piece-actions');
const actionFlow = require('./action-flow');

module.exports = {
  // 件行按钮：已取件 / 撤销已取（逐件、免确认；写请求带 itemIndex + clientRequestId + expectedVersion）
  onPieceAction(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const orderNo = String(dataset.orderNo || '');
    const itemIndex = Number(dataset.itemIndex);
    if (this.data.readonly) {
      this.toastMsg(actionFlow.READONLY_COPY);
      return;
    }
    if (this._pieceBusy) {
      return;
    }
    const hit = groupView.findPiece(this.data.groups, orderNo, isFinite(itemIndex) ? itemIndex : 0);
    if (!hit) {
      this.toastMsg('订单已不在当前列表，刷新后再看');
      return;
    }
    const write = pieceActions.writeOf(String(dataset.key || ''), hit.piece, orderNo, hit.row.version,
      client.createRequestId());
    if (!write) {
      return;
    }
    this._pieceBusy = true;
    orderApi[write.method](write.payload, write.opts).then(() => {
      this._pieceBusy = false;
      this.toastMsg(this.writeHint(pieceActions.toastOf(write.key, hit.piece)));
      this.load({ poll: true });
    }).catch((err) => {
      this._pieceBusy = false;
      this.toastMsg((err && err.message) || '操作没成功，请刷新后重试');
      this.load({ poll: true });
    });
  },

  // 件行取件码点击复制（L3 只在原位出现，不拼进 URL/日志）
  onCopyPieceCode(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const code = String(dataset.code || '');
    if (!code) {
      this.toastMsg('这件还没有取件码，可先用「补码」补上');
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => this.toastMsg('取件码已复制'),
      fail: () => this.toastMsg('复制没成功，请重试')
    });
  }
};
