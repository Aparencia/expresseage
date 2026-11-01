// pages/partner/workbench/parts/summary-copy.js · D48/D54「复制汇总」文案纯件（顾客群口径；零 wx/零 I/O）
// 单源：工作台 pages/partner/workbench 与统计页 pkg-partner/pages/stats 共用（先例 pick-list → batch-view）。
// 口径：CONTRACT §13 D48 / UX_PARTNER §9 / DATA_MODEL §7.5：只消费服务端下发的 summary（按苑/栋聚合）。
//       批 20（D54）：「复制汇总」改「今日已送达」口径——服务端 order.listPartner({view:'day'}) 的 summary
//       （scope='deliveredToday'：deliveredAt 今日、状态 DELIVERED/COMPLETED、排除取消单）；
//       文案「【代取汇总】今日已送达 N 单（M 件）」+ 苑/栋分布 + 「已完成 X / 待确认 Y」。
//       旧 D48 口径（byStatus 进行中/已取件/已送达）原样保留向后兼容（老 summary 形状走旧分支）。
//       文案只到苑+楼栋级，不含房间号/roomTag/取件码/尾号/昵称/订单编号；空数据不产出可复制文案；
//       ≤200 字、超出按栋数省略。
// P1-6：summary.truncated（服务端扫描触达上限、聚合可能少报）→ 文案末尾追加如实说明，不静默少报；
//       truncated=服务端数据截断、textOmitted=文案按 200 字省略苑/栋，两个标记分开、语义不混。
'use strict';

const zones = require('../../../../shared/zones');

const COPY_TITLE = '【代取汇总】';
const TODAY_TITLE = COPY_TITLE + '今日已送达 ';
const MAX_TEXT_CHARS = 200;
const OMIT_MARK = '…等 ';
const SHORT_NOTE_HEAD = '（仅统计最近 ';
const SHORT_NOTE_TAIL = ' 单，可能少报）';
const DELIVERED_TODAY_SCOPE = 'deliveredToday';

function emptyCopy() {
  return {
    visible: false,
    text: '',
    copyText: '',
    total: 0,
    parcels: 0,
    dormCount: 0,
    truncated: false,
    textOmitted: false
  };
}

function countOf(value) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// 苑/栋白名单归一：非法苑代号、非法栋号、0/负单的行一律丢弃；同苑同栋多行合并（服务端已合并的端侧兜底）。
function normalizeDorm(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const map = {};
  list.forEach(function eachDorm(item) {
    if (!item || typeof item !== 'object') {
      return;
    }
    const zone = zones.normalizeZone(item.zone);
    const buildingNo = Number(item.buildingNo);
    const count = countOf(item.count);
    if (!zone || !zones.isBuildingNo(buildingNo) || count <= 0) {
      return;
    }
    const key = zone + '|' + buildingNo;
    if (map[key]) {
      map[key].count += count;
    } else {
      map[key] = { zone: zone, buildingNo: buildingNo, count: count };
    }
  });
  return Object.keys(map).map(function rowOf(key) {
    return map[key];
  }).sort(function compare(left, right) {
    const zoneDelta = zones.zoneRank(left.zone) - zones.zoneRank(right.zone);
    return zoneDelta !== 0 ? zoneDelta : left.buildingNo - right.buildingNo;
  });
}

// 旧 D48 口径（向后兼容）：byStatus 进行中/已取件/已送达 + 总单/总件
function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const total = countOf(raw.total);
  if (total <= 0) {
    return null;
  }
  const status = raw.byStatus && typeof raw.byStatus === 'object' ? raw.byStatus : {};
  return {
    total: total,
    parcels: countOf(raw.parcels),
    byStatus: {
      picked: countOf(status.picked),
      delivered: countOf(status.delivered),
      ongoing: countOf(status.ongoing)
    },
    byDorm: normalizeDorm(raw.byDorm),
    // 只有服务端明确给 boolean true 才算截断（契约字段，缺省/脏值一律按完整统计展示）
    truncated: raw.truncated === true
  };
}

// D54 新口径（今日已送达）：scope 标记 + total/parcels/completed/pending/byDorm
function isDeliveredToday(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && raw.scope === DELIVERED_TODAY_SCOPE;
}

function normalizeDeliveredToday(raw) {
  const total = countOf(raw.total);
  if (total <= 0) {
    return null;
  }
  return {
    total: total,
    parcels: countOf(raw.parcels),
    completed: countOf(raw.completed),
    pending: countOf(raw.pending),
    byDorm: normalizeDorm(raw.byDorm),
    truncated: raw.truncated === true
  };
}

