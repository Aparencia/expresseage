'use strict';
/**
 * tools/selftest-query-window.js — B 批「查询窗口簇」断言套件（TD-040/043/050；TD-044 见回执说明）。
 *
 * Q1 TD-040：顾客历史订单 >500 时 order.listCustomer 三桶计数必须精确（不再按 500 条扫描窗截断），
 *    软删（deletedByCustomerAt 真值）与 isTest 隔离口径不变；小数据边界作正控。
 * Q2 TD-043：单日完成 >100 时 order.listPartner.counts.todayCompleted 必须精确（≥今日起点的 count，
 *    不再 find(limit:100) 后内存过滤）；昨日完成与测试单不计入。
 * Q2b TD-073（P0-2）：order.listPartner({view:'history'}) 不再白算 6 个 count——读计数探针证明
 *    workbench 基线真发生 6 次 orders.count、history 0 次，且响应形状不变（counts 六键零值模板）。
 * Q3 TD-050：绑定 >100 时 partner.listBindings 分页/关键词必须覆盖全量；某状态进行中单 >300 时
 *    行级 activeOrderCount 必须精确（按状态分页全量扫描，不再 300 条窗口截断）。
 * Q4 TD-050：单状态月区间 >300 时 partner.stats 四格计数/series/todayCompleted 必须精确
 *    （按区间 count，不再按状态 300 条窗口取数；区间边界与测试/他人数据隔离不变）。
 * Q5 D48（批 17）：order.listPartner 工作台响应只增 summary（按苑/栋聚合 + 已取件/已送达/进行中计数 +
 *    总单数/总件数）——必须复用本次 find 的命中行（分页前候选集），零额外查询/零二次 find；
 *    history/customer 视图不返回 summary（既有形状不变）。纯件聚合与 handler 端到端都断言。
 * TD-044（关键词部分匹配受扫描窗限制）：本批不做——无索引的模糊匹配需要全量扫描或 DAO 暴露 RegExp/OR
 *   （跨域且会引入不可控扫描量），按任务要求如实回报而非硬做；完整订单号精确查询的越窗兜底仍由既有实现承担。
 *
 * 夹具/世界装配复用 ./selftest-partner-customers-cases.js（fake DB + 真实 handler/api，不 mock 全局 wx）。
 * 纪律：先合法基线再反例，样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-query-window.js | Select-Object -Last 2
 */
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const cases = require('./selftest-partner-customers-cases');

// D48 纯件：文件未实现时 try/catch 兜住，让 Q5 逐条给出「缺件/缺字段」首红，而不是整套 require 崩溃。
function loadSummaryPure() {
  try {
    return require(path.join(cases.API, 'handlers/order/_summary.js'));
  } catch (error) {
    return null;
  }
}
const summaryPure = loadSummaryPure();

const {
  NOW, HOUR, DAY, TODAY_START, MONTH_START,
  C1, C2, P1, PID1, P2, B1, B3,
  SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION,
  apiOf, world, orderDoc, bindingDoc, customerDoc, pickRow,
} = cases;

const MINUTE = 60 * 1000;
// 23（Q1~Q4）+ 19（Q5 D48 summary）= 42；少算/多算都判红。
const EXPECTED_ASSERTIONS = 42;

function pad4(value) {
  return String(value).padStart(4, '0');
}

function pad3(value) {
  return String(value).padStart(3, '0');
}

function dateOf(ms) {
  return new Date(ms);
}

// 每单固定带 isTest:false（orderDoc 基座），真实会话/兼职会话都按 isTest=false 取数。
function orderAt(orderNo, status, atMs, extra) {
  return orderDoc(orderNo, status, Object.assign({
    statusUpdatedAt: dateOf(atMs),
    createdAt: dateOf(atMs - 60 * MINUTE)
  }, extra || {}));
}

// 读计数包装（P0-2/TD-073 有牙判据）：只统计 orders 集合的 count/find 次数，其余接口原样透传，
// 不改 fake DB 的读写语义（集合名/where/指令仍走同一实例）。
function wrapCollection(name, builder, counters) {
  const proxy = {};
  ['where', 'orderBy', 'limit', 'skip'].forEach((method) => {
    proxy[method] = function chain() { builder[method].apply(builder, arguments); return proxy; };
  });
  proxy.get = function get() { if (name === 'orders') counters.orderGets += 1; return builder.get(); };
  proxy.count = function count() { if (name === 'orders') counters.orderCounts += 1; return builder.count(); };
  proxy.add = function add(payload) { return builder.add(payload); };
  proxy.update = function update(payload) { return builder.update(payload); };
  proxy.remove = function remove() { return builder.remove(); };
  proxy.doc = function doc(id) { return builder.doc(id); };
  return proxy;
}

