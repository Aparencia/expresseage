// handlers/admin/stats.js · admin.stats（总览统计：排除测试账号与 isTest 订单；另单列 test 计数）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  createAdminScope,
  startOfDayMs,
  MAX_SCAN
} = require('./_common');
const dto = require('./_dto');
const review = require('./_review');
const time = require('../../lib/time');

const RANGE_DAYS = { today: 0, '7d': 7, '30d': 30 };
const RECENT_AUDIT_LIMIT = 20;
const RECENT_INVITE_SCAN = 100;

function parseRange(value) {
  if (value === undefined || value === null || value === '') {
    return 'today';
  }
  if (RANGE_DAYS[value] === undefined) {
    throw errors.validation('range', '统计区间不正确');
  }
  return value;
}

async function testAccountsOf(scope) {
  const rows = await scope.dao.find(COLLECTIONS.USERS, {
    where: { isTestAccount: true },
    orderBy: [['createdAt', 'desc']],
    limit: 100
  });
  const roles = { CUSTOMER: 0, PARTNER: 0 };
  rows.forEach((row) => {
    const list = Array.isArray(row.roles) ? row.roles : [];
    if (list.indexOf(enums.ROLES.CUSTOMER) >= 0) {
      roles.CUSTOMER += 1;
    }
    if (list.indexOf(enums.ROLES.PARTNER) >= 0) {
      roles.PARTNER += 1;
    }
  });
  return { total: rows.length, customer: roles.CUSTOMER, partner: roles.PARTNER };
}

async function countOf(scope, collection, where) {
  return scope.dao.count(collection, { where: where || {} });
}

async function activeSwitchSessionsOf(scope) {
  const rows = await scope.dao.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, {
    where: { endedAt: null },
    limit: MAX_SCAN
  });
  return rows.filter((row) => row.expiresAt > scope.now).length;
}

// 区间单量/件数：单量按订单计（合并单=1 单，D23）；件数=逐单 parcels 数之和（独立指标，不得替代单量）。
async function rangeOrdersOf(scope, range) {
  const days = RANGE_DAYS[range];
  const from = days === 0 ? startOfDayMs(scope.now) : time.addDays(scope.now, -days);
  const rows = await scope.dao.find(COLLECTIONS.ORDERS, {
    where: { isTest: false },
    orderBy: [['createdAt', 'desc']],
    limit: MAX_SCAN
  });
  const inRange = rows.filter((row) => time.toMs(row.createdAt) >= from);
  return {
    orders: inRange.length,
    parcels: inRange.reduce((sum, row) => sum + dto.parcelCountOf(row), 0)
  };
}

async function inviteSummaryOf(scope) {
  const rows = await scope.dao.find(COLLECTIONS.INVITATION_CODES, {
    orderBy: [['createdAt', 'desc']],
    limit: RECENT_INVITE_SCAN
  });
  const batches = {};
  rows.forEach((row) => {
    const batchId = row.batchId || '';
    if (!batchId) {
      return;
    }
    if (!batches[batchId]) {
      batches[batchId] = { batchId: batchId, count: 0, unused: 0, expiresAt: row.expiresAt || null, createdAt: row.createdAt || null };
    }
    batches[batchId].count += 1;
    if (row.status === enums.INVITATION_STATUS.UNUSED) {
      batches[batchId].unused += 1;
    }
  });
  const recentCodes = rows.slice(0, 10).map((row) => ({
    invitationCode: row.code,
    codeTail: String(row.code || '').slice(-4),
    status: row.status || '',
    batchId: row.batchId || '',
    expiresAt: row.expiresAt || null,
    createdAt: row.createdAt || null
  }));
  return { inviteBatches: Object.keys(batches).map((key) => batches[key]), recentCodes: recentCodes };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const range = parseRange(input.range);
  const test = await testAccountsOf(scope);
  const usersTotal = await countOf(scope, COLLECTIONS.USERS);
  const customersTotal = await countOf(scope, COLLECTIONS.CUSTOMERS);
  const partnersTotal = await countOf(scope, COLLECTIONS.PARTNERS);
  const activePartnersTotal = await countOf(scope, COLLECTIONS.PARTNERS, { status: enums.PARTNER_STATUS.ACTIVE });
  const ordersTotal = await countOf(scope, COLLECTIONS.ORDERS);
  const testOrders = await countOf(scope, COLLECTIONS.ORDERS, { isTest: true });
  const pendingOrdersTotal = await countOf(scope, COLLECTIONS.ORDERS, { status: enums.ORDER_STATUS.SUBMITTED });
  const pendingOrdersTest = await countOf(scope, COLLECTIONS.ORDERS, { status: enums.ORDER_STATUS.SUBMITTED, isTest: true });
  const exceptionsTotal = await countOf(scope, COLLECTIONS.ORDERS, { status: enums.ORDER_STATUS.EXCEPTION });
  const exceptionsTest = await countOf(scope, COLLECTIONS.ORDERS, { status: enums.ORDER_STATUS.EXCEPTION, isTest: true });
  const pendingFailures = await countOf(scope, COLLECTIONS.RECOGNITION_FAILURES, { status: enums.FAILURE_STATUS.PENDING });
  const activeSwitchSessions = await activeSwitchSessionsOf(scope);
  const todayOrders = await rangeOrdersOf(scope, range);  const recentAuditRows = await scope.dao.find(COLLECTIONS.ADMIN_AUDIT, {
    // CONTRACT §11.3 / UX US-D11：多开发者会话与审计互不可见 → 总览「最近审计」只含本人 developerNo。
    where: { developerNo: scope.developerNo },
    orderBy: [['at', 'desc']],
    limit: RECENT_AUDIT_LIMIT
  });
  const invites = await inviteSummaryOf(scope);
  return {
    // 抬头数据源（UX_DEVELOPER §3.1）：当前调用开发者编号，只来自 ADMIN_OPENIDS 环境映射身份，
    // 仅用于后台抬头/审计展示，不参与鉴权；不信任何入参 developerNo（非白名单调用已被入口 FORBIDDEN 拦）。
    developerNo: scope.developerNo,
    counts: {
      users: Math.max(0, usersTotal - test.total),
      customers: Math.max(0, customersTotal - test.customer),
      partners: Math.max(0, partnersTotal - test.partner),
      activePartners: Math.max(0, activePartnersTotal - test.partner),
      orders: Math.max(0, ordersTotal - testOrders),
      pendingOrders: Math.max(0, pendingOrdersTotal - pendingOrdersTest),
      exceptions: Math.max(0, exceptionsTotal - exceptionsTest),
      activeSwitchSessions: activeSwitchSessions,
      pendingRecognitionFailures: pendingFailures
    },
    // 单量按订单计（合并单=1 单）；parcels 为件数独立指标（后台可标注"X 单 / Y 件"，不得替代单量）
    today: { range: range, orders: todayOrders.orders, parcels: todayOrders.parcels },
    test: { testAccounts: test.total, testOrders: testOrders, testCustomers: test.customer, testPartners: test.partner },
    recentAudit: recentAuditRows.map(dto.auditBrief),
    config: dto.configForAdmin(scope.config),
    // 只读 AI 兜底状态（enabled/hasKey/model；Key 只回布尔），用于总览判断环境是否配好
    aiStatus: review.aiStatusOf(scope.ctx, scope.config, scope.now),
    inviteBatches: invites.inviteBatches,
    recentCodes: invites.recentCodes
  };
}

module.exports = handler;
