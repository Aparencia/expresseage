// cloudfunctions/cleanup/sweeps/_util.js · sweep 共用件（只能 require ../shared/** 与 ./_util）
// 口径：ENGINEERING §4.7「到期判断幂等执行、批 100」；所有判断用注入的 ctx.now，禁止读系统时钟。
'use strict';

const shared = require('../shared/collections');
const enums = require('../shared/enums');

const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SYSTEM = 'SYSTEM';

function collectionsOf(ctx) {
  return (ctx && ctx.COLLECTIONS) || shared.COLLECTIONS;
}

function msOf(value) {
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function nowDateOf(ctx) {
  return new Date(ctx.now);
}

function daysBefore(nowMs, days) {
  return nowMs - days * DAY_MS;
}

function hoursBefore(nowMs, hours) {
  return nowMs - hours * HOUR_MS;
}

function minutesBefore(nowMs, minutes) {
  return nowMs - minutes * MINUTE_MS;
}

function numberConfig(config, key, fallback) {
  const value = config && config[key];
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : fallback;
}

// 读一页并按 ms 字段过滤（cloud DB 不支持复杂比较时统一在内存过滤，批 100 可控）
async function scanPage(ctx, collection, where, orderBy, limit) {
  const dao = ctx.dao;
  return dao.find(collection, {
    where: where || {},
    orderBy: orderBy || [],
    limit: limit || BATCH
  });
}

async function deleteFileSafe(ctx, fileId) {
  if (typeof fileId !== 'string' || fileId === '') {
    return false;
  }
  const cloud = ctx && ctx.cloud;
  if (!cloud || typeof cloud.deleteFile !== 'function') {
    return false;
  }
  try {
    await cloud.deleteFile({ fileList: [fileId] });
    return true;
  } catch (error) {
    console.warn('[cleanup] 文件删除失败，下轮重试');
    return false;
  }
}

function eventDoc(order, type, fromStatus, toStatus, actorRole, nowDate, payload, requestKey) {
  return {
    orderId: order._id,
    orderNo: order.orderNo || '',
    type,
    fromStatus,
    toStatus,
    actorRole,
    actorId: SYSTEM,
    impersonatedBy: order.impersonatedBy || '',
    at: nowDate,
    note: '',
    payload: payload || {},
    requestKey
  };
}

async function removeOrderCascade(ctx, order) {
  const C = collectionsOf(ctx);
  const events = await ctx.dao.removeWhere(C.ORDER_EVENTS, { orderId: order._id });
  const messages = await ctx.dao.removeWhere(C.ORDER_MESSAGES, { orderId: order._id });
  const removed = await ctx.dao.remove(C.ORDERS, order._id);
  return { events: events.removed, messages: messages.removed, orders: removed.removed };
}

module.exports = {
  BATCH,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SYSTEM,
  enums,
  collectionsOf,
  msOf,
  nowDateOf,
  daysBefore,
  hoursBefore,
  minutesBefore,
  numberConfig,
  scanPage,
  deleteFileSafe,
  eventDoc,
  removeOrderCascade
};
