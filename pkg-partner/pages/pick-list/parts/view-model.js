// pkg-partner/pages/pick-list/parts/view-model.js · 楼层配送清单纯件（分组/排序/分片/复制文案；零 wx）
// 口径：CONTRACT §13-D46（独立第 32 页）、UX_PARTNER §3.11；数据源 order.listPartner({view:'workbench',status:PICKED})
//       现成动作（无服务端改动）；按 苑 → 栋 → 楼层（zones.floorOf(room)）→ roomTag 自然序分组；
//       分页/分片 ≤20 行；复制文案只到楼栋级（D48 红线：不含房间号/roomTag/订单号/称呼/尾号/取件码）。
// 纪律：本文件零 wx、零七状态字面量（状态只经 shared/enums 取值）；页面只消费这里产出的稳定字段。
'use strict';

const zones = require('../../../../shared/zones');
const enums = require('../../../../shared/enums');

const PAGE_LIMIT = 20; // 服务端分页：每片 ≤20 行（D46）
const CHUNK_ROWS = 20; // 首次/追加渲染 setData：每片 ≤20 行（UX_PARTNER §4.11 同口径）
const WORKBENCH_VIEW = 'workbench';
const COPY_TITLE = '【楼层配送清单】';
const UNKNOWN_GROUP_KEY = 'UNKNOWN';
const UNKNOWN_GROUP_TITLE = '地址待同步';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// 服务端时间是 ISO 字符串；只做展示（取件时间），解析失败返回 ''
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

// 服务端行内动作只消费 actions[]（不判状态）：deliver 键存在才渲染行内「已送达」
function actionKeysOf(order) {
  const list = order && Array.isArray(order.actions) ? order.actions : [];
  const out = [];
  list.forEach((entry) => {
    const key = typeof entry === 'string' ? entry : entry && entry.key;
    if (textOf(key)) {
      out.push(key);
    }
  });
  return out;
}

function nameOf(order) {
  const counterpart = order && order.counterpart && typeof order.counterpart === 'object' ? order.counterpart : {};
  const guest = order && order.guest && typeof order.guest === 'object' ? order.guest : {};
  return textOf(counterpart.displayName) || textOf(guest.displayName) || '';
}

function buildingNoOf(source) {
  const raw = source && source.buildingNo;
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    return Number(raw.trim());
  }
  return NaN;
}

// 本单配送地址（D25）：delivery 优先；历史单按 dorm（下单人宿舍）归一。非法/缺字段 → 兜底组，不静默丢单。
function addressOf(order) {
  const delivery = order && order.delivery && typeof order.delivery === 'object' ? order.delivery : null;
  const dorm = order && order.dorm && typeof order.dorm === 'object' ? order.dorm : null;
  const source = delivery || dorm || {};
  const zone = zones.normalizeZone(source.zone);
  const buildingNo = buildingNoOf(source);
  const roomText = zones.canonicalRoom(source.room);
  const floor = zones.floorOf(roomText);
  const valid = !!(zone && zones.isBuildingNo(buildingNo) && roomText && floor > 0);
  const buildingText = valid ? zones.buildingText(zone, buildingNo) : '';
  const dormKey = textOf(source.dormKey) || (valid ? zones.dormKey(zone, buildingNo, roomText) : '');
  return {
    valid: valid,
    zone: zone,
    buildingNo: valid ? buildingNo : 0,
    roomText: roomText,
    roomNumber: roomText ? Number(roomText) : 0,
    floor: floor,
    zoneText: valid ? zones.zoneLabel(zone) : '',
    buildingText: buildingText,
    dormKey: dormKey,
    groupKey: valid ? zone + '|' + buildingNo + '|' + floor : UNKNOWN_GROUP_KEY,
    title: valid ? zones.zoneLabel(zone) + ' ' + buildingText + ' · ' + floor + ' 层' : UNKNOWN_GROUP_TITLE
  };
}

// roomTag 是顾客宿舍标识：仅当本单配送地址=顾客宿舍（D25 他人地址不回显）才展示，避免误导跑楼
function roomTagOf(order, address) {
  const dorm = order && order.dorm && typeof order.dorm === 'object' ? order.dorm : null;
  const tag = textOf(dorm && dorm.roomTag);
  if (!tag) {
    return '';
  }
  const dormKey = textOf(dorm && dorm.dormKey);
  if (address.valid && dormKey && address.dormKey && dormKey !== address.dormKey) {
    return '';
  }
  return tag;
}

