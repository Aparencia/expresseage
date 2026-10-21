// pages/profile/index.js · 我的（tab5，顾客/兼职共用；按全局角色渲染，不串数据）
// 口径：V4_UX_CUSTOMER §3.5/§7/§9.4、V4_UX_PARTNER §3.10/§6；只做取参 → 调 api → setData → 事件转发，
// 不出现 wx.cloud / 集合名 / action 字符串 / 七状态字面量（ARCHITECTURE §3.5）。
'use strict';

const store = require('../../store/index');
const modeGuard = require('../../api/mode-guard');
const customerApi = require('../../api/modules/customer');
const partnerApi = require('../../api/modules/partner');
const bindApi = require('../../api/modules/bind');
const userApi = require('../../api/modules/user');
const uploadApi = require('../../api/upload');
const route = require('../../config/route');
const storage = require('../../utils/storage');
const enums = require('../../shared/enums');
const vm = require('./parts/view-model');
const ui = require('./parts/ui');

const BIND_PAGE = '/pkg-customer/pages/bind/index';
const CUSTOMER_ORDERS_PAGE = '/pages/customer/orders/index';
const CUSTOMER_MESSAGES_PAGE = '/pkg-customer/pages/messages/index';
const PARTNER_MESSAGES_PAGE = '/pkg-partner/pages/messages/index';
const SERVICE_PAGE = '/pkg-partner/pages/service-settings/index';
const STATS_PAGE = '/pkg-partner/pages/stats/index';
const HELP_PAGE = '/pkg-customer/pages/help/index';
const DELETION_CONFIRM_TEXT = '注销';
const READONLY_COPY = '开发者只读视角不能操作';