function countingApiOf(db, openid) {
  const counters = { orderCounts: 0, orderGets: 0 };
  const wrapped = {
    command: db.command,
    serverDate: db.serverDate,
    runTransaction: (fn) => db.runTransaction(fn),
    collection: (name) => wrapCollection(name, db.collection(name), counters)
  };
  return { counters, api: apiOf(wrapped, openid) };
}

// ================================================================ Q1 TD-040
function customerWindowOrders() {
  const list = [];
  // 620 条已完成历史单（插入在前：旧实现 find(limit:500) 会只取到这 500 条）
  for (let i = 0; i < 620; i += 1) {
    const at = NOW - 60 * DAY - i * MINUTE;
    list.push(orderAt('20260801-' + pad4(i), COMPLETED, at, {
      customerId: C1, customerOpenid: C1, completedAt: dateOf(at)
    }));
  }
  // 1 条软删的已完成单（deletedByCustomerAt 为真值 → 不计入）
  list.push(orderAt('20260802-' + pad4(9001), COMPLETED, TODAY_START + HOUR, {
    customerId: C1, customerOpenid: C1, completedAt: dateOf(TODAY_START + HOUR),
    deletedByCustomerAt: dateOf(TODAY_START + 2 * HOUR)
  }));
  // 进行中 5 状态各 1 单（ongoing 桶 = 5 个非终态状态合并）
  [SUBMITTED, ACCEPTED, PICKED, DELIVERED, EXCEPTION].forEach((status, i) => {
    list.push(orderAt('20261022-' + pad4(8100 + i), status, NOW - (i + 1) * MINUTE, {
      customerId: C1, customerOpenid: C1
    }));
  });
  // 2 条已取消
  list.push(orderAt('20261022-' + pad4(8201), CANCELLED, NOW - 10 * MINUTE, {
    customerId: C1, customerOpenid: C1, cancelledAt: dateOf(NOW - 10 * MINUTE)
  }));
  list.push(orderAt('20261022-' + pad4(8202), CANCELLED, NOW - 11 * MINUTE, {
    customerId: C1, customerOpenid: C1, cancelledAt: dateOf(NOW - 11 * MINUTE)
  }));
  // 测试单（isTest=true → 真实会话三桶均不计入）
  list.push(orderAt('20261022-' + pad4(8301), COMPLETED, NOW - 3 * MINUTE, {
    customerId: C1, customerOpenid: C1, isTest: true, completedAt: dateOf(NOW - 3 * MINUTE)
  }));
  list.push(orderAt('20261022-' + pad4(8302), SUBMITTED, NOW - 4 * MINUTE, {
    customerId: C1, customerOpenid: C1, isTest: true
  }));
  return list;
}

function smallCustomerOrders() {
  return [
    orderAt('20261022-' + pad4(8401), SUBMITTED, NOW - 2 * MINUTE, { customerId: C2, customerOpenid: C2 }),
    orderAt('20261022-' + pad4(8402), ACCEPTED, NOW - 3 * MINUTE, { customerId: C2, customerOpenid: C2 }),
    orderAt('20261022-' + pad4(8403), COMPLETED, NOW - 4 * MINUTE, {
      customerId: C2, customerOpenid: C2, completedAt: dateOf(NOW - 4 * MINUTE)
    }),
    orderAt('20261022-' + pad4(8404), COMPLETED, NOW - 5 * MINUTE, {
      customerId: C2, customerOpenid: C2, completedAt: dateOf(NOW - 5 * MINUTE),
      deletedByCustomerAt: dateOf(NOW - 4 * MINUTE)
    }),
    orderAt('20261022-' + pad4(8405), CANCELLED, NOW - 6 * MINUTE, {
      customerId: C2, customerOpenid: C2, cancelledAt: dateOf(NOW - 6 * MINUTE)
    }),
    orderAt('20261022-' + pad4(8406), COMPLETED, NOW - 7 * MINUTE, {
      customerId: C2, customerOpenid: C2, isTest: true, completedAt: dateOf(NOW - 7 * MINUTE)
    })
  ];
}

