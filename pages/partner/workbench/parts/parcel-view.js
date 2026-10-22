// pages/partner/workbench/parts/parcel-view.js · v1.0 一单多包裹纯件（零 wx、零页面状态）
// 口径：CONTRACT §5/§5.1/§5.2（`parcels[]` 1~10 件、`order.correct` 按 `itemIndex`、`manualEntry` 无截图手填）；
//       UX_PARTNER §4.3/§4.16（行聚合=件数/站点聚合/需查明聚合/无截图标识；四档按整单最差件；分组按首件站点）。
// 兼容：历史 DTO 只有 `parcel{}`（视作 1 件），消费方不用写"有没有 parcels"的分支判据。
'use strict';

const enums = require('../../../../shared/enums');

const TIER_TEXT = { 1: '需查明', 2: '快递柜', 3: '分段码', 4: '其他' };
const STATION_SUMMARY_MAX = 2;
const FALLBACK_STATION_TEXT = '站点未知';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function indexTextOf(index) {
  return '第 ' + (index + 1) + ' 件';
}

function codeTextOf(piece) {
  const item = piece || {};
  const code = textOf(item.pickupCode);
  if (code) {
    return code;
  }
  const tail = textOf(item.trackingTail);
  return tail ? '尾号' + tail : '待补码';
}

function pieceOfRaw(raw, index) {
  const row = raw || {};
  const codeStatus = textOf(row.codeStatus);
  return {
    index: index,
    indexText: indexTextOf(index),
    stationId: textOf(row.stationId),
    stationName: textOf(row.stationName),
    stationText: textOf(row.stationName) || FALLBACK_STATION_TEXT,
    pickupCode: textOf(row.pickupCode),
    lockerNo: textOf(row.lockerNo),
    lockerText: textOf(row.lockerNo),
    trackingTail: textOf(row.trackingTail),
    codeText: codeTextOf(row),
    codeStatus: codeStatus,
    codeStatusText: textOf(row.codeStatusText) || textOf(enums.CODE_STATUS_TEXT[codeStatus]),
    needCode: codeStatus === enums.CODE_STATUS.NEED_CODE,
    failureId: textOf(row.failureId)
  };
}

// 逐件视图：优先 parcels[]；历史单包裹 parcel{} 视作 1 件（同一视图，不新增判据）
function piecesOf(order) {
  const item = order || {};
  const parcels = listOf(item.parcels);
  if (parcels.length) {
    return parcels.map((raw, index) => pieceOfRaw(raw, index));
  }
  if (item.parcel) {
    return [pieceOfRaw(item.parcel, 0)];
  }
  return [pieceOfRaw({ pickupCode: item.pickupCode, lockerNo: item.lockerNo, trackingTail: item.trackingTail }, 0)];
}

function pieceOf(order, itemIndex) {
  const list = piecesOf(order);
  const index = typeof itemIndex === 'number' && itemIndex >= 0 ? itemIndex : 0;
  return list[index] || list[0];
}

function pieceCountOf(order) {
  return piecesOf(order).length;
}

// 四档：1 需查明 → 2 快递柜 → 3 分段码 → 4 其他（整单取最差件，与 CONTRACT §5 组内四档同序）
function tierOfPiece(piece) {
  const item = piece || {};
  if (item.codeStatus === enums.CODE_STATUS.NEED_CODE) {
    return 1;
  }
  if (textOf(item.lockerNo) !== '') {
    return 2;
  }
  if (/[^0-9]/.test(textOf(item.pickupCode))) {
    return 3;
  }
  return 4;
}

function worstPieceOf(order) {
  const list = piecesOf(order);
  let worst = list[0] || pieceOfRaw({}, 0);
  list.forEach((piece) => {
    if (tierOfPiece(piece) < tierOfPiece(worst)) {
      worst = piece;
    }
  });
  return worst;
}

function tierOf(order) {
  return tierOfPiece(worstPieceOf(order));
}

function tierTextOf(tier) {
  return TIER_TEXT[tier] || '';
}

// 同档排序键：取整单最差件的码内数字（无数字排最后）
function routeNumberOf(order) {
  const code = textOf(worstPieceOf(order).pickupCode).replace(/[^0-9]/g, '');
  return code === '' ? Number.MAX_SAFE_INTEGER : Number(code);
}

// 分组键：首件站点（首个有站点的件），跨站点订单只归一组（UX §4.3）
function stationKeyOf(order) {
  const list = piecesOf(order);
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].stationId) {
      return list[index].stationId;
    }
  }
  return '';
}

function primaryStationNameOf(order) {
  const list = piecesOf(order);
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].stationId) {
      return list[index].stationName;
    }
  }
  return textOf(list[0] && list[0].stationName);
}

// 站点聚合：去重后的站点 ID（缺 ID 用名称）；≤2 全列，>2 折叠
function stationSummaryOf(pieces) {
  const list = listOf(pieces);
  const keys = [];
  list.forEach((piece) => {
    const key = textOf(piece.stationId) || textOf(piece.stationName);
    if (key && keys.indexOf(key) < 0) {
      keys.push(key);
    }
  });
  if (keys.length <= 1) {
    // 单站不重复 chip（组头已显示站名，UX §4.16）
    return { text: '', count: keys.length, overflow: false };
  }
  if (keys.length <= STATION_SUMMARY_MAX) {
    return { text: keys.join(' / '), count: keys.length, overflow: false };
  }
  return { text: keys[0] + ' 等 ' + keys.length + ' 站', count: keys.length, overflow: true };
}

function countTextOf(pieces) {
  const count = listOf(pieces).length;
  return count > 1 ? count + ' 件' : '';
}

function needCodeCountTextOf(pieces) {
  const list = listOf(pieces);
  const count = list.filter((piece) => piece.needCode).length;
  // 单件单保持 v0.9 视觉（只显示「需查明」chip）；多件单给按件计数
  return count >= 1 && list.length > 1 ? count + ' 件需查明' : '';
}

function reviewTextOf(pieces) {
  const count = listOf(pieces).filter((piece) => piece.failureId).length;
  if (count > 1) {
    return count + ' 件已反馈复核';
  }
  return count === 1 ? '已反馈开发者复核' : '';
}

// manualEntry：服务端派生字段（images=[]）；历史 DTO 无该字段 → false
function manualEntryOf(order) {
  return !!(order && order.manualEntry === true);
}

function manualEntryTextOf(order) {
  return manualEntryOf(order) ? '无截图·手填' : '';
}

// 需查明聚合（整单任一需查明）；历史 DTO 的 needCode 兼容兜底
function needCodeOf(order) {
  const item = order || {};
  if (item.needCode === true) {
    return true;
  }
  return piecesOf(item).some((piece) => piece.needCode);
}

module.exports = {
  FALLBACK_STATION_TEXT,
  TIER_TEXT,
  piecesOf,
  pieceOf,
  pieceCountOf,
  indexTextOf,
  codeTextOf,
  tierOfPiece,
  worstPieceOf,
  tierOf,
  tierTextOf,
  routeNumberOf,
  stationKeyOf,
  primaryStationNameOf,
  stationSummaryOf,
  countTextOf,
  needCodeCountTextOf,
  reviewTextOf,
  manualEntryOf,
  manualEntryTextOf,
  needCodeOf
};
