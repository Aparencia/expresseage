// app.js · 请求编排：解包 → 路由 → 中间件链 → handler → flat 包络
// 冻结：ARCHITECTURE §4.1/§4.3；ctx = { dao, ids, now, env, cloud, openid, identity, requestId, clientRequestId, expectedVersion, config }。
const router = require('./router');
const middleware = require('./middleware');
const { ACTION_MAP } = require('./shared/actions');
const { createDao } = require('./db/dao');
const { readConfig, cloneDefault } = require('./db/config');
const idGenerator = require('./lib/id-generator');
const time = require('./lib/time');
const respond = require('./lib/respond');
const errors = require('./lib/errors');

function baseIdentity(openid) {
  return {
    actorOpenid: openid || '',
    effectiveOpenid: openid || '',
    role: '',
    isTestAccount: false,
    viewMode: '',
    viewTicketId: '',
    developerNo: ''
  };
}

function resolveNow(deps, override) {
  if (override !== undefined && override !== null) {
    return time.toMs(override);
  }
  const source = deps && deps.now;
  if (typeof source === 'function') {
    return time.toMs(source());
  }
  return time.toMs(source);
}

function bindIds(dao, nowMs) {
  return {
    customerNo: () => idGenerator.generateCustomerNo(),
    partnerNo: () => idGenerator.generatePartnerNo(),
    orderNo: (atMs) => idGenerator.generateOrderNo(dao, atMs === undefined || atMs === null ? nowMs : time.toMs(atMs)),
    failureNo: (atMs) => idGenerator.generateFailureNo(atMs === undefined || atMs === null ? nowMs : time.toMs(atMs)),
    inviteCode: () => idGenerator.generateInviteCode(),
    randomId: (len) => idGenerator.generateRandomId(len),
    uploadTicket: () => idGenerator.generateUploadTicket()
  };
}

function unpack(event) {
  if (!event || typeof event !== 'object') {
    throw errors.validation('action', '请求格式不正确，请刷新页面后重试');
  }
  if (typeof event.action !== 'string' || event.action.length === 0) {
    throw errors.validation('action', '缺少操作名，请刷新页面后重试');
  }
  return {
    action: event.action,
    data: event.data,
    clientRequestId: event.clientRequestId,
    expectedVersion: event.expectedVersion,
    viewTicket: typeof event.viewTicket === 'string' && event.viewTicket.length > 0 ? event.viewTicket : ''
  };
}

async function loadRuntimeConfig(dao) {
  try {
    return await readConfig(dao);
  } catch (error) {
    console.error('[api] 读取全局配置失败，使用内置默认值');
    return { config: cloneDefault(), seeded: false };
  }
}

function makeRequestId(deps) {
  if (deps && typeof deps.requestId === 'string' && deps.requestId.length > 0) {
    return deps.requestId;
  }
  return respond.newRequestId();
}

// 云函数日志专用异常序列化：只用于 console.error 排障，不进入响应包络（不暴露给客户端）。
function serializeErrorForLog(error, requestId, action) {
  const source = error || {};
  const out = {
    requestId: requestId || '',
    action: action || '',
    name: source.name || '',
    code: source.code || source.errCode || '',
    message: source.message || source.errMsg || ''
  };
  if (typeof source.stack === 'string' && source.stack) {
    out.stack = source.stack.split('\n').slice(0, 4).join(' | ');
  }
  return JSON.stringify(out);
}

