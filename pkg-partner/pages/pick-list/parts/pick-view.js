// pkg-partner/pages/pick-list/parts/pick-view.js · 「待取件」阶段纯件（站点分组/行/复制文案/汇总；零 wx）
// 口径：CONTRACT §13-D46 修订（批 20：取件清单双阶段）、UX_PARTNER §3.11；数据源 order.listPartner
//       工作台视图 + 已接单状态（现成动作、零服务端改动）；按取件站点 P1~P8 分组（站点表唯一源 shared/stations），
//       组内四档动线排序（需查明 → 快递柜 → 分段码 → 其他，复用工作台 parcel-view 纯件）；
//       分页/分片 ≤20 行；复制文案含站点/取件码/运单尾号/柜号/宿舍锚（兼职本人核对用），
//       不含顾客称呼、订单号、顾客编号、手机尾号、头像等其余 L3。
// 纪律：本文件零 wx、零七状态字面量（状态只经 shared/enums 取值）；页面只消费这里产出的稳定字段。
'use strict';

const enums = require('../../../../shared/enums');
const stations = require('../../../../shared/stations');
const roomTag = require('../../../../utils/room-tag');
const parcelView = require('../../../../pages/partner/workbench/parts/parcel-view');

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

// 单件视图：取件码/运单尾号 + 柜号；需查明件给「需查明」占位（不显示假码）；跨站点件带站点前缀
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
    cross: cross,
    stationId: stationId,
    stationName: stationName,
    needCode: item.needCode === true,
    text: text,
    copyText: cross && prefix ? prefix + ' ' + text : text
  };
}

// 单行（一单）：宿舍锚 + 每件（码/尾号 · 柜号）；跨站点件在件行内带站点，不缺落点
function rowOf(order, stationId, stationTitle) {
  const pieces = parcelView.piecesOf(order).map((piece) => pieceViewOf(piece, stationId));
  const parcelCount = pieces.length;
  return {
    key: textOf(order.orderNo),
    orderNo: textOf(order.orderNo),
    stationId: stationId,
    stationTitle: stationTitle,
    anchorText: anchorTextOf(order),
    parcelCount: parcelCount,
    parcelCountText: parcelCount > 1 ? '共 ' + parcelCount + ' 件' : '1 件',
    needCode: pieces.some((piece) => piece.needCode),
    pieces: pieces,
    tier: parcelView.tierOf(order),
    routeNumber: parcelView.routeNumberOf(order)
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

// 组内序：四档动线（需查明→快递柜→分段码→其他）→ 码内数字升序 → 订单号稳定序
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

// 订单列表 → 站点分组（首件站点定组，跨站点单只归一组、件行内带站点；D46 同工作台口径）
function buildGroups(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const map = {};
  const keys = [];
  list.forEach((order) => {
    if (!order || !textOf(order.orderNo)) {
      return;
    }
    const stationId = parcelView.stationKeyOf(order);
    const key = stationId || UNKNOWN_GROUP_KEY;
    if (!map[key]) {
      map[key] = { stationId: stationId, stationName: '', orders: [] };
      keys.push(key);
    }
    if (!map[key].stationName) {
      map[key].stationName = parcelView.primaryStationNameOf(order);
    }
    map[key].orders.push(order);
  });
  return keys
    .map((key) => groupOf(key, map[key]))
    .sort(compareGroups);
}

function groupOf(key, bucket) {
  const title = stationTitleOf(bucket.stationId, bucket.stationName);
  const rows = bucket.orders
    .map((order) => rowOf(order, bucket.stationId, title))
    .sort(compareRows);
  let pieceCount = 0;
  rows.forEach((row) => {
    pieceCount += row.parcelCount;
  });
  return {
    key: key,
    stationId: bucket.stationId,
    stationName: bucket.stationName,
    unknown: key === UNKNOWN_GROUP_KEY,
    rank: stationRankOf(bucket.stationId),
    title: title,
    count: rows.length,
    pieceCount: pieceCount,
    rows: rows
  };
}

// 汇总：总单数 + 总件数 + 覆盖站数（文案在纯件，页面不拼业务判据）
function summaryOf(groups) {
  const list = Array.isArray(groups) ? groups : [];
  let total = 0;
  let pieceTotal = 0;
  const stationKeys = {};
  list.forEach((group) => {
    total += Number(group && group.count) || 0;
    pieceTotal += Number(group && group.pieceCount) || 0;
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

// 行文案（组/全部复制共用一行式）：宿舍锚 + 每件（码/尾号 · 柜号，跨站件带站点）
function rowLineOf(row) {
  const anchor = row.anchorText || '宿舍待同步';
  return anchor + ' ' + row.pieces.map((piece) => piece.copyText).join(' / ');
}

// 单行复制（这一单）：站点 · 宿舍锚 + 每件一行（跨站件行首带站点）
function rowCopyText(row) {
  if (!row || !Array.isArray(row.pieces) || !row.pieces.length) {
    return '';
  }
  const head = (row.stationTitle || '站点待同步') + ' · ' + (row.anchorText || '宿舍待同步')
    + (row.parcelCount > 1 ? '（' + row.parcelCount + ' 件）' : '');
  const lines = [head];
  row.pieces.forEach((piece) => lines.push(piece.copyText));
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
  copyPlanOf: copyPlanOf
};
