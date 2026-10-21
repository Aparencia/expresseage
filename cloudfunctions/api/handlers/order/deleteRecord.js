// handlers/order/deleteRecord.js · order.deleteRecord：顾客删除已完成订单记录（软删，7 天后 cleanup 物理删）
// 只从自己列表隐藏：不硬删、不动归属；重复调用自然幂等返回首次时间。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const dto = require('./_dto');

module.exports = async function orderDeleteRecord(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const orderNo = common.normalizeOrderNoInput(payload && payload.orderNo);
  const order = await common.getOrderByNo(ctx, orderNo);
  if (!order) {
    throw errors.notFound('订单不存在或不可查看');
  }
  common.assertTestOrderVisible(ctx, order);
  if (scope.role !== enums.ROLES.CUSTOMER || order.customerId !== scope.openid) {
    throw errors.forbidden('只有下单顾客可以删除自己的已完成订单');
  }
  if (order.status !== enums.ORDER_STATUS.COMPLETED) {
    throw errors.invalidState('只有已完成订单可以删除记录');
  }
  if (order.deletedByCustomerAt) {
    return { deletedByCustomerAt: dto.isoOf(order.deletedByCustomerAt), duplicated: true };
  }
  return common.runOrderAction(ctx, payload, {
    action: 'order.deleteRecord',
    build(input) {
      return {
        set: { deletedByCustomerAt: input.nowDate },
        eventType: 'DELETED_BY_CUSTOMER',
        payload: {},
        deletedByCustomerAt: input.nowDate
      };
    },
    extraResult(input) {
      return { deletedByCustomerAt: dto.isoOf(input.built.deletedByCustomerAt) };
    }
  });
};
