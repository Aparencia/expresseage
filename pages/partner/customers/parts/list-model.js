// pages/partner/customers/parts/list-model.js · 客户列表页状态装配（纯件：零 wx、零请求）
// 口径：docs/ux/V4_UX_PARTNER.md §3.5（服务端 keyword 搜索 + 游标分页；客户端不本地过滤/不二次排序）
//      docs/data/V4_DATA_MODEL.md §7.4 listBindings：服务端已排序+过滤+分页，返回 {list,nextCursor}
// D67（批 24）：筛选选中态/查询参数/空态文案在 parts/filter-model.js（纯件）；本文件只把筛选并入查询与快照。
'use strict';

const view = require('../../../../utils/customer-view');
const filterModel = require('./filter-model');

const PAGE_LIMIT = view.PAGE_LIMIT;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// 服务端游标 = 不透明对象（listBindings 返回 {dormKey,allocSeq}）：只判有/无、原样回传；
// 不得 textOf()（对象恒为 ''，会把「还有下一页」误判成末页 —— 2026-11-05 只出 20 条）。
function cursorOf(value) {
  return view.hasCursorOf(value) ? value : null;
}

// D42（task-20）：行头像临时 URL 由服务端随 partner.listBindings 下发（私有存储不可直读 cloud://）。
// buildListRow 只做展示视图，这里按 bindingId 把 avatarUrl 补回行；未签发=空串，
// avatar-view 自动回退 fileId → 默认头像（读失败不阻断列表）。
function attachAvatarUrls(rows, rawList) {
  const urls = {};
  listOf(rawList).forEach((item) => {
    const id = textOf(item && item.bindingId);
    if (id && typeof item.avatarUrl === 'string' && item.avatarUrl) {
      urls[id] = item.avatarUrl;
    }
  });
  return listOf(rows).map((row) => Object.assign({}, row, { avatarUrl: urls[row.bindingId] || '' }));
}

// 页面初始状态（onLoad；首次 onShow 负责真正拉取）
function createState(options) {
  const opts = options || {};
  return {
    rows: [],
    keyword: view.normalizeKeyword(opts.keyword),
    filters: filterModel.createFilters(),
    nextCursor: null,
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
    nextCursor: null,
    error: '',
    newRows: [],
    loading: true
  });
}

// D67：筛选选中态变化 = 服务端重新筛（与关键词同套路）；选中态本身在 filter-model，本文件只管状态机。
// 只有「生效的查询参数」变化时才清空旧行/游标并置 loading（如刚点「按苑」还没选苑时只更新 UI，不闪骨架）。
function applyFilterState(state, nextFilters) {
  if (filterModel.sameFilters(state.filters, nextFilters)) {
    return state;
  }
  const next = Object.assign({}, state, { filters: nextFilters });
  if (querySignatureOf(state) === querySignatureOf(next)) {
    return next;
  }
  return Object.assign(next, {
    rows: [],
    nextCursor: null,
    error: '',
    newRows: [],
    loading: true
  });
}

// chips 单选：点选中项/「全部」= 取消筛选（选中态可清除）。
function applyFilterChip(state, key) {
  return applyFilterState(state, filterModel.applyChip(state.filters, key));
}

// 二级苑选择：再点已选苑 = 取消（按苑回全部；按楼栋保留楼栋）。
function selectFilterZone(state, zone) {
  return applyFilterState(state, filterModel.selectZone(state.filters, zone));
}

// 二级楼栋选择：再点已选栋 = 取消楼栋筛选。
function selectFilterBuilding(state, buildingNo) {
  return applyFilterState(state, filterModel.selectBuilding(state.filters, buildingNo));
}

function clearFilters(state) {
  return applyFilterState(state, filterModel.createFilters());
}

// 首屏/下拉刷新/搜索：重新从第一页拉（服务端已按 dormKey→roomTag 排好，不客户端排序）
function refreshQuery(state) {
  return Object.assign(
    { keyword: state.keyword, limit: PAGE_LIMIT },
    filterModel.queryOf(state.filters)
  );
}

// 触底加载下一页；无游标时返回 null（页面不再发无意义请求）
function nextQuery(state) {
  const cursor = cursorOf(state.nextCursor);
  if (!cursor) {
    return null;
  }
  return Object.assign(
    { keyword: state.keyword, limit: PAGE_LIMIT, cursor: cursor },
    filterModel.queryOf(state.filters)
  );
}

