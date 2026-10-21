// pages/launch/index.js · 启动分流（唯一启动页：登录 → 隐私同意闸 → 按快照分流）
// 口径：V4_CONTRACT §7/§11、V4_UX_CUSTOMER §1.2/§3.1/§9.1；页面只做取数 → 调 api → setData → reLaunch，
// 分流判定用 config/route.js 纯函数、隐私判定用 utils/privacy-policy.js 纯件（不写业务判据）。
'use strict';

const store = require('../../store/index');
const userApi = require('../../api/modules/user');
const configApi = require('../../api/modules/config');
const privacy = require('../../utils/privacy-policy');
const launchRoute = require('../../config/route');
const storage = require('../../utils/storage');

const HELP_PRIVACY_PAGE = '/pkg-customer/pages/help/index?doc=privacy';
const MAX_ATTEMPTS = 3;
const NETWORK_TITLE = '网络开小差了';
const NETWORK_TEXT = '请检查网络后重试；若一直失败，可在微信里重新打开小程序。';
const CHECK_NETWORK_HINT = '已连续失败，请检查网络后再试一次。';
const LOGIN_TITLE = '微信登录失败（错误码 {code}）';
const LOGIN_TEXT = '退出小程序后重新打开再试。';
const RETRY_TEXT = '重新加载';
const FIRST_RUN_LEAD = '首次使用需要你了解并同意隐私政策，同意后才能进入。';
const VERSION_CHANGED_LEAD = '隐私政策已更新，请重新阅读并同意。';
const PRIVACY_ITEMS = [
  '我们收集：微信登录标识、顾客/兼职编号、微信昵称（必填）、微信头像（可选，可拒绝→默认头像）、苑/楼栋/宿舍号、可选手机尾号，以及订单信息与取件码截图。',
  '用途：下单、履约与进度沟通；头像与昵称只向当前绑定的对方展示，解绑、停用或注销后不再展示，分享卡片与后台列表不含头像/昵称。',
  '识别失败时，去敏后的截图文字会发给第三方 AI 服务辅助识别；原图不出本程序云存储。失败原图可能进入开发者复核（临时查看、每次审计、默认 30 天删除）。',
  '开发者账号可切换账号查看：真实账号只读并留审计，测试账号为后台合成账号（不含真实用户数据），切换全程留审计。',
  '数据按角色隔离、仅订单双方可见；保存期限见隐私政策全文；你可以在「我的-注销账号」申请注销，资料会被删除或匿名化。',
  '未成年人需在监护人指导下使用本程序。'
];

