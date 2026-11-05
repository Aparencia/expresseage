// pkg-customer/pages/order-detail/parts/parcel-view.js · 订单详情「多包裹/多图/配送地址」视图纯件（零 wx）
// v1.0（D23/D24/D25）：orders 从单 parcel/image 改 parcels[]/images[] + delivery + manualEntry；
// 兼容切换期旧 DTO（order.parcel / order.image）——后端 task-21 收口后可删兼容分支。
'use strict';

const enums = require('../../../../shared/enums');
const zones = require('../../../../shared/zones');
const appointUtil = require('../../../../shared/appoint');
const state = require('../../../../shared/order-state');
const format = require('../../../parts/format');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countOf(value) {
  return typeof value === 'number' && isFinite(value) ? Math.floor(value) : null;
}

// D61 件级取件顾客可见的订单状态集（UX_CUSTOMER §3.8）：已进入履约的订单才展示每件「已取件/待取件」
// 与「已取 n/m 件」摘要；SUBMITTED（兼职还没接，逐件「待取件」是噪音）与 CANCELLED（终态已无履约意义）不展示。
const PICKUP_VISIBLE_STATUSES = [
  state.STATUS.ACCEPTED,
  state.STATUS.PICKED,
  state.STATUS.DELIVERED,
  state.STATUS.COMPLETED,
  state.STATUS.EXCEPTION
];

function pickupVisible(status) {
  return PICKUP_VISIBLE_STATUSES.indexOf(status) !== -1;
}

function parcelsOf(order) {
  const list = order && Array.isArray(order.parcels) ? order.parcels : [];
  if (list.length > 0) {
    return list.map(function map(entry) {
      return entry && entry.parcel ? entry.parcel : entry || {};
    });
  }
  return order && order.parcel ? [order.parcel] : [];
}

function codeTextOf(parcel) {
  const value = parcel || {};
  if (value.codeStatus === enums.CODE_STATUS.NEED_CODE) {
    return '需查明（兼职正在查码）';
  }
  const code = textOf(value.pickupCode);
  if (code) return code;
  const tail = textOf(value.trackingTail);
  if (tail) return '尾号 ' + tail;
  return '—';
}

// D61 件级取件：每件只读 DTO 的 picked/pickedAt（旧单由服务端按订单状态派生，客户端不自行推导、不设操作按钮）
function pickStateOf(parcel) {
  const value = parcel || {};
  const picked = value.picked === true;
  return {
    hasPickState: typeof value.picked === 'boolean',
    picked: picked,
    pickedText: picked ? '已取件' : '待取件',
    pickedAtText: picked ? format.formatDateTime(value.pickedAt) : ''
  };
}

/** 多包裹行：每件站点/取件码/柜号/尾号 + 缺码提示 + 件级取件状态/时间（服务端 parcels[] 顺序即提交顺序） */
function parcelsView(order) {
  const visible = pickupVisible(order && order.status);
  return parcelsOf(order).map(function map(parcel, index) {
    const pick = pickStateOf(parcel);
    return {
      no: index + 1,
      stationName: textOf(parcel.stationName) || '未识别',
      pickupCode: textOf(parcel.pickupCode),
      codeText: codeTextOf(parcel),
      lockerNo: textOf(parcel.lockerNo),
      trackingTail: textOf(parcel.trackingTail),
      needCode: parcel.codeStatus === enums.CODE_STATUS.NEED_CODE,
      // 展示条件先收敛到状态集：SUBMITTED/CANCELLED 不出件级「已取件/待取件」行
      hasPickState: visible && pick.hasPickState,
      picked: pick.picked,
      pickedText: pick.pickedText,
      pickedAtText: pick.pickedAtText,
      count: parcelsOf(order).length
    };
  });
}

/**
 * D61 部分取件进度（订单摘要/进度区）：只读 DTO pickedCount/parcelCount/allPicked，不读件级明细也不推导动作。
 * 0 件已取 / 全部取完不显示 n/m（与订单状态「已取件」重复）；状态集同件级状态行（§3.8）；
 * 「全部取完后进入已取件」提示只在订单仍已接单时给。
 */
