// pages/profile/parts/save-flow.js · 我的页保存动作编排（页面胶水：api 调用 + toast + 续跳绑定）
// 口径：V4_UX_CUSTOMER §3.5/§4.10/§7、CONTRACT §4.2；自愈阶梯在 parts/avatar-save.js 纯件（可注入 fake 单测），
//       本文件只做「真实依赖接线 + 页面状态切换」，不写业务判据（页面层零判据，ARCHITECTURE §3.5）。
'use strict';

const store = require('../../../store/index');
const customerApi = require('../../../api/modules/customer');
const partnerApi = require('../../../api/modules/partner');
const uploadApi = require('../../../api/upload');
const enums = require('../../../shared/enums');
const vm = require('./view-model');
const avatarSave = require('./avatar-save');
const ui = require('./ui');

const BIND_PAGE = '/pkg-customer/pages/bind/index';

// 保存成功后的 store 合并：资料字段 + profileComplete + 绑定 roomTag（改宿舍会重分配）
function persist(page, payload) {
  if (page.data.isCustomer) {
    return customerApi.saveProfile(payload).then(function savedCustomer(saved) {
      const patch = { customer: vm.mergeCustomer(store.get('customer'), saved) };
      if (saved && saved.binding) {
        patch.binding = Object.assign({}, store.get('binding') || {}, saved.binding);
      }
      store.patch(patch);
      return saved;
    });
  }
  return partnerApi.saveProfile(payload).then(function savedPartner(saved) {
    store.patch({ partner: vm.mergePartner(store.get('partner'), saved) });
    return saved;
  });
}

// 头像换票重传：仅当本地还留着可重传的临时预览时执行；预览已失效就直接走默认头像保底（不重新选图）
function reuploadAvatar(page) {
  const preview = (page.data.form && page.data.form.avatarPreview) || '';
  if (!preview) {
    return Promise.reject(new Error('头像预览已失效，请重新选择头像'));
  }
  return uploadApi.prepareAndUpload({
    purpose: enums.UPLOAD_PURPOSE.AVATAR,
    filePath: preview
  }).then(function uploaded(result) {
    return { avatarTicket: result.uploadTicketId, avatarFileId: result.fileId };
  });
}

// 资料未完成时被绑定卡片/深链引导到本页，保存成功后自动续跳 bind（pendingBind 仅内存，不落盘）
function continuePendingBind(page) {
  const pending = page._pendingBind;
  if (!pending || !page.data.isCustomer) {
    return;
  }
  page._pendingBind = '';
  wx.navigateTo({ url: BIND_PAGE + '?bind=' + encodeURIComponent(pending) });
}

// 唯一保存入口：从「保存」按钮走到这里；自愈与保底都由 avatar-save 纯件编排
function save(page, payload) {
  page.setData({ saving: true });
  return avatarSave.saveWithRecovery({
    payload: payload,
    save: function saveProfile(next) {
      return persist(page, next);
    },
    reupload: function reupload() {
      return reuploadAvatar(page);
    }
  }).then(function saved(result) {
    page.setData({ saving: false, editMode: false });
    page.refresh();
    ui.toast(avatarSave.resultCopy(result));
    continuePendingBind(page);
    return result;
  }).catch(function failed(err) {
    page.setData({ saving: false });
    ui.toast((err && err.message) || '资料保存失败，请重试');
    return null;
  });
}

module.exports = {
  save
};
