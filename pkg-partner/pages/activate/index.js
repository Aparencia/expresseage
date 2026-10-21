// pkg-partner/pages/activate/index.js · 邀请码激活：昵称必填（可一键取微信昵称），头像可跳过→默认头像
const partnerApi = require('../../../api/modules/partner');
const upload = require('../../../api/upload');
const store = require('../../../store/index');
const validate = require('../../../shared/validate');

const CODE_GROUP = 4;
const CODE_LENGTH = 12;

function groupCode(code) {
  const parts = [];
  for (let index = 0; index < code.length; index += CODE_GROUP) {
    parts.push(code.slice(index, index + CODE_GROUP));
  }
  return parts.join('-');
}

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
    canSubmit: false
  },

  onLoad() {
    this.redirectIfActive();
  },

  onShow() {
    this.redirectIfActive();
  },

  redirectIfActive() {
    const view = store.getViewContext();
    if (view) {
      wx.reLaunch({ url: '/pages/partner/workbench/index' });
      return;
    }
    const partner = store.get('partner') || {};
    if (partner.status === 'ACTIVE') {
      wx.reLaunch({ url: '/pages/partner/workbench/index' });
      return;
    }
    if (partner.status === 'SUSPENDED' || partner.status === 'CLOSED') {
      wx.reLaunch({ url: '/pages/profile/index' });
    }
  },

  updateSubmit() {
    const codeOk = validate.validateInvitationCode(this.data.codeRaw).ok;
    const nameOk = validate.validateDisplayName(this.data.displayName).ok;
    const enabled = !this.data.submitting && this.data.agreed && codeOk && nameOk;
    if (enabled !== this.data.canSubmit) {
      this.setData({ canSubmit: enabled });
    }
  },

  onCodeInput(event) {
    const result = validate.validateInvitationCode((event.detail && event.detail.value) || '');
    const canonical = (result.canonical || '').slice(0, CODE_LENGTH);
    this.setData({ codeRaw: canonical, codeDisplay: groupCode(canonical), errorText: '' });
    this.updateSubmit();
  },

  onCodeConfirm(event) {
    this.onCodeInput(event);
  },

  onNameInput(event) {
    const result = validate.validateDisplayName((event.detail && event.detail.value) || '');
    const value = result.ok ? result.value : ((event.detail && event.detail.value) || '').slice(0, validate.TEXT_LIMITS.displayName);
    this.setData({ displayName: value, errorText: '' });
    this.updateSubmit();
  },

  onAgreeChange(event) {
    const values = (event.detail && event.detail.value) || [];
    this.setData({ agreed: Array.isArray(values) ? values.length > 0 : !!values });
    this.updateSubmit();
  },

  async onChooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.uploadAvataring) {
      return;
    }
    this.setData({ uploadAvataring: true });
    try {
      const uploaded = await upload.prepareAndUpload({ purpose: 'AVATAR', filePath: filePath });
      this.setData({
        avatarFileId: uploaded.fileId || '',
        avatarTicket: uploaded.uploadTicketId || '',
        uploadAvataring: false
      });
    } catch (err) {
      this.setData({ uploadAvataring: false });
      wx.showToast({ title: (err && err.message) || '头像没传上去，可以先跳过', icon: 'none' });
    }
  },

  onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) {
      return;
    }
    const codeResult = validate.validateInvitationCode(this.data.codeRaw);
    if (!codeResult.ok) {
      this.setData({ errorText: '邀请码是 12 位字母数字，形如 XXXX-XXXX-XXXX。' });
      return;
    }
    const nameResult = validate.validateDisplayName(this.data.displayName);
    if (!nameResult.ok) {
      this.setData({ errorText: '昵称是顾客确认你的标识，填一个吧（≤20 字）。' });
      return;
    }
    this.setData({ submitting: true, errorText: '' });
    partnerApi
      .activate({
        invitationCode: codeResult.canonical,
        displayName: nameResult.value,
        // 头像两条入参：票据=上传凭证 ID、fileId=云存储文件 ID（服务端用票据校验归属/路径）
        avatarTicket: this.data.avatarTicket || undefined,
        avatarFileId: this.data.avatarTicket ? this.data.avatarFileId || undefined : undefined
      })
      .then((result) => {
        this.applyActivated(result);
        this.setData({ submitting: false });
        wx.showToast({ title: '激活成功，先配置服务类型', icon: 'none' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pkg-partner/pages/service-settings/index?first=1' });
        }, 600);
      })
      .catch((err) => {
        this.setData({ submitting: false, errorText: (err && err.message) || '激活失败，请稍后重试' });
      });
  },

  // partner.activate 返回 {partnerNo, partner, roles}；就地水合 store，后续页面无需再 bootstrap
  applyActivated(result) {
    const data = result || {};
    const partner = data.partner || {};
    const roles = Array.isArray(data.roles) && data.roles.length ? data.roles.slice() : ['PARTNER'];
    const current = store.get('partner') || {};
    store.patch({
      roles: roles,
      activeRole: 'PARTNER',
      partner: Object.assign({}, current, {
        status: partner.status || 'ACTIVE',
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
  }
});
