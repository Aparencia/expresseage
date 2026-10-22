// pkg-customer/pages/pickup-list/parts/pickup-view.js · 取件清单视图纯件（D26，零 wx）
// 口径（CONTRACT §13 D26）：只显示本人**进行中订单**的「快递站点 + 取件码」，按订单分组、可复制；
// 勾选「我已取到」只是本机标记（utils/storage 的 pickupChecks），不回写服务端、不影响订单状态。
'use strict';

const enums = require('../../../../shared/enums');
const format = require('../../../parts/format');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 服务端 DTO：v1.0 parcels[]；切换期兼容旧单 parcel */
function parcelsOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length > 0) {
    return list.map(function map(entry) {
      return entry && entry.parcel ? entry.parcel : entry || {};
    });
  }
  return order && order.parcel ? [order.parcel] : [];
}

/** 本机勾选 key = `{orderNo}#{itemIndex}`（与 utils/storage PICKUP_CHECK_PATTERN 同形） */
function checkKeyOf(orderNo, itemIndex) {
  return String(orderNo || '') + '#' + String(itemIndex);
}

function codeTextOf(parcel) {
  const value = parcel || {};
  if (value.codeStatus === enums.CODE_STATUS.NEED_CODE) {
    return '需查明（兼职正在查码）';
  }
  const code = textOf(value.pickupCode);
  if (code) return code;
  const tail = textOf(value.trackingTail);
  return tail ? '运单尾号 ' + tail : '码未填';
}

function hasCode(parcel) {
  const value = parcel || {};
  return value.codeStatus !== enums.CODE_STATUS.NEED_CODE && !!textOf(value.pickupCode);
}

/** 进行中订单 → 行（每件一行）：组内 items 与 parcels 下标一致，便于按件勾选 */
function rowsOf(orders, checks) {
  const map = checks && typeof checks === 'object' ? checks : {};
  const rows = [];
  (orders || []).forEach(function each(order) {
    const orderNo = textOf(order && order.orderNo);
    if (!orderNo) return;
    parcelsOf(order).forEach(function parcelRow(parcel, index) {
      const key = checkKeyOf(orderNo, index);
      rows.push({
        orderNo: orderNo,
        itemIndex: index,
        key: key,
        no: index + 1,
        stationName: textOf(parcel.stationName) || '未识别站点',
        stationId: textOf(parcel.stationId),
        codeText: codeTextOf(parcel),
        hasCode: hasCode(parcel),
        lockerNo: textOf(parcel.lockerNo),
        needCode: parcel.codeStatus === enums.CODE_STATUS.NEED_CODE,
        checked: map[key] === true,
        timeText: format.formatDateTime(order.createdAt || ''),
        statusText: textOf(order.statusText) || ''
      });
    });
  });
  return rows;
}

/** 按订单分组（D26：可按订单分组、附状态与下单时间） */
function groupByOrder(rows) {
  const groups = [];
  const index = {};
  (rows || []).forEach(function each(row) {
    if (!index[row.orderNo]) {
      index[row.orderNo] = {
        orderNo: row.orderNo,
        timeText: row.timeText,
        statusText: row.statusText,
        rows: [],
        checkedCount: 0,
        allChecked: false
      };
      groups.push(index[row.orderNo]);
    }
    const group = index[row.orderNo];
    group.rows.push(row);
    if (row.checked) group.checkedCount += 1;
    group.allChecked = group.rows.length > 0 && group.checkedCount === group.rows.length;
  });
  return groups;
}

/** 全选/取消本组（只是本机标记） */
function toggleGroup(rows, orderNo, checked) {
  return (rows || []).map(function map(row) {
    return row.orderNo === orderNo ? Object.assign({}, row, { checked: checked === true }) : row;
  });
}

function toggleRow(rows, key) {
  return (rows || []).map(function map(row) {
    return row.key === key ? Object.assign({}, row, { checked: !row.checked }) : row;
  });
}

/** 可复制的文本（站点 + 码；需查明的件给占位说明，不复制假码） */
function copyTextOf(row) {
  if (!row) return '';
  return row.stationName + ' ' + (row.hasCode ? row.codeText : '（' + row.codeText + '）');
}

function copyAllTextOf(groups) {
  const lines = [];
  (groups || []).forEach(function each(group) {
    group.rows.forEach(function row(item) {
      lines.push(item.stationName + ' ' + (item.hasCode ? item.codeText : item.codeText));
    });
  });
  return lines.join('\n');
}

function summaryOf(rows) {
  const list = rows || [];
  return {
    total: list.length,
    checked: list.filter(function done(row) { return row.checked; }).length,
    needCode: list.filter(function need(row) { return row.needCode; }).length
  };
}

module.exports = {
  parcelsOf,
  checkKeyOf,
  codeTextOf,
  hasCode,
  rowsOf,
  groupByOrder,
  toggleGroup,
  toggleRow,
  copyTextOf,
  copyAllTextOf,
  summaryOf
};
