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
  privacyConsent: null,
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
  const roles = Array.isArray(data.roles) ? data.roles.slice() : state.roles;
  if (Array.isArray(data.roles)) {
    state.roles = roles;
  }
  if (data.activeRole !== undefined) {
    state.activeRole = data.activeRole || null;
  } else if (!state.activeRole && roles.length === 1) {
    state.activeRole = roles[0];
  }
  if (data.isDeveloper !== undefined) {
    state.isDeveloper = !!data.isDeveloper;
  }
  // 平铺 DTO → 嵌套快照（DATA_MODEL §7.1 user.bootstrap 形状）
  const hasCustomer = roles.indexOf('CUSTOMER') >= 0;
  const hasPartner = roles.indexOf('PARTNER') >= 0;
  const customer = data.customer !== undefined
    ? clone(data.customer)
    : data.customerProfileCompleted !== undefined
      ? {
          profileComplete: !!data.customerProfileCompleted,
          customerNo: data.customerNo || '',
          displayName: hasCustomer ? data.displayName || '' : '',
          avatarFileId: hasCustomer ? data.avatarFileId || '' : ''
        }
      : state.customer;
  const partner = data.partner !== undefined
    ? clone(data.partner)
    : data.partnerStatus !== undefined
      ? {
          status: data.partnerStatus || '',
          profileComplete: !!(data.partnerNo || data.partnerStatus === 'ACTIVE'),
          partnerNo: data.partnerNo || '',
          displayName: hasPartner ? data.displayName || '' : '',
          avatarFileId: hasPartner ? data.avatarFileId || '' : ''
        }
      : state.partner;
  if (customer !== undefined) {
    state.customer = customer;
  }
  if (partner !== undefined) {
    state.partner = partner;
  }
  if (data.me !== undefined) {
    state.me = clone(data.me);
  } else if (data.displayName !== undefined) {
    state.me = { displayName: data.displayName || '', avatarFileId: data.avatarFileId || '' };
  }
  if (data.binding !== undefined) {
    state.binding = clone(data.binding);
  }
  if (data.config !== undefined) {
    state.config = clone(data.config);
  } else if (data.configPublic !== undefined) {
    state.config = clone(data.configPublic);
  }
  if (data.privacyConsent !== undefined) {
    state.privacyConsent = clone(data.privacyConsent);
  }
  if (data.badges !== undefined) {
    state.badges = Object.assign({ workbenchPending: 0, messages: 0 }, clone(data.badges) || {});
  }
  if (data.viewContext !== undefined) {
    // 服务端 viewContext 永不回票据（ARCHITECTURE §3.4：viewTicket 只存内存）。
    // 水合时保留本地票据、其余字段以服务端为准；否则在会话内任何一次 bootstrap 都会把票据清掉，
    // 后续请求失去切换身份（批 10：进入/退出会话水合后必须仍带 viewTicket）。
    const incoming = clone(data.viewContext) || null;
    const currentTicket = state.viewContext && state.viewContext.viewTicket;
    state.viewContext = incoming
      ? Object.assign({}, incoming, currentTicket ? { viewTicket: currentTicket } : {})
      : null;
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
  state.privacyConsent = null;
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
