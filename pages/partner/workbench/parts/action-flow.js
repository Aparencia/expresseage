// pages/partner/workbench/parts/action-flow.js · 交互意图纯件（零 wx）：页面只把 intent 翻译成 wx 调用
// 口径：UX_PARTNER §4.4（补码后自动跳下一条需查明）、§4.6（批量确认/部分失败保留失败选中可重试）、
//       §4.10（已完结分区状态）、§4.13（行内浮层）、§6.2/§6.3（READONLY：置灰+toast+不发请求）。
// 纪律：动作可见性与可执行性全部来自服务端行内 actions[]；本文件不判断订单七状态。
'use strict';

const groupView = require('./group-view');
const rowActions = require('./row-actions');
const batchView = require('./batch-view');
const undoView = require('./undo-view');
const historyView = require('./history-view');

const READONLY_COPY = '开发者只读视角不能操作';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 行级动作点击 → 意图：navigate / toast / panel / confirm
function rowActionIntent(key, orderNo, groups, readonly) {
  const found = groupView.findRow(groups, orderNo);
  if (!found || !key) {
    return { kind: 'none' };
  }
  if (key === 'message') {
    return { kind: 'navigate', orderNo: found.row.orderNo };
  }
  if (readonly && rowActions.isWriteKey(key)) {
    return { kind: 'toast', message: READONLY_COPY };
  }
  const def = rowActions.ACTIONS[key];
  if (!def) {
    return { kind: 'none' };
  }
  if (def.panel) {
    return { kind: 'panel', panel: rowActions.openPanel(key, found.row) };
  }
  return {
    kind: 'confirm',
    title: def.label,
    content: rowActions.confirmTextOf(key, found.row),
    key: key,
    row: found.row
  };
}

// 「需查明 · 补码」点击：服务端给了 correct 就开行内面板，否则跳详情（不本地判状态）
function needCodeIntent(orderNo, groups, readonly) {
  const found = groupView.findRow(groups, orderNo);
  if (!found) {
    return { kind: 'none' };
  }
  if (readonly) {
    return { kind: 'toast', message: READONLY_COPY };
  }
  const hasCorrect = rowActions.knownActions(found.row).some((item) => item.key === 'correct');
  if (!hasCorrect) {
    return { kind: 'navigate', orderNo: found.row.orderNo };
  }
  return { kind: 'panel', panel: rowActions.openPanel('correct', found.row) };
}

// 浮层提交 → 意图：error / write / batchStationConfirm
function panelSubmitIntent(panel, groups) {
  if (!panel) {
    return { kind: 'none' };
  }
  if (panel.batchMode) {
    const checked = rowActions.validateBatchStation(panel);
    if (!checked.ok) {
      return { kind: 'error', message: checked.message };
    }
    return {
      kind: 'batchStationConfirm',
      plan: panel.plan,
      values: checked.values,
      content: batchView.stationConfirmText(panel.plan, checked.values.patch.stationName)
    };
  }
  const checked = rowActions.validatePanel(panel);
  if (!checked.ok) {
    return { kind: 'error', message: checked.message };
  }
  const found = groupView.findRow(groups, panel.orderNo);
  if (!found) {
    return { kind: 'toast', message: '订单已不在当前列表，刷新后再看' };
  }
  // v1.0 逐件纠正：把件号带进写请求（补码面板切件后保存的是当前件）
  const values = Object.assign({}, checked.values, {
    itemIndex: typeof panel.itemIndex === 'number' ? panel.itemIndex : 0,
    itemIndexText: textOf(panel.itemIndexText)
  });
  return { kind: 'write', key: panel.actionKey, row: found.row, values: values };
}

// 整屏剩余需查明件数（v1.0：多件单按件计；单件单 1 行算 1 件）
function needCodePieceCount(groups) {
  let count = 0;
  groupView.flattenRows(groups).forEach((row) => {
    if (Array.isArray(row.parcelRows)) {
      count += row.parcelRows.filter((piece) => piece.needCode === true).length;
    } else if (row.needCode === true) {
      count += 1;
    }
  });
  return count;
}

