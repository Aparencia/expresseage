// handlers/admin/_test-accounts.js · 测试账号专用件（创建/级联删除/清空数据的可复用步骤；不进业务路径）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  getUserByOpenid,
  getCustomerByNo,
  getPartnerByNo,
  getPartnerByOpenid,
  MAX_UNIQUE_ATTEMPTS
} = require('./_common');
const idGenerator = require('../../lib/id-generator');
const dto = require('./_dto');

const TOTAL_TEST_ACCOUNT_LIMIT = 6;
const SCAN_LIMIT = 200;
const TEST_OPENID_PREFIX = 'TEST-';
const ZERO_STATS = { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0 };

function isCustomerIdentifier(value) {
  return sharedValidate.validateCustomerNo(value).ok;
}

function isPartnerIdentifier(value) {
  return sharedValidate.validatePartnerNo(value).ok;
}

function assertSelfCreated(scope, user) {
  if (!user || user.isTestAccount !== true || user.createdByDeveloperNo !== scope.developerNo) {
    throw errors.notFound('测试账号不存在');
  }
}

async function checkTextSecurity(ctx, text) {
  const cloud = ctx && ctx.cloud;
  const openapi = cloud && cloud.openapi;
  const security = openapi && openapi.security;
  if (!security || typeof security.msgSecCheck !== 'function') {
    return true;
  }
  try {
    const result = await security.msgSecCheck({ content: text });
    const suggest = result && result.result ? result.result.suggest : '';
    if (suggest === 'risky') {
      throw errors.validation('displayName', '昵称包含不允许的内容，请修改');
    }
    return true;
  } catch (error) {
    if (error && error.code === 'VALIDATION_FAILED') {
      throw error;
    }
    if (error && error.errCode === 87014) {
      throw errors.validation('displayName', '昵称包含不允许的内容，请修改');
    }
    console.warn('[admin] msgSecCheck 不可用，昵称内容安全待人工复核');
    return true;
  }
}

async function testAccountsOfDeveloper(scope) {
  const rows = await scope.dao.find(COLLECTIONS.USERS, {
    where: { isTestAccount: true },
    orderBy: [['createdAt', 'desc']],
    limit: 100
  });
  return rows.filter((row) => row.createdByDeveloperNo === scope.developerNo);
}

function rolesOf(user) {
  return Array.isArray(user && user.roles) ? user.roles : [];
}

async function profileOf(scope, user) {
  const roles = rolesOf(user);
  if (roles.indexOf(enums.ROLES.CUSTOMER) >= 0) {
    return scope.dao.get(COLLECTIONS.CUSTOMERS, user._id);
  }
  if (roles.indexOf(enums.ROLES.PARTNER) >= 0) {
    return getPartnerByOpenid(scope, user._id);
  }
  return null;
}

async function quotaOf(scope) {
  const rows = await testAccountsOfDeveloper(scope);
  const perRole = { CUSTOMER: 0, PARTNER: 0 };
  rows.forEach((row) => {
    rolesOf(row).forEach((role) => {
      if (perRole[role] !== undefined) {
        perRole[role] += 1;
      }
    });
  });
  const maxPerRole = Number(scope.config.testAccountMaxPerRole) || 3;
  return { total: rows.length, perRole: perRole, maxPerRole: maxPerRole };
}

function buildCustomerDoc(openid, customerNo, displayName, nowDate) {
  return {
    _id: openid,
    customerNo: customerNo,
    displayName: displayName,
    avatarFileId: '',
    zone: 'D',
    buildingNo: 1,
    room: '101',
    dormKey: 'D1-101',
    phoneTail: '',
    profileCompleted: true,
    createdAt: nowDate,
    updatedAt: nowDate,
    profileUpdatedAt: nowDate
  };
}

