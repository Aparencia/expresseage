'use strict';
// tools/lib/transfer-search-cases.js · D87-a 转派候选检索用例表（非独立套件，由 tools/selftest-transfer.js 注册）
// 拆件来由：T15 使 selftest-transfer.js 超过 1000 行（门禁 #18）→ 用例表拆 lib（先例 lib/transfer-handover-cases.js）。
const path = require('path');
const fs = require('fs');
const {
  ROOT, API, NOW, C1, P1, PID1, TEST_P, PARTNER_STATUS, ROLES,
  world, apiOf, partnerDoc, userDoc, expectCode, expectField
} = require('./order-transfer-cases');

const EXPECTED_ASSERTIONS = 20;

// ================================================================ T15 D87-a 转派候选检索
// 挡：关键词闸失效（1 字也能搜=可枚举）、前缀变片段、跨真实×测试、子队员搜到外队、停用/注销混入、
//     卡片多带键（openid/_id/头像）、无限流、结果不设上限、非兼职可调。
async function sectionT15(h) {
  h.section('T15 D87-a 转派候选检索（前缀/同侧隔离/子队员限本队/三键白名单/限流/结果上限）', async (t) => {
    // 合法基线：昵称前缀恰好命中一条；卡片三键白名单
    const db = world({});
    const base = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿乙' });
    t.check(base.ok === true && base.data.list.length === 1 && base.data.list[0].partnerNo === 'PBBBBBB'
      && base.data.list[0].displayName === '阿乙',
    'T15-1 昵称前缀命中恰一条（阿乙 / PBBBBBB）');
    t.eq(Object.keys(base.data.list[0]).sort(), ['acceptingOrders', 'displayName', 'partnerNo'],
      'T15-2 卡片三键白名单（无 openid/_id/头像/stats）');
    // 编号：带 P、连字符、小写都能归一命中；昵称只认前缀（片段不命中）；排除自己
    const byCode = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: 'p-bbb' });
    t.check(byCode.ok === true && byCode.data.list.length === 1 && byCode.data.list[0].partnerNo === 'PBBBBBB',
      'T15-3 编号前缀归一（p-bbb → PBBBBBB）');
    // 真片段样本：昵称「阿丙丁」的中缀「丙丁」不得命中（只认前缀；若实现改成 indexOf 子串，这一条立即红）
    db.seed('partners', [partnerDoc('openid-b26-mid', 'partner-b26-mid', 'PMIDAAA', { displayName: '阿丙丁' })]);
    const fragment = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '丙丁' });
    t.check(fragment.ok === true && fragment.data.list.length === 0, 'T15-4 昵称只认前缀（「阿丙丁」的中缀「丙丁」不命中）');
    const self = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿甲' });
    t.check(self.ok === true && self.data.list.length === 0, 'T15-5 候选排除自己（阿甲搜阿甲=空）');
    // 关键词闸：1 个字既不够编号也不够昵称 → VALIDATION_FAILED(field=keyword)
    await expectField(t, apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿' }),
      'VALIDATION_FAILED', 'keyword', 'T15-6 关键词过短（1 字）→ VALIDATION_FAILED(field=keyword)');
    // 真实×测试隔离：测试兼职只看到测试侧，真实侧看不到测试侧
    const testSide = await apiOf(db, TEST_P).call('partner.searchTransferTargets', { keyword: '测试兼职' });
    t.eq([testSide.ok, testSide.data.list.map((item) => item.partnerNo).sort()],
      [true, ['PTESTBB']], 'T15-7 测试侧只返回测试侧候选（同侧隔离 + 排除自己 PTESTAA）');
    const realSide = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '测试兼职' });
    t.check(realSide.ok === true && realSide.data.list.length === 0, 'T15-8 真实侧看不到测试侧候选（反向隔离）');
    // 非 ACTIVE / 已注销不进候选；acceptingOrders=false 仍可被选（可转派口径只看 ACTIVE）
    db.seed('partners', [
      partnerDoc('openid-b26-susp', 'partner-b26-susp', 'PSUSAAA', { displayName: '阿停', status: PARTNER_STATUS.SUSPENDED }),
      partnerDoc('openid-b26-closed', 'partner-b26-closed', 'PCLOAAA', { displayName: '阿销', deletedAt: new Date(NOW) }),
      partnerDoc('openid-b26-pause', 'partner-b26-pause', 'PPAUAAA',
        { displayName: '阿歇', serviceConfig: { services: [], zones: [], acceptingOrders: false } })
    ]);
    const inactive = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿停' });
    t.check(inactive.ok === true && inactive.data.list.length === 0, 'T15-9 停用兼职不进候选');
    const closed = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿销' });
    t.check(closed.ok === true && closed.data.list.length === 0, 'T15-10 已注销兼职不进候选');
    const paused = await apiOf(db, P1).call('partner.searchTransferTargets', { keyword: '阿歇' });
    t.eq([paused.ok, paused.data.list.length, paused.data.list[0] && paused.data.list[0].acceptingOrders],
      [true, 1, false], 'T15-11 暂停接单仍在候选（卡片标 acceptingOrders=false，服务端仍以 ACTIVE 为准）');
    // 子队员只搜本队：队长可搜到、同队兄弟可搜到、外队搜不到
    db.seed('users', [
      userDoc('openid-b26-sub', [ROLES.PARTNER]),
      userDoc('openid-b26-bro', [ROLES.PARTNER])
    ]);
    db.seed('partners', [
      partnerDoc('openid-b26-sub', 'partner-b26-sub', 'PSUBAAA', { displayName: '阿子', parentPartnerId: PID1 }),
      partnerDoc('openid-b26-bro', 'partner-b26-bro', 'PSUBBBB', { displayName: '阿兄', parentPartnerId: PID1 })
    ]);
    const subLeader = await apiOf(db, 'openid-b26-sub').call('partner.searchTransferTargets', { keyword: '阿甲' });
    t.check(subLeader.ok === true && subLeader.data.list.length === 1 && subLeader.data.list[0].partnerNo === 'PAAAAAA',
      'T15-12 子队员可搜到队长（本队）');
    const subBrother = await apiOf(db, 'openid-b26-sub').call('partner.searchTransferTargets', { keyword: '阿兄' });
    t.check(subBrother.ok === true && subBrother.data.list.length === 1, 'T15-13 子队员可搜到同队兄弟');
    const subOutside = await apiOf(db, 'openid-b26-sub').call('partner.searchTransferTargets', { keyword: '阿乙' });
    t.check(subOutside.ok === true && subOutside.data.list.length === 0, 'T15-14 子队员搜不到外队（与 Q9 同口径）');
    // 非兼职角色不可调（顾客 → FORBIDDEN）
    await expectCode(t, apiOf(db, C1).call('partner.searchTransferTargets', { keyword: '阿乙' }),
      'FORBIDDEN', 'T15-15 顾客调用检索 → FORBIDDEN');
    // 限流：config 单源（perMinute=1）→ 第二次 RATE_LIMITED
    const dbRate = world({ config: { transferSearchRate: { perMinute: 1, perDay: 5 } } });
    await apiOf(dbRate, P1).call('partner.searchTransferTargets', { keyword: '阿乙' });
    await expectCode(t, apiOf(dbRate, P1).call('partner.searchTransferTargets', { keyword: '阿丙' }),
      'RATE_LIMITED', 'T15-16 超窗口阈值 → RATE_LIMITED（config.transferSearchRate 单源）');
    // 结果上限：25 条命中 → 截到 20 且 truncated=true（无游标，不给分页）
    const dbCap = world({});
    const many = [];
    for (let i = 0; i < 25; i += 1) {
      many.push(partnerDoc('openid-b26-cap' + i, 'partner-b26-cap' + i, 'PZ' + ('000' + i).slice(-4),
        { displayName: '阿测' + i }));
    }
    dbCap.seed('partners', many);
    const capped = await apiOf(dbCap, P1).call('partner.searchTransferTargets', { keyword: '阿测' });
    t.eq([capped.ok, capped.data.list.length, capped.data.truncated], [true, 20, true],
      'T15-17 结果上限 20 且 truncated=true（反枚举：无游标）');
    // 静态闸：handler 零 db.collection；注册表与动作规则对齐（client 读动作）
    const handlerSrc = fs.readFileSync(path.join(API, 'handlers/partner/searchTransferTargets.js'), 'utf8');
    t.check(handlerSrc.indexOf('db.collection') === -1, 'T15-18 检索 handler 零 db.collection（只经 ctx.dao）');
    const partnerIndex = require(path.join(API, 'handlers/partner/index.js'));
    t.check(typeof partnerIndex.actions['partner.searchTransferTargets'] === 'function',
      'T15-19 检索动作已在 partner 域注册（router 可达）');
    const actionsSrc = require(path.join(ROOT, 'shared/actions.js'));
    t.eq(actionsSrc.actionMeta('partner.searchTransferTargets'), { visibility: 'client', write: false },
      'T15-20 动作规则=client 读动作（READONLY 会话不拦读、可重试）');
  });
}


module.exports = { register: sectionT15, EXPECTED_ASSERTIONS };
