// pages/partner/workbench/parts/group-view.js · 工作台渲染视图（服务端 DTO → 行/站点分组；四档动线排序在零件层）
// 口径：CONTRACT §5.2「服务端给状态桶+站点过滤的分页数据，客户端零件层只做四档动线排序」；
//       UX_PARTNER §4.2/§4.3/§4.11（行结构、四档、分片 setData）。
// 数据：order.listPartner 的 list 项（order/_dto.buildOrderDto）——bucket/statusText/parcel/dorm/counterpart/needCode/
//       actions[]（批6-A 行级动作，页面只消费不猜）/version；兼容 groups[] 旧形状（selftest-bind 在用）。
// 判定：行视图不含七状态判断；多选资格只看服务端 bucket（filter-view.canSelect 单一来源）。
'use strict';

const orderState = require('../../../../shared/order-state');
const orderView = require('../../../../shared/order-view');
const stations = require('../../../../shared/stations');
const enums = require('../../../../shared/enums');
const roomTag = require('../../../../utils/room-tag');
const filterView = require('./filter-view');
const rowActions = require('./row-actions');

const FALLBACK_GROUP_NAME = '全部待处理';
const UNKNOWN_STATION_RANK = 999;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function tailText(value) {
  const tail = textOf(value);
  return tail.length === 4 ? '尾号' + tail : '';
}

