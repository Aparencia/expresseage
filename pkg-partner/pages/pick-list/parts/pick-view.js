// pkg-partner/pages/pick-list/parts/pick-view.js · 「待取件」阶段纯件（站点分组/行/复制文案/汇总；零 wx）
// 口径：CONTRACT §5/§5.1（D61 件级取件）、UX_PARTNER §3.11/§4.3（D62：按**件的站点**分组——一单在每个
//       件站点组各出现一次、行内只列本站件 + 「另 N 件在 Pn」、组内四档按本站件算；待取件阶段每件独立
//       「已取件/撤销已取」并显示已取状态；已全取的订单因服务端状态变 PICKED 自动离开本阶段）。
//       复制文案只含本站件（站点/码/尾号/柜号/宿舍锚），不含称呼/订单号/顾客编号/手机尾号。
// 纪律：本文件零 wx、零七状态字面量（状态只经 shared/enums 取值）；动作只消费服务端 parcel.actions。
'use strict';

const enums = require('../../../../shared/enums');
const stations = require('../../../../shared/stations');
const roomTag = require('../../../../utils/room-tag');
const parcelView = require('../../../../pages/partner/workbench/parts/parcel-view');
const pieceActions = require('../../../../pages/partner/workbench/parts/piece-actions');

const TAB_PICK = 'pickup';
const TAB_DELIVER = 'deliver';
const TAB_LABELS = { pickup: '待取件', deliver: '待送达' };
const PAGE_LIMIT = 20; // 服务端分页：每片 ≤20 行（D46 同口径）
const MAX_AUTO_PAGES = 10; // 复制全部自动拉全上限：10 页 × 20 行 ⇒ ≤200 单（防一次点按无限拉取）
const EMPTY_TEXT = '当前没有待取件的单。接单后会出现在这里，下拉或切回本页刷新。';
const COPY_TITLE = '【取件清单】';
const COPY_ALL_TITLE = '【取件清单·待取件】';
const UNKNOWN_GROUP_KEY = '__NONE__';
const UNKNOWN_GROUP_TITLE = '站点待同步';
const UNKNOWN_STATION_RANK = 999;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function tabOf(value) {
  return value === TAB_PICK || value === TAB_DELIVER ? value : '';
}

function tabTextOf(label, count) {
  const total = typeof count === 'number' && count >= 0 ? count : -1;
  return total < 0 ? label : label + ' ' + total;
}

// 页头两 chip 文案：counts 由 order.listPartner（workbench 视图）同响应给出；未加载时只显示阶段名
function tabTextsOf(data) {
  const counts = data && data.counts && typeof data.counts === 'object' ? data.counts : {};
  return {
    pick: tabTextOf(TAB_LABELS.pickup, counts.accepted),
    deliver: tabTextOf(TAB_LABELS.deliver, counts.picked)
  };
}

// 数据源 payload（现成动作、无服务端改动）：workbench 视图 + 已接单状态 + ≤20 行/页
function queryOf(options) {
  const opts = options || {};
  const payload = { view: 'workbench', status: enums.ORDER_STATUS.ACCEPTED, limit: PAGE_LIMIT };
  if (opts.cursor) {
    payload.cursor = opts.cursor;
  }
  return payload;
}

// 宿舍锚（D46 只到 dormKey+roomTag 级）：配送地址优先（D25 他人地址亦只显示锚）；
// roomTag 仅当本单配送地址=顾客本人宿舍时才拼上，避免跨宿舍误导（与工作台锚同口径）
function anchorTextOf(order) {
  const dorm = order && order.dorm && typeof order.dorm === 'object' ? order.dorm : {};
  const delivery = order && order.delivery && typeof order.delivery === 'object' ? order.delivery : {};
  const guest = order && order.guest && typeof order.guest === 'object' ? order.guest : {};
  const dormKey = textOf(delivery.dormKey) || textOf(dorm.dormKey) || textOf(guest.dormKey);
  if (!dormKey) {
    return '';
  }
  const ownDormKey = textOf(dorm.dormKey);
  const tag = ownDormKey && ownDormKey === dormKey ? textOf(dorm.roomTag) : '';
  return roomTag.formatDormTag(dormKey, tag) || dormKey;
}

