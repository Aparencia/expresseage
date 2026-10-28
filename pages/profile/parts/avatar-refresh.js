// pages/profile/parts/avatar-refresh.js · 我的页头像临时 URL 取数与重签（页面胶水：api 调用 + store 合并）
// 口径：CONTRACT v1.3 D42（头像私有存储不直读 cloud://；本人 user.avatarUrl / 绑定对方 bind.getCurrent 5 分钟 URL）。
// 本文件零 wx、零 setData：页面 onShow/下拉/头像重试只调用这里，页面保持「取参→调 api→setData→事件转发」。
'use strict';

const store = require('../../../store/index');
const userApi = require('../../../api/modules/user');
const customerApi = require('../../../api/modules/customer');
const bindApi = require('../../../api/modules/bind');
const enums = require('../../../shared/enums');
const vm = require('./view-model');

function roleOf(snap) {
  return (snap.viewContext && snap.viewContext.role) || snap.activeRole;
}

// 本人两种角色块各写回 avatarFileId/avatarUrl（无文档且无头像时不凭空建块）
function signedPatch(signed) {
  const patch = {};
  if (!signed) {
    return patch;
  }
  const customer = store.get('customer');
  if (signed.customer && (customer || signed.customer.avatarFileId)) {
    patch.customer = Object.assign({}, customer || {}, {
      avatarFileId: signed.customer.avatarFileId || '',
      avatarUrl: signed.customer.avatarUrl || ''
    });
  }
  const partner = store.get('partner');
  if (signed.partner && (partner || signed.partner.avatarFileId)) {
    patch.partner = Object.assign({}, partner || {}, {
      avatarFileId: signed.partner.avatarFileId || '',
      avatarUrl: signed.partner.avatarUrl || ''
    });
  }
  return patch;
}

// onShow/下拉：两端都重签本人头像 URL（兼职端原先不刷新）；顾客额外取资料与当前绑定（含对方 URL）
function pullLatest(page) {
  const role = roleOf(store.snapshot());
  const tasks = [userApi.avatarUrl().catch(function ignore() { return null; })];
  if (role === enums.ROLES.CUSTOMER) {
    tasks.push(customerApi.getProfile().catch(function ignore() { return null; }));
    tasks.push(bindApi.getCurrent().catch(function ignore() { return null; }));
  }
  return Promise.all(tasks).then(function apply(results) {
    const patch = signedPatch(results[0]);
    const profile = results[1];
    const current = results[2];
    if (profile) {
      patch.customer = vm.mergeCustomer(patch.customer || store.get('customer'), {
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
    if (page && typeof page.refresh === 'function') {
      page.refresh();
    }
  }).catch(function ignore() {
    // 读刷新失败保留旧数据，页面不打断（错误条由 switch-bar/入口页负责）
  });
}

// 编辑态头像位重试：重签本人 URL 后把新 URL 写回表单（本地预览仍优先，不改用户已选的新图）
function retryForm(page) {
  return pullLatest(page).then(function syncFormAvatar() {
    const snap = store.snapshot();
    const source = page.data.isCustomer ? (snap.customer || {}) : (snap.partner || {});
    page.setData({ 'form.avatarUrl': source.avatarUrl || '' });
  });
}

// 绑定对方头像失败 → 重拉 bind.getCurrent 拿新 URL（仅 ACTIVE 绑定；解绑后 DTO 不再下发）
function retryBinding(page) {
  if (!page.data.isCustomer) {
    return Promise.resolve();
  }
  return bindApi.getCurrent().then(function signed(current) {
    if (current) {
      store.patch({ binding: vm.normalizeBinding(current) });
      page.refresh();
    }
  }).catch(function ignore() {
    // 重签失败保留默认头像，不打断页面
  });
}

module.exports = {
  pullLatest,
  retryForm,
  retryBinding
};
