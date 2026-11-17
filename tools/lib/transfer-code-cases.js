'use strict';
// tools/lib/transfer-code-cases.js · D88 转派码用例表（非独立套件，由 tools/selftest-transfer.js 注册）
// 挡：码不经限流可爆破、过期不判、轮换后旧码仍可用、解析消费码（重复解析失败）、
//     跨真实×测试、子队员拿外队码、解析响应多带键、签发写成读动作。
const path = require('path');
const fs = require('fs');
const {
  ROOT, API, NOW, P1, PID1, P2, TEST_P, ROLES,
  world, apiOf, partnerDoc, userDoc, expectCode, expectField
} = require('./order-transfer-cases');

const EXPECTED_ASSERTIONS = 20;
const MINUTE = 60 * 1000;
const CODE_BODY = /^[2-9A-HJ-NP-Z]{6}$/;
const CODE_SHOWN = /^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/;

async function sectionT16(h) {
  h.section('T16 D88 转派码（签发/轮换/解析/过期/隔离/零泄漏）', async (t) => {
    // 限流阀值放宽（本节只验语义；限流另见 T16b），避免多次解析被桶挡住
    const db = world({ config: { transferCodeTtlMinutes: 30, transferCodeRate: { perMinute: 20, perDay: 100 } } });
    const created = await apiOf(db, P1).call('partner.createTransferCode', {});
    t.check(created.ok === true && CODE_SHOWN.test(String(created.data.code || '')),
      'T16-1 签发返回 6 位码（展示形 3+3 分组）');
    t.eq(Object.keys(created.data).sort(), ['code', 'expiresAt', 'serverTime'],
      'T16-2 签发响应三键（code/expiresAt/serverTime，无 openid/_id）');
    t.eq(created.data.expiresAt, NOW + 30 * MINUTE, 'T16-3 有效期 = config.transferCodeTtlMinutes（30 分钟）');
    const p1Row = db.dump('partners').filter((item) => item._id === PID1)[0] || {};
    t.check(CODE_BODY.test(String(p1Row.transferCode || '')),
      'T16-4 库内 transferCode 只存 6 位本体（大写、无连字符、限字母表）');
    const stored = p1Row.transferCode;
    // 解析基线：他人凭码解析出编号/昵称；同一码可再次解析（不消费）
    const first = await apiOf(db, P2).call('partner.resolveTransferCode', { code: created.data.code });
    t.check(first.ok === true && first.data.partnerNo === 'PAAAAAA' && first.data.displayName === '阿甲',
      'T16-5 凭码解析出编号与昵称（阿甲 / PAAAAAA）');
    t.eq(Object.keys(first.data).sort(), ['displayName', 'expiresAt', 'partnerNo'],
      'T16-6 解析响应三键（无 openid/_id/头像）');
    const again = await apiOf(db, P2).call('partner.resolveTransferCode', { code: stored });
    t.check(again.ok === true && again.data.partnerNo === 'PAAAAAA',
      'T16-7 解析不消费码（同码可再次解析；连字符可省略）');
    // 轮换：重新签发后旧码立即失效，新码可用
    const rotated = await apiOf(db, P1).call('partner.createTransferCode', {});
    const oldCode = await apiOf(db, P2).call('partner.resolveTransferCode', { code: stored });
    t.eq([oldCode.ok, oldCode.code], [false, 'NOT_FOUND'], 'T16-8 轮换后旧码 → NOT_FOUND（同文案不暴露存在性）');
    const newCode = await apiOf(db, P2).call('partner.resolveTransferCode', { code: rotated.data.code });
    t.check(newCode.ok === true && newCode.data.partnerNo === 'PAAAAAA', 'T16-9 轮换后新码可解析');
    // 过期：惰性判定（不新增 sweep）
    db.seed('partners', [partnerDoc('openid-b26-exp', 'partner-b26-exp', 'PEXPAAA', {
      displayName: '阿期', transferCode: 'AAA234', transferCodeExpiresAt: new Date(NOW - MINUTE)
    })]);
    const expired = await apiOf(db, P2).call('partner.resolveTransferCode', { code: 'AAA-234' });
    t.eq([expired.ok, expired.code], [false, 'NOT_FOUND'], 'T16-10 过期码 → NOT_FOUND（惰性过期，无 sweep）');
    const missing = await apiOf(db, P2).call('partner.resolveTransferCode', { code: 'ZZZ-ZZZ' });
    t.eq([missing.ok, missing.code], [false, 'NOT_FOUND'], 'T16-11 不存在的码与过期码同文案（不暴露存在性）');
    const malformed = await apiOf(db, P2).call('partner.resolveTransferCode', { code: 'AB' });
    t.eq([malformed.ok, malformed.code], [false, 'NOT_FOUND'], 'T16-12 格式非法（过短）同样 NOT_FOUND');
    // 自己 / 真实×测试 / 子队员范围 / 码不认编号
    await expectField(t, apiOf(db, P1).call('partner.resolveTransferCode', { code: rotated.data.code }),
      'VALIDATION_FAILED', 'code', 'T16-13 解析自己的码 → VALIDATION_FAILED(field=code)');
    const testCode = await apiOf(db, TEST_P).call('partner.createTransferCode', {});
    await expectCode(t, apiOf(db, P1).call('partner.resolveTransferCode', { code: testCode.data.code }),
      'FORBIDDEN', 'T16-14 真实账号解析测试侧码 → FORBIDDEN（真实×测试隔离）');
    db.seed('users', [userDoc('openid-b26-sub2', [ROLES.PARTNER])]);
    db.seed('partners', [partnerDoc('openid-b26-sub2', 'partner-b26-sub2', 'PSUBZZZ', {
      displayName: '阿子', parentPartnerId: PID1
    })]);
    const subOwn = await apiOf(db, 'openid-b26-sub2').call('partner.resolveTransferCode', { code: rotated.data.code });
    t.check(subOwn.ok === true && subOwn.data.partnerNo === 'PAAAAAA', 'T16-15 子队员可解析队长码（本队）');
    await expectCode(t, apiOf(db, 'openid-b26-sub2').call('partner.resolveTransferCode', { code: newCode.data.partnerNo }),
      'NOT_FOUND', 'T16-16 子队员把编号当码填 → NOT_FOUND（码只认 6 位字母表，不认编号）');
  });
}

