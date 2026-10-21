// pkg-admin/common/feedback.js · 后台页面统一反馈与错误处理（五态出口集中在这里）
// 口径：V4_UX_DEVELOPER §0.3/§8.1/§11.4——FORBIDDEN 清数据、整页说明、回普通首页；错误文案说真话给下一步；不自行拼错误码文案。
'use strict';

const { PAGE_URLS } = require('./constants');
const copy = require('./copy');

const FORBIDDEN_CODE = 'FORBIDDEN';

function toast(title) {
  if (!title) return;
  wx.showToast({ title: String(title), icon: 'none' });
}

function confirm(options) {
  const opts = options || {};
  return wx.showModal({
    title: opts.title || '确认操作',
    content: opts.content || '',
    confirmText: opts.confirmText || '确认',
    confirmColor: opts.danger ? '#E54D42' : '#1F7A5C',
    cancelText: '取消',
    editable: opts.editable === true,
    placeholderText: opts.placeholderText || ''
  });
}

function go(url) {
  if (!url) return;
  wx.navigateTo({ url });
}

function redirectOut() {
  wx.reLaunch({ url: PAGE_URLS.launch });
}

// 无权限：清掉已加载的后台数据（不显示空壳），整页说明后回普通首页
function clearLoadedData(page) {
  page.setData({
    list: [],
    audit: [],
    counts: null,
    countsText: '',
    detail: null,
    customer: null,
    order: null,
    binding: null,
    candidates: [],
    testAccounts: [],
    exceptions: [],
    failures: [],
    recentOrders: [],
    selected: null,
    selectedTest: null,
    statusTabs: [],
    systemLines: []
  });
}

function handleError(page, err, fallbackText) {
  const code = err && err.code ? err.code : '';
  if (code === FORBIDDEN_CODE) {
    clearLoadedData(page);
    page.setData({ loading: false, loadingMore: false, error: '', forbidden: copy.forbiddenView() });
    toast(copy.FORBIDDEN_TOAST);
    setTimeout(redirectOut, copy.FORBIDDEN_REDIRECT_MS);
    return;
  }
  const message = copy.errorText(err) || fallbackText || copy.UNKNOWN_ERROR_TEXT;
  page.setData({ loading: false, loadingMore: false, error: message });
}

module.exports = {
  FORBIDDEN_CODE,
  toast,
  confirm,
  go,
  redirectOut,
  handleError
};
