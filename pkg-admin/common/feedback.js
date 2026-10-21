// pkg-admin/common/feedback.js · 后台页面统一反馈与错误处理
// 规则：错误文案只 toast 服务端 message；FORBIDDEN 一律退场（不显示后台空壳）；页面不自行拼错误码文案。

const { PAGE_URLS } = require('./constants');
const { formatClock } = require('./format');

const FORBIDDEN_CODE = 'FORBIDDEN';

function toast(title) {
  if (!title) return;
  wx.showToast({ title: String(title), icon: 'none' });
}

function confirm(options) {
  return wx.showModal({
    title: options.title || '确认操作',
    content: options.content || '',
    confirmText: options.confirmText || '确认',
    confirmColor: options.danger ? '#E54D42' : '#1F7A5C',
    cancelText: '取消',
    editable: options.editable === true,
    placeholderText: options.placeholderText || ''
  });
}

function alert(title, content) {
  return wx.showModal({
    title: title || '提示',
    content: content || '',
    showCancel: false,
    confirmText: '知道了'
  });
}

function goBack(fallbackUrl) {
  if (getCurrentPages().length > 1) {
    wx.navigateBack();
    return;
  }
  wx.reLaunch({ url: fallbackUrl || PAGE_URLS.overview });
}

function go(url) {
  if (!url) return;
  wx.navigateTo({ url });
}

function reLaunch(url) {
  wx.reLaunch({ url });
}

function redirectOut() {
  wx.reLaunch({ url: PAGE_URLS.launch });
}

function handleError(page, err, fallbackText) {
  const message = err && err.message ? err.message : (fallbackText || '没连上服务器，先检查网络；请稍后重试。');
  if (err && err.code === FORBIDDEN_CODE) {
    page.setData({ loading: false, loadingMore: false, forbidden: true });
    toast('当前账号没有后台权限，已返回首页。');
    setTimeout(redirectOut, 800);
    return;
  }
  page.setData({
    loading: false,
    loadingMore: false,
    error: message,
    errorAt: formatClock(Date.now())
  });
}

function recordSuccess(page, err) {
  if (!err) return;
  handleError(page, err);
}

module.exports = {
  FORBIDDEN_CODE,
  toast,
  confirm,
  alert,
  goBack,
  go,
  reLaunch,
  redirectOut,
  handleError,
  recordSuccess
};
