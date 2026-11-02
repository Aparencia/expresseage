// pkg-partner/pages/order-detail/parts/transfer.js · 订单详情「转派」纯件（D58）
// 口径：CONTRACT §13 D58 / 草案 §1.3~§1.4；UX_PARTNER §3.3（订单详情动作区）与 §4.12（红点）。
//   · 发起入口可见性只看服务端 DTO actions[] 是否含转派请求动作（页面零状态判据、不判订单状态）；
//   · 邀请/等待/结果三态由服务端下发的 order.transfer 块（白名单键，无 statusText）+ shared 枚举中文单源渲染；
//   · 剩余分钟、编号归一、二次确认/disclaimer 文案全部在本零件（页面只渲染与转发请求）。
// 键名单源 = parts/actions.js 的动作注册表（服务端 DTO 用短键 requestTransfer/acceptTransfer/...）。
// 边界：不生成编号、不直连 client、不出现 openid/内部 id（只用 partnerNo 快照）。
'use strict';

const enums = require('../../../../shared/enums');
const actionsPart = require('./actions');

const MINUTE_MS = 60 * 1000;
const INPUT_MAX = 16; // 输入框长度上限（含用户误加的连字符/空格；归一后才是 7 位编号）
// 转派动作键：服务端 DTO actions[] 用短键（与 accept/pick 同形）；兼容注册表全名形态
const TRANSFER_KEYS = {
  request: 'requestTransfer',
  accept: 'acceptTransfer',
  decline: 'declineTransfer',
  cancel: 'cancelTransfer'
};
const KINDS = Object.keys(TRANSFER_KEYS);
const SUCCESS_TEXT = {
  request: '已发起转派，等待对方确认',
  accept: '已接收转派，这单由你处理',
  decline: '已拒收，订单仍在对方名下',
  cancel: '已撤回，订单仍由你处理'
};
const COPY = {
  requestText: '一件还没取时，可以把这一单转给另一位兼职；对方确认后由 TA 接手，这单会从你的列表消失。',
  requestPanelHint: '输入对方完整兼职编号（P 开头，可带连字符）。转派后你将失去该单，对方确认前可撤回。',
  requestPlaceholder: '如 P-8F3-K2M',
  nextText: '下一步',
  readonly: '开发者只读视角不能操作',
  expiredInvite: '邀请已过期，刷新页面后查看最新状态',
  expiredWaiting: '邀请已过期，刷新后这单仍在你的列表里',
  emptyInput: '请先填对方的完整兼职编号',
  retryHint: '如仍要转派，可以重新发起。',
  fromHead: '来自 ',
  fromTail: ' 的转派邀请',
  waitingHead: '等待对方确认（',
  waitingTail: '）',
  targetHead: '转给 ',
  acceptedHead: '已转派：由 ',
  acceptedTail: ' 接手履约'
};

function namesOf(kind) {
  const key = TRANSFER_KEYS[kind];
  return key ? [key, 'order.' + key] : [];
}

function keyOf(action) {
  if (typeof action === 'string') {
    return action;
  }
  return (action && action.key) || '';
}

// 注册表兜底文案（服务端 label 优先；与 actions.js 同源，不另写一套）
function fallbackLabelOf(kind) {
  const def = actionsPart.ACTIONS[TRANSFER_KEYS[kind]];
  return (def && def.label) || '';
}

// 毫秒归一：DTO transfer 的时间字段是 ISO 字符串（_dto.isoOf），兼容毫秒数字
function msOf(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string' || !value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return isFinite(parsed) ? parsed : 0;
}

// 「剩余 N 分钟」：过期返回状态中文单源里的过期文案（服务端应已惰性落 EXPIRED；此分支是展示兜底）
function remainingText(expiresAt, nowMs) {
  const expires = msOf(expiresAt);
  const now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
  if (!expires) {
    return '';
  }
  const leftMs = expires - now;
  if (leftMs <= 0) {
    return enums.TRANSFER_STATUS_TEXT[enums.TRANSFER_STATUS.EXPIRED] || '';
  }
  return '剩余 ' + Math.max(1, Math.ceil(leftMs / MINUTE_MS)) + ' 分钟';
}

