'use strict';
/**
 * tools/selftest-performance.js — 批 10「性能 P0 采纳实现」断言套件（PERFORMANCE §5.1 逐项验收）。
 *
 * 覆盖（P0-1/2/3/4/5/6/9/11；P0-7/8 的 app.json 由 Lead 单写者注入，本套件断言文档口径 + 实际注入值）：
 *   A. P0-1 启动关键路径静态：只 await user.bootstrap、不 await bind.getCurrent、后台推进且可复用；
 *   B. P0-2 config `prime` 动态：预热后首次 getPublic 零云调用、prime(null) 不写缓存、TTL 仍 5 分钟；
 *   C. P0-3 store.binding.partnerPublic 可选字段 + 首页复用接线（窗口/会话闸/之后自行重拉）；
 *   D. P0-4 bootstrap 五读并行（延迟 fake DB 复算并发窗口）+ 静态 Promise.all 形态；
 *   E. P0-5 router 按域懒加载（首用域只 require 该域、cleanup.* 拒绝、全量导出双向相等、热路径走 getHandler）；
 *   F. P0-6 setData 收口（orders ticker 行级 patch/无变化零 setData、workbench 角标判等、校时 1s 阈值）；
 *   G. P0-9 db/config 同请求只读 1 次（fake DB 读计数）；
 *   H. P0-11 定时器/加载态（workbench searchTimer、switch-bar 可见性启停、home/orders ≥300ms 加载态）；
 *   I. P0-7/8 app.json 实际值（preloadRule 两页 + network∈{all,wifi}、networkTimeout request/uploadFile）。
 *
 * 纪律：纯件 + fake DB/transport 注入；不 mock 全局 wx、不连网络/真库；先合法基线再反例；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）；异步分节用 serial 队列保序。
 * 取数：node tools/selftest-performance.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const { createFakeDb } = require('./fake-db');

const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const configApi = require(path.join(ROOT, 'api/modules/config.js'));
const ordersView = require(path.join(ROOT, 'pages/customer/parts/orders-view.js'));
const tickerPatch = require(path.join(ROOT, 'pages/customer/orders/parts/ticker-patch.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));
const cloudActions = require(path.join(ROOT, 'cloudfunctions/api/shared/actions.js'));
const { createApi } = require(path.join(ROOT, 'cloudfunctions/api/app.js'));

const EXPECTED_ASSERTIONS = 97; // 实际断言总数（运行后校准；少算/多算都判红）
const NOW = Date.parse('2026-10-22T12:00:00+08:00');
const ROLES = { CUSTOMER: 'CUSTOMER', PARTNER: 'PARTNER' };
const USER_STATUS = { ACTIVE: 'ACTIVE' };

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function codeOf(rel) {
  return fsutil.stripComments(textOf(rel));
}

function countOf(source, needle) {
  return source.split(needle).length - 1;
}

/** 延迟/计数包装：只包装读（get/count），写保持原样；用于并发窗口与 config 读计数断言。 */
function wrapDb(db, hooks) {
  const h = hooks || {};
  const delayed = (promise) => {
    if (!h.delayMs) return promise;
    return promise.then((value) => new Promise((resolve) => setTimeout(() => {
      if (h.onReadEnd) h.onReadEnd();
      resolve(value);
    }, h.delayMs)));
  };
  function wrapDoc(name, doc) {
    return {
      get() { if (h.onReadStart) h.onReadStart(name); return delayed(doc.get()); },
      update(payload) { return doc.update(payload); },
      remove() { return doc.remove(); },
      set(payload) { return doc.set(payload); }
    };
  }
  function wrapBuilder(name, builder) {
    const proxy = {};
    ['where', 'orderBy', 'limit', 'skip'].forEach((method) => {
      proxy[method] = function chain() { builder[method].apply(builder, arguments); return proxy; };
    });
    proxy.get = function get() { if (h.onReadStart) h.onReadStart(name); return delayed(builder.get()); };
    proxy.count = function count() { if (h.onReadStart) h.onReadStart(name); return delayed(builder.count()); };
    proxy.add = function add(payload) { return builder.add(payload); };
    proxy.update = function update(payload) { return builder.update(payload); };
    proxy.remove = function remove() { return builder.remove(); };
    proxy.doc = function docOf(id) { return wrapDoc(name, builder.doc(id)); };
    return proxy;
  }
  return {
    command: db.command,
    ServerDate: db.ServerDate,
    serverDate: db.serverDate,
    collection: (name) => wrapBuilder(name, db.collection(name)),
    runTransaction: (fn) => db.runTransaction(fn),
    seed: db.seed,
    dump: db.dump,
    stats: db.stats
  };
}

