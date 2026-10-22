// pkg-customer/pages/order-create/parts/reorder.js · 「再次下单」预填（纯件，零 wx）
// 口径：UX §3.8/§3.4（再次下单 → order-create?reorder=orderNo）；AC-C-21/§5.4。
// 只预填「服务类型（该类型仍启用时）」与「站点」；绝不复制取件码/尾号/柜号/截图/识别结果；
// order.get 归属校验在服务端，失败/无权限一律静默回普通下单（不打断用户）。
'use strict';

const stations = require('../../../../shared/stations');

const PREFILL_KEYS = ['serviceCode', 'stationId', 'stationName'];

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function orderNoOf(options) {
  const value = options && options.reorder;
  return textOf(value);
}

/** 老订单 DTO → 预填快照（只有三个字段；任何 L3 字段都不带）
 * v1.0（D23）：订单 DTO 从单 parcel 改 parcels[]，这里取第一件做站点预填；兼容旧单图字段。 */
function prefillFromOrder(order) {
  if (!order) return null;
  const parcels = Array.isArray(order.parcels) ? order.parcels : [];
  const parcel = parcels.length > 0 ? (parcels[0] && parcels[0].parcel) || parcels[0] || {} : (order.parcel || {});
  const service = order.service || {};
  return {
    serviceCode: textOf(service.code),
    stationId: textOf(parcel.stationId),
    stationName: textOf(parcel.stationName)
  };
}

/** 服务类型仍启用才预填（兼职已关掉该类型 → 回退页面默认第一项，不强行保留） */
function serviceCodeOf(prefill, services) {
  const wanted = textOf(prefill && prefill.serviceCode);
  if (!wanted) return '';
  const list = services || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].code === wanted) return wanted;
  }
  return '';
}

/** 站点必须在 P1~P8 正式值域内才预填（不做模糊映射；服务端站点表单源） */
function stationOf(prefill) {
  const stationId = textOf(prefill && prefill.stationId);
  if (!stationId || !stations.isStationId(stationId)) return { stationId: '', stationName: '' };
  if (!stations.stationNameOf(stationId)) return { stationId: '', stationName: '' };
  return { stationId: stationId, stationName: stations.stationNameOf(stationId) };
}

/** 与件默认值合并：服务类型/站点可预填，取件字段绝不动 */
function defaultsFor(base, prefill, services) {
  const out = Object.assign({}, base || {});
  if (!prefill) return out;
  const code = serviceCodeOf(prefill, services);
  if (code) out.serviceCode = code;
  const station = stationOf(prefill);
  if (station.stationId) {
    out.stationId = station.stationId;
    out.stationName = station.stationName;
  }
  return out;
}

/** 识别已完成时才拿到的预填：只补空站点/空服务类型，不覆盖用户已填内容 */
function applyToItems(items, prefill, services) {
  const list = items || [];
  if (!prefill) return list;
  const code = serviceCodeOf(prefill, services);
  const station = stationOf(prefill);
  return list.map(function map(item) {
    const next = Object.assign({}, item);
    if (code && !next.serviceCode) next.serviceCode = code;
    if (station.stationId && !next.stationId) {
      next.stationId = station.stationId;
      next.stationName = station.stationName;
    }
    return next;
  });
}

/**
 * 拉取老订单并给出预填快照；任何失败（无权限/不存在/网络）都静默返回 null。
 * @param {{orderNo:string, getOrder:function}} deps getOrder = api/modules/order.get
 * @returns {Promise<object|null>}
 */
async function load(deps) {
  const input = deps || {};
  const orderNo = textOf(input.orderNo);
  if (!orderNo || typeof input.getOrder !== 'function') return null;
  try {
    const data = await input.getOrder({ orderNo: orderNo });
    return prefillFromOrder(data && data.order);
  } catch (err) {
    return null;
  }
}

module.exports = {
  PREFILL_KEYS,
  orderNoOf,
  prefillFromOrder,
  serviceCodeOf,
  stationOf,
  defaultsFor,
  applyToItems,
  load
};
