// utils/customer-view.js · 顾客档案视图模型（纯件零 wx、零请求、零全局状态）
// 口径：docs/V4_UX_PARTNER.md §3.5（客户列表行/搜索/分页/空态）、§3.6（详情身份行）
//      docs/V4_DATA_MODEL.md §7.4（listBindings 行 DTO：服务端已排序+过滤+分页，客户端不二次排序）
// 数据来源：partner.listBindings 的 list 项（仅 ACTIVE 绑定返回头像/昵称；解绑后 DTO 不再返回）
'use strict';

const roomTag = require('./room-tag');

const PHONE_TAIL_LENGTH = 4;
const KEYWORD_MAX = 30;
const PAGE_LIMIT = 20;
const MINUTE_MS = 60 * 1000;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function pad2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return number < 10 ? '0' + number : String(number);
}

function tailText(value) {
  const tail = textOf(value);
  return tail.length === PHONE_TAIL_LENGTH ? '尾号' + tail : '';
}

function toMs(value) {
  if (typeof value === 'number') {
    return value > 0 ? value : 0;
  }
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

// 日期要按服务端时区口径展示，端侧只做本机时区格式化（serverTime 已在 store 校时）
function dateOf(value) {
  const ms = toMs(value);
  return ms ? new Date(ms) : null;
}

function timeText(value) {
  const date = dateOf(value);
  if (!date) {
    return '';
  }
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function shortDateText(value) {
  const date = dateOf(value);
  if (!date) {
    return '';
  }
  return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function timeHM(value) {
  const date = dateOf(value);
  if (!date) {
    return '';
  }
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function formatDorm(dormKey, tag) {
  const key = textOf(dormKey);
  const suffix = textOf(tag).toUpperCase();
  if (!key) {
    return suffix;
  }
  if (!suffix) {
    return key;
  }
  return typeof roomTag.formatDormTag === 'function' ? roomTag.formatDormTag(key, suffix) : key + suffix;
}

// roomTag 恒大写展示（D7；服务端分配即大写，端侧防御旧小写数据）
function roomTagText(value) {
  const tag = textOf(value).toUpperCase();
  return roomTag.isValidTag(tag) ? tag : '';
}

function normalizeKeyword(value) {
  return textOf(value).slice(0, KEYWORD_MAX);
}

function buildKeyText(customer) {
  const parts = [];
  const tail = tailText(customer.phoneTail);
  const name = textOf(customer.displayName);
  if (tail) {
    parts.push(tail);
  }
  if (name) {
    parts.push(name);
  }
  return parts.join(' · ');
}

// listBindings 行 → 页面行视图（不显示 openid、不拼完整手机号、不本地排序）
function buildListRow(item) {
  const customer = item || {};
  const anchorText = formatDorm(customer.dormKey, customer.roomTag);
  const keyText = buildKeyText(customer);
  const parts = [];
  if (anchorText) {
    parts.push(anchorText);
  }
  if (keyText) {
    parts.push(keyText);
  }
  const activeCount = typeof customer.activeOrderCount === 'number' && customer.activeOrderCount > 0
    ? customer.activeOrderCount
    : 0;
  return {
    bindingId: textOf(customer.bindingId),
    customerNo: textOf(customer.customerNo),
    avatarFileId: textOf(customer.avatarFileId),
    displayName: textOf(customer.displayName),
    displayNameText: textOf(customer.displayName) || '未填称呼',
    phoneTailText: tailText(customer.phoneTail),
    dormKey: textOf(customer.dormKey),
    roomTagText: roomTagText(customer.roomTag),
    buildingText: textOf(customer.buildingText),
    anchorText: anchorText,
    keyText: keyText,
    anchorKeyText: parts.join(' · '),
    partnerNote: textOf(customer.partnerNote),
    activeOrderCount: activeCount,
    activeOrderCountText: activeCount > 0 ? '进行中 ' + activeCount + ' 单' : '',
    boundAtText: shortDateText(customer.boundAt)
  };
}

function buildListRows(list) {
  return listOf(list).map(buildListRow).filter((row) => row.bindingId !== '');
}

// 分页合并/去重（服务端已排序；这里只防同一行重复渲染，不改顺序）
function dedupeRows(rows) {
  const seen = {};
  const out = [];
  listOf(rows).forEach((row) => {
    const id = row && row.bindingId;
    if (!id || seen[id]) {
      return;
    }
    seen[id] = true;
    out.push(row);
  });
  return out;
}

function appendRows(existing, incoming) {
  return dedupeRows(listOf(existing).concat(listOf(incoming)));
}

function newRowsOf(previous, next) {
  const seen = {};
  listOf(previous).forEach((row) => {
    if (row && row.bindingId) {
      seen[row.bindingId] = true;
    }
  });
  return listOf(next).filter((row) => row && row.bindingId && !seen[row.bindingId]);
}

// 顾客新绑定后顶部提示（顾客发起；兼职端无任何绑定入口）
function buildBannerText(newRows) {
  const anchors = listOf(newRows)
    .map((row) => row && (row.anchorText || row.displayNameText))
    .filter((text) => !!text);
  if (!anchors.length) {
    return '';
  }
  return '新顾客 ' + anchors.join('、') + ' 已绑定（顾客发起）';
}

function staleTextOf(lastSuccessAt) {
  const hm = timeHM(lastSuccessAt);
  return hm ? '没连上服务器，显示的是 ' + hm + ' 的数据。' : '没连上服务器，请检查网络后重试。';
}

function emptyTextOf(keyword) {
  if (textOf(keyword)) {
    return '这个搜索下没有顾客';
  }
  return '还没有顾客绑定你。绑定只能由顾客发起：把绑定卡片（兼职编号）发给顾客，让顾客自己发起绑定。';
}

// 列表页状态机：骨架 / 错误 / 空态 / 列表（错误时保留旧数据 + 上次成功时间）
function listStateOf(input) {
  const state = input || {};
  const rows = listOf(state.rows);
  const hasRows = rows.length > 0;
  const loading = state.loading === true;
  let mode = 'list';
  if (loading && !hasRows) {
    mode = 'skeleton';
  } else if (!hasRows && state.error) {
    mode = 'error';
  } else if (!hasRows) {
    mode = 'empty';
  }
  const nextCursor = textOf(state.nextCursor);
  return {
    mode: mode,
    showRows: mode === 'list',
    showSkeleton: mode === 'skeleton',
    showError: mode === 'error',
    showEmpty: mode === 'empty',
    skeletonRows: [1, 2, 3],
    emptyText: emptyTextOf(state.keyword),
    emptyActionText: textOf(state.keyword) ? '清空搜索' : '分享绑定卡片',
    errorText: mode === 'error' ? (textOf(state.error) || '客户没加载出来，检查网络后重试') : '',
    staleText: mode === 'list' && state.error ? staleTextOf(state.lastSuccessAt) : '',
    lastSuccessText: state.lastSuccessAt ? '更新于 ' + timeHM(state.lastSuccessAt) : '',
    footerText: loading && hasRows ? '正在加载…' : (nextCursor ? '上滑加载更多' : (showRowsTail(state) ? '没有更多了' : '')),
    hasMore: nextCursor !== ''
  };
}

function showRowsTail(state) {
  return state && state.loading !== true && listOf(state.rows).length > 0;
}

module.exports = {
  PHONE_TAIL_LENGTH,
  KEYWORD_MAX,
  PAGE_LIMIT,
  buildBannerText,
  buildListRow,
  buildListRows,
  appendRows,
  dedupeRows,
  emptyTextOf,
  formatDorm,
  listStateOf,
  newRowsOf,
  normalizeKeyword,
  roomTagText,
  shortDateText,
  staleTextOf,
  tailText,
  timeHM,
  timeText,
  toMs
};
