// pages/partner/workbench/parts/group-view.js · 工作台渲染视图（服务端 DTO → 行/站点分组；四档动线排序在零件层）
// 口径：CONTRACT §5.2「服务端给状态桶+站点过滤的分页数据，客户端零件层只做四档动线排序」；
//       D62（2026-11-02 裁决）：分组按**件的站点**——一单在其每件所属站点组各出现一次，组内只列本站件 +
//       「另 N 件在 Pn」；组内四档/排序键按**本站件**计算；组头给单数（可加件数）；多选/批量仍按**订单**。
// 数据：order.listPartner 的 list 项（order/_dto.buildOrderDto）；行模型见 parts/order-row.js。
// 判定：行视图不含七状态判断；多选资格只看服务端 bucket（filter-view.canSelect 单一来源）。
'use strict';

const stations = require('../../../../shared/stations');
const filterView = require('./filter-view');
const orderRow = require('./order-row');
const parcelView = require('./parcel-view');

const FALLBACK_GROUP_NAME = '全部待处理';
const UNKNOWN_STATION_RANK = 999;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toRow(order, nowMs, scope) {
  return orderRow.toRow(order, nowMs, scope);
}

// 组内排序：本站件档位 → 本站件码数字 → 订单号（防渲染抖动）
function compareRowsForRoute(left, right) {
  if (left.routeTier !== right.routeTier) {
    return left.routeTier - right.routeTier;
  }
  if (left.routeNumber !== right.routeNumber) {
    return left.routeNumber - right.routeNumber;
  }
  if (left.orderNo === right.orderNo) {
    return 0;
  }
  return left.orderNo < right.orderNo ? -1 : 1;
}

function sortRowsForRoute(rows) {
  return rows.slice().sort(compareRowsForRoute);
}

function stationRankOf(stationId) {
  const id = textOf(stationId);
  if (!id) {
    return UNKNOWN_STATION_RANK;
  }
  const list = stations.listStations();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === id) {
      return index;
    }
  }
  return UNKNOWN_STATION_RANK;
}

// 组视图：count=出现于本站的订单数（跨站单在每个站各计一次，与 D62 同口径）；
// pieceCount=本站件数；countText 组头文案（单数为主，件数不同才补）
function groupOf(stationId, stationName, entries, nowMs) {
  const rows = sortRowsForRoute(entries.map((entry) => toRow(entry.order, nowMs, {
    stationId: entry.stationId,
    stationName: entry.stationName
  })));
  let pieceCount = 0;
  rows.forEach((row) => {
    pieceCount += row.pieceRows.length;
  });
  const id = textOf(stationId);
  const count = rows.length;
  return {
    key: id || '__NONE__',
    stationId: id,
    stationName: textOf(stationName) || FALLBACK_GROUP_NAME,
    count: count,
    pieceCount: pieceCount,
    countText: count + ' 单' + (pieceCount !== count ? ' · ' + pieceCount + ' 件' : ''),
    rows: fillBucket(rows)
  };
}

// 服务端 list（DTO）按**件站点**分区（D62）：每件落一个站点组，一单可出现在多个站点组；
// 组序按 P1~P8 + 未指定站点兜底
function buildGroupsFromList(list, nowMs) {
  const map = {};
  const keys = [];
  (Array.isArray(list) ? list : []).forEach((order) => {
    const item = order || {};
    const stationGroups = parcelView.stationGroupsOf(item);
    stationGroups.forEach((station) => {
      const key = station.stationId || '__NONE__';
      if (!map[key]) {
        map[key] = { stationId: station.stationId, stationName: station.stationName, entries: [] };
        keys.push(key);
      }
      if (!map[key].stationName) {
        map[key].stationName = station.stationName;
      }
      map[key].entries.push({ order: item, stationId: station.stationId, stationName: map[key].stationName });
    });
  });
  return keys
    .map((key) => map[key])
    .sort((left, right) => stationRankOf(left.stationId) - stationRankOf(right.stationId))
    .map((group) => groupOf(group.stationId, group.stationName, group.entries, nowMs));
}

// 兼容旧 groups[] 形状（selftest-bind 等）：每个 group 视为站组，行承载整单件（不再二次按件拆）
function buildGroupsFromGroups(groups, nowMs) {
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const orders = Array.isArray(group.orders) ? group.orders : [];
    return groupOf(group.stationId, group.stationName, orders.map((order) => ({
      order: order,
      stationId: textOf(group.stationId),
      stationName: textOf(group.stationName)
    })), nowMs);
  });
}

