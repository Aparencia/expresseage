// pkg-customer/parts/status-view.js · 订单状态视图适配（单一职责零件，零 wx）
// 状态/动作的单源 = 服务端 order DTO 的 status/statusText/actions[] + shared/order-state.js；
// 本零件只做展示适配（事件类型→人话、动作键→按钮、进度分支），页面层不出现七状态字面量（check #21）。
'use strict';

const state = require('../../shared/order-state');
const enums = require('../../shared/enums');

const STATUS = state.STATUS;
const STATUS_TEXT = state.STATUS_TEXT;
const PROGRESS_LABELS = ['下单', '已接单', '已取件', '已送达', '已完成'];

// 补码事件 marker：云端 cloudfunctions/api/handlers/order/correct.js 把补码事件 note 冻结为同一文案
// （task-66/67）；端侧凭 note 精确识别「NEED_CODE → OK」，首屏进入即已补码也能显示（不依赖前后翻变）。
const CODE_FILLED_NOTE = '兼职已补齐取件码';

// 事件类型 → 人话；状态类事件键用 orderState.STATUS 计算，避免页面/零件层再写一遍七状态字面量
const EVENT_TEXT = {
  ORDER_CREATED: '订单创建',
  REJECTED: '已拒单',
  PICKED_REVERTED: '撤销已取件',
  DELIVERED_REVERTED: '撤销已送达',
  AUTO_COMPLETED: '系统自动完成',
  TIMEOUT_CANCELLED: '超时未接单，系统取消',
  EXCEPTION_REPORTED: '异常上报',
  EXCEPTION_RESOLVED: '异常已解除',
  ORDER_CORRECTED: '兼职更正了订单信息',
  DELETED_BY_CUSTOMER: '顾客删除记录',
  GUEST_ORDER_CLAIMED: '代客单已认领'
};
EVENT_TEXT[STATUS.ACCEPTED] = state.statusText(STATUS.ACCEPTED);
EVENT_TEXT[STATUS.PICKED] = state.statusText(STATUS.PICKED);
EVENT_TEXT[STATUS.DELIVERED] = state.statusText(STATUS.DELIVERED);
EVENT_TEXT[STATUS.COMPLETED] = state.statusText(STATUS.COMPLETED);
EVENT_TEXT[STATUS.CANCELLED] = state.statusText(STATUS.CANCELLED);

// 七状态说明文案（UX §5.1）；终态/异常分支在 statusDesc 里按 DTO 字段拼
const STATUS_DESC = {
  [STATUS.SUBMITTED]: '已提交，等待兼职接单',
  [STATUS.ACCEPTED]: '兼职已接单，正在安排取件',
  [STATUS.PICKED]: '兼职已取到快递，正在送来',
  [STATUS.DELIVERED]: '兼职已送达，请确认收到',
  [STATUS.COMPLETED]: '订单已完成'
};

// 顾客动作键（服务端 actions[] 的唯一消费集合；不含按下标猜的本地规则）
const ACTION_KEYS = ['cancel', 'message', 'confirm', 'deleteRecord', 'reorder'];
// 按钮兜底中文：正常取服务端 actions[].label（单一判据），缺失时才用这份静态文案
const ACTION_FALLBACK_LABEL = {
  cancel: '取消订单',
  message: '联系兼职',
  confirm: '确认已收到',
  deleteRecord: '删除这条记录',
  reorder: '再次下单'
};

// 进度回退/纠正/异常解除的顶部提示条（UX §5.5；按最近一条相关事件展示）
const NOTICE_EVENT_TEXT = {
  PICKED_REVERTED: '兼职更正了取件状态：已退回「已取件」。',
  DELIVERED_REVERTED: '兼职更正了送达状态：订单回到配送中。',
  ORDER_CORRECTED: '兼职更正了订单信息',
  EXCEPTION_RESOLVED: '异常已解除，订单继续处理'
};

