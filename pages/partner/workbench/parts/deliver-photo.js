// pages/partner/workbench/parts/deliver-photo.js · D97/D102 送达现场照片（工作台单件/批量共用）
// 纪律：点「送达」先问「拍照 / 跳过照片」（D102 照片可选）；取消即中止；批量送达逐单询问，跳过不阻断。
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
    proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this.setData({ 'panel.error': '已取消送达' });
        return;
      }
      const photo = choice.skipped ? null : choice.photo;
      const write = writeOf(row, Object.assign({}, values, { photo: photo }), '');
      return orderApi[write.method](write.payload, write.opts)
        .then(() => this.afterWrite('deliver', row, values))
        .catch((err) => this.onWriteFail(err));
    }).catch((err) => this.onWriteFail(err));
  },

  // 批量送达：每单先问「拍照 / 跳过」；用户取消（null）后本批剩余单不再弹窗（如实计为未提交）
  deliverWithPhoto(row, batchActionId, values) {
    if (this._photoCancelled) {
      return Promise.reject(new Error('本批已取消照片选择，剩余单未提交'));
    }
    return proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this._photoCancelled = true;
        throw new Error('已取消送达');
      }
      const photo = choice.skipped ? null : choice.photo;
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

  // 确认框统一入口：送达/取件先问照片（可选），其余动作直写
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
