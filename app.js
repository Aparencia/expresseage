// app.js · 启动入口：只做云环境初始化与 bootstrap 水合，分流交给 pages/launch
const envConfig = require('./config/env');
const store = require('./store/index');
const userModule = require('./api/modules/user');

App({
  globalData: {
    envVersion: '',
    startupError: '',
    startedAt: 0
  },

  onLaunch() {
    this.globalData.startedAt = Date.now();
    this.globalData.envVersion = this.readEnvVersion();
    this.startupPromise = this.startup();
  },

  readEnvVersion() {
    try {
      const info = wx.getAccountInfoSync();
      const version = info && info.miniProgram && info.miniProgram.envVersion;
      return version || 'develop';
    } catch (err) {
      return 'develop';
    }
  },

  async startup() {
    const envId = envConfig.pick(this.globalData.envVersion);
    if (!envConfig.isUsable(envId)) {
      this.globalData.startupError = '云环境未配置：请先在 config/env.js 填写环境 ID';
      return { ok: false, code: 'ENV_MISSING' };
    }
    try {
      wx.cloud.init({ env: envId, traceUser: true });
    } catch (err) {
      this.globalData.startupError = '云开发初始化失败，请检查当前基础库与云环境';
      return { ok: false, code: 'CLOUD_INIT_FAILED' };
    }
    try {
      const data = await userModule.bootstrap();
      store.hydrateFromBootstrap(data);
      return { ok: true, data };
    } catch (err) {
      this.globalData.startupError = (err && err.message) || '启动失败，请稍后重试';
      return { ok: false, code: (err && err.code) || 'BOOTSTRAP_FAILED' };
    }
  }
});