// 有效查询签名：用于判断「筛选选中态变了但请求参数没变」（如进入按苑尚未选苑），避免无谓重拉/骨架闪烁。
function querySignatureOf(state) {
  return JSON.stringify(refreshQuery(state));
}

// 首屏/刷新响应：整页替换；与旧行对比得出"顾客新绑定"提示（顾客发起才能新增）
// 批20-C：同 bindingId 且 avatarFileId 未变 → 沿用旧 avatarUrl（服务端每次重签 URL 不闪头像）；
// 头像加载失败点重试时传 freshAvatars=true，必须换新签 URL（沿用旧 URL 重试必然再失败）。
function applyResponse(state, data, options) {
  const opts = options || {};
  const built = attachAvatarUrls(view.buildListRows(data && data.list), data && data.list);
  const rows = opts.freshAvatars === true ? built : view.keepAvatarUrls(state.rows, built);
  // 首次加载没有"旧行"可比，不出"新顾客已绑定"提示（避免把首屏误当新增）
  const newRows = state.hasLoaded ? view.newRowsOf(state.rows, rows) : [];
  return Object.assign({}, state, {
    rows: rows,
    nextCursor: cursorOf(data && data.nextCursor),
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
  const incoming = attachAvatarUrls(view.buildListRows(data && data.list), data && data.list);
  const merged = view.appendRows(state.rows, incoming);
  return Object.assign({}, state, {
    rows: view.keepAvatarUrls(state.rows, merged),
    nextCursor: cursorOf(data && data.nextCursor),
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

// ── 批20-C：首屏流式渲染（分片 setData）+ 刷新行级 diff ─────────────────────────────
const STREAM_CHUNK_ROWS = view.STREAM_CHUNK_ROWS;

// 分片计划：首片立即 setData，其余片按帧以 rows[n] 路径追加（每片 ≤10 行，不一次性渲染整页）
function chunkPlanOf(rows) {
  const chunks = view.chunkRowsOf(rows, STREAM_CHUNK_ROWS);
  if (!chunks.length) {
    return { first: [], rest: [], hasRest: false };
  }
  return { first: chunks[0], rest: chunks.slice(1), hasRest: chunks.length > 1 };
}

// 分片追加补丁：只发新片 rows[n]（不重发已渲染行）
function appendRowPatches(renderedCount, rows) {
  const start = typeof renderedCount === 'number' && renderedCount > 0 ? Math.floor(renderedCount) : 0;
  const list = listOf(rows);
  const patches = {};
  list.forEach((row, offset) => {
    patches['rows[' + (start + offset) + ']'] = row;
  });
  return { patches: patches, renderedCount: start + list.length };
}

// 分片计划 → 逐片追加补丁（页面按帧 setData(appendPatches[i])）
function appendPlanOf(plan) {
  const source = plan || {};
  let rendered = Array.isArray(source.first) ? source.first.length : 0;
  const appendPatches = (Array.isArray(source.rest) ? source.rest : []).map((rowsChunk) => {
    const step = appendRowPatches(rendered, rowsChunk);
    rendered = step.renderedCount;
    return step.patches;
  });
  return { appendPatches: appendPatches, renderedCount: rendered };
}

function sameRowOf(left, right) {
  if (!left || !right) {
    return false;
  }
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

// 行级 diff：行数+顺序（bindingId）不变 → 只返回变化行的 rows[n] 补丁（可为空对象）；
// 结构变化（新增/解绑/换关键词）→ 返回 null，由调用方回退整表分片，避免按旧下标打错补丁。
function rowPatchesOf(previous, next) {
  const prev = listOf(previous);
  const nxt = listOf(next);
  if (prev.length !== nxt.length) {
    return null;
  }
  for (let index = 0; index < prev.length; index += 1) {
    if (!prev[index] || !nxt[index] || prev[index].bindingId !== nxt[index].bindingId) {
      return null;
    }
  }
  const patches = {};
  for (let index = 0; index < nxt.length; index += 1) {
    if (!sameRowOf(prev[index], nxt[index])) {
      patches['rows[' + index + ']'] = nxt[index];
    }
  }
  return patches;
}

// 触底追加：旧列表是新列表的严格前缀 → 只追加新行（不清空已渲染列表、不重发旧行）
function prefixAppendPatches(previous, next) {
  const prev = listOf(previous);
  const nxt = listOf(next);
  if (!prev.length || nxt.length <= prev.length) {
    return null;
  }
  for (let index = 0; index < prev.length; index += 1) {
    if (!prev[index] || !nxt[index] || prev[index].bindingId !== nxt[index].bindingId) {
      return null;
    }
  }
  const chunks = view.chunkRowsOf(nxt.slice(prev.length), STREAM_CHUNK_ROWS);
  if (!chunks.length) {
    return null;
  }
  let rendered = prev.length;
  return chunks.map((rowsChunk) => {
    const step = appendRowPatches(rendered, rowsChunk);
    rendered = step.renderedCount;
    return step.patches;
  });
}

// 加载结果 → 页面 setData 计划：结构不变只发变化行；触底追加只发新行；否则首片 + 分帧追加（同工作台 P0-5）
function viewPlanOf(state, options) {
  const opts = options || {};
  const snapshot = buildSnapshot(state, opts);
  const patches = rowPatchesOf(opts.prevRows, state.rows);
  if (patches) {
    const patch = Object.assign({}, snapshot);
    delete patch.rows;
    return { mode: 'diff', setData: Object.assign(patch, patches), chunk: null, appendPatches: [] };
  }
  const appended = prefixAppendPatches(opts.prevRows, state.rows);
  if (appended) {
    const appendPatch = Object.assign({}, snapshot);
    delete appendPatch.rows;
    return { mode: 'append', setData: appendPatch, chunk: { first: listOf(opts.prevRows), rest: [] }, appendPatches: appended };
  }
  const chunk = chunkPlanOf(state.rows);
  const append = appendPlanOf(chunk);
  snapshot.rows = chunk.first;
  return { mode: 'replace', setData: snapshot, chunk: chunk, appendPatches: append.appendPatches };
}

// 页面快照 → setData：状态机字段 + 只读/会话下的入口显隐（§6.3：READONLY 隐藏代客下单入口、会话内隐藏分享）
// D67：筛选 chips/二级选择/说明行/空态文案并入同一快照（空态三套文案分离：筛选无结果 / 搜索无结果 / 真没绑定）。
function buildSnapshot(state, options) {
  const opts = options || {};
  const listState = view.listStateOf({
    rows: state.rows,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    keyword: state.keyword,
    lastSuccessAt: state.lastSuccessAt,
    nextCursor: state.nextCursor
  });
  const empty = filterModel.emptyStateOf(state.filters, state.keyword);
  return Object.assign({}, listState, filterModel.uiOf(state.filters), {
    rows: state.rows,
    keyword: state.keyword,
    bannerText: view.buildBannerText(state.newRows),
    headingText: cursorOf(state.nextCursor) ? '客户' : '客户（' + state.rows.length + '）',
    partnerNo: textOf(opts.partnerNo),
    readonly: opts.readonly === true,
    session: opts.session === true,
    showCreateEntry: opts.readonly !== true,
    showShare: opts.session !== true,
    lastSuccessAt: state.lastSuccessAt,
    emptyText: empty.text,
    emptyActionText: empty.actionText
  });
}

// 空态动作语义（页面 onEmptyAction 按此分流：清筛选 / 清搜索 / 分享引导）。
function emptyActionKindOf(state) {
  return filterModel.emptyStateOf(state.filters, state.keyword).actionKind;
}

module.exports = {
  PAGE_LIMIT,
  STREAM_CHUNK_ROWS,
  createState,
  applyKeyword,
  applyFilterState,
  applyFilterChip,
  selectFilterZone,
  selectFilterBuilding,
  clearFilters,
  querySignatureOf,
  refreshQuery,
  nextQuery,
  applyResponse,
  applyMoreResponse,
  attachAvatarUrls,
  applyError,
  beginLoad,
  dismissBanner,
  buildSnapshot,
  emptyActionKindOf,
  chunkPlanOf,
  appendPlanOf,
  appendRowPatches,
  rowPatchesOf,
  viewPlanOf
};
