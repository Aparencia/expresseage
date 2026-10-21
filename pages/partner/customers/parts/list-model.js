// pages/partner/customers/parts/list-model.js · 客户列表页状态装配（纯件：零 wx、零请求）
// 口径：docs/V4_UX_PARTNER.md §3.5（服务端 keyword 搜索 + 游标分页；客户端不本地过滤/不二次排序）
//      docs/V4_DATA_MODEL.md §7.4 listBindings：服务端已排序+过滤+分页，返回 {list,nextCursor}
'use strict';

const view = require('../../../../utils/customer-view');

const PAGE_LIMIT = view.PAGE_LIMIT;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 页面初始状态（onLoad；首次 onShow 负责真正拉取）
function createState(options) {
  const opts = options || {};
  return {
    rows: [],
    keyword: view.normalizeKeyword(opts.keyword),
    nextCursor: '',
    loading: true,
    loadingMore: false,
    error: '',
    lastSuccessAt: 0,
    newRows: [],
    hasLoaded: false
  };
}

// 关键词变化 = 服务端重新搜索：清空旧结果与游标，避免"旧列表 + 新关键词"错配
function applyKeyword(state, keyword) {
  const next = view.normalizeKeyword(keyword);
  if (next === state.keyword) {
    return state;
  }
  return Object.assign({}, state, {
    keyword: next,
    rows: [],
    nextCursor: '',
    error: '',
    newRows: [],
    loading: true
  });
}

// 首屏/下拉刷新/搜索：重新从第一页拉（服务端已按 dormKey→roomTag 排好，不客户端排序）
function refreshQuery(state) {
  return { keyword: state.keyword, limit: PAGE_LIMIT };
}

// 触底加载下一页；无游标时返回 null（页面不再发无意义请求）
function nextQuery(state) {
  const cursor = textOf(state.nextCursor);
  if (!cursor) {
    return null;
  }
  return { keyword: state.keyword, limit: PAGE_LIMIT, cursor: cursor };
}

// 首屏/刷新响应：整页替换；与旧行对比得出"顾客新绑定"提示（顾客发起才能新增）
function applyResponse(state, data, options) {
  const opts = options || {};
  const rows = view.buildListRows(data && data.list);
  // 首次加载没有"旧行"可比，不出"新顾客已绑定"提示（避免把首屏误当新增）
  const newRows = state.hasLoaded ? view.newRowsOf(state.rows, rows) : [];
  return Object.assign({}, state, {
    rows: rows,
    nextCursor: textOf(data && data.nextCursor),
    loading: false,
    loadingMore: false,
    error: '',
    lastSuccessAt: typeof opts.nowMs === 'number' ? opts.nowMs : Date.now(),
    newRows: newRows,
    hasLoaded: true
  });
}

// 触底追加响应：只追加+去重（游标分页；不重置已加载行）
function applyMoreResponse(state, data, options) {
  const opts = options || {};
  const incoming = view.buildListRows(data && data.list);
  return Object.assign({}, state, {
    rows: view.appendRows(state.rows, incoming),
    nextCursor: textOf(data && data.nextCursor),
    loading: false,
    loadingMore: false,
    error: '',
    lastSuccessAt: typeof opts.nowMs === 'number' ? opts.nowMs : Date.now(),
    newRows: []
  });
}

// 失败：保留旧数据（不清空），错误态由 listStateOf 决定"错误卡 or 旧数据+上次成功时间"
function applyError(state, message) {
  return Object.assign({}, state, {
    loading: false,
    loadingMore: false,
    error: textOf(message) || '客户没加载出来，检查网络后重试'
  });
}

function beginLoad(state, append) {
  return Object.assign({}, state, append
    ? { loadingMore: true, error: '' }
    : { loading: true, loadingMore: false, error: '' });
}

function dismissBanner(state) {
  return Object.assign({}, state, { newRows: [] });
}

// 页面快照 → setData：状态机字段 + 只读/会话下的入口显隐（§6.3：READONLY 隐藏代客下单入口、会话内隐藏分享）
function buildSnapshot(state, options) {
  const opts = options || {};
  const listState = view.listStateOf({
    rows: state.rows,
    loading: state.loading,
    error: state.error,
    keyword: state.keyword,
    lastSuccessAt: state.lastSuccessAt,
    nextCursor: state.nextCursor
  });
  return Object.assign({}, listState, {
    rows: state.rows,
    keyword: state.keyword,
    bannerText: view.buildBannerText(state.newRows),
    headingText: state.nextCursor ? '客户' : '客户（' + state.rows.length + '）',
    partnerNo: textOf(opts.partnerNo),
    readonly: opts.readonly === true,
    session: opts.session === true,
    showCreateEntry: opts.readonly !== true,
    showShare: opts.session !== true,
    lastSuccessAt: state.lastSuccessAt
  });
}

module.exports = {
  PAGE_LIMIT,
  createState,
  applyKeyword,
  refreshQuery,
  nextQuery,
  applyResponse,
  applyMoreResponse,
  applyError,
  beginLoad,
  dismissBanner,
  buildSnapshot
};
