// pages/launch/index.js · 启动分流（唯一启动页）
const store = require('../../store/index');
const { decideLaunchRoute } = require('../../config/route');

Page({
  data: {
    loading: true,
    errorText: ''
  },

  onLoad() {
    this.start();
  },

  async start() {
    const app = getApp();
    this.setData({ loading: true, errorText: '' });
    if (app.globalData.startupError) {
      this.setData({ loading: false, errorText: app.globalData.startupError });
      return;
    }
    let result = { ok: false };
    if (app.startupPromise) {
      try {
        result = await app.startupPromise;
      } catch (err) {
        result = { ok: false };
      }
    }
    if (!result.ok) {
      this.setData({
        loading: false,
        errorText: app.globalData.startupError || '启动失败，请稍后重试'
      });
      return;
    }
    const route = decideLaunchRoute(store.snapshot());
    const url = route && route.url ? route.url : '/pages/role/index';
    wx.reLaunch({ url });
  },

  onRetry() {
    const app = getApp();
    app.globalData.startupError = '';
    app.startupPromise = app.startup();
    this.start();
  }
});
