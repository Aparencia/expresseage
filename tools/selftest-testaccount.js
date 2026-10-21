'use strict';
/**
 * tools/selftest-testaccount.js — 测试账号与测试数据隔离语义断言（S15；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §4.2  测试账号口径：合成 openid `TEST-<random>`（非空串、非微信、三集合同值、crypto 随机）
 *   §4.10 create/list（fake DB 端到端）：合成身份三处同值、默认头像/测试兼职全开、不消耗邀请码、
 *          配额超限 VALIDATION_FAILED、创建审计、重放幂等、列表只含本开发者
 *   §4.10 delete（fake DB 端到端）：dryRun 条数（含文件/会话）、双条件拒绝、真实订单/绑定引用 INVALID_STATE、
 *          级联删账号+资料+订单/事件/留言/绑定/失败+头像文件、会话 endedAt + END 审计、前后条数审计、重放幂等
 *   §4.10 purge（fake DB 端到端）：dryRun、二次确认、真实引用拒绝、保留账号/头像只清业务数据、
 *          失败原图删除、会话 endedAt + END 审计、TEST_DATA_PURGE 前后条数、重放幂等
 *   §2.10 配置出厂值/范围/公开子集（测试账号治理参数只给后台、不下发客户端）
 *   §2.5  orders.isTest 服务端派生（DTO 标记与 impersonatedBy；客户端传入不采信）
 *   §7.8  统计/列表/兼职统计排除测试数据（isTest 过滤；另单列测试计数）
 *   §10.4 清理语义：超期未使用测试账号只清业务数据、账号保留；级联 + 删文件 + 结束会话
 *   §0.5  隔离铁律：真实×测试互操作 FORBIDDEN；TEST_WRITE 只对测试账号签发/校验；只读模式目标必须非测试
 *   §5.6  本地存储不落 targetIsTest/viewMode/viewTicket（会话只在内存，冷启动丢失）
 *   §4.3  审计动作集合：TEST_ACCOUNT_CREATE/DELETE/TEST_DATA_PURGE 在册、旧名零残留
 *
 * 纪律：不 mock 全局 wx（storage 用注入平台替身）；样本非空、先合法基线再反例；
 *       旧审计名以拼接构造（门禁 #30 口径）；EXPECTED_ASSERTIONS 与实际精确相等。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const defaults = require(path.join(ROOT, 'config/defaults.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const audit = require(path.join(ROOT, 'shared/audit-actions.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));
const idGenerator = require(path.join(ROOT, 'cloudfunctions/api/lib/id-generator.js'));
const adminDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/_dto.js'));
const cleanupTestData = require(path.join(ROOT, 'cloudfunctions/cleanup/sweeps/testData.js'));
const fake = require(path.join(ROOT, 'tools/fake-db.js'));
const daoModule = require(path.join(ROOT, 'cloudfunctions/api/db/dao.js'));
const testAccountActions = require(path.join(ROOT, 'cloudfunctions/api/handlers/admin/testAccounts.js')).actions;

const EXPECTED_ASSERTIONS = 153;

// 旧审计名用拼接构造：本文件不出现旧名字面量（门禁 #30 / 文档纪律）
const LEGACY_AUDIT_PREFIX = 'VIEW' + '_' + 'AS' + '_';
// 合成 openid 形态：TEST- + 12 位 32 字母表（去掉易混 0/O/1/I）
const TEST_OPENID_PATTERN = /^TEST-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readTextIfExists(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

// 级联/文件/会话清理步骤可能按门禁 #18 拆分到 _test-account-ops.js；两处合并扫描（文件改名不脆断）
const TEST_ACCOUNT_OPS_SRC = [
  'cloudfunctions/api/handlers/admin/_test-accounts.js',
  'cloudfunctions/api/handlers/admin/_test-account-ops.js'
].map(readTextIfExists).join('\n');

const SRC = {
  testAccountsHelper: readText('cloudfunctions/api/handlers/admin/_test-accounts.js'),
  testAccountsHandler: readText('cloudfunctions/api/handlers/admin/testAccounts.js'),
  orderCreate: readText('cloudfunctions/api/handlers/order/_create.js'),
  stats: readText('cloudfunctions/api/handlers/admin/stats.js'),
  listOrders: readText('cloudfunctions/api/handlers/admin/listOrders.js'),
  cleanupStats: readText('cloudfunctions/cleanup/sweeps/stats.js'),
  cleanupTestData: readText('cloudfunctions/cleanup/sweeps/testData.js'),
  bindCreate: readText('cloudfunctions/api/handlers/bind/create.js'),
  partnerPublic: readText('cloudfunctions/api/handlers/partner/getPublic.js'),
  switchSession: readText('cloudfunctions/api/middleware/switch-session.js'),
  viewAsStart: readText('cloudfunctions/api/handlers/admin/viewAsStart.js'),
  dataModel: readText('docs/V4_DATA_MODEL.md')
};

// ── fake DB 端到端样本（四动作 handler 直调；不 mock 全局 wx）──────────────────
const TEST_NOW = Date.UTC(2026, 9, 22, 0, 0, 0);
const TEST_ADMIN = 'admin-openid';
const TEST_SESSION_ID = 'S'.repeat(enums.TOKEN_LENGTH);
const TEST_UNIQUE = {
  admin_view_sessions: [['requestKey']],
  customers: [['customerNo']],
  partners: [['partnerNo']],
  admin_audit: [['requestKey']],
  orders: [['orderNo'], ['requestKey']],
  bindings: [['activeKey']]
};

function testRequestKey(index) {
  return 'ABCDEFGHIJKLMNOPQRST' + String(2000 + index);
}

function testCtx(db, options) {
  const opts = options || {};
  const deleted = opts.deleted || [];
  const cloud = {
    deleteFile: async (payload) => {
      (payload && Array.isArray(payload.fileList) ? payload.fileList : []).forEach((fileId) => deleted.push(fileId));
      return { fileList: payload && payload.fileList };
    },
    openapi: {
      security: {
        msgSecCheck: async () => ({ result: { suggest: 'pass' } })
      }
    }
  };
  return {
    dao: daoModule.createDao(db),
    ids: {},
    now: TEST_NOW,
    env: {},
    cloud: cloud,
    openid: TEST_ADMIN,
    identity: {
      actorOpenid: TEST_ADMIN,
      effectiveOpenid: TEST_ADMIN,
      role: '',
      isTestAccount: false,
      viewMode: '',
      viewTicketId: '',
      developerNo: 'DEV-01'
    },
    requestId: 'req-testaccount-001',
    clientRequestId: opts.clientRequestId || testRequestKey(0),
    expectedVersion: undefined,
    config: {}
  };
}

async function testResult(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

function seedAdminUser(db) {
  const nowDate = new Date(TEST_NOW);
  db.seed('users', [
    {
      _id: TEST_ADMIN, roles: [], status: enums.USER_STATUS.ACTIVE, isTestAccount: false,
      createdByDeveloperNo: '', testLastUsedAt: 0, messageReadAt: 0, privacyConsent: null,
      deletionRequestedAt: 0, createdAt: nowDate, updatedAt: nowDate
    }
  ]);
}

function testCustomerDoc(openid, customerNo, displayName, avatarFileId) {
  const nowDate = new Date(TEST_NOW);
  return {
    _id: openid, customerNo: customerNo, displayName: displayName, avatarFileId: avatarFileId || '',
    zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', profileCompleted: true,
    createdAt: nowDate, updatedAt: nowDate
  };
}

function testPartnerDoc(id, openid, partnerNo, displayName, avatarFileId) {
  const nowDate = new Date(TEST_NOW);
  return {
    _id: id, openid: openid, partnerNo: partnerNo, displayName: displayName, avatarFileId: avatarFileId || '',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: { services: [], zones: [], acceptingOrders: true },
    stats: {}, createdAt: nowDate, updatedAt: nowDate
  };
}

function seedTestPair(db) {
  const nowDate = new Date(TEST_NOW);
  seedAdminUser(db);
  db.seed('users', [
    { _id: 'TEST-CUSTOMER01', roles: [enums.ROLES.CUSTOMER], status: enums.USER_STATUS.ACTIVE, isTestAccount: true, createdByDeveloperNo: 'DEV-01', testLastUsedAt: 0, createdAt: nowDate, updatedAt: nowDate },
    { _id: 'TEST-PARTNER01', roles: [enums.ROLES.PARTNER], status: enums.USER_STATUS.ACTIVE, isTestAccount: true, createdByDeveloperNo: 'DEV-01', testLastUsedAt: 0, createdAt: nowDate, updatedAt: nowDate },
    { _id: 'TEST-OTHERDEV01', roles: [enums.ROLES.CUSTOMER], status: enums.USER_STATUS.ACTIVE, isTestAccount: true, createdByDeveloperNo: 'DEV-02', testLastUsedAt: 0, createdAt: nowDate, updatedAt: nowDate }
  ]);
  db.seed('customers', [
    testCustomerDoc('TEST-CUSTOMER01', 'CABCD2222', '测试顾客', ''),
    testCustomerDoc('TEST-OTHERDEV01', 'CABCD3333', '他人测试顾客', '')
  ]);
  db.seed('partners', [
    testPartnerDoc('pp-test-1', 'TEST-PARTNER01', 'PTEST23', '测试兼职', '')
  ]);
}

function seedTestBusinessData(db, openid) {
  const nowDate = new Date(TEST_NOW);
  db.seed('orders', [
    { _id: 'o-test-1', orderNo: '20261021-0001', customerId: openid, customerOpenid: openid, partnerId: 'pp-test-1', partnerOpenid: 'TEST-PARTNER01', isTest: true, status: 'COMPLETED', requestKey: 'rq-1', createdAt: nowDate, updatedAt: nowDate }
  ]);
  db.seed('order_events', [{ _id: 'oe-1', orderId: 'o-test-1', type: 'ORDER_CREATED', requestKey: 'ev-1' }]);
  db.seed('order_messages', [{ _id: 'om-1', orderId: 'o-test-1', fromId: openid, text: '留言' }]);
  db.seed('bindings', [{ _id: 'b-test-1', customerId: openid, partnerId: 'pp-test-1', status: 'ACTIVE', activeKey: openid, roomTag: 'A' }]);
  db.seed('recognition_failures', [{ _id: 'f-test-1', failureNo: 'F-20261021-AAAAAA', uploaderOpenid: openid, fileId: 'cloud://failure-1.jpg', status: 'PENDING' }]);
  db.seed('upload_tickets', [{ _id: 'ut-1', ticket: 'UT-1', openid: openid, purpose: 'TICKET' }]);
  db.seed('admin_view_sessions', [{
    _id: TEST_SESSION_ID, requestKey: 'rk-session-1', adminOpenid: TEST_ADMIN, developerNo: 'DEV-01',
    viewMode: enums.VIEW_MODE.TEST_WRITE, role: enums.ROLES.CUSTOMER, targetId: openid,
    targetNo: 'CABCD2222', targetIsTest: true, createdAt: nowDate, expiresAt: TEST_NOW + 1800000, endedAt: null
  }]);
}

function register(h) {
  // ---------------------------------------------------------------- §4.2 合成账号口径
  h.section('§4.2 测试账号口径（合成 openid TEST-<random>，非空串）', (t) => {
    t.eq(defaults.TEST_ACCOUNT_TOTAL_MAX, 6, '每位开发者测试账号合计上限 6');
    t.eq(defaults.DEFAULT_CONFIG.testAccountMaxPerRole, 3, '每角色上限 3');
    t.eq(defaults.TEST_ACCOUNT_TOTAL_MAX, defaults.DEFAULT_CONFIG.testAccountMaxPerRole * 2,
      '合计上限 = 每角色上限 × 两类业务角色（自洽）');
    t.eq(defaults.CONFIG_LIMITS.testAccountMaxPerRole, { min: 1, max: 3 }, '每角色上限范围 1~3（后台不可放宽）');

    const samples = [];
    for (let i = 0; i < 60; i += 1) {
      samples.push(idGenerator.generateTestOpenid());
    }
    t.check(samples.every((openid) => openid.indexOf('TEST-') === 0), '合成 openid 一律 TEST- 前缀');
    t.check(samples.every((openid) => TEST_OPENID_PATTERN.test(openid)),
      '形态 TEST-<12 位 32 字母表>（非空串、不含 0/O/1/I）');
    t.check(new Set(samples).size === 60, '60 次生成两两不同（crypto 随机，非固定/非自增）');
    t.check(samples.every((openid) => openid.length === 17 && openid !== 'TEST-'), '长度 17、随机段非空');
    t.check(SRC.dataModel.indexOf('users._id=customers._id=partners.openid') !== -1,
      '契约：三集合同值合成 openid（非空串、不来自微信）');
    t.check(/const openid = idGenerator\.generateTestOpenid\(\)/.test(SRC.testAccountsHelper),
      '创建只从 crypto 生成合成 openid（不接受客户端传入的 openid）');
    t.check(SRC.testAccountsHelper.indexOf('_id: openid') !== -1
      && SRC.testAccountsHelper.indexOf('openid: openid') !== -1,
    '三处同值落地：users._id / customers._id / partners.openid');
    t.check(SRC.testAccountsHelper.indexOf('isTestAccount: true') !== -1
      && SRC.testAccountsHelper.indexOf('createdByDeveloperNo: scope.developerNo') !== -1,
    '创建即打 isTestAccount=true 并归属开发者（只能管自己创建的）');
  });

  // ---------------------------------------------------------------- §2.10 配置口径
  h.section('§2.10 配置出厂/范围/公开子集（治理参数不下发客户端）', (t) => {
    t.eq(defaults.DEFAULT_CONFIG.testDataRetentionDays, 30, '测试数据留存 30 天');
    t.check(defaults.PUBLIC_CONFIG_KEYS.indexOf('testAccountMaxPerRole') === -1
      && defaults.PUBLIC_CONFIG_KEYS.indexOf('testDataRetentionDays') === -1,
    '公开子集不含测试账号治理参数（每角色上限/留存天数不下发）');
    const publicConfig = defaults.pickPublicConfig(defaults.createDefaultConfig());
    t.check(publicConfig.testAccountMaxPerRole === undefined
      && publicConfig.testDataRetentionDays === undefined, 'config.getPublic 实际裁剪结果不含治理参数');
    t.check(typeof publicConfig.subscribeEnabled === 'boolean' && publicConfig.subscribeTemplates === undefined,
      '订阅只下发布尔开关（模板 ID 不下发）');
    t.eq(publicConfig.viewTicketTtlMinutes, defaults.DEFAULT_CONFIG.viewTicketTtlMinutes,
      '会话 TTL 下发（前端展示有效期）');
    const adminConfig = adminDto.configForAdmin(defaults.createDefaultConfig());
    t.check(adminConfig.testAccountMaxPerRole === 3 && adminConfig.testDataRetentionDays === 30,
      'admin 配置 DTO 才含治理参数（与公开子集对照，后台可调）');
  });

  // ---------------------------------------------------------------- §2.5 isTest 派生
  h.section('§2.5 orders.isTest 服务端派生（客户端传入不采信）', (t) => {
    const order = {
      orderNo: '20261021-0001',
      status: enums.ORDER_STATUS.DELIVERED,
      parcel: { pickupCode: '1234' },
      dorm: { zone: 'D', buildingNo: 4, room: '522' }
    };
    t.eq(adminDto.orderBrief(order, true).isTest, true, '后台 DTO：参与账号为测试 → isTest=true');
    t.eq(adminDto.orderBrief(order).isTest, false, '后台 DTO：默认 isTest=false（不把普通单当测试单）');
    t.eq(adminDto.orderDetail(Object.assign({}, order, { isTest: true, impersonatedBy: 'DEV-01' }), {})
      .impersonatedBy, 'DEV-01', '测试单 DTO 带 impersonatedBy（审计可追）');
    t.eq(adminDto.orderDetail(Object.assign({}, order, { isTest: false, impersonatedBy: 'DEV-01' }), {})
      .impersonatedBy, '', '真实单 DTO 零 impersonatedBy（真实用户永不返回测试写痕迹）');
    t.check(/const customerIsTest = !!\(customerUser && customerUser\.isTestAccount\)/.test(SRC.orderCreate)
      && /const partnerIsTest = !!\(partnerUser && partnerUser\.isTestAccount\)/.test(SRC.orderCreate),
    '下单：isTest 由参与账号 users.isTestAccount 派生');
    t.check(SRC.orderCreate.indexOf('isTest: opt.context.isTest === true') !== -1
      && SRC.orderCreate.indexOf('isTest: !!(partnerUser && partnerUser.isTestAccount)') !== -1,
    '写入点只落地派生值（不读客户端入参）');
    t.check(SRC.dataModel.indexOf('服务端按参与账号') !== -1 && SRC.dataModel.indexOf('客户端传入忽略') !== -1,
      '契约：isTest 服务端派生、客户端传入忽略');
  });

  // ---------------------------------------------------------------- §7.7 后台 DTO 脱敏（行为）
  h.section('§7.7 后台 DTO 脱敏（递归键集零 avatarFileId/openid；昵称/码/尾号打码）', (t) => {
    // 递归收集键名：L3/内部键即使藏在 binding/parcel 等嵌套对象里也必须被剥离
    const FORBIDDEN_KEYS = ['avatarFileId', 'openid', 'customerOpenid', 'partnerOpenid',
      'adminOpenid', 'uploaderOpenid', 'targetAvatarFileId'];
    function keysDeep(value, depth, acc) {
      const out = acc || [];
      if (!value || typeof value !== 'object' || (depth || 0) > 5) return out;
      Object.keys(value).forEach((key) => {
        out.push(key);
        keysDeep(value[key], (depth || 0) + 1, out);
      });
      return out;
    }
    const leakKeys = (value) => keysDeep(value).filter((key) => FORBIDDEN_KEYS.indexOf(key) !== -1);

    // 正控输入：raw doc 带 L3/内部字段（非空集；断言若失效这里先红）
    const rawCustomer = {
      _id: 'openid-raw-customer', customerNo: 'CABCD2222', displayName: '张三丰',
      avatarFileId: 'cloud://env/avatars/customer/AAAAAAAAAAAAAAAA.jpg',
      zone: 'D', buildingNo: 4, buildingNumber: 4, room: '522', dormKey: 'D4-522',
      phoneTail: '1234', profileCompleted: true, openid: 'openid-raw-customer',
      createdAt: new Date(TEST_NOW), updatedAt: new Date(TEST_NOW), deletedAt: null
    };
    const rawBinding = {
      _id: 'b-raw-1', customerId: rawCustomer._id, partnerId: 'pp-raw-1', status: 'ACTIVE', roomTag: 'A'
    };
    const rawPartner = {
      _id: 'pp-raw-1', openid: 'openid-raw-partner', partnerNo: 'PABCD23', displayName: '李四',
      avatarFileId: 'cloud://env/avatars/partner/BBBBBBBBBBBBBBBB.jpg', status: enums.PARTNER_STATUS.ACTIVE,
      serviceConfig: { services: [{ code: enums.SERVICE_CODES[0], enabled: true }], zones: ['D'], acceptingOrders: true },
      stats: { todayOrders: 1, totalOrders: 2, completedOrders: 1 },
      activatedAt: new Date(TEST_NOW), createdAt: new Date(TEST_NOW)
    };
    const rawOrder = {
      _id: 'o-raw-1', orderNo: '20261021-0003', status: enums.ORDER_STATUS.COMPLETED, source: 'CUSTOMER',
      service: { code: enums.SERVICE_CODES[0], name: '帮取快递' },
      dorm: { zone: 'D', buildingNo: 4, room: '522' },
      customerId: rawCustomer._id, customerOpenid: rawCustomer._id,
      partnerId: rawPartner._id, partnerOpenid: rawPartner.openid,
      customerNo: 'CABCD2222', partnerNo: 'PABCD23', isTest: true,
      parcel: {
        stationId: 'S1', stationName: '菜鸟驿站', pickupCode: '12345678',
        lockerNo: 'A-12', trackingTail: '5678', codeStatus: 'READY'
      },
      phoneTail: '1234', note: '放门口', image: { fileId: 'cloud://env/orders/o-raw-1/image.jpg' },
      createdAt: new Date(TEST_NOW), statusUpdatedAt: new Date(TEST_NOW)
    };
    t.check(keysDeep(rawCustomer).indexOf('avatarFileId') !== -1 && keysDeep(rawCustomer).indexOf('openid') !== -1,
      '正控样例确实带 avatarFileId/openid（断言不空转）');
    const boundBrief = adminDto.customerBrief(rawCustomer, { isTest: true, binding: rawBinding, partner: rawPartner });
    const boundDetail = adminDto.customerDetail(rawCustomer, { isTest: true, binding: rawBinding, partner: rawPartner });
    t.eq(leakKeys(boundBrief), [], 'customerBrief（含绑定）零 L3/内部键（avatarFileId/openid）');
    t.eq(leakKeys(boundDetail), [], 'customerDetail（含绑定/订单概览）零 L3/内部键');
    t.eq(leakKeys(adminDto.partnerBrief(rawPartner, { isTest: true })), [], 'partnerBrief 零 L3/内部键');
    t.eq(leakKeys(adminDto.orderBrief(rawOrder, true)), [], 'orderBrief 零 L3/内部键');
    const orderDetail = adminDto.orderDetail(rawOrder, {
      customerDisplayName: rawCustomer.displayName, partnerDisplayName: rawPartner.displayName, guestDisplayName: ''
    });
    t.eq(leakKeys(orderDetail), [], 'orderDetail 零 L3/内部键（截图只回 imageUploaded 布尔）');
    // 反例（判据有牙）：同一检测器对"注入式泄漏"必须判红
    t.eq(leakKeys(Object.assign({}, boundBrief, { avatarFileId: rawCustomer.avatarFileId })),
      ['avatarFileId'], '反例：DTO 注入 avatarFileId → 检测器判红（断言可证伪）');
    // 打码值逐项核对（脱敏不是"删字段"了事）
    t.eq(boundBrief.displayName, '张***', '昵称脱敏：首字 + ***');
    t.eq(boundBrief.phoneTail, '**34', '尾号仅后 2 位（带 ** 前缀）');
    t.eq(boundBrief.dorm, 'D4', '宿舍只到苑 + 楼栋（无房间号）');
    t.eq(boundDetail.binding.partnerDisplayName, '李***', '绑定对方昵称同样脱敏（后台不借此看到完整昵称）');
    t.eq(adminDto.partnerBrief(rawPartner, {}).displayName, '李***', '兼职 DTO 昵称脱敏');
    t.eq(adminDto.orderBrief(rawOrder).dorm, 'D4', '订单 DTO 宿舍打码（无房间号）');
    t.eq(orderDetail.parcel.pickupCode, '1***8', '取件码只留首尾（不可还原）');
    t.eq(orderDetail.parcel.lockerNo, '***', '柜号只表示有值（不可还原）');
    t.eq(orderDetail.parcel.trackingTail, '***78', '运单尾号只留后 2 位');
    t.eq(orderDetail.imageUploaded, true, '截图只回"有图"布尔（无 fileId/临时 URL）');
    t.check(JSON.stringify(boundDetail).indexOf('cloud://') === -1
      && JSON.stringify(orderDetail).indexOf('cloud://') === -1, '后台 DTO 序列化后零 fileID（云存储路径不外泄）');
  });

  // ---------------------------------------------------------------- §7.8 统计排除
  h.section('§7.8 统计/列表排除测试数据', (t) => {
    t.check(SRC.stats.indexOf('where: { isTest: false }') !== -1
      && SRC.stats.indexOf('where: { isTestAccount: true }') !== -1,
    '后台统计：真实指标按 isTest:false 排除，测试账号另单列计数');
    t.check(SRC.stats.indexOf('{ isTest: true }') !== -1, '后台统计：测试订单单独出数（不混入真实指标）');
    t.check(SRC.listOrders.indexOf('if (!includeTest && row.isTest === true)') !== -1,
      '后台订单列表默认过滤测试单（includeTest 才展示）');
    t.check(SRC.cleanupStats.indexOf('isTest: false') !== -1, '兼职统计缓存重算排除测试单');
  });

  // ---------------------------------------------------------------- §10.4 清理语义
  h.section('§10.4 测试数据清理（账号保留、只清业务数据；30 天）', (t) => {
    t.eq(cleanupTestData.DEFAULT_RETENTION_DAYS, defaults.DEFAULT_CONFIG.testDataRetentionDays,
      '清理默认留存天数与 config 出厂值同源（30 天）');
    t.eq(cleanupTestData.MAX_ACCOUNTS_PER_RUN, defaults.TEST_ACCOUNT_TOTAL_MAX,
      '每轮最多 6 个测试账号（=每位开发者合计上限，单轮可清完）');
    t.check(SRC.cleanupTestData.indexOf('testLastUsedAt') !== -1, '超期判定用最后使用时间（未用过回落到创建时间）');
    t.check(SRC.cleanupTestData.indexOf('remove(C.ORDERS') !== -1 && !/remove\(\s*C\.USERS/.test(SRC.cleanupTestData),
      '只清业务数据、保留测试账号本身（users 不删）');
    t.check(SRC.cleanupTestData.indexOf('removeWhere(C.ORDER_EVENTS') !== -1
      && SRC.cleanupTestData.indexOf('removeWhere(C.ORDER_MESSAGES') !== -1,
    '级联清订单事件与留言（订单删除后无孤儿）');
    t.check(SRC.cleanupTestData.indexOf('deleteFileSafe') !== -1, '云存储文件一并删除（截图/头像不留孤儿）');
    t.check(/cascadeDelete/.test(TEST_ACCOUNT_OPS_SRC) && /collectTestData/.test(TEST_ACCOUNT_OPS_SRC)
      && /deleteFiles/.test(TEST_ACCOUNT_OPS_SRC) && /endSessionsOfAccount/.test(TEST_ACCOUNT_OPS_SRC),
    '删除测试账号：级联清数据 + 删文件 + 结束相关会话（审计补丁⑥）');
  });

  // ---------------------------------------------------------------- §0.5 隔离铁律
  h.section('§0.5 真实×测试隔离（FORBIDDEN；TEST_WRITE 只对测试账号）', (t) => {
    t.check(SRC.bindCreate.indexOf('isSameTestSide') !== -1 && SRC.bindCreate.indexOf('isTestAccount') !== -1,
      '绑定：真实×测试一律 FORBIDDEN（只有同一测试侧才放行）');
    t.check(SRC.partnerPublic.indexOf('isTestAccount === true && !scope.testWrite') !== -1,
      'partner.getPublic：测试账号对真实顾客 NOT_FOUND（仅同一测试会话内预览）');
    t.check(SRC.switchSession.indexOf('isTestAccount !== true') !== -1
      && SRC.switchSession.indexOf('VIEW_MODE.TEST_WRITE') !== -1,
    'TEST_WRITE 票据签发/校验要求目标 isTestAccount=true');
    t.check(SRC.viewAsStart.indexOf('mode === enums.VIEW_MODE.TEST_WRITE && user.isTestAccount !== true') !== -1,
      'viewAsStart：TEST_WRITE 拒绝真实账号目标（双保险）');
    t.check(SRC.viewAsStart.indexOf('mode === enums.VIEW_MODE.READONLY && user.isTestAccount === true') !== -1,
      'viewAsStart：READONLY 拒绝测试账号目标（两种模式互斥）');
  });

  // ---------------------------------------------------------------- §5.6 存储隔离
  h.section('§5.6 本地存储不落测试会话痕迹（只内存，冷启动丢失）', (t) => {
    let raw = JSON.stringify({
      lastRole: 'CUSTOMER',
      targetIsTest: true,
      viewMode: 'TEST_WRITE',
      viewTicket: 'T'.repeat(enums.TOKEN_LENGTH)
    });
    const platform = {
      getStorageSync: function getStorageSync() { return raw; },
      setStorageSync: function setStorageSync(key, value) { raw = value; },
      removeStorageSync: function removeStorageSync() { raw = ''; }
    };
    const loaded = storage.load(platform);
    t.eq(loaded, { lastRole: 'CUSTOMER', guides: {}, draftPointer: null },
      '存储白名单：测试会话标记/模式/票据一律丢弃');
    t.check(JSON.stringify(loaded).indexOf('targetIsTest') === -1
      && JSON.stringify(loaded).indexOf('TEST_WRITE') === -1,
    '存储读数零测试会话痕迹（冷启动不还原会话）');
    t.check(storage.ALLOWED_ROLES.indexOf('DEVELOPER') === -1, '开发者身份不落本地存储（只记业务角色）');
  });

  // ---------------------------------------------------------------- §4.3 审计
  h.section('§4.3 审计动作集合（TEST_ACCOUNT_* / TEST_DATA_PURGE 在册）', (t) => {
    t.check(['TEST_ACCOUNT_CREATE', 'TEST_ACCOUNT_DELETE', 'TEST_DATA_PURGE']
      .every((action) => audit.AUDIT_ACTION_LIST.indexOf(action) !== -1), '测试账号三审计在册');
    t.check(audit.AUDIT_ACTION_LIST.every((action) => action.indexOf(LEGACY_AUDIT_PREFIX) === -1),
      '审计注册表零旧审计名（旧 VIEW_AS_* 只读换算，不再写入）');
    t.eq(audit.isAuditAction('TEST_ACCOUNT_CREATE'), true, 'isAuditAction 认测试账号审计');
    t.check(SRC.testAccountsHandler.indexOf('AUDIT_ACTIONS.TEST_ACCOUNT_CREATE') !== -1
      && SRC.testAccountsHandler.indexOf('AUDIT_ACTIONS.TEST_ACCOUNT_DELETE') !== -1
      && SRC.testAccountsHandler.indexOf('AUDIT_ACTIONS.TEST_DATA_PURGE') !== -1,
    '三个动作各自落审计（创建/删除/清空逐次可追）');
  });

  // ---------------------------------------------------------------- §4.10 create（fake DB 端到端）
  h.section('§4.10 createTestAccount（合成身份/默认值/配额/邀请码零消耗/审计/幂等）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedAdminUser(db);
    const customer = await testAccountActions['admin.createTestAccount'](testCtx(db, { clientRequestId: testRequestKey(1) }), {
      role: enums.ROLES.CUSTOMER, displayName: '测试小王'
    });
    t.eq(customer.customerNo, customer.targetNo, '创建顾客：返回 customerNo=targetNo（页面可直接展示编号）');
    t.eq(customer.partnerNo, '', '创建顾客：partnerNo 为空串');
    const createdUser = db.dump('users').filter((row) => row.isTestAccount === true && row.roles.indexOf(enums.ROLES.CUSTOMER) >= 0)[0];
    t.check(createdUser && createdUser._id.indexOf('TEST-') === 0, '合成 openid 以 TEST- 开头（不来自微信）');
    t.eq(createdUser && createdUser.isTestAccount, true, 'users.isTestAccount=true（合成账号标记）');
    t.eq(createdUser && createdUser.createdByDeveloperNo, 'DEV-01', '归属创建开发者（只能管自己创建的）');
    const customerDoc = db.dump('customers').filter((row) => row.customerNo === customer.targetNo)[0];
    t.eq(customerDoc && customerDoc._id, createdUser && createdUser._id, 'customers._id=合成 openid（与 users._id 同值）');
    t.eq(customerDoc && customerDoc.avatarFileId, '', '默认头像：avatarFileId 空串（不采集真实微信资料）');
    t.check(customerDoc && customerDoc.profileCompleted === true && !!customerDoc.zone && !!customerDoc.dormKey,
      '默认资料完整（单机即可演示下单/绑定）');
    t.eq(customerDoc && customerDoc.customerNo, customer.targetNo, 'customerNo 唯一字段落库');

    const partner = await testAccountActions['admin.createTestAccount'](testCtx(db, { clientRequestId: testRequestKey(2) }), {
      role: enums.ROLES.PARTNER, displayName: '测试小张'
    });
    t.eq(partner.partnerNo, partner.targetNo, '创建兼职：返回 partnerNo=targetNo');
    const partnerDoc = db.dump('partners').filter((row) => row.partnerNo === partner.targetNo)[0];
    const partnerUser = db.dump('users').filter((row) => row.isTestAccount === true && row.roles.indexOf(enums.ROLES.PARTNER) >= 0)[0];
    t.eq(partnerDoc && partnerDoc.openid, partnerUser && partnerUser._id, 'partners.openid=合成 openid（users/customers/partners 三处同值）');
    t.check(partnerDoc && partnerDoc.serviceConfig.services.length === enums.SERVICE_CODES.length
      && partnerDoc.serviceConfig.services.every((item) => item.enabled), '测试兼职默认服务全开');
    t.eq(partnerDoc && partnerDoc.serviceConfig.zones.slice().sort(), ['B', 'C', 'D', 'N', 'X'], '测试兼职服务范围=全部苑');
    t.eq(partnerDoc && partnerDoc.serviceConfig.acceptingOrders, true, '测试兼职默认接单中');
    t.check(partnerDoc && partnerDoc.stats && Object.keys(partnerDoc.stats).every((key) => partnerDoc.stats[key] === 0),
      '测试兼职统计全 0（永不计入真实统计）');
    t.eq(db.count('invitation_codes'), 0, '创建测试账号零邀请码消耗');

    const createAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.TEST_ACCOUNT_CREATE);
    t.eq(createAudits.length, 2, '每次创建写 1 条 TEST_ACCOUNT_CREATE 审计');
    const listed = await testAccountActions['admin.listTestAccounts'](testCtx(db), {});
    t.eq(listed.list.length, 2, '测试账号列表只列本开发者自己创建的（2 个）');
    t.eq(listed.list.every((row) => !!row.targetNo && !!row.role && row.isTestAccount === true), true,
      '列表行含编号/角色/测试标记（不进真实用户列表）');
    t.eq(listed.usage, { customer: { used: 1, max: 3 }, partner: { used: 1, max: 3 }, total: { used: 2, max: 6 } },
      '用量计数按角色/合计给出（配额页展示）');

    const replay = await testAccountActions['admin.createTestAccount'](testCtx(db, { clientRequestId: testRequestKey(2) }), {
      role: enums.ROLES.PARTNER, displayName: '测试小张'
    });
    t.eq(replay.duplicated, true, '同一 clientRequestId 重放：duplicated=true');
    t.eq(replay.targetNo, partner.targetNo, '重放返回同一测试账号（不重复建号）');
    t.eq(db.dump('users').filter((row) => row.isTestAccount === true).length, 2, '重放不新增测试账号');

    await testAccountActions['admin.createTestAccount'](testCtx(db, { clientRequestId: testRequestKey(3) }), {
      role: enums.ROLES.CUSTOMER, displayName: '测试小李'
    });
    await testAccountActions['admin.createTestAccount'](testCtx(db, { clientRequestId: testRequestKey(4) }), {
      role: enums.ROLES.CUSTOMER, displayName: '测试小周'
    });
    const overQuota = await testResult(() => testAccountActions['admin.createTestAccount'](
      testCtx(db, { clientRequestId: testRequestKey(5) }), { role: enums.ROLES.CUSTOMER, displayName: '测试小吴' }
    ));
    t.eq(overQuota.code, 'VALIDATION_FAILED', '每角色超 3 个 → VALIDATION_FAILED（配额映射不改错误码）');
    t.eq(db.dump('users').filter((row) => row.isTestAccount === true).length, 4, '超限请求不写入（2+1 顾客 + 1 兼职 = 4）');
  });

  // ---------------------------------------------------------------- §4.10 delete（fake DB 端到端）
  h.section('§4.10 deleteTestAccount（dryRun 条数/双条件/真实引用/级联/文件/会话/审计）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedTestPair(db);
    db.seed('customers', [testCustomerDoc('TEST-CUSTOMER01', 'CABCD2222', '测试顾客', 'cloud://avatar-test.jpg')]);
    seedTestBusinessData(db, 'TEST-CUSTOMER01');
    const deletedFiles = [];
    const dry = await testAccountActions['admin.deleteTestAccount'](
      testCtx(db, { clientRequestId: testRequestKey(10), deleted: deletedFiles }), { targetNo: 'CABCD2222', dryRun: true }
    );
    t.eq(dry.dryRun, true, 'delete dryRun 先返回将删除条数（不执行）');
    t.eq(dry.removedCounts.orders, 1, 'dryRun：测试订单 1 条');
    t.eq(dry.removedCounts.events, 1, 'dryRun：订单事件 1 条');
    t.eq(dry.removedCounts.messages, 1, 'dryRun：留言 1 条');
    t.eq(dry.removedCounts.bindings, 1, 'dryRun：绑定 1 条');
    t.eq(dry.removedCounts.failures, 1, 'dryRun：识别失败 1 条');
    t.eq(dry.removedCounts.tickets, 1, 'dryRun：上传票据 1 条');
    t.eq(dry.removedCounts.avatarFiles, 2, 'dryRun：头像 + 失败原图共 2 个文件');
    t.eq(dry.sessionsEnded, 1, 'dryRun：将结束 1 个活跃切换会话');
    t.eq(deletedFiles.length, 0, 'dryRun 只统计不删文件');
    const noConfirm = await testResult(() => testAccountActions['admin.deleteTestAccount'](
      testCtx(db, { clientRequestId: testRequestKey(11) }), { targetNo: 'CABCD2222' }
    ));
    t.eq(noConfirm.code, 'VALIDATION_FAILED', '缺 confirmText「删除」→ VALIDATION_FAILED（双条件第二道）');
    t.eq(db.count('users'), 4, '未确认前不删账号（admin + 测试顾客/兼职 + 他人测试账号）');

    const dbReal = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedTestPair(dbReal);
    dbReal.seed('orders', [{ _id: 'o-real', orderNo: '20261021-0002', customerId: 'TEST-CUSTOMER01', isTest: false, status: 'SUBMITTED', requestKey: 'rq-real' }]);
    const realRef = await testResult(() => testAccountActions['admin.deleteTestAccount'](
      testCtx(dbReal), { targetNo: 'CABCD2222', confirmText: '删除' }
    ));
    t.eq(realRef.code, 'INVALID_STATE', '存在真实订单引用（isTest=false）→ INVALID_STATE 拒绝删除');
    t.eq(dbReal.dump('customers').filter((row) => row._id === 'TEST-CUSTOMER01').length, 1, '真实引用时不做任何级联删除');

    const dbBind = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedTestPair(dbBind);
    dbBind.seed('users', [{ _id: 'openid-real-p9', roles: [enums.ROLES.PARTNER], status: enums.USER_STATUS.ACTIVE, isTestAccount: false, createdAt: new Date(TEST_NOW), updatedAt: new Date(TEST_NOW) }]);
    dbBind.seed('partners', [testPartnerDoc('pp-real-9', 'openid-real-p9', 'PXYZ789', '真实兼职', '')]);
    dbBind.seed('bindings', [{ _id: 'b-real', customerId: 'TEST-CUSTOMER01', partnerId: 'pp-real-9', status: 'ACTIVE', activeKey: 'TEST-CUSTOMER01', roomTag: 'A' }]);
    const bindRef = await testResult(() => testAccountActions['admin.deleteTestAccount'](
      testCtx(dbBind), { targetNo: 'CABCD2222', confirmText: '删除' }
    ));
    t.eq(bindRef.code, 'INVALID_STATE', '存在真实×测试绑定引用 → INVALID_STATE（不级联删真实数据）');

    const del = await testAccountActions['admin.deleteTestAccount'](
      testCtx(db, { clientRequestId: testRequestKey(12), deleted: deletedFiles }), { targetNo: 'CABCD2222', confirmText: '删除' }
    );
    t.eq(del.deleted, true, '双条件通过后删除执行成功');
    t.eq(del.sessionsEnded, 1, '删除时结束相关活跃会话');
    t.eq(db.dump('customers').filter((row) => row._id === 'TEST-CUSTOMER01').length, 0, '级联删除测试顾客资料');
    t.eq(db.dump('orders').filter((row) => row.customerId === 'TEST-CUSTOMER01').length, 0, '级联删除测试订单');
    t.eq(db.count('order_events'), 0, '级联删除订单事件（无孤儿）');
    t.eq(db.count('order_messages'), 0, '级联删除订单留言');
    t.eq(db.count('bindings'), 0, '级联删除测试绑定');
    t.eq(db.count('recognition_failures'), 0, '级联删除识别失败记录');
    t.eq(db.count('upload_tickets'), 0, '级联删除上传票据');
    t.eq(db.dump('users').filter((row) => row._id === 'TEST-CUSTOMER01').length, 0, '级联删除测试账号本身（users）');
    t.eq(deletedFiles.slice().sort(), ['cloud://avatar-test.jpg', 'cloud://failure-1.jpg'], '删除头像文件与失败原图（不留孤儿文件）');
    t.check(db.dump('admin_view_sessions').filter((row) => row._id === TEST_SESSION_ID)[0].endedAt !== null, '相关活跃会话置 endedAt');
    const endAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
    t.eq(endAudits.length, 1, '结束会话记 1 条 ACCOUNT_SWITCH_END');
    t.eq(endAudits[0] && endAudits[0].detail && endAudits[0].detail.reason, 'TARGET_DELETED', '结束原因=TARGET_DELETED（删账号）');
    const deleteAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.TEST_ACCOUNT_DELETE);
    t.eq(deleteAudits.length, 1, '删除写 1 条 TEST_ACCOUNT_DELETE 审计');
    const detail = (deleteAudits[0] && deleteAudits[0].detail) || {};
    t.eq(detail.before && detail.before.orders, 1, '审计 detail.before 记删除前订单条数');
    t.eq(detail.after && detail.after.orders, 0, '审计 detail.after 记删除后订单条数（0）');
    t.eq(detail.sessionsEnded, 1, '审计 detail 记结束会话数');
    const replay = await testAccountActions['admin.deleteTestAccount'](
      testCtx(db, { clientRequestId: testRequestKey(12) }), { targetNo: 'CABCD2222', confirmText: '删除' }
    );
    t.eq(replay.duplicated, true, '同一 clientRequestId 重放删除：duplicated=true（不重复删、不报错）');
  });

  // ---------------------------------------------------------------- §4.10 purge（fake DB 端到端）
  h.section('§4.10 purgeTestData（dryRun/二次确认/真实引用/保留账号/清业务数据/会话/审计）', async (t) => {
    const db = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedTestPair(db);
    db.seed('customers', [testCustomerDoc('TEST-CUSTOMER01', 'CABCD2222', '测试顾客', 'cloud://avatar-test.jpg')]);
    seedTestBusinessData(db, 'TEST-CUSTOMER01');
    const deletedFiles = [];
    const dry = await testAccountActions['admin.purgeTestData'](testCtx(db, { deleted: deletedFiles }), { dryRun: true });
    t.eq(dry.dryRun, true, 'purge dryRun 先回条数（不执行）');
    t.eq(dry.counts.orders, 1, 'purge dryRun：测试订单 1 条');
    t.eq(dry.counts.events, 1, 'purge dryRun：事件 1 条');
    t.eq(dry.counts.messages, 1, 'purge dryRun：留言 1 条');
    t.eq(dry.counts.failures, 1, 'purge dryRun：识别失败 1 条');
    t.eq(dry.sessionsEnded, 1, 'purge dryRun：活跃切换会话 1 个');
    const noConfirm = await testResult(() => testAccountActions['admin.purgeTestData'](testCtx(db), {}));
    t.eq(noConfirm.code, 'VALIDATION_FAILED', 'purge 缺 confirmText「清空」→ VALIDATION_FAILED');

    const dbReal = fake.createFakeDb({ uniqueIndexes: TEST_UNIQUE });
    seedTestPair(dbReal);
    dbReal.seed('orders', [{ _id: 'o-real', orderNo: '20261021-0003', customerId: 'TEST-CUSTOMER01', isTest: false, status: 'SUBMITTED', requestKey: 'rq-real2' }]);
    const realRef = await testResult(() => testAccountActions['admin.purgeTestData'](testCtx(dbReal), { confirmText: '清空' }));
    t.eq(realRef.code, 'INVALID_STATE', 'purge：存在真实数据引用 → INVALID_STATE 拒绝');

    const purged = await testAccountActions['admin.purgeTestData'](
      testCtx(db, { clientRequestId: testRequestKey(20), deleted: deletedFiles }), { confirmText: '清空' }
    );
    t.eq(purged.purged, true, 'purge 执行成功');
    t.eq(purged.sessionsEnded, 1, 'purge 同时结束相关活跃会话');
    t.eq(db.dump('users').filter((row) => row.isTestAccount === true).length, 3, 'purge 保留测试账号本身（账号保留）');
    t.eq(db.count('customers'), 2, 'purge 保留测试顾客资料（只清业务数据）');
    t.eq(db.dump('customers').filter((row) => row._id === 'TEST-CUSTOMER01')[0].avatarFileId, 'cloud://avatar-test.jpg',
      'purge 不清头像（头像随账号保留）');
    t.eq(db.count('orders'), 0, 'purge 清空测试订单');
    t.eq(db.count('order_events'), 0, 'purge 清空订单事件');
    t.eq(db.count('order_messages'), 0, 'purge 清空留言');
    t.eq(db.count('bindings'), 0, 'purge 清空测试绑定');
    t.eq(db.count('recognition_failures'), 0, 'purge 清空识别失败记录');
    t.eq(db.count('upload_tickets'), 0, 'purge 清空上传票据');
    t.eq(deletedFiles, ['cloud://failure-1.jpg'], 'purge 删除失败原图文件（头像不删）');
    t.check(db.dump('admin_view_sessions')[0].endedAt !== null, 'purge 后相关会话 endedAt 已写');
    const endAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
    t.eq(endAudits.length, 1, 'purge 结束会话记 ACCOUNT_SWITCH_END');
    t.eq(endAudits[0] && endAudits[0].detail && endAudits[0].detail.reason, 'TEST_DATA_PURGED', '结束原因=TEST_DATA_PURGED');
    const purgeAudits = db.dump('admin_audit').filter((row) => row.action === audit.AUDIT_ACTIONS.TEST_DATA_PURGE);
    t.eq(purgeAudits.length, 1, 'purge 写 1 条 TEST_DATA_PURGE 审计');
    const detail = (purgeAudits[0] && purgeAudits[0].detail) || {};
    t.eq(detail.before && detail.before.orders, 1, '审计 detail.before 记清理前订单条数');
    t.eq(detail.after && detail.after.orders, 0, '审计 detail.after 记清理后订单条数（0）');
    t.eq(detail.sessionsEnded, 1, '审计 detail 记结束会话数');
    const replay = await testAccountActions['admin.purgeTestData'](
      testCtx(db, { clientRequestId: testRequestKey(20) }), { confirmText: '清空' }
    );
    t.eq(replay.duplicated, true, '同一 clientRequestId 重放 purge：duplicated=true');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const { createHarness, installCrashGuard } = require('./selftest');
  const h = createHarness({ name: 'selftest-testaccount' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }),
    'selftest-testaccount');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}

