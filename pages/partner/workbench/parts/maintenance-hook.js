// pages/partner/workbench/parts/maintenance-hook.js · 维护模式挂钩（页面方法；判据在 utils/maintenance 纯件）
// 口径：UX_DEVELOPER §7.5（全屏公告 + 写接口拒绝 INVALID_STATE，读与切换会话不受影响）；
// 职责：只做 store/configPublic 读取、setData 接线与错误文案映射，不改工作台业务动作。
'use strict';

const store = require('../../../../store/index');
const configApi = require('../../../../api/modules/config');
const maintenance = require('../../../../utils/maintenance');

const CONFIG_TTL_MS = 60 * 1000;

module.exports = {
  // configPublic.maintenance → 全屏遮罩；会话内可 ack 关闭，文案变化后重新出现
  syncMaintenance() {
    const view = maintenance.buildMaintenanceView(store.get('config'));
    this._maintenanceView = view;
    const closed = view.enabled && this._maintenanceClosed === view.text;
    const next = { visible: view.enabled && !closed, title: view.title, text: view.text };
    const current = this.data.maintenance || {};
    if (current.visible === next.visible && current.title === next.title && current.text === next.text) {
      return;
    }
    this.setData({ maintenance: next });
  },

  // 维护/公告 60s 内在 onShow 生效（UX_DEVELOPER §7.4）；失败下次再试，不阻断工作台
  refreshConfig() {
    const config = store.get('config');
    const now = Date.now();
    if (config && this._configFetchedAt && now - this._configFetchedAt < CONFIG_TTL_MS) {
      return;
    }
    this._configFetchedAt = now;
    configApi.getPublic().then(function apply(cfg) {
      if (cfg) store.patch({ config: cfg });
    }).catch(() => {
      this._configFetchedAt = 0;
    });
  },

  onMaintenanceAck() {
    const view = this._maintenanceView;
    this._maintenanceClosed = view ? view.text : '';
    this.setData({ 'maintenance.visible': false });
  },

  // 维护错误 → {text, view}；非维护错误返回 null（调用方回落原错误文案，不吞错）
  maintenanceFallbackOf(err) {
    const text = maintenance.writeRejectedTextOf(err);
    if (!text) {
      return null;
    }
    return { text: text, view: maintenance.buildMaintenanceView({ maintenance: { enabled: true, text: '' } }) };
  }
};
