// pages/partner/workbench/parts/order-row.js · 工作台行视图（服务端 DTO 项 → 页面稳定行字段；零 wx）
// 口径：CONTRACT §5.2（客户端零件层做四档动线排序）、UX_PARTNER §4.2/§4.3/§4.16（行结构、D62 件站点分组、
//       D61 逐件取件行）。D62：`scope.stationId` 存在时行只承载**本站件**（件行/排序/需查明按本站件算），
//       整单字段（件数/站点聚合/无截图/已取计数）仍按整单展示。
'use strict';

const orderState = require('../../../../shared/order-state');
const orderView = require('../../../../shared/order-view');
const enums = require('../../../../shared/enums');
const roomTag = require('../../../../utils/room-tag');
const filterView = require('./filter-view');
const rowActions = require('./row-actions');
const parcelView = require('./parcel-view');
const pieceActions = require('./piece-actions');
const dayView = require('./day-view');

// 件动作 ↔ 订单级动作等价表：单件单的件按钮不重复行工具已有动作（多件单两处语义不同：整单 vs 单件）
const ORDER_EQUIV = { markPicked: 'pick', unmarkPicked: 'undoPick' };

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function tailText(value) {
  const tail = textOf(value);
  return tail.length === 4 ? '尾号' + tail : '';
}