function transferOf(order) {
  return (order && order.transfer) || null;
}

// 编号归一：去空白/连字符、大写（显示用带连字符，服务端只收 7 位本体）；
// 本地只拦「空输入」，形态是否合法交给服务端（页面零业务判据）
function normalizePartnerNo(value) {
  return String(value || '').replace(/[\s-]/g, '').toUpperCase();
}

function inputOf(value) {
  const toPartnerNo = normalizePartnerNo(value);
  if (!toPartnerNo) {
    return { ok: false, toPartnerNo: '', message: COPY.emptyInput };
  }
  return { ok: true, toPartnerNo: toPartnerNo, message: '' };
}

function actionOf(actions, kind) {
  const names = namesOf(kind);
  const list = Array.isArray(actions) ? actions : [];
  for (let i = 0; i < list.length; i += 1) {
    if (names.indexOf(keyOf(list[i])) >= 0) {
      return list[i];
    }
  }
  return null;
}

function isTransferAction(action) {
  const key = keyOf(action);
  return KINDS.some((kind) => namesOf(kind).indexOf(key) >= 0);
}

// 底部动作条 = 非转派动作；转派四动作由本区块/面板承载（不重复出按钮）
function splitActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  return {
    status: list.filter((action) => !isTransferAction(action)),
    transfer: list.filter((action) => isTransferAction(action))
  };
}

function labelOf(action, kind) {
  return (action && typeof action.label === 'string' && action.label) || fallbackLabelOf(kind);
}

function fromTextOf(transfer) {
  const fromPartnerNo = (transfer && transfer.fromPartnerNo) || '';
  return fromPartnerNo ? COPY.fromHead + fromPartnerNo + COPY.fromTail : '';
}

// 结果态中文：ACCEPTED 带接手人编号（与顾客侧同口径只看编号，不看昵称头像）
function resultTextOf(transfer) {
  const item = transfer || {};
  if (item.status === enums.TRANSFER_STATUS.ACCEPTED) {
    return item.toPartnerNo
      ? COPY.acceptedHead + item.toPartnerNo + COPY.acceptedTail
      : (enums.TRANSFER_STATUS_TEXT[item.status] || '');
  }
  return enums.TRANSFER_STATUS_TEXT[item.status] || '';
}

function waitingTitleOf(remaining) {
  return COPY.waitingHead + (remaining || '') + COPY.waitingTail;
}

function requestPanel() {
  return {
    title: fallbackLabelOf('request'),
    hint: COPY.requestPanelHint,
    placeholder: COPY.requestPlaceholder,
    maxLength: INPUT_MAX,
    nextText: COPY.nextText
  };
}

function requestConfirmOf(partnerNo) {
  const target = String(partnerNo || '');
  return {
    title: '确认转派',
    content: target
      ? '转给 ' + target + '：对方确认后由 TA 接手，这单会从你的列表消失（确认前可撤回）。'
      : '转派后你将失去该单，对方确认前可撤回。',
    confirmText: '确认转派'
  };
}

function declineConfirmOf() {
  return {
    title: '拒收转派',
    content: '拒收后本次邀请失效，订单仍在对方名下；需要你接手请让对方重新发起。',
    confirmText: '拒收'
  };
}

function cancelConfirmOf() {
  return {
    title: '撤回转派',
    content: '撤回后对方不能再确认，订单仍由你处理；如仍要转派可以重新发起。',
    confirmText: '撤回'
  };
}

function successTextOf(kind) {
  return SUCCESS_TEXT[kind] || '';
}

function closedCard() {
  return {
    visible: false,
    request: { visible: false, title: '', hint: '', actionText: '', readonlyHint: '' },
    invite: { visible: false, title: '', remainingText: '', hint: '', accept: null, decline: null },
    waiting: { visible: false, title: '', targetText: '', hint: '', cancel: null },
    result: { visible: false, text: '', hint: '' }
  };
}

