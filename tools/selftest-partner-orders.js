'use strict';
/**
 * tools/selftest-partner-orders.js — 批 7-B「云端代客下单 + order.listPartner view=customer」断言套件。
 *
 * A. order.create(bindingId)：已绑定顾客代客单——身份快照/customerNo/dorm 取「顾客资料+当前 roomTag」、
 *    guest=null、source/isTest 派生、requestKey 归属=customerId、ORDER_CREATED actorRole=PARTNER、
 *    DTO 侧别（含幂等重放回放侧别）、顾客可见进度、测试×真实越界拒绝。
 * B. order.create(guest)：新顾客代客单——身份三空、guest 快照、requestKey 归属=partnerId、
 *    DTO guest 内联、无 counterpart/头像、不写 bindings、TEST_WRITE 下 isTest/impersonatedBy 服务端派生。
 * C. 二选一与越权：同时给/都不给、顾客单传 guest·bindingId、跨兼职 bindingId、已释放、不存在、
 *    非字符串、顾客已注销、未知字段仍拒、批量 item 与顶层绑定互斥、全部拒绝零落库。
 * D. order.createBatch：同顾客多单原子（requestKey 逐条 :itemIndex）、部分非法整批不建、
 *    绑定+item guest 互斥、guest 批量、>5 条、重放 duplicated。
 * E. order.listPartner(view=customer)：必传 bindingId、响应 {list,nextCursor} 不发 counts、
 *    过滤 partnerId=me AND customerId=绑定顾客（排除 guest/他人单/测试单/漂移单）、行不内联 actions、
 *    越权/缺参/非本视图 bindingId 拒、status 过滤、游标翻页、CLOSED 读闸。
 * F. DTO：guest 内联三字段锁、source/customerNo、无 openid/fileId/头像泄漏、顾客可见绑定单、
 *    counterpart 只在 ACTIVE 绑定内、工作台 guest 行（代客单标记数据源）。
 * G. 静态纪律：代客路径零 bindings 写入、handlers/order 零 db.collection、零金额词表 0 命中、
 *    行数上限、UTF-8 无 BOM/LF/尾换行。
 *
 * 夹具/期望值在 ./selftest-partner-orders-cases.js（两文件都受门禁 #18 ≤1000 行约束）。
 * 纪律：fake DB + 真实 handler/api，不 mock 全局 wx、不连真实网络；先合法基线再反例，样本非空；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-partner-orders.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { createHarness, installCrashGuard } = require('./selftest');
const zeroMoney = require('./zero-money-scan');
const cases = require('./selftest-partner-orders-cases');

const ORDERS_DIR = cases.ORDERS_DIR;
const createHandler = require(path.join(ORDERS_DIR, 'create.js'));

const {
  EXPECTED_ASSERTIONS, NOW, DAY, C1, P1, PID1, C2, P2, BIND_C1, BIND_C2, BIND_RELEASED,
  BIND_DELETED, BIND_CROSS, TEST_P, CUSTOMER_NO, PARTNER_NO, DTO_BANNED_KEYS, ROLES,
  PARTNER_STATUS, ORDER_STATUS, VIEW_MODE, USER_STATUS, BINDING_STATUS, SUBMITTED, ACCEPTED,
  PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION, ROOT, apiOf, handlerCtxOf, nextCrid,
  orderRow, guestOrderRow, world, createInput, guestInput, batchInput, eventsFor, rowsOf,
  rowOf, pickRow, actionKeysOf, collectKeyPaths, expectCode, expectField
} = cases;

// v1.0 入参适配（task-34）：cases.createInput 仍是旧单件形态（parcel 顶层），
// 本文件统一折算为 parcels[] + manualEntry（无截图手填）；parcel 覆盖/未知字段等反例语义保持不变。
function v100CreateInput(extra) {
  const legacy = cases.createInput(extra);
  const parcel = legacy.parcel === undefined
    ? { stationId: 'P1', pickupCode: 'A12345' }
    : legacy.parcel;
  const payload = Object.assign({}, legacy);
  delete payload.parcel;
  payload.parcels = payload.parcels || [{ parcel }];
  if (payload.manualEntry === undefined) {
    payload.manualEntry = !(Array.isArray(payload.images) && payload.images.length > 0);
  }
  return payload;
}

// ---------------------------------------------------------------- A. bindingId 代客建单
async function sectionA(h) {
  h.section('A. order.create(bindingId)：已绑定顾客代客单身份快照/requestKey/事件/幂等回放侧别', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const crid = nextCrid('a1');
    const created = await pApi.call('order.create', v100CreateInput({ bindingId: BIND_C1 }), { clientRequestId: crid });
    t.eq(created.ok, true, 'A1 兼职为已绑定顾客代客下单成功（合法基线）');
    const orderNo = created.data.orderNo;
    const row = rowOf(db, orderNo);
    t.eq([row.source, row.customerId, row.customerOpenid, row.customerNo, row.guest, row.delivery.phoneTail],
      ['PARTNER', C1, C1, CUSTOMER_NO, null, '1234'],
      'A2 身份取 bindings.customerId + customers.customerNo/phoneTail，guest=null（§2.5/§4.8 A）');
    t.eq([row.partnerId, row.partnerNo, row.isTest], [PID1, PARTNER_NO, false],
      'A3 兼职归属/编号快照、真实单 isTest=false（服务端派生）');
    t.eq([row.dorm.zone, row.dorm.buildingNo, row.dorm.room, row.dorm.dormKey, row.dorm.roomTag],
      ['D', 4, '522', 'D4-522', 'B'],
      'A4 dorm 取顾客当前资料 + 绑定当前 roomTag（不抄 binding.dormSnapshot 旧宿舍）');
    t.eq(row.requestKey, C1 + ':' + crid, 'A5 requestKey 归属=customerId（§4.7/§4.8 块 A）');
    const events = eventsFor(db, orderNo);
    t.eq([events.length, events[0].type, events[0].actorRole, events[0].payload.source, events[0].payload.isTest],
      [1, 'ORDER_CREATED', 'PARTNER', 'PARTNER', false],
      'A6 ORDER_CREATED 事件 actorRole=PARTNER、payload.source/isTest 正确（批 7 段③）');
    const dto = created.data.order;
    t.eq([dto.source, dto.guest, dto.customerNo, dto.dorm && dto.dorm.dormKey, dto.dorm && dto.dorm.roomTag],
      ['PARTNER', null, CUSTOMER_NO, 'D4-522', 'B'],
      'A7 响应 DTO：source/customerNo/dorm 下发、guest=null（不冒充代客单）');
    t.eq(actionKeysOf(dto), ['accept', 'cancel', 'correct', 'message', 'reject'],
      'A8 绑定顾客单对兼职下发 PARTNER 动作条（走正常订单，非 guest 单）');
    const replay = await pApi.call('order.create', v100CreateInput({ bindingId: BIND_C1 }), { clientRequestId: crid });
    t.eq([replay.data.duplicated, replay.data.orderNo], [true, orderNo],
      'A9 同 clientRequestId 重放返回同一单 + duplicated=true（不重复建单）');
    t.eq([replay.data.order && replay.data.order.source, actionKeysOf(replay.data.order)],
      ['PARTNER', ['accept', 'cancel', 'correct', 'message', 'reject']],
      'A10 重放 DTO 侧别仍为 PARTNER（不得把代客单回放成顾客视图）');
    t.eq(rowsOf(db).length, 1, 'A11 重放不新增订单（requestKey/唯一索引幂等）');
    t.eq(db.dump('bindings').length, 6, 'A12 代客建单不写 bindings（§12#33：绑定只能由顾客 bind.create 创建）');
    const cApi = apiOf(db, C1);
    const seen = await cApi.call('order.get', { orderNo });
    t.eq([seen.ok, seen.data.order.source, seen.data.order.guest, seen.data.order.status],
      [true, 'PARTNER', null, SUBMITTED],
      'A13 已绑定顾客 order.get 可见进度，且不冒充 guest 单（批 7 段①）');
    const testApi = apiOf(db, TEST_P);
    const before = rowsOf(db).length;
    await expectCode(t, testApi.call('order.create', v100CreateInput({ bindingId: BIND_CROSS }),
      { clientRequestId: nextCrid('a14') }), 'FORBIDDEN',
    'A14 测试兼职给真实顾客代客下单 → FORBIDDEN（真实×测试互下单铁律，防御性校验）');
    t.eq(rowsOf(db).length, before, 'A15 A14 拒绝路径零落库');
  });
}

// ---------------------------------------------------------------- B. guest 代客建单
async function sectionB(h) {
  h.section('B. order.create(guest)：新顾客代客单身份三空/guest 快照/requestKey=partnerId/DTO 内联', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const crid = nextCrid('b1');
    const created = await pApi.call('order.create', v100CreateInput({ guest: guestInput() }), { clientRequestId: crid });
    t.eq(created.ok, true, 'B1 兼职为新顾客（guest）代客下单成功（合法基线）');
    const orderNo = created.data.orderNo;
    const row = rowOf(db, orderNo);
    t.eq([row.source, row.customerId, row.customerOpenid, row.customerNo, row.guest, row.delivery.phoneTail],
      ['PARTNER', '', '', '', row.guest, '5678'],
      'B2 guest 单顾客身份三字段全空、地址落 guest 快照、phoneTail 取 guest');
    t.eq([row.guest.displayName, row.guest.dormKey, row.guest.buildingText, row.dorm],
      ['代客小张', 'D4-522', 'D4', null],
      'B3 guest 快照 displayName/dormKey/buildingText 服务端 derive、dorm=null（§2.5 orders.guest）');
    t.eq(row.requestKey, PID1 + ':' + crid, 'B4 requestKey 归属=partnerId（guest 无顾客归属，§4.7）');
    const events = eventsFor(db, orderNo);
    t.eq([events.length, events[0].actorRole, events[0].payload.source],
      [1, 'PARTNER', 'PARTNER'], 'B5 guest 单 ORDER_CREATED actorRole=PARTNER');
    const dto = created.data.order;
    t.eq([dto.guest && dto.guest.displayName, dto.guest && dto.guest.phoneTail, dto.guest && dto.guest.dormKey],
      ['代客小张', '5678', 'D4-522'],
      'B6 响应 DTO guest 内联 displayName/phoneTail/dormKey（批 7 段⑤「代客单·未绑定」标记）');
    t.eq(collectKeyPaths(dto, DTO_BANNED_KEYS, '', []), [], 'B7 guest 单 DTO 无 openid/内键/fileId 泄漏');
    t.eq([dto.guest && dto.guest.avatarFileId, dto.counterpart], [undefined, null],
      'B8 不伪造头像（guest 无 avatarFileId）、无绑定关系时 counterpart=null');
    t.eq(db.dump('bindings').length, 6, 'B9 guest 代客单零 bindings 写入（不产生绑定）');
    const replay = await pApi.call('order.create', v100CreateInput({ guest: guestInput() }), { clientRequestId: crid });
    t.eq([replay.data.duplicated, replay.data.orderNo], [true, orderNo],
      'B10 guest 单重放返回同一单 + duplicated=true');
    t.eq([replay.data.order && replay.data.order.guest && replay.data.order.guest.displayName,
      actionKeysOf(replay.data.order)], ['代客小张', ['accept', 'cancel', 'correct', 'message', 'reject']],
    'B11 重放 DTO 仍按 PARTNER 侧回放（guest 内联 + 兼职动作条，旧实现错判为顾客侧）');
    t.eq(rowsOf(db).length, 1, 'B12 重放不新增订单');
    // TEST_WRITE：isTest/impersonatedBy 一律服务端派生，客户端不可自报
    const ctx = handlerCtxOf(db, TEST_P, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, developerNo: 'DEV-01'
    });
    const testResult = await createHandler(ctx, v100CreateInput({ guest: guestInput() }));
    const testRow = rowOf(db, testResult.orderNo);
    t.eq([testRow.isTest, testRow.impersonatedBy, testResult.order.isTest],
      [true, 'DEV-01', true], 'B13 TEST_WRITE 下 isTest/impersonatedBy 服务端派生（客户端传值忽略）');
  });
}

// ---------------------------------------------------------------- C. 二选一与越权
async function sectionC(h) {
  h.section('C. 二选一/越权：同时给·都不给·顾客传 guest/bindingId·跨兼职·已释放·不存在·注销·未知字段', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const cApi = apiOf(db, C1);
    await expectField(t, pApi.call('order.create', v100CreateInput({ bindingId: BIND_C1, guest: guestInput() }),
      { clientRequestId: nextCrid('c1') }), 'VALIDATION_FAILED', 'guest',
    'C1 绑定顾客与 guest 同时给 → VALIDATION_FAILED（二选一，§7.5 批 7 段①）');
    await expectField(t, cApi.call('order.create', v100CreateInput({ guest: guestInput() }),
      { clientRequestId: nextCrid('c2') }), 'VALIDATION_FAILED', 'guest',
    'C2 顾客单传 guest → VALIDATION_FAILED（顾客单无代客语义，不得静默忽略）');
    await expectField(t, cApi.call('order.create', v100CreateInput({ bindingId: BIND_C1 }),
      { clientRequestId: nextCrid('c3') }), 'VALIDATION_FAILED', 'bindingId',
    'C3 顾客单传 bindingId → VALIDATION_FAILED（顾客单不得指定绑定顾客）');
    await expectCode(t, pApi.call('order.create', v100CreateInput({ bindingId: BIND_C2 }),
      { clientRequestId: nextCrid('c4') }), 'FORBIDDEN',
    'C4 跨兼职 bindingId（他人绑定）→ FORBIDDEN（§4.8 块 A 归属校验）');
    await expectCode(t, pApi.call('order.create', v100CreateInput({ bindingId: BIND_RELEASED }),
      { clientRequestId: nextCrid('c5') }), 'INVALID_STATE',
    'C5 已释放（RELEASED）绑定 → INVALID_STATE（只有 ACTIVE 绑定可代客下单）');
    await expectCode(t, pApi.call('order.create', v100CreateInput({ bindingId: 'bind-b7-missing' }),
      { clientRequestId: nextCrid('c6') }), 'FORBIDDEN',
    'C6 不存在的 bindingId → FORBIDDEN（不暴露绑定是否存在）');
    await expectField(t, pApi.call('order.create', v100CreateInput({ bindingId: 12345 }),
      { clientRequestId: nextCrid('c7') }), 'VALIDATION_FAILED', 'bindingId',
    'C7 bindingId 非字符串 → VALIDATION_FAILED 且 data.field=bindingId');
    await expectCode(t, pApi.call('order.create', v100CreateInput({ bindingId: BIND_DELETED }),
      { clientRequestId: nextCrid('c8') }), 'INVALID_STATE',
    'C8 绑定顾客资料已注销（deletedAt）→ INVALID_STATE（不给已注销顾客建单）');
    await expectField(t, pApi.call('order.create', v100CreateInput({}),
      { clientRequestId: nextCrid('c9') }), 'VALIDATION_FAILED', 'guest',
    'C9 兼职单既无 bindingId 也无 guest → VALIDATION_FAILED 且 data.field=guest');
    await expectField(t, pApi.call('order.create', v100CreateInput({ unexpectedKey: 1 }),
      { clientRequestId: nextCrid('c10') }), 'VALIDATION_FAILED', 'unexpectedKey',
    'C10 白名单扩容后未知顶层字段仍拒（field=未知键名，不静默丢弃）');
    const boundAndGuest = await pApi.call('order.create',
      v100CreateInput({ bindingId: BIND_C1, guest: guestInput() }), { clientRequestId: nextCrid('c11') });
    t.eq([boundAndGuest.ok, boundAndGuest.code, boundAndGuest.data && boundAndGuest.data.field],
      [false, 'VALIDATION_FAILED', 'guest'],
      'C11 bindingId 与 guest 同时给 → VALIDATION_FAILED（二选一，单入口）');
    const customerGuest = await cApi.call('order.create',
      v100CreateInput({ guest: guestInput() }), { clientRequestId: nextCrid('c12') });
    t.eq([customerGuest.ok, customerGuest.code,
      customerGuest.data && customerGuest.data.field],
    [false, 'VALIDATION_FAILED', 'guest'],
    'C12 顾客单填写 guest → VALIDATION_FAILED（不得静默当普通单落库）');
    t.eq(rowsOf(db).length, 0, 'C13 C1~C12 全部非法/越权入参零落库（拒绝路径不写 orders）');
    const bindingsAfter = db.dump('bindings').length;
    t.eq([rowsOf(db).length, db.dump('order_events').length, bindingsAfter, db.dump('counters')
      .filter((row) => String(row.key).indexOf('orders:') === 0 && row.seq > 0).length], [0, 0, 6, 0],
    'C14 拒绝路径零写：orders/order_events/绑定/订单号计数均为初始值');
  });
}

// ---------------------------------------------------------------- D. createBatch
async function sectionD(h) {
  h.section('D. 一单多包裹（v1.0）：bindingId 代客多件/整单校验原子性/guest 多件/上限', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const crid = nextCrid('d1');
    const twoParcels = [
      { parcel: { stationId: 'P1', pickupCode: 'D10001' } },
      { parcel: { stationId: 'P1', pickupCode: 'D10002' } }
    ];
    const created = await pApi.call('order.create', {
      parcels: twoParcels, serviceCode: 'PICKUP_STD', appoint: { type: 'ASAP' }, manualEntry: true, bindingId: BIND_C1
    }, { clientRequestId: crid });
    t.eq([created.ok, created.data.order.parcels.length], [true, 2],
      'D1 已绑定顾客一图多码：单笔建单成功且 parcels=2（不再 N 单）');
    const rows = rowsOf(db);
    t.eq([rows.length, rows[0].customerId, rows[0].guest], [1, C1, null],
      'D2 落库 1 张订单、身份=绑定顾客、guest=null');
    t.eq(rows[0].parcels.map((parcel) => parcel.pickupCode), ['D10001', 'D10002'],
      'D3 parcels[] 逐件快照顺序与入参一致');
    t.eq(rows[0].requestKey, C1 + ':' + crid,
      'D4 requestKey={customerId}:{clientRequestId}（v1.0 单入口，无 :itemIndex）');
    const events = db.dump('order_events');
    t.eq([events.length, events[0].payload.parcels, events[0].payload.manualEntry], [1, 2, true],
      'D5 ORDER_CREATED 事件 1 条、payload 记录包裹 2 件 + 无截图手填标记');
    const replay = await pApi.call('order.create', {
      parcels: twoParcels, serviceCode: 'PICKUP_STD', appoint: { type: 'ASAP' }, manualEntry: true, bindingId: BIND_C1
    }, { clientRequestId: crid });
    t.eq([replay.data.duplicated, rowsOf(db).length], [true, 1],
      'D6 同 clientRequestId 重放返回原单 + duplicated=true，不新增订单');
    const before = rowsOf(db).length;
    const mixedInvalid = await pApi.call('order.create', {
      parcels: [{ parcel: { stationId: 'P1', pickupCode: '###' } }],
      serviceCode: 'PICKUP_STD', manualEntry: true, bindingId: BIND_C1
    }, { clientRequestId: nextCrid('d7') });
    t.eq([mixedInvalid.ok, mixedInvalid.code, mixedInvalid.data && mixedInvalid.data.field],
      [false, 'VALIDATION_FAILED', 'pickupCode'],
      'D7 任一包裹非法 → VALIDATION_FAILED（整单不建）');
    t.eq(rowsOf(db).length, before, 'D8 非法整单零落库（先全量校验再开事务）');
    const boundPlusGuest = await pApi.call('order.create', {
      parcels: twoParcels, serviceCode: 'PICKUP_STD', manualEntry: true,
      bindingId: BIND_C1, guest: guestInput()
    }, { clientRequestId: nextCrid('d9') });
    t.eq([boundPlusGuest.ok, boundPlusGuest.code, boundPlusGuest.data && boundPlusGuest.data.field],
      [false, 'VALIDATION_FAILED', 'guest'],
      'D9 bindingId 与 guest 同时给 → VALIDATION_FAILED（二选一，整单不建）');
    const guestDb = world();
    const guestApi = apiOf(guestDb, P1);
    const guestCrid = nextCrid('d10');
    const guestMulti = await guestApi.call('order.create', {
      parcels: [
        { parcel: { stationId: 'P1', pickupCode: 'D20001' } },
        { parcel: { stationId: 'P2', pickupCode: 'D20002' } }
      ],
      serviceCode: 'PICKUP_STD', manualEntry: true, guest: guestInput()
    }, { clientRequestId: guestCrid });
    t.eq([guestMulti.ok, guestMulti.data.order.parcels.length, guestMulti.data.order.guest.displayName],
      [true, 2, '代客小张'], 'D10 guest 多件：单笔建单 2 件 + guest 快照内联');
    const guestRows = rowsOf(guestDb);
    t.eq([guestRows.length, guestRows[0].customerId, guestRows[0].requestKey], [1, '', PID1 + ':' + guestCrid],
      'D11 guest 单身份三空、requestKey 归属=partnerId（无 :itemIndex）');
    const beforeGuest = guestRows.length;
    const guestMissing = await guestApi.call('order.create', {
      parcels: [{ parcel: { stationId: 'P1', pickupCode: 'D30001' } }],
      serviceCode: 'PICKUP_STD', manualEntry: true
    }, { clientRequestId: nextCrid('d12') });
    t.eq([guestMissing.ok, guestMissing.code, guestMissing.data && guestMissing.data.field],
      [false, 'VALIDATION_FAILED', 'guest'], 'D12 兼职代客单缺 guest → VALIDATION_FAILED');
    t.eq(rowsOf(guestDb).length, beforeGuest, 'D13 缺 guest 拒绝路径零落库');
    const tooMany = [];
    for (let i = 0; i < 11; i += 1) {
      tooMany.push({ parcel: { stationId: 'P1', pickupCode: 'D4' + String(i).padStart(4, '0') } });
    }
    await expectField(t, guestApi.call('order.create', {
      parcels: tooMany, serviceCode: 'PICKUP_STD', manualEntry: true, guest: guestInput()
    }, { clientRequestId: nextCrid('d14') }), 'VALIDATION_FAILED', 'parcels',
    'D14 >10 件 → VALIDATION_FAILED 且 data.field=parcels（上限 10）');
  });
}

// ---------------------------------------------------------------- E. listPartner view=customer
async function sectionE(h) {
  h.section('E. order.listPartner(view=customer)：过滤/响应形状/无 actions/越权/翻页/读闸', async (t) => {
    const db = world({
      orders: [
        orderRow('20261022-1001', { status: SUBMITTED, statusUpdatedAt: new Date(NOW - 100) }),
        orderRow('20261022-1002', { status: PICKED, statusUpdatedAt: new Date(NOW - 200) }),
        orderRow('20261022-1003', {
          status: COMPLETED, statusUpdatedAt: new Date(NOW - 300), completedAt: new Date(NOW - 300)
        }),
        orderRow('20261022-1004', {
          status: CANCELLED, statusUpdatedAt: new Date(NOW - 400), cancelledAt: new Date(NOW - 400),
          cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER
        }),
        orderRow('20261022-1005', {
          status: EXCEPTION, statusUpdatedAt: new Date(NOW - 500),
          exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 500) }
        }),
        guestOrderRow('20261022-1006', { status: SUBMITTED }),
        orderRow('20261022-1007', {
          customerId: C2, customerOpenid: C2, customerNo: 'CB7B7B7C',
          partnerId: cases.PID2, partnerOpenid: P2, partnerNo: 'PATB702'
        }),
        orderRow('20261022-1008', { isTest: true }),
        orderRow('20261022-1009', { partnerId: cases.PID2, partnerOpenid: P2, partnerNo: 'PATB702' })
      ]
    });
    const pApi = apiOf(db, P1);
    const res = await pApi.call('order.listPartner', { view: 'customer', bindingId: BIND_C1 });
    t.eq(res.ok, true, 'E1 view=customer 合法基线返回成功');
    t.eq(Object.keys(res.data || {}).sort(), ['list', 'nextCursor'],
      'E2 view=customer 响应顶层键恰为 list/nextCursor（不发 counts，§7.5）');
    t.eq(res.data.list.map((row) => row.orderNo),
      ['20261022-1001', '20261022-1002', '20261022-1003', '20261022-1004', '20261022-1005'],
      'E3 只返回该绑定顾客在本兼职名下订单（statusUpdatedAt desc）');
    t.eq(res.data.list.filter((row) => row.orderNo === '20261022-1006').length, 0,
      'E4 guest 单（customerId=\'\'）天然不进入顾客订单视图');
    t.eq(res.data.list.filter((row) => row.orderNo === '20261022-1007' || row.orderNo === '20261022-1009').length, 0,
      'E5 他人顾客单/归属他人的漂移单不混入（partnerId=me AND customerId=绑定顾客）');
    t.eq(res.data.list.filter((row) => row.orderNo === '20261022-1008').length, 0,
      'E6 测试单（isTest=true）不混入真实会话列表');
    t.eq(res.data.list.every((row) => actionKeysOf(row).length === 0), true,
      'E7 行 DTO 复用 history 行、不内联 actions[]（不给客户历史页状态动作）');
    const row1001 = pickRow(res.data.list, '20261022-1001');
    t.check(!!row1001 && row1001.statusText.length > 0 && row1001.service.name === '标准代取',
      'E8 行含 orderNo/status/statusText/service 等 history 行字段（statusText 由服务端下发）');
    t.eq(collectKeyPaths(res.data.list, DTO_BANNED_KEYS, '', []), [],
      'E9 顾客订单视图行无 openid/主键/fileId/内部键泄漏');
    await expectField(t, pApi.call('order.listPartner', { view: 'customer' }), 'VALIDATION_FAILED', 'bindingId',
      'E10 view=customer 缺 bindingId → VALIDATION_FAILED 且 data.field=bindingId');
    await expectCode(t, pApi.call('order.listPartner', { view: 'customer', bindingId: BIND_C2 }),
      'FORBIDDEN', 'E11 bindingId 不属于自己 → FORBIDDEN（不暴露他人顾客订单）');
    await expectCode(t, pApi.call('order.listPartner', { view: 'customer', bindingId: 'bind-b7-missing' }),
      'FORBIDDEN', 'E12 不存在的 bindingId → FORBIDDEN（不暴露绑定是否存在）');
    await expectField(t, pApi.call('order.listPartner', { view: 'workbench', bindingId: BIND_C1 }),
      'VALIDATION_FAILED', 'bindingId',
      'E13 非 customer 视图传 bindingId → VALIDATION_FAILED（不静默忽略参数）');
    const completed = await pApi.call('order.listPartner',
      { view: 'customer', bindingId: BIND_C1, status: COMPLETED });
    t.eq(completed.data.list.map((row) => row.orderNo), ['20261022-1003'],
      'E14 status 过滤在顾客订单视图生效');
    const pageNos = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const part = await pApi.call('order.listPartner',
        { view: 'customer', bindingId: BIND_C1, limit: 2, cursor });
      part.data.list.forEach((row) => pageNos.push(row.orderNo));
      cursor = part.data.nextCursor;
      if (!cursor) {
        break;
      }
    }
    t.eq([pageNos, new Set(pageNos).size],
      [['20261022-1001', '20261022-1002', '20261022-1003', '20261022-1004', '20261022-1005'], 5],
      'E15 limit=2 游标翻页不重不漏且顺序一致');
    const closedDb = world({ partnerStatus: PARTNER_STATUS.CLOSED });
    const closedApi = apiOf(closedDb, P1);
    await expectCode(t, closedApi.call('order.listPartner', { view: 'customer', bindingId: BIND_C1 }),
      'PARTNER_CLOSED', 'E16 注销（CLOSED）兼职读顾客订单视图同样 PARTNER_CLOSED（读闸不因视图绕过）');
  });
}

// ---------------------------------------------------------------- F. DTO
async function sectionF(h) {
  h.section('F. DTO：guest 内联锁/source/customerNo/无泄漏/顾客可见绑定单/counterpart/工作台 guest 行', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const guestCreated = await pApi.call('order.create', v100CreateInput({ guest: guestInput() }),
      { clientRequestId: nextCrid('f1') });
    const guestNo = guestCreated.data.orderNo;
    const guestDto = guestCreated.data.order;
    t.eq([guestDto.guest.displayName, guestDto.guest.phoneTail, guestDto.guest.dormKey, guestDto.source],
      ['代客小张', '5678', 'D4-522', 'PARTNER'],
      'F1 guest 单 DTO 内联 guest{displayName,phoneTail,dormKey} 且 source 下发（批 7 段⑤）');
    t.eq(collectKeyPaths(guestDto, DTO_BANNED_KEYS, '', []), [],
      'F2 guest 单 DTO 无 openid/partnerId/fileId 等内部键');
    t.eq([guestDto.counterpart, guestDto.customerNo], [null, ''],
      'F3 guest 单不伪造对方资料/头像（counterpart=null）、customerNo 为空');
    const guestGet = await pApi.call('order.get', { orderNo: guestNo });
    t.eq([guestGet.data.order.guest.displayName, guestGet.data.order.guest.dormKey],
      ['代客小张', 'D4-522'], 'F4 order.get 对 guest 单同样内联 guest 三字段');
    const stranger = apiOf(db, C2);
    await expectCode(t, stranger.call('order.get', { orderNo: guestNo }), 'FORBIDDEN',
      'F5 未绑定顾客无权 order.get guest 单（顾客无访问路径，§3.4）');
    const boundCreated = await pApi.call('order.create', v100CreateInput({ bindingId: BIND_C1 }),
      { clientRequestId: nextCrid('f6') });
    const boundNo = boundCreated.data.orderNo;
    const boundGet = await pApi.call('order.get', { orderNo: boundNo });
    t.eq([boundGet.data.order.guest, boundGet.data.order.customerNo,
      boundGet.data.order.dorm && boundGet.data.order.dorm.dormKey,
      boundGet.data.order.counterpart && boundGet.data.order.counterpart.displayName],
    [null, CUSTOMER_NO, 'D4-522', '小王'],
    'F6 绑定顾客代客单：guest=null、customerNo/dorm 下发、counterpart 为当前 ACTIVE 绑定顾客昵称');
    t.eq(collectKeyPaths(boundGet.data.order, ['avatarFileId', 'customerOpenid', 'partnerOpenid'], '', []), [],
      'F7 详情 DTO 不泄漏 openid/头像内部标识');
    const cApi = apiOf(db, C1);
    const customerView = await cApi.call('order.get', { orderNo: boundNo });
    t.eq([customerView.ok, customerView.data.order.guest,
      customerView.data.order.counterpart && customerView.data.order.counterpart.displayName],
    [true, null, '小李'],
    'F8 已绑定顾客可看自己的代客单进度（source=PARTNER），counterpart 按现绑定解析');
    t.eq(actionKeysOf(customerView.data.order), ['cancel', 'message'],
      'F9 顾客侧动作条按顾客状态矩阵下发（顾客可在 SUBMITTED 取消）');
    const workbench = await pApi.call('order.listPartner', { view: 'workbench' });
    const guestRow = pickRow(workbench.data.list, guestNo);
    t.eq([guestRow && guestRow.source, guestRow && guestRow.guest && guestRow.guest.displayName],
      ['PARTNER', '代客小张'],
      'F10 工作台 guest 行保留 source/guest（页面「代客单」标记的数据源，批 6 渲染不破坏）');
    const customerList = await pApi.call('order.listPartner', { view: 'customer', bindingId: BIND_C1 });
    const boundRow = pickRow(customerList.data.list, boundNo);
    t.eq([boundRow && boundRow.source, boundRow && boundRow.guest, actionKeysOf(boundRow)],
      ['PARTNER', null, []],
      'F11 顾客订单视图行复用 history 行：source/guest=null/无 actions');
  });
}

// ---------------------------------------------------------------- G. 静态纪律
function readText(full) {
  return fs.readFileSync(full, 'utf8');
}

async function sectionG(h) {
  h.section('G. 静态纪律：零 bindings 写/零 db.collection/零金额/行数/编码', async (t) => {
    const createPath = path.join(ORDERS_DIR, '_create.js');
    const listPath = path.join(ORDERS_DIR, 'listPartner.js');
    const createText = readText(createPath);
    const listText = readText(listPath);
    // 代客路径只读 bindings（dao.get/findOne）；任何 add/update/set/remove 写绑定都判红（§12#33）
    const writePattern = /(?:add|update|set|remove|updateWhere|removeWhere)\s*\(\s*COLLECTIONS\.BINDINGS/;
    t.eq([writePattern.test(createText), writePattern.test(listText)], [false, false],
      'G1 _create.js/listPartner.js 零 bindings 写入（代客单不产生绑定）');
    const storeText = readText(path.join(ORDERS_DIR, '_store.js'));
    t.check(createText.indexOf('loadBoundCustomer') >= 0 && storeText.indexOf('COLLECTIONS.BINDINGS') >= 0
      && /dao\.(?:get|findOne)\(COLLECTIONS\.BINDINGS/.test(storeText),
    'G2 绑定分支只经 _store 读 bindings（样本非空：不是"没写绑定"因为根本没读）');
    const files = fs.readdirSync(ORDERS_DIR).filter((name) => name.slice(-3) === '.js')
      .map((name) => path.join(ORDERS_DIR, name));
    const hits = files.filter((file) => readText(file).indexOf('db.collection(') >= 0);
    t.eq(hits.map((file) => path.relative(ROOT, file).split(path.sep).join('/')), [],
      'G3 handlers/order 零 db.collection（数据访问只经 db/dao）');
    const allow = zeroMoney.loadAllowlist(ROOT);
    const moneyHits = [];
    const scanned = [createPath, listPath, path.join(ORDERS_DIR, '_store.js'),
      path.join(ORDERS_DIR, '_dto.js'), path.join(ORDERS_DIR, '_parcel.js')];
    scanned.forEach((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const allowed = allow.index.get(rel) || new Set();
      zeroMoney.scanText(readText(file)).forEach((hit) => {
        if (!allowed.has(hit.text)) {
          moneyHits.push(rel + ':' + hit.line + ':' + hit.token);
        }
      });
    });
    t.eq([allow.issues, moneyHits], [[], []], 'G4 批 7-B 改动源码零金额扫描 0 命中（白名单无配置错误）');
    const limits = [
      [createPath, 500], [listPath, 500],
      [__filename, 1000], [path.join(__dirname, 'selftest-partner-orders-cases.js'), 1000]
    ];
    const overLimit = limits.filter((item) => readText(item[0]).split('\n').length - 1 > item[1])
      .map((item) => path.basename(item[0]));
    t.eq(overLimit, [], 'G5 源码 ≤500 行/测试文件 ≤1000 行（门禁 #18）');
    const encodingIssues = [];
    limits.forEach((item) => {
      const buf = fs.readFileSync(item[0]);
      const name = path.basename(item[0]);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        encodingIssues.push(name + ':BOM');
      }
      if (buf[buf.length - 1] !== 0x0a) {
        encodingIssues.push(name + ':EOF');
      }
      if (readText(item[0]).indexOf('\r') >= 0) {
        encodingIssues.push(name + ':CRLF');
      }
    });
    t.eq(encodingIssues, [], 'G6 改动文件 UTF-8 无 BOM、纯 LF、结尾单换行');
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
}

module.exports = { register, EXPECTED_ASSERTIONS };

if (require.main === module) {
  const harness = createHarness({ name: 'selftest-partner-orders' });
  installCrashGuard(() => ({ count: harness.count, passed: harness.passed, failures: harness.failures.length }),
    'selftest-partner-orders');
  register(harness);
  const ret = harness.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