Page({
  data: {
    loading: true,
    attempts: 0,
    brandName: '代取 · 校园快递',
    loadingTip: '正在进入…',
    retryText: RETRY_TEXT,
    errorTitle: '',
    errorText: '',
    errorHint: '',
    privacyVisible: false,
    privacySubmitting: false,
    privacyError: '',
    privacyDeclined: false,
    privacyLead: FIRST_RUN_LEAD,
    privacyItems: PRIVACY_ITEMS
  },

  onLoad() {
    this.start();
  },

  start() {
    const app = getApp();
    this.setData({
      loading: true,
      errorTitle: '',
      errorText: '',
      errorHint: '',
      privacyVisible: false,
      privacyDeclined: false,
      privacyError: ''
    });
    return this.waitStartup(app).then((startup) => {
      if (!startup || !startup.ok) {
        this.fail(startup || {});
        return null;
      }
      return this.ensureConfig().then((config) => {
        if (!config) {
          this.fail({ code: 'CONFIG_MISSING', message: '服务配置加载失败，请重试' });
          return null;
        }
        return this.applyPrivacyGate(config);
      });
    }).catch(() => {
      this.fail({ code: 'STARTUP', message: '启动失败，请稍后重试' });
    });
  },

  waitStartup(app) {
    if (!app.startupPromise) {
      return Promise.resolve({ ok: false, code: 'STARTUP', message: app.globalData.startupError || '' });
    }
    return Promise.resolve(app.startupPromise).then((result) => {
      return result && typeof result.ok === 'boolean' ? result : { ok: false, code: 'STARTUP', message: '' };
    }).catch((err) => ({
      ok: false,
      code: (err && err.code) || 'STARTUP',
      message: (err && err.message) || ''
    }));
  },

  // 公开配置是隐私版本判定的输入：缓存缺失时补拉一次，仍失败按启动失败处理（fail-closed）
  ensureConfig() {
    const cached = store.get('config');
    if (cached && privacy.expectedVersionOf(cached)) {
      return Promise.resolve(cached);
    }
    return configApi.getPublic().then((config) => {
      store.patch({ config: config });
      return config;
    }).catch(function ignore() {
      return null;
    });
  },

  applyPrivacyGate(config) {
    const status = privacy.consentStatus(store.get('privacyConsent'), config);
    if (status.needsPrompt) {
      this._expectedVersion = status.expectedVersion;
      this.setData({
        loading: false,
        privacyVisible: true,
        privacyLead: status.reason === privacy.STATUS.VERSION_CHANGED ? VERSION_CHANGED_LEAD : FIRST_RUN_LEAD
      });
      return null;
    }
    if (!status.canProceed) {
      this.fail({ code: 'CONFIG_MISSING', message: '隐私配置未就绪，请重试' });
      return null;
    }
    this.route();
    return null;
  },

  onAgreePrivacy() {
    if (this.data.privacySubmitting) {
      return;
    }
    const version = this._expectedVersion || '';
    if (!version) {
      this.setData({ privacyError: '隐私版本未就绪，请重试' });
      return;
    }
    this.setData({ privacySubmitting: true, privacyError: '' });
    userApi.acceptPrivacy(version).then((data) => {
      const consent = (data && data.privacyConsent) || privacy.buildConsent(version, Date.now());
      if (consent) {
        store.patch({ privacyConsent: consent });
      }
      this.setData({ privacySubmitting: false, privacyVisible: false, loading: true });
      this.route();
    }).catch((err) => {
      this.setData({
        privacySubmitting: false,
        privacyError: (err && err.message) || '确认失败，请检查网络后重试'
      });
    });
  },

  // 不同意：停在启动页说明，不进入业务（CONTRACT §11 / UX_CUSTOMER §9.1）
  onDeclinePrivacy() {
    if (this.data.privacySubmitting) {
      return;
    }
    this.setData({ privacyVisible: false, privacyDeclined: true, loading: false });
  },

  onReopenPrivacy() {
    this.setData({ privacyDeclined: false, privacyVisible: true, privacyError: '' });
  },

  onViewPrivacy() {
    wx.navigateTo({
      url: HELP_PRIVACY_PAGE,
      fail() {
        wx.showToast({ title: '打开隐私政策失败，请检查网络后重试', icon: 'none' });
      }
    });
  },

  onRetry() {
    const app = getApp();
    app.globalData.startupError = '';
    app.startupPromise = app.startup();
    this.start();
  },

  fail(result) {
    const attempts = (this.data.attempts || 0) + 1;
    const app = getApp();
    const code = (result && result.code) || '';
    const detail = (result && result.message) || app.globalData.startupError || '';
    const loginFailed = attempts >= MAX_ATTEMPTS && code !== '' && code !== 'CONFIG_MISSING';
    this.setData({
      loading: false,
      attempts: attempts,
      errorTitle: loginFailed ? LOGIN_TITLE.replace('{code}', code) : NETWORK_TITLE,
      errorText: loginFailed ? LOGIN_TEXT : (detail || NETWORK_TEXT),
      errorHint: attempts >= 2 && !loginFailed ? CHECK_NETWORK_HINT : ''
    });
  },

  // 进入角色：分流只用 config/route.js 纯函数；角色与落地页由纯件判定，页面只做 reLaunch。
  // 顺便把「本次进入的角色」记到本地偏好 lastRole（utils/storage 白名单；双角色下次在角色页给建议）。
  // 切换会话/开发者不进业务角色，不写 lastRole（票据与视角一律不落盘，ENGINEERING §5.6）。
  route() {
    const snapshot = store.snapshot();
    const decision = launchRoute.decideLaunchRoute(snapshot);
    const url = decision && decision.url ? decision.url : launchRoute.ROLE_PAGE;
    const sessionOrAdmin = !!(snapshot.viewContext || snapshot.isDeveloper);
    const enteredRole = sessionOrAdmin ? '' : launchRoute.roleOfDecision(decision);
    if (enteredRole) {
      storage.setLastRole(enteredRole);
    }
    wx.reLaunch({ url: url });
  }
});
