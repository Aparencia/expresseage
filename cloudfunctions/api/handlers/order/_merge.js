// handlers/order/_merge.js · v1.0 合并窗口（D23）：候选查找 / 追加幂等重放识别 / 事务内追加包裹
// 口径：CONTRACT v1.0 §4.1/§5.2（D23/D25）——同顾客+同绑定兼职+同 source（仅顾客单）+ 已有 SUBMITTED
//       + createdAt 在 config.orderMergeWindowMinutes 内 + delivery 相同 + serviceCode/appoint/note 相同 → 追加包裹/图片；
//       追加写 PARCELS_APPENDED 事件、version+1、状态不变；不满足任一条件新建单。代客单（PARTNER 模式）不参与合并。
// 幂等：order_events.requestKey={orderId}:order.create:{clientRequestId}（唯一索引兜底）；并发同请求/重放返回同单 merged。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const parcelsInput = require('./_parcels-input');

const WINDOW_MAX_MINUTES = 60;
const DEFAULT_WINDOW_MINUTES = 10;
const CANDIDATE_LIMIT = 5;
const REPLAY_SCAN_LIMIT = 5;
const APPEND_ATTEMPTS = 3;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

// 合并窗口毫秒：缺省 10 分钟；非法/越界按 CONTRACT §4 config 行夹到 0~60（0=关闭）
function windowMsOf(config) {
  const raw = Number(config && config.orderMergeWindowMinutes);
  const minutes = Number.isFinite(raw)
    ? Math.min(WINDOW_MAX_MINUTES, Math.max(0, Math.floor(raw)))
    : DEFAULT_WINDOW_MINUTES;
  return minutes * 60 * 1000;
}

// 仅顾客本人单参与合并（代客单/测试写会话按普通新单处理，避免测试会话把生产单当候选）
function canMerge(context) {
  return !!context && context.mode === 'CUSTOMER' && !context.isTest;
}

// 整单字段一致性：serviceCode/appoint/note 是订单级字段，不同则新建单（绝不静默覆盖新提交的值）
function orderFieldsEqual(order, input) {
  const service = order.service || {};
  if (textOf(service.code) !== input.service.code) {
    return false;
  }
  const appoint = order.appoint || {};
  if (textOf(appoint.type) !== input.appoint.type) {
    return false;
  }
  if (input.appoint.type === enums.APPOINT_TYPE.SLOT
    && (time.toMs(appoint.startAt) !== time.toMs(input.appoint.startAt)
      || time.toMs(appoint.endAt) !== time.toMs(input.appoint.endAt))) {
    return false;
  }
  return textOf(order.note) === (input.note || '');
}

function appendRequestKey(orderId, clientRequestId) {
  return String(orderId) + ':order.create:' + String(clientRequestId || '');
}

// 重放识别：历史请求（含已合并单在状态变化后的重试）→ 返回原订单，避免重复建单/重复追加
async function findReplayOrder(ctx, context, clientRequestId) {
  if (!clientRequestId || !context.customerId) {
    return null;
  }
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: { customerId: context.customerId, isTest: context.isTest === true },
    orderBy: [['updatedAt', 'desc']],
    limit: REPLAY_SCAN_LIMIT
  });
  for (let i = 0; i < rows.length; i += 1) {
    const event = await ctx.dao.findOne(COLLECTIONS.ORDER_EVENTS, {
      where: { requestKey: appendRequestKey(rows[i]._id, clientRequestId) }
    });
    if (event) {
      return rows[i];
    }
  }
  return null;
}

// 候选：同顾客+同兼职+SUBMITTED+窗口内+同 delivery+同 service/appoint/note+上限可容纳
async function findAppendTarget(ctx, context, input, nowMs, config) {
  if (!canMerge(context) || input.mergeAppend === false) {
    return null;
  }
  const windowMs = windowMsOf(config);
  if (windowMs <= 0) {
    return null;
  }
  const rows = await ctx.dao.find(COLLECTIONS.ORDERS, {
    where: {
      customerId: context.customerId,
      partnerId: context.partner._id,
      isTest: context.isTest === true,
      status: enums.ORDER_STATUS.SUBMITTED
    },
    orderBy: [['createdAt', 'desc']],
    limit: CANDIDATE_LIMIT
  });
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    if (order.deletedByCustomerAt || order.anonymizedAt) {
      continue;
    }
    const createdMs = time.toMs(order.createdAt);
    if (!createdMs || createdMs < nowMs - windowMs) {
      continue;
    }
    const parcels = Array.isArray(order.parcels) ? order.parcels : [];
    const images = Array.isArray(order.images) ? order.images : [];
    if (parcels.length + input.parcels.length > orderState.MAX_PARCELS_PER_ORDER
      || images.length + input.images.length > orderState.MAX_IMAGES_PER_ORDER) {
      continue;
    }
    if (!parcelsInput.deliveryEquals(order.delivery, input.delivery)) {
      continue;
    }
    if (!orderFieldsEqual(order, input)) {
      continue;
    }
    return order;
  }
  return null;
}

// 追加包裹的 imageIndex 偏移：本批 imageIndex 相对本批 images[]，并入后整体 +已有图片数；
// 本批无截图（手填）的包裹一律不带 imageIndex（不误指到既有截图）——防御性再删一次，避免上游漏归一。
function appendParcelsOf(baseParcels, baseImages, input) {
  const offset = baseImages.length;
  const noImages = !Array.isArray(input.images) || input.images.length === 0;
  const appended = input.parcels.map((parcel) => {
    const copy = Object.assign({}, parcel);
    if (noImages || typeof copy.imageIndex !== 'number') {
      delete copy.imageIndex;
    } else {
      copy.imageIndex += offset;
    }
    return copy;
  });
  return baseParcels.concat(appended);
}

