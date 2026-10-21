// handlers/order/undo.js · order.undo：撤销 markPicked/markDelivered（仅 5 秒窗、无后续状态变化）
// 接单不可撤销（误接单走 order.cancel）；批量由客户端逐单调用并共享 batchActionId，服务端逐单校验。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');

const UNDOABLE_EVENTS = {
  PICKED: { status: enums.ORDER_STATUS.PICKED, clearField: 'pickedAt' },
  DELIVERED: { status: enums.ORDER_STATUS.DELIVERED, clearField: 'deliveredAt' }
};

async function findLatestEvent(ctx, orderId) {
  const events = await ctx.dao.find(COLLECTIONS.ORDER_EVENTS, {
    where: { orderId },
    orderBy: [['at', 'desc']],
    limit: 2
  });
  return events[0] || null;
}

module.exports = async function orderUndo(ctx, payload) {
  return common.runOrderAction(ctx, payload, {
    action: 'order.undo',
    async guard(input) {
      const undo = orderState.UNDO_TARGETS[input.order.status];
      if (!undo) {
        throw errors.invalidState('当前订单没有可撤销的操作');
      }
      const latest = await findLatestEvent(input.ctx, input.order._id);
      const latestSpec = latest ? UNDOABLE_EVENTS[latest.type] : null;
      if (!latestSpec || latestSpec.status !== input.order.status) {
        throw errors.invalidState('订单已有后续操作，无法撤销');
      }
      const elapsed = input.now - time.toMs(latest.at);
      if (elapsed > orderState.UNDO_WINDOW_MS) {
        throw errors.invalidState('已超过 5 秒撤销时限，请刷新后重试');
      }
      return { undo, latestAt: latest.at, clearField: latestSpec.clearField };
    },
    build(input) {
      const set = {};
      set[input.checked.clearField] = null;
      return {
        set,
        toStatus: input.checked.undo.to,
        eventType: input.checked.undo.event,
        payload: {
          undoneAction: input.checked.undo.undoneAction,
          previousAt: input.checked.latestAt ? new Date(time.toMs(input.checked.latestAt)) : null
        },
        undoneAction: input.checked.undo.undoneAction
      };
    },
    extraResult(input) {
      return { undoneAction: input.built.undoneAction || '' };
    }
  });
};
