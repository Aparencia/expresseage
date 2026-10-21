// app.js · 启动入口：只做云环境初始化与 bootstrap 水合，分流交给 pages/launch
const envConfig = require('./config/env');
const store = require('./store/index');
const userModule = require('./api/modules/user');
const bindModule = require('./api/modules/bind');
const configModule = require('./api/modules/config');

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
      await this.refreshConfig();
      await this.refreshBinding();
      return { ok: true, data };
    } catch (err) {
      this.globalData.startupError = (err && err.message) || '启动失败，请稍后重试';
      return { ok: false, code: (err && err.code) || 'BOOTSTRAP_FAILED' };
    }
  },

  async refreshConfig() {
    if (store.get('config')) {
      return;
    }
    try {
      const config = await configModule.getPublic();
      store.set('config', config);
    } catch (err) {
      // 公开配置失败不阻断启动，页面按默认值降级
    }
  },

  async refreshBinding() {
    const roles = store.get('roles') || [];
    if (roles.indexOf('CUSTOMER') < 0) {
      return;
    }
    try {
      const current = await bindModule.getCurrent();
      if (!current || !current.binding) {
        store.set('binding', null);
        return;
      }
      const partner = current.partnerPublic || current.partner || {};
      store.set('binding', Object.assign({}, current.binding, {
        partnerDisplayName: current.binding.partnerDisplayName || partner.displayName || '',
        partnerAvatarFileId: current.binding.partnerAvatarFileId || partner.avatarFileId || '',
        partnerNo: current.binding.partnerNo || partner.partnerNo || ''
      }));
    } catch (err) {
      // 绑定摘要失败不阻断启动；页面可自行重试
    }
  }
});
