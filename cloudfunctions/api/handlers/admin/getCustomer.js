// handlers/admin/getCustomer.js · admin.getCustomer（脱敏资料 + 绑定摘要 + 订单概览/最近订单）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  assertValid,
  getCustomerByNo,
  getActiveBindingOfCustomer,
  getPartnerById
} = require('./_common');
const dto = require('./_dto');

const ORDER_STATUSES = enums.ORDER_STATUS_LIST;

async function orderSummaryOf(scope, customerId) {
  const counts = await Promise.all(ORDER_STATUSES.map((status) => scope.dao.count(COLLECTIONS.ORDERS, {
    where: { customerId: customerId, status: status }
  })));
  const byStatus = {};
  ORDER_STATUSES.forEach((status, index) => {
    byStatus[status] = counts[index] || 0;
  });
  const total = ORDER_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  return {
    activeOrders: byStatus.SUBMITTED + byStatus.ACCEPTED + byStatus.PICKED + byStatus.DELIVERED,
    exceptionOrders: byStatus.EXCEPTION,
    completedOrders: byStatus.COMPLETED,
    cancelledOrders: byStatus.CANCELLED,
    totalOrders: total,
    byStatus: byStatus
  };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const check = assertValid(sharedValidate.validateCustomerNo(input.customerNo), '顾客编号格式不正确');
  const customer = await getCustomerByNo(scope, check.canonical);
  if (!customer) {
    throw errors.notFound('记录不存在或已注销');
  }
  const isTest = await scope.isTestAccount(customer._id);
  if (isTest && input.includeTest !== true) {
    throw errors.notFound('记录不存在或已注销');
  }
  const binding = await getActiveBindingOfCustomer(scope, customer._id);
  const partner = binding ? await getPartnerById(scope, binding.partnerId) : null;
  const orderSummary = await orderSummaryOf(scope, customer._id);
  const recentRows = await scope.dao.find(COLLECTIONS.ORDERS, {
    where: { customerId: customer._id },
    orderBy: [['statusUpdatedAt', 'desc']],
    limit: 10
  });
  const recentOrders = recentRows.map((order) => dto.orderBrief(order, order.isTest === true));
  return {
    customer: dto.customerDetail(customer, {
      binding: binding,
      partner: partner,
      isTest: isTest,
      orderSummary: orderSummary
    }),
    recentOrders: recentOrders
  };
}

module.exports = handler;