async function sectionQ1(t) {
  const db = world({ orders: customerWindowOrders() });
  const cApi = apiOf(db, C1);
  const real = await cApi.call('order.listCustomer', {});
  t.eq([real.ok, Object.keys(real.data || {}).sort()],
    [true, ['counts', 'list', 'nextCursor']], 'Q1.1 响应形状不变（counts/list/nextCursor）');
  t.eq(real.data.counts, { ongoing: 5, completed: 620, cancelled: 2 },
    'Q1.2 620 条已完成（另有 1 条软删）→ counts.completed=620 精确，进行中 5 状态合并=5');
  const filtered = await cApi.call('order.listCustomer', { status: 'COMPLETED' });
  t.eq(filtered.data.counts, real.data.counts,
    'Q1.3 三桶计数不受 status 筛选影响（tab 角标恒为全量口径）');
  const small = await apiOf(world({ orders: smallCustomerOrders() }), C2).call('order.listCustomer', {});
  t.eq(small.data.counts, { ongoing: 2, completed: 1, cancelled: 1 },
    'Q1.4 小数据正控：软删与测试单不计入（2/1/1）');
}

// ================================================================ Q2 TD-043
function partnerTodayWindowOrders() {
  const list = [];
  // 今日完成 130 单（07:50~09:59）＋ 今日 00:00 边界 1 单 → 131
  for (let i = 0; i < 130; i += 1) {
    const at = NOW - (i + 1) * MINUTE;
    list.push(orderAt('20261022-' + pad4(6000 + i), COMPLETED, at, { completedAt: dateOf(at) }));
  }
  list.push(orderAt('20261022-' + pad4(6200), COMPLETED, TODAY_START, { completedAt: dateOf(TODAY_START) }));
  // 昨日完成 5 单（不计入 todayCompleted）
  for (let i = 0; i < 5; i += 1) {
    const at = TODAY_START - (i + 2) * HOUR;
    list.push(orderAt('20261021-' + pad4(6300 + i), COMPLETED, at, { completedAt: dateOf(at) }));
  }
  // 测试单今日完成 2 单（不计入）
  for (let i = 0; i < 2; i += 1) {
    const at = NOW - (i + 1) * 1000;
    list.push(orderAt('20261022-' + pad4(6400 + i), COMPLETED, at, { isTest: true, completedAt: dateOf(at) }));
  }
  // 其余五桶各若干（counts 六项逐值对帐）
  const buckets = [[SUBMITTED, 2], [ACCEPTED, 1], [PICKED, 1], [DELIVERED, 1], [EXCEPTION, 1]];
  let seq = 6500;
  buckets.forEach(([status, count]) => {
    for (let i = 0; i < count; i += 1) {
      list.push(orderAt('20261022-' + pad4(seq), status, NOW - (i + 1) * MINUTE));
      seq += 1;
    }
  });
  return list;
}

async function sectionQ2(t) {
  const db = world({ orders: partnerTodayWindowOrders() });
  const pApi = apiOf(db, P1);
  const workbench = await pApi.call('order.listPartner', {});
  t.eq(workbench.ok, true, 'Q2.1 工作台基线可取数');
  t.eq(workbench.data.counts,
    { submitted: 2, accepted: 1, picked: 1, delivered: 1, exception: 1, todayCompleted: 131 },
    'Q2.2 todayCompleted=131 精确（含 00:00 边界；昨日 5 单与测试 2 单不计入）');

  // P0-2/TD-073：history 视图不再白算 6 个 count（响应形状不变）。读计数有牙：
  // workbench 基线必须真发生 6 次 orders.count；history 必须 0 次——判据不是空集。
  const counted = countingApiOf(world({ orders: partnerTodayWindowOrders() }), P1);
  const countedWorkbench = await counted.api.call('order.listPartner', {});
  t.eq([countedWorkbench.ok, counted.counters.orderCounts], [true, 6],
    'Q2.3 合法基线：workbench counts 六项 = orders.count 6 次（收口前先证明计数探针真能读到）');
  counted.counters.orderCounts = 0;
  counted.counters.orderGets = 0;
  const history = await counted.api.call('order.listPartner', { view: 'history' });
  t.eq([history.ok, counted.counters.orderCounts], [true, 0],
    'Q2.4 history 视图 0 次 orders.count（TD-073：历史摘要不再白算 counts）');
  t.eq(history.data.counts,
    { submitted: 0, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 0 },
    'Q2.5 响应形状不变：history 仍返回 counts 六键（零值模板、不计入）');
  t.eq([Array.isArray(history.data.list), history.data.list.length > 0, Object.keys(history.data).sort()],
    [true, true, ['counts', 'list', 'nextCursor']],
    'Q2.6 history 列表照旧返回且顶层键不变（数据面不受 counts 收口影响）');
  t.check(counted.counters.orderGets >= 2,
    'Q2.7 history 仍按状态各查 1 次取数（' + counted.counters.orderGets + ' 次 find，收口不误删查询预算）');
}

