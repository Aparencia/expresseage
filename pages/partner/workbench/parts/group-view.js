// pages/partner/workbench/parts/group-view.js · 工作台渲染视图（服务端只做状态桶+站点过滤，本零件做四档动线排序）
// 口径：CONTRACT §5.2「服务端返回按状态桶+站点过滤的分页数据，客户端零件层只做四档动线排序」。
//       排序唯一实现在 shared/order-view.js（comparePickupRoute/sortByPickupRoute），本文件不复制比较逻辑。
const orderView = require('../../../../shared/order-view');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tailText(value) {
  const tail = textOf(value);
  return tail.length === 4 ? '尾号' + tail : '';
}

function toRow(order) {
  const item = order || {};
  const parcel = item.parcel || {};
  const guest = item.guest || item.guestSnapshot || {};
  const counterpart = item.counterpart || {};
  const customer = item.customer || {};
  const name =
    textOf(counterpart.displayName) ||
    textOf(customer.displayName) ||
    textOf(guest.displayName) ||
    textOf(item.customerDisplayName);
  const dormKey = textOf(item.dormKey) || textOf(guest.dormKey) || textOf(customer.dormKey);
  const roomTag = textOf(item.roomTag) || textOf(guest.roomTag) || textOf(customer.roomTag);
  const anchor = [dormKey, roomTag].filter(Boolean).join('');
  const tail = tailText(item.phoneTail || guest.phoneTail || customer.phoneTail);
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
    status: textOf(item.status),
    statusText: textOf(item.statusText),
    bucket: textOf(item.bucket) || textOf(item.statusBucket),
    codeText: pickupCode || (trackingTail ? '尾号' + trackingTail : '待补码'),
    lockerText: textOf(parcel.lockerNo) || textOf(item.lockerNo),
    anchorText: anchor,
    keyText: keyText,
    anchorKeyText: rows.join(' · '),
    senderText: anchor && keyText ? '' : keyText,
    needCode: item.needCode === true || (!pickupCode && !trackingTail),
    isGuest: item.source === 'PARTNER' || item.isGuest === true,
    exceptionText: textOf(item.exceptionText) || textOf(item.exception && item.exception.text),
    reviewText: item.failureHint || (item.image && item.image.failureId ? '已反馈开发者复核' : ''),
    timeText: textOf(item.updatedAtText) || textOf(item.statusUpdatedAtText)
  };
}

function fillBucket(rows) {
  return rows.map((row) => {
    if (row.bucket) {
      return row;
    }
    const status = row.status;
    if (!status) {
      return row;
    }
    const bucket = status.toLowerCase();
    return Object.assign({}, row, { bucket: bucket });
  });
}

// 四档动线排序：吃服务端过滤后的 list，不改变分组与过滤结果（同档按码中数字升序→orderNo）
function toRows(orders) {
  return orderView.sortByPickupRoute(Array.isArray(orders) ? orders : []).map(toRow);
}

function toGroups(data) {
  const source = data || {};
  if (Array.isArray(source.groups)) {
    return source.groups.map((group) => ({
      stationId: textOf(group.stationId),
      stationName: textOf(group.stationName) || '站点未知',
      count: Array.isArray(group.orders) ? group.orders.length : 0,
      rows: fillBucket(toRows(group.orders))
    }));
  }
  const list = Array.isArray(source.list) ? source.list : [];
  if (!list.length) {
    return [];
  }
  if (Array.isArray(list[0] && list[0].orders)) {
    return list.map((group) => ({
      stationId: textOf(group.stationId),
      stationName: textOf(group.stationName) || '站点未知',
      count: Array.isArray(group.orders) ? group.orders.length : 0,
      rows: fillBucket(toRows(group.orders))
    }));
  }
  return [
    {
      stationId: '',
      stationName: '全部待处理',
      count: list.length,
      rows: fillBucket(toRows(list))
    }
  ];
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
