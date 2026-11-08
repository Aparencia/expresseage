// lib/subscribe-message.js · 服务通知（一次性订阅）发送适配器（批 31 / D73）
// 口径：CONTRACT §9；模板 ID/字段映射/开关统一来自 config.subscribeTemplates（缺省关闭）。
// 纪律：只在事务提交后调用；失败只记日志、不抛、不重试；日志不含 openid/正文。
'use strict';

const collections = require('../shared/collections');
const zones = require('../shared/zones');
const time = require('./time');

const SEND_TIMEOUT_MS = 1500;
const FIXED_PREFIX = 'fixed:';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function dateTimeTextOf(value) {
  let ms = 0;
  if (typeof value === 'number' && isFinite(value)) ms = value;
  else if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value);
  if (!ms || !isFinite(ms)) return '';
  const local = new Date(ms + time.TZ_OFFSET_MS);
  return local.getUTCFullYear() + '年' + time.pad2(local.getUTCMonth() + 1) + '月' +
    time.pad2(local.getUTCDate()) + '日 ' + time.pad2(local.getUTCHours()) + ':' +
    time.pad2(local.getUTCMinutes());
}

function parcelCountOf(order) {
  if (Array.isArray(order && order.parcels)) return order.parcels.length;
  return order && order.parcel ? 1 : 0;
}

function firstParcelOf(order) {
  if (order && Array.isArray(order.parcels) && order.parcels.length) return order.parcels[0];
  return (order && order.parcel) || null;
}

function charLength(text) {
  return Array.from(text).length;
}

