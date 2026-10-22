'use strict';
/**
 * tools/selftest-cleanup.js — cleanup 单触发器判据套件（ENGINEERING §7.3/§4.7；DATA_MODEL §10）。
 * 覆盖：①各 sweep 阈值前/后（固定 now 时间旅行）②重跑幂等（acted 收敛、审计不重复）③批上限
 *      ④失败隔离 ⑤关键不变量（订单 180d 匿名化→30d 物理删、截图 7d cleanedAt/引用计数、
 *      识别失败原图 7~30d、viewSession 过期审计每票一条、测试数据 30d 保账号、邀请码过期、
 *      timeout/autoComplete 转态、注销级联匿名化/删图/会话审计、rl 前缀不误删 orderNo/tag）
 *      ⑥cleanup↔api shared 副本逐字节 hash 一致（只读校验，不改 sync 脚本）。
 * 纪律：fake DB 注入、不 mock wx、不连真库；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const { createHarness, installCrashGuard } = require('./selftest');
const fake = require('./fake-db');
const CLEANUP = path.join(ROOT, 'cloudfunctions/cleanup');
const RUN = require(path.join(CLEANUP, 'run.js'));
const SWEEP_MOD = require(path.join(CLEANUP, 'sweeps/index.js'));
const ordersSweep = require(path.join(CLEANUP, 'sweeps/orders.js'));
const storageSweep = require(path.join(CLEANUP, 'sweeps/storage.js'));
const retentionSweep = require(path.join(CLEANUP, 'sweeps/retention.js'));
const accountsSweep = require(path.join(CLEANUP, 'sweeps/accounts.js'));
const invitationsSweep = require(path.join(CLEANUP, 'sweeps/invitations.js'));
const viewSessionsSweep = require(path.join(CLEANUP, 'sweeps/viewSessions.js'));
const countersSweep = require(path.join(CLEANUP, 'sweeps/counters.js'));
const recognitionSweep = require(path.join(CLEANUP, 'sweeps/recognitionFailures.js'));
const testDataSweep = require(path.join(CLEANUP, 'sweeps/testData.js'));
const statsSweep = require(path.join(CLEANUP, 'sweeps/stats.js'));
const { createDao } = require(path.join(CLEANUP, 'db/dao.js'));
const { COLLECTIONS } = require(path.join(CLEANUP, 'shared/collections.js'));
const enums = require(path.join(CLEANUP, 'shared/enums.js'));
const auditActions = require(path.join(CLEANUP, 'shared/audit-actions.js'));
// harness 完整性闸：先占位，首跑按真实断言数回填（少算/多算都判红）。
const EXPECTED_ASSERTIONS = 183;
const NOW = Date.parse('2026-10-22T12:00:00+08:00');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);
const SWEEP_NAMES = ['orderTimeout', 'autoComplete', 'files', 'tickets', 'retention', 'accountDeletion',
  'testAccountsDeletion', 'invitationCodes', 'viewSessions', 'rateLimits', 'recognitionFailures', 'testData',
  'recomputeStats'];
// ---------------------------------------------------------------- fake DB / ctx
// tools/fake-db.js 是门禁保护文件（不可改）：在这里加一层测试侧适配，把 cloud DB 的
// `cmd.gte(x).and(cmd.lt(y))` 翻译成 fake-db 支持的 `{and:[{key:gte},{key:lt}]}`，
// 从而让"键族前缀清理"判据真的走生产代码的过滤分支（而不是退化路径）。
const RANGE_KEY = '__cleanupRange__';
function createCleanupDb(options) {
  const db = fake.createFakeDb(options || {});
  const rangeCmd = (type, value) => {
    const cmd = fake.cmd[type](value);
    cmd.and = (other) => ({ [RANGE_KEY]: [cmd, other && other[RANGE_KEY] ? other[RANGE_KEY][0] : other] });
    return cmd;
  };
  const command = { gte: (value) => rangeCmd('gte', value), lt: (value) => rangeCmd('lt', value) };
  ['eq', 'neq', 'gt', 'lte', 'in', 'nin', 'exists', 'inc', 'set', 'remove'].forEach((name) => {
    command[name] = fake.cmd[name];
  });
  command._ = command;
  db.command = command;
  const baseCollection = db.collection.bind(db);
  const translate = (cond) => {
    if (!cond || typeof cond !== 'object') return cond;
    const parts = [];
    const plain = {};
    Object.keys(cond).forEach((key) => {
      const value = cond[key];
      if (value && value[RANGE_KEY]) {
        value[RANGE_KEY].forEach((cmd) => {
          const part = {};
          part[key] = cmd;
          parts.push(part);
        });
      } else {
        plain[key] = value;
      }
    });
    if (Object.keys(plain).length > 0) parts.unshift(plain);
    if (parts.length === 0) return {};
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  db.collection = (name) => {
    const builder = baseCollection(name);
    const where = builder.where.bind(builder);
    builder.where = (cond) => where(translate(cond));
    return builder;
  };
  return db;
}
function createCloud() {
  const deleted = [];
  return {
    deleted,
    async deleteFile(payload) {
      const list = payload && Array.isArray(payload.fileList) ? payload.fileList : [];
      list.forEach((fileId) => deleted.push(fileId));
      return { fileList: list.map((fileID) => ({ fileID, status: 0 })) };
    }
  };
}
function makeWorld(seed) {
  const db = createCleanupDb({
    uniqueIndexes: {
      users: [['_id']], customers: [['_id'], ['customerNo']], partners: [['openid'], ['partnerNo']],
      orders: [['orderNo'], ['requestKey']], order_events: [['requestKey']], counters: [['key']],
      admin_audit: [['requestKey']], admin_view_sessions: [['requestKey']], upload_tickets: [['ticket']],
      recognition_failures: [['failureNo'], ['requestKey']]
    }
  });
  COLLECTION_NAMES.forEach((name) => db.seed(name, []));
  const world = seed || {};
  Object.keys(world).forEach((name) => db.seed(name, world[name]));
  return db;
}
let ctxSeq = 0;
function makeCtx(db, options) {
  const opts = options || {};
  ctxSeq += 1;
  return {
    dao: createDao(db), db, cloud: opts.cloud || createCloud(), env: {}, config: opts.config || {},
    now: typeof opts.now === 'number' ? opts.now : NOW, requestId: opts.requestId || 'selftest-cleanup-' + ctxSeq,
    COLLECTIONS, AppError: RUN.AppError
  };
}
// ---------------------------------------------------------------- 样本构造
let orderSeq = 0;
function orderOf(overrides) {
  orderSeq += 1;
  const base = {
    _id: 'order-' + orderSeq, orderNo: '20261022-' + String(1000 + orderSeq), requestKey: 'rq-' + orderSeq,
    customerId: 'CUST-A', customerOpenid: 'CUST-A', customerNo: 'CAAAAAAA',
    partnerId: 'P-1', partnerOpenid: 'PARTNER-A', partnerNo: 'PAAAAAA',
    status: enums.ORDER_STATUS.SUBMITTED, statusUpdatedAt: NOW, createdAt: NOW, updatedAt: NOW,
    phoneTail: '6678', dorm: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', roomTag: 'D4-522A' },
    guest: null,
    parcel: { stationId: 'P1', stationName: '一食堂', pickupCode: '1234', lockerNo: 'A1', trackingTail: '8899', codeStatus: enums.CODE_STATUS.OK },
    service: { code: 'PICKUP', name: '取件' }, note: '备注', deliveryNote: '配送备注', cancelReason: '',
    exception: null, image: { fileId: '', width: 0, height: 0, failureId: '' }, isTest: false, version: 1,
    claimTokenHash: 'claim-hash', claimExpiresAt: 123, claimedAt: 123
  };
  return Object.assign(base, overrides);
}
function userOf(openid, overrides) {
  return Object.assign({
    _id: openid,
    roles: ['CUSTOMER'],
    status: enums.USER_STATUS.ACTIVE,
    isTestAccount: false,
    createdAt: NOW - 100 * DAY
  }, overrides);
}
function customerOf(openid, overrides) {
  return Object.assign({
    _id: openid,
    customerNo: 'C' + 'ABCDEFGH',
    displayName: '小王',
    avatarFileId: '',
    zone: 'D',
    buildingNo: 4,
    room: '522',
    dormKey: 'D4-522',
    phoneTail: '6678',
    profileCompleted: true,
    createdAt: NOW - 100 * DAY
  }, overrides);
}
function dateMs(value) {
  return value instanceof Date ? value.getTime() : value;
}
function auditsOf(db, action) {
  return db.dump(COLLECTIONS.ADMIN_AUDIT).filter((row) => row.action === action);
}
function countOf(db, name, where) {
  const docs = db.dump(name);
  if (!where) return docs.length;
  return docs.filter((doc) => Object.keys(where).every((key) => doc[key] === where[key])).length;
}
// ---------------------------------------------------------------- §A 静态纪律
function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function staticAssertions(t) {
  t.eq(SWEEP_MOD.SWEEPS.length, 13, '§A sweeps 注册表恰好 13 个任务');
  t.eq(SWEEP_MOD.SWEEPS.map((item) => item.name), SWEEP_NAMES, '§A 注册表名字/顺序 = ENGINEERING §4.7 清单');
  t.eq(new Set(SWEEP_NAMES).size, 13, '§A 13 个任务名无重复（单触发器全覆盖）');
  t.eq(readText('cloudfunctions/cleanup/sweeps/index.js').indexOf('db.collection'), -1,
    '§A 注册表零 db.collection（云函数只经 db/dao）');
  const codeFiles = walk(CLEANUP, []).filter((full) => full.endsWith('.js'));
  const sweepFiles = codeFiles.filter((full) => full.indexOf(path.join('cleanup', 'sweeps')) !== -1);
  t.eq(sweepFiles.filter((full) => fs.readFileSync(full, 'utf8').indexOf('db.collection') !== -1), [],
    '§A 全部 sweep 零 db.collection');
  t.eq(sweepFiles.filter((full) => fs.readFileSync(full, 'utf8').indexOf('Date.now(') !== -1), [],
    '§A sweep 禁止读系统时钟（时间旅行只认注入 ctx.now）');
  const indexSource = readText('cloudfunctions/cleanup/index.js');
  t.check(indexSource.indexOf("require('./run')") !== -1 && indexSource.indexOf('runAll') !== -1,
    '§A index.js 只做装配，执行器在 run.js（可注入 now/fake DB 测试）');
  // shared 副本逐字节 hash：cleanup ↔ api ↔ 根 shared/utils/config 源
  const sharedNames = fs.readdirSync(path.join(ROOT, 'shared')).filter((name) => name.endsWith('.js'));
  const mismatch = [];
  sharedNames.forEach((name) => {
    const source = fs.readFileSync(path.join(ROOT, 'shared', name));
    ['cloudfunctions/api/shared', 'cloudfunctions/cleanup/shared'].forEach((dir) => {
      const target = path.join(ROOT, dir, name);
      if (!fs.existsSync(target) || sha256(source) !== sha256(fs.readFileSync(target))) {
        mismatch.push(dir + '/' + name);
      }
    });
  });
  [['utils/ids.js', 'ids.js'], ['utils/room-tag.js', 'room-tag.js'], ['config/defaults.js', 'defaults.js']]
    .forEach((pair) => {
      const source = fs.readFileSync(path.join(ROOT, pair[0]));
      ['cloudfunctions/api/shared', 'cloudfunctions/cleanup/shared'].forEach((dir) => {
        const target = path.join(ROOT, dir, pair[1]);
        if (!fs.existsSync(target) || sha256(source) !== sha256(fs.readFileSync(target))) {
          mismatch.push(dir + '/' + pair[1]);
        }
      });
    });
  t.eq(mismatch, [], '§A cleanup/api shared 副本与根源逐字节 hash 一致（' + sharedNames.length
    + ' 份 shared + ids/room-tag/defaults）');
  const tooLong = codeFiles.filter((full) => {
    const lines = fs.readFileSync(full, 'utf8').split('\n').length;
    return lines > 500;
  }).map((full) => path.relative(ROOT, full));
  t.eq(tooLong, [], '§A cleanup 源码单文件 ≤500 行（门禁 #18）');
  const encodingBad = codeFiles.filter((full) => {
    const raw = fs.readFileSync(full);
    const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const text = raw.toString('utf8');
    return hasBom || text.indexOf('\r') !== -1 || !text.endsWith('\n') || text.endsWith('\n\n');
  }).map((full) => path.relative(ROOT, full));
  t.eq(encodingBad, [], '§A cleanup 全部 js：UTF-8 无 BOM / 纯 LF / 结尾单换行');
  const testLines = fs.readFileSync(__filename, 'utf8').split('\n').length;
  t.check(testLines <= 1000, '§A 测试文件 ≤1000 行（当前 ' + testLines + ' 行，门禁 #18）');
  t.eq(SWEEP_NAMES.every((name) => typeof SWEEPS_RUN[name] === 'function'), true,
    '§A 13 个 sweep 导出 run 函数可直接注入执行');
}
const SWEEPS_RUN = {
  orderTimeout: ordersSweep.runOrderTimeout,
  autoComplete: ordersSweep.runAutoComplete,
  files: storageSweep.runFiles,
  tickets: storageSweep.runTickets,
  retention: retentionSweep.runRetention,
  accountDeletion: accountsSweep.runAccountDeletion,
  testAccountsDeletion: accountsSweep.runTestAccountsDeletion,
  invitationCodes: invitationsSweep.runInvitationCodes,
  viewSessions: viewSessionsSweep.runViewSessions,
  rateLimits: countersSweep.runRateLimits,
  recognitionFailures: recognitionSweep.runRecognitionFailures,
  testData: testDataSweep.runTestData,
  recomputeStats: statsSweep.runRecomputeStats
};
// ---------------------------------------------------------------- §B orderTimeout
async function orderTimeoutSection(t) {
  const due = orderOf({
    _id: 'timeout-due',
    status: enums.ORDER_STATUS.SUBMITTED,
    statusUpdatedAt: NOW - 121 * MINUTE,
    createdAt: NOW - 121 * MINUTE
  });
  const fresh = orderOf({
    _id: 'timeout-fresh',
    status: enums.ORDER_STATUS.SUBMITTED,
    statusUpdatedAt: NOW - 119 * MINUTE,
    createdAt: NOW - 300 * MINUTE
  });
  const accepted = orderOf({ _id: 'timeout-accepted', status: enums.ORDER_STATUS.ACCEPTED, statusUpdatedAt: NOW - 300 * MINUTE });
  const noAnchor = orderOf({ _id: 'timeout-fallback', statusUpdatedAt: null, createdAt: NOW - 121 * MINUTE });
  const db = makeWorld({ orders: [due, fresh, accepted, noAnchor] });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.orderTimeout(ctx);
  const after = (id) => db.dump(COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(result.scanned, 2, '§B 阈值前不动 / 阈值后生效：只扫描到 2 单到期（119min 单不算到期）');
  t.eq(result.acted, 2, '§B 到期单转态 2 单');
  t.eq(after('timeout-due').status, enums.ORDER_STATUS.CANCELLED, '§B 超时未接单 → CANCELLED');
  t.eq([after('timeout-due').cancelledBy, after('timeout-due').cancelReason],
    [enums.CANCELLED_BY.SYSTEM, 'TIMEOUT_UNACCEPTED'], '§B 取消人=SYSTEM / 原因=TIMEOUT_UNACCEPTED');
  t.eq(dateMs(after('timeout-due').statusUpdatedAt), NOW, '§B statusUpdatedAt=注入 now（时间旅行口径）');
  t.eq(after('timeout-due').version, 2, '§B 状态流转 version+1');
  t.eq(db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'timeout-due').map((row) => row.type),
    ['TIMEOUT_CANCELLED'], '§B 写 TIMEOUT_CANCELLED 事件（SYSTEM）');
  t.eq(after('timeout-fresh').status, enums.ORDER_STATUS.SUBMITTED,
    '§B 锚=statusUpdatedAt：createdAt 更早也不误取消（119min 未到期）');
  t.eq(after('timeout-accepted').status, enums.ORDER_STATUS.ACCEPTED, '§B 非 SUBMITTED 单不动');
  t.eq(after('timeout-fallback').status, enums.ORDER_STATUS.CANCELLED, '§B 缺 statusUpdatedAt 的历史单回落 createdAt 判定');
  const rerun = await SWEEPS_RUN.orderTimeout(ctx);
  t.eq(rerun.acted, 0, '§B 重跑幂等：acted=0（已转态单不再命中）');
  t.eq(db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row.type === 'TIMEOUT_CANCELLED').length, 2,
    '§B 重跑不重复写事件');
  // 并发安全：扫描→更新窗口内订单被接单（条件更新命中 0）→ 不得改状态/不写事件
  const raceOrder = orderOf({ _id: 'timeout-race', statusUpdatedAt: NOW - 200 * MINUTE, version: 1 });
  let trxAdds = 0;
  const raceCtx = makeCtx(makeWorld({ orders: [raceOrder] }));
  raceCtx.dao = {
    find: async () => [raceOrder],
    transaction: async (fn) => fn({
      updateWhere: async () => ({ updated: 0 }),
      add: async () => { trxAdds += 1; return { _id: 'x' }; }
    }),
    isDuplicateError: () => false
  };
  const race = await SWEEPS_RUN.orderTimeout(raceCtx);
  t.eq([race.acted, trxAdds], [0, 0], '§B 条件更新：并发接单后命中 0 → 不改单、不写事件（不误取消已接单）');
  const db2 = makeWorld({ orders: [orderOf({ _id: 'timeout-config', statusUpdatedAt: NOW - 70 * MINUTE })] });
  const result2 = await SWEEPS_RUN.orderTimeout(makeCtx(db2, { config: { orderTimeoutMinutes: 60 } }));
  t.eq(result2.acted, 1, '§B config.orderTimeoutMinutes=60 生效（70min 单到期）');
}
// ---------------------------------------------------------------- §C autoComplete
async function autoCompleteSection(t) {
  const before = orderOf({ _id: 'auto-before', status: enums.ORDER_STATUS.DELIVERED, deliveredAt: NOW - 23 * HOUR });
  const due = orderOf({ _id: 'auto-due', status: enums.ORDER_STATUS.DELIVERED, deliveredAt: NOW - 25 * HOUR });
  const guest = orderOf({
    _id: 'auto-guest',
    status: enums.ORDER_STATUS.DELIVERED,
    deliveredAt: NOW - 25 * HOUR,
    customerId: '',
    customerOpenid: '',
    customerNo: '',
    guest: { name: '代客', phoneTail: '1234' }
  });
  const legacy = orderOf({ _id: 'auto-legacy', status: enums.ORDER_STATUS.DELIVERED, deliveredAt: null, statusUpdatedAt: NOW - 25 * HOUR });
  const submitted = orderOf({ _id: 'auto-submitted', status: enums.ORDER_STATUS.SUBMITTED, statusUpdatedAt: NOW - 300 * HOUR });
  const db = makeWorld({ orders: [before, due, guest, legacy, submitted] });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.autoComplete(ctx);
  const after = (id) => db.dump(COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(result.acted, 3, '§C DELIVERED 超 24h：到期 3 单（23h 不动）');
  t.eq(after('auto-before').status, enums.ORDER_STATUS.DELIVERED, '§C 阈值前不动（23h 仍待确认）');
  t.eq(after('auto-due').status, enums.ORDER_STATUS.COMPLETED, '§C 送达超时 → COMPLETED');
  t.eq(dateMs(after('auto-due').completedAt), NOW, '§C completedAt=注入 now');
  t.eq(db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'auto-due').map((row) => row.type),
    ['AUTO_COMPLETED'], '§C 写 AUTO_COMPLETED 事件（SYSTEM actorRole）');
  t.eq(after('auto-guest').status, enums.ORDER_STATUS.COMPLETED, '§C guest 单同样由 autoComplete 完成（无顾客确认路径）');
  t.eq(after('auto-legacy').status, enums.ORDER_STATUS.COMPLETED, '§C 缺 deliveredAt 的脏数据回落 statusUpdatedAt（不永久滞留）');
  t.eq(after('auto-submitted').status, enums.ORDER_STATUS.SUBMITTED, '§C 非 DELIVERED 单不动');
  const rerun = await SWEEPS_RUN.autoComplete(ctx);
  t.eq(rerun.acted, 0, '§C 重跑幂等：acted=0');
  const db2 = makeWorld({ orders: [orderOf({ _id: 'auto-config', status: enums.ORDER_STATUS.DELIVERED, deliveredAt: NOW - 2 * HOUR })] });
  const result2 = await SWEEPS_RUN.autoComplete(makeCtx(db2, { config: { autoCompleteHours: 1 } }));
  t.eq(result2.acted, 1, '§C config.autoCompleteHours=1 生效（2h 单完成）');
}
// ---------------------------------------------------------------- §D files
async function filesSection(t) {
  const image = (fileId) => ({ fileId, width: 800, height: 600, failureId: '' });
  const world = { orders: [] };
  for (let i = 0; i < 100; i += 1) {
    world.orders.push(orderOf({
      _id: 'files-blocker-' + i,
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - 200 * DAY,
      image: image('')
    }));
  }
  world.orders.push(orderOf({ _id: 'files-old', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 8 * DAY, image: image('cloud://shot-old.jpg') }));
  world.orders.push(orderOf({ _id: 'files-fresh', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 6 * DAY, image: image('cloud://shot-fresh.jpg') }));
  world.orders.push(orderOf({ _id: 'files-shared-a', status: enums.ORDER_STATUS.CANCELLED, statusUpdatedAt: NOW - 8 * DAY, image: image('cloud://shot-shared.jpg') }));
  world.orders.push(orderOf({ _id: 'files-shared-b', status: enums.ORDER_STATUS.CANCELLED, statusUpdatedAt: NOW - 8 * DAY, image: image('cloud://shot-shared.jpg') }));
  world.orders.push(orderOf({ _id: 'files-behind-blockers', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 10 * DAY, image: image('cloud://shot-behind.jpg') }));
  const db = makeWorld(world);
  const cloud = createCloud();
  const ctx = makeCtx(db, { cloud });
  const result = await SWEEPS_RUN.files(ctx);
  const after = (id) => db.dump(COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(result.acted, 4, '§D 截图 7 天到期：4 单清引用（100 条已清旧单不得占满批 100 挡住后面）');
  t.eq(after('files-old').image.fileId, '', '§D 清订单图片引用（fileId 置空）');
  t.eq([after('files-old').image.width, after('files-old').image.height], [0, 0], '§D 图片宽高归零');
  t.eq(dateMs(after('files-old').image.cleanedAt), NOW, '§D 写 image.cleanedAt（api order.get cleaned / imageUrl NOT_FOUND 的唯一判据）');
  t.eq(cloud.deleted.indexOf('cloud://shot-old.jpg') !== -1, true, '§D 引用计数归零 → 删云文件');
  t.eq(after('files-fresh').image.fileId, 'cloud://shot-fresh.jpg', '§D 阈值前不动（6 天截图保留）');
  t.eq(cloud.deleted.indexOf('cloud://shot-fresh.jpg'), -1, '§D 未到期不删文件');
  t.eq(cloud.deleted.filter((fileId) => fileId === 'cloud://shot-shared.jpg').length, 1,
    '§D 一图多单共享 fileId：最后一单离开窗口才删（只删一次）');
  t.eq(after('files-behind-blockers').image.fileId, '', '§D 批上限内处理到期单（查询带 image.fileId 非空条件）');
  const rerun = await SWEEPS_RUN.files(ctx);
  t.eq(rerun.acted, 0, '§D 重跑幂等：acted=0');
  t.eq(cloud.deleted.indexOf('cloud://shot-old.jpg'), cloud.deleted.lastIndexOf('cloud://shot-old.jpg'),
    '§D 重跑不重复删同一文件');
  const db2 = makeWorld({ orders: [orderOf({ _id: 'files-config', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 4 * DAY, image: image('cloud://shot-config.jpg') })] });
  const cloud2 = createCloud();
  await SWEEPS_RUN.files(makeCtx(db2, { cloud: cloud2, config: { screenshotRetentionDays: 3 } }));
  t.eq(cloud2.deleted.indexOf('cloud://shot-config.jpg') !== -1, true, '§D config.screenshotRetentionDays=3 生效');
}
// ---------------------------------------------------------------- §E tickets
async function ticketsSection(t) {
  const ticket = (id, overrides) => Object.assign({
    _id: 'ticket-doc-' + id,
    ticket: 'TK' + id,
    openid: 'CUST-A',
    purpose: enums.UPLOAD_PURPOSE.TICKET,
    cloudPath: 'orders/TK' + id + '/image.jpg',
    expiresAt: NOW,
    usedAt: null,
    createdAt: NOW - DAY
  }, overrides);
  const db = makeWorld({
    upload_tickets: [
      ticket('fresh', { expiresAt: NOW - 5 * MINUTE }),
      ticket('grace', { expiresAt: NOW - 23 * HOUR }),
      ticket('expired', { expiresAt: NOW - 25 * HOUR, usedAt: null }),
      ticket('used', { expiresAt: NOW - 2 * DAY, usedAt: NOW - 3 * DAY }),
      ticket('avatar', {
        expiresAt: NOW - 26 * HOUR,
        purpose: enums.UPLOAD_PURPOSE.AVATAR,
        cloudPath: 'avatars/customer/random.jpg',
        usedAt: NOW - 25 * HOUR
      }),
      ticket('no-expiry', { expiresAt: null })
    ]
  });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.tickets(ctx);
  const keys = () => db.dump(COLLECTIONS.UPLOAD_TICKETS).map((row) => row.ticket);
  t.eq(result.acted, 3, '§E 过期票据（宽限 24h）删 3 张：过期未用/过期已用/AVATAR');
  t.eq(keys().indexOf('TKexpired'), -1, '§E 过期未消费票据 → 删除');
  t.eq(keys().indexOf('TKused'), -1, '§E 已消费票据到期同样删除（否则 usedAt 票据无限堆积）');
  t.eq(keys().indexOf('TKavatar'), -1, '§E purpose 不区分：AVATAR 票据同规则清理');
  t.eq(keys().indexOf('TKfresh') !== -1, true, '§E 未过期票据保留');
  t.eq(keys().indexOf('TKgrace') !== -1, true, '§E 宽限期内（23h）不动');
  t.eq(keys().indexOf('TKno-expiry') !== -1, true, '§E 缺 expiresAt 的票据不误删（无到期依据）');
  t.eq((await SWEEPS_RUN.tickets(ctx)).acted, 0, '§E 重跑幂等：acted=0');
  t.eq(result.scanned, 3, '§E scanned 只计到期项（未到期不刷计数）');
}
// ---------------------------------------------------------------- §F retention
async function retentionSection(t) {
  const anon = orderOf({
    _id: 'ret-anon',
    status: enums.ORDER_STATUS.COMPLETED,
    statusUpdatedAt: NOW - 181 * DAY,
    parcel: { stationId: 'P2', stationName: '二食堂', pickupCode: '5566', lockerNo: 'B2', trackingTail: '7788', codeStatus: enums.CODE_STATUS.OK },
    image: { fileId: 'cloud://shot-anon.jpg', width: 800, height: 600, failureId: '' },
    completedAt: NOW - 181 * DAY
  });
  const before = orderOf({
    _id: 'ret-before',
    status: enums.ORDER_STATUS.COMPLETED,
    statusUpdatedAt: NOW - 179 * DAY,
    customerId: 'CUST-B',
    customerOpenid: 'CUST-B',
    customerNo: 'CBBBBBBB'
  });
  // 100 条"已匿名化但未满 30 天"的旧单占满批 100：待匿名化单必须仍被处理
  const blockers = [];
  for (let i = 0; i < 100; i += 1) {
    blockers.push(orderOf({
      _id: 'ret-blocker-' + i,
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - 200 * DAY,
      anonymizedAt: NOW - 10 * DAY,
      customerId: '',
      customerOpenid: '',
      customerNo: ''
    }));
  }
  const behind = orderOf({ _id: 'ret-behind', status: enums.ORDER_STATUS.CANCELLED, statusUpdatedAt: NOW - 182 * DAY });
  const db = makeWorld({
    orders: [anon, before, behind].concat(blockers),
    order_messages: [
      { _id: 'msg-anon', orderId: 'ret-anon', fromRole: 'CUSTOMER', fromId: 'CUST-A', text: '取件码 5566', createdAt: NOW - 181 * DAY },
      { _id: 'msg-before', orderId: 'ret-before', fromRole: 'CUSTOMER', fromId: 'CUST-B', text: '保留', createdAt: NOW - 179 * DAY }
    ],
    order_events: [
      { _id: 'evt-anon', orderId: 'ret-anon', type: 'ORDER_CREATED', actorId: 'CUST-A', payload: { note: 'PII' }, at: NOW - 181 * DAY },
      { _id: 'evt-before', orderId: 'ret-before', type: 'ORDER_CREATED', actorId: 'CUST-B', payload: { note: '保留' }, at: NOW - 179 * DAY }
    ]
  });
  const cloud = createCloud();
  const ctx = makeCtx(db, { cloud });
  const result = await SWEEPS_RUN.retention(ctx);
  const rowOf = (id) => db.dump(COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  const anonAfter = rowOf('ret-anon');
  t.eq(result.acted, 2, '§F 180 天到期：2 单匿名化（179 天不动；100 条已匿名旧单不得占批挡住待匿名单）');
  t.eq([anonAfter.customerId, anonAfter.customerOpenid, anonAfter.partnerOpenid, anonAfter.customerNo, anonAfter.partnerNo],
    ['', '', '', '', ''], '§F 匿名化清 openid/编号快照');
  t.eq([anonAfter.phoneTail, anonAfter.note, anonAfter.deliveryNote, anonAfter.cancelReason],
    ['', '', '', ''], '§F 匿名化清尾号/备注/配送备注/取消原因');
  t.eq([anonAfter.dorm, anonAfter.guest], [null, null], '§F 匿名化清宿舍/代客信息');
  t.eq([anonAfter.parcel.pickupCode, anonAfter.parcel.lockerNo, anonAfter.parcel.trackingTail,
    anonAfter.parcel.stationName, anonAfter.parcel.stationId], ['', '', '', '', 'P2'],
    '§F 匿名化清取件码/柜号/尾号/站名、保留 stationId');
  t.eq([anonAfter.image.fileId, anonAfter.claimTokenHash, anonAfter.claimExpiresAt, anonAfter.claimedAt],
    ['', '', null, null], '§F 匿名化清截图引用 + P1 认领字段（claimTokenHash/claimExpiresAt/claimedAt）');
  t.eq(dateMs(anonAfter.anonymizedAt), NOW, '§F 写 anonymizedAt（幂等判据，注入 now 口径）');
  t.eq(db.dump(COLLECTIONS.ORDER_MESSAGES).filter((row) => row._id === 'msg-anon')[0].text, '[已删除]',
    '§F 订单留言文本匿名化');
  t.eq(db.dump(COLLECTIONS.ORDER_MESSAGES).filter((row) => row._id === 'msg-anon')[0].fromId, '', '§F 留言 fromId 清空');
  const anonEvent = db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row._id === 'evt-anon')[0];
  t.eq([anonEvent.actorId, anonEvent.payload], ['', {}], '§F 事件 actorId/payload PII 清空');
  t.eq(cloud.deleted.indexOf('cloud://shot-anon.jpg') !== -1, true, '§F 匿名化清截图引用后按引用计数删文件');
  t.eq(rowOf('ret-before').customerId, 'CUST-B', '§F 阈值前不动（179 天单未匿名化）');
  t.eq(db.dump(COLLECTIONS.ORDER_MESSAGES).filter((row) => row._id === 'msg-before')[0].text, '保留',
    '§F 未到期单留言不动');
  t.check(!!rowOf('ret-behind').anonymizedAt, '§F 批上限外到期单仍被处理（查询按 anonymizedAt 空条件过滤）');
  const rerun = await SWEEPS_RUN.retention(ctx);
  t.eq(rerun.acted, 0, '§F 重跑幂等：已匿名化单不重复匿名化');
  // ② 物理删：匿名化满 30 天 / 软删满 7 天
  const db2 = makeWorld({
    orders: [
      orderOf({ _id: 'ret-purge', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 220 * DAY, anonymizedAt: NOW - 31 * DAY, image: { fileId: 'cloud://shot-purge.jpg', width: 1, height: 1, failureId: '' } }),
      orderOf({ _id: 'ret-keep', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 220 * DAY, anonymizedAt: NOW - 29 * DAY }),
      orderOf({ _id: 'ret-soft', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 10 * DAY, deletedByCustomerAt: NOW - 8 * DAY }),
      orderOf({ _id: 'ret-soft-keep', status: enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: NOW - 10 * DAY, deletedByCustomerAt: NOW - 6 * DAY })
    ],
    order_events: [
      { _id: 'evt-purge', orderId: 'ret-purge', type: 'ORDER_CREATED', actorId: '', payload: {}, at: NOW - 220 * DAY },
      { _id: 'evt-soft', orderId: 'ret-soft', type: 'ORDER_CREATED', actorId: '', payload: {}, at: NOW - 10 * DAY }
    ],
    order_messages: [{ _id: 'msg-purge', orderId: 'ret-purge', fromRole: 'CUSTOMER', fromId: '', text: '[已删除]', createdAt: NOW - 220 * DAY }]
  });
  const cloud2 = createCloud();
  const result2 = await SWEEPS_RUN.retention(makeCtx(db2, { cloud: cloud2 }));
  const ids = () => db2.dump(COLLECTIONS.ORDERS).map((row) => row._id);
  t.eq(result2.acted, 2, '§F 物理删 2 单（匿名化+30 天 / 软删+7 天）');
  t.eq(ids().indexOf('ret-purge'), -1, '§F 匿名化满 30 天 → 订单物理删');
  t.eq(ids().indexOf('ret-keep') !== -1, true, '§F 匿名化 29 天不删');
  t.eq(ids().indexOf('ret-soft'), -1, '§F 顾客删除记录满 7 天 → 物理删');
  t.eq(ids().indexOf('ret-soft-keep') !== -1, true, '§F 软删 6 天不删');
  t.eq([db2.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row._id === 'evt-purge').length,
    db2.dump(COLLECTIONS.ORDER_MESSAGES).filter((row) => row._id === 'msg-purge').length], [0, 0],
  '§F 物理删级联清事件/留言（无孤儿 PII）');
  t.eq(cloud2.deleted.indexOf('cloud://shot-purge.jpg') !== -1, true, '§F 物理删前清截图文件（不留孤儿）');
}
// ---------------------------------------------------------------- §G accountDeletion
async function accountDeletionSection(t) {
  const delUser = userOf('CUST-DEL', {
    status: enums.USER_STATUS.DEACTIVATED,
    deletionRequestedAt: NOW - 10 * DAY
  });
  const db = makeWorld({
    users: [delUser],
    customers: [customerOf('CUST-DEL', { avatarFileId: 'cloud://avatar-del.jpg' })],
    orders: [orderOf({
      _id: 'del-order',
      customerId: 'CUST-DEL',
      customerOpenid: 'CUST-DEL',
      customerNo: 'CDELDEL1',
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - 5 * DAY,
      image: { fileId: 'cloud://shot-del.jpg', width: 800, height: 600, failureId: '' }
    })],
    bindings: [{ _id: 'bind-del', customerId: 'CUST-DEL', partnerId: 'P-1', status: 'RELEASED', activeKey: 'CUST-DEL:RELEASED:1' }],
    upload_tickets: [{ _id: 'ticket-del', ticket: 'TKDEL', openid: 'CUST-DEL', purpose: 'TICKET', cloudPath: 'orders/TKDEL/image.jpg', expiresAt: NOW + 5 * MINUTE, usedAt: null, createdAt: NOW }],
    recognition_failures: [{ _id: 'failure-del', failureNo: 'F-20261001-ABCDEF', uploaderOpenid: 'CUST-DEL', status: 'IGNORED', fileId: 'cloud://failure-del.jpg', createdAt: NOW - 2 * DAY }],
    admin_view_sessions: [{
      _id: 'session-del',
      adminOpenid: 'openid-admin',
      developerNo: 'DEV-01',
      viewMode: enums.VIEW_MODE.READONLY,
      role: enums.ROLES.CUSTOMER,
      targetId: 'CUST-DEL',
      targetNo: 'CDELDEL1',
      targetIsTest: false,
      createdAt: NOW - HOUR,
      expiresAt: NOW + HOUR,
      endedAt: null
    }]
  });
  const cloud = createCloud();
  const ctx = makeCtx(db, { cloud });
  const result = await SWEEPS_RUN.accountDeletion(ctx);
  const customer = db.dump(COLLECTIONS.CUSTOMERS).filter((row) => row._id === 'CUST-DEL')[0];
  const delOrder = db.dump(COLLECTIONS.ORDERS).filter((row) => row._id === 'del-order')[0];
  t.eq(result.acted, 1, '§G 注销阶段一：10 天申请单本轮执行资料匿名化/删图/结束会话');
  t.eq([customer.displayName, customer.avatarFileId, customer.phoneTail], ['', '', ''], '§G customers PII 清空（昵称/头像/尾号）');
  t.eq([customer.zone, customer.buildingNo, customer.room, customer.dormKey], ['', 0, '', ''], '§G 宿舍 PII 清空');
  t.check(customer.anonymizedAt instanceof Date && customer.deletedAt instanceof Date, '§G customers 写 deletedAt/anonymizedAt');
  t.eq(dateMs(customer.purgeAt), NOW + 30 * DAY, '§G customers 写 purgeAt=申请+30 天');
  t.eq(cloud.deleted.indexOf('cloud://avatar-del.jpg') !== -1, true, '§G 注销立即删头像文件');
  t.eq([delOrder.customerId, delOrder.customerOpenid], ['', ''], '§G 订单立即匿名化（不等 180 天）');
  t.eq([delOrder.image.fileId, dateMs(delOrder.image.cleanedAt)], ['', NOW], '§G 注销立即删截图引用（写 cleanedAt 供 api 判定）');
  t.eq(cloud.deleted.indexOf('cloud://shot-del.jpg') !== -1, true, '§G 注销立即删截图云文件');
  const session = db.dump(COLLECTIONS.ADMIN_VIEW_SESSIONS).filter((row) => row._id === 'session-del')[0];
  t.check(session.endedAt instanceof Date, '§G 目标账号有效切换会话立即 endedAt');
  const endAudits = auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_END);
  t.eq(endAudits.length, 1, '§G 结束会话写 1 条 ACCOUNT_SWITCH_END 审计');
  t.eq(endAudits[0].detail.reason, 'TARGET_DELETED', '§G 审计 detail.reason=TARGET_DELETED');
  t.eq(db.dump(COLLECTIONS.RECOGNITION_FAILURES)[0].uploaderOpenid, '', '§G 识别失败记录 uploaderOpenid 置空（匿名化）');
  t.eq(db.count(COLLECTIONS.UPLOAD_TICKETS), 0, '§G 注销清上传票据');
  t.eq([db.count(COLLECTIONS.USERS), db.count(COLLECTIONS.CUSTOMERS)], [1, 1], '§G 30 天前不物理删 users/customers');
  const rerun = await SWEEPS_RUN.accountDeletion(ctx);
  t.eq(rerun.acted, 0, '§G 重跑幂等：阶段一已处理 → acted=0');
  t.eq(auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_END).length, 1, '§G 重跑不重复写会话结束审计');
  // 阶段二：申请满 30 天 → 物理删
  const db2 = makeWorld({
    users: [userOf('CUST-GONE', { status: enums.USER_STATUS.DEACTIVATED, deletionRequestedAt: NOW - 31 * DAY })],
    customers: [customerOf('CUST-GONE', { avatarFileId: 'cloud://avatar-gone.jpg' })],
    bindings: [{ _id: 'bind-gone', customerId: 'CUST-GONE', partnerId: 'P-1', status: 'RELEASED', activeKey: 'CUST-GONE:RELEASED:1' }],
    upload_tickets: [{ _id: 'ticket-gone', ticket: 'TKGONE', openid: 'CUST-GONE', purpose: 'TICKET', cloudPath: 'orders/TKGONE/image.jpg', expiresAt: NOW - 31 * DAY, usedAt: NOW - 32 * DAY, createdAt: NOW - 32 * DAY }]
  });
  const cloud2 = createCloud();
  const result2 = await SWEEPS_RUN.accountDeletion(makeCtx(db2, { cloud: cloud2 }));
  t.eq(result2.acted, 1, '§G 注销申请满 30 天 → 物理删');
  t.eq([db2.count(COLLECTIONS.USERS), db2.count(COLLECTIONS.CUSTOMERS), db2.count(COLLECTIONS.BINDINGS),
    db2.count(COLLECTIONS.UPLOAD_TICKETS)], [0, 0, 0, 0], '§G 物理删 users/customers/bindings/票据');
  t.eq(cloud2.deleted.indexOf('cloud://avatar-gone.jpg') !== -1, true, '§G 物理删阶段头像文件兜底删除');
  t.eq(db2.dump(COLLECTIONS.CUSTOMERS).length, 0, '§G 30 天阈值前不动（本世界申请 31 天已删）');
}
// ---------------------------------------------------------------- §H testAccountsDeletion
async function testAccountsDeletionSection(t) {
  const db = makeWorld({
    users: [userOf('TEST-ALIVE', { isTestAccount: true, roles: ['CUSTOMER'] })],
    customers: [
      customerOf('TEST-ORPHAN', { customerNo: 'CORPHAN1' }),
      customerOf('TEST-ALIVE', { customerNo: 'CALIVE01' }),
      customerOf('REAL-CUST', { customerNo: 'CREAL001' })
    ],
    orders: [
      orderOf({ _id: 'orphan-order-1', customerId: 'TEST-ORPHAN', customerOpenid: 'TEST-ORPHAN', isTest: true }),
      orderOf({ _id: 'orphan-order-2', customerId: 'TEST-ORPHAN', customerOpenid: 'TEST-ORPHAN', isTest: true, status: enums.ORDER_STATUS.COMPLETED })
    ],
    order_events: [
      { _id: 'orphan-evt-1', orderId: 'orphan-order-1', type: 'ORDER_CREATED', actorId: 'TEST-ORPHAN', payload: {}, at: NOW },
      { _id: 'orphan-evt-2', orderId: 'orphan-order-2', type: 'ORDER_CREATED', actorId: 'TEST-ORPHAN', payload: {}, at: NOW }
    ],
    order_messages: [{ _id: 'orphan-msg-1', orderId: 'orphan-order-1', fromRole: 'CUSTOMER', fromId: 'TEST-ORPHAN', text: '测试留言', createdAt: NOW }],
    bindings: [{ _id: 'orphan-bind', customerId: 'TEST-ORPHAN', partnerId: 'P-9', status: 'ACTIVE', activeKey: 'TEST-ORPHAN' }],
    upload_tickets: [{ _id: 'orphan-ticket', ticket: 'TKORPHAN', openid: 'TEST-ORPHAN', purpose: 'TICKET', cloudPath: 'orders/TKORPHAN/image.jpg', expiresAt: NOW + HOUR, usedAt: null, createdAt: NOW }]
  });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.testAccountsDeletion(ctx);
  const ids = (name) => db.dump(name).map((row) => row._id);
  t.eq(result.acted, 1, '§H 孤儿测试账号（users 行已丢）→ 级联清数据');
  t.eq(ids(COLLECTIONS.ORDERS).filter((id) => id.indexOf('orphan-order') === 0), [], '§H 清该账号测试订单');
  t.eq([ids(COLLECTIONS.ORDER_EVENTS).filter((id) => id.indexOf('orphan-evt') === 0).length,
    ids(COLLECTIONS.ORDER_MESSAGES).filter((id) => id.indexOf('orphan-msg') === 0).length], [0, 0],
  '§H 订单事件/留言级联删除（防孤儿 PII；旧实现只删 orders 留孤儿）');
  t.eq([ids(COLLECTIONS.BINDINGS).indexOf('orphan-bind'), ids(COLLECTIONS.UPLOAD_TICKETS).indexOf('orphan-ticket')], [-1, -1],
    '§H 绑定/上传票据一并清');
  t.eq(ids(COLLECTIONS.CUSTOMERS).indexOf('TEST-ALIVE') !== -1, true, '§H users.isTestAccount=true 的账号数据保留');
  t.eq(ids(COLLECTIONS.CUSTOMERS).indexOf('REAL-CUST') !== -1, true, '§H 真实顾客不在 TEST- 前缀查询范围（不误删）');
  t.eq((await SWEEPS_RUN.testAccountsDeletion(ctx)).acted, 0, '§H 重跑幂等：acted=0');
}
// ---------------------------------------------------------------- §I invitationCodes
async function invitationSection(t) {
  const invite = (id, overrides) => Object.assign({
    _id: 'invite-' + id,
    code: 'INV' + id,
    status: enums.INVITATION_STATUS.UNUSED,
    batchId: 'B20261001-01',
    expiresAt: NOW,
    createdAt: NOW - DAY
  }, overrides);
  const db = makeWorld({
    invitation_codes: [
      invite('expired', { expiresAt: NOW - HOUR }),
      invite('fresh', { expiresAt: NOW + HOUR }),
      invite('used', { status: enums.INVITATION_STATUS.USED, expiresAt: NOW - HOUR }),
      invite('revoked', { status: enums.INVITATION_STATUS.REVOKED, expiresAt: NOW - HOUR })
    ]
  });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.invitationCodes(ctx);
  const byId = (id) => db.dump(COLLECTIONS.INVITATION_CODES).filter((row) => row._id === id)[0];
  t.eq(result.acted, 1, '§I UNUSED 且过期 → 只置 1 条 EXPIRED');
  t.eq(byId('invite-expired').status, enums.INVITATION_STATUS.EXPIRED, '§I 过期邀请码 → EXPIRED（不可重新生效）');
  t.eq(dateMs(byId('invite-expired').updatedAt), NOW, '§I 置 EXPIRED 写 updatedAt=注入 now');
  t.eq([byId('invite-fresh').status, byId('invite-used').status, byId('invite-revoked').status],
    [enums.INVITATION_STATUS.UNUSED, enums.INVITATION_STATUS.USED, enums.INVITATION_STATUS.REVOKED],
  '§I 未过期/已用/已作废均不动');
  t.eq((await SWEEPS_RUN.invitationCodes(ctx)).acted, 0, '§I 重跑幂等：acted=0');
}
// ---------------------------------------------------------------- §J viewSessions
async function viewSessionsSection(t) {
  const session = (id, overrides) => Object.assign({
    _id: 'session-' + id,
    requestKey: 'vs-' + id,
    adminOpenid: 'openid-admin',
    developerNo: 'DEV-01',
    viewMode: enums.VIEW_MODE.TEST_WRITE,
    role: enums.ROLES.CUSTOMER,
    targetId: 'TEST-TARGET',
    targetNo: 'CABCDEFG',
    targetIsTest: true,
    createdAt: NOW - 2 * HOUR,
    expiresAt: NOW + HOUR,
    endedAt: null
  }, overrides);
  const blockers = [];
  for (let i = 0; i < 100; i += 1) {
    blockers.push(session('blocker-' + i, { expiresAt: NOW - 3 * DAY, endedAt: NOW - DAY }));
  }
  const db = makeWorld({
    admin_view_sessions: [
      session('before', { expiresAt: NOW + HOUR }),
      session('due', { expiresAt: NOW - HOUR }),
      session('behind', { expiresAt: NOW - 2 * HOUR }),
      session('already-ended', { expiresAt: NOW - 5 * HOUR, endedAt: NOW - 2 * HOUR }),
      session('purge', { expiresAt: NOW - 10 * DAY, endedAt: NOW - 8 * DAY }),
      session('purge-keep', { expiresAt: NOW - 8 * DAY, endedAt: NOW - 6 * DAY })
    ].concat(blockers)
  });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.viewSessions(ctx);
  const byId = (id) => db.dump(COLLECTIONS.ADMIN_VIEW_SESSIONS).filter((row) => row._id === 'session-' + id)[0];
  t.eq(result.acted, 3, '§J 过期未结束补 endedAt 2 条 + 结束超 7 天物理删 1 条（100 条已结束会话不得占批挡住过期未结束）');
  t.eq(byId('before').endedAt, null, '§J 阈值前不动（未过期会话保持有效）');
  t.eq(dateMs(byId('due').endedAt), NOW - HOUR, '§J 过期会话 endedAt=expiresAt（毫秒口径一致）');
  t.check(byId('due').endedAt instanceof Date, '§J endedAt 写 Date（云 DB 字段类型一致）');
  t.check(dateMs(byId('behind').endedAt) === NOW - 2 * HOUR, '§J 批上限外过期未结束票据仍被补写（查询按未结束过滤）');
  const expiredAudits = auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED);
  t.eq(expiredAudits.length, 2, '§J ACCOUNT_SWITCH_EXPIRED 每票至多一条：2 张过期未结束票 = 2 条');
  t.eq([expiredAudits[0].detail.viewMode, expiredAudits[0].detail.targetIsTest],
    [enums.VIEW_MODE.TEST_WRITE, true], '§J 审计 detail 含 viewMode/targetIsTest');
  t.eq(byId('purge'), undefined, '§J 结束超 7 天 → 会话物理删');
  t.eq(byId('purge-keep') !== undefined, true, '§J 结束 6 天不删');
  const rerun = await SWEEPS_RUN.viewSessions(ctx);
  t.eq(rerun.acted, 0, '§J 重跑幂等：acted=0');
  t.eq(auditsOf(db, auditActions.AUDIT_ACTIONS.ACCOUNT_SWITCH_EXPIRED).length, 2, '§J 重跑不重复写过期审计');
}
// ---------------------------------------------------------------- §K rateLimits
async function rateLimitsSection(t) {
  const counters = [];
  for (let i = 0; i < 300; i += 1) {
    counters.push({ _id: 'nonrl-' + i, key: 'orderNo:2025' + String(1000 + i), seq: i + 1, updatedAt: NOW - 400 * DAY });
  }
  counters.push({ _id: 'rl-fresh', key: 'rl:bind:CUST-A:20261022', seq: 1, updatedAt: NOW - HOUR });
  counters.push({ _id: 'rl-expired', key: 'rl:ai:CUST-B:20261021', seq: 1, updatedAt: NOW - 3 * DAY });
  counters.push({ _id: 'rl-expired-2', key: 'rl:order:CUST-C:20261020', seq: 1, updatedAt: NOW - 5 * DAY });
  counters.push({ _id: 'tag-old', key: 'tag:P-1:D4-522', seq: 1, updatedAt: NOW - 400 * DAY });
  const db = makeWorld({ counters });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.rateLimits(ctx);
  const keys = () => db.dump(COLLECTIONS.COUNTERS).map((row) => row.key);
  t.eq(result.acted, 2, '§K 过期 rl: 计数删 2 条（300 条 orderNo 旧计数不得占满批 100 挡住 rl 清理）');
  t.eq([keys().indexOf('rl:ai:CUST-B:20261021'), keys().indexOf('rl:order:CUST-C:20261020')], [-1, -1],
    '§K 过期 rl: 计数（含 rl:ai:）删除');
  t.eq(keys().indexOf('rl:bind:CUST-A:20261022') !== -1, true, '§K 窗口内 rl: 计数保留');
  t.eq(keys().indexOf('orderNo:2025' + String(1000)) !== -1, true, '§K orderNo 计数永不清理（编号不复用）');
  t.eq(keys().indexOf('tag:P-1:D4-522') !== -1, true, '§K tag 计数永不清理（roomTag 不复用）');
  t.eq(result.scanned, 2, '§K scanned 只计 rl: 到期项（非 rl 键不计）');
  t.eq(db.count(COLLECTIONS.COUNTERS), 302, '§K 批上限/过滤：只删除到期 rl，其余原样保留');
  t.eq((await SWEEPS_RUN.rateLimits(ctx)).acted, 0, '§K 重跑幂等：acted=0');
}
// ---------------------------------------------------------------- §L recognitionFailures
async function recognitionSection(t) {
  const failure = (id, overrides) => Object.assign({
    _id: 'failure-' + id,
    failureNo: 'F-20260901-' + id.toUpperCase().padEnd(6, 'X').slice(0, 6),
    requestKey: 'rf-' + id,
    uploaderOpenid: 'CUST-A',
    sourceRole: 'CUSTOMER',
    status: enums.FAILURE_STATUS.PENDING,
    createdAt: NOW - 31 * DAY,
    retentionDays: 30,
    fileId: '',
    orderId: ''
  }, overrides);
  const db = makeWorld({
    recognition_failures: [
      failure('pending', { fileId: 'cloud://f-pending.jpg' }),
      failure('fresh', { createdAt: NOW - 29 * DAY, fileId: 'cloud://f-fresh.jpg' }),
      failure('ignored', {
        status: enums.FAILURE_STATUS.IGNORED,
        fileId: 'cloud://f-ignored.jpg',
        resolution: { stationId: '', stationName: '', pickupCode: '', note: '人工忽略', by: 'DEV-01', at: NOW - 10 * DAY }
      }),
      failure('fixed', { status: enums.FAILURE_STATUS.FIXED, fileId: 'cloud://f-fixed.jpg' }),
      failure('shared', { fileId: 'cloud://f-shared.jpg' }),
      failure('clamped', { retentionDays: 90, fileId: 'cloud://f-clamped.jpg' }),
      failure('anon', { uploaderOpenid: '', status: enums.FAILURE_STATUS.IGNORED, fileId: 'cloud://f-anon.jpg' }),
      failure('anon-fresh', { uploaderOpenid: '', createdAt: NOW - 20 * DAY, fileId: 'cloud://f-anon-fresh.jpg' })
    ],
    orders: [orderOf({
      _id: 'recog-order',
      status: enums.ORDER_STATUS.SUBMITTED,
      image: { fileId: 'cloud://f-shared.jpg', width: 800, height: 600, failureId: '' }
    })]
  });
  const cloud = createCloud();
  const ctx = makeCtx(db, { cloud });
  const result = await SWEEPS_RUN.recognitionFailures(ctx);
  const record = (id) => db.dump(COLLECTIONS.RECOGNITION_FAILURES).filter((row) => row._id === 'failure-' + id)[0];
  t.eq(result.acted, 5, '§L 到期清理 5 条：PENDING/IGNORED/共享引用/retentionDays 越界/上传者已注销');
  t.eq(record('pending').status, enums.FAILURE_STATUS.IGNORED, '§L PENDING 到期 → IGNORED');
  t.eq([record('pending').resolution.note, record('pending').resolution.by], ['EXPIRED', 'SYSTEM'], '§L resolution.note=EXPIRED / by=SYSTEM');
  t.check(record('pending').reviewedAt instanceof Date, '§L reviewedAt=注入 now');
  t.eq(record('pending').fileId, '', '§L 删原图引用（fileId 置空）');
  t.eq(cloud.deleted.indexOf('cloud://f-pending.jpg') !== -1, true, '§L 无引用 → 删原图云文件');
  t.eq(record('fresh').status, enums.FAILURE_STATUS.PENDING, '§L 阈值前不动（29 天记录保留）');
  t.eq([record('ignored').fileId, record('ignored').resolution.note], ['', '人工忽略'],
    '§L 已人工 IGNORED 记录到期也清原图（旧实现只扫 PENDING → 原图永久残留），且不覆盖人工备注');
  t.eq([record('fixed').status, record('fixed').fileId], [enums.FAILURE_STATUS.FIXED, 'cloud://f-fixed.jpg'],
    '§L FIXED 终态不动（ENGINEERING §4.7 status≠FIXED）');
  t.eq(record('shared').fileId, '', '§L 共享原图：记录侧清引用');
  t.eq(cloud.deleted.indexOf('cloud://f-shared.jpg'), -1, '§L 同一 fileId 仍被订单引用 → 不删文件（引用计数合并）');
  t.eq(record('clamped').status, enums.FAILURE_STATUS.IGNORED, '§L retentionDays 越界（90）按 7~30 收窄为 30 天 → 到期处理');
  t.eq(record('anon'), undefined, '§L 上传者已注销的匿名记录到期物理删（ocrTextMasked 不再留）');
  t.eq(cloud.deleted.indexOf('cloud://f-anon.jpg') !== -1, true, '§L 匿名记录删前按引用计数删原图');
  t.eq(record('anon-fresh') !== undefined, true, '§L 匿名记录未到期保留');
  t.eq((await SWEEPS_RUN.recognitionFailures(ctx)).acted, 0, '§L 重跑幂等：acted=0');
}
// ---------------------------------------------------------------- §M testData
async function testDataSection(t) {
  const users = [];
  const customers = [];
  const orders = [];
  const orderEvents = [];
  const orderMessages = [];
  const bindings = [];
  const failures = [];
  const tickets = [];
  for (let i = 0; i < 8; i += 1) {
    const id = 'TEST-DATA-' + i;
    users.push(userOf(id, { isTestAccount: true, testLastUsedAt: NOW - (31 + i) * DAY, createdAt: NOW - 200 * DAY }));
    customers.push(customerOf(id, { customerNo: 'CTEST00' + i, avatarFileId: 'cloud://avatar-test-' + i + '.jpg' }));
    orders.push(orderOf({ _id: 'td-order-' + i, customerId: id, customerOpenid: id, customerNo: 'CTEST00' + i, isTest: true }));
    orderEvents.push({ _id: 'td-evt-' + i, orderId: 'td-order-' + i, type: 'ORDER_CREATED', actorId: id, payload: {}, at: NOW - 40 * DAY });
    orderMessages.push({ _id: 'td-msg-' + i, orderId: 'td-order-' + i, fromRole: 'CUSTOMER', fromId: id, text: '测试', createdAt: NOW - 40 * DAY });
    bindings.push({ _id: 'td-bind-' + i, customerId: id, partnerId: 'P-1', status: 'ACTIVE', activeKey: id });
    failures.push({ _id: 'td-failure-' + i, failureNo: 'F-20260901-' + String(100000 + i), uploaderOpenid: id, status: 'IGNORED', fileId: 'cloud://failure-test-' + i + '.jpg', createdAt: NOW - 40 * DAY });
    tickets.push({ _id: 'td-ticket-' + i, ticket: 'TKTEST' + String(10 + i), openid: id, purpose: 'TICKET', cloudPath: 'orders/TKTEST' + i + '/image.jpg', expiresAt: NOW - DAY, usedAt: null, createdAt: NOW - 40 * DAY });
  }
  users.push(userOf('TEST-FRESH', { isTestAccount: true, testLastUsedAt: NOW - 5 * DAY, createdAt: NOW - 200 * DAY }));
  users.push(userOf('CUST-REAL-USER', { isTestAccount: false }));
  const db = makeWorld({
    users,
    customers,
    orders,
    order_events: orderEvents,
    order_messages: orderMessages,
    bindings,
    recognition_failures: failures,
    upload_tickets: tickets
  });
  const cloud = createCloud();
  const ctx = makeCtx(db, { cloud });
  const result = await SWEEPS_RUN.testData(ctx);
  const audits = auditsOf(db, 'CLEANUP').filter((row) => row.detail && row.detail.sweep === 'testData');
  t.eq(result.acted, 6, '§M 每轮最多 6 个测试账号（8 个到期账号 → 本轮 6）');
  t.eq(db.dump(COLLECTIONS.ORDERS).filter((row) => row.isTest === true).length, 2,
    '§M 清业务数据：本轮 6 个账号订单清空、2 个未轮到账号数据保留（批 ≤6 可重入）');
  t.eq([db.dump(COLLECTIONS.ORDER_EVENTS).filter((row) => row._id === 'td-evt-0').length,
    db.dump(COLLECTIONS.ORDER_MESSAGES).filter((row) => row._id === 'td-msg-0').length], [0, 0],
  '§M 订单事件/留言级联删除');
  t.eq([db.dump(COLLECTIONS.CUSTOMERS).filter((row) => row._id === 'TEST-DATA-0').length,
    db.dump(COLLECTIONS.USERS).filter((row) => row._id === 'TEST-DATA-0').length], [1, 1],
  '§M 账号保留（只清业务数据，users/customers 不删）');
  t.eq(db.dump(COLLECTIONS.CUSTOMERS).filter((row) => row._id === 'TEST-DATA-0')[0].avatarFileId, '',
    '§M 清头像引用（账号保留、默认头像兜底）');
  t.eq(cloud.deleted.indexOf('cloud://avatar-test-0.jpg') !== -1, true, '§M 删测试账号头像文件');
  t.eq([db.dump(COLLECTIONS.BINDINGS).filter((row) => row._id === 'td-bind-0').length,
    db.dump(COLLECTIONS.RECOGNITION_FAILURES).filter((row) => row._id === 'td-failure-0').length,
    db.dump(COLLECTIONS.UPLOAD_TICKETS).filter((row) => row._id === 'td-ticket-0').length], [0, 0, 0],
  '§M 绑定/识别失败/票据一并清');
  t.eq(audits.length, 6, '§M 每个清理账号写 1 条 CLEANUP 审计（detail.sweep=testData）');
  t.eq([audits[0].detail.counts.orders, audits[0].detail.counts.events], [1, 1], '§M 审计记清理条数摘要');
  t.eq(db.dump(COLLECTIONS.USERS).filter((row) => row._id === 'TEST-FRESH').length, 1, '§M 未到期（5 天）测试账号不动');
  const rerun = await SWEEPS_RUN.testData(ctx);
  t.eq(rerun.acted, 2, '§M 重跑继续清剩余 2 个到期账号（批 ≤6/轮可重入）');
  t.eq(auditsOf(db, 'CLEANUP').length, 8, '§M 重跑补写 2 条审计（每账号 1 条）');
  const settled = await SWEEPS_RUN.testData(ctx);
  t.eq(settled.acted, 0, '§M 数据清空后再跑 acted=0（旧实现每次重跑都计 acted 并重复写审计）');
  t.eq(auditsOf(db, 'CLEANUP').length, 8, '§M 清空后重跑不重复写 CLEANUP 审计');
  t.eq((await SWEEPS_RUN.testData(makeCtx(db, { cloud, now: NOW + 2 * DAY }))).acted, 0,
    '§M 次日再跑 acted=0（已清空无副作用）');
  t.eq(db.dump(COLLECTIONS.USERS).filter((row) => row.isTestAccount === true).length, 9,
    '§M 测试账号（8 到期 + 1 未到期）账号全部保留');
}
// ---------------------------------------------------------------- §N recomputeStats
async function statsSection(t) {
  const orders = [];
  for (let i = 0; i < 120; i += 1) {
    orders.push(orderOf({
      _id: 'stats-today-' + i,
      partnerId: 'P-STATS',
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - HOUR,
      completedAt: NOW - HOUR,
      isTest: false
    }));
  }
  for (let i = 0; i < 5; i += 1) {
    orders.push(orderOf({
      _id: 'stats-old-' + i,
      partnerId: 'P-STATS',
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - 10 * DAY,
      completedAt: NOW - 10 * DAY
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    orders.push(orderOf({ _id: 'stats-cancel-' + i, partnerId: 'P-STATS', status: enums.ORDER_STATUS.CANCELLED, statusUpdatedAt: NOW - DAY }));
  }
  orders.push(orderOf({ _id: 'stats-submitted', partnerId: 'P-STATS', status: enums.ORDER_STATUS.SUBMITTED }));
  orders.push(orderOf({ _id: 'stats-accepted', partnerId: 'P-STATS', status: enums.ORDER_STATUS.ACCEPTED }));
  for (let i = 0; i < 50; i += 1) {
    orders.push(orderOf({
      _id: 'stats-test-' + i,
      partnerId: 'P-STATS',
      status: enums.ORDER_STATUS.COMPLETED,
      statusUpdatedAt: NOW - HOUR,
      completedAt: NOW - HOUR,
      isTest: true
    }));
  }
  const db = makeWorld({
    partners: [{ _id: 'P-STATS', openid: 'PARTNER-STATS', partnerNo: 'PSTATS1', status: enums.PARTNER_STATUS.ACTIVE, updatedAt: NOW - DAY }],
    orders
  });
  const ctx = makeCtx(db);
  const result = await SWEEPS_RUN.recomputeStats(ctx);
  const partner = () => db.dump(COLLECTIONS.PARTNERS)[0];
  t.eq(result.acted, 1, '§N 首次重算 partners.stats（缓存缺失 → 写回）');
  t.eq(partner().stats.totalOrders, 129, '§N totalOrders 只含真实单（125 COMPLETED + 2 CANCELLED + 2 进行中；50 测试单排除）');
  t.eq(partner().stats.completedOrders, 125, '§N completedOrders=125');
  t.eq(partner().stats.cancelledOrders, 2, '§N cancelledOrders=2');
  t.eq([partner().stats.activeOrders, partner().stats.todayOrders], [2, 120],
    '§N activeOrders=2 / todayOrders=120（>100 单/日不再少算）');
  t.eq(Object.keys(partner().stats).sort(), ['activeOrders', 'cancelledOrders', 'completedOrders', 'todayOrders', 'totalOrders', 'updatedAt'],
    '§N stats 只含单量 6 键（字段集固定，与缓存契约一致）');
  const rerun = await SWEEPS_RUN.recomputeStats(ctx);
  t.eq(rerun.acted, 0, '§N 值未变化时不写库：重跑 acted=0（缓存可重算且幂等）');
  t.eq(dateMs(partner().stats.updatedAt), NOW, '§N stats.updatedAt=注入 now（重跑不改写）');
}
// ---------------------------------------------------------------- §O run.js / 入口
async function runnerSection(t) {
  const db = makeWorld({});
  const ctx = makeCtx(db, { requestId: 'runner-1' });
  let laterRan = false;
  const sweeps = [
    { name: 'orderTimeout', run: async () => ({ scanned: 3, acted: 2, failed: 0 }) },
    { name: 'autoComplete', run: async () => { throw new Error('模拟 sweep 崩溃'); } },
    { name: 'files', run: async () => { laterRan = true; return { scanned: 0, acted: 0, failed: 0 }; } }
  ];
  const result = await RUN.runAll(ctx, { sweeps });
  t.eq(result.ok, true, '§O 失败隔离：单 sweep 抛错不炸整轮（入口仍 ok:true）');
  t.eq([result.total, result.failed], [3, 1], '§O 汇总 total=3 / failed=1');
  t.eq([result.sweeps[1].ok, result.sweeps[1].code], [false, 'INTERNAL_ERROR'], '§O 崩溃 sweep 记 failed + INTERNAL_ERROR');
  t.eq([result.sweeps[2].ok, laterRan], [true, true], '§O 崩溃后其余 sweep 继续执行（隔离）');
  const summaryAudits = auditsOf(db, 'CLEANUP');
  t.eq(summaryAudits.length, 1, '§O 一轮一条 CLEANUP 汇总审计（detail.counts）');
  t.eq(summaryAudits[0].detail.counts, { total: 3, ok: 2, failed: 1, scanned: 3, acted: 2 },
    '§O 汇总审计 detail.counts 记录 total/ok/failed/scanned/acted');
  t.eq(summaryAudits[0].adminOpenid, 'SYSTEM', '§O 系统审计 adminOpenid=SYSTEM');
  t.eq(result.auditWritten, true, '§O 有实际动作/失败 → 写汇总审计');
  const rerun = await RUN.runAll(ctx, {
    sweeps: [{ name: 'orderTimeout', run: async () => ({ scanned: 1, acted: 1, failed: 0 }) }]
  });
  t.eq([rerun.auditWritten, auditsOf(db, 'CLEANUP').length], [false, 1],
    '§O 同一轮 requestKey 幂等：重跑不重复写汇总审计');
  const emptyDb = makeWorld({});
  const emptyCtx = makeCtx(emptyDb, { requestId: 'runner-empty' });
  const emptyResult = await RUN.runAll(emptyCtx, {
    sweeps: [{ name: 'invitationCodes', run: async () => ({ scanned: 0, acted: 0, failed: 0 }) }]
  });
  t.eq([emptyResult.ok, emptyResult.auditWritten, emptyDb.count(COLLECTIONS.ADMIN_AUDIT)], [true, true, 1],
    '§O 无动作轮也写一条 CLEANUP 汇总审计（DATA_MODEL §10.2 步骤 11 逐轮审计摘要）');
  // 真实 13 sweep 全量跑空库：单触发器串行跑完、无异常
  const allDb = makeWorld({});
  const allCtx = makeCtx(allDb, { requestId: 'runner-all' });
  const allResult = await RUN.runAll(allCtx, { sweeps: SWEEP_MOD.SWEEPS });
  t.eq([allResult.ok, allResult.total, allResult.failed], [true, 13, 0], '§O 13 sweep 串行全部执行成功（单触发器入口）');
  t.eq(allResult.sweeps.filter((item) => item.ok).length, 13, '§O 每个 sweep 都返回 {scanned,acted,failed} 形状');
}
// ---------------------------------------------------------------- register
function register(h) {
  h.section('§7.3 cleanup 单触发器（13 sweeps 时间旅行/幂等/批上限/隔离/不变量/shared 副本）', async (t) => {
    staticAssertions(t);
    await orderTimeoutSection(t);
    await autoCompleteSection(t);
    await filesSection(t);
    await ticketsSection(t);
    await retentionSection(t);
    await accountDeletionSection(t);
    await testAccountsDeletionSection(t);
    await invitationSection(t);
    await viewSessionsSection(t);
    await rateLimitsSection(t);
    await recognitionSection(t);
    await testDataSection(t);
    await statsSection(t);
    await runnerSection(t);
  });
}
module.exports = { EXPECTED_ASSERTIONS, register };
if (require.main === module) {
  const h = createHarness({ name: 'selftest-cleanup' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-cleanup');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
