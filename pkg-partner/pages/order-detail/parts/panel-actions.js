// pkg-partner/pages/order-detail/parts/panel-actions.js · 浮层开关与提交接线（补码/改站点、异常上报、送达、取消/拒单）
// 职责：把 WXML 浮层事件接成页面 setData + 统一写管道 this.submitWrite；判据/校验/文案在 correct-panel / exception-panel / delivery-panel / reason-panel 纯件。
// 边界：页面方法（与 index.js 合并为 Page 配置）；不判断状态机、不拼错误文案、不直连 api/modules 之外的层。
'use strict';

const orderApi = require('../../../../api/modules/order');
const correctPanel = require('./correct-panel');
const deliveryPanel = require('./delivery-panel');
const exceptionPanel = require('./exception-panel');
const reasonPanel = require('./reason-panel');

module.exports = {
  // ---------- 补码/改站点面板（v1.0 一单多包裹：逐件 itemIndex 纠正，订单级动作不变） ----------
  openCorrectPanel(itemIndex) {
    const panel = this.data.correctPanel || {};
    if (!panel.visible) {
      wx.showToast({ title: panel.blockedCopy || '当前状态不能改取件码', icon: 'none' });
      return;
    }
    const index = typeof itemIndex === 'number' && itemIndex >= 0 ? itemIndex : 0;
    this.setData({
      panel: 'correct',
      correctItemIndex: index,
      correctEditor: correctPanel.buildEditor(this.data.order, index),
      correctError: ''
    });
  },
  // 多包裹时逐件切换纠正目标（只换编辑对象，不提交）
  onCorrectItemTap(event) {
    this.openCorrectPanel(Number(event.currentTarget.dataset.index));
  },
  onCorrectInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ['correctEditor.' + field]: (event.detail && event.detail.value) || '', correctError: '' });
  },
  onStationChange(event) {
    const options = (this.data.correctPanel && this.data.correctPanel.stationOptions) || [];
    const hit = options[Number(event.detail.value)];
    if (hit) {
      this.setData({ 'correctEditor.stationId': hit.id, correctError: '' });
    }
  },
  onCorrectSave() {
    const itemIndex = this.data.correctItemIndex || 0;
    const checked = correctPanel.validateSave(this.data.correctEditor, this.data.order, itemIndex);
    if (!checked.ok) {
      this.setData({ correctError: checked.message });
      return;
    }
    const submit = correctPanel.buildSubmit(this.data.order, checked.patch, itemIndex);
    this.submitWrite(() => orderApi.correct(submit.data, submit.opts),
      correctPanel.savedCopy(this.data.correctPanel), 'correct');
  },

  // ---------- 异常上报/解除 ----------
  openExceptionPanel() {
    this.setData({ panel: 'exception', exceptionIndex: 0, exceptionNote: '', exceptionError: '' });
  },
  onExceptionReasonTap(event) {
    this.setData({ exceptionIndex: Number(event.currentTarget.dataset.index), exceptionError: '' });
  },
  onExceptionNoteInput(event) {
    this.setData({
      exceptionNote: ((event.detail && event.detail.value) || '').slice(0, exceptionPanel.NOTE_MAX),
      exceptionError: ''
    });
  },
  onExceptionSubmit() {
    const reason = (this.data.exceptionPanel.reasons || [])[this.data.exceptionIndex] || {};
    const checked = exceptionPanel.validateReport(reason.code, this.data.exceptionNote);
    if (!checked.ok) {
      this.setData({ exceptionError: checked.message });
      return;
    }
    const submit = exceptionPanel.buildReportSubmit(this.data.order, checked.payload);
    this.submitWrite(() => orderApi.reportException(submit.data, submit.opts),
      exceptionPanel.COPY.report, 'exception');
  },

  // ---------- 送达浮层（deliveryNote + guest 24h 自动完成文案） ----------
  openDeliveryPanel() {
    this.setData({ panel: 'deliver', deliveryNote: '', deliveryError: '' });
  },
  onDeliveryNoteInput(event) {
    this.setData({
      deliveryNote: ((event.detail && event.detail.value) || '').slice(0, deliveryPanel.NOTE_MAX),
      deliveryError: ''
    });
  },
  onQuickTag(event) {
    this.setData({ deliveryNote: event.currentTarget.dataset.tag || '', deliveryError: '' });
  },
  onDeliverySubmit() {
    const panel = this.data.deliveryPanel || {};
    wx.showModal({
      title: panel.title || '标记送达',
      content: panel.confirmText || '',
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const submit = deliveryPanel.buildSubmit(this.data.order, this.data.deliveryNote);
        this.submitWrite(() => orderApi.markDelivered(submit.data, submit.opts),
          deliveryPanel.COPY.success, 'delivery');
      }
    });
  },

  // ---------- 取消/拒单（原因枚举 + OTHER 必填；取消不可恢复） ----------
  openReasonPanel(key) {
    this.setData({
      panel: 'reason',
      cancelKey: key,
      reasonIndex: 0,
      reasonNote: '',
      reasonError: '',
      cancelPanel: reasonPanel.buildPanel(key)
    });
  },
  onReasonChange(event) {
    this.setData({ reasonIndex: Number(event.detail.value), reasonError: '' });
  },
  onReasonNoteInput(event) {
    this.setData({ reasonNote: ((event.detail && event.detail.value) || '').slice(0, reasonPanel.NOTE_MAX), reasonError: '' });
  },
  onReasonSubmit() {
    const reasons = (this.data.cancelPanel && this.data.cancelPanel.reasons) || [];
    const reason = reasons[this.data.reasonIndex] || {};
    const checked = reasonPanel.validate(reason.code, this.data.reasonNote);
    if (!checked.ok) {
      this.setData({ reasonError: checked.message });
      return;
    }
    const data = Object.assign({ orderNo: this.data.orderNo }, checked.data);
    const opts = { expectedVersion: this.data.order && this.data.order.version };
    const isReject = this.data.cancelKey === 'reject';
    this.submitWrite(() => (isReject ? orderApi.reject(data, opts) : orderApi.cancel(data, opts)),
      reasonPanel.successText(isReject), 'reason');
  }
};
