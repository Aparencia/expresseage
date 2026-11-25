// pages/partner/workbench/parts/deliver-photo.js · D97 送达现场照片（工作台单件/批量共用）
// 纪律：点「送达」= 先拍 1 张（一单一图），取消即中止；批量送达逐单快门（不允许整批共用一张）。
'use strict';

const orderApi = require('../../../../api/modules/order');
const proofPhoto = require('../../../../utils/proof-photo');
const rowActions = require('./row-actions');

function writeOf(row, values, batchActionId) {
  return rowActions.buildWrite('deliver', row, values, batchActionId);
}

module.exports = {
  // 单件送达：面板提交时调用（本方法挂在 Page 上，this=页面实例）
  captureAndDeliver(row, values) {
    this.setData({ 'panel.error': '' });
    proofPhoto.capture().then((photo) => {
      if (!photo) {
        this.setData({ 'panel.error': '送达需要拍一张现场照片，已取消' });
        return;
      }
      const write = writeOf(row, Object.assign({}, values, { photo: photo }), '');
      return orderApi[write.method](write.payload, write.opts)
        .then(() => this.afterWrite('deliver', row, values))
        .catch((err) => this.onWriteFail(err));
    }).catch((err) => this.onWriteFail(err));
  },

  // 批量送达：每单一次快门；用户取消后本批剩余单不再弹相机（如实计为未提交）
  deliverWithPhoto(row, batchActionId, values) {
    if (this._photoCancelled) {
      return Promise.reject(new Error('本批已取消拍照，剩余单未提交'));
    }
    return proofPhoto.capture().then((photo) => {
      if (!photo) {
        this._photoCancelled = true;
        throw new Error('送达需要拍一张现场照片，已取消');
      }
      const write = writeOf(row, Object.assign({}, values || {}, { photo: photo }), batchActionId);
      return orderApi[write.method](write.payload, write.opts);
    });
  },

  // D98：整单取件先问「拍照 / 跳过照片」，再走既有单次写
  pickThenWrite(key, row) {
    proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this.toastMsg('已取消取件');
        return;
      }
      this.executeSingle(key, row, choice.skipped ? {} : { photo: choice.photo });
    }).catch((err) => this.toastMsg((err && err.message) || '照片上传失败，请重试'));
  },

  // 确认框统一入口：送达/取件需要照片，其余动作直写
  runConfirmed(key, row) {
    if (key === 'deliver') {
      this.captureAndDeliver(row, {});
      return;
    }
    if (key === 'pick') {
      this.pickThenWrite(key, row);
      return;
    }
    this.executeSingle(key, row, {});
  }
};
