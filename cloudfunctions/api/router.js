// router.js · action → handler 纯分发（11 域静态注册表 + 按域懒加载）
// 冻结：ARCHITECTURE §4.1；shared/actions.js 为唯一 action 注册表。
// P0-5 性能口径（PERFORMANCE §4.1）：
//   · action 前缀即域名（`order.accept` → `order`），域清单 = DOMAIN_NAMES；不再首请求一次性 require 11 域；
//   · 首次用到某域才加载该域 handler，并当场校验「导出集 = 注册表集」（该域的 fail-fast 保留）；
//   · 未用域的注册错配由 tools/check.js #13 构建期静态判据兜住（补偿判据，运行期不再全局预检）。
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

function domainOfAction(action) {
  const text = typeof action === 'string' ? action : '';
  const index = text.indexOf('.');
  return index > 0 ? text.slice(0, index) : '';
}

// 某域的期望 action 集 = 注册表同前缀的 client 动作 + 本部署单元允许的 internal 动作（排序后稳定比较）
function expectedActionsOf(domain) {
  const out = [];
  Object.keys(ACTION_MAP).forEach((action) => {
    if (domainOfAction(action) !== domain) {
      return;
    }
    const spec = ACTION_MAP[action] || {};
    if (spec.visibility === 'client' || INTERNAL_ALLOWED.indexOf(action) >= 0) {
      out.push(action);
    }
  });
  return out.sort();
}

// 静态完整性（不 require 任何 handler）：每个 client/放行 internal 动作的前缀必须是 11 域之一
function staticRegistryProblems() {
  const out = [];
  Object.keys(ACTION_MAP).forEach((action) => {
    const spec = ACTION_MAP[action] || {};
    if (spec.visibility !== 'client' && INTERNAL_ALLOWED.indexOf(action) < 0) {
      return;
    }
    if (DOMAIN_NAMES.indexOf(domainOfAction(action)) < 0) {
      out.push(action);
    }
  });
  return out;
}

const domainCache = {};

function loadDomain(domain) {
  if (domainCache[domain]) {
    return domainCache[domain];
  }
  if (DOMAIN_NAMES.indexOf(domain) < 0) {
    // 非 api 部署单元的域（如 cleanup.*）不加载、返回 null → 上层按未登记处理（FORBIDDEN）
    return null;
  }
  let mod = null;
  try {
    mod = require('./handlers/' + domain);
  } catch (error) {
    throw new Error('handlers/' + domain + ' 加载失败：' + ((error && error.message) || String(error)));
  }
  if (!mod || !mod.actions || typeof mod.actions !== 'object') {
    throw new Error('handlers/' + domain + ' 未导出 { actions }');
  }
  const actions = mod.actions;
  const registered = Object.keys(actions).sort();
  const expected = expectedActionsOf(domain);
  const missing = expected.filter((action) => registered.indexOf(action) < 0);
  const extra = registered.filter((action) => expected.indexOf(action) < 0);
  if (missing.length > 0) {
    throw new Error('handlers/' + domain + ' 缺少 action 注册：' + missing.join(','));
  }
  if (extra.length > 0) {
    throw new Error('handlers/' + domain + ' 注册了未登记 action：' + extra.join(','));
  }
  registered.forEach((action) => {
    if (typeof actions[action] !== 'function') {
      throw new Error('handler 不是函数：' + action);
    }
  });
  domainCache[domain] = actions;
  return actions;
}

// 单请求入口：只加载 action 所属域（P0-5 核心）；未登记/非 api 域 → null（app.js 转 FORBIDDEN）
function getHandler(action) {
  if (!ACTION_MAP[action]) {
    return null;
  }
  const actions = loadDomain(domainOfAction(action));
  if (!actions) {
    return null;
  }
  return actions[action] || null;
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

// 全量构建（工具/自检用，非请求热路径）：等价旧的"一次加载全部域"口径
function createRouter() {
  const routes = {};
  DOMAIN_NAMES.forEach((domain) => {
    const actions = loadDomain(domain) || {};
    Object.keys(actions).forEach((action) => {
      if (Object.prototype.hasOwnProperty.call(routes, action)) {
        throw new Error('重复注册 action：' + action);
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
  domainOfAction,
  expectedActionsOf,
  staticRegistryProblems,
  loadDomain,
  getHandler,
  assertRegistry,
  createRouter,
  getRouter
};
