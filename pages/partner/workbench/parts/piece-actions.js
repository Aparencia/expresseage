// pages/partner/workbench/parts/piece-actions.js · 件级取件动作纯件（零 wx，调用由页面注入）
// 口径：CONTRACT §5/§5.1（D61：`order.markPicked`/`order.unmarkPicked` 带 `itemIndex`；逐件取件/撤销
//       **不弹二次确认**、**不提供 5 秒撤销条**，每件行尾用「撤销已取」按钮回退）；
//       UX_PARTNER §4.3/§4.16（每件行尾独立「已取件/撤销已取」，只消费服务端 `parcel.actions`）。
// 纪律：动作可见性 100% 来自服务端 `parcel.actions[]`；本文件只把动作键翻译成文案/请求方法，
//       不判断订单七状态、不派生「能不能取」（那是服务端 DTO 的职责）。
'use strict';

const ACTIONS = {
  markPicked: { key: 'markPicked', label: '已取件', method: 'markPicked', picked: true },
  unmarkPicked: { key: 'unmarkPicked', label: '撤销已取', method: 'unmarkPicked', picked: false }
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function keysOf(piece) {
  const list = piece && Array.isArray(piece.actions) ? piece.actions : [];
  const keys = [];
  list.forEach((entry) => {
    const key = typeof entry === 'string' ? entry : textOf(entry && entry.key);
    if (key && !keys.some((item) => item === key)) {
      keys.push(key);
    }
  });
  return keys;
}

// 件动作视图：READONLY/终态（服务端 actions 为空）一律返回 null（wxml 不渲染写按钮）
function viewOf(piece, readonly) {
  if (readonly) {
    return null;
  }
  const key = keysOf(piece).filter((item) => ACTIONS[item])[0];
  if (!key) {
    return null;
  }
  return { key: key, label: ACTIONS[key].label, method: ACTIONS[key].method };
}

// 请求构造：逐件写必须带 itemIndex（首件 0 也传，与整单动作区分）；统一带幂等键与乐观锁版本
function writeOf(key, piece, orderNo, version, clientRequestId) {
  const meta = ACTIONS[key];
  if (!meta) {
    return null;
  }
  const index = piece && typeof piece.index === 'number' && piece.index >= 0 ? piece.index : 0;
  const opts = {};
  if (typeof version === 'number' && isFinite(version) && version > 0) {
    opts.expectedVersion = version;
  }
  if (textOf(clientRequestId)) {
    opts.clientRequestId = textOf(clientRequestId);
  }
  return {
    key: key,
    method: meta.method,
    payload: { orderNo: textOf(orderNo), itemIndex: index },
    opts: opts
  };
}

// 免二次确认的成功 toast（带件号，说清顾客端同步）
function toastOf(key, piece) {
  const meta = ACTIONS[key];
  if (!meta) {
    return '已更新';
  }
  const indexText = textOf(piece && piece.indexText);
  if (meta.picked) {
    return indexText ? indexText + '已取件' : '已标记取件';
  }
  return indexText ? indexText + '已撤销已取' : '已撤销已取件';
}

module.exports = {
  viewOf,
  writeOf,
  toastOf
};