// 发起入口：只看 DTO actions[]（不判状态）；READONLY 只保留说明不出按钮
function buildRequestOf(requestAction, pending) {
  const visible = !!requestAction && !pending;
  if (!visible) {
    return { visible: false, title: '', hint: '', actionText: '', readonlyHint: '' };
  }
  return {
    visible: true,
    title: fallbackLabelOf('request'),
    hint: COPY.requestText,
    actionText: labelOf(requestAction, 'request'),
    readonlyHint: COPY.readonly
  };
}

// 目标兼职视角邀请卡：服务端 actions 含 accept/decline 才出按钮；过期/只读转只读提示
function buildInviteOf(transfer, actions, expired, readonly, nowMs) {
  const acceptAction = actionOf(actions, 'accept');
  const declineAction = actionOf(actions, 'decline');
  if (!acceptAction && !declineAction) {
    return null;
  }
  const locked = expired || readonly;
  return {
    visible: true,
    title: fromTextOf(transfer),
    remainingText: remainingText(transfer && transfer.expiresAt, nowMs),
    hint: expired ? COPY.expiredInvite : (readonly ? COPY.readonly : ''),
    accept: locked ? null : acceptAction,
    decline: locked ? null : declineAction
  };
}

// 发起方视角等待卡：服务端 actions 含 cancel 才出「撤回转派」；其余视图给中性等待文案
function buildWaitingOf(transfer, actions, expired, readonly, nowMs) {
  const cancelAction = actionOf(actions, 'cancel');
  const remaining = remainingText(transfer && transfer.expiresAt, nowMs);
  const locked = expired || readonly;
  return {
    visible: true,
    title: waitingTitleOf(remaining),
    targetText: transfer && transfer.toPartnerNo ? COPY.targetHead + transfer.toPartnerNo : '',
    hint: expired ? COPY.expiredWaiting : (readonly ? COPY.readonly : ''),
    cancel: locked ? null : cancelAction
  };
}

function cardOf(order, actions, options) {
  const opts = options || {};
  const readonly = opts.readonly === true;
  const nowMs = typeof opts.nowMs === 'number' && isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const transfer = transferOf(order);
  const pending = !!transfer && transfer.status === enums.TRANSFER_STATUS.PENDING;
  const expired = pending ? msOf(transfer && transfer.expiresAt) <= nowMs : false;
  const request = buildRequestOf(actionOf(actions, 'request'), pending);
  let invite = null;
  let waiting = null;
  if (pending) {
    invite = buildInviteOf(transfer, actions, expired, readonly, nowMs);
    if (!invite) {
      waiting = buildWaitingOf(transfer, actions, expired, readonly, nowMs);
    }
  }
  const resultText = transfer && !pending ? resultTextOf(transfer) : '';
  const card = closedCard();
  const result = {
    visible: !!resultText,
    text: resultText,
    hint: resultText && request.visible ? COPY.retryHint : ''
  };
  card.visible = request.visible || !!invite || !!waiting || result.visible;
  card.request = request;
  card.invite = invite || card.invite;
  card.waiting = waiting || card.waiting;
  card.result = result;
  // 本区块实际渲染出的转派动作键（页面零丢失：对账用；顺序与服务端 actions[] 中的转派键一致）
  card.keys = [];
  if (request.visible) {
    card.request.action = actionOf(actions, 'request');
    card.keys.push(keyOf(card.request.action));
  }
  if (card.invite.accept) {
    card.keys.push(keyOf(card.invite.accept));
  }
  if (card.invite.decline) {
    card.keys.push(keyOf(card.invite.decline));
  }
  if (card.waiting.cancel) {
    card.keys.push(keyOf(card.waiting.cancel));
  }
  return card;
}

module.exports = {
  INPUT_MAX,
  TRANSFER_KEYS,
  normalizePartnerNo,
  inputOf,
  splitActions,
  isTransferAction,
  remainingText,
  resultTextOf,
  cardOf,
  closedCard,
  requestPanel,
  requestConfirmOf,
  declineConfirmOf,
  cancelConfirmOf,
  successTextOf
};
