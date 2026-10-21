// pkg-partner/pages/activate/index.js · 邀请码激活：昵称必填（可一键取微信昵称），头像可跳过→默认头像
const partnerApi = require('../../../api/modules/partner');
const upload = require('../../../api/upload');
const store = require('../../../store/index');

const CODE_LENGTH = 12;
const CODE_GROUP = 4;
const NAME_MAX = 20;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function normalizeCode(raw) {
  const source = typeof raw === 'string' ? raw : '';
  return source
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248))
    .replace(/[－—–\s]/g, '')
    .toUpperCase();
}

function groupCode(code) {
  const parts = [];
  for (let index = 0; index < code.length; index += CODE_GROUP) {
    parts.push(code.slice(index, index + CODE_GROUP));
  }
  return parts.join('-');
}

function validCode(code) {
  if (code.length !== CODE_LENGTH) {
    return false;
  }
  for (let index = 0; index < code.length; index += 1) {
    if (CODE_ALPHABET.indexOf(code.charAt(index)) < 0) {
      return false;
    }
  }
  return true;
}

function trimName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name;
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
    const enabled =
      !this.data.submitting &&
      this.data.agreed &&
      validCode(this.data.codeRaw) &&
      this.data.displayName.length > 0 &&
      this.data.displayName.length <= NAME_MAX;
    if (enabled !== this.data.canSubmit) {
      this.setData({ canSubmit: enabled });
    }
  },

  onCodeInput(event) {
    const raw = normalizeCode((event.detail && event.detail.value) || '');
    const limited = raw.slice(0, CODE_LENGTH);
    this.setData({ codeRaw: limited, codeDisplay: groupCode(limited), errorText: '' });
    this.updateSubmit();
  },

  onCodeConfirm(event) {
    this.onCodeInput(event);
  },

  onNameInput(event) {
    const name = trimName((event.detail && event.detail.value) || '');
    this.setData({ displayName: name, errorText: '' });
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
      const uploaded = await upload.prepareAndUpload({ purpose: 'AVATAR', filePath });
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
    const code = this.data.codeRaw;
    if (!validCode(code)) {
      this.setData({ errorText: '邀请码是 12 位字母数字，形如 XXXX-XXXX-XXXX。' });
      return;
    }
    if (!this.data.displayName) {
      this.setData({ errorText: '昵称是顾客确认你的标识，填一个吧（≤20 字）。' });
      return;
    }
    this.setData({ submitting: true, errorText: '' });
    partnerApi
      .activate({
        invitationCode: code,
        displayName: this.data.displayName,
        avatarTicket: this.data.avatarTicket || undefined
      })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '激活成功，先配置服务类型', icon: 'none' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pkg-partner/pages/service-settings/index?first=1' });
        }, 600);
      })
      .catch((err) => {
        this.setData({ submitting: false, errorText: (err && err.message) || '激活失败，请稍后重试' });
      });
  }
});