function seededDb() {
  const db = createFakeDb();
  db.seed('config', [{ _id: 'global', privacyVersion: 'v4.0', orderTimeoutMinutes: 120 }]);
  db.seed('users', [{ _id: 'openid-perf-c', roles: [ROLES.CUSTOMER], status: USER_STATUS.ACTIVE, privacyConsent: { version: 'v4.0', at: NOW } }]);
  return db;
}

function register(h) {
  // 异步分节保序：每个分节串行排队执行，避免前一分节的 transport/缓存被后一分节改写（先红后绿都稳定）。
  let serialQueue = Promise.resolve();
  function serial(fn) {
    const run = serialQueue.then(fn);
    serialQueue = run.catch(() => {});
    return run;
  }
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => {
    h.sectionTitle = title;
    return fn(t);
  }));

  // ---------------------------------------------------------------- A. P0-1 启动关键路径
  asyncSection('A. P0-1 启动关键路径：只 await bootstrap、绑定摘要后台推进、config 预热接线', async (t) => {
    const app = codeOf('app.js');
    t.check(app.indexOf('await userModule.bootstrap()') >= 0, 'A1 启动仍 await user.bootstrap（唯一必须等待的云调用）');
    t.check(app.indexOf('await this.refreshBinding()') < 0, 'A2 启动链不再 await bind.getCurrent（B1 串行 RTT 消除）');
    t.check(app.indexOf('await this.refreshConfig()') < 0, 'A3 启动链不再 await 公开配置（bootstrap 已回 configPublic）');
    t.check(app.indexOf('this.startBinding()') >= 0, 'A4 绑定摘要在启动后台发起（非关键路径）');
    t.check(app.indexOf('configModule.prime(') >= 0, 'A5 startup 把 bootstrap.configPublic 灌入 config 模块缓存（P0-2）');
    t.check(app.indexOf('consumeStartupBinding') >= 0, 'A6 暴露一次性消费入口供首页复用（P0-3）');
    t.check(app.indexOf('BIND_REUSE_WINDOW_MS') >= 0, 'A7 复用窗口为有限时间（不是永久缓存）');
    t.check(countOf(app, 'bindingConsumed') >= 2, 'A8 消费状态只放行一次（避免多次 onShow 复用同一旧结果）');
  });

  // ---------------------------------------------------------------- B. P0-2 config 预热
  asyncSection('B. P0-2 config 预热：首次 getPublic 命中缓存、TTL 语义不变', async (t) => {
    let calls = 0;
    client.setTransport(async () => {
      calls += 1;
      return { ok: true, data: { privacyVersion: 'v4.0', announcement: { enabled: false } }, serverTime: Date.now() };
    });
    configApi.clearCache();
    calls = 0;
    const cold = await configApi.getPublic();
    t.eq(calls, 1, 'B1 基线：未预热时本次会话首次 getPublic 发 1 次云调用（合法基线，非空集）');
    t.eq(cold.privacyVersion, 'v4.0', 'B2 基线返回服务端公开配置');

    configApi.clearCache();
    calls = 0;
    t.eq(configApi.prime({ privacyVersion: 'v4.0', announcement: { enabled: false } }), true, 'B3 prime(configPublic) 接受合法公开子集');
    const warm = await configApi.getPublic();
    t.eq(calls, 0, 'B4 预热后本次会话首次 getPublic=0 次云调用（B2 冷启动少 1 次）');
    t.eq(warm.privacyVersion, 'v4.0', 'B5 命中预热数据（内容与 bootstrap 一致）');

    configApi.clearCache();
    calls = 0;
    t.eq(configApi.prime(null), false, 'B6 prime(null) 不写缓存（bootstrap 失败时页面仍可自行降级拉取）');
    await configApi.getPublic();
    t.eq(calls, 1, 'B7 未预热时仍走云调用（TTL 语义不变，不是永久缓存）');
    t.eq(configApi.CACHE_TTL_MS, 5 * 60 * 1000, 'B8 config 缓存 TTL 仍为 5 分钟');
    client.restoreTransport();
  });

  // ---------------------------------------------------------------- C. P0-3 绑定复用
  asyncSection('C. P0-3 首页首次 onShow 去重：store.binding.partnerPublic + 复用接线', async (t) => {
    store.reset();
    store.hydrateFromBootstrap({
      roles: [ROLES.CUSTOMER],
      binding: { bindingId: 'b-perf', roomTag: 'D4-522A', partnerPublic: { displayName: '小王', partnerNo: 'PABC23', acceptingOrders: true } }
    });
    const binding = store.get('binding') || {};
    t.eq(binding.bindingId, 'b-perf', 'C1 store.binding 水合保留绑定主体（形状不变）');
    t.eq(binding.partnerPublic && binding.partnerPublic.displayName, '小王', 'C2 store.binding 可选字段 partnerPublic 可用');
    t.eq(binding.partnerPublic && binding.partnerPublic.partnerNo, 'PABC23', 'C3 partnerPublic 含兼职公开档案（首屏无需再拉 bind.getCurrent）');

    const app = codeOf('app.js');
    t.check(app.indexOf('partnerPublic: partnerPublic') >= 0, 'C4 启动期 refreshBinding 把 partnerPublic 一并写入 store.binding');
    t.check(app.indexOf('consumeStartupBinding') >= 0 && app.indexOf('bindingStartedAt') >= 0, 'C5 复用结果带时间戳（窗口判定）');
    const home = codeOf('pages/customer/home/index.js');
    t.check(home.indexOf('takeStartupBinding') >= 0 && home.indexOf('consumeStartupBinding') >= 0, 'C6 首页首次 refresh 消费启动期结果（少 1 次 bind.getCurrent）');
    t.check(home.indexOf('_startupBindingTaken') >= 0, 'C7 只复用一次（二次 onShow 自行重拉，不被永久缓存）');
    t.check(home.indexOf('store.getViewContext()') >= 0, 'C8 切换会话期间禁止复用（身份不同）');
    t.check(home.indexOf('bindApi.getCurrent()') >= 0, 'C9 无启动结果/过期/失败时仍自行 bind.getCurrent');
    t.check(home.indexOf('partnerPublic: partnerPublic') >= 0, 'C10 首页把 partnerPublic 一并存回 store.binding');
  });

  // ---------------------------------------------------------------- D. P0-4 bootstrap 并行读
  asyncSection('D. P0-4 user.bootstrap 五读并行（延迟 DB 复算并发窗口）', async (t) => {
    const db = seededDb();
    const READ_DELAY_MS = 60; // 每次假 DB 读固定延迟；串行实现总耗时必 ≥ reads×60ms（判据下界）
    const stats = { reads: 0, inflight: 0, maxInflight: 0 };
    const api = createApi({
      db: wrapDb(db, {
        delayMs: READ_DELAY_MS,
        onReadStart: () => {
          stats.reads += 1;
          stats.inflight += 1;
          stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
        },
        onReadEnd: () => { stats.inflight -= 1; }
      }),
      now: () => NOW,
      openid: 'openid-perf-c'
    });
    const startedAt = Date.now();
    const result = await api.call('user.bootstrap', {});
    const elapsed = Date.now() - startedAt;
    t.check(result.ok === true, 'D1 合法基线：bootstrap 成功（并行化未破坏响应包络）');
    t.check(stats.reads >= 4, 'D2 请求内确有多次 DB 读（样本 ' + stats.reads + ' 次，空集不得判绿）');
    t.check(stats.maxInflight >= 3, 'D3 读并发窗口 ≥3 同时在途（handler 五读真并行，不是串行 await）');
    t.check(elapsed < stats.reads * READ_DELAY_MS, 'D4 总耗时严格小于全串行下界 reads×60ms（串行实现必 ≥ 该值，实测 ' + elapsed + 'ms / reads=' + stats.reads + '）');
    t.eq(result.data.roles, [ROLES.CUSTOMER], 'D5 DTO 形状不变（roles 照旧返回）');

    const src = codeOf('cloudfunctions/api/handlers/user/bootstrap.js');
    t.check(src.indexOf('Promise.all([') >= 0, 'D6 handler 内用 Promise.all 并行五读');
    ['identity.loadUser(', 'identity.loadCustomer(', 'identity.loadPartnerByOpenid(', 'identity.getActiveBinding(', 'identity.loadViewSession(']
      .forEach((needle, index) => {
        t.check(src.indexOf(needle) >= 0, 'D' + (7 + index) + ' 并行块包含 ' + needle.replace('identity.', '').replace('(', ''));
      });
    t.check(src.indexOf('const user = await identity.loadUser') < 0, 'D12 不再串行 await users 读（回归即红）');
    t.check(/boundPartner[\s\S]{0,120}binding\.partnerId/.test(src), 'D13 boundPartner 仍依赖 binding 结果（依赖顺序保留）');
  });

  // ---------------------------------------------------------------- E. P0-5 router 懒加载
  asyncSection('E. P0-5 router 按域懒加载 + 静态注册表补偿判据', async (t) => {
    const apiDir = path.join(ROOT, 'cloudfunctions', 'api') + path.sep;
    function freshRouter() {
      Object.keys(require.cache).forEach((key) => { if (key.indexOf(apiDir) === 0) delete require.cache[key]; });
      return require(path.join(apiDir, 'router.js'));
    }
    function handlerIndexLoaded(domain) {
      return Object.keys(require.cache).some((key) => key === path.join(apiDir, 'handlers', domain, 'index.js'));
    }
    const router = freshRouter();
    t.eq(router.DOMAIN_NAMES.length, 11, 'E1 静态域清单仍为 11 域');
    t.eq(router.staticRegistryProblems(), [], 'E2 静态注册表零缺域（client/放行 internal 动作前缀全部可解析）');
    t.eq(router.domainOfAction('order.accept'), 'order', 'E3 action→域 按前缀解析（order.accept → order）');
    t.eq(router.domainOfAction('cleanup.orderTimeout'), 'cleanup', 'E4 cleanup.* 解析为 cleanup（非 api 部署单元域）');
    t.check(typeof router.getHandler('user.bootstrap') === 'function', 'E5 getHandler 命中已登记 client 动作');
    t.eq(handlerIndexLoaded('user'), true, 'E6 首用 user.bootstrap 加载 user 域');
    t.eq(handlerIndexLoaded('order'), false, 'E7 首用 user.bootstrap 不加载 order 域（首请求模块面收敛）');
    t.eq(handlerIndexLoaded('admin'), false, 'E8 首用 user.bootstrap 不加载 admin 域（首屏用不到）');
    t.eq(handlerIndexLoaded('ai'), false, 'E9 首用 user.bootstrap 不加载 ai 域');
    t.check(typeof router.getHandler('order.accept') === 'function', 'E10 后续动作按需加载对应域');
    t.eq(handlerIndexLoaded('order'), true, 'E11 首次调用 order.accept 才加载 order 域');
    t.eq(router.getHandler('cleanup.orderTimeout'), null, 'E12 非 api 域（cleanup.*）拒绝注册');
    t.eq(router.getHandler('unknown.action'), null, 'E13 未登记 action 返回 null（app.js 转 FORBIDDEN）');
    t.check(typeof router.getHandler('admin.bootstrap') === 'function', 'E14 放行 internal（admin.bootstrap）可懒加载');
    const routes = router.getRouter();
    const expected = Object.keys(cloudActions.ACTION_MAP).filter((action) => (
      cloudActions.ACTION_MAP[action].visibility === 'client' || router.INTERNAL_ALLOWED.indexOf(action) >= 0
    )).sort();
    t.eq(Object.keys(routes).sort(), expected, 'E15 getRouter 全量注册集 = client 动作 + admin.bootstrap/health.check');
    t.eq(router.expectedActionsOf('order').length, 18, 'E16 order 域期望集 = 18 个已登记动作（静态度量；v1.0 移除 createBatch 后 19→18）');
    t.eq(router.expectedActionsOf('cleanup'), [], 'E17 cleanup 域不属 api 部署单元（期望集为空）');
    const appSrc = codeOf('cloudfunctions/api/app.js');
    t.check(appSrc.indexOf('router.getHandler(') >= 0, 'E18 请求热路径走 getHandler（首请求只加载首用域）');
    t.check(appSrc.indexOf('router.getRouter()[request.action]') < 0, 'E19 不再每请求 getRouter() 全量构建（回归即红）');
    const checkRaw = textOf('tools/check.js');
    t.check(checkRaw.indexOf('staticRegistryProblems') >= 0, 'E20 补偿判据进 check.js #13（未用域错配构建期暴露）');
    const arch = textOf('docs/ARCHITECTURE.md');
    t.check(arch.indexOf('按域懒加载') >= 0 && arch.indexOf('fail-fast') >= 0, 'E21 架构文档写明懒加载与 fail-fast 落差');
  });

  // ---------------------------------------------------------------- F. P0-6 setData 收口
  asyncSection('F. P0-6 消除整表 setData：orders 行级补丁 / 角标判等 / 校时阈值', async (t) => {
    const statusUpdatedAt = '2026-10-22T03:58:00.000Z';
    const rows = [
      { orderNo: 'A', status: 'SUBMITTED', statusUpdatedAt, timeText: '等待接单 02:00' },
      { orderNo: 'B', status: 'ACCEPTED', statusUpdatedAt, timeText: '已接单，正在安排取件' },
      { orderNo: 'C', status: 'SUBMITTED', statusUpdatedAt, timeText: '等待接单 02:00' }
    ];
    const config = { orderTimeoutMinutes: 120 };
    const nowMs = Date.parse(statusUpdatedAt) + 60 * 1000;
    const patch = tickerPatch.build(rows, nowMs, config);
    t.eq(Object.keys(patch || {}).sort(), ['list[0].timeText', 'list[2].timeText'], 'F1 只给 SUBMITTED 行下发点路径（ACCEPTED 行零下发）');
    t.check(/^等待接单 0?1:/.test(patch['list[0].timeText']), 'F2 补丁值是逐行的倒计时文案（语义同 tickRows）');
    t.eq(patch.list, undefined, 'F3 补丁不含整表 list 键（不再是整表 setData）');
    const applied = rows.map((row, index) => Object.assign({}, row, patch['list[' + index + '].timeText'] ? { timeText: patch['list[' + index + '].timeText'] } : {}));
    t.eq(tickerPatch.build(applied, nowMs, config), null, 'F4 同秒重算零变化 → 返回 null（页面跳过 setData，判等生效）');
    const manyRows = Array.from({ length: 30 }, (_, index) => (
      index === 4 || index === 17
        ? { orderNo: 'S' + index, status: 'SUBMITTED', statusUpdatedAt, timeText: '等待接单 02:00' }
        : { orderNo: 'D' + index, status: 'COMPLETED', statusUpdatedAt, timeText: '已完成' }
    ));
    t.eq(Object.keys(tickerPatch.build(manyRows, nowMs, config) || {}).length, 2, 'F5 30 行列表只补 2 个变化行（字节数不再随列表线性放大）');
    const ordersPage = codeOf('pages/customer/orders/index.js');
    t.check(ordersPage.indexOf('tickerPatch.build(') >= 0, 'F6 orders 1s ticker 走行级补丁纯件');
    t.check(ordersPage.indexOf('setData({ list:') < 0, 'F7 orders 不再整表 setData({list})（回归即红）');

    const nextBadge = loadView.badgePatch({ submitted: 2 }, { workbenchPending: 2, messages: 1 });
    t.eq(nextBadge, { workbenchPending: 2, messages: 1 }, 'F8 角标计算幂等（输入不变 → 输出不变，判等有意义）');
    const workbench = codeOf('pages/partner/workbench/index.js');
    t.check(/syncBadge\(counts\)[\s\S]{0,280}next\.workbenchPending === current\.workbenchPending[\s\S]{0,120}next\.messages === current\.messages/.test(workbench),
      'F9 workbench 角标先判等再 store.patch（无变化零通知）');

    t.eq(client.SKEW_NOTIFY_MS, 1000, 'F10 校时阈值常量为 1s（|Δ|≤1000ms 不写不通知）');
    let notifies = 0;
    const off = store.subscribe(() => { notifies += 1; });
    store.set('serverTimeSkew', 0);
    notifies = 0;
    client.setTransport(async () => ({ ok: true, data: {}, serverTime: Date.now() - 200 }));
    await client.call('order.get', { orderNo: 'X' }, { retry: false });
    t.eq(notifies, 0, 'F11 |Δskew|=200ms ≤1s → 不写 store、不 notify 订阅者');
    t.eq(store.get('serverTimeSkew'), 0, 'F12 抖动被静默丢弃（旧值保持）');
    client.setTransport(async () => ({ ok: true, data: {}, serverTime: Date.now() - 5000 }));
    await client.call('order.get', { orderNo: 'X' }, { retry: false });
    t.eq(notifies, 1, 'F13 |Δskew|≈5s >1s → 更新并 notify 一次');
    const skew = store.get('serverTimeSkew');
    t.check(skew > 4000 && skew < 6000, 'F14 写入的 skew = 本机-服务端（约 5s）');
    off();
    client.restoreTransport();
  });

  // ---------------------------------------------------------------- G. P0-9 config 同请求复用
  asyncSection('G. P0-9 db/config 同请求复用：每请求只读 1 次 config', async (t) => {
    const db = seededDb();
    const counters = { config: 0 };
    const api = createApi({
      db: wrapDb(db, { onReadStart: (name) => { if (name === 'config') counters.config += 1; } }),
      now: () => NOW,
      openid: 'openid-perf-c'
    });
    counters.config = 0;
    const publicResult = await api.call('config.getPublic', {});
    t.check(publicResult.ok === true, 'G1 合法基线：config.getPublic 成功');
    t.eq(counters.config, 1, 'G2 config.getPublic 每请求只读 1 次 config（app.js 统一注入 ctx.config）');
    counters.config = 0;
    const bootResult = await api.call('user.bootstrap', {});
    t.check(bootResult.ok === true, 'G3 合法基线：user.bootstrap 成功');
    t.eq(counters.config, 1, 'G4 bootstrap（含 configPublic）仍只读 1 次 config（无二次读）');
    const configCommon = codeOf('cloudfunctions/api/handlers/config/_common.js');
    t.check(configCommon.indexOf('ctx.config') >= 0, 'G5 handler 侧优先复用 ctx.config（缺省才回退 readConfig）');
    const eng = textOf('docs/V4_ENGINEERING.md');
    t.check(eng.indexOf('同请求复用') >= 0 && eng.indexOf('跨请求 TTL 缓存') >= 0, 'G6 工程文档写明同请求复用与「跨请求 TTL 不做」');
  });

  // ---------------------------------------------------------------- H. P0-11 定时器/加载态
  asyncSection('H. P0-11 定时器与加载态收口（静态接线）', async (t) => {
    const workbench = codeOf('pages/partner/workbench/index.js');
    t.check(workbench.indexOf('clearSearchTimer()') >= 0, 'H1 workbench 有 searchTimer 统一清理入口');
    t.check(countOf(workbench, 'this.clearSearchTimer()') >= 2, 'H2 onHide/onUnload 都清理防抖定时器（切走瞬间不再发孤儿请求）');
    t.check(workbench.indexOf('this.searchTimer = null') >= 0, 'H3 触发后置空（不残留已触发定时器句柄）');

    const bar = codeOf('components/switch-bar/index.js');
    t.check(bar.indexOf('pageLifetimes') >= 0, 'H4 switch-bar 用 pageLifetimes 感知页面可见性');
    t.check(bar.indexOf('hide()') >= 0 && bar.indexOf('stopTick()') >= 0, 'H5 页面隐藏即停 1s tick');
    t.check(countOf(bar, 'setInterval(') === 1, 'H6 全组件只有一处 setInterval（且只在 startTick 内）');
    t.check(/startTick\(\)[\s\S]{0,120}if \(this\.timer \|\| this\._visible === false\)/.test(bar), 'H7 无会话/不可见时不建定时器（普通用户零空转）');

    const ordersPage = codeOf('pages/customer/orders/index.js');
    t.check(ordersPage.indexOf('LOADING_DELAY_MS = 300') >= 0, 'H8 orders 加载态延迟 300ms 才显示');
    t.check(ordersPage.indexOf('scheduleLoadingVisible') >= 0 && ordersPage.indexOf('clearLoadingTimer') >= 0, 'H9 加载态定时器成对创建/清理');
    const ordersWxml = textOf('pages/customer/orders/index.wxml');
    t.check(ordersWxml.indexOf('loadingVisible') >= 0, 'H10 orders 视图用 delayed 标志渲染「加载中」');
    t.check(ordersWxml.indexOf('wx:if="{{loading}}"') < 0, 'H11 orders 不再用即时的 loading 渲染加载文案（快网不闪）');

    const home = codeOf('pages/customer/home/index.js');
    t.check(home.indexOf('LOADING_DELAY_MS = 300') >= 0, 'H12 home 加载态延迟 300ms');
    t.check(home.indexOf('scheduleLoading()') >= 0 && home.indexOf('clearLoadingTimer()') >= 0, 'H13 home 延迟置 loading 且成功/失败/卸载对称清理');
    t.check(home.indexOf('setData({ loading: true, error') < 0, 'H14 home 不再在请求发起瞬间强制置 loading（快网少一次 setData）');

    const eng = textOf('docs/V4_ENGINEERING.md');
    t.check(eng.indexOf('preloadRule') >= 0 && eng.indexOf('networkTimeout') >= 0, 'H15 文档登记 P0-7/P0-8 app.json 性能配置口径（实际注入值由 I1/I2 断言）');
  });

  // ---------------------------------------------------------------- I. P0-7/P0-8 app.json 实际值
  asyncSection('I. P0-7/P0-8 app.json 性能配置（Lead 单写者注入的实际值）', async (t) => {
    const appJson = JSON.parse(textOf('app.json'));
    const preload = appJson.preloadRule || {};
    const preloadKeys = Object.keys(preload).sort();
    const homeRule = preload['pages/customer/home/index'] || {};
    const workRule = preload['pages/partner/workbench/index'] || {};
    const packagesOf = (rule) => (Array.isArray(rule.packages) ? rule.packages : []);
    const NETWORKS = ['all', 'wifi'];
    const preloadOk = preloadKeys.length === 2
      && preloadKeys[0] === 'pages/customer/home/index'
      && preloadKeys[1] === 'pages/partner/workbench/index'
      && packagesOf(homeRule).length === 1 && packagesOf(homeRule)[0] === 'pkg-customer'
      && packagesOf(workRule).length === 1 && packagesOf(workRule)[0] === 'pkg-partner'
      && NETWORKS.indexOf(homeRule.network) >= 0
      && NETWORKS.indexOf(workRule.network) >= 0;
    t.check(preloadOk, 'I1 preloadRule 恰含 首页→pkg-customer、工作台→pkg-partner 且 network∈{all,wifi}（不夹带其他页）');
    const timeout = appJson.networkTimeout || {};
    t.check(timeout.request === 10000 && timeout.uploadFile === 60000, 'I2 networkTimeout.request===10000（对齐 api/client.js 竞速口径）且 uploadFile===60000');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-performance' });
  h.setExpected(EXPECTED_ASSERTIONS);
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-performance');
  register(h);
  h.finish();
}