// 苑/栋段落：苑固定序（normalizeDorm 已排序），同苑行用「·」、跨苑用「；」，只列前 limit 行。
function renderDormRows(byDorm, limit, labels) {
  let text = '';
  let currentZone = '';
  for (let i = 0; i < byDorm.length && i < limit; i += 1) {
    const row = byDorm[i];
    if (row.zone !== currentZone) {
      currentZone = row.zone;
      text += (text ? '；' : '') + zones.zoneLabel(row.zone, labels) + ' ';
    } else {
      text += ' · ';
    }
    text += row.buildingNo + '栋 ' + row.count + '单';
  }
  return text;
}

function progressTextOf(byStatus) {
  return '。进度：进行中 ' + byStatus.ongoing + ' / 已取件 ' + byStatus.picked
    + ' / 已送达 ' + byStatus.delivered + '。';
}

// D54 尾句：已完成 X / 待确认 Y（Y = 已送达待顾客确认）
function deliveredTodayTailOf(summary) {
  return '。已完成 ' + summary.completed + ' / 待确认 ' + summary.pending + '。';
}

// P1-6：扫描触顶时文案末尾如实说明「仅统计最近 N 单，可能少报」（N=本次实际聚合单数）。
function shortNoteOf(summary) {
  return summary.truncated ? SHORT_NOTE_HEAD + summary.total + SHORT_NOTE_TAIL : '';
}

// 先给完整文案；超上限时从尾部逐栋减少并补「…等 N 栋」，尾句与总单/总件始终保留。
// P1-6 的少报说明与尾句一起计入 200 字上限（省略更多栋，不丢如实说明）。
function assembleText(summary, head, tail, options) {
  const opts = options || {};
  const labels = opts.zoneLabels && typeof opts.zoneLabels === 'object' ? opts.zoneLabels : null;
  const configured = Number(opts.maxChars);
  const maxChars = isFinite(configured) && configured > 0 ? Math.floor(configured) : MAX_TEXT_CHARS;
  const note = shortNoteOf(summary);
  for (let count = summary.byDorm.length; count >= 0; count -= 1) {
    const omitted = summary.byDorm.length - count;
    const body = count > 0 ? '；' + renderDormRows(summary.byDorm, count, labels) : '';
    const marker = omitted > 0 ? OMIT_MARK + omitted + ' 栋' : '';
    const text = head + body + marker + tail + note;
    if (text.length <= maxChars) {
      return { text: text, omitted: omitted > 0 };
    }
  }
  return { text: head + tail + note, omitted: summary.byDorm.length > 0 };
}

function summaryTextOf(summary, options) {
  const head = COPY_TITLE + '当前 ' + summary.total + ' 单（' + summary.parcels + ' 件）';
  return assembleText(summary, head, progressTextOf(summary.byStatus), options);
}

// D54 文案：「【代取汇总】今日已送达 N 单（M 件）」+ 苑/栋 + 「已完成 X / 待确认 Y」
function deliveredTodayTextOf(summary, options) {
  const head = TODAY_TITLE + summary.total + ' 单（' + summary.parcels + ' 件）';
  return assembleText(summary, head, deliveredTodayTailOf(summary), options);
}

function copyViewOf(summary, built) {
  return {
    visible: true,
    text: built.text,
    copyText: built.text,
    total: summary.total,
    parcels: summary.parcels,
    dormCount: summary.byDorm.length,
    truncated: summary.truncated,
    textOmitted: built.omitted
  };
}

/**
 * 复制汇总视图：raw = 服务端下发的 summary。
 *   - D54 今日已送达口径（scope='deliveredToday'，order.listPartner({view:'day'}).summary）→ 新文案；
 *   - 旧 D48 口径（byStatus 形状）→ 原文案不变（向后兼容，统计页旧 fixture/历史响应）。
 * total=0/缺字段/非对象 → visible=false（页面据此不复制假文案）。
 * truncated=服务端统计可能少报（页面 toast 如实提示）；textOmitted=文案按 200 字省略了苑/栋。
 */
function copyOf(raw, options) {
  if (isDeliveredToday(raw)) {
    const today = normalizeDeliveredToday(raw);
    return today ? copyViewOf(today, deliveredTodayTextOf(today, options)) : emptyCopy();
  }
  const summary = normalizeSummary(raw);
  if (!summary) {
    return emptyCopy();
  }
  return copyViewOf(summary, summaryTextOf(summary, options));
}

module.exports = { copyOf };
