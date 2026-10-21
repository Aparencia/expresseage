// pkg-partner/pages/service-settings/index.js · 服务类型与范围（启用/停用 + 苑级范围 + 接单开关；不含费用字段）
const partnerApi = require('../../../api/modules/partner');
const configApi = require('../../../api/modules/config');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');

const CUSTOM_SERVICE = 'CUSTOM';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

Page({
  data: {
    first: false,
    loading: true,
    saving: false,
    readonly: false,
    acceptingOrders: false,
    services: [],
    zones: [],
    errorText: ''
  },

  onLoad(options) {
    this.setData({ first: (options && options.first) === '1' });
    this.load();
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
  },

  load() {
    this.setData({ loading: true, errorText: '' });
    Promise.all([configApi.getPublic(), Promise.resolve(store.get('partner') || {})])
      .then((results) => {
        const config = results[0] || {};
        const partner = results[1];
        const current = partner.serviceConfig || {};
        const enabledMap = {};
        arr(current.services).forEach((item) => {
          if (item && item.code) {
            enabledMap[item.code] = item.enabled === true;
          }
        });
        const services = arr(config.serviceCatalog).map((item) => ({
          code: item.code,
          name: item.name,
          desc: item.desc || '',
          enabled: enabledMap[item.code] === true
        }));
        const zoneLabels = config.zoneLabels || {};
        const selectedZones = arr(current.zones);
        const zones = Object.keys(zoneLabels).map((key) => ({
          key: key,
          label: zoneLabels[key],
          selected: selectedZones.indexOf(key) >= 0
        }));
        this.preserved = {
          buildingNos: arr(current.buildingNos),
          maxDailyOrders: current.maxDailyOrders,
          businessHours: current.businessHours,
          autoAccept: current.autoAccept
        };
        this.setData({
          services: services,
          zones: zones,
          acceptingOrders: current.acceptingOrders === true || partner.acceptingOrders === true,
          loading: false
        });
      })
      .catch((err) => {
        this.setData({ loading: false, errorText: (err && err.message) || '服务设置没加载出来，检查网络后重试' });
      });
  },

  guardReadonly() {
    if (modeGuard.canRenderWriteButton()) {
      return false;
    }
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return true;
  },

  onAcceptingChange(event) {
    if (this.guardReadonly()) {
      return;
    }
    const next = !!(event.detail && event.detail.value);
    if (!next && this.data.acceptingOrders) {
      wx.showModal({
        title: '关闭接单',
        content: '关闭接单后，新顾客暂时不能下单；已接的订单不受影响。',
        success: (res) => {
          if (res.confirm) {
            this.setData({ acceptingOrders: false });
          }
        }
      });
      return;
    }
    this.setData({ acceptingOrders: next });
  },

  onServiceToggle(event) {
    if (this.guardReadonly()) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const services = this.data.services.map((item, position) => {
      if (position !== index) {
        return item;
      }
      return Object.assign({}, item, { enabled: !item.enabled });
    });
    this.setData({ services: services });
  },

  onZoneToggle(event) {
    if (this.guardReadonly()) {
      return;
    }
    const key = event.currentTarget.dataset.key;
    const zones = this.data.zones.map((item) => {
      if (item.key !== key) {
        return item;
      }
      return Object.assign({}, item, { selected: !item.selected });
    });
    this.setData({ zones: zones });
  },

  buildPayload() {
    const services = this.data.services
      .filter((item) => item.enabled)
      .map((item) => ({ code: item.code, enabled: true }));
    const zones = this.data.zones.filter((item) => item.selected).map((item) => item.key);
    return {
      services: services,
      zones: zones,
      acceptingOrders: this.data.acceptingOrders,
      buildingNos: (this.preserved && this.preserved.buildingNos) || [],
      maxDailyOrders: this.preserved && this.preserved.maxDailyOrders,
      businessHours: this.preserved && this.preserved.businessHours,
      autoAccept: this.preserved && this.preserved.autoAccept
    };
  },

  onSave() {
    if (this.data.saving || this.guardReadonly()) {
      return;
    }
    const payload = this.buildPayload();
    if (!payload.services.length) {
      this.setData({ errorText: '至少启用 1 个服务类型，顾客才能下单' });
      return;
    }
    if (!payload.zones.length) {
      this.setData({ errorText: '至少选 1 个苑作为服务范围' });
      return;
    }
    if (!payload.services.some((item) => item.code === CUSTOM_SERVICE) && this.data.services.length === 0) {
      this.setData({ errorText: '服务类型目录还没加载出来，请稍后重试' });
      return;
    }
    this.setData({ saving: true, errorText: '' });
    partnerApi
      .saveServiceConfig(payload)
      .then(() => {
        this.setData({ saving: false });
        wx.showToast({ title: '已保存，顾客端立即生效', icon: 'none' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/partner/workbench/index' });
        }, 600);
      })
      .catch((err) => {
        this.setData({ saving: false, errorText: (err && err.message) || '保存失败，已恢复上次保存的值' });
        this.load();
      });
  }
});
