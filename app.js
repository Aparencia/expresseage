// app.js · 启动入口：只做云环境初始化与 bootstrap 水合，分流交给 pages/launch
// 性能口径（PERFORMANCE §4.1）：P0-1 启动只 await user.bootstrap；P0-2 config 模块缓存预热；
// P0-3 绑定摘要移出关键路径且首页首拉可在窗口内复用（store.binding 增加可选字段 partnerPublic）。
const envConfig = require('./config/env');
const store = require('./store/index');
const userModule = require('./api/modules/user');
const bindModule = require('./api/modules/bind');
const configModule = require('./api/modules/config');
const storage = require('./utils/storage');
const sharePlatform = require('./utils/share/platform');
// 主包公共依赖声明：分包共享模块只在主包存放，显式 require 让主包可达（代码质量扫描不误报未使用）。
// 模块零副作用，不改变启动网络/存储行为；若后续把这些模块迁入分包，可同步删除本行。
require('./config/main-deps');

// 首页首次 onShow 复用启动期绑定结果的窗口（超过窗口视为过期，自行重拉）
const BIND_REUSE_WINDOW_MS = 30 * 1000;

// 弱网兜底：网络状态切换各给一次轻提示（不阻断页面；页面内失败仍按各自重试口径）
const NETWORK_OFF_TEXT = '网络已断开，恢复后可继续';
const NETWORK_ON_TEXT = '网络已恢复';

// 字号适配（B 子集，2026-11-19）：只注入缩放系数，正文/说明/错误提示由 wxss calc 跟随；不改布局尺寸
const FS_BASE = 16;
const FS_MAX_SCALE = 1.3;

// 深浅色：只存一个布尔（页面/组件自行取用；不落盘、不上报）
function readThemeDark() {
  try {
    const info = wx.getSystemInfoSync();
    return !!(info && info.theme === 'dark');
  } catch (err) {
    return false;
  }
}

function readFontScale() {
  try {
    const info = wx.getSystemInfoSync();
    const setting = Number(info && info.fontSizeSetting);
    if (!isFinite(setting) || setting <= 0) {
      return 1;
    }
    const scale = Math.round((setting / FS_BASE) * 100) / 100;
    return Math.min(FS_MAX_SCALE, Math.max(1, scale));
  } catch (err) {
    return 1;
  }
}

App({
  globalData: {
    envVersion: '',
    startupError: '',
    startedAt: 0,
    bindingStartedAt: 0,
    bindingFetchedAt: 0,
    bindingConsumed: false,
    // 朋友圈单页模式（scene=1154）：无登录态、云资源不可用，不做云初始化与 bootstrap
    singlePage: false,
    // 本机是否在线（弱网提示去重用；不落盘、不上报）
    networkOnline: true,
    // 字号缩放系数（1~1.3；页面根节点透传到 --v4-fs-scale）
    fsScale: 1,
    // 系统是否深色（custom-tab-bar / 伪 tab 页取用；主题切换监听只更新此值）
    themeDark: false
  },

  BIND_REUSE_WINDOW_MS: BIND_REUSE_WINDOW_MS,

  onLaunch() {
    this.globalData.startedAt = Date.now();
    this.globalData.envVersion = this.readEnvVersion();
    this.globalData.singlePage = sharePlatform.singlePageNow();
    this.bindingPromise = null;
    this.bindNetworkStatus();
    this.globalData.fsScale = readFontScale();
    this.globalData.themeDark = readThemeDark();
    this.bindThemeMode();
    this.watchPageFontScale();
    // 朋友圈单页模式：wx.login 不可用、云开发资源需未登录访问（本仓没有），
    // 因此不做云初始化与 bootstrap；落地页按静态预览渲染（D36），点「前往小程序」后正常启动。
    this.startupPromise = this.globalData.singlePage
      ? Promise.resolve({ ok: false, code: 'SINGLE_PAGE' })
      : this.startup();
  },

  // 弱网兜底（2026-11-19）：只在「在线↔离线」翻转时提示一次，不猜具体请求成败
  bindNetworkStatus() {
    if (typeof wx === 'undefined' || typeof wx.onNetworkStatusChange !== 'function') {
      return;
    }
    const self = this;
    wx.onNetworkStatusChange(function onNetworkStatusChange(res) {
      const online = !!(res && res.isConnected);
      if (online === self.globalData.networkOnline) {
        return;
      }
      self.globalData.networkOnline = online;
      wx.showToast({
        title: online ? NETWORK_ON_TEXT : NETWORK_OFF_TEXT,
        icon: 'none',
        duration: 1500
      });
    });
  },

  // 深浅色切换：只更新 globalData.themeDark（custom-tab-bar 自己监听并换图标，页面在 onShow 取用）
  bindThemeMode() {
    if (typeof wx.onThemeChange !== 'function') {
      return;
    }
    const self = this;
    wx.onThemeChange(function onThemeChange(res) {
      self.globalData.themeDark = !!(res && res.theme === 'dark');
    });
  },

  // 字号适配（B 子集）：把缩放系数注入当前页 data；页面根节点 style 透传到 --v4-fs-scale（wxss calc 使用）
  watchPageFontScale() {
    if (typeof wx.onAppRoute !== 'function' || typeof getCurrentPages !== 'function') {
      return;
    }
    const self = this;
    wx.onAppRoute(function applyFontScale() {
      const pages = getCurrentPages();
      const page = pages && pages.length ? pages[pages.length - 1] : null;
      if (!page || typeof page.setData !== 'function' || !page.data) {
        return;
      }
      if (page.data.fsScale === self.globalData.fsScale) {
        return;
      }
      page.setData({ fsScale: self.globalData.fsScale });
    });
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
      // D86：本机上次工作区作为 preferredRole 提示；无偏好/非法值由服务端回落默认（顾客）。
      // 该值只经 utils/storage 白名单键，不含票据/视角上下文/PII（ENGINEERING §5.6）。
      const data = await userModule.bootstrap(storage.getLastRole());
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
