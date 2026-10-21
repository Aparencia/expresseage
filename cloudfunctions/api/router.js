// router.js · action → handler 纯分发（11 域注册表；未登记/非 client 可见一律 FORBIDDEN）
// 冻结：ARCHITECTURE §4.1；shared/actions.js 为唯一 action 注册表。
// 启动时校验「handler 集合 = client 动作 + admin.bootstrap/health.check」双向一致，缺一即失败关闭。
const { ACTION_MAP } = require('./shared/actions');

const DOMAIN_NAMES = Object.freeze([
  'user',
  'customer',
  'partner',
  'bind',
  'order',
  'message',
  'upload',
  'config',
  'admin',
  'ai',
  'health'
]);

// api 部署单元允许注册的内部动作（cleanup.* 只由 cleanup 云函数执行）
const INTERNAL_ALLOWED = Object.freeze(['admin.bootstrap', 'health.check']);

function loadDomain(domain) {
  const modulePath = './handlers/' + domain;
  const mod = require(modulePath);
  if (!mod || !mod.actions || typeof mod.actions !== 'object') {
    throw new Error('handlers/' + domain + ' 未导出 { actions }');
  }
  return mod.actions;
}

function assertRegistry(routes) {
  const registered = Object.keys(routes);
  const missing = [];
  Object.keys(ACTION_MAP).forEach((action) => {
    if (ACTION_MAP[action].visibility === 'client' && !routes[action]) {
      missing.push(action);
    }
  });
  INTERNAL_ALLOWED.forEach((action) => {
    if (!routes[action]) {
      missing.push(action);
    }
  });
  const unregistered = registered.filter((action) => !ACTION_MAP[action]);
  const internalNotAllowed = registered.filter((action) => (
    ACTION_MAP[action] && ACTION_MAP[action].visibility === 'internal' && INTERNAL_ALLOWED.indexOf(action) < 0
  ));
  if (missing.length > 0) {
    throw new Error('router 缺少 action 注册：' + missing.join(','));
  }
  if (unregistered.length > 0) {
    throw new Error('router 注册了未登记 action：' + unregistered.join(','));
  }
  if (internalNotAllowed.length > 0) {
    throw new Error('router 注册了不允许的内部 action：' + internalNotAllowed.join(','));
  }
  return routes;
}

function createRouter() {
  const routes = {};
  DOMAIN_NAMES.forEach((domain) => {
    const actions = loadDomain(domain);
    Object.keys(actions).forEach((action) => {
      if (Object.prototype.hasOwnProperty.call(routes, action)) {
        throw new Error('重复注册 action：' + action);
      }
      if (typeof actions[action] !== 'function') {
        throw new Error('handler 不是函数：' + action);
      }
      routes[action] = actions[action];
    });
  });
  return assertRegistry(routes);
}

let cachedRouter = null;

function getRouter() {
  if (!cachedRouter) {
    cachedRouter = createRouter();
  }
  return cachedRouter;
}

module.exports = {
  DOMAIN_NAMES,
  INTERNAL_ALLOWED,
  loadDomain,
  assertRegistry,
  createRouter,
  getRouter
};
