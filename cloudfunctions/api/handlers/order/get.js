// handlers/order/get.js · order.get：订单详情 + 裁剪事件（type/at/actorRole/note）
// 权限：订单双方 / 切换会话目标本人 / PENDING 转派邀请的目标兼职；admin 真实会话只回脱敏视图。
// D58（批 26）：目标兼职在邀请有效期内可读（读前先惰性过期），目标视图按 DTO §1.4 遮蔽顾客昵称头像/customerNo。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const common = require('./_common');
const dto = require('./_dto');
const transfer = require('./_transfer');

// 读权限：当前履约人/顾客/admin 走原判定；他人仅当"PENDING 邀请目标本人"放行（转派完成后原履约人失联）
async function resolveReadAccess(ctx, order) {
  const side = common.orderSideOf(ctx, order);
  if (side) {
    if (side !== 'PARTNER') {
      return { side, transferTarget: false };
    }
    const partner = await common.loadScopePartner(ctx);
    return { side, transferTarget: transfer.isTargetOf(order, partner && partner._id) };
  }
  const partner = await common.loadScopePartner(ctx);
  if (partner && transfer.isPendingTargetOf(order, partner._id)) {
    return { side: '', transferTarget: true };
  }
  throw common.errors.forbidden('无权查看该订单');
}

module.exports = async function orderGet(ctx, payload) {
  const orderNo = common.normalizeOrderNoInput(payload && payload.orderNo);
  const loaded = await common.getOrderByNo(ctx, orderNo);
  if (!loaded) {
    throw common.errors.notFound('订单不存在或不可查看');
  }
  common.assertTestOrderVisible(ctx, loaded);
  const nowMs = common.nowMsOf(ctx);
  const order = await transfer.expireIfNeeded(ctx, loaded, nowMs);
  const access = await resolveReadAccess(ctx, order);
  const events = await ctx.dao.find(COLLECTIONS.ORDER_EVENTS, {
    where: { orderId: order._id },
    orderBy: [['at', 'asc']],
    limit: common.EVENT_LIST_LIMIT
  });
  // D58（批 26）：顾客侧事件时间线拉黑 4 个私有转派事件（与 message.list 同口径），TRANSFER_ACCEPTED 可见；
  // 兼职（含转派目标）/admin 全量下发（双方与后台需要完整留痕）。
  const eventSide = access.side || (access.transferTarget ? 'PARTNER' : '');
  const orderDto = await dto.buildOrderDto(ctx, order, {
    side: access.side,
    transferTarget: access.transferTarget
  });
  return {
    order: orderDto,
    events: dto.buildEventDtos(events, eventSide)
  };
};