// 追加前的整单快照（事务内重读后校验状态/上限/地址）：返回追加后的 parcels/images
function appendSnapshot(fresh, input) {
  if (!fresh || fresh.status !== enums.ORDER_STATUS.SUBMITTED) {
    throw errors.conflict('订单状态已变化，请刷新后重试');
  }
  const baseParcels = Array.isArray(fresh.parcels) ? fresh.parcels : [];
  const baseImages = Array.isArray(fresh.images) ? fresh.images : [];
  if (baseParcels.length + input.parcels.length > orderState.MAX_PARCELS_PER_ORDER
    || baseImages.length + input.images.length > orderState.MAX_IMAGES_PER_ORDER) {
    throw errors.conflict('订单包裹已达上限，请重新提交');
  }
  if (!parcelsInput.deliveryEquals(fresh.delivery, input.delivery)) {
    throw errors.conflict('配送地址已变化，请刷新后重试');
  }
  return {
    parcels: appendParcelsOf(baseParcels, baseImages, input),
    images: baseImages.concat(parcelsInput.storedImagesOf(input.images)),
    baseParcels
  };
}

// PARCELS_APPENDED 事件（requestKey={orderId}:order.create:{clientRequestId}：唯一索引兜底重放/并发幂等）
function buildAppendEvent(fresh, input, options) {
  const opt = options || {};
  return common.buildEventDocument({
    orderId: fresh._id,
    orderNo: fresh.orderNo,
    type: orderState.EVENT_PARCELS_APPENDED,
    fromStatus: enums.ORDER_STATUS.SUBMITTED,
    toStatus: enums.ORDER_STATUS.SUBMITTED,
    actorRole: opt.actorRole,
    actorId: opt.actorId,
    impersonatedBy: opt.impersonatedBy,
    at: opt.nowDate,
    note: '',
    payload: {
      appendedParcels: input.parcels.length,
      appendedImages: input.images.length,
      parcelsTotal: opt.parcelsTotal,
      imagesTotal: opt.imagesTotal,
      itemIndexStart: opt.itemIndexStart
    },
    requestKey: opt.requestKey
  });
}

async function consumeTickets(trx, tickets, nowDate) {
  for (let i = 0; i < tickets.length; i += 1) {
    await trx.update(COLLECTIONS.UPLOAD_TICKETS, tickets[i]._id, { usedAt: nowDate });
  }
}

// 事务内追加：条件更新（version+status）防并发丢更新；事件唯一索引兜底幂等
async function appendInTransaction(ctx, target, input, context, clientRequestId, nowDate) {
  const requestKey = appendRequestKey(target._id, clientRequestId);
  return ctx.dao.transaction(async (trx) => {
    const fresh = await trx.get(COLLECTIONS.ORDERS, target._id);
    const next = appendSnapshot(fresh, input);
    const updated = await trx.updateWhere(COLLECTIONS.ORDERS, {
      _id: fresh._id,
      version: fresh.version,
      status: enums.ORDER_STATUS.SUBMITTED
    }, {
      parcels: next.parcels,
      images: next.images,
      manualEntry: next.images.length === 0,
      version: fresh.version + 1,
      updatedAt: nowDate
    });
    if (!updated || updated.updated !== 1) {
      throw errors.conflict('订单正在更新，请重试');
    }
    await trx.add(COLLECTIONS.ORDER_EVENTS, buildAppendEvent(fresh, input, {
      actorRole: context.scope.role,
      actorId: context.scope.openid,
      impersonatedBy: context.impersonatedBy,
      nowDate,
      parcelsTotal: next.parcels.length,
      imagesTotal: next.images.length,
      itemIndexStart: next.baseParcels.length,
      requestKey
    }));
    await consumeTickets(trx, input.tickets, nowDate);
    return {
      order: Object.assign({}, fresh, {
        parcels: next.parcels,
        images: next.images,
        manualEntry: next.images.length === 0,
        version: fresh.version + 1,
        updatedAt: nowDate
      }),
      duplicated: false
    };
  });
}

// 追加入口：冲突重读重试 ≤APPEND_ATTEMPTS；同请求并发（事件唯一冲突）按重放返回同单
async function appendWithRetry(ctx, candidate, input, context, clientRequestId, nowDate) {
  let target = candidate;
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    try {
      return await appendInTransaction(ctx, target, input, context, clientRequestId, nowDate);
    } catch (error) {
      if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
        const replay = await findReplayOrder(ctx, context, clientRequestId);
        if (replay) {
          return { order: replay, duplicated: true };
        }
        return null;
      }
      const conflict = error instanceof errors.AppError && error.code === 'CONFLICT';
      if (!conflict) {
        throw error;
      }
      const fresh = await ctx.dao.get(COLLECTIONS.ORDERS, target._id);
      if (!fresh || fresh.status !== enums.ORDER_STATUS.SUBMITTED) {
        return null;
      }
      target = fresh;
    }
  }
  return null;
}

module.exports = {
  windowMsOf,
  canMerge,
  orderFieldsEqual,
  appendRequestKey,
  findReplayOrder,
  findAppendTarget,
  appendWithRetry
};
