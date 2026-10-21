// handlers/admin/_test-account-ops.js · 测试账号删除/清空的级联操作（专供 testAccounts.js；不进业务路径）
// 口径：ENGINEERING §4.11、DATA_MODEL §2.13⑥/§4.10/§7.8——双条件安全闸、真实引用即拒、
// 级联删账号+资料+订单/事件/留言/绑定/失败记录+头像文件、先结束会话再删数据、审计记前后条数。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  errors,
  sharedValidate,
  getUserByOpenid,
  getCustomerByNo,
  getPartnerByNo,
  getPartnerByOpenid,
  getPartnerById
} = require('./_common');
const accounts = require('./_test-accounts');

const SCAN_LIMIT = 200;
const REAL_REFERENCE_DELETE = '该测试账号存在真实数据引用，不能删除';
const REAL_REFERENCE_PURGE = '测试数据存在真实数据引用，不能清空';

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

async function isTestUserOf(scope, openid) {
  const user = await getUserByOpenid(scope, openid);
  return !!(user && user.isTestAccount === true);
}

// 参与真实数据的判定：订单 isTest 非 true、绑定的对侧账号非测试、留言挂在非测试订单上。
async function realReferenceOf(scope, user) {
  const partner = await getPartnerByOpenid(scope, user._id);
  const asCustomer = await scope.dao.find(COLLECTIONS.ORDERS, { where: { customerId: user._id }, limit: SCAN_LIMIT });
  const asPartner = partner
    ? await scope.dao.find(COLLECTIONS.ORDERS, { where: { partnerId: partner._id }, limit: SCAN_LIMIT })
    : [];
  const orders = asCustomer.concat(asPartner);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i].isTest !== true) {
      return true;
    }
  }
  const bindings = await bindingsOfAccount(scope, user);
  for (let i = 0; i < bindings.length; i += 1) {
    const binding = bindings[i];
    if (binding.customerId === user._id) {
      const other = binding.partnerId ? await getPartnerById(scope, binding.partnerId) : null;
      if (!other || !(await isTestUserOf(scope, other.openid))) {
        return true;
      }
    } else if (!(await isTestUserOf(scope, binding.customerId))) {
      return true;
    }
  }
  const messages = await scope.dao.find(COLLECTIONS.ORDER_MESSAGES, {
    where: { fromId: user._id },
    limit: SCAN_LIMIT
  });
  for (let i = 0; i < messages.length; i += 1) {
    const order = messages[i].orderId ? await scope.dao.get(COLLECTIONS.ORDERS, messages[i].orderId) : null;
    if (!order || order.isTest !== true) {
      return true;
    }
  }
  return false;
}

async function assertNoRealReference(scope, user) {
  if (await realReferenceOf(scope, user)) {
    throw errors.invalidState(REAL_REFERENCE_DELETE);
  }
}

async function assertNoRealReferenceToOpenids(scope, openids) {
  for (let i = 0; i < openids.length; i += 1) {
    const user = await getUserByOpenid(scope, openids[i]);
    if (!user) {
      continue;
    }
    if (await realReferenceOf(scope, user)) {
      throw errors.invalidState(REAL_REFERENCE_PURGE);
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
  const map = {};
  asCustomer.concat(asPartner).forEach((binding) => {
    map[binding._id] = binding;
  });
  return Object.keys(map).map((key) => map[key]);
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

// 待删文件：头像（顾客/兼职各一）+ 失败记录原图（同图多单共享 fileId 时去重）
function filesOf(data) {
  const seen = {};
  const files = [];
  const push = (fileId) => {
    if (typeof fileId === 'string' && fileId !== '' && !seen[fileId]) {
      seen[fileId] = true;
      files.push(fileId);
    }
  };
  if (data.customer) {
    push(data.customer.avatarFileId);
  }
  if (data.partner) {
    push(data.partner.avatarFileId);
  }
  (data.failures || []).forEach((failure) => push(failure.fileId));
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

async function sessionsOfTargets(scope, targetIds) {
  const rows = [];
  for (let i = 0; i < targetIds.length; i += 1) {
    const found = await scope.dao.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, {
      where: { targetId: targetIds[i], endedAt: null },
      limit: SCAN_LIMIT
    });
    found.forEach((row) => rows.push(row));
  }
  return rows;
}

async function countSessionsOfTargets(scope, targetIds) {
  const rows = await sessionsOfTargets(scope, targetIds);
  return rows.length;
}

async function endSessionsOfTargets(scope, targetIds, reason) {
  const rows = await sessionsOfTargets(scope, targetIds);
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
        targetIsTest: !!session.targetIsTest,
        reason: reason || 'TARGET_DELETED'
      },
      'switch-end:' + session._id
    );
  }
  return rows.length;
}

async function endSessionsOfAccount(scope, user) {
  return endSessionsOfTargets(scope, [user._id], 'TARGET_DELETED');
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
  const removedFiles = await deleteFiles(scope.ctx, filesOf(data));
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

// 清空测试业务数据（账号保留）：订单+事件/留言、绑定、失败记录+原图、上传票据；
// 最后结束这些测试账号的活跃切换会话（审计 ACCOUNT_SWITCH_END，reason=TEST_DATA_PURGED）。
async function purgeCollectedData(scope, openids, data) {
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
  const failureFiles = [];
  for (let i = 0; i < data.failures.length; i += 1) {
    const failure = data.failures[i];
    const result = await scope.dao.remove(COLLECTIONS.RECOGNITION_FAILURES, failure._id);
    removedFailures += result.removed;
    if (failure.fileId) {
      failureFiles.push(failure.fileId);
    }
  }
  let removedTickets = 0;
  for (let i = 0; i < openids.length; i += 1) {
    const result = await scope.dao.removeWhere(COLLECTIONS.UPLOAD_TICKETS, { openid: openids[i] });
    removedTickets += result.removed;
  }
  const removedFiles = await deleteFiles(scope.ctx, failureFiles);
  const sessionsEnded = await endSessionsOfTargets(scope, openids, 'TEST_DATA_PURGED');
  return {
    orders: data.orders.length,
    events: removedEvents,
    messages: removedMessages,
    bindings: removedBindings,
    failures: removedFailures,
    tickets: removedTickets,
    files: removedFiles,
    sessionsEnded: sessionsEnded
  };
}

module.exports = {
  SCAN_LIMIT,
  REAL_REFERENCE_DELETE,
  REAL_REFERENCE_PURGE,
  resolveTestUser,
  assertNoRealReference,
  assertNoRealReferenceToOpenids,
  countCascade,
  cascadeDelete,
  collectTestData,
  purgeCollectedData,
  endSessionsOfAccount,
  endSessionsOfTargets,
  countSessionsOfTargets,
  deleteFiles,
  filesOf,
  zeroCounts
};
