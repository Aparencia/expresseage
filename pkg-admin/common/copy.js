// pkg-admin/common/copy.js · 后台统一文案纯件（零 wx、零 setData、零网络）
// 口径：V4_UX_DEVELOPER §0.3（五态）/§11.5（空态与错误态）/§11.4（无权限与写拒绝）。
// 页面层不自造错误文案：网络类错误给统一"说真话 + 下一步"；业务错误一律用服务端 message。

const NETWORK_CODES = ['DEPENDENCY_FAILED', 'INTERNAL_ERROR'];

const NETWORK_ERROR_TEXT = '没连上服务器，先检查网络；已加载的数据可能不是最新，请重试。';
const UNKNOWN_ERROR_TEXT = '服务返回异常，请稍后重试。';
const FORBIDDEN_TITLE = '当前账号没有后台权限';
const FORBIDDEN_TEXT = '后台仅对开发者白名单开放，正在返回首页…';
const FORBIDDEN_TOAST = '当前账号没有后台权限，已返回首页。';
const FORBIDDEN_REDIRECT_MS = 1200;

// 错误对象 → 展示文案；FORBIDDEN 由页面五态接管（返回空串，不显示普通错误条）
function errorText(err) {
  const code = err && err.code ? String(err.code) : '';
  if (code === 'FORBIDDEN') return '';
  if (!code || NETWORK_CODES.indexOf(code) >= 0) return NETWORK_ERROR_TEXT;
  const message = err && err.message ? String(err.message) : '';
  return message || UNKNOWN_ERROR_TEXT;
}

// 空态/搜索空态文案（列表页共用；关键词与筛选状态由页面传入）
function listEmptyText(options) {
  const opts = options || {};
  if (opts.keyword && String(opts.keyword).length > 0) {
    return opts.searchEmpty || '没有找到匹配的记录，换个关键词试试。';
  }
  return opts.empty || '还没有数据。';
}

// 无权限五态：页面只渲染说明卡，不渲染任何后台数据
function forbiddenView() {
  return { title: FORBIDDEN_TITLE, text: FORBIDDEN_TEXT };
}

module.exports = {
  NETWORK_CODES,
  NETWORK_ERROR_TEXT,
  UNKNOWN_ERROR_TEXT,
  FORBIDDEN_TITLE,
  FORBIDDEN_TEXT,
  FORBIDDEN_TOAST,
  FORBIDDEN_REDIRECT_MS,
  errorText,
  listEmptyText,
  forbiddenView
};
