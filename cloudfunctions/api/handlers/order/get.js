// handlers/order/get.js · order.get：订单详情 + 裁剪事件（type/at/actorRole/note）
// 权限：订单双方 / 切换会话目标本人；admin 真实会话只回脱敏视图（完整 L3 只经只读视角，见 §7.7）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const common = require('./_common');
const dto = require('./_dto');

module.exports = async function orderGet(ctx, payload) {
  const orderNo = common.normalizeOrderNoInput(payload && payload.orderNo);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertOrderVisible(ctx, order);
  common.assertTestOrderVisible(ctx, order);
  const events = await ctx.dao.find(COLLECTIONS.ORDER_EVENTS, {
    where: { orderId: order._id },
    orderBy: [['at', 'asc']],
    limit: common.EVENT_LIST_LIMIT
  });
  const orderDto = await dto.buildOrderDto(ctx, order, { side });
  return {
    order: orderDto,
    events: dto.buildEventDtos(events)
  };
};
