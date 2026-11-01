'use strict';
/**
 * tools/lib/order-partner-cases.js — selftest-order-partner 的 A 段用例表（order.listPartner 工作台）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-partner.js 已近满闸；A 段 31 条断言
 *   （响应形/counts 六项/视图/counts 稳定/keyword 含越窗命中/翻页/行内 actions[]/DTO 白名单/
 *   listCustomer 只增不改/CLOSED·SUSPENDED/isTest 隔离）逐字外移，主套件保留 B~H 断言段落。
 * 非独立套件：由 tools/selftest-order-partner.js require 后在其 A section 内调用
 *   （tools/lib 不参与 selftest 注册完整性闸）。
 * 口径：期望值逐字来自 docs/contract/V4_CONTRACT.md §5/§7、docs/data/V4_DATA_MODEL.md §2.5/§4.1/§7.5。
 */
const path = require('path');
const cases = require('../selftest-order-partner-cases');

const listPartnerHandler = require(path.join(cases.API, 'handlers/order/listPartner.js'));

const {
  NOW, HOUR, DAY, C1, P1, TEST_P, TEST_PID, COUNTS_KEYS, DTO_ROW_KEYS, DTO_BANNED_KEYS,
  ROLES, PARTNER_STATUS, VIEW_MODE, SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED,
  CANCELLED, EXCEPTION, apiOf, handlerCtxOf, orderDoc, world, pickRow, actionKeysOf,
  collectKeyPaths, expectCode, expectField
} = cases;