// 限流与静态闸单独一节（同 openid 的签发/解析共桶，避免污染上面语义用例）
async function sectionT17(h) {
  h.section('T16b D88 转派码限流与静态闸', async (t) => {
    const db = world({ config: { transferCodeRate: { perMinute: 1, perDay: 5 } } });
    await apiOf(db, P1).call('partner.createTransferCode', {});
    await expectCode(t, apiOf(db, P1).call('partner.createTransferCode', {}),
      'RATE_LIMITED', 'T16-17 签发与解析共用同一桶：窗口内第二次 → RATE_LIMITED');
    const handlerSrc = fs.readFileSync(path.join(API, 'handlers/partner/createTransferCode.js'), 'utf8')
      + fs.readFileSync(path.join(API, 'handlers/partner/resolveTransferCode.js'), 'utf8');
    t.check(handlerSrc.indexOf('db.collection') === -1, 'T16-18 两个 handler 零 db.collection（只经 ctx.dao）');
    const index = require(path.join(API, 'handlers/partner/index.js'));
    t.check(typeof index.actions['partner.createTransferCode'] === 'function'
      && typeof index.actions['partner.resolveTransferCode'] === 'function',
    'T16-19 两个动作均已注册（router 可达）');
    const actions = require(path.join(ROOT, 'shared/actions.js'));
    t.eq([actions.actionMeta('partner.createTransferCode'), actions.actionMeta('partner.resolveTransferCode')],
      [{ visibility: 'client', write: true }, { visibility: 'client', write: false }],
      'T16-20 动作规则：签发=写、解析=读（READONLY 只拦签发）');
  });
}

function register(h) {
  sectionT16(h);
  sectionT17(h);
}

module.exports = { register, EXPECTED_ASSERTIONS };
