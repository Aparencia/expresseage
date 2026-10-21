// pages/partner/workbench/parts/selection-flow.js · 多选状态纯件（零 wx）
// 口径：UX_PARTNER §4.6（范围=当前筛选下可见活动单；全选只在当前筛选范围内；换筛选退出多选并清空选集；
//       DELIVERED/COMPLETED/CANCELLED 不可勾选——按服务端 bucket 判定，不读七状态字面量）。
'use strict';

const groupView = require('./group-view');
const filterView = require('./filter-view');
const batchView = require('./batch-view');

function stateOf(rows, map) {
  const applied = groupView.applySelection(rows, map || {});
  return {
    groups: applied.groups,
    selectedCount: applied.selectedCount,
    selectableCount: applied.selectableCount,
    selectionText: batchView.selectionText(applied.selectedCount, applied.selectableCount)
  };
}

// 进入/退出多选：进入时清空选集；退出时也清空（v3 教训：不留下看不见的选中）
function toggle(rows) {
  return stateOf(rows, {});
}

function toggleRow(rows, orderNo) {
  const found = groupView.findRow(rows, orderNo);
  if (!found) {
    return { ok: false, message: '订单已不在当前列表，刷新后再看', state: stateOf(rows, groupView.selectionMapOf(rows)) };
  }
  if (!found.row.selectable) {
    return {
      ok: false,
      message: '已送达/已完结的单不能勾选',
      state: stateOf(rows, groupView.selectionMapOf(rows))
    };
  }
  const map = groupView.selectionMapOf(rows);
  if (map[orderNo]) {
    delete map[orderNo];
  } else {
    map[orderNo] = true;
  }
  return { ok: true, message: '', state: stateOf(rows, map) };
}

function selectAll(rows) {
  const map = {};
  groupView.flattenRows(rows).forEach((row) => {
    if (filterView.canSelect(row)) {
      map[row.orderNo] = true;
    }
  });
  return stateOf(rows, map);
}

function clear(rows) {
  return stateOf(rows, {});
}

// 站头「全选本站」：只作用于本站可勾选行；已全选则取消本站
function toggleStation(rows, stationId) {
  const map = groupView.selectionMapOf(rows);
  const target = groupView.flattenRows(rows).filter((row) => row.selectable && row.stationId === stationId);
  const allSelected = target.length > 0 && target.every((row) => map[row.orderNo]);
  target.forEach((row) => {
    if (allSelected) {
      delete map[row.orderNo];
    } else {
      map[row.orderNo] = true;
    }
  });
  return stateOf(rows, map);
}

// 应用恢复：刷新后只保留仍存在且仍可勾选的行
function restore(rows, previousMap) {
  const map = {};
  const alive = {};
  groupView.flattenRows(rows).forEach((row) => {
    alive[row.orderNo] = row.selectable === true;
  });
  Object.keys(previousMap || {}).forEach((orderNo) => {
    if (alive[orderNo]) {
      map[orderNo] = true;
    }
  });
  return stateOf(rows, map);
}

module.exports = {
  stateOf,
  toggle,
  toggleRow,
  selectAll,
  clear,
  toggleStation,
  restore
};
