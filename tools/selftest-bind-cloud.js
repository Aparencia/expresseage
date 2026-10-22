'use strict';
/**
 * tools/selftest-bind-cloud.js — 云端绑定域端到端断言套件（批 3 / TD-029 行数红线拆分）。
 *
 * 背景：tools/selftest-cloud.js 已 999/1000 行（TD-029），批 3 云端绑定域断言不得再挤进该文件；
 *       本文件以 register 形态独立成套，并在 tools/selftest.js 的 SUITES 数组中登记。
 *
 * 覆盖（任务 task-56 A~H；ENGINEERING §7.3，ARCHITECTURE §4.3）：
 *   A. 绑定方向守卫：顾客正常绑定基线；PARTNER 调 bind.create → FORBIDDEN；自绑 → FORBIDDEN；
 *      真实×测试互绑双向 → FORBIDDEN（且零写入）。
 *   B. 编号归一/错前缀同源提示（与 cloud-core task-55 冻结口径一致）：p-7k2-m9x/全角归一命中同一兼职；
 *      C→CUSTOMER_PREFIX、DEV→DEVELOPER_PREFIX、P-ABC/乱码→FORMAT；data.field=partnerNo；
 *      bind.create 与 partner.getPublic 两处同口径（文案 === shared/error-copy.PREFIX_HINT）。
 *   C. roomTag：同（partnerId,dormKey）A→B、另一 dormKey 重新从 A、恒 /^[A-Z]+$/；
 *      释放后再绑只增不复用；bindings.tagKey 唯一索引真拦重复写。
 *   D. 换绑/换宿舍：未 release 换兼职 CONFLICT；release 后换绑成功且新 tag；saveProfile 换宿舍
 *      → 旧 ACTIVE RELEASED + 新 binding（新 dormKey/新 tag、旧行保留）；有进行中订单 → INVALID_STATE 零写入。
 *   E. 解绑/失联：reason 必填/非法/note 超长 → VALIDATION_FAILED；RELEASED 历史键 = customerId:RELEASED:_id；
 *      一顾客仅一条 ACTIVE；重复 release duplicated=true；有进行中订单拒绝；partner.unbindCustomer
 *      非本人 → NOT_FOUND、成功写 BIND_RELEASED 通知、重复调用 duplicated=true。
 *   F. getPublic / DTO 读屏蔽：绑定前不回 avatarFileId；绑定后 bind.getCurrent 的 partnerPublic 含头像昵称；
 *      解绑后 {binding:null,partnerPublic:null}；listBindings 不含 RELEASED 行；测试账号对真实顾客 NOT_FOUND、
 *      TEST_WRITE 会话可预览；PARTNER 调 getPublic bound 恒 false。
 *   G. 接单开关：saveServiceConfig 落库 acceptingOrders=false → order.create PARTNER_CLOSED；true 基线可建单。
 *   H. 事务冲突有界重试（依赖 cloud-core task-55 的 cloudfunctions/api/lib/tx.js）：
 *      retryOnConflict 默认 3 次、只重试冲突、非冲突立即抛；包装 dao 注入冲突 → 绑定成功且 roomTag 连续。
 *
 * 纪律：fake DB 注入、不连真库、不 mock 全局 wx；先合法基线再反例，样本非空；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-bind-cloud.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard } = require('./selftest');
const { createFakeDb } = require('./fake-db');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');

const app = require(path.join(API, 'app.js'));
const { createDao } = require(path.join(API, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const enums = require(path.join(API, 'shared/enums.js'));
const errorCopy = require(path.join(API, 'shared/error-copy.js'));
const switchSession = require(path.join(API, 'middleware/switch-session.js'));
const { baseIdentity } = require(path.join(API, 'app.js'));

const { ROLES, USER_STATUS, PARTNER_STATUS, BINDING_STATUS, VIEW_MODE, SERVICE_CODES } = enums;
const NOW = Date.parse('2026-10-21T12:00:00+08:00');
const ADMIN_OPENID = 'openid-admin-dev01';
const ADMIN_ENV = { ADMIN_OPENIDS: JSON.stringify({ [ADMIN_OPENID]: 'DEV-01' }) };

const EXPECTED_ASSERTIONS = 108;

const ALL_COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

// 内容安全桩：saveProfile 等会调 cloud.openapi.security.msgSecCheck，单测零真实微信外呼。
function cloudStub(suggest) {
  const result = suggest || 'pass';
  return {
    openapi: {
      security: {
        msgSecCheck: async () => ({
          errCode: 0,
          result: { suggest: result, label: result === 'pass' ? 100 : 20001 }
        })
      }
    }
  };
}

// bindings 必须同时有 activeKey / tagKey 两条唯一索引（tagKey 防并发重复分配同一标签）。
function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['customerNo'], ['_id']],
    partners: [['openid'], ['partnerNo']],
    bindings: [['activeKey'], ['tagKey']],
    orders: [['orderNo'], ['requestKey']],
    order_events: [['requestKey']],
    counters: [['key']],
    admin_audit: [['requestKey']],
    admin_view_sessions: [['requestKey']],
    upload_tickets: [['ticket']],
    recognition_failures: [['failureNo'], ['requestKey']]
  };
}

function createTestDb() {
  const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
  ALL_COLLECTION_NAMES.forEach((name) => db.seed(name, []));
  return db;
}

function apiOf(db, openid, cloud) {
  return app.createApi({ db, now: () => NOW, openid, env: ADMIN_ENV, cloud: cloud || cloudStub('pass') });
}

function userDoc(id, roles, extra) {
  return Object.assign({
    _id: id, roles: roles || [], status: USER_STATUS.ACTIVE, isTestAccount: false,
    privacyConsent: null, messageReadAt: 0, deletionRequestedAt: 0, createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function customerDoc(id, extra) {
  return Object.assign({
    _id: id, customerNo: 'CABCDEFGH', displayName: '小王', phoneTail: '1234',
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522',
    profileCompleted: true, avatarFileId: '', createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function partnerDoc(id, openid, partnerNo, extra) {
  return Object.assign({
    _id: id, openid, partnerNo, displayName: '小李', status: PARTNER_STATUS.ACTIVE,
    avatarFileId: '', serviceConfig: {
      services: [{ code: SERVICE_CODES[0], enabled: true }],
      zones: ['D', 'X', 'N', 'B', 'C'],
      acceptingOrders: true
    },
    stats: {}, createdAt: NOW, updatedAt: NOW
  }, extra || {});
}

function bindingDoc(id, customerId, partnerId, extra) {
  return Object.assign({
    _id: id, activeKey: customerId, customerId, partnerId, status: BINDING_STATUS.ACTIVE,
    roomTag: 'A', allocSeq: 1, tagKey: partnerId + ':D4-522:A',
    dormSnapshot: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4' },
    partnerNote: '', boundAt: NOW, updatedAt: NOW,
    releasedAt: null, releaseReason: '', releaseNote: '', releasedBy: ''
  }, extra || {});
}

function orderDoc(id, customerId, partnerId, partnerOpenid, status) {
  return {
    _id: id, orderNo: '20261021-9001', requestKey: customerId + ':' + id,
    customerId, customerOpenid: customerId, customerNo: 'CABCDEFGH',
    partnerId, partnerOpenid, partnerNo: 'PABC23',
    source: 'CUSTOMER', isTest: false, status: status || enums.ORDER_STATUS.SUBMITTED,
    statusUpdatedAt: NOW, createdAt: NOW, version: 1,
    parcel: { stationId: 'P3', pickupCode: 'A12345' }
  };
}

// 小写集合键静态回归扫描：`COLLECTIONS.orders` 这类常量键拼错 → dao 抛「未登记的集合：undefined」
// → app 收敛 INTERNAL_ERROR，且只在合法 happy path 才触发（G 组 P0 的同类回归闸）。
// 口径：去注释后匹配 COLLECTIONS.<小写>；排除 ALL_COLLECTIONS.xxx；白名单只允许 COLLECTIONS.length / indexOf。
const LOWERCASE_COLLECTION_KEY_RE = /(^|[^A-Za-z0-9_$])COLLECTIONS\.([a-z][A-Za-z0-9_$]*)/;

function lowercaseCollectionKeyHitsInText(code) {
  const hits = [];
  String(code).split('\n').forEach((line, index) => {
    LOWERCASE_COLLECTION_KEY_RE.lastIndex = 0;
    const match = line.match(LOWERCASE_COLLECTION_KEY_RE);
    if (!match) {
      return;
    }
    const key = match[2];
    if (key === 'length' || key === 'indexOf') {
      return;
    }
    hits.push(':' + (index + 1) + ': ' + line.trim());
  });
  return hits;
}

function listCloudJs(dir, out) {
  const acc = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listCloudJs(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  });
  return acc;
}

function scanLowercaseCollectionKeys(fileList) {
  const hits = [];
  fileList.forEach((full) => {
    const code = fsutil.stripComments(fs.readFileSync(full, 'utf8'));
    lowercaseCollectionKeyHitsInText(code).forEach((hit) => {
      hits.push(path.relative(ROOT, full).replace(/\\/g, '/') + hit);
    });
  });
  return hits;
}

// 切换会话中间件状态桩（参考 selftest-cloud.js 的 makeState/readAction 写法）
function makeMwCtx(db, openid) {
  return {
    dao: createDao(db),
    now: NOW,
    env: ADMIN_ENV,
    cloud: cloudStub('pass'),
    openid,
    identity: {
      actorOpenid: openid, effectiveOpenid: openid, role: '', isTestAccount: false,
      viewMode: '', viewTicketId: '', developerNo: 'DEV-01'
    },
    requestId: 'req-mw',
    clientRequestId: 'mw-request-0000000001',
    expectedVersion: undefined,
    config: {}
  };
}

function makeMwState(ctx, action, viewTicket) {
  return {
    action,
    payload: {},
    ctx,
    meta: {
      spec: { visibility: 'client', write: false },
      requestId: 'req-mw',
      clientRequestId: undefined,
      expectedVersion: undefined,
      viewTicket,
      hasViewTicket: !!viewTicket,
      configSeeded: false
    }
  };
}

// 异步分节串行：harness.sectionTitle 是全局的，并发跑会让失败标签串到别的节。
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

  // ---------------------------------------------------------------- A 绑定方向守卫
  asyncSection('A. 绑定方向守卫（顾客唯一入口 / PARTNER 拒绝 / 自绑拒绝 / 真实×测试双向拒绝）', async (t) => {
    const db = createTestDb();
    db.seed('users', [
      userDoc('openid-a-c', [ROLES.CUSTOMER]),
      userDoc('openid-a-p1', [ROLES.PARTNER]),
      userDoc('openid-a-p2', [ROLES.PARTNER])
    ]);
    db.seed('customers', [customerDoc('openid-a-c')]);
    db.seed('partners', [
      partnerDoc('partner-a-1', 'openid-a-p1', 'PABC234', { avatarFileId: 'cloud://env/avatars/partner/AAAAAAAAAAAAAAAA.jpg' }),
      partnerDoc('partner-a-2', 'openid-a-p2', 'PABC235')
    ]);
    const customerApi = apiOf(db, 'openid-a-c');
    const bind = await customerApi.call('bind.create', { partnerNo: 'PABC234' }, { clientRequestId: 'bind-a-000000000001' });
    t.check(bind.ok === true && bind.data.binding && /^[A-Z]+$/.test(bind.data.binding.roomTag),
      'A1 基线：顾客 bind.create 成功并回大写 roomTag');
    t.check(!!bind.data.partnerPublic && bind.data.partnerPublic.displayName === '小李',
      'A2 绑定成功回 partnerPublic（绑定后可见昵称）');

    const partnerApi = apiOf(db, 'openid-a-p1');
    const partnerCall = await partnerApi.call('bind.create', { partnerNo: 'PABC235' }, { clientRequestId: 'bind-a-000000000002' });
    t.eq(partnerCall.code, 'FORBIDDEN', 'A3 PARTNER 身份调 bind.create → FORBIDDEN（绑定只能顾客发起）');
    t.eq(db.dump('bindings').length, 1, 'A4 PARTNER 调用零写入（仍只有基线 1 条绑定）');

    // 自绑：同一 openid 既是顾客又有自己的兼职档案（roles 只 CUSTOMER，绕过方向闸直达 handler 自绑闸）
    const selfDb = createTestDb();
    selfDb.seed('users', [userDoc('openid-self', [ROLES.CUSTOMER])]);
    selfDb.seed('customers', [customerDoc('openid-self')]);
    selfDb.seed('partners', [partnerDoc('partner-self', 'openid-self', 'PSELF23')]);
    const selfCall = await apiOf(selfDb, 'openid-self')
      .call('bind.create', { partnerNo: 'PSELF23' }, { clientRequestId: 'bind-a-000000000003' });
    t.eq(selfCall.code, 'FORBIDDEN', 'A5 自绑（partner.openid === effectiveOpenid）→ FORBIDDEN');
    t.eq(selfDb.dump('bindings').length, 0, 'A6 自绑零写入');

    // 真实×测试双向：真实顾客→测试兼职、测试顾客→真实兼职
    const rxDb = createTestDb();
    rxDb.seed('users', [
      userDoc('openid-rx-real-c', [ROLES.CUSTOMER]),
      userDoc('openid-rx-real-p', [ROLES.PARTNER]),
      userDoc('TEST-RXTESTPARTNER', [ROLES.PARTNER], { isTestAccount: true, createdByDeveloperNo: 'DEV-01' }),
      userDoc('TEST-RXTESTCUSTOMER', [ROLES.CUSTOMER], { isTestAccount: true, createdByDeveloperNo: 'DEV-01' })
    ]);
    rxDb.seed('customers', [
      customerDoc('openid-rx-real-c'),
      customerDoc('TEST-RXTESTCUSTOMER', { customerNo: 'CABCDEFGJ' })
    ]);
    rxDb.seed('partners', [
      partnerDoc('partner-rx-real', 'openid-rx-real-p', 'PABC236'),
      partnerDoc('partner-rx-test', 'TEST-RXTESTPARTNER', 'PTEST23')
    ]);
    const realToTest = await apiOf(rxDb, 'openid-rx-real-c')
      .call('bind.create', { partnerNo: 'PTEST23' }, { clientRequestId: 'bind-a-000000000004' });
    t.eq(realToTest.code, 'FORBIDDEN', 'A7 真实顾客×测试兼职 → FORBIDDEN');
    const testToReal = await apiOf(rxDb, 'TEST-RXTESTCUSTOMER')
      .call('bind.create', { partnerNo: 'PABC236' }, { clientRequestId: 'bind-a-000000000005' });
    t.eq(testToReal.code, 'FORBIDDEN', 'A8 测试顾客×真实兼职 → FORBIDDEN（双向隔离）');
    t.eq(rxDb.dump('bindings').length, 0, 'A9 真实×测试双向零写入（隔离是拒绝不是事后清理）');
    t.notEmpty(db.dump('partners'), 'A 组样本非空');
  });

  // ---------------------------------------------------------------- B 编号归一 / 错前缀同源提示
  asyncSection('B. 编号归一与错前缀提示（p-7k2-m9x/全角归一；C→顾客号、DEV→开发者号、其余→格式；两处同源）', async (t) => {
    // B1-B2 归一：小写带横杠与全角写法都应命中同一个兼职编号
    const normDb = createTestDb();
    normDb.seed('users', [userDoc('openid-b-c', [ROLES.CUSTOMER])]);
    normDb.seed('customers', [customerDoc('openid-b-c')]);
    normDb.seed('partners', [partnerDoc('partner-b-1', 'openid-b-p', 'P7K2M9X')]);
    const normApi = apiOf(normDb, 'openid-b-c');
    const normFirst = await normApi.call('bind.create', { partnerNo: 'p-7k2-m9x' }, { clientRequestId: 'bind-b-000000000001' });
    t.check(normFirst.ok === true && normFirst.data.binding && !!normFirst.data.partnerPublic,
      'B1 p-7k2-m9x（小写+横杠）归一大写去横杠后命中同一兼职，绑定成功');
    const normSecond = await normApi.call('bind.create', { partnerNo: 'Ｐ－７Ｋ２－Ｍ９Ｘ' }, { clientRequestId: 'bind-b-000000000002' });
    t.check(normSecond.ok === true && normSecond.data.duplicated === true,
      'B2 全角形式归一后仍是同一兼职（同顾客幂等 duplicated=true，不重复绑定）');

    // B3-B7 bind.create 侧错前缀：文案必须逐字等于 error-copy.PREFIX_HINT（同源单点）
    const errDb = createTestDb();
    errDb.seed('users', [userDoc('openid-b-err-c', [ROLES.CUSTOMER])]);
    errDb.seed('customers', [customerDoc('openid-b-err-c')]);
    errDb.seed('partners', [partnerDoc('partner-b-err', 'openid-b-err-p', 'P7K2M9X')]);
    const errApi = apiOf(errDb, 'openid-b-err-c');
    const customerPrefix = await errApi.call('bind.create', { partnerNo: 'C-7K2M-9QX4' },
      { clientRequestId: 'bind-b-000000000003' });
    t.check(customerPrefix.code === 'VALIDATION_FAILED' && customerPrefix.message === errorCopy.PREFIX_HINT.CUSTOMER_PREFIX,
      'B3 bind.create 输入顾客编号（C 开头）→ VALIDATION_FAILED 且 message === PREFIX_HINT.CUSTOMER_PREFIX');
    const developerPrefix = await errApi.call('bind.create', { partnerNo: 'DEV-01' },
      { clientRequestId: 'bind-b-000000000004' });
    t.check(developerPrefix.code === 'VALIDATION_FAILED' && developerPrefix.message === errorCopy.PREFIX_HINT.DEVELOPER_PREFIX,
      'B4 bind.create 输入开发者编号（DEV）→ message === PREFIX_HINT.DEVELOPER_PREFIX');
    const formatBad = await errApi.call('bind.create', { partnerNo: 'P-ABC' },
      { clientRequestId: 'bind-b-000000000005' });
    t.check(formatBad.code === 'VALIDATION_FAILED' && formatBad.message === errorCopy.PREFIX_HINT.FORMAT,
      'B5 bind.create 前缀对但长度/字符错（P-ABC）→ message === PREFIX_HINT.FORMAT');
    const formatGarbage = await errApi.call('bind.create', { partnerNo: 'XXXX' },
      { clientRequestId: 'bind-b-000000000006' });
    t.check(formatGarbage.code === 'VALIDATION_FAILED' && formatGarbage.message === errorCopy.PREFIX_HINT.FORMAT,
      'B6 bind.create 乱码（XXXX）→ message === PREFIX_HINT.FORMAT');
    t.eq([customerPrefix.data && customerPrefix.data.field, developerPrefix.data && developerPrefix.data.field,
      formatBad.data && formatBad.data.field, formatGarbage.data && formatGarbage.data.field],
    ['partnerNo', 'partnerNo', 'partnerNo', 'partnerNo'], 'B7 四种错前缀均 data.field=partnerNo（页面可标字段）');
    t.eq(errDb.dump('bindings').length, 0, 'B8 错前缀请求零写入');

    // B9-B13 partner.getPublic 同口径（限流 5 次/日/身份：同库恰好 5 次调用，乱码另起新库）
    const pubDb = createTestDb();
    pubDb.seed('users', [userDoc('openid-b-pub-c', [ROLES.CUSTOMER])]);
    pubDb.seed('partners', [partnerDoc('partner-b-pub', 'openid-b-pub-p', 'P7K2M9X')]);
    const pubApi = apiOf(pubDb, 'openid-b-pub-c');
    const pubNorm = await pubApi.call('partner.getPublic', { partnerNo: 'p-7k2-m9x' });
    t.check(pubNorm.ok === true && pubNorm.data.partnerNo === 'P7K2M9X',
      'B9 getPublic 同样归一：p-7k2-m9x 命中 P7K2M9X');
    const pubCustomerPrefix = await pubApi.call('partner.getPublic', { partnerNo: 'C-7K2M-9QX4' });
    t.check(pubCustomerPrefix.code === 'VALIDATION_FAILED'
      && pubCustomerPrefix.message === errorCopy.PREFIX_HINT.CUSTOMER_PREFIX,
    'B10 getPublic 顾客编号 → PREFIX_HINT.CUSTOMER_PREFIX（与 bind.create 同源）');
    const pubDeveloper = await pubApi.call('partner.getPublic', { partnerNo: 'DEV-01' });
    t.check(pubDeveloper.code === 'VALIDATION_FAILED'
      && pubDeveloper.message === errorCopy.PREFIX_HINT.DEVELOPER_PREFIX,
    'B11 getPublic 开发者编号 → PREFIX_HINT.DEVELOPER_PREFIX');
    const pubFormat = await pubApi.call('partner.getPublic', { partnerNo: 'P-ABC' });
    t.check(pubFormat.code === 'VALIDATION_FAILED' && pubFormat.message === errorCopy.PREFIX_HINT.FORMAT,
      'B12 getPublic 格式错 → PREFIX_HINT.FORMAT');
    t.eq([pubCustomerPrefix.message === customerPrefix.message, pubDeveloper.message === developerPrefix.message,
      pubFormat.message === formatBad.message], [true, true, true],
    'B13 两处（bind.create / partner.getPublic）同输入同文案同源，不各写一份');
    const pubGarbageDb = createTestDb();
    pubGarbageDb.seed('users', [userDoc('openid-b-garbage-c', [ROLES.CUSTOMER])]);
    const pubGarbage = await apiOf(pubGarbageDb, 'openid-b-garbage-c').call('partner.getPublic', { partnerNo: 'XXXX' });
    t.check(pubGarbage.code === 'VALIDATION_FAILED' && pubGarbage.message === errorCopy.PREFIX_HINT.FORMAT,
      'B14 getPublic 乱码 → PREFIX_HINT.FORMAT');
    t.check([customerPrefix.message, pubCustomerPrefix.message].every((message) => message.indexOf('不存在') === -1),
      'B15 错前缀文案只描述格式、不暴露编号是否存在');
  });

  // ---------------------------------------------------------------- C roomTag
  asyncSection('C. roomTag 分配（A→B / 换 dormKey 从 A / 只增不复用 / tagKey 唯一索引）', async (t) => {
    const db = createTestDb();
    db.seed('users', [
      userDoc('openid-c-1', [ROLES.CUSTOMER]),
      userDoc('openid-c-2', [ROLES.CUSTOMER]),
      userDoc('openid-c-3', [ROLES.CUSTOMER]),
      userDoc('openid-c-p', [ROLES.PARTNER])
    ]);
    db.seed('customers', [
      customerDoc('openid-c-1'),
      customerDoc('openid-c-2', { customerNo: 'CABCDEFGJ' }),
      customerDoc('openid-c-3', { customerNo: 'CABCDEFGK', zone: 'D', buildingNo: 5, room: '610', dormKey: 'D5-610' })
    ]);
    db.seed('partners', [partnerDoc('partner-c-1', 'openid-c-p', 'PABC23D')]);

    const bind1 = await apiOf(db, 'openid-c-1').call('bind.create', { partnerNo: 'PABC23D' },
      { clientRequestId: 'bind-c-000000000001' });
    const bind2 = await apiOf(db, 'openid-c-2').call('bind.create', { partnerNo: 'PABC23D' },
      { clientRequestId: 'bind-c-000000000002' });
    const bind3 = await apiOf(db, 'openid-c-3').call('bind.create', { partnerNo: 'PABC23D' },
      { clientRequestId: 'bind-c-000000000003' });
    t.eq([bind1.data.binding.roomTag, bind2.data.binding.roomTag, bind3.data.binding.roomTag], ['A', 'B', 'A'],
      'C1/C2/C3 同（兼职,dormKey）首单 A、次单 B；另一 dormKey 重新从 A');
    t.check([bind1.data.binding.roomTag, bind2.data.binding.roomTag, bind3.data.binding.roomTag]
      .every((tag) => /^[A-Z]+$/.test(tag)), 'C4 roomTag 全部匹配 /^[A-Z]+$/（恒大写，无数字/小写）');

    const release1 = await apiOf(db, 'openid-c-1').call('bind.release', { reason: 'CUSTOMER_INITIATED' },
      { clientRequestId: 'bind-c-000000000004' });
    t.check(release1.ok === true && release1.data.duplicated === false, 'C5 释放基线：bind.release 成功 duplicated=false');
    const rebind1 = await apiOf(db, 'openid-c-1').call('bind.create', { partnerNo: 'PABC23D' },
      { clientRequestId: 'bind-c-000000000005' });
    t.eq(rebind1.data.binding.roomTag, 'C', 'C6 释放后再绑 → C（计数器只增，旧 A/B 不复用）');
    const tagCounter = db.dump('counters').filter((row) => row.key === 'tag:partner-c-1:D4-522')[0];
    t.eq(tagCounter && tagCounter.seq, 3, 'C7 counters(tag:partnerId:dormKey) 单调递增到 3（旧 tag 不复用）');
    t.eq(db.dump('bindings').filter((row) => row.status === BINDING_STATUS.ACTIVE).length, 3,
      'C8 当前 ACTIVE 绑定 3 条（两顾客 + 释放后重绑）');

    // tagKey 唯一索引真拦重复写：两次 add 同一 tagKey，第二次必须抛唯一冲突（不是静默重复）
    const dao = createDao(db);
    const tagKey = 'partner-c-1:D9-999:A';
    let duplicateError = null;
    try {
      await dao.add(COLLECTIONS.BINDINGS, bindingDoc('binding-c-dup', 'openid-c-dup', 'partner-c-1', {
        activeKey: 'openid-c-dup', tagKey
      }));
      await dao.add(COLLECTIONS.BINDINGS, bindingDoc('binding-c-dup2', 'openid-c-dup2', 'partner-c-1', {
        activeKey: 'openid-c-dup2', tagKey
      }));
    } catch (error) {
      duplicateError = error;
    }
    t.check(!!duplicateError && dao.isDuplicateError(duplicateError),
      'C9 tagKey 唯一索引：重复写抛唯一冲突（并发重复分配被 DB 兜底，不静默重复）');
    t.eq(db.dump('bindings').filter((row) => row.tagKey === tagKey && row._id.indexOf('binding-c-dup') === 0).length, 1,
      'C10 冲突后只留 1 条（第二次 add 未落库）');
  });

  // ---------------------------------------------------------------- D 换绑 / 换宿舍
  asyncSection('D. 换绑与换宿舍（未 release CONFLICT；release 后换绑；换宿舍旧绑定 RELEASED+新绑定）', async (t) => {
    const db = createTestDb();
    db.seed('users', [
      userDoc('openid-d-c', [ROLES.CUSTOMER]),
      userDoc('openid-d-p1', [ROLES.PARTNER]),
      userDoc('openid-d-p2', [ROLES.PARTNER])
    ]);
    db.seed('customers', [customerDoc('openid-d-c')]);
    db.seed('partners', [
      partnerDoc('partner-d-1', 'openid-d-p1', 'PABC23E'),
      partnerDoc('partner-d-2', 'openid-d-p2', 'PABC23F')
    ]);
    const dApi = apiOf(db, 'openid-d-c');
    const first = await dApi.call('bind.create', { partnerNo: 'PABC23E' }, { clientRequestId: 'bind-d-000000000001' });
    t.check(first.ok === true && first.data.binding.roomTag === 'A', 'D1 基线：绑定兼职 1，roomTag=A');
    const changeWithoutRelease = await dApi.call('bind.create', { partnerNo: 'PABC23F' },
      { clientRequestId: 'bind-d-000000000002' });
    t.eq(changeWithoutRelease.code, 'CONFLICT', 'D2 未 release 换绑另一兼职 → CONFLICT（换绑必须先解绑）');
    await dApi.call('bind.release', { reason: 'CUSTOMER_INITIATED' }, { clientRequestId: 'bind-d-000000000003' });
    const changeAfterRelease = await dApi.call('bind.create', { partnerNo: 'PABC23F' },
      { clientRequestId: 'bind-d-000000000004' });
    t.check(changeAfterRelease.ok === true && changeAfterRelease.data.binding.roomTag === 'A',
      'D3 release 后换绑成功，新兼职的 roomTag 重新从 A 分配');
    const dRows = db.dump('bindings');
    t.eq([dRows.filter((row) => row.status === BINDING_STATUS.ACTIVE).length,
      dRows.filter((row) => row.status === BINDING_STATUS.RELEASED).length], [1, 1],
    'D4 换绑后恰 1 条 ACTIVE + 1 条 RELEASED（历史行保留，不物理删除）');

    // 换宿舍：无进行中订单 → 事务内旧 ACTIVE 变 RELEASED + 新 binding（新 dormKey、新 roomTag）
    const dormDb = createTestDb();
    dormDb.seed('users', [userDoc('openid-d-dorm-c', [ROLES.CUSTOMER]), userDoc('openid-d-dorm-p', [ROLES.PARTNER])]);
    dormDb.seed('customers', [customerDoc('openid-d-dorm-c')]);
    dormDb.seed('partners', [partnerDoc('partner-d-dorm', 'openid-d-dorm-p', 'PABC23G')]);
    const dormApi = apiOf(dormDb, 'openid-d-dorm-c');
    await dormApi.call('bind.create', { partnerNo: 'PABC23G' }, { clientRequestId: 'bind-d-000000000005' });
    const moveDorm = await dormApi.call('customer.saveProfile', { zone: 'D', buildingNo: 5, room: '610' },
      { clientRequestId: 'bind-d-000000000006' });
    t.check(moveDorm.ok === true && moveDorm.data.binding && moveDorm.data.binding.dormKey === 'D5-610',
      'D5 换宿舍成功：返回新绑定 dormKey=D5-610');
    t.eq(moveDorm.data.binding.roomTag, 'A', 'D6 换宿舍后 roomTag 按新 dormKey 重新分配（A）');
    const dormRows = dormDb.dump('bindings');
    const oldRow = dormRows.filter((row) => row.status === BINDING_STATUS.RELEASED)[0];
    const newRow = dormRows.filter((row) => row.status === BINDING_STATUS.ACTIVE)[0];
    t.check(!!oldRow && oldRow.dormSnapshot && oldRow.dormSnapshot.dormKey === 'D4-522'
      && oldRow.releaseNote === '换宿舍', 'D7 旧 binding 行保留且 RELEASED（dormSnapshot 仍是旧 D4-522）');
    t.check(!!newRow && newRow.dormSnapshot.dormKey === 'D5-610' && newRow.tagKey.indexOf(':D5-610:') !== -1,
      'D8 新 binding 用新 dormKey/tagKey（旧行不覆盖）');
    t.eq(dormDb.dump('customers').filter((row) => row._id === 'openid-d-dorm-c')[0].dormKey, 'D5-610',
      'D9 顾客资料 dormKey 同步更新为 D5-610');

    // 有进行中订单：换宿舍 → INVALID_STATE 且零新写入
    const orderDb = createTestDb();
    orderDb.seed('users', [userDoc('openid-d-order-c', [ROLES.CUSTOMER]), userDoc('openid-d-order-p', [ROLES.PARTNER])]);
    orderDb.seed('customers', [customerDoc('openid-d-order-c')]);
    orderDb.seed('partners', [partnerDoc('partner-d-order', 'openid-d-order-p', 'PABC23H')]);
    orderDb.seed('bindings', [bindingDoc('binding-d-order', 'openid-d-order-c', 'partner-d-order')]);
    orderDb.seed('orders', [orderDoc('order-d-active', 'openid-d-order-c', 'partner-d-order', 'openid-d-order-p')]);
    const blockedMove = await apiOf(orderDb, 'openid-d-order-c')
      .call('customer.saveProfile', { zone: 'D', buildingNo: 5, room: '610' }, { clientRequestId: 'bind-d-000000000007' });
    t.eq(blockedMove.code, 'INVALID_STATE', 'D10 有进行中订单时换宿舍 → INVALID_STATE');
    t.eq(orderDb.dump('bindings').length, 1, 'D11 拒绝后不发新绑定（仍 1 条）');
    const blockedBinding = orderDb.dump('bindings')[0];
    t.eq([blockedBinding.status, blockedBinding.dormSnapshot.dormKey], [BINDING_STATUS.ACTIVE, 'D4-522'],
      'D12 拒绝后旧绑定不变（ACTIVE/D4-522）');
    t.eq(orderDb.dump('customers').filter((row) => row._id === 'openid-d-order-c')[0].dormKey, 'D4-522',
      'D13 拒绝后顾客 dormKey 不变（事务未提交）');
  });

  // ---------------------------------------------------------------- E 解绑 / 失联
  asyncSection('E. 解绑与失联（原因必填/非法/超长；RELEASED 历史键；重复幂等；进行中订单拒绝；兼职解绑+通知）', async (t) => {
    const db = createTestDb();
    db.seed('users', [userDoc('openid-e-c', [ROLES.CUSTOMER]), userDoc('openid-e-p', [ROLES.PARTNER])]);
    db.seed('customers', [customerDoc('openid-e-c')]);
    db.seed('partners', [partnerDoc('partner-e-1', 'openid-e-p', 'PABC23J')]);
    const eApi = apiOf(db, 'openid-e-c');
    await eApi.call('bind.create', { partnerNo: 'PABC23J' }, { clientRequestId: 'bind-e-000000000001' });
    const missingReason = await eApi.call('bind.release', {}, { clientRequestId: 'bind-e-000000000002' });
    t.check(missingReason.code === 'VALIDATION_FAILED' && missingReason.data && missingReason.data.field === 'reason',
      'E1 缺 reason → VALIDATION_FAILED(field=reason)');
    const invalidReason = await eApi.call('bind.release', { reason: 'NOT_A_REASON' },
      { clientRequestId: 'bind-e-000000000003' });
    t.check(invalidReason.code === 'VALIDATION_FAILED' && invalidReason.data
      && invalidReason.data.field === 'reason', 'E2 非法枚举 reason → VALIDATION_FAILED(field=reason)');
    const longNote = await eApi.call('bind.release', { reason: 'CUSTOMER_INITIATED', note: 'x'.repeat(101) },
      { clientRequestId: 'bind-e-000000000004' });
    t.check(longNote.code === 'VALIDATION_FAILED' && longNote.data && longNote.data.field === 'note',
      'E3 note>100 → VALIDATION_FAILED(field=note)');
    t.eq(db.dump('bindings').filter((row) => row.status === BINDING_STATUS.ACTIVE).length, 1,
      'E4 三次非法请求后绑定仍 ACTIVE（校验失败零写入）');
    const released = await eApi.call('bind.release', { reason: 'CUSTOMER_INITIATED' },
      { clientRequestId: 'bind-e-000000000005' });
    t.check(released.ok === true && released.data.releaseReason === 'CUSTOMER_INITIATED',
      'E5 合法解绑成功，回 releaseReason');
    const releasedRow = db.dump('bindings').filter((row) => row.status === BINDING_STATUS.RELEASED)[0];
    t.eq([releasedRow.releasedBy, releasedRow.releaseNote], ['CUSTOMER', ''], 'E6 解绑记 releasedBy=CUSTOMER');
    t.eq(releasedRow.activeKey, 'openid-e-c:RELEASED:' + releasedRow._id,
      'E7 activeKey 改为 customerId:RELEASED:_id（历史键，保证一顾客仅一条 ACTIVE）');
    t.eq(db.dump('bindings').filter((row) => row.status === BINDING_STATUS.ACTIVE).length, 0,
      'E8 解绑后零 ACTIVE（解绑即失联）');
    const repeat = await eApi.call('bind.release', { reason: 'CUSTOMER_INITIATED' },
      { clientRequestId: 'bind-e-000000000006' });
    t.check(repeat.ok === true && repeat.data.duplicated === true, 'E9 重复 release 幂等 duplicated=true');

    // 有进行中订单 → 拒绝解绑
    const orderDb = createTestDb();
    orderDb.seed('users', [userDoc('openid-e-order-c', [ROLES.CUSTOMER]), userDoc('openid-e-order-p', [ROLES.PARTNER])]);
    orderDb.seed('customers', [customerDoc('openid-e-order-c')]);
    orderDb.seed('partners', [partnerDoc('partner-e-order', 'openid-e-order-p', 'PABC23K')]);
    orderDb.seed('bindings', [bindingDoc('binding-e-order', 'openid-e-order-c', 'partner-e-order')]);
    orderDb.seed('orders', [orderDoc('order-e-active', 'openid-e-order-c', 'partner-e-order', 'openid-e-order-p')]);
    const blockedRelease = await apiOf(orderDb, 'openid-e-order-c')
      .call('bind.release', { reason: 'CUSTOMER_INITIATED' }, { clientRequestId: 'bind-e-000000000007' });
    t.eq(blockedRelease.code, 'INVALID_STATE', 'E10 有进行中订单 → 拒绝解绑 INVALID_STATE');
    t.eq(orderDb.dump('bindings')[0].status, BINDING_STATUS.ACTIVE, 'E11 拒绝后绑定仍 ACTIVE');

    // partner.unbindCustomer：非本人 NOT_FOUND / 成功写通知 / 重复 duplicated
    const pubDb = createTestDb();
    pubDb.seed('users', [
      userDoc('openid-e-pub-p', [ROLES.PARTNER]),
      userDoc('openid-e-pub-p2', [ROLES.PARTNER]),
      userDoc('openid-e-pub-c', [ROLES.CUSTOMER])
    ]);
    pubDb.seed('partners', [
      partnerDoc('partner-e-pub', 'openid-e-pub-p', 'PABC23L'),
      partnerDoc('partner-e-pub2', 'openid-e-pub-p2', 'PABC23M')
    ]);
    pubDb.seed('customers', [customerDoc('openid-e-pub-c')]);
    pubDb.seed('bindings', [
      bindingDoc('binding-e-mine', 'openid-e-pub-c', 'partner-e-pub'),
      bindingDoc('binding-e-other', 'openid-e-pub-c2', 'partner-e-pub2', { activeKey: 'openid-e-pub-c2', tagKey: 'partner-e-pub2:D4-522:A' })
    ]);
    const pubApi = apiOf(pubDb, 'openid-e-pub-p');
    const notMine = await pubApi.call('partner.unbindCustomer', { bindingId: 'binding-e-other', reason: 'PARTNER_INITIATED' },
      { clientRequestId: 'bind-e-000000000008' });
    t.eq(notMine.code, 'FORBIDDEN', 'E12 partner.unbindCustomer 非本人 binding → FORBIDDEN（DATA_MODEL §7.4：不泄露绑定存在性）');
    const unbind = await pubApi.call('partner.unbindCustomer', { bindingId: 'binding-e-mine', reason: 'PARTNER_INITIATED' },
      { clientRequestId: 'bind-e-000000000009' });
    t.check(unbind.ok === true && unbind.data.duplicated === false && unbind.data.releaseReason === 'PARTNER_INITIATED',
      'E13 兼职解绑本人 binding 成功');
    const messages = pubDb.dump('order_messages');
    t.eq(messages.length, 1, 'E14 解绑成功写 1 条站内通知（order_messages）');
    t.check(messages[0].templateCode === 'BIND_RELEASED' && messages[0].fromRole === 'PARTNER'
      && messages[0].text.indexOf('解除') !== -1, 'E15 通知 templateCode=BIND_RELEASED 且为兼职发起');
    const repeatUnbind = await pubApi.call('partner.unbindCustomer', { bindingId: 'binding-e-mine', reason: 'PARTNER_INITIATED' },
      { clientRequestId: 'bind-e-000000000010' });
    t.check(repeatUnbind.ok === true && repeatUnbind.data.duplicated === true, 'E16 重复解绑幂等 duplicated=true');
    t.eq(pubDb.dump('order_messages').length, 1, 'E17 重复解绑不重复发通知');

    // 兼职解绑：有进行中订单 → INVALID_STATE
    const unbindOrderDb = createTestDb();
    unbindOrderDb.seed('users', [userDoc('openid-e-uo-p', [ROLES.PARTNER]), userDoc('openid-e-uo-c', [ROLES.CUSTOMER])]);
    unbindOrderDb.seed('partners', [partnerDoc('partner-e-uo', 'openid-e-uo-p', 'PABC23N')]);
    unbindOrderDb.seed('customers', [customerDoc('openid-e-uo-c')]);
    unbindOrderDb.seed('bindings', [bindingDoc('binding-e-uo', 'openid-e-uo-c', 'partner-e-uo')]);
    unbindOrderDb.seed('orders', [orderDoc('order-e-uo', 'openid-e-uo-c', 'partner-e-uo', 'openid-e-uo-p')]);
    const unbindBlocked = await apiOf(unbindOrderDb, 'openid-e-uo-p')
      .call('partner.unbindCustomer', { bindingId: 'binding-e-uo', reason: 'PARTNER_INITIATED' },
        { clientRequestId: 'bind-e-000000000011' });
    t.eq(unbindBlocked.code, 'INVALID_STATE', 'E18 兼职解绑时有进行中订单 → INVALID_STATE');
    t.eq(unbindOrderDb.dump('bindings')[0].status, BINDING_STATUS.ACTIVE, 'E19 拒绝后绑定仍 ACTIVE');
  });

  // ---------------------------------------------------------------- F getPublic / DTO 读屏蔽
  asyncSection('F. getPublic/DTO 读屏蔽（绑定前无头像；绑定后有；解绑后清空；测试账号与 PARTNER 边界）', async (t) => {
    const db = createTestDb();
    const avatar = 'cloud://env/avatars/partner/BBBBBBBBBBBBBBBB.jpg';
    db.seed('users', [userDoc('openid-f-c', [ROLES.CUSTOMER]), userDoc('openid-f-p', [ROLES.PARTNER])]);
    db.seed('customers', [customerDoc('openid-f-c', { avatarFileId: 'cloud://env/avatars/customer/CCCCCCCCCCCCCCCC.jpg' })]);
    db.seed('partners', [partnerDoc('partner-f-1', 'openid-f-p', 'PABC23Q', { avatarFileId: avatar })]);
    const cApi = apiOf(db, 'openid-f-c');
    const preview = await cApi.call('partner.getPublic', { partnerNo: 'PABC23Q' });
    t.check(preview.ok === true && preview.data.displayName === '小李'
      && !Object.prototype.hasOwnProperty.call(preview.data, 'avatarFileId'),
    'F1 未绑定时 getPublic 只回昵称/服务信息，不含 avatarFileId（绑定前预览不回头像）');
    await cApi.call('bind.create', { partnerNo: 'PABC23Q' }, { clientRequestId: 'bind-f-000000000001' });
    const current = await cApi.call('bind.getCurrent', {});
    t.check(current.ok === true && current.data.binding && current.data.binding.roomTag === 'A',
      'F2 ACTIVE 绑定后 bind.getCurrent 回绑定摘要');
    t.check(!!current.data.partnerPublic && current.data.partnerPublic.avatarFileId === avatar
      && current.data.partnerPublic.displayName === '小李',
    'F3 绑定后 partnerPublic 含 avatarFileId + displayName（仅绑定对方可见）');
    await cApi.call('bind.release', { reason: 'CUSTOMER_INITIATED' }, { clientRequestId: 'bind-f-000000000002' });
    const afterRelease = await cApi.call('bind.getCurrent', {});
    t.check(afterRelease.ok === true && afterRelease.data.binding === null && afterRelease.data.partnerPublic === null,
      'F4 解绑后 bind.getCurrent → {binding:null,partnerPublic:null}（解绑即失联）');
    const partnerList = await apiOf(db, 'openid-f-p').call('partner.listBindings', {});
    t.check(partnerList.ok === true && Array.isArray(partnerList.data.list) && partnerList.data.list.length === 0,
      'F5 解绑后 partner.listBindings 列表不含 RELEASED 行');
    t.eq(db.dump('bindings').filter((row) => row.status === BINDING_STATUS.RELEASED).length, 1,
      'F6 RELEASED 历史行仍在库（列表过滤而非删除）');
    t.check(JSON.stringify(partnerList.data).indexOf('avatarFileId') === -1
      && JSON.stringify(partnerList.data).indexOf('CCCCCCCCCCCCCCCC') === -1,
    'F7 listBindings 响应零 avatarFileId（顾客头像不进兼职客户档案）');

    // 测试账号边界：真实顾客 → 测试兼职 NOT_FOUND；TEST_WRITE 会话 → 可预览
    const testDb = createTestDb();
    testDb.seed('users', [
      userDoc('openid-f-real-c', [ROLES.CUSTOMER]),
      userDoc('TEST-FTESTPARTNER', [ROLES.PARTNER], { isTestAccount: true, createdByDeveloperNo: 'DEV-01' }),
      userDoc('TEST-FTESTCUSTOMER', [ROLES.CUSTOMER], { isTestAccount: true, createdByDeveloperNo: 'DEV-01' }),
      userDoc(ADMIN_OPENID, [])
    ]);
    testDb.seed('customers', [
      customerDoc('TEST-FTESTCUSTOMER', { customerNo: 'CABCDEFGM' }),
      customerDoc('openid-f-real-c', { customerNo: 'CABCDEFGP' })
    ]);
    testDb.seed('partners', [partnerDoc('partner-f-test', 'TEST-FTESTPARTNER', 'PTEST24')]);
    testDb.seed('admin_view_sessions', [
      {
        _id: 'TK-F-TEST', requestKey: ADMIN_OPENID + ':vs-f-test', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01',
        viewMode: VIEW_MODE.TEST_WRITE, role: ROLES.CUSTOMER, targetId: 'TEST-FTESTCUSTOMER',
        targetNo: 'CABCDEFGM', targetIsTest: true, createdAt: NOW, expiresAt: NOW + 3600000, endedAt: 0
      },
      {
        _id: 'TK-F-RO', requestKey: ADMIN_OPENID + ':vs-f-ro', adminOpenid: ADMIN_OPENID, developerNo: 'DEV-01',
        viewMode: VIEW_MODE.READONLY, role: ROLES.CUSTOMER, targetId: 'openid-f-real-c',
        targetNo: 'CABCDEFGP', targetIsTest: false, createdAt: NOW, expiresAt: NOW + 3600000, endedAt: 0
      }
    ]);
    const realPreview = await apiOf(testDb, 'openid-f-real-c').call('partner.getPublic', { partnerNo: 'PTEST24' });
    t.eq(realPreview.code, 'NOT_FOUND', 'F8 真实顾客查测试兼职 → NOT_FOUND（测试账号对不同侧不可见）');
    // 说明：TEST_WRITE 路由白名单（middleware/switch-session.js 的 VIEW_READ_WHITELIST）当前未含
    // partner.getPublic，走 API 会在路由层被 FORBIDDEN；此处按 handler 口径验证 scope.testWrite=true
    // 的读屏蔽语义（与 getPublic 注释"仅同一 TEST_WRITE 会话内可预览"同源）。
    const testWriteCtx = {
      dao: createDao(testDb), ids: {}, now: NOW, env: ADMIN_ENV, cloud: cloudStub('pass'),
      openid: 'TEST-FTESTCUSTOMER',
      identity: {
        actorOpenid: ADMIN_OPENID, effectiveOpenid: 'TEST-FTESTCUSTOMER', role: ROLES.CUSTOMER,
        isTestAccount: true, viewMode: VIEW_MODE.TEST_WRITE, viewTicketId: 'TK-F-TEST', developerNo: 'DEV-01'
      },
      requestId: 'req-f-testwrite', clientRequestId: 'f-testwrite-0000000001',
      expectedVersion: undefined, config: {}
    };
    const testWritePreview = await require(path.join(API, 'handlers/partner/getPublic.js'))
      .handler(testWriteCtx, { partnerNo: 'PTEST24' });
    t.check(!!testWritePreview && testWritePreview.partnerNo === 'PTEST24',
      'F9 TEST_WRITE 会话（scope.testWrite=true）内可预览测试兼职（仅同一测试侧）');

    // 路由级：switch-session 中间件必须放行 TEST_WRITE 会话的 partner.getPublic（测试账号绑定流程要预览），
    // READONLY 会话仍 FORBIDDEN（真实账号只读视角不得暴露他人兼职资料）。
    const twState = makeMwState(makeMwCtx(testDb, ADMIN_OPENID), 'partner.getPublic', 'TK-F-TEST');
    let twError = null;
    try {
      await switchSession.middleware(twState);
    } catch (error) {
      twError = error;
    }
    t.check(!twError, 'F10a TEST_WRITE 会话 partner.getPublic 被 switch-session 放行（实际 '
      + (twError ? twError.code : 'FORBIDDEN 未抛出') + '）');
    t.eq([twState.ctx.identity.viewMode, twState.ctx.identity.effectiveOpenid],
      [VIEW_MODE.TEST_WRITE, 'TEST-FTESTCUSTOMER'], 'F10b TEST_WRITE 身份注入：viewMode=TEST_WRITE、effectiveOpenid=测试顾客');
    const roState = makeMwState(makeMwCtx(testDb, ADMIN_OPENID), 'partner.getPublic', 'TK-F-RO');
    let roError = null;
    try {
      await switchSession.middleware(roState);
    } catch (error) {
      roError = error;
    }
    t.eq(roError && roError.code, 'FORBIDDEN', 'F11 READONLY 会话 partner.getPublic 仍 FORBIDDEN（白名单只对 TEST_WRITE 开口）');

    // PARTNER 调 getPublic：bound 恒 false（即便该 openid 作为顾客存在 ACTIVE 绑定）
    const dualDb = createTestDb();
    dualDb.seed('users', [userDoc('openid-f-dual', [ROLES.PARTNER]), userDoc('openid-f-dual-p2', [ROLES.PARTNER])]);
    dualDb.seed('customers', [customerDoc('openid-f-dual')]);
    dualDb.seed('partners', [
      partnerDoc('partner-f-dual-2', 'openid-f-dual-p2', 'PABC23R',
        { avatarFileId: 'cloud://env/avatars/partner/DDDDDDDDDDDDDDDD.jpg' })
    ]);
    dualDb.seed('bindings', [bindingDoc('binding-f-dual', 'openid-f-dual', 'partner-f-dual-2')]);
    const partnerView = await apiOf(dualDb, 'openid-f-dual').call('partner.getPublic', { partnerNo: 'PABC23R' });
    t.check(partnerView.ok === true && !Object.prototype.hasOwnProperty.call(partnerView.data, 'avatarFileId'),
      'F12 PARTNER 调 getPublic：bound 恒 false（不因顾客侧绑定命中而回头像）');
  });

  // ---------------------------------------------------------------- G 接单开关
  asyncSection('G. 接单开关（acceptingOrders=false → order.create PARTNER_CLOSED；true 基线可建单）', async (t) => {
    const db = createTestDb();
    db.seed('users', [
      userDoc('openid-g-c', [ROLES.CUSTOMER]),
      userDoc('openid-g-p', [ROLES.PARTNER])
    ]);
    db.seed('customers', [customerDoc('openid-g-c')]);
    db.seed('partners', [partnerDoc('partner-g-1', 'openid-g-p', 'PABC23T')]);
    db.seed('bindings', [bindingDoc('binding-g-1', 'openid-g-c', 'partner-g-1')]);
    const cApi = apiOf(db, 'openid-g-c');
    const orderPayload = {
      parcels: [{ parcel: { stationId: 'P3', pickupCode: 'A12345', lockerNo: 'B-01', trackingTail: '12345' } }],
      serviceCode: SERVICE_CODES[0],
      note: '放门口',
      manualEntry: true
    };
    const created = await cApi.call('order.create', orderPayload, { clientRequestId: 'order-g-000000000001' });
    t.check(created.ok === true, 'G1 接单中（acceptingOrders=true）顾客下单基线成功（实际 code=' + created.code + '）');
    t.eq(db.dump('orders').length, 1, 'G2 基线订单落库 1 条');
    const pApi = apiOf(db, 'openid-g-p');
    const saved = await pApi.call('partner.saveServiceConfig', {
      services: [{ code: SERVICE_CODES[0], enabled: true }],
      zones: ['D', 'X', 'N', 'B', 'C'],
      acceptingOrders: false
    }, { clientRequestId: 'order-g-000000000002' });
    t.check(saved.ok === true && saved.data.serviceConfig.acceptingOrders === false,
      'G3 saveServiceConfig 落库 acceptingOrders=false');
    t.eq(db.dump('partners').filter((row) => row._id === 'partner-g-1')[0].serviceConfig.acceptingOrders, false,
      'G4 兼职文档 acceptingOrders 已持久化为 false');
    const closed = await cApi.call('order.create', Object.assign({}, orderPayload, { note: '再来一单' }),
      { clientRequestId: 'order-g-000000000003' });
    t.eq(closed.code, 'PARTNER_CLOSED', 'G5 兼职关闭接单后 order.create → PARTNER_CLOSED（服务端仍拦，非只置灰）');
    t.eq(db.dump('orders').length, 1, 'G6 被拦订单零写入（仍 1 条）');

    // 静态回归闸（G 组 P0 的同类）：全仓 cloudfunctions/**/*.js 去注释后不得出现小写集合键。
    // 正控/反例先证明扫描有牙，再扫真实仓库（空集不得判绿：先断言样本非空）。
    const controlHit = lowercaseCollectionKeyHitsInText(fsutil.stripComments(
      "ctx.dao.findOne(COLLECTIONS.orders, { where: { requestKey } });\n"
    ));
    t.eq(controlHit.length, 1, 'G7 正控：小写集合键 COLLECTIONS.orders 被扫描命中（扫描有牙）');
    const controlClean = lowercaseCollectionKeyHitsInText(fsutil.stripComments(
      'const a = COLLECTIONS.ORDERS;\n'
      + 'const b = ALL_COLLECTIONS.length;\n'
      + 'const c = ALL_COLLECTIONS.indexOf("orders");\n'
      + '// 注释里的 COLLECTIONS.orders 不算命中\n'
      + 'const d = COUNTERS.length;\n'
    ));
    t.eq(controlClean.length, 0, 'G8 反例：大写键/ALL_COLLECTIONS/注释内小写键均不误伤（不空集误报）');
    const cloudJsFiles = listCloudJs(path.join(ROOT, 'cloudfunctions'));
    t.check(cloudJsFiles.length > 100, 'G9 静态扫描样本非空（cloudfunctions/**/*.js 共 '
      + cloudJsFiles.length + ' 个）');
    t.eq(scanLowercaseCollectionKeys(cloudJsFiles), [],
      'G10 全仓 cloudfunctions/**/*.js 零小写集合键（COLLECTIONS.<小写> 会让 dao 抛未登记集合并收敛 INTERNAL_ERROR）');
  });

  // ---------------------------------------------------------------- H 事务冲突重试
  asyncSection('H. 事务冲突有界重试（lib/tx.js retryOnConflict：默认 3 次、只重试冲突、非冲突立即抛）', async (t) => {
    let txLib = null;
    try {
      txLib = require(path.join(API, 'lib/tx.js'));
    } catch (error) {
      txLib = null;
    }
    const H_ASSERTS = 19;
    if (!txLib) {
      for (let i = 0; i < H_ASSERTS; i += 1) {
        t.check(false, '待 cloud-core 落地 cloudfunctions/api/lib/tx.js（task-55）后复跑：H 组断言 #' + (i + 1));
      }
      return;
    }
    t.check(typeof txLib.isTransactionConflict === 'function' && typeof txLib.retryOnConflict === 'function',
      'H1 导出 isTransactionConflict + retryOnConflict 两个函数');
    t.check(txLib.isTransactionConflict({ errMsg: 'transaction conflict, please retry' }) === true
      && txLib.isTransactionConflict(new Error('plain boom')) === false,
    'H2 冲突判定：事务冲突形态 true、普通错误 false');
    const conflictError = () => {
      const error = new Error('transaction conflict');
      error.errMsg = 'transaction conflict';
      return error;
    };

    // retryOnConflict 纯行为：首次冲突 → 重试成功；成功即返回
    let calls = 0;
    const retryDao = {
      transaction: async (fn) => {
        calls += 1;
        if (calls === 1) {
          throw conflictError();
        }
        return fn({});
      }
    };
    const retried = await txLib.retryOnConflict(retryDao, async () => 'ok');
    t.eq(retried, 'ok', 'H3 首次事务冲突后重试成功并返回回调结果');
    t.eq(calls, 2, 'H4 冲突重试一次即可（调用计数 2）');
    let successCalls = 0;
    const successDao = {
      transaction: async (fn) => {
        successCalls += 1;
        return fn({});
      }
    };
    const firstTry = await txLib.retryOnConflict(successDao, async () => 'ok');
    t.eq([firstTry, successCalls], ['ok', 1], 'H5 无冲突时只调用 1 次（不无谓重试）');

    // 默认最多 3 次尝试
    let alwaysCalls = 0;
    const alwaysDao = {
      transaction: async () => {
        alwaysCalls += 1;
        throw conflictError();
      }
    };
    let alwaysError = null;
    try {
      await txLib.retryOnConflict(alwaysDao, async () => 'never');
    } catch (error) {
      alwaysError = error;
    }
    t.check(!!alwaysError, 'H6 持续冲突最终抛出（不无限重试）');
    t.eq(alwaysCalls, 3, 'H7 默认最多 3 次尝试（调用计数 3）');

    // 非冲突错误立即抛，不重试
    let fatalCalls = 0;
    const fatalDao = {
      transaction: async () => {
        fatalCalls += 1;
        throw new Error('plain boom');
      }
    };
    let fatalError = null;
    try {
      await txLib.retryOnConflict(fatalDao, async () => 'never');
    } catch (error) {
      fatalError = error;
    }
    t.check(!!fatalError && fatalError.message === 'plain boom', 'H8 非冲突错误原样抛出（不被吞/不转码）');
    t.eq(fatalCalls, 1, 'H9 非冲突错误不重试（transaction 调用计数=1）');

    // 包装 dao：首个事务抛冲突、后续走真 fake db → bind.create 成功且 roomTag 连续
    const db = createTestDb();
    db.seed('users', [
      userDoc('openid-h-c1', [ROLES.CUSTOMER]),
      userDoc('openid-h-c2', [ROLES.CUSTOMER]),
      userDoc('openid-h-p', [ROLES.PARTNER])
    ]);
    db.seed('customers', [
      customerDoc('openid-h-c1'),
      customerDoc('openid-h-c2', { customerNo: 'CABCDEFGN' })
    ]);
    db.seed('partners', [partnerDoc('partner-h-1', 'openid-h-p', 'PABC23U')]);
    const realDao = createDao(db);
    let flakyCalls = 0;
    const flakyDao = Object.assign({}, realDao, {
      transaction: async (fn) => {
        flakyCalls += 1;
        if (flakyCalls === 1) {
          throw conflictError();
        }
        return realDao.transaction(fn);
      }
    });
    const bindCreate = require(path.join(API, 'handlers/bind/create.js')).handler;
    const handlerCtx = (openid) => ({
      dao: flakyDao,
      ids: {},
      now: NOW,
      env: ADMIN_ENV,
      cloud: cloudStub('pass'),
      openid,
      identity: Object.assign(baseIdentity(openid), { role: ROLES.CUSTOMER }),
      requestId: 'req-h-' + openid,
      clientRequestId: 'h-handler-00000000001',
      expectedVersion: undefined,
      config: {}
    });
    const firstBinding = await bindCreate(handlerCtx('openid-h-c1'), { partnerNo: 'PABC23U' });
    t.check(!!firstBinding && firstBinding.binding && firstBinding.binding.roomTag === 'A',
      'H10 注入 1 次事务冲突后 bind.create 重试成功（roomTag=A）');
    t.eq(flakyCalls, 2, 'H11 冲突重试后事务调用计数=2（未把失败事务当成功）');
    const secondBinding = await bindCreate(handlerCtx('openid-h-c2'), { partnerNo: 'PABC23U' });
    t.eq(secondBinding.binding.roomTag, 'B', 'H12 重试不重复占号：第二顾客仍连续拿到 B');
    t.eq(db.dump('bindings').filter((row) => row.status === BINDING_STATUS.ACTIVE).length, 2,
      'H13 计数连续且绑定落库 2 条（失败事务已回滚）');

    // 非冲突错误：包装 dao 直接抛普通错误 → 不重试、零写入
    const fatalDb = createTestDb();
    fatalDb.seed('users', [
      userDoc('openid-h-fatal-c', [ROLES.CUSTOMER]),
      userDoc('openid-h-fatal-p', [ROLES.PARTNER])
    ]);
    fatalDb.seed('customers', [customerDoc('openid-h-fatal-c')]);
    fatalDb.seed('partners', [partnerDoc('partner-h-fatal', 'openid-h-fatal-p', 'PABC23V')]);
    const fatalRealDao = createDao(fatalDb);
    let fatalTxCalls = 0;
    const fatalWrappedDao = Object.assign({}, fatalRealDao, {
      transaction: async () => {
        fatalTxCalls += 1;
        throw new Error('plain boom');
      }
    });
    const fatalCtx = Object.assign(handlerCtx('openid-h-fatal-c'), { dao: fatalWrappedDao });
    let fatalBindError = null;
    try {
      await bindCreate(fatalCtx, { partnerNo: 'PABC23V' });
    } catch (error) {
      fatalBindError = error;
    }
    t.check(!!fatalBindError && fatalBindError.message === 'plain boom',
      'H14 非冲突错误在 handler 路径原样抛出');
    t.eq(fatalTxCalls, 1, 'H15 非冲突错误不重试（handler 路径事务调用计数=1）');
    t.eq(fatalDb.dump('bindings').length, 0, 'H16 非冲突失败零写入');
    t.check(fatalTxCalls === 1 && alwaysCalls === 3, 'H17 冲突/非冲突两条路径的重试边界不同（3 vs 1）');
    // 唯一索引冲突（幂等重放/并发重复）不是事务冲突：不得重试（否则幂等读回被延迟成 3 次回滚）
    const dupError = () => {
      const error = new Error('唯一索引冲突');
      error.errMsg = 'document.add:fail duplicate key error: bindings.activeKey';
      error.errCode = -502001;
      error.code = 'UNIQUE_CONFLICT';
      return error;
    };
    t.check(txLib.isTransactionConflict(dupError()) === false,
      'H18 唯一索引冲突不判为事务冲突（duplicate key / -502001 不继承事务重试）');
    let dupCalls = 0;
    const dupDao = {
      transaction: async () => {
        dupCalls += 1;
        throw dupError();
      }
    };
    let dupCaught = null;
    try {
      await txLib.retryOnConflict(dupDao, async () => 'never');
    } catch (error) {
      dupCaught = error;
    }
    t.check(!!dupCaught && dupCaught.code === 'UNIQUE_CONFLICT' && dupCalls === 1,
      'H19 唯一索引冲突不重试、原样抛出（调用计数=1，幂等分支不被延迟）');
    t.notEmpty(db.dump('users'), 'H 组样本非空');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-bind-cloud' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-bind-cloud');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