function statusText(status) {
  return state.statusText(status) || '';
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 服务端事件 DTO：{type,at,actorRole,note}（无 toStatus/id）
// 补码场景两条路径：①云端 note === CODE_FILLED_NOTE（首屏/翻变都可见，单一判据）；
// ②旧轮询翻变 context.codeFilled=true（兼容保留，无 note 的历史事件仍能显示为补码）。
function eventText(event, context) {
  const item = event || {};
  const type = textOf(item.type);
  const note = textOf(item.note);
  if (type === 'ORDER_CORRECTED' && note === CODE_FILLED_NOTE) return CODE_FILLED_NOTE;
  const base = type === 'ORDER_CORRECTED' && context && context.codeFilled === true
    ? CODE_FILLED_NOTE
    : (EVENT_TEXT[type] || type);
  if (!base) return note;
  if (!note || base === note) return base;
  return base + '：' + note;
}

// 服务端下发的动作条：actions[] = [{key,label}]；页面只按 key 决定按钮显隐
function hasAction(order, key) {
  const actions = order && Array.isArray(order.actions) ? order.actions : [];
  for (let i = 0; i < actions.length; i += 1) {
    if (actions[i] && actions[i].key === key) return true;
  }
  return false;
}

/**
 * 动作视图：只消费服务端 actions[]（单一判据），不再按本地状态机猜按钮。
 * READONLY 会话隐藏全部写按钮，只留提示文案。
 */
function actionsView(order, readonly) {
  const out = { labels: {}, readonly: readonly === true, hint: readonly === true ? '开发者只读视角不能操作。' : '' };
  ACTION_KEYS.forEach(function init(key) {
    out[key] = false;
    out.labels[key] = ACTION_FALLBACK_LABEL[key];
  });
  if (readonly === true) {
    return out;
  }
  const list = order && Array.isArray(order.actions) ? order.actions : [];
  list.forEach(function each(item) {
    const key = textOf(item && item.key);
    if (ACTION_KEYS.indexOf(key) < 0) return;
    out[key] = true;
    const label = textOf(item.label);
    if (label) out.labels[key] = label;
  });
  return out;
}

function isTerminal(status) {
  return state.isTerminal(status);
}

function isStatus(status, expected) {
  return status === expected;
}

function canCancel(order) {
  return state.canCustomerCancel(order);
}

function canConfirmDelivery(order) {
  return !!order && isStatus(order.status, STATUS.DELIVERED);
}

function canDeleteRecord(order) {
  return !!order && isStatus(order.status, STATUS.COMPLETED) && !order.deletedByCustomerAt;
}

function canMessage(order) {
  const status = order && order.status;
  if (!status) return false;
  return !state.isTerminal(status) || isStatus(status, STATUS.COMPLETED);
}

// 订单截图：服务端 DTO 只给 image {hasImage, cleaned}（fileId 不落客户端列表 DTO）
function canViewImage(order) {
  if (!order) return false;
  if (order.image && order.image.cleaned === true) return false;
  if (order.image && order.image.hasImage === true) return true;
  return !!(order.image && order.image.fileId);
}

/**
 * 截图卡状态：可看 / 已清理 / 无图（加载失败与临时链接失效是运行时结果，见 imageErrorText）。
 * @returns {{state:string, canView:boolean, text:string}}
 */
function imageView(order) {
  const image = (order && order.image) || {};
  if (image.cleaned === true) {
    return { state: 'CLEANED', canView: false, text: '截图已按隐私策略删除（订单完成/取消 7 天后）' };
  }
  if (image.hasImage === true) {
    return { state: 'AVAILABLE', canView: true, text: '查看截图' };
  }
  return { state: 'NONE', canView: false, text: '这条订单没有截图' };
}

/** 截图取临时 URL 失败的人话：已清理（NOT_FOUND 带服务端文案）/ 过期 / 网络失败 */
function imageErrorText(code, message) {
  const text = textOf(message);
  const normalized = textOf(code);
  if (normalized === 'NOT_FOUND') {
    return text || '截图已过期，点这里重新加载';
  }
  return text || '截图加载失败，点这里重试';
}

function cancelReasons() {
  return (enums.CANCEL_REASONS.CUSTOMER || []).map(function map(item) {
    return { code: item.code, label: item.text };
  });
}

function progressSteps(order) {
  const status = order && order.status;
  const current = state.progressIndex(status);
  return PROGRESS_LABELS.map(function map(label, index) {
    let stepState = 'future';
    if (current >= 0) {
      if (index < current) stepState = 'done';
      else if (index === current) stepState = 'current';
    } else if (index === 0) {
      stepState = 'done';
    }
    return { label: label, state: stepState };
  });
}

/**
 * 进度条视图（UX §5.1/§5.2）：五节点 done/current/future；
 * EXCEPTION → 上报来源节点标红 + exception.text 分支；CANCELLED → 节点置灰 + 取消原因分支。
 * @returns {{steps:object[], mode:string, branchLabel:string, branchText:string}}
 */
function progressView(order) {
  const steps = progressSteps(order);
  const status = order && order.status;
  if (isStatus(status, STATUS.CANCELLED)) {
    const reason = textOf(order.cancelReasonText) || textOf(order.cancelReason);
    return {
      steps: steps.map(function map(step) { return { label: step.label, state: 'cancelled' }; }),
      mode: 'cancelled',
      branchLabel: '✕ 已取消',
      branchText: reason || '订单已取消'
    };
  }
  if (isStatus(status, STATUS.EXCEPTION)) {
    const exception = (order && order.exception) || {};
    const fromStatus = textOf(exception.fromStatus);
    const index = state.progressIndex(fromStatus);
    const at = index >= 0 ? index : 0;
    return {
      steps: steps.map(function map(step, i) {
        if (i < at) return { label: step.label, state: 'done' };
        if (i === at) return { label: step.label, state: 'exception' };
        return { label: step.label, state: 'future' };
      }),
      mode: 'exception',
      branchLabel: textOf(exception.codeText),
      branchText: textOf(exception.text) || '兼职正在处理这条订单的异常，请留意留言。'
    };
  }
  return { steps: steps, mode: 'normal', branchLabel: '', branchText: '' };
}

/** 七状态说明文案（终态/异常按 DTO 字段拼；不做本地状态机判断） */
function statusDesc(order) {
  if (!order) return '';
  const status = order.status;
  if (isStatus(status, STATUS.CANCELLED)) {
    const reason = textOf(order.cancelReasonText) || textOf(order.cancelReason);
    return reason ? '订单已取消：' + reason : '订单已取消';
  }
  if (isStatus(status, STATUS.EXCEPTION)) {
    const exception = order.exception || {};
    const why = textOf(exception.text) || textOf(exception.codeText);
    return why ? why + '（兼职正在处理）' : '兼职正在处理这条订单的异常，请留意留言。';
  }
  return STATUS_DESC[status] || '';
}

/** 取件码展示：码 / 需查明 / 仅尾号 / 空 */
function pickupCodeText(order) {
  const parcel = (order && order.parcel) || {};
  if (parcel.codeStatus === enums.CODE_STATUS.NEED_CODE) return '需查明（兼职正在查码）';
  const code = textOf(parcel.pickupCode);
  if (code) return code;
  const tail = textOf(parcel.trackingTail);
  return tail ? '尾号 ' + tail : '—';
}

/** 不可取消时的引导（AC-C-24/UX §3.8）：已取件起不能单方取消，给下一步而不是死路 */
function cancelGuide(order, readonly) {
  if (!order || readonly === true || hasAction(order, 'cancel')) return '';
  const status = order.status;
  if (isStatus(status, STATUS.PICKED) || isStatus(status, STATUS.DELIVERED)) {
    return '已取件的订单不能直接取消，可以留言和兼职协商，或等异常处理。';
  }
  if (isStatus(status, STATUS.EXCEPTION)) {
    return '这条订单的异常正在处理中，可以留言或等兼职处理结果。';
  }
  return '';
}

/** 留言区：始终展示列表；输入框只在 DTO 有 message 动作时出现；已完成只读归档提示 */
function messageView(order, readonly) {
  const inputVisible = readonly !== true && hasAction(order, 'message');
  let archiveText = '';
  if (!inputVisible && order && isStatus(order.status, STATUS.COMPLETED)) {
    archiveText = '订单已完成，留言已归档（只读）';
  }
  return { inputVisible: inputVisible, archiveText: archiveText };
}

/**
 * 顶部提示条（UX §5.5）：取最近一条回退/纠正/异常解除事件；没有则空串。
 * 最近一条 ORDER_CORRECTED 的 note === CODE_FILLED_NOTE → 补码核对引导（首屏即已补码也可见）。
 * @returns {{type:string, text:string}}
 */
function noticeText(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i] || {};
    const type = textOf(item.type);
    const base = NOTICE_EVENT_TEXT[type];
    if (!base) continue;
    const note = textOf(item.note);
    if (type === 'ORDER_CORRECTED') {
      if (note === CODE_FILLED_NOTE) {
        return { type: type, text: CODE_FILLED_NOTE + '，请核对最新取件码。' };
      }
      return { type: type, text: note ? base + '（' + note + '）' : '兼职更正了订单信息，请核对最新取件信息。' };
    }
    return { type: type, text: base };
  }
  return { type: '', text: '' };
}