// ================================================================ Q3 TD-050 绑定 >100
const EXTRA_BINDINGS = 120;

function seedExtraBindings(db) {
  const customers = [];
  const bindings = [];
  for (let i = 1; i <= EXTRA_BINDINGS; i += 1) {
    const customerId = 'openid-qw-c' + pad3(i);
    const dormKey = 'D1-' + (100 + i);
    customers.push(customerDoc(customerId, 'CQW' + pad4(i), {
      displayName: '窗口客户' + pad3(i), phoneTail: '9' + pad3(i),
      zone: 'D', buildingNo: 1, room: String(100 + i), dormKey
    }));
    bindings.push(bindingDoc(customerId, PID1, 'bind-qw-' + pad3(i), { dormKey, roomTag: 'A', allocSeq: 1 }));
  }
  db.seed('customers', customers);
  db.seed('bindings', bindings);
}

async function sectionQ3(t) {
  const db = world();
  seedExtraBindings(db);
  const pApi = apiOf(db, P1);
  const ids = [];
  const sizes = [];
  let cursor = null;
  let guard = 0;
  for (;;) {
    const page = await pApi.call('partner.listBindings', { limit: 50, cursor });
    sizes.push(page.data.list.length);
    page.data.list.forEach((row) => ids.push(row.bindingId));
    cursor = page.data.nextCursor;
    guard += 1;
    if (!cursor || guard > 10) {
      break;
    }
  }
  t.eq(sizes, [50, 50, 25], 'Q3.1 125 条 ACTIVE 绑定按 limit=50 分三页取尽（50/50/25）');
  t.eq([ids.length, new Set(ids).size, cursor], [125, 125, null],
    'Q3.2 翻页不重不漏（并集=125 条全量、末页 nextCursor=null；旧实现 100 条上限会丢 25 条）');
  const kw = await pApi.call('partner.listBindings', { keyword: '9120' });
  t.eq(kw.data.list.map((row) => row.bindingId), ['bind-qw-120'],
    'Q3.3 关键词命中第 120 条绑定（超旧 100 条窗口仍可搜到）');
  const base = await pApi.call('partner.listBindings', {});
  t.eq(base.data.list.length, 20, 'Q3.4 缺省分页 limit=20 不变（响应形状与分页语义只增不改）');
}