Page({
  data: {
    loading: true,
    role: '',
    isCustomer: true,
    viewSession: false,
    canEdit: true,
    readonly: false,
    suspended: false,
    closed: false,
    editMode: false,
    saving: false,
    uploadingAvatar: false,
    showSwitchRole: false,
    profile: { displayName: '', avatarFileId: '' },
    profileCard: null,
    bindingCard: null,
    partnerCard: null,
    customerNo: '',
    customerNoDisplay: '',
    customerComplete: false,
    orderSummaryText: vm.DEFAULT_ORDER_SUMMARY,
    orderSummaryFromDto: false,
    messagesBadge: 0,
    version: '开发版',
    zoneLabels: vm.ZONE_LABELS,
    buildingLabels: vm.BUILDING_LABELS,
    nameLimit: vm.NAME_LIMIT,
    form: null,
    unbindVisible: false,
    unbindReasonText: '',
    unbindNote: '',
    unbindNoteLimit: vm.RELEASE_NOTE_LIMIT,
    unbindSubmitting: false
  },

  onLoad(options) {
    const opts = options || {};
    this._pendingBind = String(opts.bind || '').trim();
    this._openEdit = String(opts.edit || '') === '1';
    this.refresh();
    this.unsubscribe = store.subscribe(() => this.refresh());
  },

  onShow() {
    if (!this.guard()) {
      return;
    }
    this.refresh();
    if (this._openEdit) {
      this._openEdit = false;
      if (this.data.canEdit) {
        this.openEditForm();
      }
    }
    this.pullLatest();
  },

  onUnload() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },

  // 弹层遮罩阻止穿透滚动（wxml: catchtouchmove）
  noop() {},

  onPullDownRefresh() {
    this.pullLatest().then(() => {
      wx.stopPullDownRefresh();
    }).catch(() => {
      wx.stopPullDownRefresh();
    });
  },

  guard() {
    const snap = store.snapshot();
    if (!snap.viewContext && !snap.activeRole) {
      wx.reLaunch({ url: route.ROLE_PAGE });
      return false;
    }
    return true;
  },

  refresh() {
    const snap = store.snapshot();
    const built = vm.buildVm(snap);
    const readonly = modeGuard.isReadonly();
    const canEdit = modeGuard.canRenderWriteButton();
    this.setData(Object.assign({}, built, {
      loading: false,
      readonly: readonly,
      canEdit: canEdit,
      editMode: this.data.editMode && canEdit,
      showSwitchRole: built.roles.length > 1 && !built.viewSession && canEdit && !built.closed,
      version: ui.readVersion()
    }));
  },

  // 头像/昵称 onShow 重取（UX_CUSTOMER §3.5 头像缓存口径）；兼职侧无独立读接口，靠 bootstrap 水合。
  pullLatest() {
    const snap = store.snapshot();
    const role = (snap.viewContext && snap.viewContext.role) || snap.activeRole;
    if (role !== enums.ROLES.CUSTOMER) {
      return Promise.resolve();
    }
    return Promise.all([
      customerApi.getProfile().catch(function ignore() { return null; }),
      bindApi.getCurrent().catch(function ignore() { return null; })
    ]).then((results) => {
      const patch = {};
      const profile = results[0];
      const current = results[1];
      if (profile) {
        patch.customer = vm.mergeCustomer(store.get('customer'), {
          profile: profile,
          profileCompleted: profile.profileCompleted === true
        });
      }
      if (current) {
        patch.binding = vm.normalizeBinding(current);
      }
      if (Object.keys(patch).length > 0) {
        store.patch(patch);
      }
      this.refresh();
    }).catch(function ignore() {
      // 读刷新失败保留旧数据，页面不打断（错误条由 switch-bar/入口页负责）
    });
  },

  onToggleEdit() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    if (this.data.editMode) {
      this.setData({ editMode: false });
      this.refresh();
      return;
    }
    this.openEditForm();
  },

  openEditForm() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    const snap = store.snapshot();
    const source = this.data.isCustomer ? (snap.customer || {}) : (snap.partner || {});
    this.setData({ editMode: true, form: vm.buildForm(source, this.data.isCustomer) });
  },

  onNicknameInput(event) {
    const clamped = vm.clampNickname(event.detail && event.detail.value);
    if (clamped.truncated) {
      ui.toast('昵称最多 20 个字，已截断');
    }
    this.setData({ 'form.displayName': clamped.value });
  },

  onChooseAvatar(event) {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    if (this.data.uploadingAvatar) {
      return;
    }
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (!avatarUrl) {
      return;
    }
    this.setData({ 'form.avatarPreview': avatarUrl, uploadingAvatar: true });
    uploadApi.prepareAndUpload({ purpose: enums.UPLOAD_PURPOSE.AVATAR, filePath: avatarUrl }).then((uploaded) => {
      this.setData({
        uploadingAvatar: false,
        'form.avatarTicket': uploaded.uploadTicketId,
        'form.avatarFileId': uploaded.fileId,
        'form.avatarAction': 'replace'
      });
    }).catch((err) => {
      this.setData({ uploadingAvatar: false, 'form.avatarPreview': '' });
      ui.toast((err && err.message) || '头像上传失败，可稍后重试或先用默认头像');
    });
  },

  onUseDefaultAvatar() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    this.setData({
      'form.avatarPreview': '',
      'form.avatarTicket': '',
      'form.avatarFileId': '',
      'form.avatarAction': 'default'
    });
    ui.toast('已选择默认头像，保存后生效');
  },

  // 预览断图（临时文件读失败/坏图）：清掉预览回到默认头像，不裂图不空白
  onAvatarPreviewError() {
    this.setData({ 'form.avatarPreview': '' });
    ui.toast('头像加载失败，已改用默认头像；可重新选择或稍后再传');
  },

  onZoneChange(event) {
    this.applyDormPatch({ zoneIndex: Number(event.detail.value) });
  },

  onBuildingChange(event) {
    this.applyDormPatch({ buildingIndex: Number(event.detail.value) });
  },

  onRoomInput(event) {
    this.applyDormPatch({ room: vm.digitsOnly(event.detail && event.detail.value) });
  },

  onPhoneTailInput(event) {
    const form = Object.assign({}, this.data.form, {
      phoneTail: vm.digitsOnly(event.detail && event.detail.value, vm.PHONE_TAIL_LIMIT)
    });
    this.setData({ form: form });
  },

  applyDormPatch(partial) {
    const form = Object.assign({}, this.data.form, partial);
    form.dormPreview = vm.previewDorm(form);
    this.setData({ form: form });
  },

  onSave() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    if (this.data.saving) {
      return;
    }
    const checked = vm.buildSavePayload({ isCustomer: this.data.isCustomer, form: this.data.form });
    if (!checked.ok) {
      ui.toast(checked.message);
      return;
    }
    this.setData({ saving: true });
    this.persistProfile(checked.payload).then(() => {
      this.setData({ saving: false, editMode: false });
      this.refresh();
      ui.toast('资料已保存');
      this.continuePendingBind();
    }).catch((err) => {
      this.setData({ saving: false });
      ui.toast((err && err.message) || '资料保存失败，请重试');
    });
  },

  persistProfile(payload) {
    if (this.data.isCustomer) {
      return customerApi.saveProfile(payload).then((saved) => {
        const patch = { customer: vm.mergeCustomer(store.get('customer'), saved) };
        if (saved && saved.binding) {
          patch.binding = Object.assign({}, store.get('binding') || {}, saved.binding);
        }
        store.patch(patch);
      });
    }
    return partnerApi.saveProfile(payload).then((saved) => {
      store.patch({ partner: vm.mergePartner(store.get('partner'), saved) });
    });
  },

  // 资料未完成时被绑定卡片/深链引导到本页，保存成功后自动续跳 bind（pendingBind 仅内存）
  continuePendingBind() {
    const pending = this._pendingBind;
    if (!pending || !this.data.isCustomer) {
      return;
    }
    this._pendingBind = '';
    wx.navigateTo({ url: BIND_PAGE + '?bind=' + encodeURIComponent(pending) });
  },

  onCopyCustomerNo() {
    ui.copyText(this.data.customerNoDisplay || this.data.customerNo, '已复制顾客编号');
  },

  onCopyPartnerNo() {
    const card = this.data.partnerCard || {};
    ui.copyText(card.partnerNo, '兼职编号已复制');
  },

  onGoBind() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    wx.navigateTo({ url: BIND_PAGE });
  },

  onRebind() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    wx.navigateTo({ url: BIND_PAGE + '?mode=rebind' });
  },

  onUnbind() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    const reason = vm.releaseReason();
    this.setData({
      unbindVisible: true,
      unbindReasonText: reason.text,
      unbindNote: '',
      unbindSubmitting: false
    });
  },

  onUnbindNoteInput(event) {
    const note = String((event.detail && event.detail.value) || '').slice(0, vm.RELEASE_NOTE_LIMIT);
    this.setData({ unbindNote: note });
  },

  onUnbindCancel() {
    if (this.data.unbindSubmitting) {
      return;
    }
    this.setData({ unbindVisible: false });
  },

  onUnbindConfirm() {
    if (this.data.unbindSubmitting) {
      return;
    }
    const reason = vm.releaseReason();
    this.setData({ unbindSubmitting: true });
    bindApi.release({ reason: reason.code, note: this.data.unbindNote }).then(() => {
      store.patch({ binding: null });
      this.setData({ unbindVisible: false, unbindSubmitting: false });
      this.refresh();
      ui.toast('已解绑，历史订单仍保留');
    }).catch((err) => {
      this.setData({ unbindVisible: false, unbindSubmitting: false });
      ui.toast((err && err.message) || '解绑失败，请重试');
    });
  },

  onMessages() {
    wx.navigateTo({ url: this.data.isCustomer ? CUSTOMER_MESSAGES_PAGE : PARTNER_MESSAGES_PAGE });
  },

  onService() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    wx.navigateTo({ url: SERVICE_PAGE });
  },

  onStats() {
    wx.navigateTo({ url: STATS_PAGE });
  },

  onOrders() {
    wx.switchTab({ url: CUSTOMER_ORDERS_PAGE });
  },

  // 隐私政策/用户协议/帮助/联系开发者统一走帮助页的 doc 参数（?doc=privacy|terms|about）
  onDocTap(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const doc = dataset.doc || '';
    wx.navigateTo({ url: doc ? HELP_PAGE + '?doc=' + doc : HELP_PAGE });
  },

  onSwitchRole() {
    if (!this.data.canEdit || this.data.viewSession) {
      return;
    }
    const currentRole = this.data.isCustomer ? enums.ROLES.CUSTOMER : enums.ROLES.PARTNER;
    wx.showModal({
      title: '切换身份',
      content: '切换后回到身份选择页，未提交的操作会丢失。',
      success(res) {
        if (res.confirm) {
          // 记下「上一次使用的角色」供角色页给建议（只经 utils/storage 白名单）
          storage.setLastRole(currentRole);
          wx.reLaunch({ url: route.ROLE_PAGE });
        }
      }
    });
  },

  // 注销：两步确认（不可撤销说明 + 输入「注销」），服务端再校验进行中订单
  onDeleteAccount() {
    if (!this.data.canEdit) {
      ui.toast(READONLY_COPY);
      return;
    }
    wx.showModal({
      title: '注销账号',
      content: '注销不可撤销：订单与资料会被匿名化或删除，绑定会解除。进行中的订单会阻止注销。',
      confirmText: '继续',
      confirmColor: '#E54D42',
      success: (res) => {
        if (res.confirm) {
          this.confirmDeletionText();
        }
      }
    });
  },

  confirmDeletionText() {
    wx.showModal({
      title: '确认注销',
      editable: true,
      placeholderText: '输入「注销」两个字',
      confirmText: '确定注销',
      confirmColor: '#E54D42',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        if (String(res.content || '').trim() !== DELETION_CONFIRM_TEXT) {
          ui.toast('请输入「注销」两个字确认');
          return;
        }
        this.doDeleteAccount();
      }
    });
  },

  doDeleteAccount() {
    userApi.deleteAccount({ confirmText: DELETION_CONFIRM_TEXT }).then(() => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      store.reset();
      wx.showModal({
        title: '已注销',
        content: '订单与资料已匿名化或删除，30 天内完成彻底清理；重新登录将创建新的顾客资料与编号。',
        showCancel: false,
        confirmText: '知道了',
        success() {
          wx.reLaunch({ url: route.ROLE_PAGE });
        }
      });
    }).catch((err) => {
      ui.toast((err && err.message) || '注销失败，请稍后重试');
    });
  },

  onShareAppMessage() {
    const card = this.data.partnerCard || {};
    if (!this.data.isCustomer && !this.data.viewSession && card.partnerNo) {
      return {
        title: '我在做校园代取，凭兼职编号找我下单',
        path: '/pages/role/index?bind=' + encodeURIComponent(card.partnerNo)
      };
    }
    return { title: '校园快递代取', path: '/pages/role/index' };
  }
});