// 单件视图（D61）：码/尾号 + 柜号 + 需查明占位 + 已取状态 + 件动作（只消费服务端 parcel.actions）
function pieceViewOf(piece, groupStationId) {
  const item = piece || {};
  const stationId = textOf(item.stationId);
  const stationName = textOf(item.stationName);
  const cross = !!stationId && stationId !== textOf(groupStationId);
  const codeText = item.needCode === true ? '需查明' : (textOf(item.codeText) || '待补码');
  const text = textOf(item.lockerText) ? codeText + ' · ' + item.lockerText : codeText;
  const prefix = [stationId, stationName].filter(Boolean).join(' ');
  return {
    key: String(typeof item.index === 'number' ? item.index : 0) + '#' + stationId,
    index: typeof item.index === 'number' ? item.index : 0,
    indexText: textOf(item.indexText) || '第 1 件',
    cross: cross,
    showStation: cross,
    stationId: stationId,
    stationName: stationName,
    needCode: item.needCode === true,
    lockerNo: textOf(item.lockerNo),
    pickupCode: textOf(item.pickupCode),
    codeStatus: textOf(item.codeStatus),
    picked: item.picked === true,
    pickedText: item.picked === true ? '已取' : '待取',
    pickedAtText: textOf(item.pickedAtText),
    codeText: codeText,
    text: text,
    copyText: cross && prefix ? prefix + ' ' + text : text,
    action: pieceActions.viewOf(item, false)
  };
}

// 单行（一单）：宿舍锚 + 本站件（码/尾号 · 柜号）+ 已取进度 + 「另 N 件在 Pn」
function rowOf(order, station) {
  const stationId = textOf(station.stationId);
  const rawPieces = parcelView.piecesForStationOf(order, stationId);
  const pieces = rawPieces.map((piece) => pieceViewOf(piece, stationId));
  const parcelCount = pieces.length;
  const picked = parcelView.pickedFieldsOf(order);
  return {
    key: textOf(order.orderNo),
    orderNo: textOf(order.orderNo),
    stationId: stationId,
    stationTitle: textOf(station.title),
    anchorText: anchorTextOf(order),
    parcelCount: parcelCount,
    parcelCountText: parcelCount > 1 ? '共 ' + parcelCount + ' 件' : '1 件',
    needCode: pieces.some((piece) => piece.needCode),
    pickedCountText: picked.pickedCountText,
    otherPiecesText: parcelView.otherPiecesTextOf(order, stationId),
    pieces: pieces,
    tier: parcelView.tierOfPieces(rawPieces),
    routeNumber: parcelView.routeNumberOfPieces(rawPieces)
  };
}

// 站点标题：站点表名称（配置改名以订单快照 stationName 优先）；未识别站点归兜底组
function stationTitleOf(stationId, stationName) {
  const id = textOf(stationId);
  const name = textOf(stationName) || stations.stationNameOf(id);
  if (!id) {
    return name || UNKNOWN_GROUP_TITLE;
  }
  return name ? id + ' ' + name : id;
}

function stationRankOf(stationId) {
  const id = textOf(stationId);
  if (!id) {
    return UNKNOWN_STATION_RANK;
  }
  const list = stations.listStations();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === id) {
      return index;
    }
  }
  return UNKNOWN_STATION_RANK;
}

// 组内序：四档动线（需查明→快递柜→分段码→其他）→ 码内数字升序 → 订单号稳定序（D62 按本站件算）
function compareRows(left, right) {
  if (left.tier !== right.tier) {
    return left.tier - right.tier;
  }
  if (left.routeNumber !== right.routeNumber) {
    return left.routeNumber - right.routeNumber;
  }
  if (left.orderNo === right.orderNo) {
    return 0;
  }
  return left.orderNo < right.orderNo ? -1 : 1;
}