function buildPartnerDoc(openid, partnerNo, displayName, nowDate) {
  return {
    openid: openid,
    partnerNo: partnerNo,
    displayName: displayName,
    avatarFileId: '',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: {
      services: enums.SERVICE_CODES.map((code) => ({ code: code, enabled: true })),
      zones: ['D', 'X', 'N', 'B', 'C'],
      acceptingOrders: true
    },
    stats: Object.assign({}, ZERO_STATS),
    activatedAt: nowDate,
    createdAt: nowDate,
    updatedAt: nowDate
  };
}

async function createOnce(scope, role, displayName) {
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt += 1) {
    const openid = idGenerator.generateTestOpenid();
    try {
      const result = await scope.dao.transaction(async (trx) => {
        await trx.add(COLLECTIONS.USERS, {
          _id: openid,
          roles: [role],
          status: 'ACTIVE',
          isTestAccount: true,
          createdByDeveloperNo: scope.developerNo,
          testLastUsedAt: null,
          messageReadAt: 0,
          privacyConsent: null,
          deletionRequestedAt: 0,
          createdAt: scope.nowDate,
          updatedAt: scope.nowDate
        });
        const generator = role === enums.ROLES.CUSTOMER ? idGenerator.generateCustomerNo : idGenerator.generatePartnerNo;
        const collection = role === enums.ROLES.CUSTOMER ? COLLECTIONS.CUSTOMERS : COLLECTIONS.PARTNERS;
        const field = role === enums.ROLES.CUSTOMER ? 'customerNo' : 'partnerNo';
        const inserted = await idGenerator.insertUnique(trx, collection, {
          field: field,
          generate: generator,
          build(no) {
            return role === enums.ROLES.CUSTOMER
              ? buildCustomerDoc(openid, no, displayName, scope.nowDate)
              : buildPartnerDoc(openid, no, displayName, scope.nowDate);
          }
        });
        return { openid: openid, targetNo: inserted.value, role: role };
      });
      return result;
    } catch (error) {
      if (!scope.dao.isDuplicateError(error)) {
        throw error;
      }
    }
  }
  throw errors.dependencyFailed('测试账号创建失败，请稍后重试');
}

async function replayCreate(scope, replay) {
  if (!replay || !replay.detail || !replay.detail.targetNo) {
    return null;
  }
  const role = replay.detail.role;
  const profile = role === enums.ROLES.CUSTOMER
    ? await getCustomerByNo(scope, replay.detail.targetNo)
    : await getPartnerByNo(scope, replay.detail.targetNo);
  return {
    targetNo: replay.detail.targetNo,
    role: role,
    displayName: replay.detail.displayNameMasked || (profile ? dto.maskedName(profile.displayName) : ''),
    isTestAccount: true,
    duplicated: true
  };
}

async function resolveTestUser(scope, identifier) {
  const raw = typeof identifier === 'string' ? identifier.trim().toUpperCase() : '';
  if (!raw) {
    throw errors.validation('testAccountId', '请选择要删除的测试账号');
  }
  let user = null;
  if (raw.indexOf(TEST_OPENID_PREFIX) === 0) {
    user = await getUserByOpenid(scope, raw);
  } else if (isCustomerIdentifier(raw)) {
    const check = sharedValidate.validateCustomerNo(raw);
    const customer = await getCustomerByNo(scope, check.canonical);
    if (customer) {
      user = await getUserByOpenid(scope, customer._id);
    }
  } else if (isPartnerIdentifier(raw)) {
    const check = sharedValidate.validatePartnerNo(raw);
    const partner = await getPartnerByNo(scope, check.canonical);
    if (partner) {
      user = await getUserByOpenid(scope, partner.openid);
    }
  } else {
    throw errors.validation('testAccountId', '测试账号标识不正确');
  }
  assertSelfCreated(scope, user);
  return user;
}