function pickupView(order) {
  const item = order || {};
  const parcelCount = countOf(item.parcelCount);
  const pickedCount = countOf(item.pickedCount);
  const partial = pickupVisible(item.status)
    && parcelCount !== null && pickedCount !== null
    && pickedCount > 0 && pickedCount < parcelCount && item.allPicked !== true;
  const summaryText = partial ? '已取 ' + pickedCount + '/' + parcelCount + ' 件' : '';
  return {
    pickedCount: pickedCount,
    parcelCount: parcelCount,
    allPicked: item.allPicked === true,
    summaryText: summaryText,
    partialHint: partial && item.status === state.STATUS.ACCEPTED
      ? summaryText + '，全部取完后进入已取件'
      : ''
  };
}

function addressTextOf(address) {
  const value = address || {};
  const zone = zones.normalizeZone(value.zone);
  const zoneLabel = zones.zoneLabel(zone);
  const buildingText = textOf(value.buildingText) || zones.buildingText(zone, value.buildingNo);
  const room = textOf(value.room);
  const parts = [];
  if (zoneLabel) parts.push(zoneLabel);
  if (buildingText) parts.push(buildingText + ' 栋');
  if (room) parts.push(room);
  return parts.join('');
}

/** 本单配送地址（D25）：有 delivery 用它，否则退回 dorm（本人宿舍快照，切换期兼容） */
function deliveryView(order) {
  const delivery = order && order.delivery && typeof order.delivery === 'object' ? order.delivery : null;
  const dorm = order && order.dorm && typeof order.dorm === 'object' ? order.dorm : null;
  const source = delivery || dorm;
  const address = source ? addressTextOf(source) : '';
  const recipientName = delivery ? textOf(delivery.recipientName) : '';
  return {
    text: address || '—',
    recipientName: recipientName,
    isOther: !!recipientName,
    forSelfText: delivery && !recipientName ? '本人宿舍' : ''
  };
}

// 单张截图可见性摘要归一：服务端 v1.0 DTO 只下发 {index,status,hasImage,cleaned}，
// 存储句柄与清理时刻都不出云（看图只经 order.imageUrl({orderNo,index}) 鉴权签发）。
// status: AVAILABLE 可看 / CLEANED 已按隐私策略清理 / MISSING 无图；hasImage/cleaned 为旧口径兼容键。
function imageRowOf(image, fallbackIndex) {
  const source = image && typeof image === 'object' ? image : {};
  const status = textOf(source.status);
  const cleaned = source.cleaned === true || status === 'CLEANED';
  const index = typeof source.index === 'number' && source.index >= 0 ? source.index : fallbackIndex;
  return {
    index: index,
    cleaned: cleaned,
    viewable: !cleaned && (status === 'AVAILABLE' || source.hasImage === true)
  };
}

// images[] 优先；历史单 images 缺失时退回 order.image 单图摘要（有图/已清理才出一行，全无则无图）
function imageRowsOf(order) {
  const list = order && Array.isArray(order.images) ? order.images : [];
  if (list.length > 0) return list.map(imageRowOf);
  const image = order && order.image && typeof order.image === 'object' ? order.image : null;
  if (!image || (image.hasImage !== true && image.cleaned !== true)) return [];
  return [imageRowOf(image, 0)];
}

/** 截图（D23/D40 一单 0~10 张）：全部已清理/部分可看/无图三态 */
function imagesView(order) {
  const rows = imageRowsOf(order);
  const viewable = [];
  let cleanedCount = 0;
  rows.forEach(function each(row) {
    if (row.cleaned) cleanedCount += 1;
    if (row.viewable) viewable.push({ index: row.index, label: '第 ' + (row.index + 1) + ' 张' });
  });
  if (rows.length === 0) {
    return { state: 'NONE', canView: false, text: '无截图·手填', count: 0, cleanedCount: 0, list: [] };
  }
  if (viewable.length === 0) {
    // 只有确实被清理才说「已按隐私策略删除」；MISSING（无图）不能说成已删除（对用户说真话）
    if (cleanedCount > 0) {
      return {
        state: 'EXPIRED',
        canView: false,
        text: '截图已按隐私策略删除',
        count: rows.length,
        cleanedCount: cleanedCount,
        list: []
      };
    }
    return { state: 'NONE', canView: false, text: '无截图·手填', count: rows.length, cleanedCount: 0, list: [] };
  }
  return {
    state: 'AVAILABLE',
    canView: true,
    text: '查看截图（' + viewable.length + ' 张）',
    count: rows.length,
    cleanedCount: cleanedCount,
    list: viewable
  };
}