// 单条 PICKED 订单 → 清单行视图（已送达/异常/取消/待接单一律不显示；D46 默认只含 PICKED）
function rowOf(order) {
  if (!order || order.status !== enums.ORDER_STATUS.PICKED) {
    return null;
  }
  const address = addressOf(order);
  const parcels = Array.isArray(order.parcels) ? order.parcels : [];
  return {
    orderNo: textOf(order.orderNo),
    roomText: address.roomText,
    roomTagText: roomTagOf(order, address),
    nameText: nameOf(order),
    serviceName: textOf(order.service && order.service.name),
    parcelCountText: parcels.length > 1 ? '共 ' + parcels.length + ' 件' : (parcels.length === 1 ? '1 件' : ''),
    timeText: timeTextOf(order.pickedAt) || timeTextOf(order.statusUpdatedAt),
    canDeliver: actionKeysOf(order).indexOf('deliver') !== -1,
    groupKey: address.groupKey,
    zone: address.zone,
    buildingNo: address.buildingNo,
    floor: address.floor,
    roomNumber: address.roomNumber,
    dormKey: address.dormKey,
    selected: false
  };
}

function rowsOf(list) {
  const rows = [];
  (Array.isArray(list) ? list : []).forEach((order) => {
    const row = rowOf(order);
    if (row) {
      rows.push(row);
    }
  });
  return rows;
}

// 组内自然序：复用 shared/zones.compareDormKey（苑→栋→房号数值），再 roomTag 字母序 → 订单号稳定序
function compareRows(left, right) {
  const dormDelta = zones.compareDormKey(left.dormKey, right.dormKey);
  if (dormDelta !== 0) {
    return dormDelta;
  }
  const tagDelta = left.roomTagText.localeCompare(right.roomTagText);
  if (tagDelta !== 0) {
    return tagDelta;
  }
  if (left.orderNo === right.orderNo) {
    return 0;
  }
  return left.orderNo < right.orderNo ? -1 : 1;
}

// 组序：苑固定序 → 栋号数值 → 楼层数值；非法地址组排最后
function compareGroups(left, right) {
  if (left.unknown !== right.unknown) {
    return left.unknown ? 1 : -1;
  }
  const zoneDelta = zones.zoneRank(left.zone) - zones.zoneRank(right.zone);
  if (zoneDelta !== 0) {
    return zoneDelta;
  }
  if (left.buildingNo !== right.buildingNo) {
    return left.buildingNo - right.buildingNo;
  }
  return left.floor - right.floor;
}

function groupOf(row) {
  return {
    key: row.groupKey,
    title: row.groupKey === UNKNOWN_GROUP_KEY ? UNKNOWN_GROUP_TITLE : '',
    unknown: row.groupKey === UNKNOWN_GROUP_KEY,
    zone: row.zone,
    buildingNo: row.buildingNo,
    floor: row.floor,
    zoneText: '',
    buildingText: '',
    count: 0,
    rows: []
  };
}

// 苑 → 栋 → 楼层 分组：组头从组内首行地址派生（非空组必有首行）
function buildGroups(rows) {
  const map = {};
  const order = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = row.groupKey || UNKNOWN_GROUP_KEY;
    if (!map[key]) {
      map[key] = groupOf(row);
      order.push(key);
    }
    map[key].rows.push(row);
    map[key].count += 1;
  });
  return order
    .map((key) => map[key])
    .map((group) => {
      const first = group.rows[0] || {};
      const address = addressOfNullSafe(first);
      return Object.assign(group, {
        title: group.title || address.title,
        zoneText: address.zoneText,
        buildingText: address.buildingText
      });
    })
    .map((group) => Object.assign(group, { rows: group.rows.slice().sort(compareRows) }))
    .sort(compareGroups);
}

// 组头地址：行上已带稳定字段时直接拼，不再回查业务对象
function addressOfNullSafe(row) {
  if (row && row.groupKey && row.groupKey !== UNKNOWN_GROUP_KEY) {
    return {
      zoneText: zones.zoneLabel(row.zone),
      buildingText: row.zone + row.buildingNo,
      title: zones.zoneLabel(row.zone) + ' ' + row.zone + row.buildingNo + ' · ' + row.floor + ' 层'
    };
  }
  return { zoneText: '', buildingText: '', title: UNKNOWN_GROUP_TITLE };
}

function flattenOf(groups) {
  const out = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.rows || []).forEach((row) => out.push(row));
  });
  return out;
}

// 渲染分片：每组按 CHUNK_ROWS 切，组内续片标题带「（续）」；每片 rows 恒 ≤ limit
function splitChunks(groups, size) {
  const limit = typeof size === 'number' && size > 0 ? size : CHUNK_ROWS;
  const chunks = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const rows = Array.isArray(group.rows) ? group.rows : [];
    let index = 0;
    while (index < rows.length) {
      const take = rows.slice(index, index + limit);
      chunks.push({
        key: group.key + '#' + index,
        title: index === 0 ? group.title : group.title + '（续）',
        count: take.length,
        rows: take
      });
      index += take.length;
    }
  });
  return chunks;
}

