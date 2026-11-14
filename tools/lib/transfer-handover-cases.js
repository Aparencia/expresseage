'use strict';
/**
 * tools/lib/transfer-handover-cases.js — D85 转派「双人可控」判据（原 D81 只读跟踪已升级）。
 * 口径（2026-11-14 用户）：发起者把订单交给别人后**仍保留控制权**，被转派的人也能控制；
 *   只读跟踪不再够用 → 转派已被接收后，原履约人按 PARTNER 侧读/写（取件/送达/改码/异常/取消/留言），
 *   但**转派邀请本身**（发起/撤回/确认/拒收）仍只归当前履约人。
 * 覆盖：发起者读完整视图 + 动作矩阵、发起者可写、现履约人仍可写、旁人 403、PENDING 不放行、终态可读。
 */
const EXPECTED_ASSERTIONS = 8;

function register(h, deps) {
  const {
    world, orderDoc, acceptedTransferBlock, transferBlock, apiOf, nextCrid, expectCode,
    ORDER_STATUS, PID1, PID2, P1, P2, P3
  } = deps;
  const TRANSFER = { status: 'ACCEPTED', fromPartnerId: PID1, fromPartnerNo: 'PAAAAAA' };
  const OWNER = { partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB' };
  const handoverOrder = () => orderDoc('20261114-3101', ORDER_STATUS.ACCEPTED,
    Object.assign({}, OWNER, { transfer: acceptedTransferBlock(TRANSFER) }));

  h.section('D85 转派双人可控：发起者保留控制 / 现履约人仍可控', async (t) => {
    const db = world({ orders: [handoverOrder()] });
    const p1 = apiOf(db, P1);
    const p2 = apiOf(db, P2);
    const got = await p1.call('order.get', { orderNo: '20261114-3101' });
    t.eq([got.ok, got.data && got.data.handover, got.data && got.data.order && got.data.order.status],
      [true, undefined, ORDER_STATUS.ACCEPTED], 'D85-1 发起者 order.get 返回完整订单视图（不再只是只读跟踪）');
    const keys = (got.data.order.actions || []).map((action) => action.key);
    t.eq([keys.indexOf('requestTransfer'), keys.indexOf('cancelTransfer'), keys.indexOf('pick') >= 0],
      [-1, -1, true], 'D85-2 发起者可继续履约，但不持有转派邀请（发起/撤回仍归当前履约人）');
    const picked = await p1.call('order.markPicked', { orderNo: '20261114-3101' },
      { clientRequestId: nextCrid('d85pick') });
    t.eq([picked.ok, picked.data && picked.data.order && picked.data.order.status],
      [true, ORDER_STATUS.PICKED], 'D85-3 发起者可写：取件成功（与现履约人双人可控）');
    const delivered = await p2.call('order.markDelivered', { orderNo: '20261114-3101', deliveryNote: '放门口' },
      { clientRequestId: nextCrid('d85deliver') });
    t.eq([delivered.ok, delivered.data.order.status], [true, ORDER_STATUS.DELIVERED],
      'D85-4 现履约人仍可写：送达成功（原控制能力不丢）');
    await expectCode(t, apiOf(db, P3).call('order.get', { orderNo: '20261114-3101' }),
      'FORBIDDEN', 'D85-5 无关兼职仍读不到（控制权只给转派双方）');
    const list = await p1.call('order.listPartner', { view: 'handover' });
    t.eq([list.ok, list.data.list.length, list.data.list[0].canControl],
      [true, 1, true], 'D85-6 已转出列表标记 canControl（客户端可进详情继续操作）');
    const pendingDb = world({ orders: [orderDoc('20261114-3102', ORDER_STATUS.ACCEPTED,
      Object.assign({}, OWNER, { transfer: transferBlock(Object.assign({}, TRANSFER, { status: 'PENDING' })) }))] });
    await expectCode(t, apiOf(pendingDb, P1).call('order.get', { orderNo: '20261114-3102' }),
      'FORBIDDEN', 'D85-7 仅 PENDING（未接收）不放行（对方还没接就无权控制）');
    const doneDb = world({ orders: [orderDoc('20261114-3103', ORDER_STATUS.COMPLETED,
      Object.assign({}, OWNER, { transfer: acceptedTransferBlock(TRANSFER), completedAt: new Date() }))] });
    const done = await apiOf(doneDb, P1).call('order.get', { orderNo: '20261114-3103' });
    t.eq([done.ok, done.data.order.status, done.data.order.actions.length], [true, ORDER_STATUS.COMPLETED, 0],
      'D85-8 终态仍可按原订单视图只读查看（零动作）');
  });
}

module.exports = { register, EXPECTED_ASSERTIONS };
