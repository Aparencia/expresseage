// pages/partner/workbench/parts/load-view.js · 加载/轮询增量/分页/骨架纯件（零 wx）
// 口径：UX_PARTNER §4.11（服务端分页 onReachBottom、30s 轮询按 orderNo/version 合并、仅变化行走行级 setData、
//       counts 每轮都更新、首次渲染分片 setData 每片 20 行、骨架屏）、§4.12（红点/页内新订单横幅）、
//       §4.15（错误态带上次成功更新时间）、§5.3（分页协议 {list,nextCursor,counts}）。
// 说明：DATA_MODEL §7.5 的 listPartner 契约没有 since 入参（服务端不支持"只回变化"），
//       故轮询仍拉第一页全量，由本零件按 orderNo/version 做客户端增量合并与行级补丁——不整表 setData。
'use strict';

const filterView = require('./filter-view');
const groupView = require('./group-view');

const PAGE_LIMIT = 30;
const FIRST_CHUNK_ROWS = 20;
const POLL_MS = 30 * 1000;
const SEARCH_DEBOUNCE_MS = 300;
const COUNTS_FALLBACK = { submitted: 0, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 0 };

function orderNoOf(order) {
  return (order && order.orderNo) || '';
}

function versionOf(order) {
  return (order && typeof order.version === 'number' && order.version) || 0;
}

// 工作台活动区查询：状态 chip = 服务端筛选（传 status）；需查明 = client 过滤；搜索词只进请求体
function queryOf(options) {
  const opts = options || {};
  const payload = { view: opts.view || 'workbench', limit: opts.limit || PAGE_LIMIT };
  const status = filterView.statusOf(opts.filterKey);
  if (status) {
    payload.status = status;
  }
  if (opts.keyword) {
    payload.keyword = opts.keyword;
  }
  if (opts.cursor) {
    payload.cursor = opts.cursor;
  }
  return payload;
}

function normalizeCounts(raw) {
  const input = raw || {};
  const out = {};
  Object.keys(COUNTS_FALLBACK).forEach((key) => {
    const value = input[key];
    out[key] = typeof value === 'number' && isFinite(value) ? value : 0;
  });
  return out;
}

function mergeCounts(prevCounts, raw) {
  if (!raw) {
    return normalizeCounts(prevCounts);
  }
  return normalizeCounts(raw);
}

