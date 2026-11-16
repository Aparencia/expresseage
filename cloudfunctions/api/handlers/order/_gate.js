// handlers/order/_gate.js · E 校门代取（line=GATE）下单形态归一与内部包裹占位
// 口径：2026-11-16 用户澄清「外卖员已送到大学东门，顾客再委托从东门取到校内」；无商家/餐品/抢单/支付。
// 边界：仅服务端纯件（零 DB/零 wx）；校门点与物品分类只做展示/分组，不涉及商家、餐品或款项字段。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isGate(order) {
  return !!order && order.line === enums.ORDER_LINE.GATE;
}

// line 缺省=EXPRESS（旧客户端/旧单零迁移）；显式非法值不静默降级。
function readLine(input) {
  const raw = isPlainObject(input) ? textOf(input.line) : '';
  if (raw === '') {
    return enums.ORDER_LINE.EXPRESS;
  }
  if (enums.ORDER_LINE_LIST.indexOf(raw) < 0) {
    throw errors.validation('line', '订单类型不在可选范围内，请刷新页面后重试');
  }
  return raw;
}

function gatePointsOf(config) {
  const list = config && Array.isArray(config.gatePoints) ? config.gatePoints : [];
  const out = [];
  const ids = {};
  list.forEach((item) => {
    if (!item || typeof item !== 'object' || out.length >= 5) return;
    const id = textOf(item.id).toUpperCase();
    const name = textOf(item.name);
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(id) || !name || name.length > 20 || ids[id]) return;
    ids[id] = true;
    out.push({ id, name });
  });
  if (out.length) return out;
  return enums.DEFAULT_GATE_POINTS.map((item) => ({ id: item.id, name: item.name }));
}

// 校门点：id 优先、name 兜底；只接受当前配置里的点（不在配置里不猜）。
function normalizeGate(input, config) {
  if (config && config.gateEnabled !== true) {
    throw errors.invalidState('校门代取暂未开放，请稍后再试');
  }
  if (!isPlainObject(input)) {
    throw errors.validation('gate', '请选择校门');
  }
  const allowed = ['pointId', 'pointName', 'itemKind'];
  const unknown = Object.keys(input).filter((key) => allowed.indexOf(key) < 0);
  if (unknown.length) {
    throw errors.validation('gate', '校门代取信息包含不认识的字段，请刷新页面后重试');
  }
  const points = gatePointsOf(config);
  const pointId = textOf(input.pointId).toUpperCase();
  const pointName = textOf(input.pointName);
  let hit = null;
  if (pointId) {
    hit = points.filter((item) => item.id === pointId)[0] || null;
  } else if (pointName) {
    hit = points.filter((item) => item.name === pointName)[0] || null;
  }
  if (!hit) {
    throw errors.validation('gate', '校门点不在可选范围内，请重新选择');
  }
  const rawKind = textOf(input.itemKind).toUpperCase();
  const itemKind = rawKind === '' ? enums.GATE_ITEM_KIND.UNKNOWN : rawKind;
  if (enums.GATE_ITEM_KIND_LIST.indexOf(itemKind) < 0) {
    throw errors.validation('gate', '物品类型不在可选范围内');
  }
  return { pointId: hit.id, pointName: hit.name, itemKind };
}

// GATE 入参形态：拒绝商家/包裹/截图/代客/合并等快递专属字段，避免客户端把两种线混用。
function assertGateShape(input) {
  const value = isPlainObject(input) ? input : {};
  const forbidden = ['parcels', 'images', 'tickets', 'ticket', 'image', 'guest', 'bindingId', 'recognition'];
  const hit = forbidden.filter((key) => value[key] !== undefined && value[key] !== null);
  if (hit.length) {
    throw errors.validation(hit[0], '校门代取不需要该字段，请刷新页面后重试');
  }
  if (value.manualEntry !== undefined && value.manualEntry !== false) {
    throw errors.validation('manualEntry', '校门代取不需要截图手填标记');
  }
  if (value.mergeAppend !== undefined && value.mergeAppend !== false) {
    throw errors.validation('mergeAppend', '校门代取不支持合并订单');
  }
  if (Array.isArray(value.addons) && value.addons.length > 0) {
    throw errors.validation('addons', '校门代取不支持附加服务');
  }
  const serviceCode = textOf(value.serviceCode);
  if (serviceCode && serviceCode !== enums.GATE_SERVICE_CODE) {
    throw errors.validation('serviceCode', '校门代取服务类型不正确，请刷新页面后重试');
  }
}

// 内部占位包裹：订单引擎仍按 parcels[1~10] 的既有路径工作（取件/撤销/转派/统计零改动）；
// 该件只承载「校门物品」这一件，不进入站点分组、不要求取件码（markPicked 对 GATE 单独放行）。
function syntheticParcelOf(gate) {
  const pointName = gate && typeof gate.pointName === 'string' ? gate.pointName : '';
  return {
    stationId: '',
    stationName: pointName,
    pickupCode: '',
    lockerNo: '',
    trackingTail: '',
    codeStatus: enums.CODE_STATUS.NEED_CODE,
    recognitionSource: enums.RECOGNITION_SOURCE.MANUAL
  };
}

module.exports = {
  textOf,
  isGate,
  readLine,
  gatePointsOf,
  normalizeGate,
  assertGateShape,
  syntheticParcelOf
};
