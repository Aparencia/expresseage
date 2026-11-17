'use strict';
// tools/lib/transfer-recent-cases.js · D90「最近使用」转派目标用例表（非独立套件，由 selftest-transfer 注册）
// 挡：把 PENDING/拒收也当"用过"、不去重、超过 5 条、停用目标仍可点、别人能看你用过的对象、
//     响应多带键、按订单更新时间而非转派时刻排序。
const path = require('path');
const fs = require('fs');
const {
  ROOT, API, NOW, P1, PID1, P3, ACCEPTED, MINUTE,
  world, apiOf, partnerDoc, orderDoc, acceptedTransferBlock, expectField
} = require('./order-transfer-cases');

const EXPECTED_ASSERTIONS = 11;

// 已「转派成功」的订单：当前归属=目标（to），发起人=P1；requestedAt 用来表达"最近"。
// statusUpdatedAt 与 requestedAt 分开传：T18-1 让两者反序，才能证明排序锚是 requestedAt 而不是状态更新时间。
function transferredOrder(orderNo, to, minutesAgo, statusMinutesAgo) {
  const statusAgo = typeof statusMinutesAgo === 'number' ? statusMinutesAgo : minutesAgo;
  return orderDoc(orderNo, ACCEPTED, {
    statusUpdatedAt: new Date(NOW - statusAgo * MINUTE),
    partnerId: to.id,
    partnerOpenid: to.openid,
    partnerNo: to.no,
    transfer: acceptedTransferBlock({
      fromPartnerId: PID1,
      fromPartnerNo: 'PAAAAAA',
      toPartnerId: to.id,
      toPartnerNo: to.no,
      requestedAt: new Date(NOW - minutesAgo * MINUTE)
    })
  });
}

const T2 = { openid: 'openid-b26-p2', id: 'partner-b26-2', no: 'PBBBBBB', name: '阿乙' };
const T3 = { openid: 'openid-b26-p3', id: 'partner-b26-3', no: 'PCCCCCC', name: '阿丙' };

function extraPartner(code, name) {
  const no = 'P' + code;
  return {
    openid: 'openid-b26-' + code.toLowerCase(),
    id: 'partner-b26-' + code.toLowerCase(),
    no: no,
    name: name,
    doc: partnerDoc('openid-b26-' + code.toLowerCase(), 'partner-b26-' + code.toLowerCase(), no, { displayName: name })
  };
}

