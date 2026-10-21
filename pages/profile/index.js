// pages/profile/index.js · 我的（顾客/兼职共用，按全局角色渲染；不串数据）
const store = require('../../store/index');
const customerModule = require('../../api/modules/customer');
const partnerModule = require('../../api/modules/partner');
const bindModule = require('../../api/modules/bind');
const userModule = require('../../api/modules/user');
const uploadApi = require('../../api/upload');
const modeGuard = require('../../api/mode-guard');
const ids = require('../../utils/ids');

const ZONES = [
  { code: 'D', label: 'D 区' },
  { code: 'X', label: 'X 区' },
  { code: 'N', label: 'N 区' },
  { code: 'B', label: 'B 区' },
  { code: 'C', label: 'C 区' }
];
const BUILDING_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const NAME_LIMIT = 20;
const RELEASE_OPTIONS = [
  { reason: 'CUSTOMER_INITIATED', label: '不再需要这位兼职' },
  { reason: 'CUSTOMER_ACCOUNT_CLOSED', label: '准备注销账号' }
];
const PARTNER_STATUS_TEXT = {
  ACTIVE: '接单中',
  SUSPENDED: '已停用',
  CLOSED: '已注销'
};

function readVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const version = info && info.miniProgram && info.miniProgram.version;
    return version || '开发版';
  } catch (err) {
    return '开发版';
  }
}

function toast(title) {
  wx.showToast({ title: title || '操作失败', icon: 'none' });
}

