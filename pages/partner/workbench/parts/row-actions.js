// pages/partner/workbench/parts/row-actions.js · 行级动作/浮层纯件（零 wx，零页面状态判断）
// 口径：UX_PARTNER §4.2（行主/次操作）、§4.4（行内补码：取件码≤40/柜号/运单尾号恰 5 位、保存后跳下一条需查明）、
//       §4.13（异常原因 6 值 + 备注≤200、OTHER 必填）、§4.6（确认框逐字）、§6.3（READONLY 置灰不发请求）。
// 纪律：可见性 100% 来自服务端行内 actions[]（批6-A）；本文件只把动作键翻译成浮层/请求/文案，不判断订单七状态。
'use strict';

const enums = require('../../../../shared/enums');
const stations = require('../../../../shared/stations');

const codePanel = require('./code-panel');

const PICKUP_CODE_MAX = codePanel.PICKUP_CODE_MAX;
const TRACKING_TAIL_LENGTH = codePanel.TRACKING_TAIL_LENGTH;
const EXCEPTION_TEXT_MAX = 200;
const NOTE_MAX = 200;
const DELIVERY_NOTE_MAX = 100;

// 动作注册表：method = api/modules/order 的方法名；batch = 可参与批量循环
const ACTIONS = {
  accept: {
    label: '接单',
    method: 'accept',
    confirmText: '将 1 单标记为已接单，顾客会看到进度到「已接单」。'
  },
  reject: {
    label: '拒单',
    panel: 'reason',
    title: '拒单',
    noteMax: NOTE_MAX,
    reasonBy: 'PARTNER'
  },
  pick: {
    label: '已取件',
    method: 'markPicked',
    undoable: true,
    batch: 'pick',
    confirmText: '将 1 件标记为已取件，顾客会看到「已取件·配送中」。'
  },
  undoPick: {
    label: '撤销已取件',
    method: 'unmarkPicked',
    undoable: true,
    confirmText: '撤销后订单回到「已接单」，顾客会看到进度回退。'
  },
  deliver: {
    label: '送达',
    method: 'markDelivered',
    undoable: true,
    batch: 'deliver',
    panel: 'deliver',
    title: '标记送达'
  },
  undoDeliver: {
    label: '撤销已送达',
    method: 'unmarkDelivered',
    undoable: true,
    confirmText: '撤销后订单回到「已取件」，顾客会看到进度回退。'
  },
  exception: {
    label: '异常上报',
    panel: 'exception',
    title: '异常上报'
  },
  resolve: {
    label: '解除异常',
    method: 'resolveException',
    confirmText: '确认已恢复？顾客会看到进度恢复。'
  },
  correct: {
    label: '补码',
    panel: 'code',
    title: '补上取件码'
  },
  cancel: {
    label: '取消订单',
    panel: 'reason',
    title: '取消订单',
    noteMax: NOTE_MAX,
    reasonBy: 'PARTNER',
    danger: true
  },
  message: {
    label: '留言',
    navigate: true
  }
};

const PRIMARY_ORDER = ['accept', 'pick', 'deliver', 'resolve'];
const WRITE_KEYS = ['accept', 'reject', 'pick', 'undoPick', 'deliver', 'undoDeliver', 'exception', 'resolve', 'correct', 'cancel'];
const DELIVERY_QUICK_TAGS = ['放宿舍门口', '放楼下货架', '交给本人', '放快递柜'];

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function knownActions(row) {
  const list = row && Array.isArray(row.actions) ? row.actions : [];
  const out = [];
  list.forEach((entry) => {
    const key = typeof entry === 'string' ? entry : entry && entry.key;
    if (!key || !ACTIONS[key]) {
      return;
    }
    if (out.some((item) => item.key === key)) {
      return;
    }
    out.push({ key, label: textOf(entry && entry.label) || ACTIONS[key].label });
  });
  return out;
}

function isWriteKey(key) {
  return WRITE_KEYS.indexOf(key) !== -1;
}

