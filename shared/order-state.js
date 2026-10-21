// shared/order-state.js · 订单七状态机 + 动作规则（唯一口径）
// 契约：docs/V4_CONTRACT.md v0.9 §5/§5.1/§5.3；docs/V4_DATA_MODEL.md §8.1~§8.5。
// 用途：云函数状态动作守卫（非法流转 → INVALID_TRANSITION）、事件类型落库、顾客进度条、
//       兼职工作台状态桶；本文件不写库、不含任何交易语义。
'use strict';

const enums = require('./enums');

const STATUS = enums.ORDER_STATUS;
const STATUS_LIST = enums.ORDER_STATUS_LIST;
const STATUS_TEXT = enums.ORDER_STATUS_TEXT;
const TERMINAL_STATUSES = [STATUS.COMPLETED, STATUS.CANCELLED];
const ACTIVE_STATUSES = enums.ORDER_ACTIVE_STATUSES;
// 顾客进度条五步（异常/取消分支单独展示，不在这条线上）
const PROGRESS_STEPS = enums.ORDER_PROGRESS_STEPS;

// 状态转移表（仅列"技术上允许"的下一状态；角色/守卫由 ACTION_RULES 与 canAct 再收紧）
const TRANSITIONS = {
  [STATUS.SUBMITTED]: [STATUS.ACCEPTED, STATUS.CANCELLED],
  [STATUS.ACCEPTED]: [STATUS.PICKED, STATUS.CANCELLED, STATUS.EXCEPTION],
  [STATUS.PICKED]: [STATUS.DELIVERED, STATUS.CANCELLED, STATUS.EXCEPTION],
  [STATUS.DELIVERED]: [STATUS.COMPLETED, STATUS.CANCELLED, STATUS.EXCEPTION],
  [STATUS.EXCEPTION]: [STATUS.ACCEPTED, STATUS.PICKED, STATUS.DELIVERED, STATUS.CANCELLED],
  [STATUS.COMPLETED]: [],
  [STATUS.CANCELLED]: []
};

