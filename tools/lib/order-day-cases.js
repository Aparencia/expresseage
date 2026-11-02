'use strict';
/**
 * tools/lib/order-day-cases.js — 工作台「今日订单流水」服务端用例（批 20-B，D53/D54）。
 *   覆盖：order.listPartner view=day 的今日窗口/七状态/状态更新时间倒序/游标分页/顶层键；
 *         待确认/已完成/已取消行 actions[] 剥离；counts 六项；summary 今日已送达口径
 *         （deliveredAt∈今日、DELIVERED/COMPLETED、排除取消、byDorm）；非法 view 拒绝；
 *         view=workbench 旧形状零变化（summary 仍旧 D48 形状）。
 * 拆出原因：门禁 #18 测试文件 ≤1000 行；serverChecks 由 selftest-cloud 注册。
 * 口径：DATA_MODEL §7.5（listPartner）。禁止真实外呼/真库：fake DB 注入。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const { createTestDb } = require('../selftest-cloud-fixtures');
const app = require(path.join(API, 'app.js'));

const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const HOUR = 60 * 60 * 1000;
const PARTNER_OPENID = 'openid-day-p';

function doc(orderNo, extra) {
  return Object.assign({
    _id: 'order-day-' + orderNo,
    orderNo: orderNo,
    requestKey: 'order-day:' + orderNo,
    customerId: 'openid-day-c',
    customerOpenid: 'openid-day-c',
    customerNo: 'CABCDEFGH',
    partnerId: 'partner-day-1',
    partnerOpenid: PARTNER_OPENID,
    partnerNo: 'PABC234',
    source: 'CUSTOMER',
    isTest: false,
    status: 'SUBMITTED',
    version: 1,
    dorm: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' },
    delivery: { zone: 'D', buildingNo: 4 },
    statusUpdatedAt: new Date(NOW),
    createdAt: new Date(NOW - 2 * HOUR),
    parcels: [{ itemIndex: 0, stationId: 'P1', pickupCode: 'A1000' }]
  }, extra || {});
}

function world() {
  const db = createTestDb();
  db.seed('users', [
    { _id: 'openid-day-c', roles: ['CUSTOMER'], status: 'ACTIVE', isTestAccount: false },
    { _id: PARTNER_OPENID, roles: ['PARTNER'], status: 'ACTIVE', isTestAccount: false }
  ]);
  db.seed('customers', [{ _id: 'openid-day-c', customerNo: 'CABCDEFGH', displayName: '小王', profileCompleted: true, dormKey: 'D4-522' }]);
  db.seed('partners', [{
    _id: 'partner-day-1', openid: PARTNER_OPENID, partnerNo: 'PABC234', displayName: '小李',
    status: 'ACTIVE', serviceConfig: { acceptingOrders: true }
  }]);
  db.seed('orders', [
    doc('20261021-1001', { status: 'SUBMITTED', statusUpdatedAt: new Date(NOW - 1 * HOUR) }),
    doc('20261021-1002', {
      status: 'DELIVERED', statusUpdatedAt: new Date(NOW - 2 * HOUR),
      deliveredAt: new Date(NOW - 3 * HOUR)
    }),
    doc('20261021-1003', {
      status: 'COMPLETED', statusUpdatedAt: new Date(NOW - 3 * HOUR),
      deliveredAt: new Date(NOW - 5 * HOUR), completedAt: new Date(NOW - 3 * HOUR)
    }),
    doc('20261021-1004', {
      status: 'DELIVERED', statusUpdatedAt: new Date(NOW - 4 * HOUR),
      deliveredAt: new Date(NOW - 25 * HOUR)
    }),
    doc('20261021-1005', {
      status: 'CANCELLED', statusUpdatedAt: new Date(NOW - 5 * HOUR),
      cancelledAt: new Date(NOW - 5 * HOUR), cancelReason: 'CHANGED_MIND'
    }),
    doc('20261021-1006', { status: 'SUBMITTED', statusUpdatedAt: new Date(NOW - 25 * HOUR), createdAt: new Date(NOW - 26 * HOUR) })
  ]);
  return db;
}

function actionCount(row) {
  return Array.isArray(row && row.actions) ? row.actions.length : 0;
}

async function serverChecks(t) {
  const db = world();
  const api = app.createApi({ db: db, now: function now() { return NOW; }, openid: PARTNER_OPENID, env: {} });
  const day = await api.call('order.listPartner', { view: 'day', limit: 20 });
  const list = (day.data && day.data.list) || [];
  t.eq(list.map(function no(row) { return row.orderNo; }),
    ['20261021-1001', '20261021-1002', '20261021-1003', '20261021-1004', '20261021-1005'],
    '§7.3 day 视图：只含今日有状态更新的 7 状态订单、statusUpdatedAt 倒序（昨日更新的 1006 不进今日流水）');
  // D58（批 26）：主视图顶层只增 transferPending 角标（服务端计数；counts/summary 形状不变）
  t.eq(Object.keys(day.data).sort().join(','), 'counts,list,nextCursor,summary,transferPending',
    '§7.3 day 视图顶层键与 workbench 一致：list/nextCursor/counts/summary/transferPending');
  t.eq(list.map(function strip(row) { return [row.orderNo, actionCount(row) > 0]; }), [
    ['20261021-1001', true],
    ['20261021-1002', false],
    ['20261021-1003', false],
    ['20261021-1004', false],
    ['20261021-1005', false]
  ], '§7.3 day 视图：进行中行保留 actions[]，待确认/已完成/已取消行只读（服务端剥写操作）');
  const counts = day.data.counts || {};
  t.eq(['submitted', 'accepted', 'picked', 'delivered', 'exception', 'todayCompleted'].map(function key(k) {
    return counts[k];
  }), [2, 0, 0, 2, 0, 1], '§7.3 day 视图 counts 六项与全量一致（今日完成=completedAt 今日）');
  const summary = day.data.summary || {};
  t.eq([summary.scope, summary.total, summary.parcels, summary.completed, summary.pending],
    ['deliveredToday', 2, 2, 1, 1],
    '§7.3 day summary：今日已送达 2 单（deliveredAt 今日且 DELIVERED/COMPLETED；昨日送达单与取消单不计）');
  t.eq(summary.byDorm, [{ zone: 'D', buildingNo: 4, count: 2 }],
    '§7.3 day summary byDorm：只到苑+楼栋聚合（无房间号/称呼/编号）');
  const first = await api.call('order.listPartner', { view: 'day', limit: 2 });
  const second = await api.call('order.listPartner', { view: 'day', limit: 2, cursor: first.data.nextCursor });
  t.eq([first.data.list.length, second.data.list.length,
    first.data.list.concat(second.data.list).map(function no(row) { return row.orderNo; })],
  [2, 2, ['20261021-1001', '20261021-1002', '20261021-1003', '20261021-1004']],
  '§7.3 day 视图游标分页：两页不重不漏（第二页仍按 statusUpdatedAt 倒序）');
  const bad = await api.call('order.listPartner', { view: 'nope' });
  t.check(bad.ok === false && bad.code === 'VALIDATION_FAILED',
    '§7.3 day 视图：非法 view 拒绝而非静默降级（不再接受未知视图）');
  const workbench = await api.call('order.listPartner', { view: 'workbench' });
  t.check(Object.keys(workbench.data).sort().join(',') === 'counts,list,nextCursor,summary,transferPending'
    && !('scope' in (workbench.data.summary || {}))
    && typeof (workbench.data.summary || {}).byStatus === 'object'
    && (workbench.data.summary || {}).byStatus !== null,
  '§7.3 workbench 视图零变化：顶层 5 键（+transferPending 角标）、summary 仍旧 D48 形状（byStatus，无 scope）');
}

const SERVER_ASSERTIONS = 9;
const EXPECTED_ASSERTIONS = SERVER_ASSERTIONS;

module.exports = { SERVER_ASSERTIONS, EXPECTED_ASSERTIONS, serverChecks };