// 汇总：总单数 + 覆盖栋数（文案在纯件，页面不拼业务判据）
function summaryOf(groups) {
  const list = Array.isArray(groups) ? groups : [];
  let total = 0;
  const buildings = {};
  list.forEach((group) => {
    total += Number(group.count) || 0;
    if (!group.unknown) {
      buildings[group.zoneText + ' ' + group.buildingText] = true;
    }
  });
  const buildingCount = Object.keys(buildings).length;
  return {
    total: total,
    buildingCount: buildingCount,
    text: total ? '共 ' + total + ' 单待送达 · 覆盖 ' + buildingCount + ' 栋' : '暂无待送达的已取件单'
  };
}

// 复制文案（D48 红线）：只到 苑+栋 级聚合 + 总单数；房间号/roomTag/订单号/称呼/尾号/取件码一律不出现
function copyText(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const names = [];
  const counts = {};
  let total = 0;
  list.forEach((group) => {
    if (!group || group.unknown) {
      return;
    }
    const name = group.zoneText + ' ' + group.buildingText;
    if (!counts[name]) {
      counts[name] = 0;
      names.push(name);
    }
    counts[name] += Number(group.count) || 0;
    total += Number(group.count) || 0;
  });
  if (!names.length || total === 0) {
    return '';
  }
  const parts = names.map((name) => name + ' 共 ' + counts[name] + ' 单');
  return COPY_TITLE + ' ' + parts.join('；') + '；共 ' + total + ' 单待送达。';
}

function selectionTextOf(selectedCount, totalCount) {
  return '已选 ' + selectedCount + ' 单 · 本屏共 ' + totalCount + ' 单';
}

function selectionStateOf(groups) {
  const rows = flattenOf(groups);
  return {
    selectedCount: rows.filter((row) => row.selected === true).length,
    totalCount: rows.length
  };
}

// 选择态落到新 groups（行对象新引用，便于整表重绘）；selectedMap 只记选中的 orderNo
function applySelection(groups, selectedMap) {
  const selected = selectedMap || {};
  const next = (Array.isArray(groups) ? groups : []).map((group) => Object.assign({}, group, {
    rows: (group.rows || []).map((row) => Object.assign({}, row, { selected: selected[row.orderNo] === true }))
  }));
  const state = selectionStateOf(next);
  return {
    groups: next,
    selectedCount: state.selectedCount,
    selectableCount: state.totalCount,
    selectionText: selectionTextOf(state.selectedCount, state.totalCount)
  };
}

function toggleSelection(selectedMap, orderNo) {
  const next = Object.assign({}, selectedMap || {});
  if (!textOf(orderNo)) {
    return next;
  }
  if (next[orderNo] === true) {
    delete next[orderNo];
  } else {
    next[orderNo] = true;
  }
  return next;
}

function selectAll(groups) {
  const map = {};
  flattenOf(groups).forEach((row) => {
    if (row.orderNo) {
      map[row.orderNo] = true;
    }
  });
  return map;
}

function selectedRows(groups) {
  return flattenOf(groups).filter((row) => row.selected === true);
}

// 批量送达复用工作台 batch-view：它按 row.parcelRows 数件；这里把 DTO 的 parcels[] 归一成件视图（不改服务端字段）
function writeRowOf(order) {
  if (!order || typeof order !== 'object') {
    return order;
  }
  const parcels = Array.isArray(order.parcels) ? order.parcels : [];
  if (!parcels.length) {
    return order;
  }
  return Object.assign({}, order, {
    parcelRows: parcels.map((parcel, index) => ({ index: index, indexText: '第 ' + (index + 1) + ' 件' }))
  });
}

// 数据源 payload（现成动作、无服务端改动）：workbench 视图 + PICKED 状态 + ≤20 行/片
function queryOf(options) {
  const opts = options || {};
  const payload = { view: WORKBENCH_VIEW, status: enums.ORDER_STATUS.PICKED, limit: PAGE_LIMIT };
  if (opts.cursor) {
    payload.cursor = opts.cursor;
  }
  return payload;
}

module.exports = {
  CHUNK_ROWS,
  queryOf,
  rowsOf,
  buildGroups,
  splitChunks,
  summaryOf,
  copyText,
  applySelection,
  toggleSelection,
  selectAll,
  selectedRows,
  writeRowOf
};
