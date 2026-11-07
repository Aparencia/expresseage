'use strict';
/**
 * tools/selftest-team.js — 批 26 W3（D59 兼职子队员服务端）判据，按草案 §2.7 U1~U11 建组。
 *
 * 覆盖（每组注明挡什么）：
 *   U1 基线：主兼职发 SUB 码 → 子账号激活写 parentPartnerId/teamJoinedAt、独立 partnerNo/serviceConfig、码变 USED
 *   U2 仅一层：子队员调 createSubInvites → FORBIDDEN 且零落库
 *   U3 上限：config.teamMaxMembers 边界（已达上限再发 VALIDATION_FAILED；恰好补满可发最后一码；count 1~5）
 *   U4 顾客不可绑：getPublic / bind.create 对子队员同码同文案 NOT_FOUND、bindings 零写入
 *   U5 禁代客单：子队员 order.create 的 bindingId/guest 两路 FORBIDDEN、orders 零写入
 *   U6 级联：主兼职 SUSPENDED/CLOSED → 子队员一并停用/关闭 + 该队 PENDING 转派 CANCELLED
 *   U7 兼容：无 kind 旧码按 DEV 激活（不写隶属）；admin.createInvites 新码 kind=DEV；listInvites 的 kind/issuerPartnerNo
 *   U8 作废边界：他人批次 NOT_FOUND / 全用批次 INVALID_STATE / 本队未用批次 REVOKED + revokedBy + 幂等；admin 对 SUB 只读
 *   U9 限流：rl:subInvite:* 分钟/日桶打满 → RATE_LIMITED 且零业务写
 *   U10 DTO 键白名单：members[] 精确键集、无 openid/parentPartnerId/avatarFileId、codeTail 长度 4、quota
 *   U11 静态闸：handlers/partner 零 db.collection、注册集=注册表、pkg-partner 零 bind 动作名/队伍状态字面量
 *   U12 主兼职状态闸：SUSPENDED/CLOSED 主兼职的未用 SUB 码不可激活（零写库）；ACTIVE 基线不误挡
 *   U13 并发/一致性：名额 TOCTOU 恰一成功、重放回读按队隔离、移除限流与事务内定向取消、恢复悬挂上级、限流逐字段回落、限流桶首建并发重试
 *
 * 纪律：fake DB 注入（tools/selftest-cloud-fixtures.createTestDb），不连真库、不 mock 全局 wx；
 *       合法基线 + 只有该闸能挡的反例；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-team.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');

const { createHarness } = require('./selftest');
const { createTestDb, cloudStub } = require('./selftest-cloud-fixtures');
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const validate = require(path.join(API, 'shared/validate.js'));
const time = require(path.join(API, 'lib/time.js'));
const actions = require(path.join(API, 'shared/actions.js'));
const { DEFAULT_CONFIG } = require(path.join(ROOT, 'config/defaults.js'));

const partnerIndex = require(path.join(API, 'handlers/partner/index.js'));
const activateHandler = require(path.join(API, 'handlers/partner/activate.js')).handler;
const getPublicHandler = require(path.join(API, 'handlers/partner/getPublic.js')).handler;
const createSubInvitesHandler = require(path.join(API, 'handlers/partner/createSubInvites.js')).handler;
const revokeSubInviteHandler = require(path.join(API, 'handlers/partner/revokeSubInvite.js')).handler;
const listSubMembersHandler = require(path.join(API, 'handlers/partner/listSubMembers.js')).handler;
const removeSubMemberHandler = require(path.join(API, 'handlers/partner/removeSubMember.js')).handler;
const bindCreateHandler = require(path.join(API, 'handlers/bind/create.js')).handler;
const orderCreateHandler = require(path.join(API, 'handlers/order/create.js'));
const adminCreateInvites = require(path.join(API, 'handlers/admin/createInvites.js'));
const adminRevokeInvite = require(path.join(API, 'handlers/admin/revokeInvite.js'));
const adminListInvites = require(path.join(API, 'handlers/admin/listInvites.js'));
const adminSetPartnerStatus = require(path.join(API, 'handlers/admin/setPartnerStatus.js'));

const EXPECTED_ASSERTIONS = 124; // 实跑读数（node tools/selftest-team.js 汇总行）；改断言必须同步此数

const NOW = Date.parse('2026-11-03T10:00:00+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAIN_OPENID = 'openid-main-partner';
const MAIN_NO = 'PAAAAAA';
const MAIN_ID = 'p-main';
const SUB_A_OPENID = 'openid-sub-a';
const SUB_A_NO = 'PBBBBBB';
const SUB_A_ID = 'p-sub-a';
const SUB_B_NO = 'PCCCCCC';
const SUB_B_ID = 'p-sub-b';
const OTHER_MAIN_OPENID = 'openid-other-main';
const OTHER_MAIN_NO = 'PDDDDDD';
const OTHER_MAIN_ID = 'p-other-main';
const ADMIN_OPENID = 'openid-admin-dev01';
const CLIENT_ID = 'rid-team-0001';
const NO_ALPHABET = enums.CODE_ALPHABET;

// 确定性兼职编号（激活用 ctx.ids.partnerNo 注入；满足 ^P[字母表]{6}$）
function partnerNoOfSeq(seq) {
  let value = seq;
  let body = '';
  for (let i = 0; i < 6; i += 1) {
    body = NO_ALPHABET.charAt(value % NO_ALPHABET.length) + body;
    value = Math.floor(value / NO_ALPHABET.length);
  }
  return 'P' + body;
}

function idsFor(start) {
  let seq = typeof start === 'number' ? start : 1;
  return { partnerNo: () => partnerNoOfSeq(seq++) };
}

function configOf(overrides) {
  const base = Object.assign({}, DEFAULT_CONFIG, {
    subInviteRate: { perMinute: 30, perDay: 100 },
    teamMaxMembers: 5
  });
  return Object.assign(base, overrides || {});
}

function makeCtx(dao, options) {
  const opts = options || {};
  const openid = opts.openid || '';
  const identity = Object.assign({
    actorOpenid: openid,
    effectiveOpenid: openid,
    role: opts.role || '',
    isTestAccount: false,
    viewMode: '',
    viewTicketId: '',
    developerNo: opts.developerNo || ''
  }, opts.identity || {});
  return {
    dao: dao,
    ids: opts.ids || {},
    now: opts.now === undefined ? NOW : opts.now,
    env: {},
    cloud: cloudStub(),
    openid: openid,
    identity: identity,
    requestId: 'req-selftest-team',
    clientRequestId: opts.clientRequestId === undefined ? CLIENT_ID : opts.clientRequestId,
    expectedVersion: undefined,
    config: opts.config || configOf()
  };
}

function mainPartnerDoc(overrides) {
  const doc = {
    _id: MAIN_ID,
    openid: MAIN_OPENID,
    partnerNo: MAIN_NO,
    displayName: '主兼职甲',
    avatarFileId: '',
    status: enums.PARTNER_STATUS.ACTIVE,
    parentPartnerId: '',
    teamJoinedAt: '',
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { totalOrders: 0, activeOrders: 0 },
    activatedAt: new Date(NOW - DAY_MS),
    createdAt: new Date(NOW - DAY_MS),
    updatedAt: new Date(NOW - DAY_MS)
  };
  return Object.assign(doc, overrides || {});
}

function subPartnerDoc(overrides) {
  const doc = {
    _id: SUB_A_ID,
    openid: SUB_A_OPENID,
    partnerNo: SUB_A_NO,
    displayName: '子队员甲',
    avatarFileId: '',
    status: enums.PARTNER_STATUS.ACTIVE,
    parentPartnerId: MAIN_ID,
    teamJoinedAt: new Date(NOW - 3600 * 1000),
    serviceConfig: { services: [{ code: 'PICKUP_STD', enabled: true }], zones: ['D'], acceptingOrders: true },
    stats: { totalOrders: 0, activeOrders: 0 },
    activatedAt: new Date(NOW - 3600 * 1000),
    createdAt: new Date(NOW - 3600 * 1000),
    updatedAt: new Date(NOW - 3600 * 1000)
  };
  return Object.assign(doc, overrides || {});
}

function userDoc(openid, overrides) {
  return Object.assign({ _id: openid, roles: ['PARTNER'], updatedAt: new Date(NOW) }, overrides || {});
}

function seedBase(db, extraPartners, extraUsers) {
  db.seed(COLLECTIONS.PARTNERS, [mainPartnerDoc(), subPartnerDoc()].concat(extraPartners || []));
  db.seed(COLLECTIONS.USERS, [userDoc(MAIN_OPENID), userDoc(SUB_A_OPENID)].concat(extraUsers || []));
}

async function errorCodeOf(fn) {
  try {
    await fn();
    return '';
  } catch (error) {
    return error && error.code ? error.code : 'UNKNOWN_THROW';
  }
}

function adminCtx(dao, clientRequestId, config) {
  return makeCtx(dao, {
    openid: ADMIN_OPENID,
    developerNo: 'DEV-01',
    clientRequestId: clientRequestId,
    config: config
  });
}

function mainCtx(dao, clientRequestId, config) {
  return makeCtx(dao, {
    openid: MAIN_OPENID,
    role: enums.ROLES.PARTNER,
    clientRequestId: clientRequestId,
    config: config
  });
}

function subCtx(dao, openid, clientRequestId, config) {
  return makeCtx(dao, {
    openid: openid,
    role: enums.ROLES.PARTNER,
    clientRequestId: clientRequestId,
    config: config
  });
}

function walkJs(dirRel) {
  const out = [];
  const stack = [path.join(ROOT, dirRel)];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    });
  }
  return out;
}

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// 队伍状态字面量扫描（页面层零业务判据的同口径；返回命中数组便于"判据有牙"反例断言）
const TEAM_STATUS_LITERAL_RE = /['"](?:UNUSED|SUSPENDED)['"]/;

function scanTeamStatusLiterals(files) {
  return files.filter((file) => TEAM_STATUS_LITERAL_RE.test(fs.readFileSync(file, 'utf8')));
}

function codeDocsOf(db) {
  return db.dump(COLLECTIONS.INVITATION_CODES);
}

// 预置 rl:subInvite 分钟/日计数行（与 _team.rateKeysOf 同口径）：并发用例里让限流事务走"读-更新"而非
// "首次建行"路径——首建并发会先在限流桶上撞唯一键，掩盖被测的名额 CAS 闸（判据要打到目标闸上）。
function seedRateCounters(db, openid, nowMs) {
  const date = new Date(time.toMs(nowMs) + time.TZ_OFFSET_MS);
  const minuteKey = 'w' + time.dayKey(nowMs) + time.pad2(date.getUTCHours()) + time.pad2(date.getUTCMinutes());
  db.seed(COLLECTIONS.COUNTERS, [
    { _id: 'rl-minute-seed', key: 'rl:subInvite:' + openid + ':' + minuteKey, seq: 0, updatedAt: new Date(nowMs) },
    { _id: 'rl-day-seed', key: 'rl:subInvite:' + openid + ':d' + time.dayKey(nowMs), seq: 0, updatedAt: new Date(nowMs) }
  ]);
}

// 限流计数行"首建并发"模拟（真实库语义：counters.key 唯一索引 + 并发赢家先提交）：前 N 个事务里让
// trx.findOne 对 rl:subInvite:* 行"读不到"（本请求快照滞后），但真行已在库 → add 撞唯一索引抛 duplicate key
// （与真实库一致的中断形状）；N=1 时重试事务读到该行 → 走 update 递增（覆盖 _team 的事务外层重试一次）。
function raceCounterDao(dao, staleTransactions) {
  let stale = staleTransactions;
  const wrapper = Object.create(dao);
  wrapper.transaction = (handler) => dao.transaction((trx) => {
    if (stale <= 0) return handler(trx);
    stale -= 1;
    const staleTrx = Object.create(trx);
    staleTrx.findOne = async (name, query) => {
      const row = await trx.findOne(name, query);
      return name === COLLECTIONS.COUNTERS && row && String(row.key).indexOf('rl:subInvite:') === 0 ? null : row;
    };
    return handler(staleTrx);
  });
  return wrapper;
}

let serialQueue = Promise.resolve();
function serial(fn) {
  const run = serialQueue.then(fn);
  serialQueue = run.catch(() => {});
  return run;
}

function register(h) {
  const asyncSection = (title, fn) => h.section(title, (t) => serial(() => {
    h.sectionTitle = title;
    return fn(t);
  }));

  // ---------------------------------------------------------------- U1 基线
  asyncSection('§2.7-U1 主兼职发子码→子账号激活（parentPartnerId/teamJoinedAt/独立账号/码 USED）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const created = await createSubInvitesHandler(mainCtx(dao, 'rid-u1-create-0001'), {
      count: 2,
      validity: '72H',
      note: '队内测试'
    });
    t.eq(created.codes.length, 2, 'U1 一次发 2 个 SUB 码');
    t.check(/^TB\d{8}-\d{2}$/.test(created.batchId), 'U1 batchId 形制 TB+yyyyMMdd+2 位序号');
    t.eq(created.expiresAt - NOW, 72 * 60 * 60 * 1000, 'U1 有效期 72H=72 小时');
    t.check(created.codes.every((code) => validate.validateInvitationCode(code).ok), 'U1 返回完整码且形态合法（仅本次响应）');
    const docs = codeDocsOf(db);
    t.eq([docs.length, docs[0].kind, docs[0].issuerPartnerId, docs[0].createdBy],
      [2, enums.INVITATION_KIND.SUB, MAIN_ID, 'PARTNER:' + MAIN_NO],
      'U1 落库 kind=SUB/issuerPartnerId=主兼职 _id/createdBy=PARTNER:编号');
    t.check(docs.every((doc) => doc.status === enums.INVITATION_STATUS.UNUSED && doc.usedBy === ''),
      'U1 新码均为 UNUSED 且未绑定使用者');
    db.seed(COLLECTIONS.USERS, [userDoc('openid-new-sub', { roles: [] })]);
    const subCtxNew = makeCtx(dao, { openid: 'openid-new-sub', role: '', ids: idsFor(100) });
    const activated = await activateHandler(subCtxNew, {
      invitationCode: created.codes[0],
      displayName: '新子队员'
    });
    const fresh = await dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: 'openid-new-sub' } });
    t.eq([activated.partnerNo, fresh && fresh.partnerNo], [partnerNoOfSeq(100), partnerNoOfSeq(100)],
      'U1 激活返回账号编号（与落库一致）');
    t.eq([fresh.parentPartnerId, fresh.teamJoinedAt instanceof Date ? fresh.teamJoinedAt.getTime() : 0],
      [MAIN_ID, NOW], 'U1 激活写 parentPartnerId=发码主兼职、teamJoinedAt=激活时刻');
    t.check(fresh.partnerNo !== MAIN_NO && !!fresh.serviceConfig && fresh.status === enums.PARTNER_STATUS.ACTIVE,
      'U1 子队员为独立 partnerNo/serviceConfig/ACTIVE 的独立账号');
    t.check(Array.isArray(activated.roles) && activated.roles.indexOf(enums.ROLES.PARTNER) >= 0, 'U1 激活授予 PARTNER 角色');
    const usedCode = (await dao.findOne(COLLECTIONS.INVITATION_CODES, { where: { code: created.codes[0] } })) || {};
    t.eq([usedCode.status, usedCode.usedBy], [enums.INVITATION_STATUS.USED, fresh._id], 'U1 已用码 USED 且 usedBy=新账号 _id');
    const untouched = await dao.get(COLLECTIONS.PARTNERS, MAIN_ID);
    t.eq([untouched.parentPartnerId, untouched.status], ['', enums.PARTNER_STATUS.ACTIVE], 'U1 主兼职本身零改动（无上级/仍 ACTIVE）');
  });

  // ---------------------------------------------------------------- U2 仅一层
  asyncSection('§2.7-U2 仅一层：子队员发子码 FORBIDDEN 且零落库', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const before = codeDocsOf(db).length;
    const code = await errorCodeOf(() => createSubInvitesHandler(subCtx(dao, SUB_A_OPENID, 'rid-u2-sub-0001'), {
      count: 1,
      validity: '24H'
    }));
    t.eq(code, 'FORBIDDEN', 'U2 子队员调 createSubInvites → FORBIDDEN（发码者必须 parentPartnerId===""）');
    t.eq(codeDocsOf(db).length, before, 'U2 失败路径邀请码零落库');
    const counters = db.dump(COLLECTIONS.COUNTERS).filter((row) => String(row.key).indexOf('subInviteBatch') === 0);
    t.eq(counters.length, 0, 'U2 失败路径不消耗发码批次序号');
    t.check(SUB_A_ID !== '', 'U2 子队员样本非空（不得空集全绿）');
  });

  // ---------------------------------------------------------------- U3 上限
  asyncSection('§2.7-U3 队员上限（config.teamMaxMembers 边界与 count 值域）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const capped = configOf({ teamMaxMembers: 2, subInviteRate: { perMinute: 30, perDay: 100 } });
    const first = await createSubInvitesHandler(mainCtx(dao, 'rid-u3-last-0001', capped), { count: 1, validity: '24H' });
    t.eq(first.codes.length, 1, 'U3 队员数=max-1 时可发最后一码（恰好补满不超过上限）');
    const second = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u3-last-0002', capped), {
      count: 1,
      validity: '24H'
    }));
    t.eq(second, 'VALIDATION_FAILED', 'U3 待用码也占名额：队员数+待用码已到上限再发 → VALIDATION_FAILED');
    const db2 = createTestDb();
    seedBase(db2, [subPartnerDoc({ _id: SUB_B_ID, openid: 'openid-sub-b2', partnerNo: SUB_B_NO })], [userDoc('openid-sub-b2')]);
    const dao2 = createDao(db2);
    const atMax = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao2, 'rid-u3-max-0001', capped), {
      count: 1,
      validity: '24H'
    }));
    t.eq(atMax, 'VALIDATION_FAILED', 'U3 已达 teamMaxMembers 再发 → VALIDATION_FAILED（用 >= 不用 >）');
    const bad6 = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u3-bad6-0001', capped), {
      count: 6,
      validity: '24H'
    }));
    const bad0 = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u3-bad0-0001', capped), {
      count: 0,
      validity: '24H'
    }));
    t.eq([bad6, bad0], ['VALIDATION_FAILED', 'VALIDATION_FAILED'], 'U3 count 只接受 1~5 整数（0/6 均 VALIDATION_FAILED）');
    const badValidity = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u3-badv-0001', capped), {
      count: 1,
      validity: '30D'
    }));
    t.eq(badValidity, 'VALIDATION_FAILED', 'U3 validity 只接受 24H/72H/7D');
    const badNote = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u3-badn-0001', capped), {
      count: 1,
      validity: '24H',
      note: '长'.repeat(51)
    }));
    t.eq(badNote, 'VALIDATION_FAILED', 'U3 note 超 50 字 → VALIDATION_FAILED');
    t.eq(codeDocsOf(db).length, 1, 'U3 所有失败路径合计只落库 1 条码（合法那批）');
  });

  // ---------------------------------------------------------------- U4 顾客不可绑
  asyncSection('§2.7-U4 顾客不可绑子队员（getPublic/bind.create 同码同文案 NOT_FOUND）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    db.seed(COLLECTIONS.CUSTOMERS, [{
      _id: 'openid-customer-1',
      customerNo: 'CABCD2345',
      displayName: '顾客一号',
      profileCompleted: true,
      updatedAt: new Date(NOW)
    }]);
    const customerCtx = makeCtx(dao, { openid: 'openid-customer-1', role: enums.ROLES.CUSTOMER, clientRequestId: 'rid-u4-customer-01' });
    const publicCode = await errorCodeOf(() => getPublicHandler(customerCtx, { partnerNo: SUB_A_NO }));
    t.eq(publicCode, 'NOT_FOUND', 'U4 getPublic(子队员编号) → NOT_FOUND（不暴露存在性）');
    const bindCode = await errorCodeOf(() => bindCreateHandler(customerCtx, { partnerNo: SUB_A_NO }));
    t.eq(bindCode, 'NOT_FOUND', 'U4 bind.create(子队员编号) → NOT_FOUND（与 getPublic 同码同文案）');
    t.eq(db.dump(COLLECTIONS.BINDINGS).length, 0, 'U4 子队员绑定路径 bindings 零写入');
    const mainPublic = await getPublicHandler(customerCtx, { partnerNo: MAIN_NO });
    t.eq(mainPublic.partnerNo, MAIN_NO, 'U4 合法基线：主兼职仍可被顾客预览（不是一刀切拒绝）');
    const fakeBind = db.dump(COLLECTIONS.BINDINGS).length;
    t.eq(fakeBind, 0, 'U4 基线样本非空且绑定零写入');
  });

  // ---------------------------------------------------------------- U5 禁代客单
  asyncSection('§2.7-U5 子队员禁代客下单（bindingId/guest 两路 FORBIDDEN、orders 零写入）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    db.seed(COLLECTIONS.CUSTOMERS, [
      { _id: 'openid-customer-1', customerNo: 'CABCD2345', displayName: '顾客一号', profileCompleted: true, updatedAt: new Date(NOW) },
      { _id: 'openid-customer-2', customerNo: 'CABCD2346', displayName: '顾客二号', profileCompleted: true, updatedAt: new Date(NOW) }
    ]);
    db.seed(COLLECTIONS.BINDINGS, [
      { _id: 'binding-sub', customerId: 'openid-customer-1', partnerId: SUB_A_ID, roomTag: 'A', status: enums.BINDING_STATUS.ACTIVE, activeKey: 'openid-customer-1:ACTIVE', boundAt: new Date(NOW) },
      { _id: 'binding-main', customerId: 'openid-customer-2', partnerId: MAIN_ID, roomTag: 'B', status: enums.BINDING_STATUS.ACTIVE, activeKey: 'openid-customer-2:ACTIVE', boundAt: new Date(NOW) }
    ]);
    const sub = subCtx(dao, SUB_A_OPENID, 'rid-u5-sub-0001');
    const boundCode = await errorCodeOf(() => orderCreateHandler(sub, { bindingId: 'binding-sub' }));
    t.eq(boundCode, 'FORBIDDEN', 'U5 子队员走 bindingId 代客路径 → FORBIDDEN（无守卫时该绑定属于自己会继续下单）');
    const guestCode = await errorCodeOf(() => orderCreateHandler(sub, { guest: { displayName: '某同学' } }));
    t.eq(guestCode, 'FORBIDDEN', 'U5 子队员走 guest 代客路径 → FORBIDDEN');
    t.eq(db.dump(COLLECTIONS.ORDERS).length, 0, 'U5 两条被拒不写 orders（零落库）');
    const main = mainCtx(dao, 'rid-u5-main-0001');
    const mainBoundCode = await errorCodeOf(() => orderCreateHandler(main, { bindingId: 'binding-main' }));
    const mainGuestCode = await errorCodeOf(() => orderCreateHandler(main, { guest: { displayName: '某同学' } }));
    t.eq([mainBoundCode, mainGuestCode], ['VALIDATION_FAILED', 'VALIDATION_FAILED'],
      'U5 合法基线：主兼职同两路进入后续包裹/代客信息校验（不是子队员守卫误挡）');
    t.eq(db.dump(COLLECTIONS.ORDERS).length, 0, 'U5 主兼职基线同样零落库（失败在后续字段校验，非权限）');
  });

  // ---------------------------------------------------------------- U6 级联
  asyncSection('§2.7-U6 主兼职停用/注销级联子队员 + 取消 PENDING 转派', async (t) => {
    function seedTransferOrder(db) {
      db.seed(COLLECTIONS.ORDERS, [{
        _id: 'order-transfer-1',
        orderNo: '20261103-0001',
        customerId: 'openid-customer-1',
        customerOpenid: 'openid-customer-1',
        partnerId: MAIN_ID,
        partnerOpenid: MAIN_OPENID,
        partnerNo: MAIN_NO,
        status: enums.ORDER_STATUS.ACCEPTED,
        transfer: {
          status: enums.TRANSFER_STATUS.PENDING,
          fromPartnerId: MAIN_ID,
          fromPartnerNo: MAIN_NO,
          toPartnerId: SUB_A_ID,
          toPartnerNo: SUB_A_NO,
          requestedAt: new Date(NOW - MINUTE_MS),
          expiresAt: new Date(NOW + 9 * MINUTE_MS),
          resolvedAt: '',
          resolveReason: ''
        },
        parcels: [{ pickupCode: '1234', stationId: 'P1', stationName: '站点一' }],
        version: 1,
        createdAt: new Date(NOW - DAY_MS),
        updatedAt: new Date(NOW - DAY_MS),
        statusUpdatedAt: new Date(NOW - DAY_MS)
      }]);
    }
    // 停用级联
    const db = createTestDb();
    seedBase(db);
    seedTransferOrder(db);
    const dao = createDao(db);
    await adminSetPartnerStatus(adminCtx(dao, 'rid-u6-suspend-0001'), {
      partnerNo: MAIN_NO,
      status: enums.PARTNER_STATUS.SUSPENDED,
      reason: 'U6 停用级联'
    });
    const memberSuspend = await dao.get(COLLECTIONS.PARTNERS, SUB_A_ID);
    t.eq(memberSuspend.status, enums.PARTNER_STATUS.SUSPENDED, 'U6 主兼职 SUSPENDED → 子队员一并 SUSPENDED（级联执行）');
    t.eq(memberSuspend.suspendedReason, 'U6 停用级联', 'U6 子队员停用原因随治理动作落库');
    t.eq(memberSuspend.serviceConfig.acceptingOrders, false, 'U6 子队员停用后接单开关关闭');
    const suspendOrder = await dao.get(COLLECTIONS.ORDERS, 'order-transfer-1');
    t.eq([suspendOrder.transfer.status, suspendOrder.transfer.resolveReason],
      [enums.TRANSFER_STATUS.CANCELLED, enums.TRANSFER_RESOLVE_REASON.STATE_CHANGED],
      'U6 该队 PENDING 转派落 CANCELLED/STATE_CHANGED');
    t.eq([suspendOrder.status, suspendOrder.version], [enums.ORDER_STATUS.ACCEPTED, 2],
      'U6 停用级联不改订单状态，仅 version+1（事件/审计留痕）');
    const suspendEvents = db.dump(COLLECTIONS.ORDER_EVENTS).filter((event) => event.type === 'TRANSFER_CANCELLED');
    t.eq(suspendEvents.length, 1, 'U6 取消 PENDING 转派写 TRANSFER_CANCELLED 事件恰 1 条（重复读不二次写）');
    t.eq([suspendEvents[0].actorRole, suspendEvents[0].payload],
      ['SYSTEM', { fromPartnerNo: MAIN_NO, toPartnerNo: SUB_A_NO }],
      'U6 事件 actorRole=SYSTEM + payload 只带双方编号（D58 事件口径）');
    // 注销级联
    const db2 = createTestDb();
    seedBase(db2);
    seedTransferOrder(db2);
    const dao2 = createDao(db2);
    await adminSetPartnerStatus(adminCtx(dao2, 'rid-u6-closed-0001'), {
      partnerNo: MAIN_NO,
      status: enums.PARTNER_STATUS.CLOSED,
      reason: 'U6 注销级联'
    });
    const memberClosed = await dao2.get(COLLECTIONS.PARTNERS, SUB_A_ID);
    t.eq(memberClosed.status, enums.PARTNER_STATUS.CLOSED, 'U6 主兼职 CLOSED → 子队员一并 CLOSED');
    t.check(!!memberClosed.deletedAt, 'U6 子队员注销时间落库（走既有匿名化/注销链路）');
    t.eq(memberClosed.parentPartnerId, MAIN_ID, 'U6 子队员 parentPartnerId 保留（层级审计，不物理清）');
    const closedOrder = await dao2.get(COLLECTIONS.ORDERS, 'order-transfer-1');
    t.eq([closedOrder.transfer.status, closedOrder.transfer.resolveReason],
      [enums.TRANSFER_STATUS.CANCELLED, enums.TRANSFER_RESOLVE_REASON.STATE_CHANGED],
      'U6 注销级联同样取消该队 PENDING 转派');
    t.eq(closedOrder.status, enums.ORDER_STATUS.EXCEPTION, 'U6 主兼职注销把其进行中订单转 EXCEPTION（既有口径不变）');
    const closedEvents = db2.dump(COLLECTIONS.ORDER_EVENTS).filter((event) => event.type === 'TRANSFER_CANCELLED');
    t.eq(closedEvents.length, 1, 'U6 注销级联同样落 1 条 TRANSFER_CANCELLED（与停用同一单源，不重复）');
    const audits = db2.dump(COLLECTIONS.ADMIN_AUDIT);
    const audit = audits[audits.length - 1] || {};
    t.eq([Number(audit.detail && audit.detail.affectedMembers), Number(audit.detail && audit.detail.cancelledTransfers)],
      [1, 1], 'U6 治理审计记 affectedMembers/cancelledTransfers（级联与取消失败可追溯）');
  });

  // ---------------------------------------------------------------- U6b 移除队员
  asyncSection('§2.7-U6b 移除子队员（解除隶属+停用 TEAM_REMOVED+取消 PENDING 转派+在途订单闸+幂等）', async (t) => {
    const db = createTestDb();
    const otherSub = subPartnerDoc({
      _id: 'p-other-sub',
      openid: 'openid-other-sub',
      partnerNo: 'PEEEEEE',
      parentPartnerId: OTHER_MAIN_ID
    });
    db.seed(COLLECTIONS.PARTNERS, [mainPartnerDoc(), subPartnerDoc(), otherSub]);
    db.seed(COLLECTIONS.USERS, [userDoc(MAIN_OPENID), userDoc(SUB_A_OPENID), userDoc(OTHER_MAIN_OPENID)]);
    db.seed(COLLECTIONS.ORDERS, [{
      _id: 'order-sub-active',
      orderNo: '20261103-0002',
      customerId: 'openid-customer-1',
      customerOpenid: 'openid-customer-1',
      partnerId: SUB_A_ID,
      partnerOpenid: SUB_A_OPENID,
      partnerNo: SUB_A_NO,
      status: enums.ORDER_STATUS.ACCEPTED,
      transfer: {
        status: enums.TRANSFER_STATUS.PENDING,
        fromPartnerId: MAIN_ID,
        fromPartnerNo: MAIN_NO,
        toPartnerId: SUB_A_ID,
        toPartnerNo: SUB_A_NO,
        requestedAt: new Date(NOW - MINUTE_MS),
        expiresAt: new Date(NOW + 9 * MINUTE_MS),
        resolvedAt: '',
        resolveReason: ''
      },
      parcels: [{ pickupCode: '1234', stationId: 'P1', stationName: '站点一' }],
      version: 1,
      createdAt: new Date(NOW - DAY_MS),
      updatedAt: new Date(NOW - DAY_MS),
      statusUpdatedAt: new Date(NOW - DAY_MS)
    }]);
    const dao = createDao(db);
    const otherCode = await errorCodeOf(() => removeSubMemberHandler(mainCtx(dao, 'rid-u6b-other-0001'), { partnerNo: 'PEEEEEE' }));
    t.eq(otherCode, 'NOT_FOUND', 'U6b 移除他人队员 → NOT_FOUND（目标 parentPartnerId!==me）');
    const busyCode = await errorCodeOf(() => removeSubMemberHandler(mainCtx(dao, 'rid-u6b-busy-0001'), { partnerNo: SUB_A_NO }));
    t.eq(busyCode, 'INVALID_STATE', 'U6b 目标有进行中订单 → INVALID_STATE（同解绑闸口径）');
    await dao.update(COLLECTIONS.ORDERS, 'order-sub-active', { status: enums.ORDER_STATUS.COMPLETED });
    const removed = await removeSubMemberHandler(mainCtx(dao, 'rid-u6b-remove-0001'), { partnerNo: SUB_A_NO });
    t.eq([removed.partnerNo, removed.status], [SUB_A_NO, enums.PARTNER_STATUS.SUSPENDED], 'U6b 移除成功返回 {partnerNo,status:SUSPENDED}');
    const member = await dao.get(COLLECTIONS.PARTNERS, SUB_A_ID);
    t.eq([member.parentPartnerId, member.status, member.suspendedReason], ['', enums.PARTNER_STATUS.SUSPENDED, 'TEAM_REMOVED'],
      'U6b 解除隶属 parentPartnerId="" + SUSPENDED + suspendedReason=TEAM_REMOVED（恢复需 admin）');
    t.eq(member.serviceConfig.acceptingOrders, false, 'U6b 被移除队员接单开关关闭');
    const order = await dao.get(COLLECTIONS.ORDERS, 'order-sub-active');
    t.eq([order.transfer.status, order.transfer.resolveReason],
      [enums.TRANSFER_STATUS.CANCELLED, enums.TRANSFER_RESOLVE_REASON.STATE_CHANGED],
      'U6b 结束该目标 PENDING 转派（CANCELLED/STATE_CHANGED）');
    const transferEvents = db.dump(COLLECTIONS.ORDER_EVENTS).filter((event) => event.type === 'TRANSFER_CANCELLED');
    t.eq(transferEvents.length, 1, 'U6b 移除队员取消 PENDING 转派写 TRANSFER_CANCELLED 事件恰 1 条');
    const replay = await removeSubMemberHandler(mainCtx(dao, 'rid-u6b-remove-0001'), { partnerNo: SUB_A_NO });
    t.check(replay.duplicated === true, 'U6b 同 clientRequestId 重放幂等（已移除仍返回成功，不因二次 NOT_FOUND 中断客户端）');
    const againCode = await errorCodeOf(() => removeSubMemberHandler(mainCtx(dao, 'rid-u6b-remove-0002'), { partnerNo: SUB_A_NO }));
    t.eq(againCode, 'NOT_FOUND', 'U6b 不同请求再移除同号 → NOT_FOUND（幂等只按请求键，不放大成功面）');
  });

  // ---------------------------------------------------------------- U7 兼容
  asyncSection('§2.7-U7 旧码兼容（无 kind=DEV 激活零改动）+ admin 发码 kind=DEV + listInvites 增列', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    db.seed(COLLECTIONS.INVITATION_CODES, [{
      code: '23456789ABCD',
      status: enums.INVITATION_STATUS.UNUSED,
      batchId: 'B20261103-01',
      expiresAt: new Date(NOW + DAY_MS),
      usedBy: '',
      usedAt: null,
      note: '',
      createdBy: 'DEV-01',
      createdAt: new Date(NOW - DAY_MS),
      revokedAt: null,
      revokedBy: '',
      updatedAt: new Date(NOW - DAY_MS)
    }]);
    db.seed(COLLECTIONS.USERS, [userDoc('openid-legacy-partner', { roles: [] })]);
    const legacyCtx = makeCtx(dao, { openid: 'openid-legacy-partner', role: '', ids: idsFor(200) });
    const activated = await activateHandler(legacyCtx, { invitationCode: '23456789ABCD', displayName: '旧码兼职' });
    const legacyPartner = await dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: 'openid-legacy-partner' } });
    t.check(activated.partnerNo === legacyPartner.partnerNo, 'U7 无 kind 旧码可正常激活（向后兼容）');
    t.eq([legacyPartner.parentPartnerId, legacyPartner.teamJoinedAt], [undefined, undefined],
      'U7 旧码按 DEV 处理：不写 parentPartnerId/teamJoinedAt（缺字段零改动）');
    // admin.createInvites 新码 kind=DEV
    const created = await adminCreateInvites(adminCtx(dao, 'rid-u7-admin-create-1'), { count: 1, expiresInHours: 24 });
    const devCode = await dao.findOne(COLLECTIONS.INVITATION_CODES, { where: { code: created.codes[0] } });
    t.eq([devCode.kind, devCode.issuerPartnerId], [enums.INVITATION_KIND.DEV, ''], 'U7 admin.createInvites 新码 kind=DEV/issuerPartnerId=""');
    // 主兼职发 SUB 码，admin.listInvites 下发行 kind/issuerPartnerNo（本页批量查）
    const subBatch = await createSubInvitesHandler(mainCtx(dao, 'rid-u7-sub-create-1'), { count: 1, validity: '24H' });
    const listed = await adminListInvites(adminCtx(dao, 'rid-u7-list-0001'), { limit: 20 });
    const subRow = listed.list.filter((row) => row.batchId === subBatch.batchId)[0] || {};
    t.eq([subRow.kind, subRow.kindText, subRow.issuerPartnerNo], [enums.INVITATION_KIND.SUB, '主兼职子码', MAIN_NO],
      'U7 listInvites SUB 行带 kind/kindText/issuerPartnerNo（发码主兼职编号）');
    const devRow = listed.list.filter((row) => row.invitationCode === created.codes[0])[0] || {};
    t.eq([devRow.kind, devRow.issuerPartnerNo], [enums.INVITATION_KIND.DEV, ''],
      'U7 listInvites DEV 行 kind=DEV 且 issuerPartnerNo 空串');
    const legacyRow = listed.list.filter((row) => row.invitationCode === '23456789ABCD')[0] || {};
    t.eq(legacyRow.kind, enums.INVITATION_KIND.DEV, 'U7 无 kind 历史码在后台按 DEV 展示（零迁移）');
  });

  // ---------------------------------------------------------------- U8 作废边界
  asyncSection('§2.7-U8 子码批次作废边界（他人批次 NOT_FOUND/全用 INVALID_STATE/本队 REVOKED 幂等）+ admin 只读', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const cfg = configOf({ subInviteRate: { perMinute: 30, perDay: 100 } });
    const batch = await createSubInvitesHandler(mainCtx(dao, 'rid-u8-create-0001', cfg), { count: 2, validity: '24H' });
    // 他人批次 → NOT_FOUND
    db.seed(COLLECTIONS.PARTNERS, [mainPartnerDoc({ _id: OTHER_MAIN_ID, openid: OTHER_MAIN_OPENID, partnerNo: OTHER_MAIN_NO })]);
    db.seed(COLLECTIONS.USERS, [userDoc(OTHER_MAIN_OPENID)]);
    const otherCtx = makeCtx(dao, { openid: OTHER_MAIN_OPENID, role: enums.ROLES.PARTNER, clientRequestId: 'rid-u8-other-0001', config: cfg });
    const otherCode = await errorCodeOf(() => revokeSubInviteHandler(otherCtx, { batchId: batch.batchId }));
    t.eq(otherCode, 'NOT_FOUND', 'U8 他人批次作废 → NOT_FOUND（不区分"他人码"，防枚举）');
    const badBatchCode = await errorCodeOf(() => revokeSubInviteHandler(mainCtx(dao, 'rid-u8-bad-0001', cfg), { batchId: 'not-a-batch' }));
    t.eq(badBatchCode, 'VALIDATION_FAILED', 'U8 批次号格式闸 → VALIDATION_FAILED');
    // 本队未用批次 → 批量 REVOKED
    const revoked = await revokeSubInviteHandler(mainCtx(dao, 'rid-u8-revoke-0001', cfg), { batchId: batch.batchId });
    t.eq([revoked.batchId, revoked.revokedCount], [batch.batchId, 2], 'U8 本队未用批次 → 批量作废 revokedCount=2');
    const revokedDocs = (await dao.find(COLLECTIONS.INVITATION_CODES, { where: { batchId: batch.batchId } }));
    t.check(revokedDocs.every((doc) => doc.status === enums.INVITATION_STATUS.REVOKED), 'U8 该批全部码状态 REVOKED');
    t.check(revokedDocs.every((doc) => doc.revokedBy === MAIN_NO && !!doc.revokedAt), 'U8 revokedBy=主兼职编号 + revokedAt 落库');
    const replay = await revokeSubInviteHandler(mainCtx(dao, 'rid-u8-revoke-0001', cfg), { batchId: batch.batchId });
    t.check(replay.duplicated === true && replay.revokedCount === 2, 'U8 同 clientRequestId 重放幂等（duplicated:true + 同 revokedCount）');
    const ghostCtx = makeCtx(dao, { openid: 'openid-ghost-1', role: '', ids: idsFor(300) });
    const revokedActivation = await errorCodeOf(() => activateHandler(ghostCtx, { invitationCode: batch.codes[0], displayName: '迟到的队员' }));
    t.eq(revokedActivation, 'NOT_FOUND', 'U8 已作废码不可再激活（NOT_FOUND）');
    // 全用批次 → INVALID_STATE
    const single = await createSubInvitesHandler(mainCtx(dao, 'rid-u8-create-0002', cfg), { count: 1, validity: '24H' });
    db.seed(COLLECTIONS.USERS, [userDoc('openid-sub-used', { roles: [] })]);
    await activateHandler(makeCtx(dao, { openid: 'openid-sub-used', role: '', ids: idsFor(400) }), { invitationCode: single.codes[0], displayName: '已用码队员' });
    const usedCode = await errorCodeOf(() => revokeSubInviteHandler(mainCtx(dao, 'rid-u8-revoke-0002', cfg), { batchId: single.batchId }));
    t.eq(usedCode, 'INVALID_STATE', 'U8 该批无未用码（已全用）→ INVALID_STATE');
    // admin 对 SUB 只读、DEV 行为不变（重新发一批未用 SUB 码作为只读样本）
    const adminSubBatch = await createSubInvitesHandler(mainCtx(dao, 'rid-u8-create-0003', cfg), { count: 1, validity: '24H' });
    const adminSub = await errorCodeOf(() => adminRevokeInvite(adminCtx(dao, 'rid-u8-admin-sub-1'), { invitationCode: adminSubBatch.codes[0], reason: '后台尝试作废' }));
    t.eq(adminSub, 'FORBIDDEN', 'U8 admin.revokeInvite 对 SUB 码 → FORBIDDEN（后台只读）');
    const devBatch = await adminCreateInvites(adminCtx(dao, 'rid-u8-admin-dev-1'), { count: 1, expiresInHours: 24 });
    const adminDev = await adminRevokeInvite(adminCtx(dao, 'rid-u8-admin-dev-2'), {
      invitationCode: devBatch.codes[0],
      reason: '正常作废 DEV'
    });
    t.eq(adminDev.status, 'REVOKED', 'U8 admin 对 DEV 码仍可作废（行为零改动）');
  });

  // ---------------------------------------------------------------- U9 限流
  asyncSection('§2.7-U9 rl:subInvite 限流（分钟/日桶打满 → RATE_LIMITED 且零业务写）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const minuteCfg = configOf({ teamMaxMembers: 10, subInviteRate: { perMinute: 1, perDay: 100 } });
    const first = await createSubInvitesHandler(mainCtx(dao, 'rid-u9-minute-0001', minuteCfg), { count: 1, validity: '24H' });
    t.eq(first.codes.length, 1, 'U9 额度内首次发码成功（基线）');
    const before = codeDocsOf(db).length;
    const limited = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao, 'rid-u9-minute-0002', minuteCfg), { count: 1, validity: '24H' }));
    t.eq(limited, 'RATE_LIMITED', 'U9 分钟桶打满 → RATE_LIMITED');
    t.eq(codeDocsOf(db).length, before, 'U9 限流失败零业务写（不落新码）');
    const dayCfg = configOf({ teamMaxMembers: 10, subInviteRate: { perMinute: 30, perDay: 1 } });
    const dayCtx = makeCtx(dao, { openid: MAIN_OPENID, role: enums.ROLES.PARTNER, clientRequestId: 'rid-u9-day-00001', config: dayCfg, now: NOW + DAY_MS });
    const daySecond = makeCtx(dao, { openid: MAIN_OPENID, role: enums.ROLES.PARTNER, clientRequestId: 'rid-u9-day-00002', config: dayCfg, now: NOW + DAY_MS + MINUTE_MS });
    await createSubInvitesHandler(dayCtx, { count: 1, validity: '24H' });
    const dayLimited = await errorCodeOf(() => createSubInvitesHandler(daySecond, { count: 1, validity: '24H' }));
    t.eq(dayLimited, 'RATE_LIMITED', 'U9 日桶打满（同一天第二个分钟窗）→ RATE_LIMITED');
    const counters = db.dump(COLLECTIONS.COUNTERS).filter((row) => String(row.key).indexOf('rl:subInvite:') === 0);
    t.check(counters.length >= 2, 'U9 限流计数落 counters.rl:subInvite:*（窗口/日两桶，样本非空）');
  });

  // ---------------------------------------------------------------- U10 DTO 键白名单
  asyncSection('§2.7-U10 listSubMembers DTO 键白名单（无 openid/parentPartnerId/avatarFileId，codeTail 后 4 位）', async (t) => {
    const db = createTestDb();
    seedBase(db, [subPartnerDoc({ _id: SUB_B_ID, openid: 'openid-sub-b', partnerNo: SUB_B_NO })], [userDoc('openid-sub-b')]);
    const dao = createDao(db);
    const cfg = configOf();
    await createSubInvitesHandler(mainCtx(dao, 'rid-u10-create-0001', cfg), { count: 1, validity: '7D' });
    const view = await listSubMembersHandler(mainCtx(dao, 'rid-u10-main-0001', cfg), {});
    t.eq(view.members.length, 2, 'U10 主兼职可见 2 名子队员');
    t.eq(Object.keys(view.members[0]).sort(), ['displayName', 'partnerNo', 'status', 'teamJoinedAt'],
      'U10 members[] 键集合精确 = {partnerNo,displayName,status,teamJoinedAt}');
    t.check(view.members.every((row) => typeof row.partnerNo === 'string' && row.partnerNo.indexOf('P') === 0),
      'U10 成员行只给 partnerNo（编号级）');
    const membersJson = JSON.stringify(view.members);
    t.check(membersJson.indexOf('openid') === -1 && membersJson.indexOf('parentPartnerId') === -1
      && membersJson.indexOf('avatarFileId') === -1, 'U10 members 序列化零 openid/parentPartnerId/avatarFileId');
    t.eq(view.pendingInvites.length, 1, 'U10 主兼职可见自己发的待用子码');
    t.eq(Object.keys(view.pendingInvites[0]).sort(), ['batchId', 'codeTail', 'expiresAt'], 'U10 pendingInvites[] 键集合仅 {codeTail,expiresAt,batchId}');
    t.eq(String(view.pendingInvites[0].codeTail).length, 4, 'U10 codeTail 恰为后 4 位（完整码只在创建响应）');
    t.eq(view.quota, { used: 2, reserved: 3, max: 5 },
      'U10 quota={used:当前队员数,reserved:队员+待用码,max:config.teamMaxMembers}（与发码闸同口径）');
    t.check(view.team === null, 'U10 主兼职 team=null（无上级）');
    const subView = await listSubMembersHandler(subCtx(dao, SUB_A_OPENID, 'rid-u10-sub-0001', cfg), {});
    t.eq(subView.team, { parentPartnerNo: MAIN_NO, memberCount: 2 }, 'U10 子队员只回自己的队伍摘要（主兼职编号+人数）');
    t.check(subView.members.length === 0 && subView.pendingInvites.length === 0 && subView.quota === null,
      'U10 子队员不返回全队成员/待用码/名额');
  });

  // ---------------------------------------------------------------- U11 静态闸
  asyncSection('§2.7-U11 静态闸（零 db.collection / 注册集=注册表 / 页面零 bind 动作名与队伍状态字面量）', (t) => {
    const partnerHandlers = walkJs('cloudfunctions/api/handlers/partner').map((full) => path.relative(ROOT, full).split(path.sep).join('/'));
    t.check(partnerHandlers.length >= 10, 'U11 handlers/partner 扫描样本非空（' + partnerHandlers.length + ' 个 js）');
    const dbCollectionHits = partnerHandlers.filter((rel) => readSource(rel).indexOf('db.collection') !== -1);
    t.eq(dbCollectionHits, [], 'U11 handlers/partner 零 db.collection（只经 ctx.dao）');
    const expectedPartnerActions = actions.CLIENT_ACTIONS.filter((action) => action.indexOf('partner.') === 0).sort();
    t.eq(Object.keys(partnerIndex.actions).sort(), expectedPartnerActions, 'U11 handlers/partner 导出集 = actions 注册表 partner.* 集');
    const teamActions = ['partner.createSubInvites', 'partner.revokeSubInvite', 'partner.removeSubMember', 'partner.listSubMembers'];
    t.eq(teamActions.map((action) => actions.ACTION_MAP[action] && actions.ACTION_MAP[action].write),
      [true, true, true, false], 'U11 D59 四动作写标记（3 写 + listSubMembers 读）');
    const pageFiles = walkJs('pkg-partner');
    t.check(pageFiles.length >= 5, 'U11 pkg-partner 页面 js 样本非空（' + pageFiles.length + ' 个）');
    const bindActionHits = pageFiles.filter((file) => /['"]bind\.(?:create|release)['"]/.test(fs.readFileSync(file, 'utf8')));
    t.eq(bindActionHits.length, 0, 'U11 pkg-partner 零 bind.create/bind.release 动作名（沿用 check #28 语义）');
    t.eq(scanTeamStatusLiterals(pageFiles).length, 0, 'U11 pkg-partner 零队伍状态字面量（UNUSED/SUSPENDED 由 DTO 下发文案）');
    t.check(TEAM_STATUS_LITERAL_RE.test("var s = 'UNUSED';"), 'U11 同一扫描口径对反例命中（判据有牙，不靠空集全绿）');
    const listInvitesSrc = readSource('cloudfunctions/api/handlers/admin/listInvites.js');
    t.check(listInvitesSrc.indexOf("command('in'") !== -1 && listInvitesSrc.indexOf('dao.get(COLLECTIONS.PARTNERS') === -1,
      'U11 admin.listInvites 本页批量查 partners（command in），不逐行 N+1');
    t.check(readSource('cloudfunctions/api/handlers/admin/invite-codes/_dto.js').indexOf('issuerPartnerNo') !== -1,
      'U11 邀请码 DTO 单源在 handlers/admin/invite-codes/_dto.js（含 issuerPartnerNo）');
    t.check(readSource('cloudfunctions/api/handlers/admin/createInvites.js').indexOf('INVITATION_KIND.DEV') !== -1,
      'U11 admin.createInvites 新码写 kind=DEV');
    t.check(readSource('cloudfunctions/api/handlers/admin/revokeInvite.js').indexOf("INVITATION_KIND.SUB") !== -1,
      'U11 admin.revokeInvite 对 SUB 码 fail-closed（后台只读）');
    const teamSrc = readSource('cloudfunctions/api/handlers/partner/_team.js');
    t.check(teamSrc.indexOf('db.collection') === -1 && teamSrc.indexOf('wx.') === -1,
      'U11 _team.js 零 db.collection/零 wx（纯服务端纯件）');
  });

  // ---------------------------------------------------------------- U12 主兼职状态闸
  asyncSection('§2.7-U12 SUB 码主兼职状态闸（停用/注销后未用子码不得激活；ACTIVE 基线不误挡）', async (t) => {
    const db = createTestDb();
    seedBase(db);
    const dao = createDao(db);
    const created = await createSubInvitesHandler(mainCtx(dao, 'rid-u12-create-0001'), { count: 2, validity: '24H' });
    await dao.update(COLLECTIONS.PARTNERS, MAIN_ID, { status: enums.PARTNER_STATUS.SUSPENDED, updatedAt: new Date(NOW) });
    db.seed(COLLECTIONS.USERS, [userDoc('openid-issuer-gate', { roles: [] })]);
    const partnersBefore = db.dump(COLLECTIONS.PARTNERS).length;
    const suspendedCtx = makeCtx(dao, { openid: 'openid-issuer-gate', role: '', ids: idsFor(500) });
    const suspendedCode = await errorCodeOf(() => activateHandler(suspendedCtx, { invitationCode: created.codes[0], displayName: '停用期的队员' }));
    t.eq(suspendedCode, 'PARTNER_CLOSED', 'U12 主兼职 SUSPENDED → 未用子码激活 PARTNER_CLOSED（邀请方已停用）');
    t.eq([db.dump(COLLECTIONS.PARTNERS).length,
      codeDocsOf(db).filter((doc) => doc.status === enums.INVITATION_STATUS.UNUSED).length],
    [partnersBefore, 2], 'U12 被拒路径零写库（partners 不增、两码仍 UNUSED）');
    await dao.update(COLLECTIONS.PARTNERS, MAIN_ID, { status: enums.PARTNER_STATUS.ACTIVE, updatedAt: new Date(NOW) });
    const activated = await activateHandler(
      makeCtx(dao, { openid: 'openid-issuer-gate', role: '', ids: idsFor(600) }),
      { invitationCode: created.codes[1], displayName: '恢复后的队员' }
    );
    const fresh = await dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: 'openid-issuer-gate' } });
    t.eq([fresh.parentPartnerId, fresh.status, activated.partnerNo],
      [MAIN_ID, enums.PARTNER_STATUS.ACTIVE, partnerNoOfSeq(600)],
      'U12 主兼职 ACTIVE → 子码正常激活（判据有牙，不是一刀切拒绝）');
  });

  // ---------------------------------------------------------------- U13 并发与一致性
  asyncSection('§2.7-U13 并发/一致性（名额 TOCTOU 恰一成功、重放按队隔离、移除限流与定向取消、恢复悬挂上级、限流逐字段回落、限流桶首建并发重试）', async (t) => {
    // a) 名额 TOCTOU：并发两请求（max=1、零队员）各自过事务外闸，只有抢到日序号 CAS 的落码
    const db = createTestDb();
    db.seed(COLLECTIONS.PARTNERS, [mainPartnerDoc()]);
    db.seed(COLLECTIONS.USERS, [userDoc(MAIN_OPENID)]);
    seedRateCounters(db, MAIN_OPENID, NOW);
    const dao = createDao(db);
    const oneSlot = configOf({ teamMaxMembers: 1, subInviteRate: { perMinute: 30, perDay: 100 } });
    const raced = await Promise.allSettled([
      createSubInvitesHandler(mainCtx(dao, 'rid-u13-race-0001', oneSlot), { count: 1, validity: '24H' }),
      createSubInvitesHandler(mainCtx(dao, 'rid-u13-race-0002', oneSlot), { count: 1, validity: '24H' })
    ]);
    const raceWinners = raced.filter((row) => row.status === 'fulfilled');
    const raceLosers = raced.filter((row) => row.status === 'rejected').map((row) => row.reason && row.reason.code);
    t.eq([raceWinners.length, codeDocsOf(db).length], [1, 1],
      'U13 并发两请求（max=1）恰一个成功、码表恰 1 条（事务内名额复核收口，不再各自过闸双落码）');
    t.eq(raceLosers, ['CONFLICT'], 'U13 并发失败侧 → CONFLICT（日序号 CAS 抢不到即回滚，非静默超发）');

    // b) 重放回读按 issuerPartnerId 隔离：batchId 撞号也不能把别队的码回给本请求
    const db2 = createTestDb();
    seedBase(db2, [mainPartnerDoc({ _id: OTHER_MAIN_ID, openid: OTHER_MAIN_OPENID, partnerNo: OTHER_MAIN_NO })], [userDoc(OTHER_MAIN_OPENID)]);
    const dao2 = createDao(db2);
    const collideBatch = 'TB20261103-77';
    const crid = 'rid-u13-replay-0001';
    db2.seed(COLLECTIONS.INVITATION_CODES, [{
      code: 'ABCD2345EFGH', kind: enums.INVITATION_KIND.SUB, issuerPartnerId: OTHER_MAIN_ID, batchId: collideBatch,
      status: enums.INVITATION_STATUS.UNUSED, expiresAt: new Date(NOW + DAY_MS), usedBy: '', usedAt: null, note: '',
      createdBy: 'PARTNER:' + OTHER_MAIN_NO, createdAt: new Date(NOW), revokedAt: null, revokedBy: '', updatedAt: new Date(NOW)
    }]);
    db2.seed(COLLECTIONS.COUNTERS, [{
      key: 'subInviteReq:' + MAIN_ID + ':' + crid, batchId: collideBatch,
      expiresAt: new Date(NOW + DAY_MS), count: 1, updatedAt: new Date(NOW)
    }]);
    const replayedForeign = await createSubInvitesHandler(mainCtx(dao2, crid), { count: 1, validity: '24H' });
    t.eq([replayedForeign.batchId, replayedForeign.codes], [collideBatch, []],
      'U13 重放回读加 issuerPartnerId 条件：撞号批次的别队子码不回给本请求（codes 为空）');
    t.check(JSON.stringify(replayedForeign.codes).indexOf('ABCD2345EFGH') === -1,
      'U13 别队完整码零泄漏（模拟 batchId 跨队撞号）');
    // 合法基线：本队映射（映射行未存 code）能回读本队码
    const ownBatch = 'TB20261103-88';
    const ownCrid = 'rid-u13-replay-0002';
    db2.seed(COLLECTIONS.INVITATION_CODES, [{
      code: 'WXYZ2345JKLM', kind: enums.INVITATION_KIND.SUB, issuerPartnerId: MAIN_ID, batchId: ownBatch,
      status: enums.INVITATION_STATUS.UNUSED, expiresAt: new Date(NOW + DAY_MS), usedBy: '', usedAt: null, note: '',
      createdBy: 'PARTNER:' + MAIN_NO, createdAt: new Date(NOW), revokedAt: null, revokedBy: '', updatedAt: new Date(NOW)
    }]);
    db2.seed(COLLECTIONS.COUNTERS, [{
      key: 'subInviteReq:' + MAIN_ID + ':' + ownCrid, batchId: ownBatch,
      expiresAt: new Date(NOW + DAY_MS), count: 1, updatedAt: new Date(NOW)
    }]);
    const replayedOwn = await createSubInvitesHandler(mainCtx(dao2, ownCrid), { count: 1, validity: '24H' });
    t.eq([replayedOwn.duplicated, replayedOwn.codes], [true, ['WXYZ2345JKLM']],
      'U13 合法基线：本队映射重放回本队码且 duplicated=true（隔离条件不误挡正常重放）');

    // c) 同 clientRequestId 并发重放：事务内幂等键冲突即回滚，不重复插码（计数行预置，免首建唯一键干扰被测闸）
    const db3 = createTestDb();
    seedBase(db3);
    seedRateCounters(db3, MAIN_OPENID, NOW);
    const dao3 = createDao(db3);
    const sameCrid = 'rid-u13-same-0001';
    const dup = await Promise.allSettled([
      createSubInvitesHandler(mainCtx(dao3, sameCrid), { count: 1, validity: '24H' }),
      createSubInvitesHandler(mainCtx(dao3, sameCrid), { count: 1, validity: '24H' })
    ]);
    const dupBatchIds = dup.filter((row) => row.status === 'fulfilled').map((row) => row.value.batchId);
    t.eq(codeDocsOf(db3).length, 1, 'U13 同 clientRequestId 并发重放：码表恰 1 条（幂等键在事务内，回滚不重复插码）');
    t.check(dupBatchIds.length >= 1 && dupBatchIds.every((id) => /^TB\d{8}-\d{2}$/.test(id)),
      'U13 同请求并发响应 batchId 形态合法（赢家发码/输家回同批或 CONFLICT，不产第二条码）');
    // c2) 脏幂等映射（有键无 batchId）：handler 早退不了，事务内 mark 返回 false → 抛错回滚、零插码
    const db3b = createTestDb();
    seedBase(db3b);
    const dao3b = createDao(db3b);
    const dirtyCrid = 'rid-u13-dirty-0001';
    db3b.seed(COLLECTIONS.COUNTERS, [{ key: 'subInviteReq:' + MAIN_ID + ':' + dirtyCrid, note: 'dirty', updatedAt: new Date(NOW) }]);
    const dirtyCode = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao3b, dirtyCrid), { count: 1, validity: '24H' }));
    t.eq([dirtyCode, codeDocsOf(db3b).length], ['CONFLICT', 0],
      'U13 幂等键已存在（无 batchId 脏映射）→ CONFLICT 且码表 0 条（markRequestInTx=false 抛错回滚，不重复插码）');

    // d) 限流逐字段回落（_team.subInviteRateOf）：只配 perDay 时 perMinute 取出厂值、perDay 仍生效
    const db4 = createTestDb();
    seedBase(db4);
    const dao4 = createDao(db4);
    const dayOnly = configOf({ teamMaxMembers: 10, subInviteRate: { perDay: 2 } });
    await createSubInvitesHandler(mainCtx(dao4, 'rid-u13-rate-0001', dayOnly), { count: 1, validity: '24H' });
    await createSubInvitesHandler(mainCtx(dao4, 'rid-u13-rate-0002', dayOnly), { count: 1, validity: '24H' });
    const dayLimited = await errorCodeOf(() => createSubInvitesHandler(mainCtx(dao4, 'rid-u13-rate-0003', dayOnly), {
      count: 1,
      validity: '24H'
    }));
    t.eq(dayLimited, 'RATE_LIMITED',
      'U13 缺 perMinute 时逐字段回落出厂值、perDay=2 仍生效（第 3 次 RATE_LIMITED；整对象回落会放行）');

    // e) 移除队员补限流：第二次移除 → RATE_LIMITED 且目标零改动
    const db5 = createTestDb();
    seedBase(db5, [subPartnerDoc({ _id: SUB_B_ID, openid: 'openid-sub-b', partnerNo: SUB_B_NO })], [userDoc('openid-sub-b')]);
    const dao5 = createDao(db5);
    const tightRate = configOf({ subInviteRate: { perMinute: 1, perDay: 100 } });
    await removeSubMemberHandler(mainCtx(dao5, 'rid-u13-remove-0001', tightRate), { partnerNo: SUB_A_NO });
    const rmLimited = await errorCodeOf(() => removeSubMemberHandler(mainCtx(dao5, 'rid-u13-remove-0002', tightRate), {
      partnerNo: SUB_B_NO
    }));
    const untouchedB = await dao5.get(COLLECTIONS.PARTNERS, SUB_B_ID);
    t.eq([rmLimited, untouchedB.status], ['RATE_LIMITED', enums.PARTNER_STATUS.ACTIVE],
      'U13 removeSubMember 走 rl:subInvite 限流（第二次被拒且目标零改动）');

    // f) 移除队员事务内定向取消：只按 transfer.toPartnerId 批量取消 + 同事务写事件（计数断言）
    const db6 = createTestDb();
    seedBase(db6);
    // 3 条已完成订单、均把 SUB_A 作为 PENDING 转派目标（移除时同事务定向取消）
    const pendingOrderOf = (id) => ({
      _id: id, orderNo: '20261103-' + id.slice(-4), customerId: 'openid-customer-1',
      customerOpenid: 'openid-customer-1', partnerId: SUB_A_ID, partnerOpenid: 'openid-partner-of-order',
      partnerNo: SUB_A_NO, status: enums.ORDER_STATUS.COMPLETED,
      transfer: {
        status: enums.TRANSFER_STATUS.PENDING, fromPartnerId: MAIN_ID, fromPartnerNo: MAIN_NO,
        toPartnerId: SUB_A_ID, toPartnerNo: SUB_A_NO, requestedAt: new Date(NOW - MINUTE_MS),
        expiresAt: new Date(NOW + 9 * MINUTE_MS), resolvedAt: '', resolveReason: ''
      },
      parcels: [{ pickupCode: '1234', stationId: 'P1', stationName: '站点一' }],
      version: 1, createdAt: new Date(NOW - DAY_MS), updatedAt: new Date(NOW - DAY_MS), statusUpdatedAt: new Date(NOW - DAY_MS)
    });
    // 反例样本：SUB_A 作发起方的 PENDING 转派不属本事务目标（定向条件只看 toPartnerId，上界见 _team 注释）
    const outgoingOrder = {
      _id: 'order-u13-outgoing', orderNo: '20261103-0099', customerId: 'openid-customer-1',
      customerOpenid: 'openid-customer-1', partnerId: SUB_A_ID, partnerOpenid: '', partnerNo: SUB_A_NO,
      status: enums.ORDER_STATUS.COMPLETED,
      transfer: {
        status: enums.TRANSFER_STATUS.PENDING, fromPartnerId: SUB_A_ID, fromPartnerNo: SUB_A_NO,
        toPartnerId: MAIN_ID, toPartnerNo: MAIN_NO, requestedAt: new Date(NOW - MINUTE_MS),
        expiresAt: new Date(NOW + 9 * MINUTE_MS), resolvedAt: '', resolveReason: ''
      },
      parcels: [], version: 1, createdAt: new Date(NOW - DAY_MS), updatedAt: new Date(NOW - DAY_MS),
      statusUpdatedAt: new Date(NOW - DAY_MS)
    };
    db6.seed(COLLECTIONS.ORDERS, [pendingOrderOf('order-u13-0001'), pendingOrderOf('order-u13-0002'), pendingOrderOf('order-u13-0003'), outgoingOrder]);
    const dao6 = createDao(db6);
    await removeSubMemberHandler(mainCtx(dao6, 'rid-u13-cancel-0001'), { partnerNo: SUB_A_NO });
    const cancelOrders = db6.dump(COLLECTIONS.ORDERS)
      .filter((row) => row.transfer && row.transfer.status === enums.TRANSFER_STATUS.CANCELLED);
    const cancelEvents = db6.dump(COLLECTIONS.ORDER_EVENTS).filter((event) => event.type === 'TRANSFER_CANCELLED');
    t.eq([cancelOrders.length, cancelEvents.length], [3, 3],
      'U13 移除队员同事务批量取消该目标 3 条 PENDING 转派 + 事件恰 3 条（事务内直写，不嵌套事务）');
    t.check(cancelOrders.every((row) => row._id !== 'order-u13-outgoing'),
      'U13 定向取消只命中 transfer.toPartnerId=（发起方一侧不在本事务范围，保护 100 ops 上界）');

    // g) admin 恢复子队员的悬挂上级：CLOSED 上级 → 解除隶属 + 审计；ACTIVE 上级 → 保留隶属
    const db7 = createTestDb();
    db7.seed(COLLECTIONS.PARTNERS, [mainPartnerDoc({ status: enums.PARTNER_STATUS.CLOSED, deletedAt: new Date(NOW - DAY_MS) }),
      subPartnerDoc({ status: enums.PARTNER_STATUS.SUSPENDED })]);
    db7.seed(COLLECTIONS.USERS, [userDoc(MAIN_OPENID), userDoc(SUB_A_OPENID)]);
    const dao7 = createDao(db7);
    await adminSetPartnerStatus(adminCtx(dao7, 'rid-u13-restore-0001'), { partnerNo: SUB_A_NO, status: enums.PARTNER_STATUS.ACTIVE, reason: 'U13 恢复子队员' });
    const restored = await dao7.get(COLLECTIONS.PARTNERS, SUB_A_ID);
    const orphanAudit = db7.dump(COLLECTIONS.ADMIN_AUDIT).filter((row) => row.action === 'PARTNER_RESTORE')[0] || {};
    t.eq([restored.status, restored.parentPartnerId, !!(orphanAudit.detail && orphanAudit.detail.detachedFromParent)],
      [enums.PARTNER_STATUS.ACTIVE, '', true],
      'U13 上级已 CLOSED → 恢复时清 parentPartnerId（不悬挂）+ 审计 detail.detachedFromParent=true');
    const db8 = createTestDb();
    seedBase(db8);
    const dao8 = createDao(db8);
    await dao8.update(COLLECTIONS.PARTNERS, SUB_A_ID, { status: enums.PARTNER_STATUS.SUSPENDED, updatedAt: new Date(NOW) });
    await adminSetPartnerStatus(adminCtx(dao8, 'rid-u13-restore-0002'), { partnerNo: SUB_A_NO, status: enums.PARTNER_STATUS.ACTIVE, reason: 'U13 上级在队恢复' });
    const kept = await dao8.get(COLLECTIONS.PARTNERS, SUB_A_ID);
    const keptAudit = db8.dump(COLLECTIONS.ADMIN_AUDIT).filter((row) => row.action === 'PARTNER_RESTORE')[0] || {};
    t.eq([kept.status, kept.parentPartnerId, !!(keptAudit.detail && keptAudit.detail.detachedFromParent)],
      [enums.PARTNER_STATUS.ACTIVE, MAIN_ID, false],
      'U13 上级仍 ACTIVE → 恢复保留 parentPartnerId、审计 detachedFromParent=false（判据有牙）');

    // h) 限流计数行首建并发（真实云 DB：counters.key 唯一索引；fake DB 无并发交错窗口 → 用 raceCounterDao 造
    //    "事务快照读不到并发赢家已提交的行"）：add 撞唯一键 → 事务 abort，外层重试一次读到赢家行走 update；
    //    两次都撞 → CONFLICT（如实映射，绝不伪装 RATE_LIMITED）且零业务写。
    const db9 = createTestDb();
    seedBase(db9);
    seedRateCounters(db9, MAIN_OPENID, NOW);
    const rateRaced = await createSubInvitesHandler(mainCtx(raceCounterDao(createDao(db9), 1), 'rid-u13-race-0003'), { count: 1, validity: '24H' });
    const rateRows = db9.dump(COLLECTIONS.COUNTERS).filter((row) => String(row.key).indexOf('rl:subInvite:') === 0);
    t.eq(rateRaced.codes.length, 1, 'U13 限流计数行首建撞唯一键 → 整事务回滚后重试成功（不报 CONFLICT/INTERNAL_ERROR）');
    t.eq([rateRows.length, rateRows.map((row) => row.seq).sort().join(',')], [2, '1,1'],
      'U13 重试读到并发赢家已提交的行 → update 递增（恰 2 行、无双计/重复插行）');
    t.eq(db9.stats.rollbacks, 1, 'U13 首建冲突那次事务真回滚（rollback=1，证明重试在事务外而非同事务硬修）');
    const db10 = createTestDb();
    seedBase(db10);
    seedRateCounters(db10, MAIN_OPENID, NOW);
    const rateExhausted = await errorCodeOf(() => createSubInvitesHandler(
      mainCtx(raceCounterDao(createDao(db10), 2), 'rid-u13-race-0004'), { count: 1, validity: '24H' }));
    t.eq([rateExhausted, codeDocsOf(db10).length], ['CONFLICT', 0],
      'U13 首建冲突重试仍失败 → CONFLICT（如实映射，不伪装 RATE_LIMITED）且零业务写');

    // i) 静态接线：名额复核/幂等键/重放隔离都在事务内（源码顺序断言，删掉任一闸即红）
    const createSrc = readSource('cloudfunctions/api/handlers/partner/createSubInvites.js');
    const body = createSrc.slice(createSrc.indexOf('async function createBatch'), createSrc.indexOf('async function runCreate'));
    t.check(body.indexOf('nextBatchSeqInTx') !== -1 && body.indexOf('assertQuotaInTx') !== -1
      && body.indexOf('assertQuotaInTx') > body.indexOf('nextBatchSeqInTx')
      && body.indexOf('markRequestInTx') > body.indexOf('assertQuotaInTx')
      && body.indexOf('insertUnique') > body.indexOf('markRequestInTx'),
    'U13 createBatch 事务内顺序 = 日序号 CAS → 名额复核 → 幂等键 → 插码（TOCTOU/重放均有闸）');
    const removeSrc = readSource('cloudfunctions/api/handlers/partner/removeSubMember.js');
    t.check(removeSrc.indexOf('consumeSubInviteRate') !== -1 && removeSrc.indexOf('cancelIncomingTransfersInTx') !== -1
      && createSrc.indexOf('issuerPartnerId: partnerId, batchId') !== -1,
    'U13 removeSubMember 接限流+事务内定向取消；createSubInvites 重放回读带 issuerPartnerId 隔离');
  });
}

if (require.main === module) {
  const h = createHarness({ name: 'selftest-team' });
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  h.finish();
}

module.exports = { register, EXPECTED_ASSERTIONS };