async function listPartnerChecks(t) {
  const db = world();
  db.seed('orders', [
    orderDoc('20261022-0001', SUBMITTED, { statusUpdatedAt: new Date(NOW - 500) }),
    orderDoc('20261022-0002', ACCEPTED, { statusUpdatedAt: new Date(NOW - 600), acceptedAt: new Date(NOW - 4000) }),
    orderDoc('20261022-0003', PICKED, {
      statusUpdatedAt: new Date(NOW - 700), acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 2000)
    }),
    orderDoc('20261022-0004', PICKED, {
      statusUpdatedAt: new Date(NOW - 800), acceptedAt: new Date(NOW - 40000), pickedAt: new Date(NOW - 20000)
    }),
    orderDoc('20261022-0005', DELIVERED, {
      statusUpdatedAt: new Date(NOW - 900), acceptedAt: new Date(NOW - 4000),
      pickedAt: new Date(NOW - 3000), deliveredAt: new Date(NOW - 900)
    }),
    orderDoc('20261022-0006', EXCEPTION, {
      statusUpdatedAt: new Date(NOW - 1000), acceptedAt: new Date(NOW - 5000),
      exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 1000) }
    }),
    orderDoc('20261022-0007', COMPLETED, {
      statusUpdatedAt: new Date(NOW - 2000), completedAt: new Date(NOW - 2000)
    }),
    orderDoc('20261022-0008', COMPLETED, {
      statusUpdatedAt: new Date(NOW - DAY - 3 * HOUR), completedAt: new Date(NOW - DAY - 3 * HOUR)
    }),
    orderDoc('20261022-0009', CANCELLED, {
      statusUpdatedAt: new Date(NOW - 3000), cancelledAt: new Date(NOW - 3000),
      cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER
    }),
    orderDoc('20261022-0010', COMPLETED, { isTest: true, statusUpdatedAt: new Date(NOW - 1000), completedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-0011', SUBMITTED, {
      statusUpdatedAt: new Date(NOW - 1500), customerId: '', customerOpenid: '', customerNo: '',
      source: 'PARTNER', phoneTail: '5678', dorm: null,
      guest: { displayName: '代客小张', phoneTail: '5678', zone: 'X', buildingNo: 2, buildingText: 'X2', room: '301', dormKey: 'X2-301' }
    }),
    orderDoc('20260901-0001', SUBMITTED, {
      statusUpdatedAt: new Date(NOW - 50 * DAY), createdAt: new Date(NOW - 50 * DAY),
      parcel: { pickupCode: 'OLD99' }
    })
  ]);
  const pApi = apiOf(db, P1);
  const cApi = apiOf(db, C1);

  const workbench = await pApi.call('order.listPartner', { view: 'workbench' });
  t.eq(Object.keys(workbench.data || {}).sort(), ['counts', 'list', 'nextCursor', 'summary'],
    'A1 listPartner 工作台响应顶层键 = counts/list/nextCursor/summary（summary 只增、无 groups/raw）');
  t.eq(Object.keys(workbench.data.counts).sort(), COUNTS_KEYS.slice().sort(),
    'A2 counts 恰为六项（submitted/accepted/picked/delivered/exception/todayCompleted）');
  t.eq(workbench.data.counts, {
    submitted: 3, accepted: 1, picked: 2, delivered: 1, exception: 1, todayCompleted: 1
  }, 'A3 counts 六项逐值精确（含 guest/历史单；测试单与昨日完成不计入）');
  const activeNos = workbench.data.list.map((row) => row.orderNo);
  t.eq(activeNos, ['20261022-0001', '20261022-0002', '20261022-0003', '20261022-0004',
    '20261022-0005', '20261022-0006', '20261022-0011', '20260901-0001'],
  'A4 workbench 只含进行中五态（不含 COMPLETED/CANCELLED），按 statusUpdatedAt desc');

  const filtered = await pApi.call('order.listPartner', {
    view: 'workbench', status: PICKED, keyword: '不存在的搜索词'
  });
  t.eq([filtered.data.list.length, filtered.data.counts], [0, workbench.data.counts],
    'A5 counts 为全量口径：不受 status/keyword 筛选影响（与列表同响应下发）');

  const history = await pApi.call('order.listPartner', { view: 'history' });
  t.eq(history.data.list.map((row) => row.orderNo), ['20261022-0007', '20261022-0009', '20261022-0008'],
    'A6 history 视图只含 COMPLETED/CANCELLED，按 statusUpdatedAt desc');
  t.eq(history.data.list.every((row) => actionKeysOf(row).length === 0), true,
    'A7 history 行不下发 actions（工作台行级快捷操作只服务 workbench，不扩大历史页面）');

  const byPick = await pApi.call('order.listPartner', { view: 'workbench', status: PICKED });
  t.eq(byPick.data.list.map((row) => row.orderNo), ['20261022-0003', '20261022-0004'],
    'A8 status 过滤生效（PICKED 两单，状态内按 statusUpdatedAt desc）');

  const byCode = await pApi.call('order.listPartner', { view: 'workbench', keyword: 'old99' });
  t.eq(byCode.data.list.map((row) => row.orderNo), ['20260901-0001'],
    'A9 keyword 命中取件码（大小写不敏感）');

  const byGuest = await pApi.call('order.listPartner', { view: 'workbench', keyword: '代客' });
  t.eq(byGuest.data.list.map((row) => row.orderNo), ['20261022-0011'],
    'A10 keyword 命中代客单 guest.displayName（工作台搜索含「称呼」）');

  await expectField(t, pApi.call('order.listPartner', { view: 'workbench', keyword: 'x'.repeat(41) }),
    'VALIDATION_FAILED', 'keyword', 'A11 keyword 超 40 字 → VALIDATION_FAILED 且 data.field=keyword');
  await expectField(t, pApi.call('order.listPartner', { view: 'bogus' }), 'VALIDATION_FAILED', 'view',
    'A12 非法 view → VALIDATION_FAILED 且 data.field=view');

  const pageNos = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const page = await pApi.call('order.listPartner', { view: 'workbench', limit: 2, cursor });
    page.data.list.forEach((row) => pageNos.push(row.orderNo));
    cursor = page.data.nextCursor;
    pages += 1;
    if (!cursor || pages > 10) {
      break;
    }
  }
  t.eq([pageNos, new Set(pageNos).size], [activeNos, activeNos.length],
    'A13 limit=2 游标翻页不重不漏（两页合计=全量且顺序一致）');

  const rowSub = pickRow(workbench.data.list, '20261022-0001');
  const rowAcc = pickRow(workbench.data.list, '20261022-0002');
  const rowPick = pickRow(workbench.data.list, '20261022-0003');
  const rowPickOld = pickRow(workbench.data.list, '20261022-0004');
  const rowDeliver = pickRow(workbench.data.list, '20261022-0005');
  const rowException = pickRow(workbench.data.list, '20261022-0006');
  t.check(workbench.data.list.every((row) => Array.isArray(row.actions) && row.actions.length > 0),
    'A14 workbench 每行内联 actions[] 非空（行级操作只消费服务端动作，前端不自行判定状态机）');
  t.eq(actionKeysOf(rowSub), ['accept', 'cancel', 'correct', 'message', 'reject'],
    'A15 SUBMITTED 行动作集（接单/拒单/补码/取消/留言）');
  t.eq(actionKeysOf(rowAcc), ['cancel', 'correct', 'exception', 'message', 'pick'],
    'A16 ACCEPTED 行动作集（已取件/异常/改码/取消/留言）');
  t.eq(actionKeysOf(rowPick), ['cancel', 'correct', 'deliver', 'exception', 'message', 'undoPick'],
    'A17 PICKED 行动作集含 5s 窗内 undoPick');
  t.eq(actionKeysOf(rowPickOld).indexOf('undoPick'), -1,
    'A18 超出 5s 窗的 PICKED 行不再广告 undoPick（窗口判定逐行）');
  t.eq(actionKeysOf(rowDeliver), ['cancel', 'exception', 'message', 'undoDeliver'],
    'A19 DELIVERED 行动作集含 undoDeliver、且不广告非法 correct（DELIVERED 不可补码）');
  t.eq(actionKeysOf(rowException), ['cancel', 'correct', 'message', 'resolve'],
    'A20 EXCEPTION 行动作集（解除异常/补码/取消/留言）');

  const detail = await pApi.call('order.get', { orderNo: '20261022-0005' });
  t.eq(actionKeysOf(detail.data.order), actionKeysOf(rowDeliver),
    'A21 同单详情与工作台行动作集一致（GET 与 LIST 同源矩阵）');
  t.eq(workbench.data.list.filter((row) => row.actions.some((item) => !item.label)).length, 0,
    'A22 行动作逐项带中文 label（页面零文案硬编码）');
  t.eq(workbench.data.list.map((row) => collectKeyPaths(row, DTO_BANNED_KEYS, '', [])).reduce((a, b) => a.concat(b), []),
    [], 'A23 工作台列表 DTO 递归零内部键（_id/openid/partnerId/requestKey/fileId/batchActionId…）');
  const extraKeys = [];
  workbench.data.list.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (DTO_ROW_KEYS.indexOf(key) < 0) {
        extraKeys.push(key);
      }
    });
  });
  t.eq(extraKeys, [], 'A24 行 DTO 顶层键全部在白名单（无 raw 文档字段泄漏）');

  const customerList = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS' });
  t.eq([customerList.data.list.length,
    customerList.data.list.every((row) => actionKeysOf(row).length === 0)],
  [7, true], 'A25 listCustomer「只增不改」：行 DTO 不新增 actions 内联（仍为空数组）');

  const oldTargetDb = world();
  const filler = [];
  for (let i = 0; i < 70; i += 1) {
    filler.push(orderDoc('20261022-5' + String(i).padStart(3, '0'), SUBMITTED,
      { statusUpdatedAt: new Date(NOW - i * 1000) }));
  }
  oldTargetDb.seed('orders', filler.concat([orderDoc('20260801-0001', SUBMITTED, {
    statusUpdatedAt: new Date(NOW - 80 * DAY),
    parcel: { pickupCode: 'FAR77' }
  })]));
  const farHit = await apiOf(oldTargetDb, P1).call('order.listPartner', {
    view: 'workbench', keyword: '20260801-0001'
  });
  t.eq(farHit.data.list.map((row) => row.orderNo), ['20260801-0001'],
    'A26 完整订单号命中扫描窗之外的旧单（索引精确查询兜底，不再被 300 条窗口截断漏单）');

  const closedDb = world({ partnerStatus: PARTNER_STATUS.CLOSED });
  await expectCode(t, apiOf(closedDb, P1).call('order.listPartner', { view: 'workbench' }), 'PARTNER_CLOSED',
    'A27 CLOSED 兼职查工作台 → PARTNER_CLOSED（停用/注销不返回业务数据）');
  const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED });
  await expectCode(t, apiOf(suspendedDb, P1).call('order.listPartner', { view: 'workbench' }), 'PARTNER_CLOSED',
    'A28 SUSPENDED 兼职查工作台 → PARTNER_CLOSED');
  await expectCode(t, cApi.call('order.listPartner', { view: 'workbench' }), 'FORBIDDEN',
    'A29 顾客调 order.listPartner → FORBIDDEN（仅兼职身份可查工作台）');

  const isoDb = world();
  isoDb.seed('orders', [
    orderDoc('20261022-6001', SUBMITTED),
    orderDoc('20261022-6002', COMPLETED, { completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-6003', SUBMITTED, { isTest: true, partnerId: TEST_PID, partnerOpenid: TEST_P }),
    orderDoc('20261022-6004', COMPLETED, {
      isTest: true, partnerId: TEST_PID, partnerOpenid: TEST_P,
      completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000)
    })
  ]);
  const realView = await apiOf(isoDb, P1).call('order.listPartner', { view: 'workbench' });
  t.eq([realView.data.list.map((row) => row.orderNo), realView.data.counts],
    [['20261022-6001'], { submitted: 1, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 1 }],
  'A30 真实会话：测试单不进列表也不进 counts（isTest 隔离）');
  const testView = await listPartnerHandler(
    handlerCtxOf(isoDb, TEST_P, { role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, developerNo: 'DEV-01' }),
    { view: 'workbench' }
  );
  t.eq([testView.list.map((row) => row.orderNo), testView.counts],
    [['20261022-6003'], { submitted: 1, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 1 }],
  'A31 TEST_WRITE 会话：只见测试单，counts 也独立成口径');
}

module.exports = { listPartnerChecks };