// 组序：站点表 P1~P8 固定序 → 未识别站点兜底组排最后
function compareGroups(left, right) {
  if (left.unknown !== right.unknown) {
    return left.unknown ? 1 : -1;
  }
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }
  return left.key < right.key ? -1 : 1;
}

// 订单列表 → 件站点分组（D62）：一单在每个件站点组各出现一次，行内只列本站件
function buildGroups(orders) {
  const list = listOf(orders);
  const map = {};
  const keys = [];
  list.forEach((order) => {
    if (!order || !textOf(order.orderNo)) {
      return;
    }
    parcelView.stationGroupsOf(order).forEach((station) => {
      const key = station.stationId || UNKNOWN_GROUP_KEY;
      if (!map[key]) {
        map[key] = { stationId: station.stationId, stationName: '', orders: [] };
        keys.push(key);
      }
      if (!map[key].stationName) {
        map[key].stationName = station.stationName;
      }
      map[key].orders.push(order);
    });
  });
  return keys
    .map((key) => groupOf(key, map[key]))
    .sort(compareGroups);
}

function groupOf(key, bucket) {
  const title = stationTitleOf(bucket.stationId, bucket.stationName);
  const station = { stationId: bucket.stationId, title: title };
  const rows = bucket.orders
    .map((order) => rowOf(order, station))
    .sort(compareRows);
  let pieceCount = 0;
  rows.forEach((row) => {
    pieceCount += row.parcelCount;
  });
  const count = rows.length;
  return {
    key: key,
    stationId: bucket.stationId,
    stationName: bucket.stationName,
    unknown: key === UNKNOWN_GROUP_KEY,
    rank: stationRankOf(bucket.stationId),
    title: title,
    count: count,
    pieceCount: pieceCount,
    countText: count + ' 单' + (pieceCount !== count ? ' · ' + pieceCount + ' 件' : ''),
    rows: rows
  };
}

// 汇总：按订单去重（D62 跨站单在多组出现，不能重复计单）；件数按每件只落一组累加
function summaryOf(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const orderSeen = {};
  let total = 0;
  let pieceTotal = 0;
  const stationKeys = {};
  list.forEach((group) => {
    pieceTotal += Number(group && group.pieceCount) || 0;
    (group && group.rows ? group.rows : []).forEach((row) => {
      if (row.orderNo && !orderSeen[row.orderNo]) {
        orderSeen[row.orderNo] = true;
        total += 1;
      }
    });
    if (group && !group.unknown && group.count) {
      stationKeys[group.key] = true;
    }
  });
  const stationCount = Object.keys(stationKeys).length;
  return {
    total: total,
    pieceTotal: pieceTotal,
    stationCount: stationCount,
    text: total ? '共 ' + total + ' 单 ' + pieceTotal + ' 件待取件 · 覆盖 ' + stationCount + ' 站' : '暂无待取件的单'
  };
}

// 页头汇总文案：还有下一页时明确「已加载 N 单」，避免把已加载页当成全量清单
function summaryLineOf(summary, nextCursor) {
  const base = summary || {};
  const total = Math.max(0, Number(base.total) || 0);
  const hasMore = !!nextCursor && total > 0;
  return {
    total: total,
    pieceTotal: Math.max(0, Number(base.pieceTotal) || 0),
    stationCount: Math.max(0, Number(base.stationCount) || 0),
    text: textOf(base.text),
    loadedText: hasMore ? '已加载 ' + total + ' 单（还有更多，上拉或点「复制全部」自动拉全）' : ''
  };
}

// 行文案（组/全部复制共用一行式）：宿舍锚 + 本站件（码/尾号 · 柜号；已取件标注）
function rowLineOf(row) {
  const anchor = row.anchorText || '宿舍待同步';
  const pieces = (Array.isArray(row.pieces) ? row.pieces : []).map((piece) => (
    row.pickedCountText && piece.picked ? piece.copyText + '（已取）' : piece.copyText
  ));
  return anchor + ' ' + pieces.join(' / ');
}

