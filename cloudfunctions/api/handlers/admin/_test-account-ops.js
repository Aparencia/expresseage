// handlers/admin/_test-account-ops.js · 测试账号删除/清空的级联操作（专供 testAccounts.js；不进业务路径）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  errors,
  sharedValidate,
  getUserByOpenid,
  getCustomerByNo,
  getPartnerByNo,
  getPartnerByOpenid
} = require('./_common');
const accounts = require('./_test-accounts');

const SCAN_LIMIT = 200;

async function resolveTestUser(scope, identifier) {
  const raw = typeof identifier === 'string' ? identifier.trim().toUpperCase() : '';
  if (!raw) {
    throw errors.validation('testAccountId', '请选择要删除的测试账号');
  }
  let user = null;
  if (raw.indexOf(accounts.TEST_OPENID_PREFIX) === 0) {
    user = await getUserByOpenid(scope, raw);
  } else if (accounts.isCustomerIdentifier(raw)) {
    const check = sharedValidate.validateCustomerNo(raw);
    const customer = await getCustomerByNo(scope, check.canonical);
    if (customer) {
      user = await getUserByOpenid(scope, customer._id);
    }
  } else if (accounts.isPartnerIdentifier(raw)) {
    const check = sharedValidate.validatePartnerNo(raw);
    const partner = await getPartnerByNo(scope, check.canonical);
    if (partner) {
      user = await getUserByOpenid(scope, partner.openid);
    }
  } else {
    throw errors.validation('testAccountId', '测试账号标识不正确');
  }
  accounts.assertSelfCreated(scope, user);
  return user;
}

async function assertNoRealReference(scope, user) {
  const partner = await getPartnerByOpenid(scope, user._id);
  const asCustomer = await scope.dao.count(COLLECTIONS.ORDERS, { where: { customerId: user._id, isTest: false } });
  const asPartner = partner
    ? await scope.dao.count(COLLECTIONS.ORDERS, { where: { partnerId: partner._id, isTest: false } })
    : 0;
  if (asCustomer > 0 || asPartner > 0) {
    throw errors.invalidState('该测试账号存在真实数据引用，不能删除');
  }
}

async function assertNoRealReferenceToOpenids(scope, openids) {
  for (let i = 0; i < openids.length; i += 1) {
    const openid = openids[i];
    const partner = await getPartnerByOpenid(scope, openid);
    const asCustomer = await scope.dao.count(COLLECTIONS.ORDERS, { where: { customerId: openid, isTest: false } });
    const asPartner = partner
      ? await scope.dao.count(COLLECTIONS.ORDERS, { where: { partnerId: partner._id, isTest: false } })
      : 0;
    if (asCustomer > 0 || asPartner > 0) {
      throw errors.invalidState('测试数据存在真实数据引用，不能清空');
    }
  }
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

async function childCountsOfOrders(scope, orders) {
  let events = 0;
  let messages = 0;
  for (let i = 0; i < orders.length; i += 1) {
    events += await scope.dao.count(COLLECTIONS.ORDER_EVENTS, { where: { orderId: orders[i]._id } });
    messages += await scope.dao.count(COLLECTIONS.ORDER_MESSAGES, { where: { orderId: orders[i]._id } });
  }
  return { events: events, messages: messages };
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
  const children = await childCountsOfOrders(scope, orders);
  return {
    orders: orders,
    bindings: bindings,
    failures: failures,
    tickets: tickets,
    customer: customer,
    partner: partner,
    events: children.events,
    messages: children.messages
  };
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
  const orderRows = Object.keys(orderMap).map((key) => orderMap[key]);
  const children = await childCountsOfOrders(scope, orderRows);
  return {
    orders: orderRows,
    bindings: Object.keys(bindingMap).map((key) => bindingMap[key]),
    failures: Object.keys(failureMap).map((key) => failureMap[key]),
    tickets: tickets,
    events: children.events,
    messages: children.messages
  };
}

module.exports = {
  SCAN_LIMIT,
  resolveTestUser,
  assertNoRealReference,
  assertNoRealReferenceToOpenids,
  countCascade,
  cascadeDelete,
  collectTestData,
  endSessionsOfAccount,
  deleteFiles,
  zeroCounts
};