/** NEED_CODE → OK 的补码翻变（配合 ORDER_CORRECTED 事件显示「兼职已补齐取件码」） */
function codeFilledTransition(previousNeedCode, order) {
  if (previousNeedCode !== true) return false;
  return !!order && order.needCode === false;
}

/**
 * 时间线事件 DTO → 展示项（id/type/text/at）；codeFilled 只作用于最近一条 ORDER_CORRECTED。
 * 格式化的 time 由调用方补（零件不依赖时间格式实现）。
 */
function buildEvents(events, options) {
  const opts = options || {};
  const list = Array.isArray(events) ? events : [];
  let latestCorrected = -1;
  list.forEach(function scan(item, index) {
    if (item && item.type === 'ORDER_CORRECTED') latestCorrected = index;
  });
  return list.map(function map(item, index) {
    const event = item || {};
    const context = { codeFilled: opts.codeFilled === true && index === latestCorrected };
    return {
      id: (textOf(event.type) || 'EVENT') + '@' + (textOf(event.at) || index),
      type: textOf(event.type),
      at: textOf(event.at),
      text: eventText(event, context),
      note: textOf(event.note)
    };
  });
}

function waitingHint(order, config, format) {
  if (!order || !config) return '';
  if (isStatus(order.status, STATUS.SUBMITTED)) {
    const minutes = Number(config.orderTimeoutMinutes) || 0;
    if (minutes <= 0) return '等待接单，超时将自动取消';
    // statusUpdatedAt 是真实 DTO 的 ISO 字符串：先按原样解析，再兼容老格式
    const raw = typeof order.statusUpdatedAt === 'number'
      ? order.statusUpdatedAt
      : Date.parse(order.statusUpdatedAt || '');
    const base = isNaN(raw) ? 0 : raw;
    if (!base) return '等待接单，超时将自动取消';
    const deadline = new Date(base + minutes * 60000);
    return '等待接单，超时将自动取消（截止 ' + format.formatDateTime(deadline) + '）';
  }
  if (isStatus(order.status, STATUS.DELIVERED)) {
    const hours = Number(config.autoCompleteHours) || 0;
    return hours > 0 ? '送达 ' + hours + ' 小时后未操作将自动完成' : '待你确认收到';
  }
  return '';
}

module.exports = {
  STATUS,
  STATUS_TEXT,
  ACTION_KEYS,
  NOTICE_EVENT_TEXT,
  EVENT_TEXT,
  statusText,
  eventText,
  hasAction,
  actionsView,
  isTerminal,
  canCancel,
  canConfirmDelivery,
  canDeleteRecord,
  canMessage,
  canViewImage,
  imageView,
  imageErrorText,
  cancelReasons,
  progressSteps,
  progressView,
  statusDesc,
  pickupCodeText,
  messageView,
  cancelGuide,
  noticeText,
  codeFilledTransition,
  buildEvents,
  waitingHint
};