function toGroups(data, nowMs) {
  const source = data || {};
  const list = Array.isArray(source.list) ? source.list : [];
  if (list.length) {
    if (list[0] && Array.isArray(list[0].orders)) {
      return buildGroupsFromGroups(list, nowMs);
    }
    return buildGroupsFromList(list, nowMs);
  }
  if (Array.isArray(source.groups) && source.groups.length) {
    return buildGroupsFromGroups(source.groups, nowMs);
  }
  return [];
}

// 今日订单流水（D53/批 20）：「全部」= 今日内有状态更新的七状态订单，服务端已按 statusUpdatedAt desc 排好，
// 客户端不再按四档重排、也不做站点分组——平铺进单个 day 组（group.day=true → 页面不渲染站点头）。
// 行字段/工具条复用 toRow：活动行照常显示写操作；待确认（delivered 桶）/已完结（history 桶）行只读（D54）。
const DAY_READONLY_BUCKETS = ['delivered', 'history'];

function dayRowOf(order, nowMs, readonly) {
  const row = toRow(order, nowMs, readonly ? { stationId: undefined, readonly: true } : null);
  if (DAY_READONLY_BUCKETS.indexOf(row.bucket) < 0) {
    return row;
  }
  return Object.assign({}, row, {
    toolbar: { primary: [], secondary: [], detail: true, hidden: false }
  });
}

function buildDayGroups(list, nowMs, options) {
  const orders = Array.isArray(list) ? list : [];
  if (!orders.length) {
    return [];
  }
  const readonly = !!(options && options.readonly);
  const rows = orders.map((order) => dayRowOf(order, nowMs, readonly));
  return [{
    key: '__TODAY__',
    stationId: '',
    stationName: '',
    day: true,
    count: rows.length,
    pieceCount: rows.reduce((sum, row) => sum + row.pieceRows.length, 0),
    countText: rows.length + ' 单',
    rows: rows
  }];
}

function fillBucket(rows) {
  return rows.map((row) => {
    if (row.bucket) {
      return row;
    }
    return Object.assign({}, row, { bucket: row.status ? row.status.toLowerCase() : '' });
  });
}

function filterRows(groups, chip) {
  if (!chip || chip === 'all') {
    return groups;
  }
  return groups
    .map((group) => Object.assign({}, group, { rows: group.rows.filter((row) => !row.bucket || row.bucket === chip) }))
    .filter((group) => group.rows.length > 0);
}

// 渲染行（同一订单在 D62 下可出现在多个站点组 —— 多选/批量必须按订单去重）
function flattenRows(groups) {
  const out = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.rows || []).forEach((row) => out.push(row));
  });
  return out;
}

function uniqueRows(rows) {
  const seen = {};
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row && (row.orderNo || row.orderNo === '' ? row.orderNo : '');
    if (!key || seen[key]) {
      return;
    }
    seen[key] = true;
    out.push(row);
  });
  return out;
}

function countSelectable(groups) {
  return uniqueRows(flattenRows(groups).filter((row) => row.selectable)).length;
}

function selectedRows(groups) {
  return uniqueRows(flattenRows(groups).filter((row) => row.selected));
}

function findRow(groups, orderNo) {
  const list = Array.isArray(groups) ? groups : [];
  for (let g = 0; g < list.length; g += 1) {
    const rows = list[g].rows || [];
    for (let r = 0; r < rows.length; r += 1) {
      if (rows[r].orderNo === orderNo) {
        return { groupIndex: g, rowIndex: r, row: rows[r], stationName: list[g].stationName };
      }
    }
  }
  return null;
}

// 件动作定位：D62 下同一订单的件分散在各自站点组，按 orderNo + itemIndex 找到所属行与该件视图
function findPiece(groups, orderNo, itemIndex) {
  const list = Array.isArray(groups) ? groups : [];
  for (let g = 0; g < list.length; g += 1) {
    const rows = list[g].rows || [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      if (row.orderNo !== orderNo || !Array.isArray(row.pieceRows)) {
        continue;
      }
      const piece = row.pieceRows.filter((item) => item.index === itemIndex)[0];
      if (piece) {
        return { groupIndex: g, rowIndex: r, row: row, piece: piece };
      }
    }
  }
  return null;
}