// ================================================================ Q3b TD-050 activeOrderCount
function activeOverflowOrders() {
  const list = [];
  for (let i = 0; i < 305; i += 1) {
    list.push(orderAt('20261022-' + pad4(4000 + i), SUBMITTED, NOW - i * 1000, {
      customerId: C1, customerOpenid: C1
    }));
  }
  list.push(orderAt('20261022-' + pad4(4400), PICKED, NOW - 400000, { customerId: C1, customerOpenid: C1 }));
  for (let i = 0; i < 3; i += 1) {
    list.push(orderAt('20261022-' + pad4(4500 + i), SUBMITTED, NOW - i * 1000, {
      customerId: C1, customerOpenid: C1, isTest: true
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    list.push(orderAt('20261022-' + pad4(4700 + i), SUBMITTED, NOW - i * 1000, { customerId: C2, customerOpenid: C2 }));
  }
  return list;
}

async function sectionQ3b(t) {
  const db = world({ orders: activeOverflowOrders() });
  const list = await apiOf(db, P1).call('partner.listBindings', { limit: 50 });
  const rowC1 = pickRow(list.data.list, B1);
  const rowC2 = pickRow(list.data.list, B3);
  t.eq([rowC1 && rowC1.bindingId, rowC1 && rowC1.activeOrderCount], [B1, 306],
    'Q3b.1 SUBMITTED 305 + PICKED 1 → activeOrderCount=306（测试 3 单不计入；旧 300 窗口会报 301）');
  t.eq([rowC2 && rowC2.bindingId, rowC2 && rowC2.activeOrderCount], [B3, 2],
    'Q3b.2 逐顾客计数不串号（C2 名下 2 单）');
}

// ================================================================ Q4 TD-050 stats 月区间
const SERIES_COUNTS = [10, 10, 10, 20, 30, 50, 200]; // 10-16 .. 10-22（近 7 自然日）

function statsWindowOrders() {
  const list = [];
  let seq = 5000;
  const add = (status, atMs, extra) => {
    const orderNo = '20260901-' + pad4(seq);
    seq += 1;
    return orderAt(orderNo, status, atMs, extra);
  };
  // 今日完成 200 单（NOW-1min .. NOW-200min）
  for (let i = 0; i < 200; i += 1) {
    const at = NOW - (i + 1) * MINUTE;
    list.push(add(COMPLETED, at, { completedAt: dateOf(at) }));
  }
  // 近 7 日更早 6 天：10-16..10-21 分别 10/10/10/20/30/50
  for (let d = 1; d <= 6; d += 1) {
    const count = SERIES_COUNTS[6 - d];
    for (let i = 0; i < count; i += 1) {
      const at = TODAY_START - d * DAY + i * MINUTE;
      list.push(add(COMPLETED, at, { completedAt: dateOf(at) }));
    }
  }
  // 月起点边界：00:00 计入、前 1ms 不计入
  list.push(add(COMPLETED, MONTH_START, { completedAt: dateOf(MONTH_START) }));
  list.push(add(COMPLETED, MONTH_START - 1, { completedAt: dateOf(MONTH_START - 1) }));
  // 本月取消 12 + 月起点 1；月前 1 不计入
  for (let i = 0; i < 12; i += 1) {
    const at = NOW - (i + 1) * HOUR;
    list.push(add(CANCELLED, at, {
      cancelledAt: dateOf(at), cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
    }));
  }
  list.push(add(CANCELLED, MONTH_START, {
    cancelledAt: dateOf(MONTH_START), cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
  }));
  list.push(add(CANCELLED, MONTH_START - 1, {
    cancelledAt: dateOf(MONTH_START - 1), cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
  }));
  // 本月异常 10 + 月起点 1；月前 1 不计入（EXCEPTION 属非终态 → 同时计入 active）
  const exceptionOf = (at) => ({
    code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: 'PARTNER', at: dateOf(at)
  });
  for (let i = 0; i < 10; i += 1) {
    const at = NOW - (i + 1) * HOUR;
    list.push(add(EXCEPTION, at, { exception: exceptionOf(at) }));
  }
  list.push(add(EXCEPTION, MONTH_START, { exception: exceptionOf(MONTH_START) }));
  list.push(add(EXCEPTION, MONTH_START - 1, { exception: exceptionOf(MONTH_START - 1) }));
  // 另有 5 单非终态（active 总 17 = 12 异常单 + 5；时间早于今日完成单，避免抢占 recent 前十）
  [[SUBMITTED, 2], [ACCEPTED, 1], [PICKED, 1], [DELIVERED, 1]].forEach(([status, count]) => {
    for (let i = 0; i < count; i += 1) {
      list.push(add(status, NOW - (11 + i) * HOUR));
    }
  });
  // 隔离样本：测试单 5、他人单 5（均不计入）
  for (let i = 0; i < 5; i += 1) {
    const at = NOW - (i + 1) * MINUTE;
    list.push(add(COMPLETED, at, { isTest: true, completedAt: dateOf(at) }));
  }
  for (let i = 0; i < 5; i += 1) {
    const at = NOW - (i + 1) * MINUTE;
    list.push(add(COMPLETED, at, {
      partnerId: 'partner-b7-2', partnerOpenid: P2, partnerNo: 'PBBBBBB', completedAt: dateOf(at)
    }));
  }
  return list;
}

async function sectionQ4(t) {
  const db = world({ orders: statsWindowOrders() });
  const pApi = apiOf(db, P1);
  const month = await pApi.call('partner.stats', { range: 'month' });
  t.eq([month.data.range, month.data.counts],
    ['month', { completed: 331, active: 17, cancelled: 13, exceptions: 11 }],
    'Q4.1 月区间四格精确（完成 331=7日330+月起点1；旧 300 窗口会报 300）');
  t.eq(month.data.completionRate, 331 / (331 + 13 + 11),
    'Q4.2 完成率=completed/(completed+cancelled+exceptions) 精确');
  t.eq(month.data.series.map((item) => item.completed), SERIES_COUNTS,
    'Q4.3 series 近 7 自然日逐日精确（旧窗口丢最早 3 天的 10/10/10）');
  t.eq(month.data.todayCompleted, 200, 'Q4.4 todayCompleted 恒为今日自然日完成数（不随 range 变）');
  const week = await pApi.call('partner.stats', { range: 'week' });
  t.eq(week.data.counts.completed, 300, 'Q4.5 本周完成数=10-19..10-22 合计 300（区间口径不变）');
  t.eq([month.data.recent.length, month.data.recent[0].orderNo,
    Object.keys(month.data.recent[0]).sort()],
  [10, '20260901-5000', ['at', 'orderNo', 'status', 'statusText']],
  'Q4.6 recent 仍为区间内最近 10 条且仅四键');
}

// ---------------------------------------------------------------- 注册
// ================================================================ Q5 D48 summary
// D48（批 17）：工作台响应只增 summary；聚合必须基于「分页前候选集」（本次 find 命中行），零额外查询。
// 期望值逐字来自 CONTRACT §13 D48 / DATA_MODEL §7.5：按苑/栋聚合 + 进行中/已取件/已送达 + 总单/总件。
const SUMMARY_TOP_KEYS = ['byDorm', 'byStatus', 'parcels', 'total'];
const SUMMARY_STATUS_KEYS = ['delivered', 'ongoing', 'picked'];
const SUMMARY_DORM_KEYS = ['buildingNo', 'count', 'zone'];
const SUMMARY_BANNED = ['room', 'roomTag', 'dormKey', 'pickupCode', 'phoneTail', 'displayName',
  'orderNo', 'customerNo', 'trackingTail', 'lockerNo'];

function dormOf(zone, buildingNo, room, roomTag) {
  return {
    zone, buildingNo, room, roomTag,
    buildingText: zone + buildingNo, dormKey: zone + buildingNo + '-' + room
  };
}

function deliveryOfSummary(zone, buildingNo) {
  return { zone, buildingNo, room: '522', buildingText: zone + buildingNo, dormKey: zone + buildingNo + '-522' };
}

// 6 单进行中：D4 两单（同栋合并）、D3 一单（2 件）、X2 一单、N1 一单（delivery 覆盖 dorm）、D10 一单（delivery）。
function summaryOrders() {
  return [
    orderAt('20261022-9001', SUBMITTED, NOW - 1 * MINUTE),
    orderAt('20261022-9002', ACCEPTED, NOW - 2 * MINUTE, { dorm: dormOf('D', 4, '522', 'Z9') }),
    orderAt('20261022-9003', PICKED, NOW - 3 * MINUTE, {
      dorm: dormOf('D', 3, '519', 'B'),
      parcels: [
        { stationId: 'P1', stationName: 'P1 一号站', pickupCode: 'D48-9003-A', codeStatus: 'OK' },
        { stationId: 'P2', stationName: 'P2 二号站', pickupCode: 'D48-9003-B', codeStatus: 'OK' }
      ]
    }),
    orderAt('20261022-9004', DELIVERED, NOW - 4 * MINUTE, { dorm: dormOf('X', 2, '301', 'A') }),
    orderAt('20261022-9005', EXCEPTION, NOW - 5 * MINUTE, {
      delivery: deliveryOfSummary('N', 1), dorm: dormOf('D', 4, '522', 'A')
    }),
    orderAt('20261022-9006', SUBMITTED, NOW - 6 * MINUTE, {
      delivery: deliveryOfSummary('D', 10), dorm: dormOf('D', 4, '522', 'A'),
      guest: { displayName: '隐私昵称X', phoneTail: '9999', dormKey: 'D4-522' }
    })
  ];
}

function summaryExpected() {
  return {
    total: 6,
    parcels: 7,
    byStatus: { picked: 1, delivered: 1, ongoing: 4 },
    byDorm: [
      { zone: 'D', buildingNo: 3, count: 1 },
      { zone: 'D', buildingNo: 4, count: 2 },
      { zone: 'D', buildingNo: 10, count: 1 },
      { zone: 'X', buildingNo: 2, count: 1 },
      { zone: 'N', buildingNo: 1, count: 1 }
    ]
  };
}

function emptySummary() {
  return { total: 0, parcels: 0, byStatus: { picked: 0, delivered: 0, ongoing: 0 }, byDorm: [] };
}

async function sectionQ5(t) {
  t.check(!!summaryPure && typeof summaryPure.buildSummary === 'function',
    'Q5.0 D48 纯件 handlers/order/_summary.js 存在且导出 buildSummary');
  const pure = summaryPure ? summaryPure.buildSummary(summaryOrders()) : null;
  t.eq(pure, summaryExpected(), 'Q5.1 纯件聚合：苑/栋合并 + 已取件/已送达/进行中 + 总单 6/总件 7');
  t.eq(pure ? Object.keys(pure).sort() : null, SUMMARY_TOP_KEYS,
    'Q5.2 summary 顶层键恰为 byDorm/byStatus/parcels/total');
  t.eq(pure ? Object.keys(pure.byStatus).sort() : null, SUMMARY_STATUS_KEYS,
    'Q5.3 byStatus 恰为 picked/delivered/ongoing 三键（异常归进行中）');
  t.eq(pure && pure.byDorm[0] ? Object.keys(pure.byDorm[0]).sort() : null, SUMMARY_DORM_KEYS,
    'Q5.4 byDorm 行恰为 zone/buildingNo/count（楼栋级封顶，零房间号）');
  const crossRows = [
    orderAt('20261022-9101', SUBMITTED, NOW - 1 * MINUTE, { dorm: dormOf('X', 2, '301', 'A') }),
    orderAt('20261022-9102', SUBMITTED, NOW - 2 * MINUTE, { dorm: dormOf('C', 1, '100', 'A') }),
    orderAt('20261022-9103', SUBMITTED, NOW - 3 * MINUTE, { dorm: dormOf('D', 10, '1001', 'A') }),
    orderAt('20261022-9104', SUBMITTED, NOW - 4 * MINUTE, { dorm: dormOf('B', 3, '300', 'A') }),
    orderAt('20261022-9105', SUBMITTED, NOW - 5 * MINUTE, { dorm: dormOf('N', 1, '100', 'A') }),
    orderAt('20261022-9106', SUBMITTED, NOW - 6 * MINUTE, { dorm: dormOf('D', 4, '522', 'A') })
  ];
  const cross = summaryPure ? summaryPure.buildSummary(crossRows) : null;
  t.eq(cross ? cross.byDorm.map((row) => row.zone) : null, ['D', 'D', 'X', 'N', 'B', 'C'],
    'Q5.5 苑排序按固定 D→X→N→B→C（非字母序）');
  t.eq(cross ? cross.byDorm.slice(0, 2).map((row) => row.buildingNo) : null, [4, 10],
    'Q5.6 同苑按楼栋号数值升序（4 在 10 前，不按字符串排）');
  const merged = summaryPure ? summaryPure.buildSummary([
    orderAt('20261022-9201', SUBMITTED, NOW - 1 * MINUTE, { dorm: dormOf('D', 4, '522', 'A') }),
    orderAt('20261022-9202', ACCEPTED, NOW - 2 * MINUTE, { dorm: dormOf('D', 4, '1500', 'B') })
  ]) : null;
  t.eq(merged ? merged.byDorm : null, [{ zone: 'D', buildingNo: 4, count: 2 }],
    'Q5.7 同苑同栋不同房间合并为一行（楼栋级计数）');
  const noAddr = summaryPure ? summaryPure.buildSummary([
    orderAt('20261022-9301', SUBMITTED, NOW - 1 * MINUTE),
    orderAt('20261022-9302', SUBMITTED, NOW - 2 * MINUTE, { dorm: null, delivery: null })
  ]) : null;
  t.eq([noAddr ? noAddr.total : null, noAddr ? noAddr.byDorm : null,
    noAddr && noAddr.byDorm ? noAddr.byDorm.reduce((sum, row) => sum + row.count, 0) : null],
  [2, [{ zone: 'D', buildingNo: 4, count: 1 }], 1],
  'Q5.8 缺地址单仍计入总单数，但不进苑/栋（不猜地址；有效行照常入栋）');
  t.eq(summaryPure ? summaryPure.buildSummary([]) : null, emptySummary(),
    'Q5.9 空 rows → 零值 summary（不产生假数据）');

  const pApi = apiOf(world({ orders: summaryOrders() }), P1);
  const workbench = await pApi.call('order.listPartner', { view: 'workbench' });
  t.eq([workbench.ok, workbench.data && workbench.data.summary], [true, summaryExpected()],
    'Q5.10 handler：workbench 响应 summary 与纯件聚合逐值一致（复用本次命中行）');
  t.eq(Object.keys(workbench.data).sort(), ['counts', 'list', 'nextCursor', 'summary'],
    'Q5.11 响应只增 summary：既有 counts/list/nextCursor 键不变');
  const limited = await pApi.call('order.listPartner', { view: 'workbench', limit: 1 });
  t.eq([limited.data.list.length, limited.data.summary], [1, summaryExpected()],
    'Q5.12 summary 与分页切片无关：limit=1 仍汇总全部候选行（分页前聚合）');
  const summaryJson = JSON.stringify(pure);
  t.check(summaryJson.indexOf('522') === -1 && summaryJson.indexOf('Z9') === -1
    && summaryJson.indexOf('D48-9003') === -1 && summaryJson.indexOf('6678') === -1
    && summaryJson.indexOf('20261022') === -1 && summaryJson.indexOf('隐私昵称X') === -1,
  'Q5.13 隐私红线：summary 不含房间号/roomTag/取件码/尾号/订单号/昵称');
  t.eq(pure ? cases.collectKeyPaths(pure, SUMMARY_BANNED, '', []) : ['<pure 缺失>'],
    [], 'Q5.14 summary 递归零敏感键（room/roomTag/dormKey/pickupCode/displayName/orderNo…）');

  const counted = countingApiOf(world({ orders: summaryOrders() }), P1);
  const countedRes = await counted.api.call('order.listPartner', { view: 'workbench' });
  t.eq([countedRes.ok, counted.counters.orderCounts, counted.counters.orderGets],
    [true, 6, 5],
    'Q5.15 零额外查询：summary 不增 count（仍 6 次）也不二次 find（仍按 5 个状态各 1 次）');
  const history = await pApi.call('order.listPartner', { view: 'history' });
  t.eq([history.ok, history.data.summary, Object.keys(history.data).sort()],
    [true, undefined, ['counts', 'list', 'nextCursor']],
    'Q5.16 history 视图不返回 summary、既有响应形状不变');
  const customer = await pApi.call('order.listPartner', { view: 'customer', bindingId: B1 });
  t.eq([customer.ok, customer.data.summary, Object.keys(customer.data).sort()],
    [true, undefined, ['list', 'nextCursor']],
    'Q5.17 customer 视图不返回 summary（既有 {list,nextCursor} 形状不变）');
  const pickedOnly = await pApi.call('order.listPartner', { view: 'workbench', status: PICKED });
  t.eq(pickedOnly.data.summary, {
    total: 1,
    parcels: 2,
    byStatus: { picked: 1, delivered: 0, ongoing: 0 },
    byDorm: [{ zone: 'D', buildingNo: 3, count: 1 }]
  }, 'Q5.18 summary 口径与本次筛选一致（status=PICKED 只汇总命中的 1 单 2 件）');
}

// 段内自带独立 fake DB 世界与「合法基线 → 反例」结构；段之间互不依赖。
function register(h) {
  h.section('§Q 查询窗口簇：TD-040/043/050 精确计数与全量分页（先红后绿取证据）', async (t) => {
    await sectionQ1(t);
    await sectionQ2(t);
    await sectionQ3(t);
    await sectionQ3b(t);
    await sectionQ4(t);
    await sectionQ5(t);
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-query-window' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-query-window');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