// 行工具条：主操作取服务端下发的第一个"主操作键"，其余为次操作；多选态隐藏工具；READONLY 全置灰
function buildToolbar(row, options) {
  const opts = options || {};
  const list = knownActions(row);
  const tools = list.map((item) => ({
    key: item.key,
    label: item.label,
    danger: !!ACTIONS[item.key].danger,
    disabled: !!opts.readonly
  }));
  if (opts.selecting) {
    return { primary: [], secondary: [], detail: false, hidden: true };
  }
  let primary = null;
  for (let i = 0; i < PRIMARY_ORDER.length; i += 1) {
    const hit = tools.filter((item) => item.key === PRIMARY_ORDER[i])[0];
    if (hit) {
      primary = hit;
      break;
    }
  }
  const secondary = tools.filter((item) => !primary || item.key !== primary.key);
  return {
    primary: primary ? [primary] : [],
    secondary: secondary,
    detail: true,
    hidden: false
  };
}

// 浮层构造：reason（拒单/取消原因）/ exception（异常 6 值）/ code（行内补码，v1.0 逐件）/ deliver（送达备注）
function openPanel(key, row, itemIndex) {
  const def = ACTIONS[key];
  if (!def || !def.panel) {
    return null;
  }
  const base = { actionKey: key, orderNo: textOf(row && row.orderNo), title: def.title || def.label, error: '' };
  if (def.panel === 'reason') {
    return Object.assign(base, {
      type: 'reason',
      options: enums.CANCEL_REASONS[def.reasonBy || 'PARTNER'],
      selected: '',
      note: '',
      noteMax: def.noteMax || NOTE_MAX,
      noteRequired: true,
      noteLabel: '说明（选「其他原因」必填）'
    });
  }
  if (def.panel === 'exception') {
    return Object.assign(base, {
      type: 'exception',
      options: enums.EXCEPTION_CODES,
      selected: '',
      text: '',
      textMax: EXCEPTION_TEXT_MAX,
      otherHint: '选了「其他异常」要把说明写清楚'
    });
  }
  if (def.panel === 'code') {
    return Object.assign(base, codePanel.codePanelOf(row, itemIndex));
  }
  return Object.assign(base, {
    type: 'deliver',
    quickTags: DELIVERY_QUICK_TAGS.slice(),
    note: '',
    noteMax: DELIVERY_NOTE_MAX
  });
}

// 面板提交前本地校验（与 shared/validate 同边界；服务端仍是最终裁判）
function validatePanel(panel) {
  if (!panel) {
    return { ok: false, message: '面板已关闭，请重新点一次' };
  }
  if (panel.type === 'reason') {
    const reason = textOf(panel.selected);
    if (!reason) {
      return { ok: false, message: '先选一个原因' };
    }
    const note = textOf(panel.note);
    if (note.length > (panel.noteMax || NOTE_MAX)) {
      return { ok: false, message: '说明太长，最多 ' + (panel.noteMax || NOTE_MAX) + ' 字' };
    }
    if (reason === enums.OTHER_REASON_CODE && !note) {
      return { ok: false, message: '选了「其他原因」要把说明写清楚' };
    }
    return { ok: true, values: { reason, note } };
  }
  if (panel.type === 'exception') {
    const code = textOf(panel.selected);
    if (!code) {
      return { ok: false, message: '先选一个异常原因' };
    }
    const text = textOf(panel.text);
    if (text.length > EXCEPTION_TEXT_MAX) {
      return { ok: false, message: '说明太长，最多 ' + EXCEPTION_TEXT_MAX + ' 字' };
    }
    if (code === enums.EXCEPTION_OTHER_CODE && !text) {
      return { ok: false, message: '选了「其他异常」要把说明写清楚' };
    }
    return { ok: true, values: { code, text } };
  }
  if (panel.type === 'code') {
    const code = textOf(panel.code);
    if (!code) {
      return { ok: false, message: '取件码必填，先看驿站短信/取件页核对' };
    }
    if (code.length > PICKUP_CODE_MAX) {
      return { ok: false, message: '取件码太长，最多 ' + PICKUP_CODE_MAX + ' 个字符' };
    }
    const tail = textOf(panel.trackingTail);
    if (tail && !/^[0-9]{5}$/.test(tail)) {
      return { ok: false, message: '运单尾号要恰好 5 位数字（可空）' };
    }
    // 只提交改动过的字段：已取件行（只允许柜号/尾号）不会被"未改的取件码"整单驳回
    const origin = panel.origin || {};
    const patch = {};
    if (code !== textOf(origin.code)) {
      patch.pickupCode = code;
    }
    if (textOf(panel.lockerNo) !== textOf(origin.lockerNo)) {
      patch.lockerNo = textOf(panel.lockerNo);
    }
    if (tail !== textOf(origin.trackingTail)) {
      patch.trackingTail = tail;
    }
    if (!Object.keys(patch).length) {
      return { ok: false, message: '没有改动，改一处再保存' };
    }
    return { ok: true, values: { patch: patch } };
  }
  if (panel.type === 'deliver') {
    const note = textOf(panel.note);
    if (note.length > DELIVERY_NOTE_MAX) {
      return { ok: false, message: '送达备注太长，最多 ' + DELIVERY_NOTE_MAX + ' 字' };
    }
    return { ok: true, values: { deliveryNote: note } };
  }
  return { ok: false, message: '未知操作面板' };
}