// 单件写成功之后：补码场景滚动到/展开下一条需查明并给逐句提示
// v1.0：多件单改完一件后停在本单同一件面板（可继续核对其他件），不跳单
function afterWriteIntent(key, groups, row, values) {
  if (key !== 'correct') {
    return { toastText: '已更新', panel: null };
  }
  const valuesIn = values || {};
  const remaining = needCodePieceCount(groups);
  const fresh = groupView.findRow(groups, row.orderNo);
  const itemIndex = typeof valuesIn.itemIndex === 'number' ? valuesIn.itemIndex : 0;
  const multi = !!(fresh && fresh.row && fresh.row.parcelCount > 1);
  if (multi && rowActions.knownActions(fresh.row).some((item) => item.key === 'correct')) {
    return {
      toastText: rowActions.parcelCorrectToast({ indexText: textOf(valuesIn.itemIndexText), remaining: remaining }),
      panel: rowActions.openPanel('correct', fresh.row, itemIndex)
    };
  }
  const next = rowActions.nextNeedCodeAfter(groups, row.orderNo);
  return {
    toastText: rowActions.correctToast({
      remaining: next.remaining,
      stationName: row.stationName,
      tierText: row.tierText
    }),
    panel: next.row ? rowActions.openPanel('correct', next.row) : null
  };
}

// 批量按钮 → 意图：toast / panel（改站点需选站点）/ confirm
function batchTapIntent(key, groups, readonly) {
  if (readonly) {
    return { kind: 'toast', message: READONLY_COPY };
  }
  const rows = groupView.selectedRows(groups);
  const plan = batchView.plan(key, rows);
  if (!plan.ok) {
    return { kind: 'toast', message: plan.message || '选中的单里没有可执行的动作' };
  }
  if (plan.panel) {
    return {
      kind: 'panel',
      panel: Object.assign(rowActions.openBatchStationPanel(), { batchMode: true, plan: plan })
    };
  }
  return { kind: 'confirm', title: plan.label, content: plan.confirmText, plan: plan };
}

// 批量结果 → 页面状态补丁 + 撤销条参数 + 结果弹窗（部分失败必须给重试入口）
function finishBatchIntent(plan, values, results, groups, readonly) {
  const summary = batchView.summary(plan, results);
  const failedMap = {};
  summary.failedOrderNos.forEach((orderNo) => {
    failedMap[orderNo] = true;
  });
  const applied = groupView.applySelection(groups, failedMap);
  const patch = {
    batchRunning: false,
    selecting: false,
    groups: applied.groups,
    selectedCount: applied.selectedCount,
    selectableCount: applied.selectableCount,
    selectionText: batchView.selectionText(applied.selectedCount, applied.selectableCount),
    batchResult: Object.assign({}, summary, { values: values, label: plan.label })
  };
  const undo = !readonly && plan.undoable && summary.okOrderNos.length
    ? { actionKey: plan.key, orderNos: summary.okOrderNos, batchActionId: plan.batchActionId }
    : null;
  const modal = summary.allOk
    ? { title: '批量' + plan.label, content: summary.text, showCancel: false, confirmText: '', cancelText: '' }
    : {
      title: '批量' + plan.label,
      content: summary.text,
      showCancel: true,
      confirmText: '重试失败项',
      cancelText: '稍后处理'
    };
  return { summary: summary, patch: patch, undo: undo, modal: modal };
}

// 撤销条状态（READONLY 不出现）
function undoStateOf(actionKey, orderNos, batchActionId, readonly) {
  if (readonly) {
    return null;
  }
  return undoView.createState({ actionKey: actionKey, orderNos: orderNos, batchActionId: batchActionId });
}

function closedUndo() {
  return { visible: false, remaining: 0, label: '', orderNos: [], actionKey: '', batchActionId: '', text: '' };
}

// 已完结展开/继续翻页 → completed 视图补丁（今天/昨天/更早 + 「更早」按钮）
function historyStateOf(rows, nextCursor, loading, nowMs) {
  const panel = historyView.panelOf({
    rows: rows,
    nowMs: nowMs,
    hasMore: !!nextCursor,
    nextCursor: nextCursor,
    loading: !!loading
  });
  return {
    loading: !!loading,
    expanded: true,
    sections: panel.sections,
    moreText: panel.moreText,
    hasMore: panel.hasMore,
    nextCursor: panel.nextCursor,
    olderLoaded: panel.olderLoaded
  };
}

module.exports = {
  READONLY_COPY,
  rowActionIntent,
  needCodeIntent,
  panelSubmitIntent,
  afterWriteIntent,
  batchTapIntent,
  finishBatchIntent,
  undoStateOf,
  closedUndo,
  historyStateOf
};