// 服务端时间是 ISO 字符串（toIso）；兼容毫秒数/Date 与旧字段
function timeTextOf(value) {
  if (!value) {
    return '';
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!ms || Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function anchorTextOf(dormKey, tag) {
  const key = textOf(dormKey);
  const suffix = textOf(tag);
  if (!key) {
    return suffix;
  }
  if (!suffix) {
    return key;
  }
  return roomTag.formatDormTag(key, suffix) || key + suffix;
}

// 行级动作：只搬服务端 actions[]（{key,label}），不增不减；未知键交给 row-actions 注册表丢弃
function actionsOf(item) {
  const list = Array.isArray(item.actions) ? item.actions : [];
  const out = [];
  list.forEach((entry) => {
    if (typeof entry === 'string' && entry) {
      out.push({ key: entry, label: '' });
    } else if (entry && typeof entry.key === 'string' && entry.key) {
      out.push({ key: entry.key, label: textOf(entry.label) });
    }
  });
  return out;
}

// 顾客锚+键（行第二行）：头像/昵称不在行内出现，锚 = dormKey+roomTag
function identityOf(item) {
  const dorm = item.dorm || {};
  const guest = item.guest || item.guestSnapshot || {};
  const counterpart = item.counterpart || {};
  const name = textOf(counterpart.displayName) || textOf(guest.displayName) || textOf(item.customerDisplayName);
  const dormKey = textOf(dorm.dormKey) || textOf(item.dormKey) || textOf(guest.dormKey);
  const tag = textOf(dorm.roomTag) || textOf(item.roomTag) || textOf(guest.roomTag);
  const anchor = anchorTextOf(dormKey, tag);
  const keyText = [tailText(item.phoneTail || guest.phoneTail), name].filter(Boolean).join(' · ');
  const parts = [];
  if (anchor) {
    parts.push(anchor);
  }
  if (keyText) {
    parts.push(keyText);
  }
  return { anchor: anchor, keyText: keyText, anchorKeyText: parts.join(' · '), senderText: anchor && keyText ? '' : keyText };
}

// 件行（D61）：码/站点/柜号/需查明 + 已取状态 + 独立动作；单件单不缩进/不显示「第 n 件」（showIndex=false）
function pieceRowOf(piece, options) {
  const opts = options || {};
  const item = piece || {};
  const multi = opts.multi === true;
  return {
    key: String(item.index) + '#' + textOf(item.stationId),
    index: typeof item.index === 'number' ? item.index : 0,
    indexText: textOf(item.indexText) || '第 1 件',
    showIndex: multi,
    showStation: opts.showStation === true,
    stationId: textOf(item.stationId),
    stationText: [textOf(item.stationId), textOf(item.stationName)].filter(Boolean).join(' ') || parcelView.FALLBACK_STATION_TEXT,
    pickupCode: textOf(item.pickupCode),
    codeText: textOf(item.codeText) || '待补码',
    lockerText: textOf(item.lockerText),
    trackingTail: textOf(item.trackingTail),
    codeStatusText: textOf(item.codeStatusText),
    needCode: item.needCode === true,
    picked: item.picked === true,
    pickedText: textOf(item.pickedText),
    pickedAtText: textOf(item.pickedAtText),
    action: opts.readonly === true ? null : pieceActions.viewOf(item, false)
  };
}

// D61 整单取件进度 + D62 本站件：scope.stationId 存在时只取本站件（含空站点组）
function parcelFieldsOf(item, scope) {
  const allPieces = parcelView.piecesOf(item);
  const scoped = scope && typeof scope.stationId === 'string'
    ? parcelView.piecesForStationOf(item, scope.stationId)
    : allPieces;
  const pieces = scoped.length ? scoped : allPieces;
  const primary = pieces[0] || parcelView.pieceOf({}, 0);
  const stationSummary = parcelView.stationSummaryOf(allPieces);
  const picked = parcelView.pickedFieldsOf(item);
  const multi = allPieces.length > 1;
  const multiStation = parcelView.stationGroupsOf(item).length > 1;
  const showStation = multiStation && pieces.some((piece) => piece.stationId !== textOf(scope && scope.stationId));
  return {
    item: item,
    pieces: pieces,
    allPieces: allPieces,
    primary: primary,
    pickupCode: primary.pickupCode || textOf(item.pickupCode),
    trackingTail: primary.trackingTail || textOf(item.trackingTail),
    stationSummaryText: stationSummary.text,
    manualEntry: parcelView.manualEntryOf(item),
    manualEntryText: parcelView.manualEntryTextOf(item),
    parcelRows: multi ? allPieces : null,
    pieceRows: pieces.map((piece) => pieceRowOf(piece, {
      multi: multi,
      showStation: showStation,
      readonly: !!(scope && scope.readonly)
    })),
    otherPiecesText: scope && typeof scope.stationId === 'string'
      ? parcelView.otherPiecesTextOf(item, scope.stationId)
      : '',
    pieceIndent: multi,
    picked: picked
  };
}

function scopedNeedCode(parcels) {
  return parcels.pieces.some((piece) => piece.needCode);
}

// 订单级稳定字段（状态/锚/时间/动作等；不含件聚合）
function baseFieldsOf(item, identity, nowMs) {
  const status = textOf(item.status);
  const bucket = textOf(item.bucket) || orderView.bucketOf(status);
  const exception = item.exception || {};
  return {
    orderNo: textOf(item.orderNo),
    status: status,
    statusText: textOf(item.statusText) || orderState.statusText(status),
    bucket: bucket,
    anchorText: identity.anchor,
    keyText: identity.keyText,
    anchorKeyText: identity.anchorKeyText,
    senderText: identity.senderText,
    isGuest: textOf(item.source) === enums.ORDER_SOURCE.PARTNER,
    exceptionText: textOf(exception.text) || textOf(exception.codeText) || textOf(item.exceptionText),
    cancelReasonText: textOf(item.cancelReasonText) || textOf(item.cancelReason),
    deliveryNote: textOf(item.deliveryNote),
    actions: actionsOf(item),
    version: typeof item.version === 'number' ? item.version : 0,
    createdMs: dayView.createdMsOf(item),
    delayDaysText: dayView.delayDaysTextOf(item, nowMs),
    timeText: timeTextOf(item.statusUpdatedAt) || timeTextOf(item.updatedAt) || textOf(item.updatedAtText),
    selectable: filterView.canSelect({ orderNo: item.orderNo, bucket }),
    selected: false
  };
}

// 件聚合稳定字段（D61 取件进度 + D62 本站件/站点归属；行/件渲染只消费这些键）
function parcelFieldsToRow(parcels, scope) {
  return {
    tierText: parcelView.tierTextOf(parcelView.tierOfPieces(parcels.pieces)),
    routeTier: parcelView.tierOfPieces(parcels.pieces),
    routeNumber: parcelView.routeNumberOfPieces(parcels.pieces),
    codeText: parcels.pickupCode || (parcels.trackingTail ? '尾号' + parcels.trackingTail : '待补码'),
    lockerText: parcels.primary.lockerNo,
    pickupCode: parcels.pickupCode,
    trackingTail: parcels.trackingTail,
    needCode: scope ? scopedNeedCode(parcels) : parcelView.needCodeOf(parcels.item),
    reviewText: parcelView.reviewTextOf(scope ? parcels.pieces : parcels.allPieces)
      || (parcels.item.failureHint === true ? '已反馈开发者复核' : ''),
    stationId: scope && typeof scope.stationId === 'string' ? scope.stationId : parcels.primary.stationId,
    stationName: scope && typeof scope.stationName === 'string' ? scope.stationName : parcels.primary.stationName,
    parcelCount: parcels.allPieces.length,
    parcelCountText: parcelView.countTextOf(parcels.allPieces),
    pickedCount: parcels.picked.pickedCount,
    allPicked: parcels.picked.allPicked,
    pickedSummaryText: parcels.picked.pickedCountText,
    pieceIndent: parcels.pieceIndent,
    pieceRows: parcels.pieceRows,
    otherPiecesText: parcels.otherPiecesText,
    stationSummaryText: parcels.stationSummaryText,
    needCodeCountText: parcelView.needCodeCountTextOf(scope ? parcels.pieces : parcels.allPieces),
    manualEntry: parcels.manualEntry,
    manualEntryText: parcels.manualEntryText,
    parcelRows: parcels.parcelRows
  };
}

// 行字段表：页面/wxml 只消费这些稳定键（不直读服务端嵌套结构）。
// createdMs = 下单时刻（已完结区归档锚，D45）；delayDaysText = 「顺延 N 天」标签（未完成桶跨日才非空）
function rowFieldsOf(item, identity, parcels, nowMs, scope) {
  return Object.assign(baseFieldsOf(item, identity, nowMs), parcelFieldsToRow(parcels, scope));
}

// 单件单去重：件按钮等价于行工具（pick/undoPick）时不再重复渲染（多件单保留「整单 + 单件」两层语义）
function dedupeSinglePieceActions(row) {
  if (row.parcelCount !== 1) {
    return row;
  }
  const orderKeys = row.actions.map((action) => action.key);
  const pieces = row.pieceRows.map((piece) => {
    const equiv = piece.action ? ORDER_EQUIV[piece.action.key] : '';
    if (equiv && orderKeys.indexOf(equiv) >= 0) {
      return Object.assign({}, piece, { action: null });
    }
    return piece;
  });
  return Object.assign({}, row, { pieceRows: pieces });
}

// DTO 行（order/_dto.buildOrderDto）；scope = {stationId, stationName, readonly}（D62 站点组内行）
function toRow(order, nowMs, scope) {
  const item = order || {};
  const row = rowFieldsOf(item, identityOf(item), parcelFieldsOf(item, scope), nowMs, scope);
  // 行工具条也进行视图：服务端 actions 变化时随行级补丁一起更新（只消费 actions[]，不判状态）
  row.toolbar = rowActions.buildToolbar(row, { readonly: !!(scope && scope.readonly) });
  return dedupeSinglePieceActions(row);
}

module.exports = {
  toRow
};