function totalOf(groups) {
  let total = 0;
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    total += (group.rows || []).length;
  });
  return total;
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function clockText(nowMs) {
  const date = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

// 加载结果 → 页面视图状态。prev.list 是已加载 DTO 全集（第一页+翻页），prev.page1Keys 用于发现
// "因状态变化离开当前筛选"的行（服务端无 since，只能靠第一页对比，逐单独立正确）。
function applyRefresh(prevIn, data, options) {
  const prev = prevIn || {};
  const opts = options || {};
  const response = data || {};
  const incoming = Array.isArray(response.list) ? response.list : [];
  const prevList = Array.isArray(prev.list) ? prev.list : [];
  const prevMap = {};
  prevList.forEach((order) => {
    prevMap[orderNoOf(order)] = order;
  });
  const incomingMap = {};
  incoming.forEach((order) => {
    incomingMap[orderNoOf(order)] = order;
  });
  const prevPage1Keys = Array.isArray(prev.page1Keys) ? prev.page1Keys : [];
  const removedKeys = prevPage1Keys.filter((key) => !incomingMap[key]);
  const kept = prevList.filter((order) => !incomingMap[orderNoOf(order)] && removedKeys.indexOf(orderNoOf(order)) < 0);
  const merged = incoming.concat(kept);
  // 变化行：版本变化 + 新增（供测试断言"只对变化行做补丁/计数仍更新"）
  const changed = [];
  const added = [];
  incoming.forEach((order) => {
    const key = orderNoOf(order);
    const before = prevMap[key];
    if (!before) {
      added.push(key);
    } else if (versionOf(before) !== versionOf(order)) {
      changed.push(key);
    }
  });
  // 多选中刷新：先把旧选集落到新行上再 diff，避免轮询补丁把行勾选态冲掉
  const upstream = filterView.filterRows(groupView.buildGroups(merged), opts.filterKey);
  const groups = opts.selectedMap ? groupView.applySelection(upstream, opts.selectedMap).groups : upstream;
  const diff = prev.groups
    ? groupView.diffRowPatches(prev.groups, groups)
    : { structural: true, patches: {} };
  const stage = groups.length ? 'ready' : (filterView.isFilterEmptyVisible(opts.keyword, opts.filterKey, groups)
    ? 'filteredEmpty'
    : 'empty');
  return {
    list: merged,
    page1Keys: incoming.map(orderNoOf),
    groups: groups,
    counts: mergeCounts(prev.counts, response.counts),
    totalRows: totalOf(groups),
    nextCursor: response.nextCursor || null,
    stage: stage,
    emptyInfo: filterView.emptyOf({ keyword: opts.keyword, filter: opts.filterKey }),
    patches: diff.patches,
    structural: diff.structural,
    changed: changed,
    added: added,
    removed: removedKeys,
    updatedAtText: clockText(opts.nowMs)
  };
}

// onReachBottom 追加下一页：不去重排序（服务端已按游标给），客户端只合并视图
function applyAppend(prevIn, data, options) {
  const prev = prevIn || {};
  const opts = options || {};
  const response = data || {};
  const incoming = Array.isArray(response.list) ? response.list : [];
  const seen = {};
  (Array.isArray(prev.list) ? prev.list : []).forEach((order) => {
    seen[orderNoOf(order)] = true;
  });
  const merged = (Array.isArray(prev.list) ? prev.list : []).slice();
  incoming.forEach((order) => {
    if (!seen[orderNoOf(order)]) {
      seen[orderNoOf(order)] = true;
      merged.push(order);
    }
  });
  const upstream = filterView.filterRows(groupView.buildGroups(merged), opts.filterKey);
  const groups = opts.selectedMap ? groupView.applySelection(upstream, opts.selectedMap).groups : upstream;
  return {
    list: merged,
    page1Keys: prev.page1Keys || [],
    groups: groups,
    counts: mergeCounts(prev.counts, response.counts),
    totalRows: totalOf(groups),
    nextCursor: response.nextCursor || null,
    stage: groups.length ? 'ready' : 'empty',
    emptyInfo: filterView.emptyOf({ keyword: opts.keyword, filter: opts.filterKey }),
    structural: true,
    patches: {},
    changed: [],
    added: incoming.map(orderNoOf),
    removed: [],
    updatedAtText: clockText(opts.nowMs)
  };
}

// 首次渲染分片（每片 ≤20 行）：first 立刻 setData，rest 逐帧追加；片数超过 1 时页面分帧追加
function chunkPlanOf(groups) {
  const chunks = groupView.splitByRows(groups, FIRST_CHUNK_ROWS);
  if (!chunks.length) {
    return { first: [], rest: [], hasRest: false };
  }
  return { first: chunks[0], rest: chunks.slice(1), hasRest: chunks.length > 1 };
}

// 红点：工作台格显示待接单数（测试会话订单服务端已隔离，不额外判断）；不得覆盖消息红点
function badgePatch(counts, currentBadges) {
  const current = currentBadges || {};
  const submitted = counts && typeof counts.submitted === 'number' ? counts.submitted : 0;
  return {
    workbenchPending: submitted > 0 ? submitted : 0,
    messages: typeof current.messages === 'number' ? current.messages : 0
  };
}

// 页内新订单横幅（不自动跳页、不抢操作）：只提示"比上次确认多出来的待接单"
function bannerOf(counts, ackSubmitted) {
  const submitted = counts && typeof counts.submitted === 'number' ? counts.submitted : 0;
  const ack = typeof ackSubmitted === 'number' ? ackSubmitted : 0;
  const pendingNew = Math.max(0, submitted - ack);
  return {
    pendingNew: pendingNew,
    visible: pendingNew > 0,
    text: '有 ' + pendingNew + ' 个新订单待接单',
    actionText: '去看看'
  };
}

function errorTextOf(lastSuccessText) {
  const tail = lastSuccessText ? '；上次成功更新 ' + lastSuccessText : '';
  return '检查网络后重试' + tail + '。';
}

// 加载结果 → 页面 setData 计划：轮询且结构不变只发行级补丁；否则首片 setData + 分帧追加
function resultPatch(plan, options) {
  const opts = options || {};
  const patch = {
    counts: plan.counts,
    totalRows: plan.totalRows,
    nextCursor: plan.nextCursor,
    stage: plan.stage,
    errorText: '',
    syncError: '',
    updatedAtText: plan.updatedAtText,
    lastSuccessText: plan.updatedAtText,
    filterDesc: filterView.describe(opts.filterKey),
    empty: plan.emptyInfo
  };
  let groups = plan.groups;
  if (opts.selecting) {
    const applied = groupView.applySelection(groups, groupView.selectionMapOf(groups));
    groups = applied.groups;
    patch.selectedCount = applied.selectedCount;
    patch.selectableCount = applied.selectableCount;
    patch.selectionText = batchViewText(applied.selectedCount, applied.selectableCount);
  }
  if (opts.poll && !plan.structural) {
    return { mode: 'patch', setData: Object.assign(patch, plan.patches), chunk: null };
  }
  const chunk = chunkPlanOf(groups);
  return {
    mode: 'replace',
    setData: Object.assign(patch, { groups: chunk.first }),
    chunk: chunk
  };
}

// 本零件不反向依赖 batch-view（避免环）：选中条文案与 batch-view.selectionText 同口径
function batchViewText(selectedCount, scopeCount) {
  return '已选 ' + selectedCount + ' 件 · 全选范围：当前筛选下 ' + scopeCount + ' 件';
}

module.exports = {
  PAGE_LIMIT,
  FIRST_CHUNK_ROWS,
  POLL_MS,
  SEARCH_DEBOUNCE_MS,
  COUNTS_FALLBACK,
  queryOf,
  normalizeCounts,
  mergeCounts,
  applyRefresh,
  applyAppend,
  chunkPlanOf,
  resultPatch,
  badgePatch,
  bannerOf,
  errorTextOf,
  clockText
};