function clipChars(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

// 新单模板「服务地址」= 苑+楼栋+站点；模板 thing 平台限 20 字（任务 P1-1：超限会让 buildData 整包 null →
// 新单通知静默不发）。按码点预算：保「苑+楼栋」优先，站点名放不下就截断并加省略号。
function serviceAreaTextOf(order, config) {
  const delivery = (order && (order.delivery || order.dorm)) || {};
  const labels = (config && config.zoneLabels) || {};
  const zone = textOf(zones.zoneLabel(delivery.zone, labels));
  const buildingNo = delivery.buildingNo === undefined || delivery.buildingNo === null
    ? '' : String(delivery.buildingNo).trim();
  const building = zone && buildingNo ? zone + buildingNo + '栋' : zone;
  const parcel = firstParcelOf(order);
  const station = parcel && textOf(parcel.stationName) ? textOf(parcel.stationName) : '';
  const max = limitOf('thing24');
  const head = clipChars(building, max);
  if (!station) return head;
  if (!head) return clipChars(station, max);
  const room = max - charLength(head) - 1;
  if (room < 2) return head;
  if (charLength(station) <= room) return head + '·' + station;
  return head + '·' + clipChars(station, room - 1) + '…';
}

function valuesOf(order, config) {
  return {
    orderNo: textOf(order && order.orderNo),
    deliveredAt: dateTimeTextOf(order && order.deliveredAt),
    orderSourceText: '顾客下单',
    serviceAreaText: serviceAreaTextOf(order, config),
    parcelCount: String(parcelCountOf(order))
  };
}

function limitOf(key) {
  if (key.indexOf('thing') === 0) return 20;
  if (key.indexOf('phrase') === 0) return 5;
  if (key.indexOf('phone_number') === 0) return 17;
  if (key.indexOf('name') === 0) return 20;
  return 32;
}

function buildData(fields, values) {
  const out = {};
  const keys = Object.keys(fields || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const ref = textOf(fields[key]);
    const value = ref.indexOf(FIXED_PREFIX) === 0 ? ref.slice(FIXED_PREFIX.length) : textOf(values[ref]);
    if (!value || value.length > limitOf(key)) return null;
    out[key] = { value: value };
  }
  return Object.keys(out).length ? out : null;
}

function templateOf(config, key) {
  const all = config && config.subscribeTemplates;
  if (!all || all.enabled !== true) return null;
  const item = all[key];
  if (!item || !textOf(item.templateId) || !item.fields || typeof item.fields !== 'object') return null;
  return item;
}

function targetOpenidOf(order, key) {
  return key === 'delivered' ? textOf(order && order.customerOpenid) : textOf(order && order.partnerOpenid);
}

async function isBlockedUser(ctx, openid) {
  // users 文档 _id = openid（user/_common.getUser），没有独立 openid 字段
  const user = await ctx.dao.get(collections.COLLECTIONS.USERS, openid);
  if (!user) return true;
  if (user.deletionRequestedAt) return true;
  return !!user.status && user.status !== 'ACTIVE';
}

function pageOf(item, order) {
  const raw = textOf(item.page);
  if (raw.indexOf('{orderNo}') < 0) return raw;
  return raw.replace('{orderNo}', encodeURIComponent(textOf(order && order.orderNo)));
}

function withTimeout(promise, ms) {
  return new Promise(function wait(resolve) {
    const timer = setTimeout(function onTimeout() { resolve({ timeout: true }); }, ms);
    Promise.resolve(promise).then(
      function onOk(value) { clearTimeout(timer); resolve({ value: value }); },
      function onErr(error) { clearTimeout(timer); resolve({ error: error }); }
    );
  });
}

function errCodeOf(error) {
  if (!error) return 0;
  return error.errCode || error.errcode || error.code || 0;
}

function skip(key, reason) {
  if (reason === 'cloud') {
    console.error('[subscribe] skipped', key, reason);
  } else {
    console.warn('[subscribe] skipped', key, reason);
  }
  return { ok: false, skipped: reason };
}

// 发送闸（按序短路）：模板/开关 → 测试单 → 目标 openid → 用户状态 → data → 云调用注入。
async function resolveTarget(ctx, key, order) {
  const item = templateOf(ctx && ctx.config, key);
  if (!item) return { skipped: 'config' };
  if (!order || order.isTest === true) return { skipped: 'test' };
  const openid = targetOpenidOf(order, key);
  if (!openid) return { skipped: 'openid' };
  if (await isBlockedUser(ctx, openid)) return { skipped: 'user' };
  const data = buildData(item.fields, valuesOf(order, ctx.config));
  if (!data) return { skipped: 'data' };
  const cloud = ctx.cloud;
  if (!cloud || !cloud.openapi || !cloud.openapi.subscribeMessage ||
      typeof cloud.openapi.subscribeMessage.send !== 'function') {
    return { skipped: 'cloud' };
  }
  return { item: item, openid: openid, data: data, cloud: cloud };
}

async function send(ctx, key, order) {
  try {
    const target = await resolveTarget(ctx, key, order);
    if (target.skipped) return skip(key, target.skipped);
    const payload = {
      touser: target.openid,
      templateId: target.item.templateId,
      page: pageOf(target.item, order),
      miniprogramState: 'formal',
      lang: 'zh_CN',
      data: target.data
    };
    const result = await withTimeout(target.cloud.openapi.subscribeMessage.send(payload), SEND_TIMEOUT_MS);
    if (result.error) {
      const code = errCodeOf(result.error);
      if (code !== 43101) {
        console.warn('[subscribe] send failed', key, code, textOf(order.orderNo).slice(-4));
      }
      return { ok: false, error: code };
    }
    const value = result.value || {};
    const code = value.errCode || value.errcode || 0;
    if (code) {
      if (code !== 43101) {
        console.warn('[subscribe] send rejected', key, code, textOf(order.orderNo).slice(-4));
      }
      return { ok: false, error: code };
    }
    return { ok: result.timeout !== true, timeout: result.timeout === true };
  } catch (error) {
    console.warn('[subscribe] send threw', key, errCodeOf(error));
    return { ok: false, thrown: true };
  }
}

function notifyDelivered(ctx, order) {
  return send(ctx, 'delivered', order);
}

function notifyNewOrder(ctx, order) {
  return send(ctx, 'newOrder', order);
}

module.exports = {
  buildData,
  valuesOf,
  dateTimeTextOf,
  notifyDelivered,
  notifyNewOrder
};
