'use strict';
/**
 * tools/selftest-transfer.js — 批 26 D58「已接单订单转派」服务端断言套件（T1~T13）。
 *
 * 覆盖（工单 §2.3 + 草案 §1.7）：T1 合法基线/归属改写逐字段、T2 目标独占、T3 状态守卫（含 D61 pickedCount>0）、
 * T4 真实×测试隔离、T5 惰性过期只落一次、T6 四动作幂等、T7 限流（config 单源）、T8 DTO 键白名单（目标视图遮蔽）、
 * T9 顾客侧（fulfillmentPartnerNo/绑定 counterpart/事件裁剪）、T10 完成后原兼职失联+待接收列表、T11 统计按当前归属、
 * T12 匿名化清编号快照（单源 = cleanup retention.js）、T13 静态闸（handlers/order 零 db.collection / 注册表对齐）。
 *
 * 纪律：fake DB + 真实 handler/api，不 mock 全局 wx、不连真库；先合法基线再反例；样本非空；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算判红）；夹具/助手在 ./lib/order-transfer-cases.js。
 * 取数：node tools/selftest-transfer.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { createHarness, installCrashGuard } = require('./selftest');
const cases = require('./lib/order-transfer-cases');

const {
  ROOT, API, ORDERS_DIR, NOW, MINUTE, DAY, C1, P1, PID1, P2, PID2, P3, PID3,
  TEST_C, TEST_P, TEST_PID, TEST_P2, TEST_PID2,
  TRANSFER_STATUS, TRANSFER_REASON, PARTNER_TRANSFER_KEYS, CUSTOMER_TRANSFER_KEYS, ADMIN_TRANSFER_KEYS,
  TRANSFER_BLOCK_KEYS, ROLES, PARTNER_STATUS, VIEW_MODE, ORDER_STATUS,
  SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED, EXCEPTION,
  enums, retention, apiOf, handlerCtxWithCrid, nextCrid, iso,
  orderDoc, transferBlock, acceptedTransferBlock, configDoc, world,
  rowOf, eventsFor, eventTypesOf, countersOf, sameJson, transferKeysOf, jsonOf, bannedHitsOf,
  topKeysOf, expectCode, expectField, errorCodeOf, orderFiles, relOf, cleanupTestDb, cleanupCtx
} = cases;

const requestTransferHandler = require(path.join(ORDERS_DIR, 'requestTransfer.js'));
const orderIndex = require(path.join(ORDERS_DIR, 'index.js'));
const router = require(path.join(API, 'router.js'));
const adminDto = require(path.join(API, 'handlers/admin/_dto.js'));
const orderDto = require(path.join(API, 'handlers/order/_dto.js'));
const cleanupShared = require(path.join(ROOT, 'cloudfunctions/cleanup/shared/enums.js'));

// 六项 counts 形状（零值模板）：D58 只加顶层 transferPending，不改 counts 形状
const COUNTS_KEYS = ['accepted', 'delivered', 'exception', 'picked', 'submitted', 'todayCompleted'];

function msOfValue(value) {
  return new Date(value).getTime();
}

function eventPayloadOf(db, orderNo, type) {
  return eventsFor(db, orderNo).filter((event) => event.type === type)[0] || null;
}

async function callHandler(handler, ctx, payload) {
  try {
    return { ok: true, data: await handler(ctx, payload) };
  } catch (error) {
    return { ok: false, code: error && error.code, data: error && error.data };
  }
}

// ================================================================ T1 合法基线
// 挡：事务里"顺手改 status/statusUpdatedAt/顾客/地址"；归属改写漏一个字段；version 不 +1；ttl 不从 config 读。
async function sectionT1(h) {
  h.section('T1 合法基线：A→B 确认后 partnerId/Openid/No 三字段改写、其余逐字段不变、version+1', async (t) => {
    const db = world({ orders: [orderDoc('20261103-1001', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })] });
    const before = rowOf(db, '20261103-1001');
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    const req = await p1.call('order.requestTransfer',
      { orderNo: '20261103-1001', toPartnerNo: 'PBBBBBB' }, { clientRequestId: nextCrid('t1req') });
    const requested = rowOf(db, '20261103-1001');
    t.eq([req.ok, req.data.transfer.status, req.data.transfer.toPartnerNo, req.data.duplicated],
      [true, TRANSFER_STATUS.PENDING, 'PBBBBBB', undefined],
      'T1-1 发起成功：transfer.status=PENDING / toPartnerNo=目标编号 / 首次无 duplicated');
    t.eq([requested.partnerId, requested.partnerOpenid, requested.partnerNo, requested.status],
      [PID1, P1, 'PAAAAAA', ACCEPTED], 'T1-2 发起阶段订单归属与 status 零改动（只有 transfer 块）');
    t.eq([requested.statusUpdatedAt.getTime(), requested.acceptedAt.getTime(), requested.customerId, requested.customerNo],
      [before.statusUpdatedAt.getTime(), before.acceptedAt.getTime(), C1, 'CABCDEFGH'],
      'T1-3 发起阶段 statusUpdatedAt/acceptedAt/顾客 不变');
    t.eq([sameJson(requested.dorm, before.dorm), sameJson(requested.parcels || [], before.parcels || []),
      sameJson(requested.delivery, before.delivery), sameJson(requested.service, before.service)],
    [true, true, true, true], 'T1-4 发起阶段 dorm/delivery/parcels/service 逐字段不变');
    t.eq([requested.version, requested.transfer.fromPartnerId, requested.transfer.fromPartnerNo],
      [before.version + 1, PID1, 'PAAAAAA'], 'T1-5 发起 version 只 +1，transfer 记录发起方 id+编号快照');
    t.eq(msOfValue(requested.transfer.expiresAt) - msOfValue(requested.transfer.requestedAt), 10 * MINUTE,
      'T1-6 expiresAt=requestedAt+config.transferTtlMinutes（出厂 10 分钟，config 单源）');
    t.eq(eventTypesOf(db, '20261103-1001'), ['TRANSFER_REQUESTED'],
      'T1-7 发起恰一条 TRANSFER_REQUESTED 事件');
    const reqEvent = eventPayloadOf(db, '20261103-1001', 'TRANSFER_REQUESTED');
    t.eq([reqEvent.fromStatus, reqEvent.toStatus, reqEvent.actorRole, Object.keys(reqEvent.payload).sort()],
      [ACCEPTED, ACCEPTED, ROLES.PARTNER, ['expiresAt', 'fromPartnerNo', 'toPartnerNo']],
      'T1-8 TRANSFER_REQUESTED：ACCEPTED→ACCEPTED / PARTNER / payload 三键');

    const acc = await p2.call('order.acceptTransfer', { orderNo: '20261103-1001' },
      { clientRequestId: nextCrid('t1acc') });
    const after = rowOf(db, '20261103-1001');
    t.check(acc.ok, 'T1-9 目标确认成功');
    t.eq([after.partnerId, after.partnerOpenid, after.partnerNo], [PID2, P2, 'PBBBBBB'],
      'T1-10 唯一归属改写点：partnerId/partnerOpenid/partnerNo 全部改为目标本人');
    t.eq([after.status, after.statusUpdatedAt.getTime(), after.acceptedAt.getTime()],
      [ACCEPTED, before.statusUpdatedAt.getTime(), before.acceptedAt.getTime()],
      'T1-11 确认后 status 仍 ACCEPTED、statusUpdatedAt/acceptedAt 不变');
    t.eq([after.customerId, after.customerNo, after.orderNo, sameJson(after.dorm, before.dorm),
      sameJson(after.parcels || [], before.parcels || [])],
    [C1, 'CABCDEFGH', '20261103-1001', true, true], 'T1-12 确认后顾客/订单号/宿舍/包裹逐字段不变');
    t.eq([after.version, after.transfer.status, after.transfer.resolveReason,
      after.transfer.resolvedAt.getTime()], [before.version + 2, TRANSFER_STATUS.ACCEPTED,
      TRANSFER_REASON.TARGET_ACCEPTED, NOW], 'T1-13 确认 version 再 +1、transfer 终态 ACCEPTED+TARGET_ACCEPTED');
    t.eq(eventTypesOf(db, '20261103-1001'), ['TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED'],
      'T1-14 确认恰追加一条 TRANSFER_ACCEPTED（共 2 条）');
    const accEvent = eventPayloadOf(db, '20261103-1001', 'TRANSFER_ACCEPTED');
    t.eq([accEvent.payload.fromPartnerNo, accEvent.payload.toPartnerNo, accEvent.actorRole],
      ['PAAAAAA', 'PBBBBBB', ROLES.PARTNER], 'T1-15 TRANSFER_ACCEPTED payload 记录双方编号');
  });
}

// ================================================================ T2 目标独占
// 挡：删掉 acceptTransfer 的 transfer.toPartnerId===me 校验（任何兼职可抢单）。
async function sectionT2(h) {
  h.section('T2 目标独占：非 transfer.toPartnerId 的兼职确认/拒收一律 FORBIDDEN 且零写入', async (t) => {
    const db = world({ orders: [orderDoc('20261103-2001', ACCEPTED, {
      acceptedAt: new Date(NOW - 2000), transfer: transferBlock()
    })] });
    const before = rowOf(db, '20261103-2001');
    const p3 = apiOf(db, P3);
    const conflict = await expectCode(t, p3.call('order.acceptTransfer', { orderNo: '20261103-2001' },
      { clientRequestId: nextCrid('t2acc') }), 'FORBIDDEN',
    'T2-1 非目标兼职（P3）确认他人转派 → FORBIDDEN');
    const after = rowOf(db, '20261103-2001');
    t.eq([after.version, after.partnerId, eventTypesOf(db, '20261103-2001').length],
      [before.version, PID1, 0], 'T2-2 越权确认零业务写入（version/归属/事件均不变）');
    await expectCode(t, p3.call('order.declineTransfer', { orderNo: '20261103-2001' },
      { clientRequestId: nextCrid('t2dec') }), 'FORBIDDEN', 'T2-3 非目标兼职拒收 → FORBIDDEN');
    await expectCode(t, p3.call('order.get', { orderNo: '20261103-2001' }), 'FORBIDDEN',
      'T2-4 非目标兼职读订单详情 → FORBIDDEN（DTO 遮蔽不是权限替代）');
    const p1acc = await apiOf(db, P1).call('order.acceptTransfer', { orderNo: '20261103-2001' },
      { clientRequestId: nextCrid('t2from') });
    t.eq([p1acc.ok, p1acc.code], [false, 'FORBIDDEN'],
      'T2-5 发起方本人也不能代目标确认 → FORBIDDEN（目标独占）');
    t.eq(conflict.data && conflict.data.field, undefined, 'T2-6 FORBIDDEN 不回带内部字段信息');
    t.eq([after.transfer.status, after.transfer.toPartnerId], [TRANSFER_STATUS.PENDING, PID2],
      'T2-7 全场结束后 PENDING 邀请原样保留（越权调用不改状态）');
  });
}

// ================================================================ T3 状态守卫
// 挡：放开 from:ACTIVE_STATUSES 允许 PICKED/已取件/异常单转派；cancelTransfer 在 ACCEPTED 后仍生效。
async function sectionT3(h) {
  h.section('T3 状态守卫：非 ACCEPTED / pickedCount>0 发起 → INVALID_STATE；ACCEPTED 后撤回 → INVALID_STATE', async (t) => {
    const statuses = [SUBMITTED, PICKED, DELIVERED, EXCEPTION, COMPLETED, CANCELLED];
    const orders = statuses.map((status, index) => orderDoc('20261103-300' + (index + 1), status, {
      acceptedAt: status === SUBMITTED ? null : new Date(NOW - 2000)
    }));
    const db = world({ orders });
    const api = apiOf(db, P1);
    const codes = [];
    for (let i = 0; i < statuses.length; i += 1) {
      const res = await api.call('order.requestTransfer',
        { orderNo: '20261103-300' + (i + 1), toPartnerNo: 'PBBBBBB' },
        { clientRequestId: nextCrid('t3s' + i) });
      codes.push(res.code);
    }
    t.eq(codes, ['INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE', 'INVALID_STATE'],
      'T3-1 SUBMITTED/PICKED/DELIVERED/EXCEPTION/COMPLETED/CANCELLED 发起转派全部 INVALID_STATE');
    const partialDb = world({ orders: [
      orderDoc('20261103-3111', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000),
        parcels: [{
          itemIndex: 0, stationId: 'P1', pickupCode: 'A11111', codeStatus: 'OK', pickedAt: new Date(NOW - 1000)
        }]
      }),
      orderDoc('20261103-3112', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })
    ] });
    const partial = await expectCode(t, apiOf(partialDb, P1).call('order.requestTransfer',
      { orderNo: '20261103-3111', toPartnerNo: 'PBBBBBB' }, { clientRequestId: nextCrid('t3part') }),
    'INVALID_STATE', 'T3-2 ACCEPTED 但已有包裹取件（D61 pickedCount>0）→ INVALID_STATE');
    t.eq(rowOf(partialDb, '20261103-3111').transfer, undefined,
      'T3-3 已取件拒发起：orders.transfer 零写入');
    const partialDto = await apiOf(partialDb, P1).call('order.get', { orderNo: '20261103-3111' });
    const normalDto = await apiOf(partialDb, P1).call('order.get', { orderNo: '20261103-3112' });
    const keysOf = (dto) => (dto.data.order.actions || []).map((item) => item.key);
    t.eq([keysOf(partialDto).indexOf('requestTransfer'), keysOf(normalDto).indexOf('requestTransfer') >= 0],
      [-1, true], 'T3-4 DTO 动作可见性：已部分取件不广告 requestTransfer（未取件对照广告）');

    const afterDb = world({ orders: [orderDoc('20261103-3201', ACCEPTED, {
      acceptedAt: new Date(NOW - 2000),
      partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
      transfer: acceptedTransferBlock()
    })] });
    await expectCode(t, apiOf(afterDb, P2).call('order.cancelTransfer', { orderNo: '20261103-3201' },
      { clientRequestId: nextCrid('t3cancel') }), 'INVALID_STATE',
    'T3-5 转派已完成（transfer.status=ACCEPTED）后再撤回 → INVALID_STATE');
    t.eq(rowOf(afterDb, '20261103-3201').transfer.status, TRANSFER_STATUS.ACCEPTED,
      'T3-6 撤回失败后 transfer 终态不变（无二次改写）');

    const pickedDb = world({ orders: [orderDoc('20261103-3301', PICKED, {
      acceptedAt: new Date(NOW - 5000), pickedAt: new Date(NOW - 2000), transfer: transferBlock()
    })] });
    await expectCode(t, apiOf(pickedDb, P2).call('order.acceptTransfer', { orderNo: '20261103-3301' },
      { clientRequestId: nextCrid('t3pickacc') }), 'INVALID_STATE',
    'T3-7 订单已离开 ACCEPTED（PICKED）时确认 → INVALID_STATE（邀请先失效再报错）');
    const pickedTransfer = rowOf(pickedDb, '20261103-3301').transfer;
    t.eq([pickedTransfer.status, pickedTransfer.resolveReason], [TRANSFER_STATUS.EXPIRED, TRANSFER_REASON.STATE_CHANGED],
      'T3-8 订单状态已变 → 惰性落 EXPIRED/STATE_CHANGED（Q4）');
    t.eq(eventTypesOf(pickedDb, '20261103-3301'), ['TRANSFER_EXPIRED'],
      'T3-9 状态变更过期恰一条 TRANSFER_EXPIRED 事件');
  });
}

// ================================================================ T4 真实×测试隔离
// 挡：删掉 isTestOf 比较（真实兼职可把订单转给测试账号/反之）。
async function sectionT4(h) {
  h.section('T4 隔离：真实→测试 / 测试→真实一律 FORBIDDEN，orders 零写入；同侧对照可成功', async (t) => {
    const db = world({ orders: [orderDoc('20261103-4001', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })] });
    const before = rowOf(db, '20261103-4001');
    await expectCode(t, apiOf(db, P1).call('order.requestTransfer',
      { orderNo: '20261103-4001', toPartnerNo: 'PTESTAA' }, { clientRequestId: nextCrid('t4real') }),
    'FORBIDDEN', 'T4-1 真实兼职 → 测试兼职目标 → FORBIDDEN');
    t.eq([rowOf(db, '20261103-4001').version, rowOf(db, '20261103-4001').transfer,
      eventTypesOf(db, '20261103-4001').length], [before.version, undefined, 0],
    'T4-2 隔离拒绝零业务写入（version/transfer/事件均不变）');

    const testDb = world({ orders: [orderDoc('20261103-4101', ACCEPTED, {
      acceptedAt: new Date(NOW - 2000), isTest: true,
      partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PTESTAA'
    })] });
    const testCtx = handlerCtxWithCrid(testDb, TEST_P,
      { role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE }, 't4test');
    const testRes = await callHandler(requestTransferHandler, testCtx,
      { orderNo: '20261103-4101', toPartnerNo: 'PAAAAAA' });
    t.eq([testRes.ok, testRes.code], [false, 'FORBIDDEN'], 'T4-3 测试兼职 → 真实兼职目标 → FORBIDDEN');
    t.eq([rowOf(testDb, '20261103-4101').version, eventTypesOf(testDb, '20261103-4101').length],
      [3, 0], 'T4-4 测试侧隔离拒绝零业务写入');
    const controlCtx = handlerCtxWithCrid(testDb, TEST_P,
      { role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE }, 't4ctrl');
    const control = await callHandler(requestTransferHandler, controlCtx,
      { orderNo: '20261103-4101', toPartnerNo: 'PTESTBB' });
    t.check(control.ok && control.data.transfer.status === TRANSFER_STATUS.PENDING,
      'T4-5 对照：测试→测试（同侧）发起成功（隔离闸有牙、不是一律拒绝）');
    t.check(rowOf(testDb, '20261103-4101').transfer.toPartnerNo === 'PTESTBB',
      'T4-6 对照：同侧转派真实落库 toPartnerNo=PTESTBB');
  });
}

// ================================================================ T5 惰性过期
// 挡：去掉过期判定（过期邀请仍可确认）；重复读/重复调用二次写事件。
async function sectionT5(h) {
  h.section('T5 过期：now>expiresAt 确认 → INVALID_STATE 且 transfer 落 EXPIRED 恰一次', async (t) => {
    const expired = transferBlock({
      requestedAt: new Date(NOW - 20 * MINUTE),
      expiresAt: new Date(NOW - 5 * MINUTE)
    });
    const db = world({ orders: [orderDoc('20261103-5001', ACCEPTED, {
      acceptedAt: new Date(NOW - 30 * MINUTE), transfer: expired
    })] });
    const before = rowOf(db, '20261103-5001');
    await expectCode(t, apiOf(db, P2).call('order.acceptTransfer', { orderNo: '20261103-5001' },
      { clientRequestId: nextCrid('t5a') }), 'INVALID_STATE', 'T5-1 过期后确认 → INVALID_STATE');
    const after = rowOf(db, '20261103-5001');
    t.eq([after.transfer.status, after.transfer.resolveReason], [TRANSFER_STATUS.EXPIRED, TRANSFER_REASON.EXPIRED],
      'T5-2 惰性落 transfer.status=EXPIRED / resolveReason=EXPIRED');
    t.eq(after.version, before.version + 1, 'T5-3 过期落库 version 只 +1');
    const expiredEvent = eventPayloadOf(db, '20261103-5001', 'TRANSFER_EXPIRED');
    t.eq([eventTypesOf(db, '20261103-5001'), expiredEvent.actorRole, expiredEvent.payload.fromPartnerNo],
      [['TRANSFER_EXPIRED'], 'SYSTEM', 'PAAAAAA'], 'T5-4 恰一条 TRANSFER_EXPIRED（SYSTEM / payload 双方编号）');
    await expectCode(t, apiOf(db, P2).call('order.acceptTransfer', { orderNo: '20261103-5001' },
      { clientRequestId: nextCrid('t5b') }), 'INVALID_STATE', 'T5-5 重复确认仍 INVALID_STATE');
    t.eq([eventTypesOf(db, '20261103-5001').length, rowOf(db, '20261103-5001').version],
      [1, before.version + 1], 'T5-6 重复调用不二次写事件/不二次 +version（过期幂等）');
    await expectCode(t, apiOf(db, P1).call('order.cancelTransfer', { orderNo: '20261103-5001' },
      { clientRequestId: nextCrid('t5c') }), 'INVALID_STATE', 'T5-7 过期后发起方撤回 → INVALID_STATE');
    t.eq(eventTypesOf(db, '20261103-5001').length, 1, 'T5-8 过期后撤回不新增事件');
  });
}

// ================================================================ T6 幂等
// 挡：删 requestKey 预查（重放二次写事件/二次改归属/version 重复 +1）。
async function sectionT6(h) {
  h.section('T6 幂等：四个动作同 clientRequestId 重放 → duplicated:true、事件恰 1 条、version 只 +1', async (t) => {
    const db = world({ orders: [
      orderDoc('20261103-6001', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
      orderDoc('20261103-6002', ACCEPTED, { acceptedAt: new Date(NOW - 2000), transfer: transferBlock() }),
      orderDoc('20261103-6003', ACCEPTED, { acceptedAt: new Date(NOW - 2000), transfer: transferBlock() }),
      orderDoc('20261103-6004', ACCEPTED, { acceptedAt: new Date(NOW - 2000), transfer: transferBlock() })
    ] });
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    const reqCrid = nextCrid('t6req');
    const first = await p1.call('order.requestTransfer', { orderNo: '20261103-6001', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: reqCrid });
    const replay = await p1.call('order.requestTransfer', { orderNo: '20261103-6001', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: reqCrid });
    t.eq([first.ok, replay.data.duplicated, eventTypesOf(db, '20261103-6001').length,
      rowOf(db, '20261103-6001').version], [true, true, 1, 4],
    'T6-1 requestTransfer 重放 duplicated=true、事件恰 1 条、version 只 +1');

    const accCrid = nextCrid('t6acc');
    await p2.call('order.acceptTransfer', { orderNo: '20261103-6001' }, { clientRequestId: accCrid });
    const accReplay = await p2.call('order.acceptTransfer', { orderNo: '20261103-6001' },
      { clientRequestId: accCrid });
    t.eq([accReplay.data.duplicated, eventTypesOf(db, '20261103-6001').length,
      rowOf(db, '20261103-6001').version], [true, 2, 5],
    'T6-2 acceptTransfer 重放 duplicated=true、事件 2 条（REQUESTED+ACCEPTED）、version=5');

    const decCrid = nextCrid('t6dec');
    await p2.call('order.declineTransfer', { orderNo: '20261103-6002' }, { clientRequestId: decCrid });
    const decReplay = await p2.call('order.declineTransfer', { orderNo: '20261103-6002' },
      { clientRequestId: decCrid });
    t.eq([decReplay.data.duplicated, eventTypesOf(db, '20261103-6002'), rowOf(db, '20261103-6002').version],
      [true, ['TRANSFER_DECLINED'], 4], 'T6-3 declineTransfer 重放 duplicated=true、事件恰 1 条、version=4');

    const canCrid = nextCrid('t6can');
    await p1.call('order.cancelTransfer', { orderNo: '20261103-6003' }, { clientRequestId: canCrid });
    const canReplay = await p1.call('order.cancelTransfer', { orderNo: '20261103-6003' },
      { clientRequestId: canCrid });
    t.eq([canReplay.data.duplicated, eventTypesOf(db, '20261103-6003'), rowOf(db, '20261103-6003').version],
      [true, ['TRANSFER_CANCELLED'], 4], 'T6-4 cancelTransfer 重放 duplicated=true、事件恰 1 条、version=4');

    const decIdem = await p2.call('order.declineTransfer', { orderNo: '20261103-6004' },
      { clientRequestId: nextCrid('t6dec2') });
    t.eq([decIdem.ok, decIdem.data.duplicated], [true, undefined],
      'T6-5 declineTransfer 首次请求无 duplicated 标记（幂等标记只在重放出现）');
  });
}

// ================================================================ T7 限流
// 挡：删限流（可无限刷发起）；阈值写死数字（不读 config.transferRate）。
async function sectionT7(h) {
  h.section('T7 限流：rl:transfer:{openid}:{分钟/日} 打满 → RATE_LIMITED 且零业务写；阈值 config 单源', async (t) => {
    const db = world({
      config: { transferRate: { perMinute: 1, perDay: 2 } },
      orders: [orderDoc('20261103-7001', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
        orderDoc('20261103-7002', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })]
    });
    const api = apiOf(db, P1);
    const first = await api.call('order.requestTransfer', { orderNo: '20261103-7001', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t7a') });
    t.check(first.ok, 'T7-1 第 1 次发起（限额 1 次/分钟）成功');
    const blocked = await expectCode(t, api.call('order.requestTransfer',
      { orderNo: '20261103-7002', toPartnerNo: 'PBBBBBB' }, { clientRequestId: nextCrid('t7b') }),
    'RATE_LIMITED', 'T7-2 同分钟第 2 次发起 → RATE_LIMITED');
    t.eq([rowOf(db, '20261103-7002').transfer, rowOf(db, '20261103-7002').version,
      eventTypesOf(db, '20261103-7002').length], [undefined, 3, 0],
    'T7-3 限流拒绝零业务写入（transfer/version/事件均不变）');
    const keys = countersOf(db).map((row) => row.key);
    const minuteKeys = keys.filter((key) => key.indexOf('rl:transfer:' + P1 + ':w') === 0);
    const dayKeys = keys.filter((key) => key.indexOf('rl:transfer:' + P1 + ':d') === 0);
    t.eq([minuteKeys.length, dayKeys.length], [1, 1],
      'T7-4 计数桶键形态 = rl:transfer:{effectiveOpenid}:wYYYYMMDDHHmm 与 :dYYYYMMDD');

    const wideDb = world({
      config: { transferRate: { perMinute: 2, perDay: 20 } },
      orders: [orderDoc('20261103-7101', ACCEPTED, { acceptedAt: new Date(NOW - 2000) }),
        orderDoc('20261103-7102', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })]
    });
    const wide = apiOf(wideDb, P1);
    const one = await wide.call('order.requestTransfer', { orderNo: '20261103-7101', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t7c') });
    const two = await wide.call('order.requestTransfer', { orderNo: '20261103-7102', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t7d') });
    t.eq([one.ok, two.ok], [true, true],
      'T7-5 对照：config.transferRate.perMinute=2 时两次均放行（阈值 config 单源，非写死）');
  });
}

// ================================================================ T8 DTO 键白名单
// 挡：目标兼职视图回带 counterpart/customerNo/openid/内部 id；transfer 块多键/少键。
async function sectionT8(h) {
  h.section('T8 DTO 键白名单：目标视图 7 键 / 顾客 2 键 / admin 5 键；字符串级零 displayName/customerNo/openid', async (t) => {
    const db = world({
      config: { transferRate: { perMinute: 50, perDay: 500 } },
      orders: [orderDoc('20261103-8001', ACCEPTED, {
        acceptedAt: new Date(NOW - 2000), transfer: transferBlock()
      })]
    });
    const targetGet = await apiOf(db, P2).call('order.get', { orderNo: '20261103-8001' });
    t.check(targetGet.ok, 'T8-1 PENDING 邀请目标兼职可读 order.get（D58 放宽读权限）');
    const targetDto = targetGet.data.order;
    t.eq(transferKeysOf(targetDto), PARTNER_TRANSFER_KEYS,
      'T8-2 目标视图 transfer 块恰 7 键白名单（status/fromPartnerNo/toPartnerNo/requestedAt/expiresAt/resolvedAt/resolveReason）');
    t.eq(bannedHitsOf(targetDto), [],
      'T8-3 目标视图字符串级零 displayName/avatarUrl/customerNo/openid/toPartnerId/fromPartnerId');
    t.eq([Object.prototype.hasOwnProperty.call(targetDto, 'customerNo'), targetDto.counterpart, targetDto.guest],
      [false, null, null], 'T8-4 目标视图无 customerNo 键 / counterpart=null / guest=null（D58 明示）');
    t.eq([targetDto.dorm && targetDto.dorm.roomTag, Object.prototype.hasOwnProperty.call(targetDto, 'note'),
      Object.prototype.hasOwnProperty.call(targetDto, 'delivery'), Array.isArray(targetDto.parcels)],
    ['A', true, true, true], 'T8-5 目标视图保留履约必需 roomTag/note/delivery/parcels');
    const ownerGet = await apiOf(db, P1).call('order.get', { orderNo: '20261103-8001' });
    t.eq(transferKeysOf(ownerGet.data.order), PARTNER_TRANSFER_KEYS,
      'T8-6 发起方视图同样 7 键白名单');
    t.check(ownerGet.data.order.counterpart && ownerGet.data.order.counterpart.displayName,
      'T8-7 发起方（绑定兼职）仍可见绑定顾客 counterpart（不被转派误伤）');

    const pendingCustomer = await apiOf(db, C1).call('order.get', { orderNo: '20261103-8001' });
    t.eq(pendingCustomer.data.order.transfer, null,
      'T8-8 顾客在邀请 PENDING 期间 transfer=null（"还没定"不误导顾客）');
    const acceptedDb = world({ orders: [orderDoc('20261103-8002', ACCEPTED, {
      acceptedAt: new Date(NOW - 3000), partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
      transfer: acceptedTransferBlock()
    })] });
    const customerAccepted = await apiOf(acceptedDb, C1).call('order.get', { orderNo: '20261103-8002' });
    t.eq(transferKeysOf(customerAccepted.data.order), CUSTOMER_TRANSFER_KEYS,
      'T8-9 顾客在转派 ACCEPTED 后 transfer 恰 2 键（status/toPartnerNo，无发起方/时间）');

    const adminView = adminDto.orderDetail(rowOf(acceptedDb, '20261103-8002'), {
      customerDisplayName: '顾客甲', partnerDisplayName: '阿乙'
    });
    t.eq(transferKeysOf(adminView), ADMIN_TRANSFER_KEYS,
      'T8-10 admin 只读投影 transfer 恰 5 键（status/fromPartnerNo/toPartnerNo/expiresAt/resolveReason）');
    const adminJson = jsonOf(adminView);
    t.eq(['openid', 'fromPartnerId', 'toPartnerId', 'requestKey'].filter((word) => adminJson.indexOf(word) >= 0), [],
      'T8-11 admin 投影字符串级零 openid/内部 id/幂等键（脱敏昵称/编号为合法字段）');
  });
}

// ================================================================ T9 顾客侧
// 挡：顾客侧按 order.partnerId 取 counterpart（转派后显示新兼职昵称）；私有事件进顾客时间线。
async function sectionT9(h) {
  h.section('T9 顾客侧：fulfillmentPartnerNo=新 partnerNo、counterpart 仍=绑定兼职、私有事件不进顾客时间线', async (t) => {
    const db = world({ orders: [orderDoc('20261103-9001', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })] });
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    const customer = apiOf(db, C1);
    const beforeAccept = await customer.call('order.get', { orderNo: '20261103-9001' });
    t.eq(beforeAccept.data.order.transfer, null, 'T9-1 转派前顾客 transfer=null（无转派痕迹）');
    const req = await p1.call('order.requestTransfer', { orderNo: '20261103-9001', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t9req') });
    t.check(req.ok, 'T9-2 发起转派成功');
    const pendingCustomer = await customer.call('order.get', { orderNo: '20261103-9001' });
    t.eq([pendingCustomer.data.order.transfer, pendingCustomer.data.order.fulfillmentPartnerNo,
      pendingCustomer.data.order.counterpart && pendingCustomer.data.order.counterpart.displayName],
    [null, 'PAAAAAA', '阿甲'], 'T9-3 PENDING 期间顾客只见当前履约编号+绑定兼职，无转派块');
    await p2.call('order.acceptTransfer', { orderNo: '20261103-9001' }, { clientRequestId: nextCrid('t9acc') });
    const after = await customer.call('order.get', { orderNo: '20261103-9001' });
    t.eq(after.data.order.fulfillmentPartnerNo, 'PBBBBBB',
      'T9-4 转派完成后顾客 fulfillmentPartnerNo=新 partnerNo（当前实际履约者）');
    t.eq(after.data.order.counterpart && after.data.order.counterpart.displayName, '阿甲',
      'T9-5 顾客 counterpart 仍=绑定兼职（D4 绑定不变，不是新履约人）');
    t.eq([after.data.order.transfer.status, after.data.order.transfer.toPartnerNo], [TRANSFER_STATUS.ACCEPTED, 'PBBBBBB'],
      'T9-6 顾客侧 transfer{status,toPartnerNo} 仅 ACCEPTED 后可见且编号脱敏');
    const customerEventTypes = after.data.events.map((event) => event.type).filter((type) => type.indexOf('TRANSFER_') === 0);
    t.eq(customerEventTypes, ['TRANSFER_ACCEPTED'],
      'T9-7 顾客时间线只剩 TRANSFER_ACCEPTED，4 个私有事件被过滤');
    const targetGet = await p2.call('order.get', { orderNo: '20261103-9001' });
    t.eq(targetGet.data.events.map((event) => event.type).filter((type) => type.indexOf('TRANSFER_') === 0),
      ['TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED'],
      'T9-8 兼职（转派目标）时间线全量下发转派留痕（与服务端事件裁剪口径分工）');
    t.eq(bannedHitsOf(targetGet.data.order), [],
      'T9-9 完成后目标兼职 DTO 仍零顾客昵称头像/customerNo');
    const hidden = enums.MESSAGE_HIDDEN_EVENT_TYPES;
    const pureAdmin = orderDto.buildEventDtos([
      { type: 'TRANSFER_REQUESTED', at: new Date(NOW), actorRole: 'PARTNER', note: '' },
      { type: 'TRANSFER_ACCEPTED', at: new Date(NOW), actorRole: 'PARTNER', note: '' }
    ], 'ADMIN');
    t.eq([hidden.length, hidden.indexOf('TRANSFER_ACCEPTED'), pureAdmin.length],
      [4, -1, 2], 'T9-10 MESSAGE_HIDDEN_EVENT_TYPES 恰 4 个私有事件且不含 ACCEPTED；ADMIN 侧全量');
    // message.list 消息中心同口径：顾客只收到 TRANSFER_ACCEPTED（私有邀请事件不进红点/未读）
    const msgDb = world({ orders: [orderDoc('20261103-9002', ACCEPTED, {
      acceptedAt: new Date(NOW - 3000), partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
      transfer: acceptedTransferBlock()
    })] });
    msgDb.seed('order_events', [
      { _id: 'ev-9002-1', orderId: 'o-20261103-9002', orderNo: '20261103-9002', type: 'TRANSFER_REQUESTED', fromStatus: ACCEPTED, toStatus: ACCEPTED, actorRole: ROLES.PARTNER, at: new Date(NOW - 2 * MINUTE), note: '', payload: {}, requestKey: 'k-b26-9002-1' },
      { _id: 'ev-9002-2', orderId: 'o-20261103-9002', orderNo: '20261103-9002', type: 'TRANSFER_ACCEPTED', fromStatus: ACCEPTED, toStatus: ACCEPTED, actorRole: ROLES.PARTNER, at: new Date(NOW - MINUTE), note: '', payload: {}, requestKey: 'k-b26-9002-2' }
    ]);
    const center = await apiOf(msgDb, C1).call('message.list', {});
    t.eq([center.ok, center.data.list.length, center.data.unread], [true, 1, 1],
      'T9-11 顾客消息中心：2 条转派事件只下发 TRANSFER_ACCEPTED（私有事件不进列表/未读计数）');
  });
}

// ================================================================ T10 完成后失联 + 待接收列表
// 挡：用 transfer.fromPartnerId 放行原兼职读；待接收列表泄漏 customerNo/客户信息；主视图缺 transferPending 角标。
async function sectionT10(h) {
  h.section('T10 完成后原兼职失联 & listPartner：transfer 视图/counts/主视图 transferPending', async (t) => {
    const db = world({ orders: [orderDoc('20261103-1001', ACCEPTED, {
      acceptedAt: new Date(NOW - 2000)
    })] });
    const bindingBefore = db.dump('bindings');
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    const req = await p1.call('order.requestTransfer', { orderNo: '20261103-1001', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t10req') });
    t.check(req.ok, 'T10-1 发起转派成功');
    const targetList = await p2.call('order.listPartner', { view: 'transfer' });
    t.eq([targetList.ok, targetList.data.list.length, targetList.data.transferPending],
      [true, 1, 1], 'T10-2 目标兼职待接收列表：1 行 + 顶层 transferPending=1');
    t.eq(Object.keys(targetList.data.counts).sort(), COUNTS_KEYS,
      'T10-3 待接收列表 counts 六项零值模板（形状不变）');
    t.eq([transferKeysOf(targetList.data.list[0]), bannedHitsOf(targetList.data.list[0])],
      [PARTNER_TRANSFER_KEYS, []], 'T10-4 待接收行：transfer 7 键 / 零 customerNo/counterpart 昵称泄漏');
    const fromList = await p1.call('order.listPartner', { view: 'transfer' });
    t.eq([fromList.data.list.length, fromList.data.transferPending], [0, 0],
      'T10-5 发起方查待接收列表为空（目标独占的服务端过滤）');
    const workbenchFlag = await p2.call('order.listPartner', { view: 'workbench' });
    t.eq(workbenchFlag.data.transferPending, 1,
      'T10-6 workbench 主视图顶层 transferPending=1（W4 轮询不再多打一次 view=transfer）');
    const dayFlag = await p2.call('order.listPartner', { view: 'day' });
    const historyFlag = await p2.call('order.listPartner', { view: 'history' });
    t.eq([dayFlag.data.transferPending, Object.prototype.hasOwnProperty.call(historyFlag.data, 'transferPending')],
      [1, false], 'T10-7 day 视图带 transferPending；history 视图保持严格 3 键形状（不下发角标）');
    const noFlag = await p1.call('order.listPartner', { view: 'workbench' });
    t.eq(noFlag.data.transferPending, 0,
      'T10-8 无 PENDING 邀请时主视图 transferPending=0（不是隐藏键）');
    const customerView = await p1.call('order.listPartner', { view: 'customer', bindingId: 'bind-b26-c1' });
    t.eq(Object.keys(customerView.data).sort(), ['list', 'nextCursor'],
      'T10-9 customer 视图保持严格 {list,nextCursor} 形状（无角标；TD-050 口径不扩全视图）');
    await p2.call('order.acceptTransfer', { orderNo: '20261103-1001' }, { clientRequestId: nextCrid('t10acc') });
    const oldRead = await p1.call('order.get', { orderNo: '20261103-1001' });
    t.eq([oldRead.ok, oldRead.code], [false, 'FORBIDDEN'],
      'T10-10 完成后原兼职 order.get → FORBIDDEN（已非履约人，不是 transfer.fromPartnerId 放行）');
    const oldWorkbench = await p1.call('order.listPartner', { view: 'workbench' });
    t.eq(oldWorkbench.data.list.map((row) => row.orderNo), [],
      'T10-11 完成后原兼职工作台不再返回该单（服务端按当前归属过滤）');
    const targetAfter = await p2.call('order.listPartner', { view: 'transfer' });
    t.eq([targetAfter.data.list.length, targetAfter.data.transferPending], [0, 0],
      'T10-12 确认后目标待接收列表清空（transfer 已 ACCEPTED）');
    const afterFlag = await p2.call('order.listPartner', { view: 'workbench' });
    t.eq(afterFlag.data.transferPending, 0, 'T10-13 确认后主视图角标归零');
    t.eq(sameJson(db.dump('bindings'), bindingBefore), true,
      'T10-14 整个转派过程 bindings 零改动（转派≠换绑）');
    t.eq(rowOf(db, '20261103-1001').transfer.status, TRANSFER_STATUS.ACCEPTED,
      'T10-15 订单 transfer 终态 ACCEPTED（单值覆盖语义）');
    const badView = await p1.call('order.listPartner', { view: 'transfer', bindingId: 'bind-b26-c1' });
    t.eq([badView.ok, badView.code, badView.data && badView.data.field], [false, 'VALIDATION_FAILED', 'bindingId'],
      'T10-16 transfer 视图拒绝不支持的筛选参数（不静默忽略）');
  });
}

// ================================================================ T11 统计归属
// 挡：统计读 transfer.fromPartnerId（转派后原兼职仍计数）。
async function sectionT11(h) {
  h.section('T11 统计归属：counts/partner.stats 按当前 partnerId 计（原兼职 -1、目标 +1）', async (t) => {
    const db = world({ orders: [orderDoc('20261103-1101', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })] });
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    await p1.call('order.requestTransfer', { orderNo: '20261103-1101', toPartnerNo: 'PBBBBBB' },
      { clientRequestId: nextCrid('t11req') });
    const beforeAccept = await p1.call('order.listPartner', { view: 'workbench' });
    t.eq(beforeAccept.data.counts.accepted, 1,
      'T11-1 PENDING 期间订单仍计在原履约人名下（transfer 不改归属）');
    await p2.call('order.acceptTransfer', { orderNo: '20261103-1101' }, { clientRequestId: nextCrid('t11acc') });
    const oldCounts = await p1.call('order.listPartner', { view: 'workbench' });
    const newCounts = await p2.call('order.listPartner', { view: 'workbench' });
    t.eq([oldCounts.data.counts.accepted, newCounts.data.counts.accepted], [0, 1],
      'T11-2 确认后 listPartner counts：原兼职 accepted -1、目标 +1（按当前 partnerId）');
    const oldStats = await p1.call('partner.stats', { range: 'today' });
    const newStats = await p2.call('partner.stats', { range: 'today' });
    t.eq([oldStats.ok, oldStats.data.counts.active, newStats.ok, newStats.data.counts.active],
      [true, 0, true, 1], 'T11-3 partner.stats active 计数按当前归属：原兼职 0 / 目标 1');
  });
}

// ================================================================ T12 匿名化
// 挡：漏清 transfer 编号快照/内部 id（匿名化后仍可关联到人）。
async function sectionT12(h) {
  h.section('T12 匿名化（单源=cleanup retention.js）：清双方编号+内部 id，保留 status/resolveReason', async (t) => {
    const cleanupDb = cleanupTestDb();
    const transfer = transferBlock({
      status: TRANSFER_STATUS.ACCEPTED,
      resolvedAt: new Date(NOW - 181 * DAY + MINUTE),
      resolveReason: TRANSFER_REASON.TARGET_ACCEPTED
    });
    const completedAt = NOW - 181 * DAY;
    cleanupDb.seed(cleanupCollectionsOf('ORDERS'), [
      {
        _id: 'ret-b26-1', orderNo: '20261103-12001', requestKey: 'rq-ret-b26-1',
        customerId: 'CUST-X', customerOpenid: 'CUST-X', customerNo: 'CXXXXXXXX',
        partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
        status: cleanupEnums.ORDER_STATUS.COMPLETED, statusUpdatedAt: completedAt,
        createdAt: completedAt - DAY, updatedAt: completedAt, completedAt: completedAt,
        phoneTail: '6678', note: '备注', dorm: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' },
        guest: null, delivery: null, exception: null, cancelReason: '',
        parcel: { stationId: 'P1', stationName: '一食堂', pickupCode: '1234', codeStatus: cleanupEnums.CODE_STATUS.OK },
        image: { fileId: '', width: 0, height: 0, failureId: '' },
        version: 3, isTest: false, transfer
      },
      {
        _id: 'ret-b26-2', orderNo: '20261103-12002', requestKey: 'rq-ret-b26-2',
        customerId: 'CUST-X', customerOpenid: 'CUST-X', customerNo: 'CXXXXXXXX',
        partnerId: PID1, partnerOpenid: P1, partnerNo: 'PAAAAAA',
        status: cleanupEnums.ORDER_STATUS.CANCELLED, statusUpdatedAt: completedAt,
        createdAt: completedAt - DAY, updatedAt: completedAt, cancelledAt: completedAt,
        phoneTail: '6678', note: '', dorm: null, guest: null, delivery: null, exception: null,
        parcel: { stationId: 'P1', pickupCode: '', codeStatus: cleanupEnums.CODE_STATUS.OK },
        image: {}, version: 2, isTest: false
      }
    ]);
    const collected = await retention.runRetention(cleanupCtx(cleanupDb));
    t.check(collected.acted >= 2, 'T12-1 cleanup retention 到期匿名化执行（acted≥2）');
    const rowOf = (id) => cleanupDb.dump(cleanupCollectionsOf('ORDERS')).filter((row) => row._id === id)[0];
    const anonymized = rowOf('ret-b26-1');
    t.eq([anonymized.transfer.fromPartnerNo, anonymized.transfer.toPartnerNo,
      anonymized.transfer.fromPartnerId, anonymized.transfer.toPartnerId], ['', '', '', ''],
    'T12-2 匿名化清 transfer 双方编号快照 + 内部 id（引用类字段）');
    t.eq([anonymized.transfer.status, anonymized.transfer.resolveReason],
      [TRANSFER_STATUS.ACCEPTED, TRANSFER_REASON.TARGET_ACCEPTED],
      'T12-3 匿名化保留 transfer.status/resolveReason（供审计计数）');
    t.eq(Object.keys(anonymized.transfer).sort(), TRANSFER_BLOCK_KEYS,
      'T12-4 匿名化不改 transfer 块形状（9 键整值保留）');
    t.check(!!anonymized.anonymizedAt, 'T12-5 匿名化水位 anonymizedAt 已写（幂等判据）');
    t.eq([anonymized.customerId, anonymized.customerNo, anonymized.partnerNo], ['', '', ''],
      'T12-6 既有匿名化字段仍清空（本次改动不弱化存量口径）');
    const noTransfer = rowOf('ret-b26-2');
    t.eq(Object.prototype.hasOwnProperty.call(noTransfer, 'transfer'), false,
      'T12-7 无 transfer 字段的历史单匿名化不新增 transfer 键（零迁移）');
  });
}

// ================================================================ T13 静态闸
// 挡：handlers/order 出现 db.collection（绕过 dao）/ 注册表与 handler 导出集不一致。
async function sectionT13(h) {
  h.section('T13 静态闸：handlers/order/** 零 db.collection、handler 导出集=注册表、转派枚举/事件接线', async (t) => {
    const dbCollectionHits = [];
    orderFiles().forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      if (source.indexOf('db.collection') >= 0) {
        dbCollectionHits.push(relOf(file));
      }
    });
    t.eq(dbCollectionHits, [], 'T13-1 handlers/order/** 全部文件零 db.collection（唯一数据入口=dao）');
    const scan = (text) => text.indexOf('db.collection') >= 0;
    t.eq([scan('x.db.collection("orders")'), scan('// 云函数不出现 db.collection')], [true, true],
      'T13-2 静态扫描有牙正控：合成样本与注释命中均能被检出');
    t.eq(orderIndex.actions && Object.keys(orderIndex.actions).sort(), router.expectedActionsOf('order'),
      'T13-3 handlers/order 导出集 = shared/actions 注册表 order.* 集（双向，check #13 同口径）');
    t.eq(['order.requestTransfer', 'order.acceptTransfer', 'order.declineTransfer', 'order.cancelTransfer']
      .filter((action) => typeof orderIndex.actions[action] === 'function'),
    ['order.requestTransfer', 'order.acceptTransfer', 'order.declineTransfer', 'order.cancelTransfer'],
    'T13-4 四个转派 action 均已注册为函数');
    t.eq([enums.ORDER_EVENT_COUNT, enums.ORDER_EVENTS.length,
      ['TRANSFER_REQUESTED', 'TRANSFER_ACCEPTED', 'TRANSFER_DECLINED', 'TRANSFER_CANCELLED', 'TRANSFER_EXPIRED']
        .filter((type) => enums.ORDER_EVENTS.indexOf(type) >= 0).length], [24, 24, 5],
    'T13-5 事件注册表 24 类型且 5 个 TRANSFER_* 全在（19→24）');
    const rules = require(path.join(API, 'shared/order-state.js')).ACTION_RULES;
    const ruleKeys = ['order.requestTransfer', 'order.acceptTransfer', 'order.declineTransfer', 'order.cancelTransfer'];
    t.eq(ruleKeys.filter((key) => rules[key] && rules[key].to === 'SAME' && rules[key].changesStatus === false).length, 4,
      'T13-6 四个转派动作 ACTION_RULES 均 to=SAME/changesStatus=false（不改订单状态）');
    const messageListSrc = fs.readFileSync(path.join(API, 'handlers/message/list.js'), 'utf8');
    t.check(messageListSrc.indexOf('MESSAGE_HIDDEN_EVENT_TYPES') >= 0,
      'T13-7 message.list 接线 MESSAGE_HIDDEN_EVENT_TYPES（顾客消息中心拉黑 4 私有事件）');
    t.eq(cleanupShared.ORDER_EVENT_COUNT, 24,
      'T13-8 cleanup 部署单元 shared 副本事件数同步 24（sync-cloud-shared 单一来源）');
  });
}

// cleanup 环境枚举/集合别名（避免与 api 域变量混淆）
const cleanupEnums = require(path.join(ROOT, 'cloudfunctions/cleanup/shared/enums.js'));
const cleanupCollectionsSource = require(path.join(ROOT, 'cloudfunctions/cleanup/shared/collections.js')).COLLECTIONS;
function cleanupCollectionsOf(key) {
  return cleanupCollectionsSource[key];
}

// ================================================================ 注册
const EXPECTED_ASSERTIONS = 111; // 实跑回填（node tools/selftest-transfer.js | Select-Object -Last 2）

function register(h) {
  h.setExpected(EXPECTED_ASSERTIONS);
  sectionT1(h);
  sectionT2(h);
  sectionT3(h);
  sectionT4(h);
  sectionT5(h);
  sectionT6(h);
  sectionT7(h);
  sectionT8(h);
  sectionT9(h);
  sectionT10(h);
  sectionT11(h);
  sectionT12(h);
  sectionT13(h);
}

module.exports = { register, EXPECTED_ASSERTIONS };

if (require.main === module) {
  const harness = createHarness({ name: 'selftest-transfer' });
  installCrashGuard(() => ({ count: harness.count, passed: harness.passed, failures: harness.failures.length }),
    'selftest-transfer');
  register(harness);
  const ret = harness.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
