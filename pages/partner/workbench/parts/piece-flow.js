// pages/partner/workbench/parts/piece-flow.js · 工作台件级取件接线（D61；D98 可选现场照片）
// 口径：CONTRACT §5/§5.1（D61 逐件取件/撤销带 `itemIndex`；**免二次确认**、**无 5 秒撤销条**）、
//       D98（点「已取件」先问「拍照 / 跳过照片」，跳过不阻断）。
// 边界：页面只做事件→请求→toast/重拉；动作可见性/请求形状/文案在 parts/piece-actions（纯件）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const client = require('../../../../api/client');
const proofPhoto = require('../../../../utils/proof-photo');
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
    const key = String(dataset.key || '');
    if (key === 'markPicked') {
      this.capturePiecePick(key, hit, orderNo);
      return;
    }
    this.writePiece(key, hit, orderNo, null);
  },

  // D98：逐件取件先给「拍照 / 跳过照片」二选一；取消则中止本次动作
  capturePiecePick(key, hit, orderNo) {
    this._pieceBusy = true;
    proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this._pieceBusy = false;
        this.toastMsg('已取消取件');
        return;
      }
      this.writePiece(key, hit, orderNo, choice.skipped ? null : choice.photo);
    }).catch((err) => {
      this._pieceBusy = false;
      this.toastMsg((err && err.message) || '照片上传失败，请重试');
    });
  },

  writePiece(key, hit, orderNo, photo) {
    const write = pieceActions.writeOf(key, hit.piece, orderNo, hit.row.version,
      client.createRequestId(), photo);
    if (!write) {
      this._pieceBusy = false;
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
