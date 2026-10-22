// app.js · 启动入口：只做云环境初始化与 bootstrap 水合，分流交给 pages/launch
// 性能口径（PERFORMANCE §4.1）：P0-1 启动只 await user.bootstrap；P0-2 config 模块缓存预热；
// P0-3 绑定摘要移出关键路径且首页首拉可在窗口内复用（store.binding 增加可选字段 partnerPublic）。
const envConfig = require('./config/env');
const store = require('./store/index');
const userModule = require('./api/modules/user');
const bindModule = require('./api/modules/bind');
const configModule = require('./api/modules/config');

// 首页首次 onShow 复用启动期绑定结果的窗口（超过窗口视为过期，自行重拉）
const BIND_REUSE_WINDOW_MS = 30 * 1000;

App({
  globalData: {
    envVersion: '',
    startupError: '',
    startedAt: 0,
    bindingStartedAt: 0,
    bindingFetchedAt: 0,
    bindingConsumed: false
  },

  BIND_REUSE_WINDOW_MS: BIND_REUSE_WINDOW_MS,

  onLaunch() {
    this.globalData.startedAt = Date.now();
    this.globalData.envVersion = this.readEnvVersion();
    this.bindingPromise = null;
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
      // P0-2：bootstrap 已回 configPublic → 直接灌入 api/modules/config 的 5 分钟缓存，
      // 首页/任何页面本次会话首次 getPublic 命中缓存（零云调用）；失败语义不变（页面按默认值降级）。
      configModule.prime(data && data.configPublic);
      // P0-1：启动关键路径只等 bootstrap；绑定摘要在后台推进（不 await），首帧由 store 快照渲染。
      this.startBinding();
      return { ok: true, data };
    } catch (err) {
      this.globalData.startupError = (err && err.message) || '启动失败，请稍后重试';
      return { ok: false, code: (err && err.code) || 'BOOTSTRAP_FAILED' };
    }
  },

  // P0-1/P0-3：启动期发起绑定摘要；首页首次 refresh 可在窗口内消费同一 Promise（避免重复 bind.getCurrent）。
  startBinding() {
    this.globalData.bindingStartedAt = Date.now();
    this.globalData.bindingConsumed = false;
    this.bindingPromise = this.refreshBinding().then((current) => {
      this.globalData.bindingFetchedAt = Date.now();
      return current;
    });
    return this.bindingPromise;
  },

  // 首页首次 refresh 调用：只消费一次；过期/已消费返回 null（首页自行 bind.getCurrent 重拉）。
  consumeStartupBinding() {
    const promise = this.bindingPromise;
    if (!promise || this.globalData.bindingConsumed) {
      return null;
    }
    if (Date.now() - this.globalData.bindingStartedAt > BIND_REUSE_WINDOW_MS) {
      return null;
    }
    this.globalData.bindingConsumed = true;
    return promise;
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

  // 返回 bind.getCurrent 的 data（{binding, partnerPublic}）；失败返回 null（调用方自行重拉）。
  async refreshBinding() {
    const roles = store.get('roles') || [];
    if (roles.indexOf('CUSTOMER') < 0) {
      return { binding: null, partnerPublic: null };
    }
    try {
      const current = await bindModule.getCurrent();
      const binding = current && current.binding ? current.binding : null;
      const partnerPublic = (current && current.partnerPublic) || null;
      // P0-3：partnerPublic 一并存入 store.binding（可选字段）；首页首帧直接复用，避免首屏再拉一次。
      store.set('binding', binding ? Object.assign({}, binding, {
        partnerDisplayName: binding.partnerDisplayName || (partnerPublic && partnerPublic.displayName) || '',
        partnerAvatarFileId: binding.partnerAvatarFileId || (partnerPublic && partnerPublic.avatarFileId) || '',
        partnerNo: binding.partnerNo || (partnerPublic && partnerPublic.partnerNo) || '',
        partnerPublic: partnerPublic
      }) : null);
      return current || { binding: null, partnerPublic: null };
    } catch (err) {
      // 绑定摘要失败不阻断启动；首页消费到 null 后自行重拉
      return null;
    }
  }
});
