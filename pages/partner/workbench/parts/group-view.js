// pages/partner/workbench/parts/group-view.js · 工作台渲染视图（真实云 DTO → 行/站点分组；四档动线排序在零件层）
// 口径：CONTRACT §5.2「服务端给状态桶+站点过滤的分页数据，客户端零件层只做四档动线排序」。
// 数据：order.listPartner 的 list 项（order/_dto.buildOrderDto）——bucket/statusText/parcel/dorm/counterpart/needCode；
//       兼容两种回退：groups[]（若未来服务端下发 DTO 分组）与旧 list-of-groups 形状；比较逻辑零复制（shared/order-view）。
const orderState = require('../../../../shared/order-state');
const orderView = require('../../../../shared/order-view');
const stations = require('../../../../shared/stations');
const enums = require('../../../../shared/enums');
const roomTag = require('../../../../utils/room-tag');

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
  const rows = [];
  if (anchor) {
    rows.push(anchor);
  }
  if (keyText) {
    rows.push(keyText);
  }
  return {
    orderNo: textOf(item.orderNo),
    status: status,
    statusText: textOf(item.statusText) || orderState.statusText(status),
    bucket: textOf(item.bucket) || orderView.bucketOf(status),
    codeText: pickupCode || (trackingTail ? '尾号' + trackingTail : '待补码'),
    lockerText: textOf(parcel.lockerNo) || textOf(item.lockerNo),
    anchorText: anchor,
    keyText: keyText,
    anchorKeyText: rows.join(' · '),
    senderText: anchor && keyText ? '' : keyText,
    needCode: item.needCode === true,
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    exceptionText: textOf(exception.text) || textOf(exception.codeText) || textOf(item.exceptionText),
    reviewText: item.failureHint === true ? '已反馈开发者复核' : '',
    timeText: timeTextOf(item.statusUpdatedAt) || timeTextOf(item.updatedAt) || textOf(item.updatedAtText)
  };
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

function countSelected(selectedMap) {
  return Object.keys(selectedMap || {}).filter((key) => selectedMap[key]).length;
}

function selectedRows(groups, selectedMap) {
  const out = [];
  groups.forEach((group) => {
    group.rows.forEach((row) => {
      if (selectedMap && selectedMap[row.orderNo]) {
        out.push(row);
      }
    });
  });
  return out;
}

module.exports = {
  toRow,
  toRows,
  toGroups,
  filterRows,
  countSelected,
  selectedRows,
  fillBucket
};