// 服务端时间是 ISO 字符串（toIso）；兼容毫秒数/Date 与旧字段
function timeTextOf(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function anchorTextOf(dormKey, tag) {
  const key = textOf(dormKey);
  const suffix = textOf(tag);
  if (!key) {
    return suffix;
  }
  if (!suffix) {
    return key;
  }
  return roomTag.formatDormTag(key, suffix) || key + suffix;
}

// 行级动作：只搬服务端 actions[]（{key,label}），不增不减；未知键交给 row-actions 注册表丢弃
function actionsOf(item) {
  const list = Array.isArray(item.actions) ? item.actions : [];
  const out = [];
  list.forEach((entry) => {
    if (typeof entry === 'string' && entry) {
      out.push({ key: entry, label: '' });
    } else if (entry && typeof entry.key === 'string' && entry.key) {
      out.push({ key: entry.key, label: textOf(entry.label) });
    }
  });
  return out;
}

// DTO 行（order/_dto.buildOrderDto）；raw 文档兜底只为旧 response 形状，页面不依赖未下发字段
function toRow(order) {
  const item = order || {};
  const parcel = item.parcel || {};
  const dorm = item.dorm || {};
  const guest = item.guest || item.guestSnapshot || {};
  const counterpart = item.counterpart || {};
  const exception = item.exception || {};
  const status = textOf(item.status);
  const name = textOf(counterpart.displayName) || textOf(guest.displayName) || textOf(item.customerDisplayName);
  const dormKey = textOf(dorm.dormKey) || textOf(item.dormKey) || textOf(guest.dormKey);
  const tag = textOf(dorm.roomTag) || textOf(item.roomTag) || textOf(guest.roomTag);
  const anchor = anchorTextOf(dormKey, tag);
  const tail = tailText(item.phoneTail || guest.phoneTail);
  const keyText = [tail, name].filter(Boolean).join(' · ');
  const pickupCode = textOf(parcel.pickupCode) || textOf(item.pickupCode);
  const trackingTail = textOf(parcel.trackingTail) || textOf(item.trackingTail);
  const bucket = textOf(item.bucket) || orderView.bucketOf(status);
  const rows = [];
  if (anchor) {
    rows.push(anchor);
  }
  if (keyText) {
    rows.push(keyText);
  }
  const tier = orderView.pickupTier(item);
  const actions = actionsOf(item);
  const row = {
    orderNo: textOf(item.orderNo),
    status: status,
    statusText: textOf(item.statusText) || orderState.statusText(status),
    bucket: bucket,
    tierText: orderView.pickupTierText(tier),
    codeText: pickupCode || (trackingTail ? '尾号' + trackingTail : '待补码'),
    lockerText: textOf(parcel.lockerNo) || textOf(item.lockerNo),
    pickupCode: pickupCode,
    trackingTail: trackingTail,
    anchorText: anchor,
    keyText: keyText,
    anchorKeyText: rows.join(' · '),
    senderText: anchor && keyText ? '' : keyText,
    needCode: item.needCode === true,
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    exceptionText: textOf(exception.text) || textOf(exception.codeText) || textOf(item.exceptionText),
    reviewText: item.failureHint === true ? '已反馈开发者复核' : '',
    cancelReasonText: textOf(item.cancelReasonText) || textOf(item.cancelReason),
    deliveryNote: textOf(item.deliveryNote),
    actions: actionsOf(item),
    version: typeof item.version === 'number' ? item.version : 0,
    timeText: timeTextOf(item.statusUpdatedAt) || timeTextOf(item.updatedAt) || textOf(item.updatedAtText),
    selectable: filterView.canSelect({ orderNo: item.orderNo, bucket }),
    selected: false,
    stationId: textOf(parcel.stationId),
    stationName: textOf(parcel.stationName)
  };
  // 行工具条也进行视图：服务端 actions 变化时随行级补丁一起更新（只消费 actions[]，不判状态）
  row.toolbar = rowActions.buildToolbar(row, {});
  return row;
}

// 四档动线排序：吃服务端过滤后的 list，不改变分组与过滤结果（同档按码中数字升序→orderNo）
function toRows(orders) {
  return orderView.sortByPickupRoute(Array.isArray(orders) ? orders : []).map(toRow);
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

function groupOf(stationId, stationName, orders) {
  return {
    key: textOf(stationId) || '__NONE__',
    stationId: textOf(stationId),
    stationName: textOf(stationName) || FALLBACK_GROUP_NAME,
    count: orders.length,
    rows: fillBucket(toRows(orders))
  };
}

// 服务端 list（DTO）按站点分区：站点名/ID 来自 parcel 字段，顺序按 P1~P8 + 未指定站点兜底
function buildGroupsFromList(list) {
  const map = {};
  const keys = [];
  list.forEach((order) => {
    const parcel = (order && order.parcel) || {};
    const stationId = textOf(parcel.stationId);
    const key = stationId || '__NONE__';
    if (!map[key]) {
      map[key] = { stationId: stationId, stationName: textOf(parcel.stationName), orders: [] };
      keys.push(key);
    }
    if (!map[key].stationName) {
      map[key].stationName = textOf(parcel.stationName);
    }
    map[key].orders.push(order);
  });
  return keys
    .map((key) => map[key])
    .sort((left, right) => stationRankOf(left.stationId) - stationRankOf(right.stationId))
    .map((group) => groupOf(group.stationId, group.stationName, group.orders));
}

function buildGroupsFromGroups(groups) {
  return groups.map((group) => groupOf(group.stationId, group.stationName, Array.isArray(group.orders) ? group.orders : []));
}

function toGroups(data) {
  const source = data || {};
  const list = Array.isArray(source.list) ? source.list : [];
  if (list.length) {
    if (list[0] && Array.isArray(list[0].orders)) {
      return buildGroupsFromGroups(list);
    }
    return buildGroupsFromList(list);
  }
  if (Array.isArray(source.groups) && source.groups.length) {
    return buildGroupsFromGroups(source.groups);
  }
  return [];
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

function flattenRows(groups) {
  const out = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.rows || []).forEach((row) => out.push(row));
  });
  return out;
}

function countSelectable(groups) {
  return flattenRows(groups).filter((row) => row.selectable).length;
}

function selectedRows(groups) {
  return flattenRows(groups).filter((row) => row.selected);
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

// 组结构签名：orderNo 序列（跨站移动/增删/排序变化都算结构变化 → 整表替换；纯字段变化才走行级补丁）
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
  flattenRows(oldGroups).forEach((row) => {
    oldMap[row.orderNo] = row;
  });
  (Array.isArray(newGroups) ? newGroups : []).forEach((group, groupIndex) => {
    (group.rows || []).forEach((row, rowIndex) => {
      const prev = oldMap[row.orderNo];
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

// 首次渲染分片（UX §4.11）：每片 ≤size 行；已加载顺序与分组不边，片内 group.key 加序号防 wx:key 冲突
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
  toRows,
  toGroups,
  buildGroups: buildGroupsFromList,
  filterRows,
  flattenRows,
  countSelectable,
  selectedRows,
  findRow,
  applySelection,
  selectionMapOf,
  signatureOf,
  diffRowPatches,
  splitByRows,
  fillBucket
};
