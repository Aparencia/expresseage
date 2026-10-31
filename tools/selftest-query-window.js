'use strict';
/**
 * tools/selftest-query-window.js — B 批「查询窗口簇」断言套件（TD-040/043/050；TD-044 见回执说明）。
 *
 * Q1 TD-040：顾客历史订单 >500 时 order.listCustomer 三桶计数必须精确（不再按 500 条扫描窗截断），
 *    软删（deletedByCustomerAt 真值）与 isTest 隔离口径不变；小数据边界作正控。
 * Q2 TD-043：单日完成 >100 时 order.listPartner.counts.todayCompleted 必须精确（≥今日起点的 count，
 *    不再 find(limit:100) 后内存过滤）；昨日完成与测试单不计入。
 * Q3 TD-050：绑定 >100 时 partner.listBindings 分页/关键词必须覆盖全量；某状态进行中单 >300 时
 *    行级 activeOrderCount 必须精确（按状态分页全量扫描，不再 300 条窗口截断）。
 * Q4 TD-050：单状态月区间 >300 时 partner.stats 四格计数/series/todayCompleted 必须精确
 *    （按区间 count，不再按状态 300 条窗口取数；区间边界与测试/他人数据隔离不变）。
 * TD-044（关键词部分匹配受扫描窗限制）：本批不做——无索引的模糊匹配需要全量扫描或 DAO 暴露 RegExp/OR
 *   （跨域且会引入不可控扫描量），按任务要求如实回报而非硬做；完整订单号精确查询的越窗兜底仍由既有实现承担。
 *
 * 夹具/世界装配复用 ./selftest-partner-customers-cases.js（fake DB + 真实 handler/api，不 mock 全局 wx）。
 * 纪律：先合法基线再反例，样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-query-window.js | Select-Object -Last 2
 */
const { createHarness, installCrashGuard } = require('./selftest');
const cases = require('./selftest-partner-customers-cases');

const {
  NOW, HOUR, DAY, TODAY_START, MONTH_START,
  C1, C2, P1, PID1, P2, B1, B3,
  SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION,
  apiOf, world, orderDoc, bindingDoc, customerDoc, pickRow,
} = cases;

const MINUTE = 60 * 1000;
const EXPECTED_ASSERTIONS = 18;

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
// 段内自带独立 fake DB 世界与「合法基线 → 反例」结构；段之间互不依赖。
function register(h) {
  h.section('§Q 查询窗口簇：TD-040/043/050 精确计数与全量分页（先红后绿取证据）', async (t) => {
    await sectionQ1(t);
    await sectionQ2(t);
    await sectionQ3(t);
    await sectionQ3b(t);
    await sectionQ4(t);
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
