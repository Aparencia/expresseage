'use strict';
/**
 * tools/lib/transfer-handover-cases.js — D85 转派「双人可控」判据（原 D81 只读跟踪已升级）。
 * 口径（2026-11-14 用户）：发起者把订单交给别人后**仍保留控制权**，被转派的人也能控制；
 *   只读跟踪不再够用 → 转派已被接收后，原履约人按 PARTNER 侧读/写（取件/送达/改码/异常/取消/留言），
 *   但**转派邀请本身**（发起/撤回/确认/拒收）仍只归当前履约人。
 * 覆盖：发起者读完整视图 + 动作矩阵、发起者可写、现履约人仍可写、旁人 403、PENDING 不放行、终态可读。
 */
const EXPECTED_ASSERTIONS = 12;
const { proofPayload } = require('./proof-fixtures');

function register(h, deps) {
  const {
    world, orderDoc, acceptedTransferBlock, transferBlock, apiOf, nextCrid, expectCode,
    rowOf, ORDER_STATUS, PID1, PID2, P1, P2, P3, NOW
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
    // 2026-11-27 真机修复：已转出单在默认「全部」（view=day）里必须保留 D85 的行内履约动作，
    // 否则发起人看不到取件/送达入口（只能切 chip 或进详情）。
    const dayHandover = await p1.call('order.listPartner', { view: 'day' });
    const dayRow = dayHandover.data.list.filter((row) => row.orderNo === '20261114-3101')[0] || null;
    const dayKeys = ((dayRow && dayRow.actions) || []).map((action) => action.key);
    t.eq([dayHandover.ok, dayRow && dayRow.handover === true, dayKeys.indexOf('deliver') >= 0],
      [true, true, true], 'D85-3b 发起人在「全部」今日流水里对已转出单仍可取件/送达（day 视图保留行内动作）');
    const delivered = await p2.call('order.markDelivered', Object.assign({ orderNo: '20261114-3101', deliveryNote: '放门口' },
      proofPayload(db, P2, { now: NOW })), { clientRequestId: nextCrid('d85deliver') });
    t.eq([delivered.ok, delivered.data.order.status], [true, ORDER_STATUS.DELIVERED],
      'D85-4 现履约人仍可写：送达成功（原控制能力不丢）');
    const dayAfterDeliver = await p1.call('order.listPartner', { view: 'day' });
    const deliveredRow = dayAfterDeliver.data.list.filter((row) => row.orderNo === '20261114-3101')[0] || null;
    t.eq([deliveredRow && deliveredRow.actions.length], [0],
      'D85-3c 待确认桶的已转出行仍是只读（day 视图只清 delivered/history 桶的动作，与普通行同口径）');
    await expectCode(t, apiOf(db, P3).call('order.get', { orderNo: '20261114-3101' }),
      'FORBIDDEN', 'D85-5 无关兼职仍读不到（控制权只给转派双方）');
    const list = await p1.call('order.listPartner', { view: 'handover' });
    t.eq([list.ok, list.data.list.length, list.data.list[0].canControl],
      [true, 1, true], 'D85-6 已转出列表标记 canControl（客户端可进详情继续操作）');
    // D99 回归（2026-11-23 真机）：并入行必须遵守当前状态筛选，否则历史已完成转出单会混进任意 chip
    const submittedOnly = await p1.call('order.listPartner', { view: 'workbench', status: ORDER_STATUS.SUBMITTED });
    t.eq(submittedOnly.data.list.length, 0,
      'D85-7 D99 已转出并入遵守状态筛选（待接单 chip 不混入 ACCEPTED 转出单）');
    const pendingDb = world({ orders: [orderDoc('20261114-3102', ORDER_STATUS.ACCEPTED,
      Object.assign({}, OWNER, { transfer: transferBlock(Object.assign({}, TRANSFER, { status: 'PENDING' })) }))] });
    await expectCode(t, apiOf(pendingDb, P1).call('order.get', { orderNo: '20261114-3102' }),
      'FORBIDDEN', 'D85-7 仅 PENDING（未接收）不放行（对方还没接就无权控制）');
    const doneDb = world({ orders: [orderDoc('20261114-3103', ORDER_STATUS.COMPLETED,
      Object.assign({}, OWNER, { transfer: acceptedTransferBlock(TRANSFER), completedAt: new Date() }))] });
    const done = await apiOf(doneDb, P1).call('order.get', { orderNo: '20261114-3103' });
    t.eq([done.ok, done.data.order.status, done.data.order.actions.length], [true, ORDER_STATUS.COMPLETED, 0],
      'D85-8 终态仍可按原订单视图只读查看（零动作）');
    // 2026-11-27 真机「待确认一直堆积」：读路径有界补完成必须覆盖「不在本次返回页里」的昨日送达单
    const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000);
    const sweepOrders = [];
    for (let i = 0; i < 30; i += 1) {
      sweepOrders.push(orderDoc('20261114-40' + String(i).padStart(2, '0'), ORDER_STATUS.DELIVERED, {
        deliveredAt: new Date(NOW - 60 * 60 * 1000),
        statusUpdatedAt: new Date(NOW - (60 + i) * 60 * 1000)
      }));
    }
    sweepOrders.push(orderDoc('20261114-3106', ORDER_STATUS.DELIVERED, {
      deliveredAt: twoDaysAgo,
      statusUpdatedAt: twoDaysAgo
    }));
    const sweepDb = world({ orders: sweepOrders });
    const listed = await apiOf(sweepDb, P1).call('order.listPartner', { view: 'workbench', limit: 30 });
    const expired = rowOf(sweepDb, '20261114-3106');
    const inPage = listed.data.list.some((item) => item.orderNo === '20261114-3106');
    t.eq([listed.ok, listed.data.list.length, inPage, expired && expired.status, listed.data.counts.delivered],
      [true, 30, false, ORDER_STATUS.COMPLETED, 30],
      'D91-R1 读路径补完成覆盖「不在返回页」的昨日送达单（31 单中到期 1 单补完成、counts.delivered 31→30）');
  });

}

module.exports = { register, EXPECTED_ASSERTIONS };