Page({
  data: {
    loading: true,
    role: '',
    isCustomer: true,
    canEdit: true,
    editMode: false,
    saving: false,
    profile: { displayName: '', avatarFileId: '' },
    form: null,
    zoneLabels: ZONES.map((item) => item.label),
    buildingLabels: BUILDING_LABELS,
    zoneOptions: ZONES,
    customerNo: '',
    partnerNo: '',
    binding: null,
    roomTagText: '',
    customerDormKey: '',
    dormText: '',
    partnerStatusText: '',
    suspended: false,
    closed: false,
    roles: [],
    messagesBadge: 0,
    orderSummary: '',
    version: '开发版'
  },

  onLoad() {
    this.refresh();
    this.unsubscribe = store.subscribe(() => this.refresh());
  },

  onShow() {
    this.refresh();
  },

  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },

  refresh() {
    const snap = store.snapshot();
    const view = snap.viewContext;
    const role = view ? view.role : snap.activeRole;
    if (!role) {
      this.setData({ loading: false });
      return;
    }
    const isCustomer = role === 'CUSTOMER';
    const customer = snap.customer || {};
    const partner = snap.partner || {};
    const binding = snap.binding || null;
    const canEdit = !view || view.viewMode === 'TEST_WRITE';
    const dormKey = customer.dormKey || '';
    const roomTagText = binding && binding.roomTag && dormKey ? dormKey + binding.roomTag : '';
    const customerNo = customer.customerNo || '';
    const partnerNo = partner.partnerNo || '';
    const form = this.buildForm(customer, isCustomer);
    this.setData({
      loading: false,
      role,
      isCustomer,
      canEdit,
      profile: {
        displayName: isCustomer ? customer.displayName || '' : partner.displayName || '',
        avatarFileId: isCustomer ? customer.avatarFileId || '' : partner.avatarFileId || ''
      },
      form: this.data.editMode ? this.data.form : form,
      customerNo,
      customerNoDisplay: customerNo ? ids.displayNo('CUSTOMER', customerNo) : '',
      partnerNo,
      partnerNoDisplay: partnerNo ? ids.displayNo('PARTNER', partnerNo) : '',
      binding: binding
        ? {
            partnerDisplayName: binding.partnerDisplayName || '',
            partnerAvatarFileId: binding.partnerAvatarFileId || '',
            partnerNoDisplay: binding.partnerNo ? ids.displayNo('PARTNER', binding.partnerNo) : binding.targetNo || '',
            roomTag: binding.roomTag || ''
          }
        : null,
      roomTagText,
      customerDormKey: dormKey,
      dormText: isCustomer ? this.dormText(customer) : '',
      partnerStatusText: isCustomer ? '' : PARTNER_STATUS_TEXT[partner.status] || '待激活',
      suspended: !isCustomer && partner.status === 'SUSPENDED',
      closed: !isCustomer && partner.status === 'CLOSED',
      roles: snap.roles || [],
      messagesBadge: (snap.badges && snap.badges.messages) || 0,
      orderSummary: isCustomer && customer.orderSummary ? customer.orderSummary : '',
      version: readVersion()
    });
  },

  buildForm(customer, isCustomer) {
    const zoneIndex = Math.max(0, ZONES.findIndex((item) => item.code === customer.zone));
    const buildingIndex = Math.max(0, BUILDING_LABELS.indexOf(String(customer.buildingNo || '1')));
    return {
      displayName: customer.displayName || '',
      avatarFileId: customer.avatarFileId || '',
      avatarTicket: '',
      avatarPreview: '',
      zoneIndex,
      buildingIndex,
      room: customer.room || '',
      phoneTail: customer.phoneTail || '',
      dormPreview: isCustomer ? this.dormText(customer) : ''
    };
  },

  dormText(customer) {
    const zone = ZONES.find((item) => item.code === customer.zone);
    if (!zone || !customer.buildingNo || !customer.room) {
      return '';
    }
    return zone.label + customer.buildingNo + '栋' + customer.room + '室';
  },

  onToggleEdit() {
    if (!this.data.canEdit) {
      toast('开发者只读视角不能操作');
      return;
    }
    if (this.data.editMode) {
      this.setData({ editMode: false });
      this.refresh();
      return;
    }
    const snap = store.snapshot();
    const customer = snap.customer || {};
    this.setData({ editMode: true, form: this.buildForm(customer, this.data.isCustomer) });
  },

  onNicknameInput(event) {
    let value = (event.detail && event.detail.value) || '';
    if (value.length > NAME_LIMIT) {
      value = value.slice(0, NAME_LIMIT);
      toast('昵称最多 20 个字，已截断');
    }
    this.setData({ 'form.displayName': value });
  },

  onRoomInput(event) {
    const value = ((event.detail && event.detail.value) || '').replace(/\D/g, '');
    const form = Object.assign({}, this.data.form, { room: value });
    form.dormPreview = this.previewDorm(form);
    this.setData({ form });
  },

  onPhoneTailInput(event) {
    const value = ((event.detail && event.detail.value) || '').replace(/\D/g, '').slice(0, 4);
    this.setData({ 'form.phoneTail': value });
  },

  onZoneChange(event) {
    const form = Object.assign({}, this.data.form, { zoneIndex: Number(event.detail.value) });
    if (form.room) {
      form.dormPreview = this.previewDorm(form);
    }
    this.setData({ form });
  },

  onBuildingChange(event) {
    const form = Object.assign({}, this.data.form, { buildingIndex: Number(event.detail.value) });
    if (form.room) {
      form.dormPreview = this.previewDorm(form);
    }
    this.setData({ form });
  },

  previewDorm(form) {
    const zone = ZONES[form.zoneIndex] || ZONES[0];
    const buildingNo = BUILDING_LABELS[form.buildingIndex] || '1';
    const room = form.room || '';
    if (!room) {
      return '';
    }
    return zone.label + buildingNo + '栋' + room + '室';
  },

  onUseDefaultAvatar() {
    this.setData({ 'form.avatarTicket': '', 'form.avatarFileId': '', 'form.avatarPreview': '' });
  },

  async onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (!avatarUrl) {
      return;
    }
    this.setData({ 'form.avatarPreview': avatarUrl });
    try {
      const uploaded = await uploadApi.prepareAndUpload({ purpose: 'AVATAR', filePath: avatarUrl });
      this.setData({
        'form.avatarTicket': uploaded.uploadTicketId,
        'form.avatarFileId': uploaded.fileId
      });
    } catch (err) {
      toast(err.message || '头像上传失败，可稍后重试或先用默认头像');
      this.setData({ 'form.avatarPreview': '' });
    }
  },

  async onSave() {
    if (!this.data.canEdit) {
      toast('开发者只读视角不能操作');
      return;
    }
    const form = this.data.form || {};
    const displayName = (form.displayName || '').trim();
    if (!displayName) {
      toast('昵称不能为空');
      return;
    }
    const payload = { displayName, avatarTicket: form.avatarTicket || '' };
    if (!form.avatarTicket && !form.avatarPreview) {
      payload.avatarFileId = '';
    }
    if (this.data.isCustomer) {
      const zone = ZONES[form.zoneIndex] || ZONES[0];
      const buildingNo = BUILDING_LABELS[form.buildingIndex] || '';
      const room = (form.room || '').replace(/^0+/, '');
      if (!room || room.length < 3) {
        toast('宿舍号要填 3 位以上数字（如 522）');
        return;
      }
      if (form.phoneTail && form.phoneTail.length !== 4) {
        toast('手机尾号写后 4 位数字，不知道就留空');
        return;
      }
      payload.zone = zone.code;
      payload.buildingNo = Number(buildingNo);
      payload.room = room;
      payload.phoneTail = form.phoneTail || '';
    }
    this.setData({ saving: true });
    try {
      if (this.data.isCustomer) {
        const saved = await customerModule.saveProfile(payload);
        store.patch({ customer: Object.assign({}, store.get('customer'), payload, saved || {}, { profileComplete: true }) });
      } else {
        const saved = await partnerModule.saveProfile(payload);
        store.patch({ partner: Object.assign({}, store.get('partner'), payload, saved || {}, { profileComplete: true }) });
      }
      this.setData({ editMode: false, saving: false });
      this.refresh();
      toast('资料已保存');
    } catch (err) {
      this.setData({ saving: false });
      toast((err.message || '资料保存失败') + '，请重试');
    }
  },

  onCopyCustomerNo() {
    if (!this.data.customerNo) {
      return;
    }
    wx.setClipboardData({
      data: this.data.customerNoDisplay || this.data.customerNo,
      success() {
        toast('已复制顾客编号');
      }
    });
  },

  onCopyPartnerNo() {
    if (!this.data.partnerNo) {
      return;
    }
    wx.setClipboardData({
      data: this.data.partnerNoDisplay || this.data.partnerNo,
      success() {
        toast('兼职编号已复制');
      }
    });
  },

  onGoBind() {
    wx.navigateTo({ url: '/pkg-customer/pages/bind/index' });
  },

  onRebind() {
    wx.navigateTo({ url: '/pkg-customer/pages/bind/index?mode=rebind' });
  },

  onUnbind() {
    if (!this.data.canEdit) {
      toast('开发者只读视角不能操作');
      return;
    }
    const that = this;
    wx.showActionSheet({
      itemList: RELEASE_OPTIONS.map((item) => item.label),
      success(res) {
        const picked = RELEASE_OPTIONS[res.tapIndex];
        if (!picked) {
          return;
        }
        wx.showModal({
          title: '解绑确认',
          content: '解绑后这位兼职看不到你的新订单，历史订单仍保留。确定解绑？',
          success(modal) {
            if (modal.confirm) {
              that.releaseBinding(picked);
            }
          }
        });
      }
    });
  },

  async releaseBinding(picked) {
    try {
      await bindModule.release({ reason: picked.reason, note: picked.label });
      store.patch({ binding: null });
      this.refresh();
      toast('已解绑，历史订单仍保留');
    } catch (err) {
      toast(err.message || '解绑失败，请重试');
    }
  },

  onMessages() {
    const path = this.data.isCustomer
      ? '/pkg-customer/pages/messages/index'
      : '/pkg-partner/pages/messages/index';
    wx.navigateTo({ url: path });
  },

  onService() {
    wx.navigateTo({ url: '/pkg-partner/pages/service-settings/index' });
  },

  onStats() {
    wx.navigateTo({ url: '/pkg-partner/pages/stats/index' });
  },

  onHelp() {
    wx.navigateTo({ url: '/pkg-customer/pages/help/index' });
  },

  onSwitchRole() {
    wx.showModal({
      title: '切换身份',
      content: '切换后回到身份选择页，未提交的操作会丢失。',
      success(res) {
        if (res.confirm) {
          wx.reLaunch({ url: '/pages/role/index' });
        }
      }
    });
  },

  onDeleteAccount() {
    if (!this.data.canEdit) {
      toast('开发者只读视角不能操作');
      return;
    }
    const that = this;
    wx.showModal({
      title: '注销账号',
      content: '注销后资料会被匿名化，账号不可恢复。确定继续？',
      confirmText: '确定注销',
      confirmColor: '#E54D42',
      success(modal) {
        if (!modal.confirm) {
          return;
        }
        that.doDeleteAccount();
      }
    });
  },

  async doDeleteAccount() {
    try {
      await userModule.deleteAccount('USER_INITIATED');
      store.reset();
      wx.reLaunch({ url: '/pages/role/index' });
    } catch (err) {
      toast(err.message || '注销失败，请先处理进行中的订单');
    }
  },

  onShareAppMessage() {
    if (this.data.isCustomer) {
      return { title: '校园快递代取', path: '/pages/role/index' };
    }
    return {
      title: '我在做校园代取，凭兼职编号找我下单',
      path: '/pages/role/index?bind=' + this.data.partnerNo
    };
  }
});
