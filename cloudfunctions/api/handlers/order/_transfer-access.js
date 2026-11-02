// handlers/order/_transfer-access.js · D58 转派读侧边界：顾客身份遮蔽判定 / 幂等重放鉴权 / expectedVersion 闸
// 口径：草案 §1.4 可见性矩阵（目标列 customerNo/昵称头像必须不返回）+ P1-1（重放前读权限复检）+
//       P2-7（四动作接 ctx.expectedVersion，与 runOrderAction 同形）+ P2-11（二次转派不解除遮蔽）。
// 边界：只读判定，零写库；视图装配仍走 _transfer.viewOf / _dto.buildOrderDto（本文件只给 options）。
'use strict';

const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const store = require('./_store');
const transfer = require('./_transfer');

const BINDING_IN_BATCH = 20;

function isPartnerOf(order, partner) {
  return !!partner && transfer.sameId(order && order.partnerId, partner._id);
}

// 遮蔽（不给 customerNo/counterpart/guest）判定：
// ① PENDING 邀请目标恒遮蔽（邀请卡视图，草案 §1.4 目标列）；
// ② 现任履约人按「履约人 ≠ 顾客当前 ACTIVE 绑定兼职」遮蔽——转派来的单在二次转派覆盖 transfer 块后
//    仍保持遮蔽（P2-11），转派回绑定兼职本人时恢复完整视图；
// ③ 从未转派过的单保持既有行为（零变化：由绑定是否指向本人决定，不额外引入新遮蔽面）。
async function maskCustomerOf(ctx, order, partner) {
  if (!partner) {
    return false;
  }
  if (transfer.isPendingTargetOf(order, partner._id)) {
    return true;
  }
  if (!isPartnerOf(order, partner) || !transfer.transferOf(order)) {
    return false;
  }
  const binding = await store.getActiveBinding(ctx, order.customerId);
  return !(binding && transfer.sameId(binding.partnerId, order.partnerId));
}

// 列表行批量遮蔽：与 orders 等长的布尔数组；绑定按 customerId 一次批量取（不做逐行 N+1）。
// 代客单（customerId=''）无绑定：转派进入后同样遮蔽（只有 delivery/parcels 等履约必需字段保留）。
async function boundPartnerIdsOf(ctx, customerIds) {
  const bound = {};
  for (let i = 0; i < customerIds.length; i += BINDING_IN_BATCH) {
    const rows = await ctx.dao.find(store.COLLECTIONS.BINDINGS, {
      where: {
        customerId: ctx.dao.command('in', customerIds.slice(i, i + BINDING_IN_BATCH)),
        status: enums.BINDING_STATUS.ACTIVE
      }
    });
    rows.forEach((row) => {
      const customerId = transfer.textOf(row && row.customerId);
      if (customerId && !bound[customerId]) {
        bound[customerId] = transfer.textOf(row.partnerId);
      }
    });
  }
  return bound;
}

async function maskFlagsOf(ctx, orders, partner) {
  const list = Array.isArray(orders) ? orders : [];
  const flags = list.map(() => false);
  const pending = [];
  list.forEach((order, index) => {
    if (!partner) {
      return;
    }
    if (transfer.isPendingTargetOf(order, partner._id)) {
      flags[index] = true;
      return;
    }
    if (!isPartnerOf(order, partner) || !transfer.transferOf(order)) {
      return;
    }
    const customerId = transfer.textOf(order.customerId);
    if (!customerId) {
      flags[index] = true;
      return;
    }
    pending.push({ index, customerId });
  });
  if (pending.length === 0) {
    return flags;
  }
  const customerIds = [];
  pending.forEach((item) => {
    if (customerIds.indexOf(item.customerId) < 0) {
      customerIds.push(item.customerId);
    }
  });
  const boundPartnerIdOf = await boundPartnerIdsOf(ctx, customerIds);
  pending.forEach((item) => {
    const boundPartnerId = boundPartnerIdOf[item.customerId] || '';
    flags[item.index] = !boundPartnerId || !transfer.sameId(boundPartnerId, list[item.index].partnerId);
  });
  return flags;
}

// P1-1：幂等重放前校验事件发起人就是当前业务身份（猜 clientRequestId 撞他人事件 → FORBIDDEN，不回带细节）
function assertReplayActor(ctx, event) {
  const scope = store.scopeOf(ctx);
  const actorId = transfer.textOf(event && event.actorId);
  if (!actorId || !scope.openid || actorId !== scope.openid) {
    throw errors.forbidden('无权查看该订单');
  }
}

// 重放响应的视图 options（等价 order.get 的读权限）：现任履约人/顾客/admin/仍为本次转派目标的本人可读；
// 转派完成后原履约人已非参与方 → FORBIDDEN（不回任何订单内容）。目标本人在 DECLINED/EXPIRED 后仍可重放
// 自己动作的结果（仅遮蔽视图），不影响其他场景的失联判据。
async function replayViewOf(ctx, order, event) {
  assertReplayActor(ctx, event);
  const scope = store.scopeOf(ctx);
  const side = store.orderSideOf(ctx, order);
  if (side === 'ADMIN' || side === 'CUSTOMER') {
    return { side, transferTarget: false, maskCustomer: false };
  }
  const partner = await store.getPartnerByOpenid(ctx, scope.openid);
  if (side === 'PARTNER') {
    return {
      side: 'PARTNER',
      transferTarget: false,
      maskCustomer: await maskCustomerOf(ctx, order, partner)
    };
  }
  const block = transfer.transferOf(order);
  if (partner && block && transfer.sameId(block.toPartnerId, partner._id)) {
    return { side: '', transferTarget: true, maskCustomer: true };
  }
  throw errors.forbidden('无权查看该订单');
}

// P2-7：与 runOrderAction 同形的期望版本闸（不传=不校验；不符=CONFLICT，零写库）
function assertExpectedVersion(ctx, order) {
  const expected = ctx && typeof ctx.expectedVersion === 'number' ? ctx.expectedVersion : null;
  if (expected !== null && expected !== order.version) {
    throw errors.conflict('订单已被更新，请刷新后重试');
  }
}

module.exports = {
  maskCustomerOf,
  maskFlagsOf,
  assertReplayActor,
  replayViewOf,
  assertExpectedVersion
};
