'use strict';
/**
 * tools/selftest-order-partner.js — 批 6-A「兼职工作台」云端侧断言套件（task-68；A~H）。
 *
 * A. order.listPartner：响应形/counts 六项精确/视图/counts 稳定/keyword（含完整单号越窗命中）/翻页/
 *    行内 actions[]（workbench 五态 + 5s undo 窗、history 不发）/DTO 白名单/listCustomer 只增不改/
 *    CLOSED·SUSPENDED/isTest 隔离。
 * B. accept/reject：状态迁移+事件+版本、幂等、非法状态、越权、乐观锁、READONLY。
 * C. markPicked：码/DROP_OFF、batchActionId 落库与清空与形态闸、expectedVersion。
 * D. markDelivered：deliveryNote 落库/上限、状态闸、幂等、batchActionId、行内动作。
 * E. unmarkPicked/unmarkDelivered/undo：清时间戳与备注、事件 undoneAction 两入口一致、5s 边界、
 *    后续事件/顾客已确认拒绝、重放幂等、batchActionId、越权。
 * F. correct：字段白名单/状态限制/补码 note/batchActionId/越权。
 * G. reportException/resolveException：fromStatus/OTHER 必填/长度/恢复口径/越权。
 * H. 越权/终态/CLOSED·SUSPENDED 六动作矩阵/isTest 隔离/服务端动作矩阵合法/静态纪律（db.collection、
 *    零金额扫描、事件 requestKey 唯一）。
 *
 * 夹具/期望值在 ./selftest-order-partner-cases.js（两文件都受门禁 #18 ≤1000 行约束）。
 * 纪律：fake DB + 真实 handler/api，不 mock 全局 wx、不连真实网络；先合法基线再反例，样本非空；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 限流（order.correct 20 次/日/订单等）属 middleware 计数，按 task-68 口径不在本套件测真限流逻辑。
 * 取数：node tools/selftest-order-partner.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { createHarness, installCrashGuard } = require('./selftest');const zeroMoney = require('./zero-money-scan');
const cases = require('./selftest-order-partner-cases');

const ORDERS_DIR = path.join(cases.API, 'handlers/order');
const orderState = require(path.join(cases.API, 'shared/order-state.js'));
const listPartnerHandler = require(path.join(ORDERS_DIR, 'listPartner.js'));
const acceptHandler = require(path.join(ORDERS_DIR, 'accept.js'));

const {
  EXPECTED_ASSERTIONS, NOW, HOUR, DAY, C1, P1, PID1, C2, P2, PID2, TEST_C, TEST_P, TEST_PID,
  TEMP_URL, CODE_FILLED_NOTE, COUNTS_KEYS, DTO_ROW_KEYS, DTO_BANNED_KEYS, ROLES, PARTNER_STATUS,
  ORDER_STATUS, VIEW_MODE, CODE_STATUS, USER_STATUS, SUBMITTED, ACCEPTED, PICKED, DELIVERED,
  COMPLETED, CANCELLED, EXCEPTION, ROOT,
  uniqueIndexesForApi, createTestDb, cloudStub, apiOf, apiOfAt, handlerCtxOf, nextCrid, iso,
  userDoc, customerDoc, partnerDoc, bindingDoc, orderDoc, world, eventsFor, allEventsOf, rowsOf,
  rowOf, versionsOf, pickRow, actionKeysOf, collectKeyPaths, expectCode, expectField, errorCodeOf,
  handlerFiles, relOf, closedPartnerMatrix, actionNameOfKey
} = cases;

// ---------------------------------------------------------------- A. listPartner
async function sectionA(h) {
  h.section('A. order.listPartner：counts 六项/视图/counts 稳定/keyword/翻页/行内 actions/隔离', async (t) => {
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
    t.eq(Object.keys(workbench.data || {}).sort(), ['counts', 'list', 'nextCursor'],
      'A1 listPartner 响应顶层键恰为 counts/list/nextCursor');
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
  });
}

// ---------------------------------------------------------------- B. accept / reject
async function sectionB(h) {
  h.section('B. order.accept / order.reject：合法基线/幂等/非法状态/越权/乐观锁/READONLY', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0101', SUBMITTED),
      orderDoc('20261022-0102', SUBMITTED),
      orderDoc('20261022-0103', PICKED, { pickedAt: new Date(NOW - 1000), acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0104', SUBMITTED, { partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB' }),
      orderDoc('20261022-0105', SUBMITTED),
      orderDoc('20261022-0106', SUBMITTED),
      orderDoc('20261022-0107', SUBMITTED)
    ]);
    const pApi = apiOf(db, P1);

    const cridAccept = nextCrid('accept');
    const accepted = await pApi.call('order.accept', { orderNo: '20261022-0101' }, { clientRequestId: cridAccept });
    t.eq([accepted.ok, accepted.data.order.status, accepted.data.order.acceptedAt, accepted.data.order.version],
      [true, ACCEPTED, iso(NOW), 4], 'B1 accept SUBMITTED→ACCEPTED（acceptedAt=server now、version+1）');
    const acceptRow = rowOf(db, '20261022-0101');
    const acceptEvents = eventsFor(db, '20261022-0101');
    t.eq([new Date(acceptRow.acceptedAt).getTime(), acceptEvents.map((event) => [event.type, event.fromStatus,
      event.toStatus, event.actorRole])],
    [NOW, [['ACCEPTED', SUBMITTED, ACCEPTED, ROLES.PARTNER]]], 'B2 落库 acceptedAt + 恰一条 ACCEPTED 事件');

    const replay = await pApi.call('order.accept', { orderNo: '20261022-0101' }, { clientRequestId: cridAccept });
    t.eq([replay.data.duplicated, eventsFor(db, '20261022-0101').length, rowOf(db, '20261022-0101').version],
      [true, 1, 4], 'B3 同 clientRequestId 重放 → duplicated=true 且零重复落库');
    await expectCode(t, pApi.call('order.accept', { orderNo: '20261022-0101' },
      { clientRequestId: nextCrid('accept-again') }), 'INVALID_TRANSITION',
    'B4 已接单再次 accept（新请求键）→ INVALID_TRANSITION');
    await expectCode(t, pApi.call('order.accept', { orderNo: '20261022-0103' },
      { clientRequestId: nextCrid('accept-pick') }), 'INVALID_TRANSITION', 'B5 非 SUBMITTED 状态 accept → INVALID_TRANSITION');
    await expectCode(t, apiOf(db, C1).call('order.accept', { orderNo: '20261022-0102' },
      { clientRequestId: nextCrid('accept-customer') }), 'FORBIDDEN', 'B6 顾客调 order.accept → FORBIDDEN（角色越界）');
    await expectCode(t, pApi.call('order.accept', { orderNo: '20261022-0104' },
      { clientRequestId: nextCrid('accept-other') }), 'FORBIDDEN', 'B7 兼职 A 接他人订单 → FORBIDDEN');

    const rejected = await pApi.call('order.reject', { orderNo: '20261022-0102', reason: 'TOO_BUSY' },
      { clientRequestId: nextCrid('reject') });
    const rejectRow = rowOf(db, '20261022-0102');
    const rejectEvents = eventsFor(db, '20261022-0102');
    t.eq([rejected.data.order.status, rejectRow.cancelReason, rejectRow.cancelledBy,
      rejectEvents.map((event) => [event.type, event.payload && event.payload.reason, event.note])],
    [CANCELLED, 'TOO_BUSY', ROLES.PARTNER, [['REJECTED', 'TOO_BUSY', '忙不过来']]],
    'B8 reject SUBMITTED→CANCELLED（cancelReason/cancelledBy/REJECTED 事件 payload.reason + 中文 note）');
    await expectField(t, pApi.call('order.reject', { orderNo: '20261022-0105', reason: 'NOT_A_REASON' },
      { clientRequestId: nextCrid('reject-bad') }), 'VALIDATION_FAILED', 'reason',
    'B9 非法拒单原因 → VALIDATION_FAILED 且 data.field=reason');
    await expectField(t, pApi.call('order.reject', { orderNo: '20261022-0106', reason: 'OTHER' },
      { clientRequestId: nextCrid('reject-other') }), 'VALIDATION_FAILED', 'note',
    'B10 OTHER 原因缺备注 → VALIDATION_FAILED 且 data.field=note');

    const stale = await pApi.call('order.accept', { orderNo: '20261022-0107' },
      { clientRequestId: nextCrid('accept-stale'), expectedVersion: 2 });
    t.eq([stale.ok, stale.code, eventsFor(db, '20261022-0107').length, rowOf(db, '20261022-0107').status],
      [false, 'CONFLICT', 0, SUBMITTED], 'B11 expectedVersion 过期 → CONFLICT 且零落库（仍 SUBMITTED/无事件）');
    const fresh = await pApi.call('order.accept', { orderNo: '20261022-0107' },
      { clientRequestId: nextCrid('accept-fresh'), expectedVersion: 3 });
    t.eq([fresh.ok, fresh.data.order.version], [true, 4],
      'B12 expectedVersion 命中 → 成功且 version=期望值+1（乐观锁可正常放行）');

    const readOnlyCtx = handlerCtxOf(db, P1, { role: ROLES.PARTNER, viewMode: VIEW_MODE.READONLY });
    t.eq(await errorCodeOf(acceptHandler(readOnlyCtx, { orderNo: '20261022-0105' })), 'FORBIDDEN',
      'B13 READONLY 只读视角写动作在 handler 层也拒绝 → FORBIDDEN（双保险）');
  });
}

// ---------------------------------------------------------------- C. markPicked
async function sectionC(h) {
  h.section('C. order.markPicked：码/DROP_OFF/非法状态/batchActionId/expectedVersion', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0201', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0202', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000),
        parcel: { pickupCode: '', codeStatus: CODE_STATUS.NEED_CODE }
      }),
      orderDoc('20261022-0203', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000), service: { code: 'DROP_OFF', name: '代寄快递' },
        parcel: { pickupCode: '', codeStatus: CODE_STATUS.NEED_CODE }
      }),
      orderDoc('20261022-0204', SUBMITTED),
      orderDoc('20261022-0205', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0206', ACCEPTED, { acceptedAt: new Date(NOW - 2000), batchActionId: 'BATCH-OLD-0001' }),
      orderDoc('20261022-0207', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0208', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0209', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0210', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0211', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000), partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB'
      })
    ]);
    const pApi = apiOf(db, P1);

    const picked = await pApi.call('order.markPicked', { orderNo: '20261022-0201' },
      { clientRequestId: nextCrid('pick') });
    t.eq([picked.ok, picked.data.order.status, picked.data.order.pickedAt, picked.data.order.version],
      [true, PICKED, iso(NOW), 4], 'C1 markPicked ACCEPTED→PICKED（pickedAt=server now、version+1）');
    t.eq(eventsFor(db, '20261022-0201').map((event) => [event.type, event.fromStatus, event.toStatus]),
      [['PICKED', ACCEPTED, PICKED]], 'C2 恰一条 PICKED 事件（from/to 正确）');

    const needCode = await pApi.call('order.markPicked', { orderNo: '20261022-0202' },
      { clientRequestId: nextCrid('pick-need') });
    t.eq([needCode.ok, needCode.code, rowOf(db, '20261022-0202').status,
      eventsFor(db, '20261022-0202').length], [false, 'INVALID_STATE', ACCEPTED, 0],
    'C3 NEED_CODE 无码非 DROP_OFF → INVALID_STATE（需先补码），零落库');

    const dropOff = await pApi.call('order.markPicked', { orderNo: '20261022-0203' },
      { clientRequestId: nextCrid('pick-drop') });
    t.eq([dropOff.ok, dropOff.data.order.status], [true, PICKED],
      'C4 代寄（DROP_OFF）无取件码 → 允许标记已取件');

    await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0204' },
      { clientRequestId: nextCrid('pick-sub') }), 'INVALID_TRANSITION', 'C5 SUBMITTED 直接 markPicked → INVALID_TRANSITION');
    await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0211' },
      { clientRequestId: nextCrid('pick-other') }), 'FORBIDDEN', 'C6 兼职 A 标记他人订单 → FORBIDDEN');

    const batched = await pApi.call('order.markPicked', {
      orderNo: '20261022-0205', batchActionId: 'BATCH-PICK-0001'
    }, { clientRequestId: nextCrid('pick-batch') });
    t.eq([batched.ok, rowOf(db, '20261022-0205').batchActionId], [true, 'BATCH-PICK-0001'],
      'C7 批量动作：batchActionId 按契约落 orders 文档（同批 id 可审计判定）');
    const single = await pApi.call('order.markPicked', { orderNo: '20261022-0206' },
      { clientRequestId: nextCrid('pick-single') });
    t.eq([single.ok, rowOf(db, '20261022-0206').batchActionId], [true, ''],
      'C8 单次（无 batchActionId）动作清空旧批次归属，避免把后续单次操作误归到旧批次');

    await expectField(t, pApi.call('order.markPicked', {
      orderNo: '20261022-0207', batchActionId: 'B'.repeat(33)
    }, { clientRequestId: nextCrid('pick-bad-long') }), 'VALIDATION_FAILED', 'batchActionId',
    'C9 batchActionId 超 32 位 → VALIDATION_FAILED 且 data.field=batchActionId（零落库）');
    await expectField(t, pApi.call('order.markPicked', {
      orderNo: '20261022-0208', batchActionId: 'bad/id:1'
    }, { clientRequestId: nextCrid('pick-bad-char') }), 'VALIDATION_FAILED', 'batchActionId',
    'C10 batchActionId 非法字符 → VALIDATION_FAILED（防注入任意串进 L2 字段）');
    await expectField(t, pApi.call('order.markPicked', {
      orderNo: '20261022-0209', batchActionId: 12345
    }, { clientRequestId: nextCrid('pick-bad-type') }), 'VALIDATION_FAILED', 'batchActionId',
    'C11 batchActionId 非字符串 → VALIDATION_FAILED');
    t.eq([rowOf(db, '20261022-0207').version, rowOf(db, '20261022-0208').status,
      eventsFor(db, '20261022-0209').length], [3, ACCEPTED, 0],
    'C12 形态闸失败整单零落库（version 未变/状态未变/无事件）');

    const stale = await pApi.call('order.markPicked', { orderNo: '20261022-0210' },
      { clientRequestId: nextCrid('pick-stale'), expectedVersion: 2 });
    t.eq([stale.ok, stale.code, rowOf(db, '20261022-0210').status, eventsFor(db, '20261022-0210').length],
      [false, 'CONFLICT', ACCEPTED, 0], 'C13 expectedVersion 过期 → CONFLICT 且零落库');
    const fresh = await pApi.call('order.markPicked', { orderNo: '20261022-0210' },
      { clientRequestId: nextCrid('pick-fresh'), expectedVersion: 3 });
    t.eq([fresh.ok, fresh.data.order.version], [true, 4], 'C14 expectedVersion 命中 → 成功且 version+1');
  });
}

// ---------------------------------------------------------------- D. markDelivered
async function sectionD(h) {
  h.section('D. order.markDelivered：deliveryNote/状态闸/幂等/batchActionId/行内动作', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0301', PICKED, {
        acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000)
      }),
      orderDoc('20261022-0302', PICKED, {
        acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000)
      }),
      orderDoc('20261022-0303', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0304', PICKED, { acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0305', PICKED, { acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000) })
    ]);
    const pApi = apiOf(db, P1);
    const cridDeliver = nextCrid('deliver');

    const delivered = await pApi.call('order.markDelivered', {
      orderNo: '20261022-0301', deliveryNote: '放门口'
    }, { clientRequestId: cridDeliver });
    const deliverRow = rowOf(db, '20261022-0301');
    const deliverEvents = eventsFor(db, '20261022-0301');
    t.eq([delivered.data.order.status, delivered.data.order.deliveredAt, new Date(deliverRow.deliveredAt).getTime(),
      deliverRow.deliveryNote, deliverEvents.map((event) => [event.type, event.note, event.payload && event.payload.deliveryNote])],
    [DELIVERED, iso(NOW), NOW, '放门口', [['DELIVERED', '放门口', '放门口']]],
    'D1 markDelivered PICKED→DELIVERED（deliveredAt/deliveryNote 落库 + 事件 note/payload）');
    await expectField(t, pApi.call('order.markDelivered', {
      orderNo: '20261022-0302', deliveryNote: 'x'.repeat(101)
    }, { clientRequestId: nextCrid('deliver-long') }), 'VALIDATION_FAILED', 'deliveryNote',
    'D2 deliveryNote >100 字 → VALIDATION_FAILED 且 data.field=deliveryNote');
    await expectCode(t, pApi.call('order.markDelivered', { orderNo: '20261022-0303' },
      { clientRequestId: nextCrid('deliver-acc') }), 'INVALID_TRANSITION', 'D3 非 PICKED 状态 markDelivered → INVALID_TRANSITION');
    const replay = await pApi.call('order.markDelivered', {
      orderNo: '20261022-0301', deliveryNote: '放门口'
    }, { clientRequestId: cridDeliver });
    t.eq([replay.data.duplicated, eventsFor(db, '20261022-0301').length, rowOf(db, '20261022-0301').version],
      [true, 1, 4], 'D4 同 clientRequestId 重放 → duplicated=true 且零重复事件');
    const batched = await pApi.call('order.markDelivered', {
      orderNo: '20261022-0304', batchActionId: 'BATCH-DELIVER-01'
    }, { clientRequestId: nextCrid('deliver-batch') });
    t.eq([batched.ok, rowOf(db, '20261022-0304').batchActionId], [true, 'BATCH-DELIVER-01'],
      'D5 送达批量：batchActionId 落 orders 文档');
    const rowDelivered = pickRow((await pApi.call('order.listPartner', { view: 'workbench' })).data.list, '20261022-0301');
    t.eq(actionKeysOf(rowDelivered), ['cancel', 'exception', 'message', 'undoDeliver'],
      'D6 送达后工作台行动作：含 5s 内 undoDeliver、不含非法 correct');
    t.eq(delivered.data.order.needCode, false, 'D7 送达单 DTO needCode=false（取件码已就绪）');

    const db2 = world();
    db2.seed('orders', [orderDoc('20261022-0306', PICKED, {
      acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000)
    })]);
    const pApi2 = apiOf(db2, P1);
    const first = await pApi2.call('order.markDelivered', { orderNo: '20261022-0306' },
      { clientRequestId: nextCrid('deliver-dup-a') });
    const second = await pApi2.call('order.markDelivered', { orderNo: '20261022-0306' },
      { clientRequestId: nextCrid('deliver-dup-b') });
    t.eq([first.ok, second.ok, second.code, eventsFor(db2, '20261022-0306').length],
      [true, false, 'INVALID_TRANSITION', 1], 'D8 已送达后不同请求键再送达 → INVALID_TRANSITION（幂等只认同键）');
  });
}

// ---------------------------------------------------------------- E. unmark / undo
async function sectionE(h) {
  h.section('E. unmarkPicked/unmarkDelivered/order.undo：事件一致/5s 边界/后续事件/已确认/重放/批量 id', async (t) => {
    const db = world();
    const pickedEvent = {
      _id: 'ev-e1', orderId: 'o-20261022-0401', orderNo: '20261022-0401', type: 'PICKED',
      fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1, at: new Date(NOW - 2000),
      note: '', payload: {}, requestKey: 'rk-ev-e1'
    };
    const deliveredEvent = {
      _id: 'ev-e2', orderId: 'o-20261022-0402', orderNo: '20261022-0402', type: 'DELIVERED',
      fromStatus: PICKED, toStatus: DELIVERED, actorRole: ROLES.PARTNER, actorId: P1, at: new Date(NOW - 1500),
      note: '放门口', payload: { deliveryNote: '放门口' }, requestKey: 'rk-ev-e2'
    };
    db.seed('orders', [
      orderDoc('20261022-0401', PICKED, {
        acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000)
      }),
      orderDoc('20261022-0402', DELIVERED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 3000),
        deliveredAt: new Date(NOW - 1500), deliveryNote: '放门口'
      }),
      orderDoc('20261022-0403', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0404', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0405', PICKED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 3000)
      }),
      orderDoc('20261022-0406', PICKED, {
        acceptedAt: new Date(NOW - 9000), pickedAt: new Date(NOW - 5000)
      }),
      orderDoc('20261022-0407', PICKED, {
        acceptedAt: new Date(NOW - 9000), pickedAt: new Date(NOW - 5001)
      }),
      orderDoc('20261022-0408', PICKED, {
        acceptedAt: new Date(NOW - 9000), pickedAt: new Date(NOW - 1000)
      }),
      orderDoc('20261022-0409', DELIVERED, {
        acceptedAt: new Date(NOW - 5000), pickedAt: new Date(NOW - 4000),
        deliveredAt: new Date(NOW - 3000), deliveryNote: '放门口'
      }),
      orderDoc('20261022-0410', SUBMITTED),
      orderDoc('20261022-0411', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0412', PICKED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 1000)
      }),
      orderDoc('20261022-0413', PICKED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 1000),
        partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB'
      })
    ]);
    db.seed('order_events', [
      pickedEvent,
      deliveredEvent,
      {
        _id: 'ev-e6', orderId: 'o-20261022-0406', orderNo: '20261022-0406', type: 'PICKED',
        fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
        at: new Date(NOW - 5000), note: '', payload: {}, requestKey: 'rk-ev-e6'
      },
      {
        _id: 'ev-e7', orderId: 'o-20261022-0407', orderNo: '20261022-0407', type: 'PICKED',
        fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
        at: new Date(NOW - 5001), note: '', payload: {}, requestKey: 'rk-ev-e7'
      },
      {
        _id: 'ev-e8a', orderId: 'o-20261022-0408', orderNo: '20261022-0408', type: 'PICKED',
        fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
        at: new Date(NOW - 1000), note: '', payload: {}, requestKey: 'rk-ev-e8a'
      },
      {
        _id: 'ev-e8b', orderId: 'o-20261022-0408', orderNo: '20261022-0408', type: 'ORDER_CORRECTED',
        fromStatus: PICKED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
        at: new Date(NOW - 600), note: '', payload: {}, requestKey: 'rk-ev-e8b'
      },
      {
        _id: 'ev-e12', orderId: 'o-20261022-0412', orderNo: '20261022-0412', type: 'PICKED',
        fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
        at: new Date(NOW - 1000), note: '', payload: {}, requestKey: 'rk-ev-e12'
      },
      {
        _id: 'ev-e13', orderId: 'o-20261022-0413', orderNo: '20261022-0413', type: 'PICKED',
        fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P2,
        at: new Date(NOW - 1000), note: '', payload: {}, requestKey: 'rk-ev-e13'
      }
    ]);
    const pApi = apiOf(db, P1);
    const cApi = apiOf(db, C1);

    const unmarked = await pApi.call('order.unmarkPicked', { orderNo: '20261022-0401' },
      { clientRequestId: nextCrid('unpick') });
    const unpickEvent = eventsFor(db, '20261022-0401').filter((event) => event.type === 'PICKED_REVERTED')[0] || {};
    t.eq([unmarked.data.order.status, rowOf(db, '20261022-0401').pickedAt, unmarked.data.order.pickedAt,
      unpickEvent.type, unpickEvent.fromStatus, unpickEvent.toStatus,
      unpickEvent.payload && unpickEvent.payload.undoneAction,
      unpickEvent.payload && new Date(unpickEvent.payload.previousAt).getTime()],
    [ACCEPTED, null, '', 'PICKED_REVERTED', PICKED, ACCEPTED, 'order.markPicked', NOW - 2000],
    'E1 unmarkPicked PICKED→ACCEPTED（清 pickedAt；DTO 不出现假时间；事件 undoneAction=order.markPicked + previousAt）');
    await expectCode(t, pApi.call('order.unmarkPicked', { orderNo: '20261022-0403' },
      { clientRequestId: nextCrid('unpick-bad') }), 'INVALID_TRANSITION', 'E2 非 PICKED 状态 unmarkPicked → INVALID_TRANSITION');

    const undelivered = await pApi.call('order.unmarkDelivered', { orderNo: '20261022-0402' },
      { clientRequestId: nextCrid('undeliver') });
    const undeliverEvent = eventsFor(db, '20261022-0402')
      .filter((event) => event.type === 'DELIVERED_REVERTED')[0] || {};
    t.eq([undelivered.data.order.status, rowOf(db, '20261022-0402').deliveredAt,
      rowOf(db, '20261022-0402').deliveryNote, undeliverEvent.fromStatus, undeliverEvent.toStatus,
      undeliverEvent.payload && undeliverEvent.payload.undoneAction],
    [PICKED, null, '', DELIVERED, PICKED, 'order.markDelivered'],
    'E3 unmarkDelivered DELIVERED→PICKED（清 deliveredAt/deliveryNote；事件 undoneAction=order.markDelivered）');

    const undoPickApi = apiOf(db, P1);
    const pickCrid = nextCrid('undo-pick-mark');
    await undoPickApi.call('order.markPicked', { orderNo: '20261022-0404' }, { clientRequestId: pickCrid });
    const undone = await undoPickApi.call('order.undo', { orderNo: '20261022-0404' },
      { clientRequestId: nextCrid('undo-pick') });
    const undoPickEvent = eventsFor(db, '20261022-0404').filter((event) => event.type === 'PICKED_REVERTED')[0] || {};
    t.eq([undone.data.order.status, undone.data.undoneAction, rowOf(db, '20261022-0404').pickedAt,
      undoPickEvent.payload && undoPickEvent.payload.undoneAction],
    [ACCEPTED, 'order.markPicked', null, 'order.markPicked'],
    'E4 order.undo（markPicked 后）PICKED→ACCEPTED，回包 undoneAction + 事件 payload 一致');

    const deliverCrid = nextCrid('undo-deliver-mark');
    await undoPickApi.call('order.markDelivered', { orderNo: '20261022-0405', deliveryNote: '放门口' },
      { clientRequestId: deliverCrid });
    const undoDeliver = await undoPickApi.call('order.undo', { orderNo: '20261022-0405' },
      { clientRequestId: nextCrid('undo-deliver') });
    t.eq([undoDeliver.data.order.status, undoDeliver.data.order.deliveredAt, undoDeliver.data.order.deliveryNote,
      undoDeliver.data.undoneAction], [PICKED, '', '', 'order.markDelivered'],
    'E5 order.undo（markDelivered 后）DELIVERED→PICKED 且清 deliveredAt/deliveryNote（与 unmarkDelivered 同口径）');

    const boundary = await pApi.call('order.undo', { orderNo: '20261022-0406' },
      { clientRequestId: nextCrid('undo-5000') });
    t.eq([boundary.ok, boundary.data.order.status, boundary.data.undoneAction], [true, ACCEPTED, 'order.markPicked'],
      'E6 5 秒窗边界：恰好 5000ms 仍允许撤销');
    const tooLate = await pApi.call('order.undo', { orderNo: '20261022-0407' },
      { clientRequestId: nextCrid('undo-5001') });
    t.eq([tooLate.ok, tooLate.code, rowOf(db, '20261022-0407').status,
      eventsFor(db, '20261022-0407').length], [false, 'INVALID_STATE', PICKED, 1],
    'E7 5001ms 超窗 → INVALID_STATE 且零落库');
    await expectCode(t, pApi.call('order.undo', { orderNo: '20261022-0408' },
      { clientRequestId: nextCrid('undo-later') }), 'INVALID_STATE',
    'E8 动作后有后续事件（ORDER_CORRECTED）→ INVALID_STATE（仅「无后续变化」可撤）');

    const confirmCrid = nextCrid('confirm-deliver');
    await cApi.call('order.confirmDelivery', { orderNo: '20261022-0409' }, { clientRequestId: confirmCrid });
    const afterConfirm = await pApi.call('order.undo', { orderNo: '20261022-0409' },
      { clientRequestId: nextCrid('undo-confirmed') });
    t.eq([afterConfirm.ok, afterConfirm.code, String(afterConfirm.message || '').indexOf('INVALID_')],
      [false, 'INVALID_TRANSITION', -1],
    'E9 顾客已确认送达（COMPLETED）后 undo → INVALID_TRANSITION 且文案为中文真话（不暴露错误码英文）');
    await pApi.call('order.accept', { orderNo: '20261022-0410' }, { clientRequestId: nextCrid('undo-accept-mark') });
    await expectCode(t, pApi.call('order.undo', { orderNo: '20261022-0410' },
      { clientRequestId: nextCrid('undo-accept') }), 'INVALID_TRANSITION',
    'E10 接单不可撤销（ACCEPTED 单 undo → INVALID_TRANSITION，误接单走 cancel）');

    const idemDb = world();
    idemDb.seed('orders', [orderDoc('20261022-0414', PICKED, {
      acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 1000)
    })]);
    idemDb.seed('order_events', [{
      _id: 'ev-e14', orderId: 'o-20261022-0414', orderNo: '20261022-0414', type: 'PICKED',
      fromStatus: ACCEPTED, toStatus: PICKED, actorRole: ROLES.PARTNER, actorId: P1,
      at: new Date(NOW - 1000), note: '', payload: {}, requestKey: 'rk-ev-e14'
    }]);
    const idemApi = apiOf(idemDb, P1);
    const undoCrid = nextCrid('undo-idem');
    const firstUndo = await idemApi.call('order.undo', { orderNo: '20261022-0414' }, { clientRequestId: undoCrid });
    const secondUndo = await idemApi.call('order.undo', { orderNo: '20261022-0414' }, { clientRequestId: undoCrid });
    t.eq([firstUndo.ok, secondUndo.data.duplicated, eventsFor(idemDb, '20261022-0414').length,
      rowOf(idemDb, '20261022-0414').version], [true, true, 2, 4],
    'E11 同 clientRequestId 重放 undo → duplicated=true 且不重复回退/不重复写事件');

    const undoBatch = await pApi.call('order.undo', {
      orderNo: '20261022-0412', batchActionId: 'BATCH-UNDO-0001'
    }, { clientRequestId: nextCrid('undo-batch') });
    t.eq([undoBatch.ok, rowOf(db, '20261022-0412').batchActionId], [true, 'BATCH-UNDO-0001'],
      'E12 undo 携带 batchActionId → 落 orders 文档（撤销批次可审计）');

    const consistency = eventsFor(db, '20261022-0404')
      .filter((event) => event.type === 'PICKED_REVERTED')[0] || {};
    t.eq([unpickEvent.payload && unpickEvent.payload.undoneAction,
      consistency.payload && consistency.payload.undoneAction], ['order.markPicked', 'order.markPicked'],
    'E13 unmarkPicked 与 undo 两入口的 PICKED_REVERTED.undoneAction 一致（都是被撤销动作名）');
    t.eq([undeliverEvent.payload && undeliverEvent.payload.undoneAction,
      undoDeliver.data.undoneAction], ['order.markDelivered', 'order.markDelivered'],
    'E14 unmarkDelivered 与 undo 两入口的 DELIVERED_REVERTED.undoneAction 一致');

    await expectCode(t, pApi.call('order.undo', { orderNo: '20261022-0413' },
      { clientRequestId: nextCrid('undo-other') }), 'FORBIDDEN', 'E15 兼职 A 撤销他人订单 → FORBIDDEN');
    await expectField(t, pApi.call('order.undo', { orderNo: 'BAD-NO' },
      { clientRequestId: nextCrid('undo-badno') }), 'VALIDATION_FAILED', 'orderNo',
    'E16 非法订单号 → VALIDATION_FAILED 且 data.field=orderNo');
  });
}

// ---------------------------------------------------------------- F. correct
async function sectionF(h) {
  h.section('F. order.correct：字段白名单/状态限制/补码 note/batchActionId/越权', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0501', SUBMITTED),
      orderDoc('20261022-0502', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000),
        parcel: { pickupCode: '', codeStatus: CODE_STATUS.NEED_CODE }
      }),
      orderDoc('20261022-0503', PICKED, { acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0504', PICKED, { acceptedAt: new Date(NOW - 3000), pickedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0505', DELIVERED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 3000), deliveredAt: new Date(NOW - 2000)
      }),
      orderDoc('20261022-0506', SUBMITTED),
      orderDoc('20261022-0507', SUBMITTED),
      orderDoc('20261022-0508', EXCEPTION, {
        acceptedAt: new Date(NOW - 5000),
        exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 2000) }
      }),
      orderDoc('20261022-0509', SUBMITTED, { partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB' })
    ]);
    const pApi = apiOf(db, P1);

    const corrected = await pApi.call('order.correct', {
      orderNo: '20261022-0501', patch: { stationId: 'P4', pickupCode: 'B67890' }
    }, { clientRequestId: nextCrid('correct') });
    const correctRow = rowOf(db, '20261022-0501');
    const correctEvent = eventsFor(db, '20261022-0501')[0] || {};
    t.eq([corrected.ok, corrected.data.correctedFields, corrected.data.order.status,
      correctRow.parcel.stationId, correctRow.parcel.pickupCode, correctRow.parcel.codeStatus,
      correctRow.parcel.recognitionSource, correctRow.parcel.confidence, correctRow.version],
    [true, ['stationId', 'pickupCode'], SUBMITTED, 'P4', 'B67890', CODE_STATUS.OK, 'MANUAL', '', 4],
    'F1 correct 全字段（站点+码）落库：recognitionSource=MANUAL、confidence 清空、状态不变、version+1');
    t.eq([correctEvent.type, Object.keys(correctEvent.payload || {}).sort(), correctEvent.note],
      ['ORDER_CORRECTED', ['after', 'before', 'itemIndex'], ''],
    'F2 ORDER_CORRECTED 事件 payload 含 before/after/itemIndex（v1.0 逐件定位）、非补码 note 为空');

    const filled = await pApi.call('order.correct', { orderNo: '20261022-0502', patch: { pickupCode: 'C12345' } },
      { clientRequestId: nextCrid('correct-fill') });
    const fillEvent = eventsFor(db, '20261022-0502')[0] || {};
    t.eq([filled.ok, fillEvent.note, fillEvent.payload && fillEvent.payload.codeStatusChanged,
      rowOf(db, '20261022-0502').parcel.codeStatus], [true, CODE_FILLED_NOTE, true, CODE_STATUS.OK],
    'F3 NEED_CODE→OK 补码：事件 note=「兼职已补齐取件码」+ payload.codeStatusChanged=true');

    const pickedFix = await pApi.call('order.correct', {
      orderNo: '20261022-0503', patch: { lockerNo: 'B-12', trackingTail: '12345' }
    }, { clientRequestId: nextCrid('correct-picked') });
    t.eq([pickedFix.ok, pickedFix.data.correctedFields, rowOf(db, '20261022-0503').parcel.lockerNo],
      [true, ['lockerNo', 'trackingTail'], 'B-12'], 'F4 PICKED 仅允许改柜号/运单尾号（白名单内放行）');
    await expectCode(t, pApi.call('order.correct', { orderNo: '20261022-0504', patch: { stationId: 'P4' } },
      { clientRequestId: nextCrid('correct-picked-station') }), 'INVALID_TRANSITION',
    'F5 PICKED 改站点 → INVALID_TRANSITION（PICKED 只允许柜号/尾号）');
    await expectCode(t, pApi.call('order.correct', { orderNo: '20261022-0505', patch: { pickupCode: 'B67890' } },
      { clientRequestId: nextCrid('correct-delivered') }), 'INVALID_TRANSITION',
    'F6 DELIVERED 及之后不可补码 → INVALID_TRANSITION');
    await expectField(t, pApi.call('order.correct', { orderNo: '20261022-0506', patch: { bogus: 1 } },
      { clientRequestId: nextCrid('correct-bogus') }), 'VALIDATION_FAILED', 'patch',
    'F7 补丁含未知字段 → VALIDATION_FAILED 且 data.field=patch');
    await expectField(t, pApi.call('order.correct', { orderNo: '20261022-0506', patch: { pickupCode: 'ab' } },
      { clientRequestId: nextCrid('correct-code') }), 'VALIDATION_FAILED', 'pickupCode',
    'F8 取件码形态非法 → VALIDATION_FAILED 且 data.field=pickupCode');
    await expectField(t, pApi.call('order.correct', { orderNo: '20261022-0506', patch: {} },
      { clientRequestId: nextCrid('correct-empty') }), 'VALIDATION_FAILED', 'patch',
    'F9 空补丁 → VALIDATION_FAILED（至少改一个字段）');

    const batched = await pApi.call('order.correct', {
      orderNo: '20261022-0507', patch: { stationId: 'P6' }, batchActionId: 'BATCH-CORRECT-01'
    }, { clientRequestId: nextCrid('correct-batch') });
    t.eq([batched.ok, rowOf(db, '20261022-0507').batchActionId], [true, 'BATCH-CORRECT-01'],
      'F10 批量改站点：同一 batchActionId 落 orders 文档');
    const exceptionFix = await pApi.call('order.correct', {
      orderNo: '20261022-0508', patch: { stationName: '南苑菜鸟驿站' }
    }, { clientRequestId: nextCrid('correct-exception') });
    t.eq([exceptionFix.ok, exceptionFix.data.order.status, rowOf(db, '20261022-0508').parcel.stationId],
      [true, EXCEPTION, 'P6'], 'F11 EXCEPTION 允许全字段补录且不改变状态（不改归属/不代确认）');
    await expectCode(t, apiOf(db, C1).call('order.correct', { orderNo: '20261022-0506', patch: { stationId: 'P4' } },
      { clientRequestId: nextCrid('correct-customer') }), 'FORBIDDEN',
    'F12 顾客调 order.correct → FORBIDDEN（角色越界）');
    await expectCode(t, pApi.call('order.correct', { orderNo: '20261022-0509', patch: { stationId: 'P4' } },
      { clientRequestId: nextCrid('correct-other') }), 'FORBIDDEN', 'F13 兼职 A 改他人订单 → FORBIDDEN');
  });
}

// ---------------------------------------------------------------- G. exception
async function sectionG(h) {
  h.section('G. order.reportException / resolveException：fromStatus/OTHER 必填/≤200/恢复口径', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0601', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0602', SUBMITTED),
      orderDoc('20261022-0603', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0604', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0605', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0606', PICKED, { acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0607', DELIVERED, {
        acceptedAt: new Date(NOW - 5000), pickedAt: new Date(NOW - 4000), deliveredAt: new Date(NOW - 3000)
      }),
      orderDoc('20261022-0608', EXCEPTION, {
        exception: { code: 'OTHER', text: '异常', fromStatus: 'SUBMITTED', by: ROLES.PARTNER, at: new Date(NOW - 1000) }
      }),
      orderDoc('20261022-0609', EXCEPTION),
      orderDoc('20261022-0610', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
      orderDoc('20261022-0611', ACCEPTED, {
        acceptedAt: new Date(NOW - 3000), partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB'
      })
    ]);
    const pApi = apiOf(db, P1);

    const reported = await pApi.call('order.reportException', {
      orderNo: '20261022-0601', code: 'CABINET_ERROR', text: '柜门打不开'
    }, { clientRequestId: nextCrid('report') });
    const reportRow = rowOf(db, '20261022-0601');
    const reportEvent = eventsFor(db, '20261022-0601')[0] || {};
    t.eq([reported.ok, reported.data.order.status, reportRow.exception.code, reportRow.exception.fromStatus,
      reportRow.exception.by, reportEvent.type, reportEvent.payload && reportEvent.payload.fromStatus],
    [true, EXCEPTION, 'CABINET_ERROR', ACCEPTED, ROLES.PARTNER, 'EXCEPTION_REPORTED', ACCEPTED],
    'G1 reportException ACCEPTED→EXCEPTION（exception.fromStatus/by 落库 + 事件 payload 同口径）');
    await expectCode(t, pApi.call('order.reportException', { orderNo: '20261022-0602', code: 'OTHER', text: 'x' },
      { clientRequestId: nextCrid('report-sub') }), 'INVALID_TRANSITION', 'G2 SUBMITTED 上报异常 → INVALID_TRANSITION');
    await expectField(t, pApi.call('order.reportException', { orderNo: '20261022-0603', code: 'OTHER' },
      { clientRequestId: nextCrid('report-other') }), 'VALIDATION_FAILED', 'text',
    'G3 OTHER 缺说明 → VALIDATION_FAILED 且 data.field=text');
    await expectField(t, pApi.call('order.reportException', { orderNo: '20261022-0604', code: 'BAD_CODE', text: 'x' },
      { clientRequestId: nextCrid('report-code') }), 'VALIDATION_FAILED', 'code',
    'G4 非法异常码 → VALIDATION_FAILED 且 data.field=code');
    await expectField(t, pApi.call('order.reportException', {
      orderNo: '20261022-0605', code: 'CUSTOMER_UNREACHABLE', text: 'x'.repeat(201)
    }, { clientRequestId: nextCrid('report-long') }), 'VALIDATION_FAILED', 'text',
    'G5 异常说明 >200 字 → VALIDATION_FAILED 且 data.field=text');

    const reportedPick = await pApi.call('order.reportException', {
      orderNo: '20261022-0606', code: 'CUSTOMER_UNREACHABLE', text: '联系不上'
    }, { clientRequestId: nextCrid('report-pick') });
    const resolved = await pApi.call('order.resolveException', { orderNo: '20261022-0606', text: '已联系上' },
      { clientRequestId: nextCrid('resolve-pick') });
    const resolveEvent = eventsFor(db, '20261022-0606').filter((event) => event.type === 'EXCEPTION_RESOLVED')[0] || {};
    t.eq([reportedPick.data.order.exception.fromStatus, resolved.data.order.status, rowOf(db, '20261022-0606').exception,
      resolveEvent.payload && resolveEvent.payload.restoredTo],
    [PICKED, PICKED, null, PICKED], 'G6 resolve 回到 exception.fromStatus（PICKED）+ 清异常 + 事件 payload.restoredTo');
    const reReported = await pApi.call('order.reportException', { orderNo: '20261022-0606', code: 'CABINET_ERROR', text: '再次故障' }, { clientRequestId: nextCrid('report-again') });
    t.check(reReported.ok === true && rowOf(db, '20261022-0606').exception.code === 'CABINET_ERROR',
      'G6b 异常恢复（exception=null）后可再次上报：exception 走整值替换，不触发真实云 DB -502001');
    await expectCode(t, pApi.call('order.resolveException', { orderNo: '20261022-0610' },
      { clientRequestId: nextCrid('resolve-non') }), 'INVALID_TRANSITION',
    'G7 非 EXCEPTION 状态 resolve → INVALID_TRANSITION');
    const dirty = await pApi.call('order.resolveException', { orderNo: '20261022-0609' },
      { clientRequestId: nextCrid('resolve-dirty') });
    t.eq([dirty.ok, dirty.code, String(dirty.message || '').length > 0], [false, 'INVALID_TRANSITION', true],
      'G8 EXCEPTION 无异常记录（脏数据）→ INVALID_TRANSITION + 中文提示');
    const fallback = await pApi.call('order.resolveException', { orderNo: '20261022-0608' },
      { clientRequestId: nextCrid('resolve-fallback') });
    t.eq([fallback.ok, fallback.data.order.status], [true, ACCEPTED],
      'G9 exception.fromStatus 非法（SUBMITTED）→ 恢复回退 ACCEPTED（契约 §8.3）');

    const reportedDeliver = await pApi.call('order.reportException', {
      orderNo: '20261022-0607', code: 'ADDRESS_ISSUE', text: '宿舍找不到'
    }, { clientRequestId: nextCrid('report-deliver') });
    const resolvedDeliver = await pApi.call('order.resolveException', { orderNo: '20261022-0607' },
      { clientRequestId: nextCrid('resolve-deliver') });
    t.eq([reportedDeliver.ok, reportedDeliver.data.order.exception.fromStatus, resolvedDeliver.data.order.status],
      [true, DELIVERED, DELIVERED], 'G10 DELIVERED 上报的异常恢复回 DELIVERED（fromStatus 消费）');
    await expectCode(t, pApi.call('order.reportException', { orderNo: '20261022-0611', code: 'OTHER', text: 'x' },
      { clientRequestId: nextCrid('report-other-partner') }), 'FORBIDDEN', 'G11 兼职 A 给他单上报异常 → FORBIDDEN');
  });
}

async function sectionH(h) {
  h.section('H. 越权/终态/CLOSED·SUSPENDED 全动作/isTest 隔离/动作矩阵合法/静态纪律', async (t) => {
    const db = world();
    db.seed('orders', [
      orderDoc('20261022-0701', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0702', SUBMITTED),
      orderDoc('20261022-0703', DELIVERED, {
        acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 3000), deliveredAt: new Date(NOW - 2000)
      }),
      orderDoc('20261022-0704', COMPLETED, { completedAt: new Date(NOW - 2000) }),
      orderDoc('20261022-0705', CANCELLED, { cancelledAt: new Date(NOW - 2000), cancelReason: 'CHANGED_MIND' })
    ]);
    const pApi = apiOf(db, P1);
    const cApi = apiOf(db, C1);

    await expectCode(t, cApi.call('order.markPicked', { orderNo: '20261022-0701' },
      { clientRequestId: nextCrid('role-cust-pick') }), 'FORBIDDEN',
    'H1 顾客调 order.markPicked → FORBIDDEN（写动作角色矩阵）');
    await expectCode(t, cApi.call('order.correct', { orderNo: '20261022-0702', patch: { pickupCode: 'B12345' } },
      { clientRequestId: nextCrid('role-cust-correct') }), 'FORBIDDEN', 'H2 顾客调 order.correct → FORBIDDEN');
    await expectCode(t, pApi.call('order.confirmDelivery', { orderNo: '20261022-0703' },
      { clientRequestId: nextCrid('role-partner-confirm') }), 'FORBIDDEN',
    'H3 兼职调 order.confirmDelivery → FORBIDDEN（不能代顾客确认）');
    await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0704' },
      { clientRequestId: nextCrid('terminal-pick') }), 'INVALID_TRANSITION',
    'H4 终态（COMPLETED）再动 → INVALID_TRANSITION');
    await expectCode(t, pApi.call('order.accept', { orderNo: '20261022-0705' },
      { clientRequestId: nextCrid('terminal-accept') }), 'INVALID_TRANSITION', 'H5 CANCELLED 接单 → INVALID_TRANSITION');

    for (const partnerStatus of [PARTNER_STATUS.CLOSED, PARTNER_STATUS.SUSPENDED]) {
      const matrix = await closedPartnerMatrix(partnerStatus);
      t.eq(matrix.codes, [ 'PARTNER_CLOSED', 'PARTNER_CLOSED', 'PARTNER_CLOSED', 'PARTNER_CLOSED',
        'PARTNER_CLOSED', 'PARTNER_CLOSED' ],
      'H6 ' + partnerStatus + ' 兼职六动作（accept/reject/pick/deliver/reportException/correct）全 → PARTNER_CLOSED');
      t.eq(allEventsOf(matrix.db).length, 0,
        'H7 ' + partnerStatus + ' 动作失败零事件落库（校验/权限失败不写库）');
      t.eq(versionsOf(matrix.db), [3, 3, 3, 3, 3, 3],
        'H8 ' + partnerStatus + ' 动作失败零订单版本变化');
    }

    const isoDb = world();
    isoDb.seed('orders', [
      orderDoc('20261022-0706', SUBMITTED),
      orderDoc('20261022-0707', SUBMITTED, { isTest: true }),
      orderDoc('20261022-0708', COMPLETED, { completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000) }),
      orderDoc('20261022-0709', COMPLETED, {
        isTest: true, completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000)
      }),
      orderDoc('20261022-0710', SUBMITTED, {
        isTest: true, partnerId: TEST_PID, partnerOpenid: TEST_P, impersonatedBy: 'DEV-01'
      })
    ]);
    const isoReal = await apiOf(isoDb, P1).call('order.listPartner', { view: 'workbench' });
    t.eq([isoReal.data.list.map((row) => row.orderNo), isoReal.data.counts.todayCompleted],
      [['20261022-0706'], 1], 'H9 真实会话：测试单不进工作台列表、不进 todayCompleted');
    const testCtx = handlerCtxOf(isoDb, TEST_P, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, developerNo: 'DEV-01'
    });
    const testList = await listPartnerHandler(testCtx, { view: 'workbench' });
    const testRow = pickRow(testList.list, '20261022-0710');
    t.eq([testList.list.map((row) => row.orderNo), testRow.isTest, testRow.impersonatedBy],
      [['20261022-0710'], true, 'DEV-01'], 'H10 TEST_WRITE 会话：只见测试单且 DTO 携带 isTest/impersonatedBy');
    const realRow = pickRow(isoReal.data.list, '20261022-0706');
    t.eq([realRow.isTest, realRow.impersonatedBy], [undefined, undefined],
      'H11 真实会话 DTO 永不返回 isTest/impersonatedBy（字段不存在而非 false）');

    const matrixDb = world();
    const statusList = [SUBMITTED, ACCEPTED, PICKED, DELIVERED, EXCEPTION, COMPLETED, CANCELLED];
    const seeded = {};
    statusList.forEach((status, index) => {
      const orderNo = '20261022-072' + String(index + 1);
      const extra = { statusUpdatedAt: new Date(NOW - 1000 - index) };
      if ([ACCEPTED, PICKED, DELIVERED, COMPLETED].indexOf(status) >= 0) {
        extra.acceptedAt = new Date(NOW - 5000);
      }
      if ([PICKED, DELIVERED, COMPLETED].indexOf(status) >= 0) {
        extra.pickedAt = new Date(NOW - 4000);
      }
      if ([DELIVERED, COMPLETED].indexOf(status) >= 0) {
        extra.deliveredAt = new Date(NOW - 3000);
      }
      if (status === COMPLETED) {
        extra.completedAt = new Date(NOW - 3000);
      }
      if (status === CANCELLED) {
        extra.cancelledAt = new Date(NOW - 3000);
      }
      extra.exception = status === EXCEPTION
        ? { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 2000) }
        : null;
      seeded[orderNo] = orderDoc(orderNo, status, extra);
      matrixDb.seed('orders', [seeded[orderNo]]);
    });
    const matrixApi = apiOf(matrixDb, P1);
    const matrixRows = (await matrixApi.call('order.listPartner', { view: 'workbench', limit: 100 })).data.list;
    const detailActions = [];
    for (const status of [COMPLETED, CANCELLED]) {
      const orderNo = statusList.map((item) => item).indexOf(status) === 5 ? '20261022-0726' : '20261022-0727';
      const detail = await matrixApi.call('order.get', { orderNo });
      detailActions.push({ status, actions: detail.data.order.actions });
    }
    const offenders = [];
    matrixRows.forEach((row) => {
      row.actions.forEach((item) => {
        if (item.key === 'message') {
          return; // 留言不是状态机动作（由 message.send 的进行中五态闸管，批 5 套件已锁）
        }
        const action = actionNameOfKey(item.key);
        const raw = seeded[row.orderNo];
        if (!action || !raw || !orderState.canAct(action, row.status, ROLES.PARTNER, raw)) {
          offenders.push(row.orderNo + ':' + item.key);
        }
      });
    });
    detailActions.forEach((entry) => {
      if (entry.actions.length > 0) {
        offenders.push(entry.status + ':terminal-has-actions');
      }
    });
    t.eq([matrixRows.length, matrixRows.every((row) => row.actions.length > 0)],
      [5, true], 'H12 动作矩阵样本非空：五进行态每行都有内联动作');
    t.eq(offenders, [], 'H13 服务端动作矩阵逐格合法（DTO 不广告状态机/角色不允许的动作，含 DELIVERED 无 correct）');

    const flowDb = world();
    flowDb.seed('orders', [orderDoc('20261022-0740', SUBMITTED)]);
    const acceptCrid = nextCrid('flow-accept');
    await apiOfAt(flowDb, P1, NOW).call('order.accept', { orderNo: '20261022-0740' },
      { clientRequestId: acceptCrid });
    await apiOfAt(flowDb, P1, NOW + 1000).call('order.markPicked', { orderNo: '20261022-0740' },
      { clientRequestId: nextCrid('flow-pick') });
    await apiOfAt(flowDb, P1, NOW + 2000).call('order.undo', { orderNo: '20261022-0740' },
      { clientRequestId: nextCrid('flow-undo') });
    await apiOfAt(flowDb, P1, NOW + 3000).call('order.accept', { orderNo: '20261022-0740' },
      { clientRequestId: acceptCrid });
    const flowEvents = eventsFor(flowDb, '20261022-0740');
    t.eq([flowEvents.length, new Set(flowEvents.map((event) => event.requestKey)).size], [3, 3],
      'H14 order_events.requestKey 唯一（幂等重放不产生重复事件，3 条事件 3 个键）');

    const files = handlerFiles();
    t.check(files.length >= 20, 'H15 handlers/order 文件清单非空（静态纪律样本 ' + files.length + ' 个）');
    const dbCollectionHits = files.filter((file) => fs.readFileSync(file, 'utf8').indexOf('db.collection(') >= 0)
      .map(relOf);
    t.eq(dbCollectionHits, [], 'H16 handlers/order 零 db.collection（数据访问只经 db/dao）');
    const allow = zeroMoney.loadAllowlist(ROOT);
    t.eq(allow.issues, [], 'H17 零金额白名单文件无配置错误');
    const moneyHits = [];
    files.forEach((file) => {
      const rel = relOf(file);
      const allowed = allow.index.get(rel) || new Set();
      zeroMoney.scanText(fs.readFileSync(file, 'utf8')).forEach((hit) => {
        if (!allowed.has(hit.text)) {
          moneyHits.push(rel + ':' + hit.line + ':' + hit.token);
        }
      });
    });
    t.eq(moneyHits, [], 'H18 handlers/order 零金额扫描 0 命中（无交易类语义）');
  });
}

// ---------------------------------------------------------------- 注册
function register(h) {
  h.setExpected(EXPECTED_ASSERTIONS);
  sectionA(h);
  sectionB(h);
  sectionC(h);
  sectionD(h);
  sectionE(h);
  sectionF(h);
  sectionG(h);
  sectionH(h);
}

module.exports = { register, EXPECTED_ASSERTIONS };

if (require.main === module) {
  const harness = createHarness({ name: 'selftest-order-partner' });
  installCrashGuard(() => ({ count: harness.count, passed: harness.passed, failures: harness.failures.length }),
    'selftest-order-partner');
  register(harness);
  const ret = harness.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
