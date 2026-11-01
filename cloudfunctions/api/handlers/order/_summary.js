// handlers/order/_summary.js · D48 工作台订单汇总纯件（按苑+楼栋聚合；零 I/O、零查询，便于单测）
// 口径：CONTRACT §13 D48 / DATA_MODEL §7.5 —— 只基于「本次 find 命中的行」（分页前候选集）聚合，
//       不新增查询/二次扫描；只到苑+楼栋级（不含房间号/roomTag/取件码/尾号/昵称/订单编号）。
// 计数口径：total=订单数、parcels=总件数、byStatus{picked,delivered,ongoing} 均为订单数，
//       异常（EXCEPTION）归入进行中（非终态、仍在处理）；byDorm[].count 为订单数。
'use strict';

const zones = require('../../shared/zones');
const enums = require('../../shared/enums');

const { ORDER_STATUS } = enums;
const ONGOING_STATUSES = [ORDER_STATUS.SUBMITTED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.EXCEPTION];

// orderParcelsOf 是 v1.0 多包裹/历史单包裹的归一单源（只读，不写库）。
const { orderParcelsOf } = require('./_store');

function statusBucketOf(status) {
  if (status === ORDER_STATUS.PICKED) {
    return 'picked';
  }
  if (status === ORDER_STATUS.DELIVERED) {
    return 'delivered';
  }
  return ONGOING_STATUSES.indexOf(status) >= 0 ? 'ongoing' : '';
}

// 聚合地址：本单配送地址 delivery（D25 快照）优先；历史单无 delivery/非法时回退下单人 dorm。
function addressOf(order) {
  const delivery = order && order.delivery && typeof order.delivery === 'object' ? order.delivery : null;
  const dorm = order && order.dorm && typeof order.dorm === 'object' ? order.dorm : null;
  const source = delivery && zones.normalizeZone(delivery.zone) ? delivery : dorm;
  if (!source) {
    return null;
  }
  const zone = zones.normalizeZone(source.zone);
  const buildingNo = Number(source.buildingNo);
  return zone && zones.isBuildingNo(buildingNo) ? { zone, buildingNo } : null;
}

function compareDorm(left, right) {
  const zoneDelta = zones.zoneRank(left.zone) - zones.zoneRank(right.zone);
  return zoneDelta !== 0 ? zoneDelta : left.buildingNo - right.buildingNo;
}

function buildSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = {
    total: 0,
    parcels: 0,
    byStatus: { picked: 0, delivered: 0, ongoing: 0 },
    byDorm: []
  };
  const dormMap = {};
  list.forEach(function eachOrder(order) {
    summary.total += 1;
    summary.parcels += orderParcelsOf(order).length;
    const bucket = statusBucketOf(order && order.status);
    if (bucket) {
      summary.byStatus[bucket] += 1;
    }
    const address = addressOf(order);
    if (!address) {
      return;
    }
    const key = address.zone + '|' + address.buildingNo;
    if (dormMap[key]) {
      dormMap[key].count += 1;
    } else {
      dormMap[key] = { zone: address.zone, buildingNo: address.buildingNo, count: 1 };
    }
  });
  summary.byDorm = Object.keys(dormMap).map(function rowOf(key) {
    return dormMap[key];
  }).sort(compareDorm);
  return summary;
}

module.exports = { buildSummary };
