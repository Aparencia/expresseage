// pages/partner/workbench/parts/batch-view.js · 多选/批量纯件（零 wx，异步调用由页面注入）
// 口径：UX_PARTNER §4.6（范围=当前筛选下可见活动单；客户端循环逐单调用 + 同一 batchActionId；
//       逐单结果、禁止把部分成功显示为全部成功；部分失败保留失败项选择态可重试）、§4.15（部分失败逐句文案）。
// 纪律：可执行动作只按服务端行内 actions[] 求交集（不判断七状态）；接单按契约不带 batchActionId。
'use strict';

const rowActions = require('./row-actions');

const BATCH_ACTIONS = [
  {
    key: 'accept',
    label: '接单',
    batch: false,
    confirmText: '将 N 单标记为已接单，顾客会看到进度到「已接单」。'
  },
  {
    key: 'pick',
    label: '已取件',
    batch: true,
    undoable: true,
    confirmText: '将 N 件标记为已取件，顾客会看到「已取件·配送中」。'
  },
  {
    key: 'deliver',
    label: '送达',
    batch: true,
    undoable: true,
    confirmText: '将 N 单标记为已送达，顾客可确认；24h 未确认自动完成（guest 单无需确认，系统自动完成）。'
  },
  {
    key: 'undoPick',
    label: '撤销已取件',
    batch: true,
    confirmText: '将 N 单退回「已接单」，顾客会看到进度回退提示。'
  },
  {
    key: 'correct',
    label: '改站点',
    batch: true,
    panel: true,
    confirmText: '将把 N 单的站点改成「{station}」，顾客端同步。'
  }
];

function metaOf(key) {
  return BATCH_ACTIONS.filter((item) => item.key === key)[0] || null;
}

function canRun(key, row) {
  return rowActions.knownActions(row).some((item) => item.key === key);
}

// 批量资格：勾选框已挡 DELIVERED/COMPLETED/CANCELLED；这里再按 actions[] 求交集（服务端判据）
function eligibleRows(key, rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => canRun(key, row));
}

function skippedOrderNos(key, rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !canRun(key, row)).map((row) => row.orderNo);
}

// 计划：queue=可执行、skipped=被服务端 actions 排除的已选单；batchActionId 只在批量键上生效
function plan(key, rows, options) {
  const opts = options || {};
  const meta = metaOf(key);
  if (!meta) {
    return { ok: false, message: '未知批量动作' };
  }
  const queue = eligibleRows(key, rows);
  const skipped = skippedOrderNos(key, rows);
  if (!queue.length) {
    return {
      ok: false,
      message: '选中的单里没有可「' + meta.label + '」的，先看行内能点什么',
      skipped: skipped
    };
  }
  return {
    ok: true,
    key,
    label: meta.label,
    batch: meta.batch,
    undoable: !!meta.undoable,
    panel: !!meta.panel,
    queue: queue,
    skipped: skipped,
    batchActionId: meta.batch ? (opts.batchActionId || '') : '',
    confirmText: meta.confirmText.replace('N', String(queue.length))
  };
}

// 逐单循环执行（不聚合、不回滚成功项；失败只记录，不吞）
async function run(planIn, callFn) {
  const current = planIn || {};
  const queue = Array.isArray(current.queue) ? current.queue : [];
  const results = [];
  for (let i = 0; i < queue.length; i += 1) {
    const row = queue[i];
    try {
      await callFn(row, current.batchActionId);
      results.push({ orderNo: row.orderNo, ok: true, code: '', message: '' });
    } catch (err) {
      results.push({
        orderNo: row.orderNo,
        ok: false,
        code: (err && err.code) || '',
        message: (err && err.message) || '失败'
      });
    }
  }
  return { results };
}

// 结果汇总（UX §4.15）：部分失败必须明确"保留选中、可重试"，不得显示为全部成功
function summary(planIn, results) {
  const list = Array.isArray(results) ? results : [];
  const okRows = list.filter((item) => item.ok);
  const failed = list.filter((item) => !item.ok);
  const okCount = okRows.length;
  const failCount = failed.length;
  let text = '';
  if (!failCount) {
    text = '成功 ' + okCount + ' 单。';
  } else if (!okCount) {
    text = '这 ' + failCount + ' 单都没成功：' + failed.map((item) => item.orderNo + ' ' + item.message).join('；')
      + '。失败的单已保留选中，可重试。';
  } else {
    text = okCount + ' 单成功，' + failCount + ' 单失败：'
      + failed.map((item) => item.orderNo + ' ' + item.message).join('；')
      + '。失败的单已保留选中，可重试。';
  }
  return {
    okCount,
    failCount,
    allOk: failCount === 0,
    okOrderNos: okRows.map((item) => item.orderNo),
    failedOrderNos: failed.map((item) => item.orderNo),
    failed: failed.map((item) => ({ orderNo: item.orderNo, message: item.message, code: item.code })),
    text,
    actionKey: planIn ? planIn.key : ''
  };
}

// 重试失败项：沿用同一 batchActionId（同批审计分组），只把失败单放回队列
function retryPlan(planIn, failedOrderNos) {
  const current = planIn || {};
  const failedMap = {};
  (failedOrderNos || []).forEach((orderNo) => {
    failedMap[orderNo] = true;
  });
  const queue = (current.queue || []).filter((row) => failedMap[row.orderNo]);
  return Object.assign({}, current, {
    queue: queue,
    mode: 'retry',
    confirmText: '将重试 ' + queue.length + ' 单「' + current.label + '」，顾客会看到最终结果。'
  });
}

function selectionText(selectedCount, scopeCount) {
  const selected = Math.max(0, Number(selectedCount) || 0);
  const scope = Math.max(0, Number(scopeCount) || 0);
  return '已选 ' + selected + ' 件 · 全选范围：当前筛选下 ' + scope + ' 件';
}

function toolbarOf() {
  return BATCH_ACTIONS.map((item) => ({ key: item.key, label: item.label, panel: !!item.panel }));
}

// 批量改站点确认框：把选中的站点名替换进逐字模板
function stationConfirmText(planIn, stationName) {
  const meta = metaOf((planIn && planIn.key) || 'correct');
  const base = meta ? meta.confirmText : '将把 N 单的站点改成「{station}」，顾客端同步。';
  return base.replace('N', String((planIn && planIn.queue ? planIn.queue.length : 0)))
    .replace('{station}', stationName || '');
}

module.exports = {
  BATCH_ACTIONS,
  metaOf,
  canRun,
  eligibleRows,
  skippedOrderNos,
  plan,
  run,
  summary,
  retryPlan,
  selectionText,
  toolbarOf,
  stationConfirmText
};
