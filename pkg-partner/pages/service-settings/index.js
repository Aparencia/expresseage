// pkg-partner/pages/service-settings/index.js · 服务类型与范围（真实 DTO：partner.serviceConfig{services,zones,acceptingOrders}；不含费用字段）
const partnerApi = require('../../../api/modules/partner');
const configApi = require('../../../api/modules/config');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + '（将写入测试数据）' : text;
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

  // 首屏只用 store：bootstrap 已水合 partner.serviceConfig；configPublic 也已缓存，缺时才回源
  load() {
    this.setData({ loading: true, errorText: '' });
    const cachedConfig = store.get('config');
    const configPromise = cachedConfig ? Promise.resolve(cachedConfig) : configApi.getPublic();
    return configPromise
      .then((config) => {
        const publicConfig = config || {};
        const partner = store.get('partner') || {};
        this.partner = partner;
        const current = partner.serviceConfig || {};
        const enabledMap = {};
        arr(current.services).forEach((item) => {
          if (item && item.code) {
            enabledMap[item.code] = item.enabled === true;
          }
        });
        const services = arr(publicConfig.serviceCatalog).map((item) => ({
          code: item.code,
          name: item.name,
          desc: item.desc || '',
          enabled: enabledMap[item.code] === true
        }));
        const zoneLabels = publicConfig.zoneLabels || {};
        const selectedZones = arr(current.zones);
        const zones = Object.keys(zoneLabels).map((key) => ({
          key: key,
          label: zoneLabels[key],
          selected: selectedZones.indexOf(key) >= 0
        }));
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

  // 只提交服务端真正持久化的三键（services/zones/acceptingOrders）；不夹带客户端保留字段
  buildPayload() {
    const services = this.data.services.map((item) => ({ code: item.code, enabled: item.enabled === true }));
    const zones = this.data.zones.filter((item) => item.selected).map((item) => item.key);
    return {
      services: services,
      zones: zones,
      acceptingOrders: this.data.acceptingOrders
    };
  },

  onSave() {
    if (this.data.saving || this.guardReadonly()) {
      return;
    }
    const payload = this.buildPayload();
    const enabledServices = payload.services.filter((item) => item.enabled);
    if (!enabledServices.length) {
      this.setData({ errorText: '至少启用 1 个服务类型，顾客才能下单' });
      return;
    }
    if (!payload.zones.length) {
      this.setData({ errorText: '至少选 1 个苑作为服务范围' });
      return;
    }
    this.setData({ saving: true, errorText: '' });
    partnerApi
      .saveServiceConfig(payload)
      .then((data) => {
        const saved = (data && data.serviceConfig) || payload;
        const partner = Object.assign({}, this.partner || store.get('partner') || {}, {
          serviceConfig: saved,
          acceptingOrders: saved.acceptingOrders === true
        });
        store.set({ partner: partner });
        this.setData({ saving: false });
        wx.showToast({ title: writeHint('已保存，顾客端立即生效'), icon: 'none' });
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
