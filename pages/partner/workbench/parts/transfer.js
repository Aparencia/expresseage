// pages/partner/workbench/parts/transfer.js · 工作台「待接收转派」纯件（D58）
// 口径：CONTRACT §13 D58 / UX_PARTNER §3.3§4.12；草案 §1.4（目标兼职待接收视图：服务端 view='transfer'
//       已过滤 PENDING+ACCEPTED，客户端零过滤、零自算件数——N 取 order.listPartner 顶层 transferPending）；
//       剩余时间/行文案/排序全部在本零件算（页面只渲染），页面层零状态字面量、零 wx、零编号生成。
// 边界：只读展示，不发起/确认/拒收转派（这些在订单详情页，凭 DTO actions[] 与纯件决定可见性）。
'use strict';

const PAGE_LIMIT = 30; // 与服务端默认 limit 同量级：顶部区块一次拉够
const MINUTE_MS = 60 * 1000;
const TITLE = '待接收转派';
const COPY = {
  loading: '正在加载待接收转派…',
  loadFail: '待接收转派没加载出来，点刷新重试',
  moreTail: ' 条，下拉刷新后再看',
  moreHead: '还有 ',
  fromHead: '来自 ',
  fromTail: ' 的转派邀请',
  expired: '邀请已过期',
  minuteHead: '剩余 ',
  minuteTail: ' 分钟',
  pieceTail: ' 件',
  roomTagHead: '房标 '
};

// 非负整数归一（服务端缺字段/脏值不编造数字）
function integerOf(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

// 待接收件数：唯一来源 = order.listPartner 顶层 transferPending（服务端下发，客户端不自行数行）。
// 返回 null = 本次响应没有该字段（未知，不是 0）；页面据此用待接收列表响应的服务端计数兜底，
// 仍不按 list 行数自行计数（跨域契约若有先后，入口不会被静默判成 0）。
function pendingOf(response) {
  const raw = response && response.transferPending;
  if (typeof raw !== 'number' || !isFinite(raw)) {
    return null;
  }
  return integerOf(raw);
}

// 待接收行查询：只读、服务端过滤（游标/limit 形制与工作台其它 view 一致）
function query() {
  return { view: 'transfer', limit: PAGE_LIMIT };
}

// 毫秒归一：服务端 DTO 的 transfer 时间字段是 ISO 字符串（_dto.isoOf），兼容毫秒数字
function msOf(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string' || !value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return isFinite(parsed) ? parsed : 0;
}

// 「剩余 N 分钟」：过期不给负数（服务端应已惰性落 EXPIRED；此分支只是展示兜底）
function minuteTextOf(expiresAt, nowMs) {
  const expires = msOf(expiresAt);
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  if (!expires) {
    return '';
  }
  const leftMs = expires - now;
  if (leftMs <= 0) {
    return COPY.expired;
  }
  return COPY.minuteHead + Math.max(1, Math.ceil(leftMs / MINUTE_MS)) + COPY.minuteTail;
}

// 发起方编号快照（目标兼职视图可见 transfer.fromPartnerNo；不出现 openid/内部 id）
function fromTextOf(transfer) {
  const fromPartnerNo = (transfer && transfer.fromPartnerNo) || '';
  return fromPartnerNo ? COPY.fromHead + fromPartnerNo + COPY.fromTail : '';
}

// 行元信息：件数（履约必需）+ 房标（目标兼职视图可见 dorm.roomTag），缺字段不拼残句
function metaTextOf(order) {
  const item = order || {};
  const parts = [];
  const parcelCount = item.parcelCount;
  if (typeof parcelCount === 'number' && parcelCount > 0) {
    parts.push(parcelCount + COPY.pieceTail);
  }
  const roomTag = item.dorm && item.dorm.roomTag;
  if (typeof roomTag === 'string' && roomTag) {
    parts.push(COPY.roomTagHead + roomTag);
  }
  return parts.join(' · ');
}

function rowOf(order, nowMs) {
  const item = order || {};
  const transfer = item.transfer || null;
  return {
    orderNo: item.orderNo || '',
    fromText: fromTextOf(transfer),
    remainingText: minuteTextOf(transfer && transfer.expiresAt, nowMs),
    metaText: metaTextOf(item),
    expiresMs: msOf(transfer && transfer.expiresAt)
  };
}

// 行排序：最早过期在前（同一时刻按订单号稳定排序，不依赖服务端顺序）
function rowsOf(list, nowMs) {
  const rows = (Array.isArray(list) ? list : [])
    .filter((order) => order && order.orderNo && order.transfer)
    .map((order) => rowOf(order, nowMs));
  rows.sort((left, right) => (left.expiresMs !== right.expiresMs
    ? (left.expiresMs || Infinity) - (right.expiresMs || Infinity)
    : String(left.orderNo).localeCompare(String(right.orderNo))));
  return rows;
}

// 区块状态：count 恒为服务端下发值（不因 rows 少而改）；rows 只作展示，加载中/失败都给可续的下一步
function stateOf(pending, rows, options) {
  const opts = options || {};
  const count = integerOf(pending);
  const list = Array.isArray(rows) ? rows : [];
  const visible = count > 0;
  const loading = visible && list.length === 0 && opts.loading === true;
  let hintText = '';
  if (visible && opts.loadFail === true) {
    hintText = COPY.loadFail;
  } else if (loading) {
    hintText = COPY.loading;
  }
  const moreCount = Math.max(0, count - list.length);
  return {
    visible: visible,
    count: count,
    title: visible ? TITLE + '（' + count + '）' : '',
    rows: visible ? list : [],
    loading: loading,
    hintText: hintText,
    moreText: moreCount > 0 && !loading && opts.loadFail !== true
      ? COPY.moreHead + moreCount + COPY.moreTail
      : ''
  };
}

function closedState() {
  return stateOf(0, [], {});
}

module.exports = {
  PAGE_LIMIT,
  pendingOf,
  query,
  minuteTextOf,
  rowsOf,
  stateOf,
  closedState
};