// 浮层动作没有 method 字段，这里补上它们的云函数方法名（键名逐字对齐 CONTRACT §5.3）
const PANEL_METHODS = { reject: 'reject', exception: 'reportException', cancel: 'cancel', correct: 'correct' };

// 撤销类方法名：批量模式走 order.undo（按 batchActionId 批量逐单校验），单件走对应 unmark 动作
function methodOf(key, batchActionId) {
  if (key === 'undoPick') {
    return batchActionId ? 'undo' : 'unmarkPicked';
  }
  if (key === 'undoDeliver') {
    return batchActionId ? 'undo' : 'unmarkDelivered';
  }
  if (PANEL_METHODS[key]) {
    return PANEL_METHODS[key];
  }
  const def = ACTIONS[key];
  return def && def.method ? def.method : '';
}

function batchPayloadOf(payload, batchActionId) {
  if (batchActionId) {
    payload.batchActionId = batchActionId;
  }
  return payload;
}

// v1.0 逐件纠正：itemIndex 缺省 0 不传（契约默认即首件，兼容旧调用方）
function correctPayloadOf(orderNo, values, batchActionId) {
  const payload = { orderNo: orderNo, patch: values.patch || {} };
  if (typeof values.itemIndex === 'number' && values.itemIndex > 0) {
    payload.itemIndex = values.itemIndex;
  }
  return batchPayloadOf(payload, batchActionId);
}

// 动作 → 请求体（键名逐字对齐 CONTRACT §5.3；不认识的键返回 null 由调用方兜底）
function payloadOf(key, orderNo, values, batchActionId) {
  if (key === 'accept') {
    return { orderNo: orderNo };
  }
  if (key === 'reject' || key === 'cancel') {
    return { orderNo: orderNo, reason: values.reason, note: values.note || '' };
  }
  if (key === 'pick') {
    return batchPayloadOf({ orderNo: orderNo }, batchActionId);
  }
  if (key === 'deliver') {
    return batchPayloadOf({ orderNo: orderNo, deliveryNote: values.deliveryNote || '' }, batchActionId);
  }
  if (key === 'undoPick' || key === 'undoDeliver') {
    return batchPayloadOf({ orderNo: orderNo }, batchActionId);
  }
  if (key === 'exception') {
    return { orderNo: orderNo, code: values.code, text: values.text || '' };
  }
  if (key === 'resolve') {
    return { orderNo: orderNo };
  }
  if (key === 'correct') {
    return correctPayloadOf(orderNo, values, batchActionId);
  }
  return null;
}

function versionOptsOf(row) {
  const opts = {};
  const version = row && typeof row.version === 'number' ? row.version : 0;
  if (version > 0) {
    opts.expectedVersion = version;
  }
  return opts;
}

// 行/批次请求构造：统一带 expectedVersion（服务端乐观锁）；批量键带同一 batchActionId
function buildWrite(key, row, values, batchActionId) {
  const orderNo = textOf(row && row.orderNo);
  const payload = payloadOf(key, orderNo, values || {}, batchActionId);
  return {
    key: key,
    method: methodOf(key, batchActionId),
    payload: payload || { orderNo: orderNo },
    opts: versionOptsOf(row)
  };
}

