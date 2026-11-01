// handlers/order/_summary.js · D48 工作台订单汇总纯件（按苑+楼栋聚合；零 I/O、零查询，便于单测）
// 口径：CONTRACT §13 D48 / DATA_MODEL §7.5 —— 只基于「本次 find 命中的行」（分页前候选集）聚合，
//       不新增查询/二次扫描；只到苑+楼栋级（不含房间号/roomTag/取件码/尾号/昵称/订单编号）。
// 计数口径：total=订单数、parcels=总件数、byStatus{picked,delivered,ongoing} 均为订单数，
//       异常（EXCEPTION）归入进行中（非终态、仍在处理）；byDorm[].count 为订单数。
// P1-6：options.truncated = 本次 find 触达扫描上限（pageOf 判定）；聚合只覆盖已取到的行，
//       响应如实带 summary.truncated=true，客户端文案据此注明「可能少报」，不静默当作全量。
// D54（批 20）：新增「今日已送达」口径 buildDeliveredToday（复制汇总改口径）——deliveredAt 落在今日
//       且状态 ∈ {DELIVERED, COMPLETED}；取消单不在目标状态集天然排除；旧 buildSummary 原样保留（向后兼容）。
'use strict';

const zones = require('../../shared/zones');
const enums = require('../../shared/enums');
const time = require('../../lib/time');

const { ORDER_STATUS } = enums;
const ONGOING_STATUSES = [ORDER_STATUS.SUBMITTED, ORDER_STATUS.ACCEPTED, ORDER_STATUS.EXCEPTION];
// D54：复制汇总只统计「已送达/已完成」（待确认 + 顾客已确认）；取消单不在集合内
const DELIVERED_TODAY_STATUSES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED];
const DELIVERED_TODAY_SCOPE = 'deliveredToday';

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

function buildSummary(rows, options) {
  const opts = options || {};
  const list = Array.isArray(rows) ? rows : [];
  const summary = {
    total: 0,
    parcels: 0,
    byStatus: { picked: 0, delivered: 0, ongoing: 0 },
    byDorm: [],
    truncated: opts.truncated === true
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

// D54（批 20）：复制汇总「今日已送达」口径——deliveredAt 落在 UTC+8 今日（00:00~now）且状态为
// DELIVERED/COMPLETED 的单；取消单不在目标状态集内（天然排除）；只到苑+楼栋级（隐私口径同 D48）。
// rows = 本次 view 命中的原始订单文档（view=day 含七状态扫描行，覆盖 DELIVERED/COMPLETED 全集）；
// options.nowMs 固定时钟（测试注入，缺省本机）、options.truncated 同 D48 语义（扫描触顶如实少报）。
// 返回形状（与 D48 旧 summary 不同、带 scope 标记，客户端纯件据此分支）：
//   {scope:'deliveredToday', total, parcels, completed, pending, byDorm:[{zone,buildingNo,count}], truncated}
function deliveredMsOf(order) {
  const raw = order && order.deliveredAt;
  if (typeof raw === 'number') {
    return isFinite(raw) && raw > 0 ? raw : 0;
  }
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof raw === 'string' && raw) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

function buildDeliveredToday(rows, options) {
  const opts = options || {};
  const nowMs = typeof opts.nowMs === 'number' && isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const startMs = nowMs - ((nowMs + time.TZ_OFFSET_MS) % time.DAY_MS);
  const summary = {
    scope: DELIVERED_TODAY_SCOPE,
    total: 0,
    parcels: 0,
    completed: 0,
    pending: 0,
    byDorm: [],
    truncated: opts.truncated === true
  };
  const dormMap = {};
  (Array.isArray(rows) ? rows : []).forEach(function eachOrder(order) {
    if (DELIVERED_TODAY_STATUSES.indexOf(order && order.status) < 0) {
      return;
    }
    const deliveredMs = deliveredMsOf(order);
    if (!deliveredMs || deliveredMs < startMs || deliveredMs > nowMs) {
      return;
    }
    summary.total += 1;
    summary.parcels += orderParcelsOf(order).length;
    if (order.status === ORDER_STATUS.COMPLETED) {
      summary.completed += 1;
    } else {
      summary.pending += 1;
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

module.exports = { buildSummary, buildDeliveredToday };
