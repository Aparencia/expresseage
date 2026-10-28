// pkg-partner/pages/activate/index.js · 邀请码激活
// 口径：V4_UX_PARTNER §3.1 / CONTRACT §1.3/§11.3；页面只做取参 → 调 api → setData → 事件转发：
// 邀请码归一（去空格/连字符、全角转半角、大写）在 shared/validate 纯件里，头像校验/压缩在 api/upload，
// 页面不写业务判据、不出现错误码英文与堆栈（失败文案由 api/client 13 码→人话统一映射）。
'use strict';

const partnerApi = require('../../../api/modules/partner');
const upload = require('../../../api/upload');
const store = require('../../../store/index');
const storage = require('../../../utils/storage');
const ids = require('../../../utils/ids');
const enums = require('../../../shared/enums');
const validate = require('../../../shared/validate');
const route = require('../../../config/route');
const codeInput = require('./parts/code-input-model');
const share = require('../../../utils/share/handlers');

const SERVICE_SETTINGS_PAGE = '/pkg-partner/pages/service-settings/index';
const SUCCESS_JUMP_MS = 1500;

Page({
  data: {
    codeDisplay: '',
    codeRaw: '',
    displayName: '',
    avatarFileId: '',
    avatarTicket: '',
    uploadAvataring: false,
    agreed: false,
    submitting: false,
    errorText: '',
    canSubmit: false,
    activated: null
  },

  onLoad() {
    this.redirectIfActive();
  },

  onShow() {
    this.redirectIfActive();
  },

  onUnload() {
    this.clearJumpTimer();
  },

  redirectIfActive() {
    if (store.getViewContext()) {
      wx.reLaunch({ url: route.PARTNER_WORKBENCH });
      return;
    }
    const partner = store.get('partner') || {};
    if (partner.status === enums.PARTNER_STATUS.ACTIVE) {
      wx.reLaunch({ url: route.PARTNER_WORKBENCH });
      return;
    }
    if (partner.status === enums.PARTNER_STATUS.SUSPENDED || partner.status === enums.PARTNER_STATUS.CLOSED) {
      wx.reLaunch({ url: route.PROFILE_PAGE });
    }
  },

  updateSubmit() {
    const codeOk = codeInput.isValid(this.data.codeRaw);
    const nameOk = validate.validateDisplayName(this.data.displayName).ok;
    const enabled = !this.data.submitting && this.data.agreed && codeOk && nameOk;
    if (enabled !== this.data.canSubmit) {
      this.setData({ canSubmit: enabled });
    }
  },

  // 邀请码：输入即归一（大写、去空格/连字符/全角）并 4 位分组回显；半截输入保留，不因未输完清空
  onCodeInput(event) {
    const next = codeInput.stateOfInput((event.detail && event.detail.value) || '');
    this.setData({ codeRaw: next.codeRaw, codeDisplay: next.codeDisplay, errorText: '' });
    this.updateSubmit();
  },

  onCodeConfirm(event) {
    this.onCodeInput(event);
  },

  // 昵称：input type="nickname" 由微信键盘一键带出微信昵称，也可手填/修改；必填 ≤20 字
  onNameInput(event) {
    const result = validate.validateDisplayName((event.detail && event.detail.value) || '');
    const value = result.ok
      ? result.value
      : ((event.detail && event.detail.value) || '').slice(0, validate.TEXT_LIMITS.displayName);
    this.setData({ displayName: value, errorText: '' });
    this.updateSubmit();
  },

  onAgreeChange(event) {
    const values = (event.detail && event.detail.value) || [];
    this.setData({ agreed: Array.isArray(values) ? values.length > 0 : !!values });
    this.updateSubmit();
  },

  onChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.uploadAvataring || this.data.submitting) {
      return;
    }
    this.setData({ uploadAvataring: true, errorText: '' });
    upload.prepareAndUpload({ purpose: enums.UPLOAD_PURPOSE.AVATAR, filePath: filePath }).then((uploaded) => {
      this.setData({
        avatarFileId: uploaded.fileId || '',
        avatarTicket: uploaded.uploadTicketId || '',
        uploadAvataring: false
      });
    }).catch((err) => {
      // 头像可跳过：失败保留默认头像，不阻断激活；提示给下一步（稍后可在「我的」补）
      this.setData({ uploadAvataring: false });
      wx.showToast({
        title: (err && err.message) || '头像没传上去，可以先跳过，稍后在「我的」补',
        icon: 'none'
      });
    });
  },

  onUseDefaultAvatar() {
    if (this.data.uploadAvataring || this.data.submitting) {
      return;
    }
    this.setData({ avatarFileId: '', avatarTicket: '' });
    wx.showToast({ title: '头像可以以后在「我的」补；现在会显示默认头像', icon: 'none' });
  },

  onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) {
      return;
    }
    if (!codeInput.isValid(this.data.codeRaw)) {
      this.setData({ errorText: '邀请码是 12 位字母数字，形如 XXXX-XXXX-XXXX。' });
      return;
    }
    const nameResult = validate.validateDisplayName(this.data.displayName);
    if (!nameResult.ok) {
      this.setData({ errorText: '昵称是顾客确认你的标识，填一个吧（≤20 字）。' });
      return;
    }
    this.setData({ submitting: true, errorText: '' });
    partnerApi.activate({
      invitationCode: this.data.codeRaw,
      displayName: nameResult.value,
      // 头像两条入参：票据=上传凭证 ID、fileId=云存储文件 ID（服务端用票据校验归属/路径）
      avatarTicket: this.data.avatarTicket || undefined,
      avatarFileId: this.data.avatarTicket ? this.data.avatarFileId || undefined : undefined
    }).then((result) => {
      this.applyActivated(result);
      this.setData({ submitting: false, canSubmit: false, activated: this.buildResult(result) });
      this.scheduleJump();
    }).catch((err) => {
      this.setData({ submitting: false, errorText: (err && err.message) || '激活失败，请检查网络后重试' });
    });
  },

  // 成功块：头像/昵称 + 兼职编号（等宽独立行、可复制），1.5s 后自动去配置服务类型（也可立即点）
  buildResult(result) {
    const data = result || {};
    const partner = data.partner || {};
    const partnerNo = partner.partnerNo || data.partnerNo || '';
    return {
      partnerNo: partnerNo,
      partnerNoDisplay: partnerNo ? ids.displayNo(enums.NO_KIND.PARTNER, partnerNo) : '',
      displayName: partner.displayName || '',
      avatarFileId: partner.avatarFileId || ''
    };
  },

  // partner.activate 返回 {partnerNo, partner, roles}；就地水合 store，后续页面无需再 bootstrap
  applyActivated(result) {
    const data = result || {};
    const partner = data.partner || {};
    const roles = Array.isArray(data.roles) && data.roles.length ? data.roles.slice() : [enums.ROLES.PARTNER];
    const current = store.get('partner') || {};
    store.patch({
      roles: roles,
      activeRole: enums.ROLES.PARTNER,
      partner: Object.assign({}, current, {
        status: partner.status || enums.PARTNER_STATUS.ACTIVE,
        profileComplete: true,
        partnerNo: partner.partnerNo || data.partnerNo || '',
        displayName: partner.displayName || '',
        avatarFileId: partner.avatarFileId || '',
        serviceConfig: partner.serviceConfig || {},
        acceptingOrders: true
      }),
      me: {
        displayName: partner.displayName || '',
        avatarFileId: partner.avatarFileId || ''
      }
    });
    // 进入兼职身份 = 记「上次使用角色」（只经 utils/storage 白名单）
    storage.setLastRole(enums.ROLES.PARTNER);
  },

  scheduleJump() {
    this.clearJumpTimer();
    this._jumpTimer = setTimeout(() => {
      this._jumpTimer = null;
      wx.reLaunch({ url: SERVICE_SETTINGS_PAGE + '?first=1' });
    }, SUCCESS_JUMP_MS);
  },

  clearJumpTimer() {
    if (this._jumpTimer) {
      clearTimeout(this._jumpTimer);
      this._jumpTimer = null;
    }
  },

  onCopyPartnerNo() {
    const activated = this.data.activated || {};
    if (!activated.partnerNoDisplay) {
      return;
    }
    wx.setClipboardData({
      data: activated.partnerNoDisplay,
      success() {
        wx.showToast({ title: '兼职编号已复制', icon: 'none' });
      }
    });
  },

  onGoServiceSettings() {
    this.clearJumpTimer();
    wx.reLaunch({ url: SERVICE_SETTINGS_PAGE + '?first=1' });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