async function invokeCore(event, deps) {
  const startedWall = Date.now();
  const nowMs = resolveNow(deps);
  const requestId = makeRequestId(deps);
  const meta = { serverTime: nowMs, requestId };
  const actionForLog = event && typeof event.action === 'string' ? event.action : '';
  try {
    const request = unpack(event);
    const spec = ACTION_MAP[request.action];
    if (!spec) {
      throw errors.forbidden('不支持的操作');
    }
    // P0-5：按 action 所属域懒加载（首请求不再 require 全部 11 域）；未登记/非 api 域 → null → FORBIDDEN
    const handler = router.getHandler(request.action);
    if (typeof handler !== 'function') {
      throw errors.forbidden('不支持的操作');
    }
    const dao = createDao(deps.db);
    const runtime = await loadRuntimeConfig(dao);
    const ctx = {
      dao,
      ids: bindIds(dao, nowMs),
      now: nowMs,
      env: deps.env || {},
      cloud: deps.cloud,
      openid: deps.openid || '',
      identity: baseIdentity(deps.openid),
      requestId,
      clientRequestId: '',
      expectedVersion: undefined,
      config: runtime.config
    };
    const state = {
      action: request.action,
      payload: request.data,
      ctx,
      meta: {
        spec,
        handler,
        requestId,
        startedAt: nowMs,
        viewTicket: request.viewTicket,
        hasViewTicket: !!request.viewTicket,
        clientRequestId: request.clientRequestId,
        expectedVersion: request.expectedVersion,
        configSeeded: runtime.seeded === true
      }
    };
    // 部署/控制台上下文（无 OPENID）：仅内部动作允许走无用户态的最小链路。
    // 客户端调用云函数必然带 OPENID，因此本分支不可由客户端伪造；用 DEPLOY 哨兵表示部署者，
    // 只用于让 internal 动作（admin.bootstrap/health.check）通过 adminGuard 与审计，不落业务数据。
    if (spec.visibility === 'internal' && !ctx.openid) {
      ctx.identity = {
        actorOpenid: 'DEPLOY',
        effectiveOpenid: 'DEPLOY',
        role: '',
        isTestAccount: false,
        viewMode: '',
        viewTicketId: '',
        developerNo: 'DEPLOY'
      };
      state.ctx = ctx;
      const checked = await middleware.validate.middleware(state);
      const data = await handler(checked.ctx, checked.payload);
      console.log('[api]', request.action, requestId, 'ok', time.elapsedMs(startedWall, Date.now()), 'ms', 'deploy');
      return respond.success(data, meta);
    }
    let current = state;
    for (let i = 0; i < middleware.CHAIN.length; i += 1) {
      current = await middleware.CHAIN[i](current);
    }
    const data = await current.meta.handler(current.ctx, current.payload);
    await middleware.audit.finish(current);
    await middleware.ratelimit.finish(current);
    console.log('[api]', request.action, requestId, 'ok', time.elapsedMs(startedWall, Date.now()), 'ms');
    return respond.success(data, meta);
  } catch (error) {
    const appError = error instanceof errors.AppError ? error : errors.from(error);
    if (!(error instanceof errors.AppError)) {
      // 诊断：异常细节只进云函数日志（含 requestId 供对账）；响应仍走 13 码收敛，
      // 绝不把英文码/堆栈/内部细节返回给客户端（CONTRACT §5.3、UX 文案纪律）。
      console.error('[api] 未处理异常', serializeErrorForLog(error, requestId, actionForLog));
    }
    console.log('[api]', actionForLog, requestId, appError.code, time.elapsedMs(startedWall, Date.now()), 'ms');
    return respond.failure(appError, meta);
  }
}

// 生产入口：bootstrap.js 组装 deps 后调用；事件必须是 {action, data, clientRequestId?, expectedVersion?, viewTicket?}
async function invoke(event, deps) {
  return invokeCore(event, deps || {});
}

// 注入式测试入口：createApi({db, now, openid, env, cloud, requestId}) → call(action, payload, options)
// options: { clientRequestId?, expectedVersion?, viewTicket?, openid?, now?, requestId? }
function createApi(deps) {
  const base = deps || {};
  if (!base.db) {
    throw new Error('createApi 需要注入 db');
  }
  async function call(action, payload, options) {
    const opts = options || {};
    const requestId = opts.requestId || respond.newRequestId();
    const spec = ACTION_MAP[action];
    let clientRequestId = opts.clientRequestId;
    if (clientRequestId === undefined && spec && spec.visibility === 'client' && spec.write) {
      clientRequestId = respond.newRequestId();
    }
    const event = {
      action,
      data: payload === undefined ? {} : payload,
      clientRequestId,
      expectedVersion: opts.expectedVersion,
      viewTicket: opts.viewTicket,
      requestId
    };
    return invokeCore(event, {
      db: base.db,
      cloud: base.cloud,
      env: base.env || {},
      openid: opts.openid !== undefined ? opts.openid : (base.openid || ''),
      now: opts.now !== undefined ? opts.now : base.now,
      requestId
    });
  }
  return { call, invoke: (event) => invokeCore(event, base) };
}

module.exports = {
  invoke,
  createApi,
  baseIdentity,
  bindIds,
  resolveNow,
  loadRuntimeConfig
};
