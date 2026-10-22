// pkg-customer/pages/order-detail/parts/parcel-view.js · 订单详情「多包裹/多图/配送地址」视图纯件（零 wx）
// v1.0（D23/D24/D25）：orders 从单 parcel/image 改 parcels[]/images[] + delivery + manualEntry；
// 兼容切换期旧 DTO（order.parcel / order.image）——后端 task-21 收口后可删兼容分支。
'use strict';

const enums = require('../../../../shared/enums');
const zones = require('../../../../shared/zones');

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
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

/** 多包裹行：每件站点/取件码/柜号/尾号 + 缺码提示（服务端 parcels[] 顺序即提交顺序） */
function parcelsView(order) {
  return parcelsOf(order).map(function map(parcel, index) {
    return {
      no: index + 1,
      stationName: textOf(parcel.stationName) || '未识别',
      pickupCode: textOf(parcel.pickupCode),
      codeText: codeTextOf(parcel),
      lockerNo: textOf(parcel.lockerNo),
      trackingTail: textOf(parcel.trackingTail),
      needCode: parcel.codeStatus === enums.CODE_STATUS.NEED_CODE,
      count: parcelsOf(order).length
    };
  });
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

/** 截图（D23 一单 0~5 张）：全部已清理/部分可看/无图三态 */
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

/** 页面可直接 Object.assign 的扩展字段（含 image，覆盖旧单图 imageView） */
function pageExtras(order) {
  const parcels = parcelsView(order);
  const delivery = deliveryView(order);
  return {
    parcels: parcels,
    parcelCount: parcels.length,
    pickupCodeText: parcels.length === 1 ? parcels[0].codeText : '',
    deliveryText: delivery.text,
    deliveryRecipient: delivery.recipientName,
    deliveryIsOther: delivery.isOther,
    manualEntryText: order && order.manualEntry === true ? '无截图·手填' : '',
    image: imagesView(order)
  };
}

module.exports = {
  parcelsOf,
  codeTextOf,
  parcelsView,
  addressTextOf,
  deliveryView,
  imagesView,
  pageExtras
};
