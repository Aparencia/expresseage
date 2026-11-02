// handlers/order/get.js · order.get：订单详情 + 裁剪事件（type/at/actorRole/note）
// 权限：订单双方 / 切换会话目标本人 / PENDING 转派邀请的目标兼职；admin 真实会话只回脱敏视图。
// D58（批 26）：转派完成后新履约人仍按 §1.4 遮蔽顾客身份（customerNo/昵称头像），但动作条回正常 PARTNER 矩阵（P0-1）；
//               原履约人失联；P2-10：先判读权限再做惰性过期写库（未授权读者不得触发任何写入）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const common = require('./_common');
const dto = require('./_dto');
const transfer = require('./_transfer');
const access = require('./_transfer-access');
const expire = require('./_transfer-expire');

// 读权限：当前履约人/顾客/admin 走原判定；他人仅当"PENDING 邀请目标本人"放行（转派完成后原履约人失联）。
// 返回 {side, partner, transferTarget, maskCustomer}：transferTarget 只决定"邀请卡"视图与剪裁，遮蔽见 maskCustomer。
async function resolveReadAccess(ctx, order) {
  const side = common.orderSideOf(ctx, order);
  if (side === 'ADMIN' || side === 'CUSTOMER') {
    return { side, transferTarget: false, maskCustomer: false };
  }
  const partner = await common.loadScopePartner(ctx);
  if (side === 'PARTNER') {
    return {
      side,
      partner,
      transferTarget: false,
      maskCustomer: await access.maskCustomerOf(ctx, order, partner)
    };
  }
  if (partner && transfer.isPendingTargetOf(order, partner._id)) {
    return { side: '', partner, transferTarget: true, maskCustomer: true };
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
  // P2-10：先鉴权（未授权读者零写库），授权后才做"读到即落库"的惰性过期
  const granted = await resolveReadAccess(ctx, loaded);
  const nowMs = common.nowMsOf(ctx);
  const order = await expire.expireIfNeeded(ctx, loaded, nowMs);
  // 邀请在读的过程中过期：非 owner 的目标关系已不成立 → 一律 FORBIDDEN（不回任何订单内容）
  if (!granted.side && granted.transferTarget && !transfer.isPendingTargetOf(order, granted.partner._id)) {
    throw common.errors.forbidden('无权查看该订单');
  }
  const events = await ctx.dao.find(COLLECTIONS.ORDER_EVENTS, {
    where: { orderId: order._id },
    orderBy: [['at', 'asc']],
    limit: common.EVENT_LIST_LIMIT
  });
  // D58（批 26）：顾客侧事件时间线拉黑 4 个私有转派事件（与 message.list 同口径），TRANSFER_ACCEPTED 可见；
  // 兼职（含转派目标/新履约人）/admin 全量下发（双方与后台需要完整留痕）。
  const eventSide = granted.side || (granted.transferTarget ? 'PARTNER' : '');
  const orderDto = await dto.buildOrderDto(ctx, order, {
    side: granted.side,
    transferTarget: granted.transferTarget,
    maskCustomer: granted.maskCustomer
  });
  return {
    order: orderDto,
    events: dto.buildEventDtos(events, eventSide)
  };
};
