// pages/partner/pick-list/parts/deliver-actions.js · 待送达阶段「已送达」接线（D97/D102 现场照片）
// 职责：单件/批量送达先问「拍照 / 跳过照片」（D102 照片可选）；批量逐单询问，跳过不阻断。
// 边界：页面方法（与 index.js 合并为 Page 配置）；判据/文案/重试计划仍在 view / batch-view。
'use strict';

const orderApi = require('../../../../api/modules/order');
const client = require('../../../../api/client');
const batchView = require('../../../../pages/partner/workbench/parts/batch-view');
const rowActions = require('../../../../pages/partner/workbench/parts/row-actions');
const proofPhoto = require('../../../../utils/proof-photo');
const view = require('./view-model');

const READONLY_COPY = '开发者只读视角不能操作';
const PHOTO_CANCEL_TEXT = '已取消送达';

module.exports = {
  deliverOne(order) {
    if (this._unloaded) {
      return Promise.resolve();
    }
    return proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this.toastMsg(PHOTO_CANCEL_TEXT);
        return null;
      }
      const photo = choice.skipped ? null : choice.photo;
      const write = rowActions.buildWrite('deliver', order, { photo: photo }, '');
      return orderApi[write.method](write.payload, write.opts).then(() => {
        if (!this._unloaded) {
          this.toastMsg('已标记送达');
          this.refresh();
        }
      });
    }).catch((err) => {
      if (!this._unloaded) {
        this.toastMsg((err && err.message) || '标记失败，请刷新后重试');
        this.refresh();
      }
    });
  },

  onBatchDeliver() {
    if (this.data.batchRunning || this.data.readonly) {
      if (this.data.readonly) {
        this.toastMsg(READONLY_COPY);
      }
      return;
    }
    const orders = view.selectedRows(this.data.groups)
      .map((row) => this.orderOf(row.orderNo))
      .filter((order) => !!order);
    const plan = batchView.plan('deliver', orders);
    if (!plan.ok) {
      this.toastMsg(plan.message);
      return;
    }
    wx.showModal({
      title: '批量送达',
      content: this.writeHint(plan.confirmText),
      confirmText: '确认',
      success: (res) => {
        if (res.confirm && !this._unloaded) {
          this.runBatch(plan);
        }
      }
    });
  },

  runBatch(plan) {
    if (this._unloaded) {
      return Promise.resolve();
    }
    const running = Object.assign({}, plan, { batchActionId: plan.batchActionId || client.createRequestId() });
    this._lastBatch = running;
    this._photoCancelled = false;
    this.setData({ batchRunning: true });
    return batchView.run(running, (row, batchActionId) => this.deliverOneInBatch(row, batchActionId))
      .then((result) => this.finishBatch(running, result))
      .catch((err) => this.batchFailed(err));
  },

  // 逐单询问：本批取消（null）后不再弹窗（如实计为未提交）；跳过继续下一单
  deliverOneInBatch(row, batchActionId) {
    if (this._photoCancelled) {
      return Promise.reject(new Error('本批已取消照片选择，剩余单未提交'));
    }
    return proofPhoto.captureOptional().then((choice) => {
      if (!choice) {
        this._photoCancelled = true;
        throw new Error(PHOTO_CANCEL_TEXT);
      }
      const photo = choice.skipped ? null : choice.photo;
      const write = rowActions.buildWrite('deliver', view.writeRowOf(row), { photo: photo }, batchActionId);
      return orderApi[write.method](write.payload, write.opts);
    });
  },

  finishBatch(running, result) {
    if (this._unloaded) {
      return;
    }
    const summary = batchView.summary(running, result.results);
    this.applyBatchResult(summary);
    wx.showModal({
      title: summary.allOk ? '批量送达完成' : '批量送达有失败',
      content: this.writeHint(summary.text),
      showCancel: !summary.allOk,
      confirmText: summary.allOk ? '知道了' : '重试失败单',
      cancelText: '稍后处理',
      success: (res) => {
        if (this._unloaded) {
          return;
        }
        if (res.confirm && !summary.allOk) {
          this.onBatchRetry();
          return;
        }
        // 「稍后处理」不刷新：保留行/勾选/失败态，底部「N 单失败 · 重试失败单」继续可点（P1-8）
        if (summary.allOk || res.confirm) {
          this.refresh();
        }
      }
    });
  },

  batchFailed(err) {
    if (this._unloaded) {
      return;
    }
    this.setData({ batchRunning: false });
    this.toastMsg((err && err.message) || '批量送达没完成，请刷新后重试');
    this.refresh();
  }
};
