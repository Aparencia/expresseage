'use strict';
/**
 * tools/lib/transfer-handover-cases.js — D81「已转出」发起者只读跟踪判据（拆出控 selftest-transfer ≤1000 行）。
 * 覆盖：发起者读跟踪视图（最小投影/零 PII/零动作）、新履约人仍走原视图、无关兼职 FORBIDDEN、
 *      列表只回本人转出、PENDING 未接收不可跟踪、终态仍可跟踪、写动作仍 FORBIDDEN。
 */
const EXPECTED_ASSERTIONS = 10;

function register(h, deps) {
  const {
    world, orderDoc, acceptedTransferBlock, transferBlock, apiOf, nextCrid, expectCode,
    topKeysOf, jsonOf, ORDER_STATUS, PID1, PID2, P1, P2, P3
  } = deps;
  const TRANSFER = { status: 'ACCEPTED', fromPartnerId: PID1, fromPartnerNo: 'PAAAAAA' };
  const OWNER = { partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB' };
  const handoverOrder = () => orderDoc('20261114-3101', ORDER_STATUS.ACCEPTED, Object.assign({},
    OWNER, { transfer: acceptedTransferBlock(TRANSFER) }));
  const TRACK_KEYS = [
    'allPicked', 'cancelledAt', 'completedAt', 'deliveredAt', 'fulfillmentPartnerNo', 'handover',
    'orderNo', 'parcelCount', 'pickedCount', 'progressIndex', 'service', 'status', 'statusText',
    'statusUpdatedAt', 'transfer'
  ].sort();

  h.section('D81 已转出：发起者只读跟踪 / 列表 / 写动作拒绝', async (t) => {
    const db = world({ orders: [handoverOrder()] });
    const p1 = apiOf(db, P1);
    const got = await p1.call('order.get', { orderNo: '20261114-3101' });
    t.eq([got.ok, got.data && got.data.handover, got.data && got.data.order && got.data.order.handover],
      [true, true, true], 'D81-1 发起者 order.get 返回跟踪视图（handover=true）');
    t.eq(topKeysOf(got.data.order), TRACK_KEYS, 'D81-2 跟踪视图键集合固定（最小投影，零多余字段）');
    t.eq(['customerNo', 'displayName', 'dorm', 'delivery', 'parcels', 'pickupCode', 'actions']
      .filter((key) => jsonOf(got.data.order).indexOf('"' + key + '"') !== -1), [],
    'D81-3 跟踪视图零顾客身份/地址/取件码/动作（不因转派扩大可见面）');
    const ownerView = await apiOf(db, P2).call('order.get', { orderNo: '20261114-3101' });
    t.eq([ownerView.ok, ownerView.data.handover === undefined, ownerView.data.order.actions.length > 0],
      [true, true, true], 'D81-4 新履约人仍走原订单视图（handover 不串、动作矩阵不变）');
    await expectCode(t, apiOf(db, P3).call('order.get', { orderNo: '20261114-3101' }),
      'FORBIDDEN', 'D81-5 无关兼职读已转出单 → FORBIDDEN');
    const list = await p1.call('order.listPartner', { view: 'handover' });
    t.eq([list.ok, list.data.handover, list.data.list.length, list.data.list[0].handover],
      [true, true, 1, true], 'D81-6 已转出列表只回本人转出（行=跟踪投影）');
    t.eq((await apiOf(db, P2).call('order.listPartner', { view: 'handover' })).data.list.length, 0,
      'D81-7 新履约人的已转出列表为空（发起者维度隔离）');
    await expectCode(t, p1.call('order.markPicked', { orderNo: '20261114-3101' },
      { clientRequestId: nextCrid('d81write') }), 'FORBIDDEN', 'D81-8 发起者对已转出单仍零写权限');
    const pendingDb = world({ orders: [orderDoc('20261114-3102', ORDER_STATUS.ACCEPTED,
      Object.assign({}, OWNER, { transfer: transferBlock(Object.assign({}, TRANSFER, { status: 'PENDING' })) }))] });
    await expectCode(t, apiOf(pendingDb, P1).call('order.get', { orderNo: '20261114-3102' }),
      'FORBIDDEN', 'D81-9 仅 PENDING（未接收）不开放跟踪（避免"对方还没接就偷看"）');
    const doneDb = world({ orders: [orderDoc('20261114-3103', ORDER_STATUS.COMPLETED,
      Object.assign({}, OWNER, { transfer: acceptedTransferBlock(TRANSFER), completedAt: new Date() }))] });
    const done = await apiOf(doneDb, P1).call('order.get', { orderNo: '20261114-3103' });
    t.eq([done.ok, done.data.handover, done.data.order.status], [true, true, ORDER_STATUS.COMPLETED],
      'D81-10 转出单到终态仍可跟踪进度（不含任何操作）');
  });
}

module.exports = { register, EXPECTED_ASSERTIONS };