// 单行复制（这一单）：站点 · 宿舍锚 + 本站件一行
function rowCopyText(row) {
  if (!row || !Array.isArray(row.pieces) || !row.pieces.length) {
    return '';
  }
  const head = (row.stationTitle || '站点待同步') + ' · ' + (row.anchorText || '宿舍待同步')
    + (row.parcelCount > 1 ? '（' + row.parcelCount + ' 件）' : '');
  const lines = [head];
  row.pieces.forEach((piece) => lines.push(piece.picked ? piece.copyText + '（已取）' : piece.copyText));
  return lines.join('\n');
}

// 整组复制（一个站点）：组头（站点 + 单/件数）+ 逐单一行
function groupCopyText(group) {
  if (!group || !Array.isArray(group.rows) || !group.rows.length) {
    return '';
  }
  const lines = [COPY_TITLE + ' ' + group.title + ' · 共 ' + group.count + ' 单 ' + group.pieceCount + ' 件'];
  group.rows.forEach((row) => lines.push(rowLineOf(row)));
  return lines.join('\n');
}

// 全部复制：总单/总件/站数 + 逐站分段（站点名一行、订单行若干）
function allCopyText(groups) {
  const list = (Array.isArray(groups) ? groups : []).filter((group) => group && (group.rows || []).length);
  if (!list.length) {
    return '';
  }
  const summary = summaryOf(list);
  const lines = [COPY_ALL_TITLE + ' 共 ' + summary.total + ' 单 ' + summary.pieceTotal + ' 件 · ' + summary.stationCount + ' 站'];
  list.forEach((group) => {
    lines.push(group.title);
    group.rows.forEach((row) => lines.push(rowLineOf(row)));
  });
  return lines.join('\n');
}

// 复制全部计划：未加载完 → needMore（页面先循环拉全，绝不复制半量）；到页数上限 → 提示先上拉；
// 空清单不给文案（页面 toast 兜底）
function copyPlanOf(groups, nextCursor, pagesLoaded) {
  const pages = Math.max(0, Number(pagesLoaded) || 0);
  if (nextCursor) {
    const capped = pages >= MAX_AUTO_PAGES;
    return {
      ok: false,
      needMore: true,
      capped: capped,
      text: '',
      message: capped
        ? '清单超过 ' + (MAX_AUTO_PAGES * PAGE_LIMIT) + ' 单，先上拉加载更多再复制'
        : '清单还没加载全，正在拉取剩余的…'
    };
  }
  const text = allCopyText(groups);
  if (!text) {
    return { ok: false, needMore: false, capped: false, text: '', message: '当前没有可复制的清单' };
  }
  return { ok: true, needMore: false, capped: false, text: text, message: '' };
}

// 件动作定位（D61）：返回所属站点组/行/件视图（写请求只需 orderNo/itemIndex/version）
function findPiece(groups, orderNo, itemIndex) {
  const list = Array.isArray(groups) ? groups : [];
  for (let g = 0; g < list.length; g += 1) {
    const rows = list[g].rows || [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      if (row.orderNo !== orderNo) {
        continue;
      }
      const piece = (row.pieces || []).filter((item) => item.index === itemIndex)[0];
      if (piece) {
        return { group: list[g], row: row, piece: piece };
      }
    }
  }
  return null;
}

module.exports = {
  TAB_PICK: TAB_PICK,
  TAB_DELIVER: TAB_DELIVER,
  MAX_AUTO_PAGES: MAX_AUTO_PAGES,
  EMPTY_TEXT: EMPTY_TEXT,
  tabOf: tabOf,
  tabTextsOf: tabTextsOf,
  queryOf: queryOf,
  buildGroups: buildGroups,
  summaryOf: summaryOf,
  summaryLineOf: summaryLineOf,
  rowCopyText: rowCopyText,
  groupCopyText: groupCopyText,
  allCopyText: allCopyText,
  copyPlanOf: copyPlanOf,
  findPiece: findPiece
};
