'use strict';
/**
 * tools/selftest-testaccount.js — 测试账号与测试数据隔离语义断言（S15；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §4.2  测试账号口径：合成 openid `TEST-<random>`（非空串、非微信、三集合同值、crypto 随机）
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

const EXPECTED_ASSERTIONS = 48;

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
