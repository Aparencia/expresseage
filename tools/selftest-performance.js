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
 *   I. P0-7/8 app.json 实际值（preloadRule 两页 + network∈{all,wifi}、networkTimeout request/uploadFile）；
 *   L. P0-2 TD-073 工作台 onShow 历史摘要去重（进工作台调用计划 2→1 纯件断言）；
 *   M. P0-4 首页一次 refresh setData 收口（4→2 批次计划）+ 隐藏页订阅挂起；
 *   N. P0-4 我的页隐藏/判等渲染计划（隐藏不 build 不 setData、无变化零 setData）。
 *
 * 纪律：纯件 + fake DB/transport 注入；不 mock 全局 wx、不连网络/真库；先合法基线再反例；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）；异步分节用 serial 队列保序。
 * 取数：node tools/selftest-performance.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const fsutil = require('./lib/fsutil');
const project = require('./lib/project');
const { createFakeDb } = require('./fake-db');

const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const configApi = require(path.join(ROOT, 'api/modules/config.js'));
const ordersView = require(path.join(ROOT, 'pages/customer/parts/orders-view.js'));
const tickerPatch = require(path.join(ROOT, 'pages/customer/orders/parts/ticker-patch.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));
const orderDetailFlow = require(path.join(ROOT, 'pkg-customer/parts/order-detail-flow.js'));
const partnerMessagePoll = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/message-poll.js'));
const cloudActions = require(path.join(ROOT, 'cloudfunctions/api/shared/actions.js'));
const { createApi } = require(path.join(ROOT, 'cloudfunctions/api/app.js'));

const EXPECTED_ASSERTIONS = 147; // 实际断言总数（145 + 2：审查 P1-9 E16 改独立期望源拆 1→3 断）；少算/多算都判红
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

// 新增纯件首红证据用：模块不存在时返回 null，由断言判红（而不是整包 require 崩溃）。
// 实现落地后同路径正常加载；少/多断言仍由 EXPECTED_ASSERTIONS 完整性闸兜住。
function optionalRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (err) {
    return null;
  }
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
    // E16 期望源必须与实现源独立（审查 P1-9：旧版两侧同取 cloudActions.ACTION_MAP，删注册表项两侧一起变仍绿）：
    // 期望侧 = CONTRACT 动作镜像 tools/lib/project.js 的 order.*（契约侧），实现侧 = router.expectedActionsOf（注册表侧）。
    // order 域无 internal 动作，镜像 order.* 即本域「client 动作」全集；数量随契约动态取，不写死 18/22。
    const orderContractActions = Object.keys(project.ACTIONS)
      .filter((action) => action.indexOf('order.') === 0).sort();
    t.eq(router.expectedActionsOf('order'), orderContractActions,
      'E16 order 域期望集（注册表侧）= project.ACTIONS 的 order.*（独立期望源：契约镜像 vs 注册表，任一方向漏/多登记即红）');
    // D58 转派四动作显式字面清单：即使有人同时删注册表与镜像，本条仍红（不依赖任一动态源）。
    const TRANSFER_ACTIONS = ['order.requestTransfer', 'order.acceptTransfer',
      'order.declineTransfer', 'order.cancelTransfer'];
    t.check(TRANSFER_ACTIONS.every((action) => router.expectedActionsOf('order').indexOf(action) >= 0
      && orderContractActions.indexOf(action) >= 0),
    'E16b D58 转派四动作在 order 域期望集内（显式字面清单，契约镜像与注册表两侧都命中）');
    // 反例（不真改文件）：模拟注册表侧漏登记 requestTransfer（删 ACTION_MAP 项）——实现侧期望集随之少一项，
    // 与独立契约镜像不再相等 → 上述 E16 必红；旧同源版在同样改动下两侧仍相等（证明旧判据无牙、新期望源独立）。
    const mutatedMap = Object.assign({}, cloudActions.ACTION_MAP);
    delete mutatedMap['order.requestTransfer'];
    const mutatedActions = Object.keys(mutatedMap).filter((action) => (
      action.indexOf('order.') === 0 && (mutatedMap[action].visibility === 'client'
        || router.INTERNAL_ALLOWED.indexOf(action) >= 0)
    )).sort();
    t.check(JSON.stringify(mutatedActions) !== JSON.stringify(orderContractActions),
      'E16c 反例：注册表删 requestTransfer 后实现侧 ≠ 契约期望源（独立源判据有牙；同源自证版此处仍绿）');
    t.eq(router.expectedActionsOf('cleanup'), [], 'E17 cleanup 域不属 api 部署单元（期望集为空）');
    const appSrc = codeOf('cloudfunctions/api/app.js');
    t.check(appSrc.indexOf('router.getHandler(') >= 0, 'E18 请求热路径走 getHandler（首请求只加载首用域）');
    t.check(appSrc.indexOf('router.getRouter()[request.action]') < 0, 'E19 不再每请求 getRouter() 全量构建（回归即红）');
    const checkRaw = textOf('tools/check.js');
    // 批 19 拆件后：#13 判据体搬到 tools/lib/check-rules-cloud.js；E20 断言「check.js 仍在 #13 委托该规则模块」
    // 且「实现模块含 staticRegistryProblems 补偿判据」——不再依赖单文件注释锚点（防删注释后假红/漏判）。
    const cloudRuleRaw = textOf('tools/lib/check-rules-cloud.js');
    t.check(checkRaw.indexOf('cloudRules.actionRegistry') >= 0
      && cloudRuleRaw.indexOf('staticRegistryProblems') >= 0,
      'E20 补偿判据进 check.js #13（未用域错配构建期暴露）');
    const arch = textOf('docs/engineering/V4_ARCHITECTURE.md');
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
    // 批 26（D58）：工作台加载/红点接线按门禁 #18 拆到 parts/load-flow（index.js 499→377 行），
    // 判等逻辑逐字保留在 syncBadge，扫描目标随拆件改为 load-flow（防拆件时丢掉「先判等再 patch」）。
    // 批 26 审查修复 P1-3：红点签名收窄为 syncBadge(counts)（只取 counts.submitted，待接收不进红点），扫描同步。
    const loadFlow = codeOf('pages/partner/workbench/parts/load-flow.js');
    t.check(/syncBadge\(counts\)[\s\S]{0,320}next\.workbenchPending === current\.workbenchPending[\s\S]{0,120}next\.messages === current\.messages/.test(loadFlow),
      'F9 workbench 角标先判等再 store.patch（无变化零通知；批 26 拆件后按 load-flow 扫描）');

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
    const eng = textOf('docs/engineering/V4_ENGINEERING.md');
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

    const eng = textOf('docs/engineering/V4_ENGINEERING.md');
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

  // ---------------------------------------------------------------- J. 客户端热路径收口（顾客首页/订单/自定义 tabBar）
  asyncSection('J. 客户端热路径：home/orders/tabbar 引用判等 + 热路径零 snapshot clone', async (t) => {
    const home = codeOf('pages/customer/home/index.js');
    const ordersPage = codeOf('pages/customer/orders/index.js');
    const tabBar = codeOf('custom-tab-bar/index.js');

    t.check(home.indexOf("store.get('customer')") >= 0 && home.indexOf("store.get('badges')") >= 0,
      'J1 首页 pickVm 逐键读 store.get（不再每次 notify 整份 store.snapshot clone）');
    t.check(home.indexOf('_vmRefs') >= 0 && home.indexOf('renderPlan.syncPlanOf(') >= 0
      && textOf('pages/customer/home/parts/render-plan.js').indexOf('last.binding !== refs.binding') >= 0,
    'J2 首页按引用判等单源在 parts/render-plan：无关 store 通知不重复 setData/派生（隐藏页另有挂起）');
    t.check(home.indexOf('partnerCard: homeView.partnerCardOf') >= 0,
      'J3 兼职卡模型在 applyDerived 一次 setData 下发（不再逐字段多轮渲染）');

    t.check(ordersPage.indexOf("store.get('serverTimeSkew')") >= 0
      && ordersPage.indexOf('store.snapshot().serverTimeSkew') < 0,
      'J4 orders 1s 倒计时读 store.get（每秒不再 clone 全量快照）');
    t.check(ordersPage.indexOf("store.get('config')") >= 0 && ordersPage.indexOf('store.snapshot().config') < 0,
      'J5 orders 配置读 store.get（同源、不 clone）');

    t.check(tabBar.indexOf('store.snapshot()') < 0 && tabBar.indexOf("store.get('viewContext')") >= 0,
      'J6 custom-tab-bar 逐键读 store.get（不对每个通知 clone 快照）');
    t.check(tabBar.indexOf('sameBadges(') >= 0 && tabBar.indexOf('sameTabs(') >= 0
      && tabBar.indexOf('current.selected === selected') >= 0,
      'J7 tabBar 按 role/selected/tabs/badges 判等后才 setData（每次 store.patch 不再重渲染）');

    const tabPages = ['pages/customer/home/index.js', 'pages/customer/orders/index.js',
      'pages/partner/workbench/index.js', 'pages/partner/customers/index.js'];
    const synced = tabPages.filter((rel) => {
      const src = textOf(rel);
      return src.indexOf('getTabBar()') >= 0 && /setData\(\{\s*selected:\s*[01]/.test(src);
    });
    t.eq(synced.length, 4, 'J8 4 个 tab 页 onShow 均显式同步 tabBar 选中格（per-page 单一来源，页面隐藏时零空转）');
    // D64：底部栏视觉抽为共用组件后，custom-tab-bar 只保留状态/跳转（不再自绘 icon 循环），
    // 视觉组件零 store/零 wx → 不新增订阅与平台调用，热路径与抽取前等价。
    const tabView = textOf('components/tab-bar-view/index.js');
    t.check(textOf('custom-tab-bar/index.wxml').indexOf('<tab-bar-view') >= 0
      && tabBar.indexOf('tab-bar-view/tabs') >= 0
      && tabView.indexOf('store/index') === -1 && tabView.indexOf('wx.') === -1,
    'J10 D64 底部栏视觉抽为 components/tab-bar-view：custom-tab-bar 只做状态/跳转薄包装，视觉组件零 store/零 wx');
    t.check(tabBar.indexOf('pseudoTab === true') >= 0 && tabBar.indexOf('wx.reLaunch') >= 0
      && tabBar.indexOf('wx.switchTab') >= 0,
    'J11 D64 伪 tab 跳转分支：取件码页不在 tabBar.list 走 reLaunch（真 tab 仍 switchTab），不产生失败切换');
    t.notEmpty([home, ordersPage, tabBar], 'J9 J 组样本非空');
  });

  // ---------------------------------------------------------------- K. P0-3 终态停止轮询（2026-11-01 反馈研究）
  asyncSection('K. P0-3 终态停止轮询：顾客详情 0 排程 + 兼职详情终态守卫', async (t) => {
    const terminal = orderDetailFlow.startPoll({ order: { status: 'COMPLETED' } });
    t.eq(orderDetailFlow.pollDelay(terminal), 0,
      'K1 顾客详情：终态（已完成）订单 startPoll 后 0 排程（不再 10s 轮询）');
    const active = orderDetailFlow.startPoll({ order: { status: 'DELIVERED' } });
    t.eq(orderDetailFlow.pollDelay(active), 10000,
      'K2 顾客详情：非终态（已送达）仍 10s 轮询（基线未被误伤）');
    t.eq([partnerMessagePoll.isTerminal({ status: 'COMPLETED' }), partnerMessagePoll.isTerminal({ status: 'DELIVERED' })],
      [true, false], 'K3 兼职详情：终态判定纯件（完成 true / 进行中 false）');
    const detailPage = textOf('pkg-partner/pages/order-detail/index.js');
    const custFlow = textOf('pkg-customer/parts/order-detail-flow.js');
    t.check(detailPage.indexOf('messagePoll.isTerminal') >= 0 && detailPage.indexOf('stopMessagePoll();') >= 0
      && custFlow.indexOf('isTerminalOrder') >= 0,
    'K4 两端接线：兼职页终态停轮询、顾客 flow 终态判据（研究 P0-3）');
  });

  // ---------------------------------------------------------------- L. P0-2 TD-073 历史摘要去重
  asyncSection('L. P0-2 TD-073：工作台 onShow 历史摘要去重（进工作台调用计划 2→1）', async (t) => {
    const historyView = optionalRequire('pages/partner/workbench/parts/history-view.js');
    const indexSrc = codeOf('pages/partner/workbench/index.js');
    const actionsSrc = codeOf('pages/partner/workbench/parts/page-actions.js');
    const planFn = historyView && typeof historyView.summaryCallPlan === 'function' ? historyView.summaryCallPlan : null;
    t.check(!!planFn, 'L1 历史摘要调用计划纯件存在（onShow 去重判据前置）');
    const base = { hasSummary: true, pending: false, dirty: false, filter: 'all', lastFilter: 'all', countsVersion: 'v1', lastCountsVersion: 'v1' };
    const withState = (patch) => (planFn ? planFn(Object.assign({}, base, patch)) : null);
    const cold = planFn ? planFn(Object.assign({}, base, { hasSummary: false, lastFilter: '' })) : null;
    t.eq(cold ? [cold.call, cold.calls, cold.reason] : null, [true, 2, 'cold'],
      'L2 合法基线：首次进工作台计划 2 次调用（主列表 1 + 摘要 1，非空集）');
    const clean = withState({});
    t.eq(clean ? [clean.call, clean.calls, clean.reason] : null, [false, 1, 'clean'],
      'L3 同筛选/同 counts 版本/无脏数据 → 摘要 0 次（进工作台 callFunction 数 2→1）');
    const pending = withState({ pending: true });
    t.eq(pending ? [pending.call, pending.calls] : null, [false, 1], 'L4 摘要请求在途 → 不再重复发（在途合并）');
    const dirty = withState({ dirty: true });
    t.eq(dirty ? [dirty.call, dirty.calls] : null, [true, 2], 'L5 显式刷新置脏（下拉/刷新/重试）→ 重拉 1 次');
    const countsMoved = withState({ countsVersion: 'v2' });
    t.eq(countsMoved ? [countsMoved.call, countsMoved.calls] : null, [true, 2], 'L6 今日 counts 版本变化 → 重拉摘要（不展示旧数）');
    const filterMoved = withState({ filter: 'submitted' });
    t.eq(filterMoved ? [filterMoved.call, filterMoved.calls] : null, [true, 2], 'L7 筛选变化 → 重拉摘要');
    const fp = historyView && typeof historyView.countsFingerprintOf === 'function' ? historyView.countsFingerprintOf : null;
    t.eq(fp ? fp({ submitted: 1, accepted: 2, picked: 3, delivered: 4, exception: 5, todayCompleted: 6 }) : '',
      '1,2,3,4,5,6', 'L8 counts 版本指纹 = 六项逐值（不是时间戳/对象引用）');
    t.eq(fp ? fp(null) : 'x', '0,0,0,0,0,0', 'L9 空 counts 退回零指纹（首帧/失败路径安全）');
    t.check(indexSrc.indexOf('historyView.summaryQuery') < 0, 'L10 工作台页面不再自行发历史摘要请求（判据下沉 parts）');
    t.check(actionsSrc.indexOf('summaryCallPlan(') >= 0, 'L11 摘要请求唯一入口先过纯件调用计划（判等后才 request）');
    t.check(indexSrc.indexOf('historyView') < 0, 'L12 页面零 history 视图判据（纯件/零件单源）');
  });

  // ---------------------------------------------------------------- M. P0-4 首页 setData 收口
  asyncSection('M. P0-4 首页一次 refresh 的 setData 收口（4→2 计划）', async (t) => {
    const renderPlan = optionalRequire('pages/customer/home/parts/render-plan.js');
    const homeSrc = codeOf('pages/customer/home/index.js');
    const planFn = renderPlan && typeof renderPlan.refreshPlanOf === 'function' ? renderPlan.refreshPlanOf : null;
    t.check(!!planFn, 'M1 首页 refresh 渲染计划纯件存在（批次计划可纯件断言）');
    const order = { orderNo: '20261022-0001', status: 'SUBMITTED', statusUpdatedAt: '2026-10-22T03:58:00.000Z' };
    const input = {
      current: {
        customer: { profileComplete: true, zone: 'D', buildingNo: 4, room: '522' },
        config: { privacyVersion: 'v4.0', zoneLabels: { D: '东苑' }, serviceCatalog: [] },
        viewContext: null,
        badges: { workbenchPending: 0, messages: 1, ordersOngoing: 2 }
      },
      config: null,
      binding: { bindingId: 'b-1', partnerNo: 'P-1' },
      partnerPublic: { partnerNo: 'P-1', displayName: '小王', acceptingOrders: true, services: [] },
      order: order,
      counts: { ongoing: 1 },
      nowMs: NOW,
      maintenanceClosed: ''
    };
    const plan = planFn ? planFn(input) : null;
    t.eq(plan ? plan.batches : -1, 2, 'M2 一次 refresh 计划恰好 2 批 setData（refresh 结果 + store 通知各 1 批；旧实现约 4 批）');
    t.eq(plan ? Object.keys(plan.setData).sort() : [], [
      'announcement', 'canOrder', 'loading', 'maintenance', 'order', 'orderDisabledReason', 'orderRow',
      'partnerCard', 'partnerPublic', 'readonly', 'scopeText', 'servicesText', 'waitedText'
    ], 'M3 第 1 批 = refresh 结果 + 全部派生字段同批下发（不再单独 applyDerived 再 setData）');
    t.check(plan ? plan.setData.loading === false && plan.setData.partnerPublic.partnerNo === 'P-1' && plan.setData.order === order
      && plan.setData.partnerCard.partnerNo === 'P-1' && plan.setData.canOrder === true : false,
    'M4 第 1 批数据展示等价：loading/partnerPublic/order/partnerCard/canOrder 与旧实现同值');
    t.check(plan ? plan.setData.vm === undefined : false, 'M5 第 1 批不夹带 vm（vm 由第 2 批 store 通知合并下发，渲染批次边界清晰）');
    t.eq(plan ? Object.keys(plan.store || {}).sort() : [], ['badges', 'binding'],
      'M6 第 2 批由单次 store.patch 触发：config 未变时只写 binding/badges（一次通知）');
    t.check(plan ? plan.store.binding.partnerPublic === input.partnerPublic : false, 'M7 store.binding 仍附 partnerPublic（P0-3 语义保持）');
    t.check(homeSrc.indexOf('renderPlan.refreshPlanOf(') >= 0 && homeSrc.indexOf('this.setData(plan.setData)') >= 0,
      'M8 页面 refresh 真消费计划：一次 setData 下发第 1 批');
    t.check(homeSrc.indexOf('applyDerived') < 0, 'M9 页面不再有独立 applyDerived 方法（派生并入批次，回归即红）');
    t.check(homeSrc.indexOf('_hidden') >= 0 && homeSrc.indexOf('this._hidden = false') >= 0 && homeSrc.indexOf('this._hidden = true') >= 0,
      'M10 首页订阅回调按页面可见性挂起/恢复（隐藏不做全量 setData，onShow 再补）');
    // 数据/展示等价：派生口径与旧 applyDerived 逐场景对帐（维护 > 绑定 > 只读 > 接单开关）
    const derivedFn = renderPlan && typeof renderPlan.derivedOf === 'function' ? renderPlan.derivedOf : null;
    const maintenance = derivedFn ? derivedFn({
      vm: { customer: { profileComplete: true }, binding: { bindingId: 'b-1' }, config: { maintenance: { enabled: true, text: '今晚维护' } } },
      partnerPublic: null,
      maintenanceClosed: ''
    }) : null;
    t.eq(maintenance ? [maintenance.patch.maintenance.visible, maintenance.patch.maintenance.title, maintenance.patch.canOrder,
      maintenance.patch.orderDisabledReason] : null,
    [true, '系统维护中', false, '系统维护中'],
    'M11 维护口径等价：遮罩可见 + 下单被拦（维护文案优先，与旧 applyDerived 同值）');
    const readonly = derivedFn ? derivedFn({
      vm: { customer: { profileComplete: true }, binding: { bindingId: 'b-1' }, viewContext: { viewMode: 'READONLY' }, config: {} },
      partnerPublic: null,
      maintenanceClosed: ''
    }) : null;
    t.eq(readonly ? [readonly.patch.readonly, readonly.patch.canOrder, readonly.patch.orderDisabledReason] : null,
      [true, false, '开发者只读视角不能操作'], 'M12 只读会话等价：置灰 + 下单被拦（只读原因优先于接单开关）');
    const unbound = derivedFn ? derivedFn({
      vm: { customer: { profileComplete: true }, binding: null, viewContext: null, config: {} },
      partnerPublic: null,
      maintenanceClosed: ''
    }) : null;
    t.eq(unbound ? [unbound.patch.canOrder, unbound.patch.orderDisabledReason] : null,
      [false, '先绑定兼职'], 'M13 未绑定等价：主 CTA 置灰并给原因（文案与旧实现一致）');
  });

  // ---------------------------------------------------------------- N. P0-4 隐藏页订阅判等
  asyncSection('N. P0-4 隐藏页订阅判等：profile 无变化/隐藏时不 setData', async (t) => {
    const renderPlan = optionalRequire('pages/profile/parts/render-plan.js');
    const profileSrc = codeOf('pages/profile/index.js');
    const planFn = renderPlan && typeof renderPlan.refreshPlanOf === 'function' ? renderPlan.refreshPlanOf : null;
    t.check(!!planFn, 'N1 我的页渲染计划纯件存在（订阅回调判等前置）');
    let builds = 0;
    const build = () => {
      builds += 1;
      return {
        vm: { role: 'CUSTOMER', isCustomer: true, roles: ['CUSTOMER'], messagesBadge: 1, profile: { displayName: '小王' } },
        readonly: false,
        canEdit: true,
        version: '开发版'
      };
    };
    const hidden = planFn ? planFn({ hidden: true, lastKey: '', editMode: false, build: build }) : null;
    t.eq(hidden ? [hidden.apply, hidden.reason, builds] : null, [false, 'hidden', 0],
      'N2 页面隐藏 → 不 build 不 setData（挂起，onShow 再补；旧实现每次通知都全量 setData）');
    const first = planFn ? planFn({ hidden: false, lastKey: '', editMode: false, build: build }) : null;
    t.eq(first ? [first.apply, first.reason, first.patch.loading] : null, [true, 'cold', false],
      'N3 首次可见 → 1 批 setData（loading=false 并入同一批）');
    const same = planFn ? planFn({ hidden: false, lastKey: first ? first.key : '', editMode: false, build: build }) : null;
    t.eq(same ? [same.apply, same.reason] : null, [false, 'same'], 'N4 可见但视图模型无变化 → 0 次 setData（判等生效）');
    let changedBuilds = 0;
    const changed = planFn ? planFn({
      hidden: false, lastKey: first ? first.key : '', editMode: false,
      build: () => {
        changedBuilds += 1;
        return { vm: { role: 'PARTNER', isCustomer: false, roles: ['CUSTOMER', 'PARTNER'], messagesBadge: 2 }, readonly: false, canEdit: true, version: '开发版' };
      }
    }) : null;
    t.eq(changed ? [changed.apply, changed.reason, changedBuilds] : null, [true, 'changed', 1],
      'N5 视图模型变化（多角色切换）→ setData 1 次（多店/多角色逻辑保持）');
    t.eq(changed ? [changed.patch.showSwitchRole, changed.patch.isCustomer, changed.patch.loading] : null, [true, false, false],
      'N6 派生字段随同批下发（showSwitchRole 多角色可见、isCustomer 角色切换生效）');
    t.check(profileSrc.indexOf('renderPlan.refreshPlanOf(') >= 0 && profileSrc.indexOf('this.setData(plan.patch)') >= 0,
      'N7 页面订阅回调真消费计划（判等/隐藏挂起在纯件层）');
    t.check(profileSrc.indexOf('_hidden') >= 0 && profileSrc.indexOf('onHide()') >= 0,
      'N8 我的页新增可见性守卫（onHide 挂起，onShow 恢复并补刷）');
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