// 动作规则：动作 → 允许起始状态 / 目标状态 / 事件 / 角色 / 是否改变状态
// to 取值：具体状态 | 'SAME'（不改状态）| 'UNDO'（按 UNDO_TARGETS 回退）| 'FROM_STATUS'（异常恢复）
const ACTION_RULES = {
  'order.create': {
    from: [], to: STATUS.SUBMITTED, event: 'ORDER_CREATED', roles: [enums.ROLES.CUSTOMER, enums.ROLES.PARTNER], changesStatus: true
  },
  'order.createBatch': {
    from: [], to: STATUS.SUBMITTED, event: 'ORDER_CREATED', roles: [enums.ROLES.CUSTOMER, enums.ROLES.PARTNER], changesStatus: true
  },
  'order.accept': {
    from: [STATUS.SUBMITTED], to: STATUS.ACCEPTED, event: 'ACCEPTED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.reject': {
    from: [STATUS.SUBMITTED], to: STATUS.CANCELLED, event: 'REJECTED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.markPicked': {
    from: [STATUS.ACCEPTED], to: STATUS.PICKED, event: 'PICKED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.unmarkPicked': {
    from: [STATUS.PICKED], to: STATUS.ACCEPTED, event: 'PICKED_REVERTED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.markDelivered': {
    from: [STATUS.PICKED], to: STATUS.DELIVERED, event: 'DELIVERED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.unmarkDelivered': {
    from: [STATUS.DELIVERED], to: STATUS.PICKED, event: 'DELIVERED_REVERTED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.reportException': {
    from: [STATUS.ACCEPTED, STATUS.PICKED, STATUS.DELIVERED], to: STATUS.EXCEPTION, event: 'EXCEPTION_REPORTED', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.resolveException': {
    from: [STATUS.EXCEPTION], to: 'FROM_STATUS', event: 'EXCEPTION_RESOLVED', roles: [enums.ROLES.PARTNER, enums.CANCELLED_BY.ADMIN], changesStatus: true
  },
  'order.cancel': {
    from: ACTIVE_STATUSES,
    to: STATUS.CANCELLED,
    event: 'CANCELLED',
    roles: [enums.ROLES.CUSTOMER, enums.ROLES.PARTNER, enums.CANCELLED_BY.ADMIN, enums.CANCELLED_BY.SYSTEM],
    changesStatus: true
  },
  'order.confirmDelivery': {
    from: [STATUS.DELIVERED], to: STATUS.COMPLETED, event: 'COMPLETED', roles: [enums.ROLES.CUSTOMER], changesStatus: true
  },
  'order.correct': {
    from: [STATUS.SUBMITTED, STATUS.ACCEPTED, STATUS.PICKED, STATUS.EXCEPTION], to: 'SAME', event: 'ORDER_CORRECTED', roles: [enums.ROLES.PARTNER], changesStatus: false
  },
  'order.undo': {
    from: [STATUS.PICKED, STATUS.DELIVERED], to: 'UNDO', event: 'UNDO', roles: [enums.ROLES.PARTNER], changesStatus: true
  },
  'order.deleteRecord': {
    from: [STATUS.COMPLETED], to: 'SAME', event: 'DELETED_BY_CUSTOMER', roles: [enums.ROLES.CUSTOMER], changesStatus: false
  },
  'cleanup.orderTimeout': {
    from: [STATUS.SUBMITTED], to: STATUS.CANCELLED, event: 'TIMEOUT_CANCELLED', roles: [enums.CANCELLED_BY.SYSTEM], changesStatus: true
  },
  'cleanup.autoComplete': {
    from: [STATUS.DELIVERED], to: STATUS.COMPLETED, event: 'AUTO_COMPLETED', roles: [enums.CANCELLED_BY.SYSTEM], changesStatus: true
  }
};

// order.undo 只覆盖 markPicked / markDelivered（接单不可撤销，误接单走 order.cancel）
const UNDO_TARGETS = {
  [STATUS.PICKED]: { to: STATUS.ACCEPTED, event: 'PICKED_REVERTED', undoneAction: 'order.markPicked' },
  [STATUS.DELIVERED]: { to: STATUS.PICKED, event: 'DELIVERED_REVERTED', undoneAction: 'order.markDelivered' }
};
const UNDO_WINDOW_MS = 5000;

// 异常恢复：只允许回到上报时的 fromStatus（ACCEPTED/PICKED/DELIVERED），否则回 ACCEPTED
const RESOLVE_ALLOWED_FROM = [STATUS.ACCEPTED, STATUS.PICKED, STATUS.DELIVERED];
const RESOLVE_FALLBACK_STATUS = STATUS.ACCEPTED;

// 一图多码拆单上限（CONTRACT §5.3 order.createBatch：≤5 单、单事务原子创建）
const MAX_CREATE_BATCH = 5;

function actionRule(action) {
  return ACTION_RULES[action] || null;
}

function isOrderStatus(status) {
  return STATUS_LIST.indexOf(status) !== -1;
}

function isTerminal(status) {
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.indexOf(status) !== -1;
}

function statusText(status) {
  return STATUS_TEXT[status] || '';
}

function progressIndex(status) {
  return PROGRESS_STEPS.indexOf(status);
}

function canTransition(fromStatus, toStatus) {
  const next = TRANSITIONS[fromStatus];
  if (!next) {
    return false;
  }
  return next.indexOf(toStatus) !== -1;
}

function resolveExceptionTo(exception) {
  const from = exception && exception.fromStatus;
  return RESOLVE_ALLOWED_FROM.indexOf(from) !== -1 ? from : RESOLVE_FALLBACK_STATUS;
}

// 目标状态解析：返回 '' 表示该动作不产生状态迁移
function nextStatus(action, fromStatus, order) {
  const rule = ACTION_RULES[action];
  if (!rule) {
    return '';
  }
  if (rule.to === 'SAME') {
    return fromStatus;
  }
  if (rule.to === 'UNDO') {
    const undo = UNDO_TARGETS[fromStatus];
    return undo ? undo.to : '';
  }
  if (rule.to === 'FROM_STATUS') {
    return resolveExceptionTo(order && order.exception);
  }
  return rule.to;
}

// 顾客取消条件（CONTRACT §5 / §5.1）：
// SUBMITTED/ACCEPTED 可取消；EXCEPTION 仅当异常上报自 SUBMITTED/ACCEPTED；PICKED/DELIVERED 不可单方取消
function canCustomerCancel(order) {
  if (!order) {
    return false;
  }
  const status = order.status;
  if (status === STATUS.SUBMITTED || status === STATUS.ACCEPTED) {
    return true;
  }
  if (status === STATUS.EXCEPTION) {
    const from = order.exception && order.exception.fromStatus;
    return from === STATUS.SUBMITTED || from === STATUS.ACCEPTED;
  }
  return false;
}

// 动作可行性：角色 + 起始状态 + 取消的角色差异（字段级限制在 handler 再校验，如 PICKED 仅柜号/运单尾号）
function canAct(action, fromStatus, role, order) {
  const rule = ACTION_RULES[action];
  if (!rule) {
    return false;
  }
  if (rule.roles.indexOf(role) === -1) {
    return false;
  }
  if (action === 'order.cancel') {
    if (role === enums.ROLES.CUSTOMER) {
      return canCustomerCancel(order || { status: fromStatus });
    }
    if (role === enums.CANCELLED_BY.SYSTEM) {
      return fromStatus === STATUS.SUBMITTED;
    }
    return isActiveStatus(fromStatus);
  }
  if (rule.from.indexOf(fromStatus) === -1) {
    return false;
  }
  if (action === 'order.undo' && !UNDO_TARGETS[fromStatus]) {
    return false;
  }
  return true;
}

module.exports = {
  STATUS,
  STATUS_LIST,
  STATUS_TEXT,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  PROGRESS_STEPS,
  TRANSITIONS,
  ACTION_RULES,
  UNDO_TARGETS,
  UNDO_WINDOW_MS,
  RESOLVE_ALLOWED_FROM,
  RESOLVE_FALLBACK_STATUS,
  MAX_CREATE_BATCH,
  actionRule,
  isOrderStatus,
  isTerminal,
  isActiveStatus,
  statusText,
  progressIndex,
  canTransition,
  resolveExceptionTo,
  nextStatus,
  canCustomerCancel,
  canAct
};
