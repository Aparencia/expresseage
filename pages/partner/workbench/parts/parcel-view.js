// pages/partner/workbench/parts/parcel-view.js · v1.0 一单多包裹纯件（零 wx、零页面状态）
// 口径：CONTRACT §5/§5.1/§5.2（D61 件级取件：每件 `picked/pickedAt/actions`、整单 `pickedCount/parcelCount/allPicked`）、
//       UX_PARTNER §4.3/§4.16（D62 按**件的站点**分组：一单在每个件站点组各出现一次，组内只列本站件 +
//       「另 N 件在 Pn」；四档动线排序按**本站件**计算）。
// 兼容：历史 DTO 只有 `parcel{}`（视作 1 件）；无件级 `picked` 字段的旧夹具视作未取（真值以服务端为准）。
'use strict';

const enums = require('../../../../shared/enums');
const format = require('../../../../shared/format');

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

// 服务端 parcel.actions 契约 string[]（{key} 对象也容忍）：只留非空键，去重保序
function actionKeysOf(raw) {
  const keys = [];
  listOf(raw && raw.actions).forEach((entry) => {
    const key = typeof entry === 'string' ? entry : textOf(entry && entry.key);
    if (key && keys.indexOf(key) < 0) {
      keys.push(key);
    }
  });
  return keys;
}

// pickedAt：服务端契约毫秒 number（未取=0）；兼容 ISO 串/Date 夹具
function msOfPickedAt(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  return format.formatTime(value) ? Date.parse(value) || 0 : 0;
}

function pieceOfRaw(raw, index) {
  const row = raw || {};
  const codeStatus = textOf(row.codeStatus);
  const picked = row.picked === true;
  const pickedAt = msOfPickedAt(row.pickedAt);
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
    failureId: textOf(row.failureId),
    picked: picked,
    pickedText: picked ? '已取' : '待取',
    pickedAt: pickedAt,
    pickedAtText: picked ? format.formatTime(pickedAt) : '',
    actions: actionKeysOf(row)
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

// 四档：1 需查明 → 2 快递柜 → 3 分段码 → 4 其他（D62 组内按本站件计算）
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

// 组内排序锚：取本站件里档位最差的件（同档取首个），排序键=该件码内数字
function worstOfPieces(pieces) {
  const list = listOf(pieces);
  let worst = list[0] || pieceOfRaw({}, 0);
  list.forEach((piece) => {
    if (tierOfPiece(piece) < tierOfPiece(worst)) {
      worst = piece;
    }
  });
  return worst;
}

function tierOfPieces(pieces) {
  return tierOfPiece(worstOfPieces(pieces));
}

function routeNumberOfPieces(pieces) {
  const code = textOf(worstOfPieces(pieces).pickupCode).replace(/[^0-9]/g, '');
  return code === '' ? Number.MAX_SAFE_INTEGER : Number(code);
}

function tierTextOf(tier) {
  return TIER_TEXT[tier] || '';
}

// D62：按件的站点分区——每件恰好落一个站点组（未识别站点=空串键，由调用方归「站点未知」）
function stationGroupsOf(order) {
  const map = {};
  const keys = [];
  piecesOf(order).forEach((piece) => {
    const key = piece.stationId;
    if (!map[key]) {
      map[key] = { stationId: key, stationName: piece.stationName, pieces: [] };
      keys.push(key);
    }
    if (!map[key].stationName) {
      map[key].stationName = piece.stationName;
    }
    map[key].pieces.push(piece);
  });
  return keys.map((key) => map[key]);
}

function piecesForStationOf(order, stationId) {
  const groups = stationGroupsOf(order);
  const target = textOf(stationId);
  const hit = groups.filter((group) => group.stationId === target)[0];
  return hit ? hit.pieces : [];
}

// 「另 N 件在 Pn」：本站组之外的件数 + 站点列表（多站用 / 连接；未识别站给「站点未知」）
function otherPiecesTextOf(order, stationId) {
  const target = textOf(stationId);
  const others = stationGroupsOf(order).filter((group) => group.stationId !== target);
  let count = 0;
  const names = [];
  others.forEach((group) => {
    count += group.pieces.length;
    const name = group.stationId || FALLBACK_STATION_TEXT;
    if (names.indexOf(name) < 0) {
      names.push(name);
    }
  });
  if (!count) {
    return '';
  }
  return '另 ' + count + ' 件在 ' + names.join(' / ');
}

// 站点聚合：去重后的站点 ID（缺 ID 用名称）；≤2 全列，>2 折叠（行摘要=整单视角）
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

// 需查明聚合（整单任一需查明，D62 行摘要=整单视角）；历史 DTO 的 needCode 兼容兜底
function needCodeOf(order) {
  const item = order || {};
  if (item.needCode === true) {
    return true;
  }
  return piecesOf(item).some((piece) => piece.needCode);
}

// D61 整单取件进度：优先服务端聚合字段（pickedCount/parcelCount/allPicked），夹具/旧 DTO 按件字段兜底
function pickedFieldsOf(order) {
  const item = order || {};
  const pieces = piecesOf(item);
  const parcelCount = typeof item.parcelCount === 'number' && item.parcelCount > 0
    ? item.parcelCount
    : pieces.length;
  const derived = pieces.filter((piece) => piece.picked).length;
  const rawCount = typeof item.pickedCount === 'number' && isFinite(item.pickedCount)
    ? item.pickedCount
    : derived;
  const pickedCount = Math.max(0, Math.min(parcelCount, rawCount));
  const allPicked = typeof item.allPicked === 'boolean'
    ? item.allPicked
    : (parcelCount > 0 && pickedCount >= parcelCount);
  return {
    pickedCount: pickedCount,
    parcelCount: parcelCount,
    allPicked: allPicked,
    pickedCountText: parcelCount > 1 ? '已取 ' + pickedCount + '/' + parcelCount + ' 件' : ''
  };
}

module.exports = {
  FALLBACK_STATION_TEXT,
  TIER_TEXT,
  piecesOf,
  pieceOf,
  indexTextOf,
  codeTextOf,
  actionKeysOf,
  tierOfPiece,
  tierOfPieces,
  routeNumberOfPieces,
  tierTextOf,
  stationGroupsOf,
  piecesForStationOf,
  otherPiecesTextOf,
  stationSummaryOf,
  countTextOf,
  needCodeCountTextOf,
  reviewTextOf,
  manualEntryOf,
  manualEntryTextOf,
  needCodeOf,
  pickedFieldsOf
};