async function ordersOfAccount(scope, user) {
  const partner = await getPartnerByOpenid(scope, user._id);
  const asCustomer = await scope.dao.find(COLLECTIONS.ORDERS, { where: { customerId: user._id }, limit: SCAN_LIMIT });
  const asPartner = partner
    ? await scope.dao.find(COLLECTIONS.ORDERS, { where: { partnerId: partner._id }, limit: SCAN_LIMIT })
    : [];
  const map = {};
  asCustomer.concat(asPartner).forEach((order) => {
    map[order._id] = order;
  });
  return Object.keys(map).map((key) => map[key]);
}

async function bindingsOfAccount(scope, user) {
  const partner = await getPartnerByOpenid(scope, user._id);
  const asCustomer = await scope.dao.find(COLLECTIONS.BINDINGS, { where: { customerId: user._id }, limit: SCAN_LIMIT });
  const asPartner = partner
    ? await scope.dao.find(COLLECTIONS.BINDINGS, { where: { partnerId: partner._id }, limit: SCAN_LIMIT })
    : [];
  return asCustomer.concat(asPartner);
}

async function countCascade(scope, user) {
  const orders = await ordersOfAccount(scope, user);
  const bindings = await bindingsOfAccount(scope, user);
  const failures = await scope.dao.find(COLLECTIONS.RECOGNITION_FAILURES, {
    where: { uploaderOpenid: user._id },
    limit: SCAN_LIMIT
  });
  const tickets = await scope.dao.count(COLLECTIONS.UPLOAD_TICKETS, { where: { openid: user._id } });
  const customer = await scope.dao.get(COLLECTIONS.CUSTOMERS, user._id);
  const partner = await getPartnerByOpenid(scope, user._id);
  return { orders: orders, bindings: bindings, failures: failures, tickets: tickets, customer: customer, partner: partner };
}

function profileFiles(data) {
  const files = [];
  if (data.customer && data.customer.avatarFileId) {
    files.push(data.customer.avatarFileId);
  }
  if (data.partner && data.partner.avatarFileId) {
    files.push(data.partner.avatarFileId);
  }
  data.failures.forEach((failure) => {
    if (failure.fileId) {
      files.push(failure.fileId);
    }
  });
  return files;
}

async function deleteFiles(ctx, fileIds) {
  const list = fileIds.filter(function isFile(value) {
    return typeof value === 'string' && value !== '';
  });
  if (list.length === 0) {
    return 0;
  }
  const cloud = ctx && ctx.cloud;
  if (!cloud || typeof cloud.deleteFile !== 'function') {
    return 0;
  }
  try {
    await cloud.deleteFile({ fileList: list });
    return list.length;
  } catch (error) {
    console.warn('[admin] 测试数据文件删除失败，交 cleanup 兜底');
    return 0;
  }
}

async function endSessionsOfAccount(scope, user) {
  const rows = await scope.dao.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, {
    where: { targetId: user._id, endedAt: null },
    limit: SCAN_LIMIT
  });
  for (let i = 0; i < rows.length; i += 1) {
    const session = rows[i];
    await scope.dao.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, session._id, {
      endedAt: scope.nowDate,
      updatedAt: scope.nowDate
    });
    await scope.writeAudit(
      AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
      { type: 'view_session', id: session._id },
      {
        viewMode: session.viewMode || '',
        role: session.role || '',
        targetNo: session.targetNo || '',
        targetIsTest: true,
        reason: 'TEST_ACCOUNT_DELETED'
      },
      'switch-end:' + session._id
    );
  }
  return rows.length;
}

function zeroCounts() {
  return { orders: 0, events: 0, messages: 0, bindings: 0, failures: 0, tickets: 0, avatarFiles: 0 };
}

