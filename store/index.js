// store/index.js · 全局内存快照 + 订阅（唯一全局状态；不落盘、不存 L3 敏感值）
const listeners = [];

const state = {
  roles: [],
  activeRole: null,
  isDeveloper: false,
  me: null,
  customer: null,
  partner: null,
  binding: null,
  config: null,
  badges: { workbenchPending: 0, messages: 0 },
  viewContext: null,
  serverTimeSkew: 0
};

function clone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function snapshot() {
  return clone(state);
}

function get(key) {
  return state[key];
}

function notify() {
  const snap = snapshot();
  listeners.slice().forEach((fn) => {
    try {
      fn(snap);
    } catch (err) {
      // 订阅方异常不影响其他订阅方
    }
  });
}

function set(key, value) {
  state[key] = value;
  notify();
}

function patch(partial) {
  Object.keys(partial || {}).forEach((key) => {
    state[key] = partial[key];
  });
  notify();
}

function subscribe(fn) {
  if (typeof fn !== 'function') {
    return function noop() {};
  }
  listeners.push(fn);
  return function unsubscribe() {
    const index = listeners.indexOf(fn);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

function hydrateFromBootstrap(data) {
  if (!data) {
    return;
  }
  if (Array.isArray(data.roles)) {
    state.roles = data.roles.slice();
  }
  if (data.activeRole !== undefined) {
    state.activeRole = data.activeRole || null;
  }
  if (data.isDeveloper !== undefined) {
    state.isDeveloper = !!data.isDeveloper;
  }
  if (data.me !== undefined) {
    state.me = clone(data.me);
  }
  if (data.customer !== undefined) {
    state.customer = clone(data.customer);
  }
  if (data.partner !== undefined) {
    state.partner = clone(data.partner);
  }
  if (data.binding !== undefined) {
    state.binding = clone(data.binding);
  }
  if (data.config !== undefined) {
    state.config = clone(data.config);
  }
  if (data.badges !== undefined) {
    state.badges = Object.assign({ workbenchPending: 0, messages: 0 }, clone(data.badges) || {});
  }
  if (data.viewContext !== undefined) {
    state.viewContext = clone(data.viewContext) || null;
  }
  if (typeof data.serverTime === 'number' && data.serverTime > 0) {
    state.serverTimeSkew = Date.now() - data.serverTime;
  }
  notify();
}

function hasRole(role) {
  return state.roles.indexOf(role) >= 0;
}

function setViewContext(context) {
  state.viewContext = clone(context) || null;
  notify();
}

function getViewContext() {
  return state.viewContext;
}

function clearViewContext() {
  state.viewContext = null;
  notify();
}

function isDeveloper() {
  return !!state.isDeveloper;
}

function isCustomerActiveRole() {
  return state.activeRole === 'CUSTOMER';
}

function isPartnerActiveRole() {
  return state.activeRole === 'PARTNER';
}

function reset() {
  state.roles = [];
  state.activeRole = null;
  state.isDeveloper = false;
  state.me = null;
  state.customer = null;
  state.partner = null;
  state.binding = null;
  state.config = null;
  state.badges = { workbenchPending: 0, messages: 0 };
  state.viewContext = null;
  state.serverTimeSkew = 0;
  notify();
}

module.exports = {
  snapshot,
  get,
  set,
  patch,
  subscribe,
  hydrateFromBootstrap,
  hasRole,
  setViewContext,
  getViewContext,
  clearViewContext,
  isDeveloper,
  isCustomerActiveRole,
  isPartnerActiveRole,
  reset
};