async function sectionD90(h) {
  h.section('T18 D90 最近使用（去重/上限 5/按转派时刻/停用剔除/仅本人可见/零泄漏）', async (t) => {
    // 基线 + 顺序：两单两个目标，转派时刻不同 → 最近在前；statusUpdatedAt 故意与 requestedAt 反序，
    // 证明排序锚是 transfer.requestedAt（若改按状态更新时间排序，这一条立即红）。
    const db = world({ orders: [
      transferredOrder('20261117-2001', T2, 20, 1),
      transferredOrder('20261117-2002', T3, 5, 30)
    ] });
    const base = await apiOf(db, P1).call('partner.recentTransferTargets', {});
    t.eq([base.ok, base.data.list.map((item) => item.partnerNo).join(',')], [true, 'PCCCCCC,PBBBBBB'],
      'T18-1 按转派发起时刻倒序（丙在前、乙在后）');
    t.eq(Object.keys(base.data.list[0]).sort(), ['acceptingOrders', 'displayName', 'partnerNo'],
      'T18-2 卡片三键白名单（无 openid/_id/头像）');

    // 去重：同一目标两次转派只留一条；上限 5：7 个目标截到 5
    const extras = [extraPartner('DDD234', '阿丁'), extraPartner('EEE234', '阿戊'), extraPartner('FFF234', '阿己'),
      extraPartner('GGG234', '阿庚'), extraPartner('HHH234', '阿辛')];
    const dupDb = world({ orders: [
      transferredOrder('20261117-2011', T2, 10),
      transferredOrder('20261117-2012', T2, 30),
      transferredOrder('20261117-2013', T3, 20)
    ] });
    const dup = await apiOf(dupDb, P1).call('partner.recentTransferTargets', {});
    t.eq([dup.data.list.length, dup.data.list.filter((item) => item.partnerNo === 'PBBBBBB').length], [2, 1],
      'T18-3 同一目标多次转派只出现一次（去重）');
    const capDb = world({ orders: [
      transferredOrder('20261117-2021', T2, 70),
      transferredOrder('20261117-2022', T3, 60),
      transferredOrder('20261117-2023', extras[0], 50),
      transferredOrder('20261117-2024', extras[1], 40),
      transferredOrder('20261117-2025', extras[2], 30),
      transferredOrder('20261117-2026', extras[3], 20),
      transferredOrder('20261117-2027', extras[4], 10)
    ] });
    capDb.seed('partners', extras.map((item) => item.doc));
    const cap = await apiOf(capDb, P1).call('partner.recentTransferTargets', {});
    t.eq([cap.ok, cap.data.list.length], [true, 5], 'T18-4 最多回 5 条（D90 默认值）');
    t.eq(cap.data.list[0].partnerNo, extras[4].no, 'T18-5 截断取最近的 5 个（最新一条在前）');

    // 停用目标剔除（转过但已 SUSPENDED 不再出现）——用独立目标，避免与既存 P2/P3 撞唯一索引
    const susp = extraPartner('SUX234', '阿停');
    const suspDb = world({ orders: [
      transferredOrder('20261117-2031', T2, 10),
      transferredOrder('20261117-2032', susp, 20)
    ] });
    suspDb.seed('partners', [partnerDoc(susp.openid, susp.id, susp.no, {
      displayName: susp.name, status: 'SUSPENDED'
    })]);
    const suspRes = await apiOf(suspDb, P1).call('partner.recentTransferTargets', {});
    t.eq(suspRes.data.list.map((item) => item.partnerNo), ['PBBBBBB'],
      'T18-6 停用（SUSPENDED）目标不进"最近使用"（避免点了才发现不能转）');

    // PENDING 不计（只是发起过、还没被接收）
    const pendDb = world({ orders: [
      orderDoc('20261117-2041', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })
    ] });
    await apiOf(pendDb, P1).call('order.requestTransfer',
      { orderNo: '20261117-2041', toPartnerNo: 'PCCCCCC' }, { clientRequestId: 'crid-d90-pend' });
    const pend = await apiOf(pendDb, P1).call('partner.recentTransferTargets', {});
    t.eq(pend.data.list.length, 0, 'T18-7 仅 PENDING（对方还没接收）不计入"最近使用"');

    // 仅本人可见 + 参数防御 + 静态闸
    const other = await apiOf(db, P3).call('partner.recentTransferTargets', {});
    t.eq(other.data.list.length, 0, 'T18-8 别人看不到你用过的对象（只按 fromPartnerId=本人派生）');
    await expectField(t, apiOf(db, P1).call('partner.recentTransferTargets', { keyword: '阿乙' }),
      'VALIDATION_FAILED', 'keyword', 'T18-9 不接受关键词（本动作只回本人用过的对象，不是检索）');
    const src = fs.readFileSync(path.join(API, 'handlers/partner/recentTransferTargets.js'), 'utf8');
    t.check(src.indexOf('db.collection') === -1, 'T18-10 handler 零 db.collection（只经 ctx.dao）');
    const actions = require(path.join(ROOT, 'shared/actions.js'));
    t.eq(actions.actionMeta('partner.recentTransferTargets'), { visibility: 'client', write: false },
      'T18-11 动作规则=client 读动作（可重试、READONLY 不拦）');
  });
}

module.exports = { register: sectionD90, EXPECTED_ASSERTIONS };
