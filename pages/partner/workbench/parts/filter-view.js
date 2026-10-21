// pages/partner/workbench/parts/filter-view.js · 工作台筛选/搜索/空态视图（纯件，零 wx）
// 口径：UX_PARTNER §4.5（状态 chip 服务端筛选、需查明 client 过滤当前全集、筛空 vs 真空文案分开、
//       筛选说明行、换筛选退出多选）、§4.9（点 counts 跳对应筛选）、§4.15（逐句空态文案）。
// 纪律：状态值只从这里（parts 层）取 shared/enums 常量拼 listPartner 的 status 入参；工作台页面零七状态字面量。
'use strict';

const enums = require('../../../../shared/enums');

const FILTER_ALL = 'all';
const FILTER_NEED_CODE = 'needCode';
const FILTER_HISTORY = 'completed';

// 与 UX §4.5 逐项对齐：状态 chip 单选；已完结不是 listPartner 活动区筛选，而是历史分区入口。
const FILTERS = [
  { key: FILTER_ALL, label: '全部' },
  { key: 'submitted', label: '待接单', status: enums.ORDER_STATUS.SUBMITTED },
  { key: 'accepted', label: '待取件', status: enums.ORDER_STATUS.ACCEPTED },
  { key: 'picked', label: '已取件', status: enums.ORDER_STATUS.PICKED },
  { key: 'delivered', label: '已送达', status: enums.ORDER_STATUS.DELIVERED },
  { key: FILTER_NEED_CODE, label: '需查明', clientOnly: true },
  { key: 'exception', label: '异常', status: enums.ORDER_STATUS.EXCEPTION },
  { key: FILTER_HISTORY, label: '已完结', history: true }
];

// counts 六项 → 点击后跳的筛选（待确认→delivered；今日完成→展开已完结分区）
const COUNT_TARGETS = {
  submitted: { filter: 'submitted' },
  accepted: { filter: 'accepted' },
  picked: { filter: 'picked' },
  delivered: { filter: 'delivered' },
  exception: { filter: 'exception' },
  todayCompleted: { history: true }
};

const NEED_CODE_FILTER_HINT = '筛选中：需查明 —— 点上面那颗换一个。';

function metaOf(key) {
  for (let i = 0; i < FILTERS.length; i += 1) {
    if (FILTERS[i].key === key) {
      return FILTERS[i];
    }
  }
  return FILTERS[0];
}

function statusOf(key) {
  const meta = metaOf(key);
  return meta && meta.status ? meta.status : '';
}

function isHistory(key) {
  return !!metaOf(key).history;
}

function isNeedCode(key) {
  return key === FILTER_NEED_CODE;
}

function isActive(key) {
  return !!key && key !== FILTER_ALL;
}

function labelOf(key) {
  return metaOf(key).label || '';
}

// 筛选说明行（UX §4.5）：只在不含"全部"时出现，句子固定可复述
function describe(key) {
  if (!isActive(key)) {
    return '';
  }
  if (isNeedCode(key)) {
    return NEED_CODE_FILTER_HINT;
  }
  return '筛选中：' + labelOf(key) + ' —— 点上面那颗换一个。';
}

// 筛空 vs 真空 vs 搜索无结果（UX §4.5/§4.15 逐句）
function emptyOf(options) {
  const opts = options || {};
  if (opts.keyword) {
    return {
      title: '没找到匹配的订单',
      text: '可试试订单号或宿舍号。'
    };
  }
  if (isActive(opts.filter)) {
    return {
      title: '这个筛选下没有订单',
      text: '换回「全部」就都回来了。'
    };
  }
  return {
    title: '今天还没有订单',
    text: '把绑定卡片发给顾客，让顾客自己绑定；或给熟客代客下单。'
  };
}

// 已完结入口折叠文案（UX §4.10）：今天 N 单；服务端无历史总数时用 N+ 如实表达"还有更多"
function foldedText(count, hasMore) {
  const n = Math.max(0, Number(count) || 0);
  return '已完结 · 今天 ' + n + (hasMore ? '+' : '') + ' 单 >';
}

// counts 点击目标：{ filter } 或 { history:true }
function countTargetOf(countKey) {
  return COUNT_TARGETS[countKey] || null;
}

// 客户端需查明过滤（当前全集=当前筛选结果）：不改变计数与排序
function filterRows(groups, key) {
  const list = Array.isArray(groups) ? groups : [];
  if (!isNeedCode(key)) {
    return list;
  }
  const out = [];
  list.forEach((group) => {
    const rows = group.rows.filter((row) => row.needCode === true);
    if (rows.length) {
      out.push(Object.assign({}, group, { rows, count: rows.length }));
    }
  });
  return out;
}

// 多选资格（UX §4.2/§4.6）：DELIVERED/COMPLETED/CANCELLED 行不显示勾选。
// 判定只读服务端 DTO 的状态桶（bucket），不看七状态字面量。
const UNSELECTABLE_BUCKETS = ['delivered', 'history'];

function canSelect(row) {
  if (!row || !row.orderNo) {
    return false;
  }
  return UNSELECTABLE_BUCKETS.indexOf(row.bucket) === -1;
}

function isFilterEmptyVisible(keyword, filter, groups) {
  if (Array.isArray(groups) && groups.length) {
    return false;
  }
  return !!keyword || isActive(filter);
}

module.exports = {
  FILTER_ALL,
  FILTER_NEED_CODE,
  FILTER_HISTORY,
  FILTERS,
  COUNT_TARGETS,
  metaOf,
  statusOf,
  isHistory,
  isNeedCode,
  isActive,
  labelOf,
  describe,
  emptyOf,
  foldedText,
  countTargetOf,
  filterRows,
  canSelect,
  isFilterEmptyVisible
};
