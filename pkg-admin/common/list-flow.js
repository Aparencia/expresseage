// pkg-admin/common/list-flow.js · 后台列表页共用加载流程（零 wx.cloud；页面只提供 fetch/decorate/patch）
// 口径：UX_DEVELOPER §0.3/§8.1——五态/搜索/分页/含测试开关/重试在各页一致；页面保留同名薄委托，
//       使 `this.<name>(` 调用仍有同名定义（selftest-admin-pages §M pageMethodGaps）。
'use strict';

const feedback = require('./feedback');

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

/** 列表请求参数：keyword/includeTest/limit 全页一致；withStatus 时带 activeStatus；cursor 仅 loadMore。 */
function paramsOf(page, cfg, cursor) {
  const params = {
    keyword: page.data.keyword,
    includeTest: page.data.includeTest,
    limit: cfg.pageSize || PAGE_SIZE
  };
  if (cfg.withStatus) params.status = page.data.activeStatus;
  if (cursor) params.cursor = cursor;
  return params;
}

/** 首屏/重置加载：成功合并 rows + 服务端游标 + 页面附加 patch；失败交 feedback 统一文案并原样抛出。 */
function loadList(page, reset, cfg) {
  if (reset) {
    page.setData({ loading: !page.data.searched, searching: page.data.searched, error: '' });
  }
  return cfg.request(page, paramsOf(page, cfg)).then((result) => {
    const rows = cfg.decorate(page, result);
    const patch = {
      list: reset ? rows : page.data.list.concat(rows),
      nextCursor: (result && result.nextCursor) || '',
      loading: false,
      searching: false,
      loadingMore: false,
      searched: true
    };
    Object.assign(patch, cfg.patch ? cfg.patch(page, result) : {});
    page.setData(patch);
  }).catch((err) => {
    feedback.handleError(page, err);
    throw err;
  });
}

/** 触底加载下一页：四道闸（loading/searching/loadingMore/无游标）与失败 toast 与原页面一致。 */
function loadMore(page, cfg) {
  if (page.data.loading || page.data.searching || page.data.loadingMore || !page.data.nextCursor) return;
  page.setData({ loadingMore: true });
  cfg.request(page, paramsOf(page, cfg, page.data.nextCursor)).then((result) => {
    page.setData({
      list: page.data.list.concat(cfg.decorate(page, result)),
      nextCursor: (result && result.nextCursor) || '',
      loadingMore: false
    });
  }).catch((err) => {
    page.setData({ loadingMore: false });
    feedback.toast(err && err.message);
  });
}

/** 生成页面方法集合（Object.assign 进 Page 配置；`this` 即页面实例）。 */
function methods(cfg) {
  return {
    onUnload() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    },
    onReachBottom() {
      this.loadMore();
    },
    loadMore() {
      return loadMore(this, cfg);
    },
    onKeywordInput(event) {
      const keyword = String(event.detail.value || '');
      this.setData({ keyword: keyword });
      if (this.timer) {
        clearTimeout(this.timer);
      }
      if (typeof cfg.shouldSearch === 'function' && !cfg.shouldSearch(keyword)) {
        return;
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        loadList(this, true, cfg).catch(function () {});
      }, cfg.debounceMs || DEBOUNCE_MS);
    },
    onSearchConfirm(event) {
      if (typeof cfg.keywordOfSearch === 'function') {
        const keyword = cfg.keywordOfSearch(event, this);
        if (keyword !== undefined) this.setData({ keyword: keyword });
      }
      loadList(this, true, cfg).catch(function () {});
    },
    onIncludeTestChange(event) {
      this.setData({ includeTest: event.detail.value === true });
      loadList(this, true, cfg).catch(function () {});
    },
    onRetry() {
      loadList(this, true, cfg).catch(function () {});
    }
  };
}

module.exports = { methods, loadList, loadMore, PAGE_SIZE, DEBOUNCE_MS };