// 选择态落盘：selectedMap 只有被选中的 orderNo；返回新 groups（行对象新引用，便于整表重绘）
function applySelection(groups, selectedMap) {
  const map = selectedMap || {};
  const next = (Array.isArray(groups) ? groups : []).map((group) => Object.assign({}, group, {
    rows: (group.rows || []).map((row) => Object.assign({}, row, {
      selected: row.selectable === true && map[row.orderNo] === true
    }))
  }));
  return {
    groups: next,
    selectedCount: selectedRows(next).length,
    selectableCount: countSelectable(next)
  };
}

function selectionMapOf(groups) {
  const map = {};
  selectedRows(groups).forEach((row) => {
    map[row.orderNo] = true;
  });
  return map;
}

// 组结构签名：站点+orderNo 序列（跨站移动/增删/排序变化都算结构变化 → 整表替换；纯字段变化才走行级补丁）
function signatureOf(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => (group.stationId || '') + ':' + (group.rows || []).map((row) => row.orderNo).join(','))
    .join('|');
}

// 行级补丁（UX §4.11）：结构不变时只对变化字段发 setData('groups[g].rows[r].field')
function diffRowPatches(oldGroups, newGroups) {
  const patches = {};
  if (signatureOf(oldGroups) !== signatureOf(newGroups)) {
    return { structural: true, patches: patches };
  }
  const oldMap = {};
  (Array.isArray(oldGroups) ? oldGroups : []).forEach((group, groupIndex) => {
    (group.rows || []).forEach((row, rowIndex) => {
      oldMap[groupIndex + '#' + rowIndex] = row;
    });
  });
  (Array.isArray(newGroups) ? newGroups : []).forEach((group, groupIndex) => {
    (group.rows || []).forEach((row, rowIndex) => {
      const prev = oldMap[groupIndex + '#' + rowIndex];
      if (!prev) {
        return;
      }
      Object.keys(row).forEach((field) => {
        if (isPlainEqual(prev[field], row[field])) {
          return;
        }
        patches['groups[' + groupIndex + '].rows[' + rowIndex + '].' + field] = row[field];
      });
    });
  });
  return { structural: false, patches: patches };
}

function isPlainEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isPlainEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = Object.keys(a);
    const right = Object.keys(b);
    return left.length === right.length && left.every((key) => isPlainEqual(a[key], b[key]));
  }
  return false;
}

// P0-5：结构变化时的最小 setData——从首个不同组起逐 index 打 `groups[n]` 路径补丁，未变化组不重发；
// 新组数 < 旧组数（站点组减少/收窄）必须整表替换，否则尾部会残留已消失的站点卡。
// 前置：页面已把首屏各分片 append 完（_chunkToken 空闲），否则路径下标与 data.groups 不一致 → 调用方回退 replace。
function structuralPatch(oldGroups, newGroups) {
  const prev = Array.isArray(oldGroups) ? oldGroups : [];
  const next = Array.isArray(newGroups) ? newGroups : [];
  if (next.length < prev.length) {
    return { mode: 'replace', patches: {} };
  }
  const patches = {};
  for (let index = 0; index < next.length; index += 1) {
    if (index < prev.length && isPlainEqual(prev[index], next[index])) {
      continue;
    }
    patches['groups[' + index + ']'] = next[index];
  }
  return { mode: Object.keys(patches).length ? 'groups' : 'none', patches: patches };
}

// 首次渲染分片（UX §4.11）：每片 ≤size 行；已加载顺序与分组不变，片内 group.key 加序号防 wx:key 冲突
function splitByRows(groups, size) {
  const limit = size > 0 ? size : 20;
  const chunks = [];
  let current = [];
  let currentRows = 0;
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    let index = 0;
    const rows = group.rows || [];
    while (index < rows.length) {
      const space = limit - currentRows;
      const take = rows.slice(index, index + space);
      current.push({
        key: (group.stationId || '__NONE__') + '#' + chunks.length + '#' + index,
        stationId: group.stationId,
        stationName: group.stationName,
        countText: group.countText,
        day: group.day === true,
        count: take.length,
        rows: take
      });
      currentRows += take.length;
      index += take.length;
      if (currentRows >= limit) {
        chunks.push(current);
        current = [];
        currentRows = 0;
      }
    }
  });
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

module.exports = {
  toRow,
  toGroups,
  buildDayGroups,
  sortRowsForRoute,
  buildGroups: buildGroupsFromList,
  filterRows,
  flattenRows,
  uniqueRows,
  countSelectable,
  selectedRows,
  findRow,
  findPiece,
  applySelection,
  selectionMapOf,
  signatureOf,
  diffRowPatches,
  structuralPatch,
  splitByRows,
  fillBucket
};
