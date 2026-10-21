// pages/partner/workbench/parts/undo-view.js · 撤销条纯件（零 wx，调用由页面注入）
// 口径：UX_PARTNER §4.7（取件/送达成功后 5s；批量撤销传同一 batchActionId 调 order.undo；
//       部分失败文案「3 单撤销成功，1 单顾客已确认，不能撤销」；超时/离页消失；READONLY 不显示）。
// 纪律：接单不可撤销（只在 pick/deliver 后出现）；页面不自己拼撤销映射。
'use strict';

const UNDO_SECONDS = 5;

const META = {
  pick: { label: '已取件', backText: '已接单' },
  deliver: { label: '已送达', backText: '已取件' }
};

// 撤销映射：只有「已取件」「送达」能进撤销条（接单不设撤销）
function undoableMeta(actionKey) {
  return META[actionKey] || null;
}

function createState(options) {
  const opts = options || {};
  const meta = undoableMeta(opts.actionKey);
  if (!meta) {
    return null;
  }
  const orderNos = Array.isArray(opts.orderNos) ? opts.orderNos.slice() : [];
  if (!orderNos.length) {
    return null;
  }
  return {
    visible: true,
    remaining: UNDO_SECONDS,
    actionKey: opts.actionKey,
    label: meta.label,
    backText: meta.backText,
    orderNos: orderNos,
    batchActionId: opts.batchActionId || '',
    text: '已把 ' + orderNos.length + ' 件标记为「' + meta.label + '」'
  };
}

// 倒计时：每秒减 1，归零隐藏；不改 orderNos（撤销按原批）
function tick(state) {
  const current = state || {};
  if (!current.visible) {
    return current;
  }
  const remaining = (Number(current.remaining) || 0) - 1;
  if (remaining <= 0) {
    return Object.assign({}, current, { visible: false, remaining: 0 });
  }
  return Object.assign({}, current, { remaining: remaining });
}

// 逐单调用 order.undo：批量共享同一 batchActionId（服务端按批审计/校验）
async function run(orderNos, batchActionId, callFn) {
  const list = Array.isArray(orderNos) ? orderNos : [];
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    try {
      await callFn(list[i], batchActionId);
      results.push({ orderNo: list[i], ok: true, code: '', message: '' });
    } catch (err) {
      results.push({
        orderNo: list[i],
        ok: false,
        code: (err && err.code) || '',
        message: (err && err.message) || '失败'
      });
    }
  }
  return { results };
}

function reasonOf(item) {
  const message = (item && item.message) || '';
  if (message.indexOf('确认') >= 0) {
    return '顾客已确认';
  }
  return '状态已变化';
}

// 撤销结果文案（UX §4.7 逐字）：部分失败必须说清"哪类不能撤销"
function summary(results, actionKey) {
  const list = Array.isArray(results) ? results : [];
  const meta = undoableMeta(actionKey) || META.pick;
  const okRows = list.filter((item) => item.ok);
  const failed = list.filter((item) => !item.ok);
  const okCount = okRows.length;
  const failCount = failed.length;
  let text = '';
  if (!failCount) {
    text = '已撤销：' + okCount + ' 件回到「' + meta.backText + '」。';
  } else if (!okCount) {
    text = '撤销失败：' + reasonOf(failed[0]) + '，请刷新后再看。';
  } else {
    text = okCount + ' 单撤销成功，' + failCount + ' 单' + reasonOf(failed[0]) + '，不能撤销';
  }
  return { okCount, failCount, allOk: failCount === 0, text, failedOrderNos: failed.map((item) => item.orderNo) };
}

module.exports = {
  UNDO_SECONDS,
  META,
  undoableMeta,
  createState,
  tick,
  run,
  summary
};
