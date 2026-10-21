// pkg-partner/pages/order-detail/parts/actions.js · 动作注册表（可见性完全由服务端 order.actions 决定，页面不判断七状态）
const ACTIONS = {
  accept: {
    label: '接单',
    confirmText: '确认接单？顾客会看到进度到「已接单」。'
  },
  reject: {
    label: '拒单',
    needReason: true,
    danger: true
  },
  pick: {
    label: '已取件',
    confirmText: '确认已取到件？顾客会看到进度到「已取件·配送中」。',
    undoable: true
  },
  undoPick: {
    label: '撤销已取件',
    confirmText: '撤销后订单回到「已接单」，顾客会看到进度回退。',
    undoable: true
  },
  deliver: {
    label: '标记送达',
    confirmText: '确认已送达？顾客会看到进度到「已送达·待确认」。',
    undoable: true
  },
  undoDeliver: {
    label: '撤销已送达',
    confirmText: '撤销后订单回到「已取件」，顾客会看到进度回退。'
  },
  exception: {
    label: '异常上报',
    panel: 'exception'
  },
  resolve: {
    label: '解除异常',
    confirmText: '确认已恢复？顾客会看到进度恢复。'
  },
  correct: {
    label: '改码/改站点',
    panel: 'code'
  },
  cancel: {
    label: '取消订单',
    needReason: true,
    danger: true
  },
  message: {
    label: '留言',
    panel: 'message'
  }
};

function normalizeServerItem(item) {
  if (typeof item === 'string') {
    return { key: item, label: '' };
  }
  if (item && typeof item === 'object' && typeof item.key === 'string') {
    return { key: item.key, label: typeof item.label === 'string' ? item.label : '' };
  }
  return null;
}

function buildVisibleActions(order, readonly) {
  const list = order && Array.isArray(order.actions) ? order.actions : [];
  const result = [];
  list.forEach((item) => {
    const normalized = normalizeServerItem(item);
    if (!normalized) {
      return;
    }
    const def = ACTIONS[normalized.key];
    if (!def) {
      return;
    }
    result.push({
      key: normalized.key,
      label: normalized.label || def.label,
      danger: !!def.danger,
      disabled: !!readonly,
      panel: def.panel || '',
      confirmText: def.confirmText || '',
      undoable: !!def.undoable,
      needReason: !!def.needReason
    });
  });
  return result;
}

module.exports = {
  ACTIONS,
  buildVisibleActions,
  normalizeServerItem
};