/**
 * 多图预览计划（2026-11-05 真机缺陷回归）：一次把「全部签名成功的截图」交给 wx.previewImage，
 * 可左右滑动；current = 用户点的那一张（该张失败则退第一张成功图）。
 * @param {number} tappedIndex 用户点击的下标（image.list[].index）
 * @param {Array<{index:number,url:string}>} results 逐张签发结果（失败项 url 为空）
 * @returns {null|{urls:string[],current:string}} 全失败返回 null（页面据此走错误态，不弹空预览）
 */
function previewOf(tappedIndex, results) {
  const ok = (Array.isArray(results) ? results : []).filter(function usable(row) {
    return row && typeof row.url === 'string' && row.url !== '';
  });
  if (!ok.length) return null;
  const urls = ok.map(function urlOf(row) { return row.url; });
  const hit = ok.filter(function same(row) { return row.index === tappedIndex; })[0];
  return { urls: urls, current: (hit || ok[0]).url };
}

/**
 * 服务类型展示（D41/D49）：名称取订单快照；历史已停用类型（服务端 DTO.service.deprecated=true，如 PICKUP_DOOR）
 * 按 shared/enums 名称单源渲染「送寝上门（已停用）」，不新造名称。说明=公开配置 serviceCatalog 的 desc 单源
 * （标准代取＝送到寝室门口（上楼）/ 送至楼下＝宿舍楼下/约定地点（不上楼））；停用类型/目录外 code 无说明。
 */
function serviceView(order, config) {
  const service = order && order.service && typeof order.service === 'object' ? order.service : {};
  const code = textOf(service.code);
  const deprecated = service.deprecated === true;
  const catalog = config && Array.isArray(config.serviceCatalog) ? config.serviceCatalog : [];
  const hit = catalog.filter(function match(entry) { return entry && entry.code === code; })[0];
  return {
    serviceText: deprecated ? (enums.serviceNameOf(code) || textOf(service.name)) : textOf(service.name),
    serviceDeprecated: deprecated,
    serviceDesc: deprecated || !hit ? '' : textOf(hit.desc)
  };
}

// 预约展示（D47）：ASAP「尽快」/ LATEST「最晚 M月D日 HH:MM」/ 历史 SLOT「预约时段 起-止」；
// 到点未送达只标红提示（纯展示：不改状态、不自动取消，服务端也不按最晚时间取消）。
function appointView(order, nowMs) {
  const item = order && typeof order === 'object' ? order : {};
  const view = appointUtil.viewOf(item.appoint, item.status, nowMs);
  const slotRange = appointUtil.slotRangeTextOf(item.appoint);
  return {
    appointText: slotRange ? view.text + ' ' + slotRange : view.text,
    appointType: view.type,
    appointOverdue: view.overdue,
    appointOverdueText: view.overdueText
  };
}

/** 页面可直接 Object.assign 的扩展字段（含 image，覆盖旧单图 imageView；D61 部分取件进度） */
function pageExtras(order, config, nowMs) {
  const parcels = parcelsView(order);
  const delivery = deliveryView(order);
  const service = serviceView(order, config);
  const appoint = appointView(order, nowMs);
  const pickup = pickupView(order);
  return {
    parcels: parcels,
    parcelCount: parcels.length,
    pickupSummary: pickup.summaryText,
    pickupPartialHint: pickup.partialHint,
    pickupCodeText: parcels.length === 1 ? parcels[0].codeText : '',
    deliveryText: delivery.text,
    deliveryRecipient: delivery.recipientName,
    deliveryIsOther: delivery.isOther,
    manualEntryText: order && order.manualEntry === true ? '无截图·手填' : '',
    image: imagesView(order),
    serviceText: service.serviceText,
    serviceDesc: service.serviceDesc,
    appointText: appoint.appointText,
    appointOverdue: appoint.appointOverdue,
    appointOverdueText: appoint.appointOverdueText
  };
}

module.exports = {
  parcelsOf,
  codeTextOf,
  parcelsView,
  addressTextOf,
  deliveryView,
  imagesView,
  previewOf,
  serviceView,
  appointView,
  pageExtras
};