async function cascadeDelete(scope, user, data) {
  let removedEvents = 0;
  let removedMessages = 0;
  for (let i = 0; i < data.orders.length; i += 1) {
    const order = data.orders[i];
    const eventResult = await scope.dao.removeWhere(COLLECTIONS.ORDER_EVENTS, { orderId: order._id });
    const messageResult = await scope.dao.removeWhere(COLLECTIONS.ORDER_MESSAGES, { orderId: order._id });
    removedEvents += eventResult.removed;
    removedMessages += messageResult.removed;
    await scope.dao.remove(COLLECTIONS.ORDERS, order._id);
  }
  let removedBindings = 0;
  for (let i = 0; i < data.bindings.length; i += 1) {
    const result = await scope.dao.remove(COLLECTIONS.BINDINGS, data.bindings[i]._id);
    removedBindings += result.removed;
  }
  let removedFailures = 0;
  for (let i = 0; i < data.failures.length; i += 1) {
    const result = await scope.dao.remove(COLLECTIONS.RECOGNITION_FAILURES, data.failures[i]._id);
    removedFailures += result.removed;
  }
  const ticketResult = await scope.dao.removeWhere(COLLECTIONS.UPLOAD_TICKETS, { openid: user._id });
  const sessionsEnded = await endSessionsOfAccount(scope, user);
  await scope.dao.remove(COLLECTIONS.CUSTOMERS, user._id);
  if (data.partner) {
    await scope.dao.remove(COLLECTIONS.PARTNERS, data.partner._id);
  }
  await scope.dao.remove(COLLECTIONS.USERS, user._id);
  const removedFiles = await deleteFiles(scope.ctx, profileFiles(data));
  return {
    orders: data.orders.length,
    events: removedEvents,
    messages: removedMessages,
    bindings: removedBindings,
    failures: removedFailures,
    tickets: ticketResult.removed,
    avatarFiles: removedFiles,
    sessionsEnded: sessionsEnded
  };
}

async function collectTestData(scope, openids) {
  const orderMap = {};
  const bindingMap = {};
  const failureMap = {};
  let tickets = 0;
  for (let i = 0; i < openids.length; i += 1) {
    const openid = openids[i];
    const partner = await getPartnerByOpenid(scope, openid);
    const orders = await scope.dao.find(COLLECTIONS.ORDERS, { where: { customerId: openid }, limit: SCAN_LIMIT });
    const partnerOrders = partner
      ? await scope.dao.find(COLLECTIONS.ORDERS, { where: { partnerId: partner._id }, limit: SCAN_LIMIT })
      : [];
    orders.concat(partnerOrders).forEach((order) => {
      if (order.isTest === true) {
        orderMap[order._id] = order;
      }
    });
    const bindings = await scope.dao.find(COLLECTIONS.BINDINGS, { where: { customerId: openid }, limit: SCAN_LIMIT });
    const partnerBindings = partner
      ? await scope.dao.find(COLLECTIONS.BINDINGS, { where: { partnerId: partner._id }, limit: SCAN_LIMIT })
      : [];
    bindings.concat(partnerBindings).forEach((binding) => {
      bindingMap[binding._id] = binding;
    });
    const failures = await scope.dao.find(COLLECTIONS.RECOGNITION_FAILURES, {
      where: { uploaderOpenid: openid },
      limit: SCAN_LIMIT
    });
    failures.forEach((failure) => {
      failureMap[failure._id] = failure;
    });
    tickets += await scope.dao.count(COLLECTIONS.UPLOAD_TICKETS, { where: { openid: openid } });
  }
  return {
    orders: Object.keys(orderMap).map((key) => orderMap[key]),
    bindings: Object.keys(bindingMap).map((key) => bindingMap[key]),
    failures: Object.keys(failureMap).map((key) => failureMap[key]),
    tickets: tickets
  };
}

module.exports = {
  TOTAL_TEST_ACCOUNT_LIMIT,
  SCAN_LIMIT,
  ZERO_STATS,
  isCustomerIdentifier,
  isPartnerIdentifier,
  assertSelfCreated,
  checkTextSecurity,
  testAccountsOfDeveloper,
  rolesOf,
  profileOf,
  quotaOf,
  createOnce,
  replayCreate,
  resolveTestUser,
  countCascade,
  cascadeDelete,
  collectTestData,
  endSessionsOfAccount,
  deleteFiles,
  zeroCounts
};
