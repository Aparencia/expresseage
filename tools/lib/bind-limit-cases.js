// tools/lib/bind-limit-cases.js · D39 绑定限流判据（从 selftest-bind-cloud 拆出，守门禁 #18 测试文件 ≤1000 行）
// 覆盖：预览 partner.getPublic + 提交 bind.create 合并同一 60 秒分片桶/5 次（取消每日总量）、
//       失败尝试计入、格式错不计数（手误不白扣）、超限文案取 shared/error-copy 单源、跨片恢复、
//       D40 联动 upload.prepare 60 次/日。被 tools/selftest-bind-cloud.js 的 I 节调用。
'use strict';

// 本文件内 t.* 断言条数（调用方 EXPECTED_ASSERTIONS = 既有条数 + 本值，少算/多算都判红）
const ASSERTIONS = 11;

const CODES = ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'RATE_LIMITED'];
const RATE_BUCKET_PREFIX = 'rl:bind:';

function codeOf(result) {
  return (result && result.code) || 'OK';
}

function codesOf(results) {
  return results.map(codeOf);
}

function createWindowApi(t, d) {
  const db = d.createTestDb();
  db.seed('users', [
    d.userDoc('openid-i-c1', [d.ROLES.CUSTOMER]),
    d.userDoc('openid-i-c2', [d.ROLES.CUSTOMER]),
    d.userDoc('openid-i-c3', [d.ROLES.CUSTOMER]),
    d.userDoc('openid-i-p', [d.ROLES.PARTNER])
  ]);
  db.seed('customers', [
    d.customerDoc('openid-i-c1'),
    d.customerDoc('openid-i-c2', { customerNo: 'CABCDEFGR' }),
    d.customerDoc('openid-i-c3', { customerNo: 'CABCDEFGS' })
  ]);
  db.seed('partners', [d.partnerDoc('partner-i-1', 'openid-i-p', 'PABC23W')]);
  let clock = d.NOW;
  function apiOf(openid) {
    return d.app.createApi({ db: db, now: () => clock, openid: openid, env: d.ADMIN_ENV, cloud: d.cloudStub('pass') });
  }
  return {
    db: db,
    advance: (ms) => { clock += ms; },
    apiOf: apiOf
  };
}

// 窗口内 6 次尝试（失败也计数）→ 第 6 次拒绝；61 秒后新分片恢复（没有每日总量）
async function runWindowCase(t, d, win) {
  const api = win.apiOf('openid-i-c1');
  const attempts = [];
  for (let i = 0; i < 6; i += 1) {
    attempts.push(await api.call('partner.getPublic', { partnerNo: 'PABC23X' }));
  }
  t.eq(codesOf(attempts), CODES, 'I3 失败尝试计入：60 秒内第 6 次 RATE_LIMITED（前 5 次不存在均计额度）');
  t.eq(attempts[5].message, d.errorCopy.CODE_COPY.RATE_LIMITED,
    'I4 超限 message === shared/error-copy.RATE_LIMITED 单源（「请 1 分钟后再试」）');
  const rows = win.db.dump('counters').filter((row) => String(row.key).indexOf(RATE_BUCKET_PREFIX + 'openid-i-c1:d') === 0);
  t.check(rows.length === 1 && /m\d{4}$/.test(rows[0].key) && rows[0].seq === 6,
    'I5 计数落 rl:bind:{openid}:d{日}m{HHmm} 60 秒分片键，seq=6（超限尝试不静默）');
  win.advance(61000);
  const nextSlice = await api.call('partner.getPublic', { partnerNo: 'PABC23X' });
  t.eq(codeOf(nextSlice), 'NOT_FOUND', 'I6 61 秒后新分片恢复（D39 取消每日总量，不再锁到明天）');
}

// 预览 3 次 + 提交 2 次共用同桶 → 第 6 次（提交）即拒绝
async function runMergedBucketCase(t, d, win) {
  const api = win.apiOf('openid-i-c2');
  const mixed = [];
  for (let i = 0; i < 3; i += 1) {
    mixed.push(await api.call('partner.getPublic', { partnerNo: 'PABC23X' }));
  }
  for (let i = 0; i < 2; i += 1) {
    mixed.push(await api.call('bind.create', { partnerNo: 'PABC23X' }, { clientRequestId: 'bind-i-00000000000' + i }));
  }
  mixed.push(await api.call('bind.create', { partnerNo: 'PABC23X' }, { clientRequestId: 'bind-i-000000000099' }));
  t.eq(codesOf(mixed), ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'RATE_LIMITED'],
    'I7 预览 3 次 + 提交 2 次合并同桶：第 6 次（提交）即 RATE_LIMITED（D39 合计计数）');
}

// 格式错（P-ABC）在 validate 前拦不计数：连试 6 次不占额度，合法编号仍可查
async function runFormatCase(t, d, win) {
  const api = win.apiOf('openid-i-c3');
  const formatErrors = [];
  for (let i = 0; i < 6; i += 1) {
    formatErrors.push(await api.call('partner.getPublic', { partnerNo: 'P-ABC' }));
  }
  t.eq(codesOf(formatErrors), [ 'VALIDATION_FAILED', 'VALIDATION_FAILED', 'VALIDATION_FAILED',
    'VALIDATION_FAILED', 'VALIDATION_FAILED', 'VALIDATION_FAILED' ], 'I8 反例基线：错格式 6 次全部 VALIDATION_FAILED');
  const rowsBefore = win.db.dump('counters')
    .filter((row) => String(row.key).indexOf(RATE_BUCKET_PREFIX + 'openid-i-c3:') === 0);
  t.eq(rowsBefore.length, 0, 'I9 格式错不计数：6 次手误后零 rl:bind 计数行（不白扣尝试额度）');
  const validAfter = await api.call('partner.getPublic', { partnerNo: 'PABC23X' });
  t.eq(codeOf(validAfter), 'NOT_FOUND', 'I10 格式错后合法编号仍可查（未误触限流）');
  const rowsAfter = win.db.dump('counters')
    .filter((row) => String(row.key).indexOf(RATE_BUCKET_PREFIX + 'openid-i-c3:') === 0);
  t.eq(rowsAfter.length === 1 && rowsAfter[0].seq === 1, true,
    'I11 只有合法格式失败计 1 次（格式错确实不进计数）');
}

/**
 * @param {object} t harness 断言器（t.eq/t.check）
 * @param {object} d 依赖注入：app/createTestDb/userDoc/customerDoc/partnerDoc/cloudStub/errorCopy/ratelimit/NOW/ADMIN_ENV/ROLES
 */
async function run(t, d) {
  const bindRule = d.ratelimit.rulesOf('bind.create', {})[0];
  const publicRule = d.ratelimit.rulesOf('partner.getPublic', {})[0];
  t.eq([bindRule.bucket, publicRule.bucket, bindRule.windowMs, bindRule.limit, publicRule.limit],
    ['bind', 'bind', 60000, 5, 5], 'I1 预览+提交合并同一 60 秒分片桶、5 次/片（D39 取消每日总量）');
  t.eq(d.ratelimit.rulesOf('upload.prepare', { purpose: 'TICKET' })[0].limit, 60,
    'I2 D40 联动：upload.prepare（截图票据）60 次/日/人');

  const win = createWindowApi(t, d);
  await runWindowCase(t, d, win);
  await runMergedBucketCase(t, d, win);
  await runFormatCase(t, d, win);
}

module.exports = {
  ASSERTIONS,
  run
};