// 单件确认框（只对需要二次确认的动作返回；浮层型动作由浮层自述）
function confirmTextOf(key, row) {
  const def = ACTIONS[key];
  if (!def || !def.confirmText || !row) {
    return '';
  }
  return def.confirmText.replace('1 ', '1 ');
}

// 行内补码成功文案（UX §4.4 逐字）
function correctToast(options) {
  const opts = options || {};
  const remaining = Math.max(0, Number(opts.remaining) || 0);
  if (remaining <= 0) {
    return '这一屏的需查明都补齐了。';
  }
  const station = textOf(opts.stationName) || '本单站点';
  const tier = textOf(opts.tierText) || '其他';
  return '已补齐：' + station + ' → ' + tier + '档。还剩 ' + remaining + ' 件需查明。';
}

// v1.0 逐件补码成功文案（带件号；remaining=整屏剩余需查明件数）
function parcelCorrectToast(options) {
  const opts = options || {};
  const indexText = textOf(opts.indexText) || '第 1 件';
  const remaining = Math.max(0, Number(opts.remaining) || 0);
  if (remaining <= 0) {
    return indexText + '已更正，顾客端同步。';
  }
  return indexText + '已更正，顾客端同步。还剩 ' + remaining + ' 件需查明。';
}

// 批量改站点/改码（v1.0）：逐单逐件展开工作项（同一 batchActionId；结果按件汇总）
function batchPiecesOf(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    codePanel.codeItemsOf(row).forEach((piece) => {
      out.push({ row: row, itemIndex: piece.index, itemIndexText: piece.indexText });
    });
  });
  return out;
}

// 保存后自动跳到下一条需查明：返回 { row, remaining }；currentOrderNo 已被补码时从其余单里取第一条
function nextNeedCodeAfter(groups, currentOrderNo) {
  const list = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.rows || []).forEach((row) => {
      if (row.needCode) {
        list.push({ row, stationName: group.stationName });
      }
    });
  });
  const currentIndex = list.map((item) => item.row.orderNo).indexOf(currentOrderNo);
  const remaining = list.length - (currentIndex >= 0 ? 1 : 0);
  if (!list.length) {
    return { row: null, remaining: 0 };
  }
  if (currentIndex < 0) {
    return { row: list[0].row, remaining: remaining, stationName: list[0].stationName };
  }
  const next = list[(currentIndex + 1) % list.length];
  if (next.row.orderNo === currentOrderNo) {
    return { row: null, remaining: 0 };
  }
  return { row: next.row, remaining: remaining, stationName: next.stationName };
}

// 批量改站点面板（批量 correct 的唯一安全用法：同站点整批更正；逐件码不同）
function openBatchStationPanel() {
  return {
    type: 'batchStation',
    actionKey: 'correct',
    title: '批量改站点',
    options: stations.listStations(),
    selected: '',
    error: ''
  };
}

function validateBatchStation(panel) {
  const stationId = textOf(panel && panel.selected);
  if (!stationId) {
    return { ok: false, message: '先选一个站点' };
  }
  if (!stations.isStationId(stationId)) {
    return { ok: false, message: '站点只能从 P1~P8 里选' };
  }
  return { ok: true, values: { patch: { stationId, stationName: stations.stationNameOf(stationId) } } };
}

function inlineError(err) {
  if (!err) {
    return '保存失败，请重试';
  }
  return err.message || '保存失败，请重试';
}

module.exports = {
  ACTIONS,
  PRIMARY_ORDER,
  WRITE_KEYS,
  DELIVERY_QUICK_TAGS,
  isWriteKey,
  knownActions,
  buildToolbar,
  openPanel,
  codeItemsOf: codePanel.codeItemsOf,
  switchCodePanel: codePanel.switchCodePanel,
  validatePanel,
  buildWrite,
  confirmTextOf,
  correctToast,
  parcelCorrectToast,
  batchPiecesOf,
  nextNeedCodeAfter,
  openBatchStationPanel,
  validateBatchStation,
  inlineError
};
