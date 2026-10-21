// pkg-partner/pages/order-detail/parts/actions.js · 动作注册表（可见性 100% 由服务端 order.actions[] 决定）
// 契约：docs/V4_UX_PARTNER.md §3.3 状态动作矩阵 / §6.3 只读矩阵；docs/V4_DATA_MODEL.md §7.5 order.get
// 边界：本文件不判断七状态（服务端按状态机下发 actions）；页面只渲染、只做交互元数据（面板/确认框/危险色）。
const orderState = require('../../../../shared/order-state');

// 兼职端可执行动作白名单：key → 面板/确认框/颜色。label 一律优先取服务端 label（见 buildVisibleActions）。
const ACTIONS = {
  accept: {
    label: '接单',
    confirmText: '确认接单？顾客会看到进度到「已接单」。'
  },
  reject: {
    label: '拒单',
    panel: 'reason',
    danger: true
  },
  pick: {
    label: '标记已取件',
    confirmText: '确认已取到件？顾客会看到进度到「已取件·配送中」。'
  },
  undoPick: {
    label: '撤销已取件',
    confirmText: '撤销后订单回到「已接单」，顾客会看到进度回退。'
  },
  deliver: {
    label: '标记已送达',
    panel: 'deliver'
  },
  undoDeliver: {
    label: '撤销已送达',
    confirmText: '撤销后订单回到「已取件」，顾客会看到进度回退。'
  },
  exception: {
    label: '上报异常',
    panel: 'exception'
  },
  resolve: {
    label: '解除异常',
    confirmText: '确认已恢复？顾客会看到进度恢复。'
  },
  correct: {
    label: '改取件码',
    panel: 'correct'
  },
  cancel: {
    label: '取消订单',
    panel: 'reason',
    danger: true
  },
  message: {
    label: '留言',
    panel: 'message'
  }
};

const ACTION_KEYS = Object.keys(ACTIONS);

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 服务端动作可容忍字符串形态（旧 DTO）与对象形态 {key,label}；其余一律丢弃
function normalizeServerAction(item) {
  if (typeof item === 'string') {
    return { key: textOf(item), label: '' };
  }
  if (item && typeof item === 'object') {
    const key = textOf(item.key);
    if (!key) {
      return null;
    }
    return { key: key, label: textOf(item.label) };
  }
  return null;
}

// 只读会话（READONLY）：前端置灰 + 点击只 toast，不发请求；服务端仍会二次拒绝
function buildVisibleActions(order, options) {
  const opts = options || {};
  const readonly = opts.readonly === true;
  const list = order && Array.isArray(order.actions) ? order.actions : [];
  const result = [];
  list.forEach((item) => {
    const normalized = normalizeServerAction(item);
    if (!normalized) {
      return;
    }
    const def = ACTIONS[normalized.key];
    // 未知 key 忽略（服务端新增动作时老页面不误渲染、不猜行为）
    if (!def) {
      return;
    }
    result.push({
      key: normalized.key,
      // 文案单源 = 服务端 ACTION_LABELS；缺失时用本地兜底（同语义）
      label: normalized.label || def.label,
      panel: def.panel || '',
      confirmText: def.confirmText || '',
      danger: def.danger === true,
      write: true,
      disabled: readonly,
      readonlyHint: readonly ? '开发者只读视角不能操作' : ''
    });
  });
  return result;
}

function findAction(actions, key) {
  const list = Array.isArray(actions) ? actions : [];
  return list.filter((item) => item && item.key === key)[0] || null;
}

function hasAction(actions, key) {
  return !!findAction(actions, key);
}

// 撤销条只认服务端 actions 里的 undoPick / undoDeliver（5 秒窗由服务端 withinUndoWindow 判定）
function undoTargetKeys(actions) {
  const keys = [];
  if (hasAction(actions, 'undoPick')) {
    keys.push('undoPick');
  }
  if (hasAction(actions, 'undoDeliver')) {
    keys.push('undoDeliver');
  }
  return keys;
}

function isWriteKey(key) {
  return ACTION_KEYS.indexOf(key) !== -1;
}

// 解除异常的目标状态文案按服务端 DTO 的 exception.fromStatus 渲染（不本地猜状态）
function resolveTargetText(order) {
  const target = orderState.resolveExceptionTo((order && order.exception) || {});
  return orderState.statusText(target);
}

module.exports = {
  ACTIONS,
  ACTION_KEYS,
  normalizeServerAction,
  buildVisibleActions,
  findAction,
  hasAction,
  undoTargetKeys,
  isWriteKey,
  resolveTargetText
};
