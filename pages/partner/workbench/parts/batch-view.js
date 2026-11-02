// pages/partner/workbench/parts/batch-view.js · 多选/批量纯件（零 wx，异步调用由页面注入）
// 口径：UX_PARTNER §4.6（范围=当前筛选下可见活动单；客户端循环逐单调用 + 同一 batchActionId；
//       逐单结果、禁止把部分成功显示为全部成功；部分失败保留失败项选择态可重试）、§4.15（部分失败逐句文案）。
// 纪律：可执行动作只按服务端行内 actions[] 求交集（不判断七状态）；接单按契约不带 batchActionId。
// TD-083/D43/D51：送达确认文案的「系统每天 X 自动完成」时刻由调用方注入公开配置 config.autoCompleteAt；
//            缺配置/非法才回退出厂默认（默认值唯一单源 = config/defaults.DEFAULT_CONFIG，本零件零时刻字面量）；
//            D51 起语义改为「该时刻前送达的当天完成、该时刻后送达的下一轮批完成」（不再写「顺延次日」）。
'use strict';

const rowActions = require('./row-actions');
const defaults = require('../../../../config/defaults');

const BATCH_ACTIONS = [
  {
    key: 'accept',
    label: '接单',
    batch: false,
    confirmText: '将 N 单（共 M 件）标记为已接单，顾客会看到进度到「已接单」。'
  },
  {
    key: 'pick',
    label: '已取件',
    batch: true,
    undoable: true,
    confirmText: '将 N 单（共 M 件）标记为已取件，顾客会看到「已取件·配送中」。'
  },
  {
    key: 'deliver',
    label: '送达',
    batch: true,
    undoable: true,
    confirmText: '将 N 单（共 M 件）标记为已送达，顾客可确认；系统每天 {autoCompleteAt} 自动完成送达单（该时刻前送达的当天完成；该时刻后送达的下一轮自动完成；guest 单无需确认）。'
  },
  {
    key: 'undoPick',
    label: '撤销已取件',
    batch: true,
    confirmText: '将 N 单（共 M 件）退回「已接单」，顾客会看到进度回退提示。'
  },
  {
    key: 'correct',
    label: '改站点',
    batch: true,
    panel: true,
    confirmText: '选中 N 单共 M 件，将逐件改站点为「{station}」\n顾客端同步。'
  }
];

function metaOf(key) {
  return BATCH_ACTIONS.filter((item) => item.key === key)[0] || null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// D43/TD-083：日结批自动完成时刻（UTC+8 的 HH:MM）按调用方注入的公开配置生成文案；
// 缺配置/非法才回退出厂默认（唯一默认值 = config/defaults.DEFAULT_CONFIG，本零件不再写第二处时刻字面量）。
function autoCompleteAtOf(config) {
  const source = config && typeof config === 'object' ? config : {};
  return defaults.normalizeClockText(source.autoCompleteAt) || defaults.DEFAULT_CONFIG.autoCompleteAt;
}

const AUTO_COMPLETE_TOKEN = '{autoCompleteAt}';

// 确认文案模板占位替换：送达文案里该时刻出现两处，split/join 全替换（不允许只换一处）
function fillAutoCompleteAt(template, config) {
  return String(template || '').split(AUTO_COMPLETE_TOKEN).join(autoCompleteAtOf(config));
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
// v1.0：件数 M = 选中订单的包裹总数（改站点/改码逐单逐件循环，结果按件汇总）
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
  const pieceCount = rowActions.batchPiecesOf(queue).length;
  // D62：批量仍按订单——选中跨站单时确认框明示作用域=整单全部件
  const crossStationCount = queue.filter((row) => row.otherPiecesText).length;
  const baseText = fillAutoCompleteAt(fillCounts(meta.confirmText, queue.length, pieceCount), opts.config);
  return {
    ok: true,
    key,
    label: meta.label,
    batch: meta.batch,
    undoable: !!meta.undoable,
    panel: !!meta.panel,
    queue: queue,
    pieceCount: pieceCount,
    crossStationCount: crossStationCount,
    skipped: skipped,
    batchActionId: meta.batch ? (opts.batchActionId || '') : '',
    confirmText: crossStationCount
      ? baseText + '\n其中 ' + crossStationCount + ' 单在其他站点还有件，整单动作将作用于全部件。'
      : baseText
  };
}

function fillCounts(template, orderCount, pieceCount) {
  return String(template || '')
    .replace('N', String(orderCount))
    .replace('M', String(pieceCount));
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

// v1.0 批量改站点/改码：逐单逐件执行（同一 batchActionId；pieceFilter 只重试失败件）
function correctItemsOf(planIn) {
  const current = planIn || {};
  const filter = current.pieceFilter || null;
  return rowActions.batchPiecesOf(current.queue).filter((item) => {
    if (!filter) {
      return true;
    }
    return filter[item.row.orderNo + '#' + item.itemIndex] === true;
  });
}

async function runCorrect(planIn, callFn) {
  const current = planIn || {};
  const items = correctItemsOf(current);
  const results = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      await callFn(item.row, current.batchActionId, item.itemIndex);
      results.push({ orderNo: item.row.orderNo, itemIndex: item.itemIndex, itemIndexText: item.itemIndexText, ok: true, code: '', message: '' });
    } catch (err) {
      results.push({
        orderNo: item.row.orderNo,
        itemIndex: item.itemIndex,
        itemIndexText: item.itemIndexText,
        ok: false,
        code: (err && err.code) || '',
        message: (err && err.message) || '失败'
      });
    }
  }
  return { results };
}

