// pkg-partner/pages/customer-detail/parts/avatar-refresh.js · 顾客头像临时 URL 重签（D42/task-20）
// 口径：CONTRACT v1.3 D42（头像展示统一走服务端 5 分钟临时 URL，私有存储不直读 cloud://）。
// 只刷身份行头像两块（avatarUrl 优先 / avatarFileId 回退），不动历史订单、备注与解绑资格；
// 重签失败保留旧值（页面继续显示上一条 URL 或默认头像），不弹错、不阻断页面。
'use strict';

const partnerApi = require('../../../../api/modules/partner');
const detailView = require('./detail-view');

function patch(page, data) {
  if (!page || !page.data || !page.data.view) {
    return false;
  }
  const customer = data && data.customer ? data.customer : {};
  const url = typeof customer.avatarUrl === 'string' ? customer.avatarUrl : '';
  const next = { 'view.avatarUrl': url };
  if (typeof customer.avatarFileId === 'string') {
    next['view.avatarFileId'] = customer.avatarFileId;
  }
  page.setData(next);
  return true;
}

// onShow / 点默认头像位重试：只重取 getCustomer 的档案块（不重拉订单页）
function pullLatest(page) {
  const raw = page && page.data ? page.data.bindingId : '';
  const bindingId = typeof raw === 'string' ? raw.trim() : '';
  if (!bindingId) {
    return Promise.resolve(false);
  }
  return partnerApi.getCustomer(detailView.buildProfileQuery(bindingId))
    .then((data) => patch(page, data || {}))
    .catch(() => false);
}

module.exports = { pullLatest };