function pieceKeyOf(result) {
  return textOf(result && result.orderNo) + '#' + String(result && result.itemIndex);
}

// 结果汇总（UX §4.15）：部分失败必须明确"保留选中、可重试"，不得显示为全部成功
// v1.0：改站点/改码按**件**汇总（成功 X 件 · 失败 Y 件），失败列到"单号 第 k 件 原因"
function summary(planIn, results) {
  const list = Array.isArray(results) ? results : [];
  const pieceMode = (planIn && planIn.key) === 'correct';
  const okRows = list.filter((item) => item.ok);
  const failed = list.filter((item) => !item.ok);
  const okCount = okRows.length;
  const failCount = failed.length;
  const unit = pieceMode ? '件' : '单';
  let text = '';
  if (!failCount) {
    text = '成功 ' + okCount + ' ' + unit + '。';
  } else if (!okCount) {
    text = '这 ' + failCount + ' ' + unit + '都没成功：' + failed.map(failureTextOf).join('；')
      + '。失败的单已保留选中，可重试。';
  } else {
    text = okCount + ' ' + unit + '成功，' + failCount + ' ' + unit + '失败：'
      + failed.map(failureTextOf).join('；')
      + '。失败的单已保留选中，可重试。';
  }
  const failedOrderNos = [];
  failed.forEach((item) => {
    if (failedOrderNos.indexOf(item.orderNo) < 0) {
      failedOrderNos.push(item.orderNo);
    }
  });
  return {
    okCount,
    failCount,
    pieceMode,
    allOk: failCount === 0,
    okOrderNos: okRows.map((item) => item.orderNo),
    failedOrderNos: failedOrderNos,
    failedPieceKeys: failed.map(pieceKeyOf),
    failed: failed.map((item) => ({
      orderNo: item.orderNo,
      itemIndex: typeof item.itemIndex === 'number' ? item.itemIndex : null,
      itemIndexText: textOf(item.itemIndexText),
      message: item.message,
      code: item.code
    })),
    text,
    actionKey: planIn ? planIn.key : ''
  };
}

function failureTextOf(item) {
  const head = textOf(item.orderNo);
  const piece = textOf(item.itemIndexText);
  return (piece ? head + ' ' + piece : head) + ' ' + textOf(item.message);
}

// 重试失败项：沿用同一 batchActionId（同批审计分组）；改站点/改码只把失败件放回队列
function retryPlan(planIn, failedOrderNos, failedPieceKeys) {
  const current = planIn || {};
  const failedMap = {};
  (failedOrderNos || []).forEach((orderNo) => {
    failedMap[orderNo] = true;
  });
  const queue = (current.queue || []).filter((row) => failedMap[row.orderNo]);
  const pieceFilter = {};
  (failedPieceKeys || []).forEach((key) => {
    pieceFilter[key] = true;
  });
  const pieceCount = current.key === 'correct'
    ? rowActions.batchPiecesOf(queue).filter((item) => !failedPieceKeys || pieceFilter[item.row.orderNo + '#' + item.itemIndex]).length
    : current.pieceCount;
  return Object.assign({}, current, {
    queue: queue,
    pieceFilter: current.key === 'correct' ? pieceFilter : null,
    pieceCount: pieceCount,
    mode: 'retry',
    confirmText: '将重试 ' + queue.length + ' 单' + (current.key === 'correct' ? '（共 ' + pieceCount + ' 件）' : '') + '「' + current.label + '」，顾客会看到最终结果。'
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

// 批量改站点确认框：把选中的站点名替换进逐字模板（v1.0 带件数 M）
function stationConfirmText(planIn, stationName) {
  const meta = metaOf((planIn && planIn.key) || 'correct');
  const base = meta ? meta.confirmText : '选中 N 单共 M 件，将逐件改站点为「{station}」\n顾客端同步。';
  const orderCount = planIn && planIn.queue ? planIn.queue.length : 0;
  const pieceCount = planIn && typeof planIn.pieceCount === 'number' ? planIn.pieceCount : orderCount;
  return fillCounts(base, orderCount, pieceCount).replace('{station}', stationName || '');
}

module.exports = {
  BATCH_ACTIONS,
  metaOf,
  canRun,
  eligibleRows,
  skippedOrderNos,
  plan,
  run,
  runCorrect,
  correctItemsOf,
  summary,
  retryPlan,
  selectionText,
  toolbarOf,
  stationConfirmText
};
