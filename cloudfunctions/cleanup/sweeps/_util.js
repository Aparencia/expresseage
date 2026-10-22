// cloudfunctions/cleanup/sweeps/_util.js · sweep 共用件（只能 require ../shared/** 与 ./_util）
// 口径：ENGINEERING §4.7「到期判断幂等执行、批 100」；所有判断用注入的 ctx.now，禁止读系统时钟。
'use strict';

const shared = require('../shared/collections');
const enums = require('../shared/enums');
const audit = require('../shared/audit-actions');

const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SYSTEM = 'SYSTEM';
// orders.images[] 上限 5 张（CONTRACT §4.1/DATA_MODEL §2.5）→ 下标 0~4。
// 云 DB 数组子元素没有通配点查语法（不支持 'images.$.fileId'），引用计数/到期扫描按逐下标点路径点查。
const IMAGE_INDEX_SLOTS = 5;

function collectionsOf(ctx) {
  return (ctx && ctx.COLLECTIONS) || shared.COLLECTIONS;
}

function commandOf(ctx) {
  const db = ctx && ctx.db;
  return db && db.command && typeof db.command === 'object' ? db.command : null;
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

function daysAfter(nowMs, days) {
  return nowMs + days * DAY_MS;
}

function hoursBefore(nowMs, hours) {
  return nowMs - hours * HOUR_MS;
}

function minutesBefore(nowMs, minutes) {
  return nowMs - minutes * MINUTE_MS;
}

// 配置值兜底：非正数/非有限值回落默认；可传 min/max 收窄到契约区间（如识别失败 7~30 天）。
function numberConfig(config, key, fallback, min, max) {
  const raw = config && config[key];
  let value = typeof raw === 'number' && isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  if (typeof min === 'number') {
    value = Math.max(min, value);
  }
  if (typeof max === 'number') {
    value = Math.min(max, value);
  }
  return value;
}

// 读一页并按到期条件在内存过滤（cloud DB 不支持复杂比较时统一在内存过滤，批 100 可控）
async function scanPage(ctx, collection, where, orderBy, limit) {
  const dao = ctx.dao;
  return dao.find(collection, {
    where: where || {},
    orderBy: orderBy || [],
    limit: limit || BATCH
  });
}

// 字符串前缀区间的上界：最后一个可递增码位 +1（'rl:' → 'rl;'）；全 0xFFFF 返回 '' 表示无上界。
function prefixUpperBound(prefix) {
  const chars = String(prefix).split('');
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const code = chars[i].charCodeAt(0);
    if (code < 0xffff) {
      chars[i] = String.fromCharCode(code + 1);
      return chars.slice(0, i + 1).join('');
    }
  }
  return '';
}

// 键族前缀查询（counters 'rl:' 清理必须命中前缀，否则非 rl 计数把批塞满导致过期 rl 永不清理）。
// 真实云 DB 用 _.gte(prefix).and(_.lt(upper)) 表达闭区间；注入替身不支持 and 时退化为下界查询，
// 调用方必须再用 startsWith 过滤一次（宁可少删，不可误删 orderNo/tag 计数）。
function keyPrefixWhere(ctx, field, prefix) {
  const command = commandOf(ctx);
  if (!command || typeof command.gte !== 'function') {
    return {};
  }
  const upper = prefixUpperBound(prefix);
  const lower = command.gte(prefix);
  if (upper && typeof command.lt === 'function') {
    const high = command.lt(upper);
    if (lower && typeof lower.and === 'function') {
      const cond = {};
      cond[field] = lower.and(high);
      return cond;
    }
  }
  const cond = {};
  cond[field] = lower;
  return cond;
}

function startsWith(value, prefix) {
  return typeof value === 'string' && value.indexOf(prefix) === 0;
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

// ── orders.images[] 归一（v1.0 一单多图，D23）─────────────────────────────────
// 新单只写 images[]；历史单 image{} 只读归一为单元素数组（cross-order 共享 fileId 时引用计数必须两边都数）。
function orderImagesOf(order) {
  const list = order && Array.isArray(order.images) ? order.images : [];
  if (list.length > 0) {
    return list;
  }
  return order && order.image && typeof order.image === 'object' ? [order.image] : [];
}

function imageFileIdsOf(order) {
  const seen = {};
  const out = [];
  orderImagesOf(order).forEach((image) => {
    const fileId = image && typeof image.fileId === 'string' ? image.fileId : '';
    if (fileId && !seen[fileId]) {
      seen[fileId] = true;
      out.push(fileId);
    }
  });
  return out;
}

// ── 文件引用计数：订单截图（历史 image{} + v1.0 images[]）+ 识别失败原图共用同一 fileId──────
// 调用方只判"是否仍有引用"，因此在找到任一订单引用后短路（避免每张图都跑满 5 个下标点查）。
async function countFileRefs(ctx, fileId) {
  const C = collectionsOf(ctx);
  let orders = await ctx.dao.count(C.ORDERS, { where: { 'image.fileId': fileId } });
  for (let i = 0; orders === 0 && i < IMAGE_INDEX_SLOTS; i += 1) {
    const where = {};
    where['images.' + i + '.fileId'] = fileId;
    orders = await ctx.dao.count(C.ORDERS, { where: where });
  }
  const failures = await ctx.dao.count(C.RECOGNITION_FAILURES, { where: { fileId: fileId } });
  return { orders: orders, failures: failures };
}

async function deleteFileIfUnreferenced(ctx, fileId) {
  if (typeof fileId !== 'string' || fileId === '') {
    return false;
  }
  const refs = await countFileRefs(ctx, fileId);
  if (refs.orders > 0 || refs.failures > 0) {
    return false;
  }
  return deleteFileSafe(ctx, fileId);
}

async function deleteFilesIfUnreferenced(ctx, fileIds) {
  let deleted = 0;
  const seen = {};
  for (let i = 0; i < fileIds.length; i += 1) {
    const fileId = fileIds[i];
    if (typeof fileId !== 'string' || fileId === '' || seen[fileId]) {
      continue;
    }
    seen[fileId] = true;
    if (await deleteFileIfUnreferenced(ctx, fileId)) {
      deleted += 1;
    }
  }
  return deleted;
}

// 历史单 image{}：写 image.cleanedAt 供 api order.imageUrl/order.get 判定（cleaned 只读 image.cleanedAt），
// 引用计数归零再删云文件。
async function clearLegacyImage(ctx, order) {
  const C = collectionsOf(ctx);
  const image = (order && order.image) || {};
  const fileId = typeof image.fileId === 'string' ? image.fileId : '';
  const nowDate = nowDateOf(ctx);
  if (!fileId) {
    return {
      cleared: 0,
      image: { fileId: '', width: 0, height: 0, failureId: '', cleanedAt: image.cleanedAt || null }
    };
  }
  const next = { fileId: '', width: 0, height: 0, failureId: '', cleanedAt: nowDate };
  await ctx.dao.update(C.ORDERS, order._id, { image: next, updatedAt: nowDate });
  await deleteFilesIfUnreferenced(ctx, [fileId]);
  return { cleared: 1, image: next };
}

async function clearOrderImage(ctx, order) {
  const result = await clearLegacyImage(ctx, order);
  return result.cleared > 0;
}

function imageHasRef(image) {
  const doc = image && typeof image === 'object' ? image : {};
  return (typeof doc.fileId === 'string' && doc.fileId !== '')
    || (typeof doc.failureId === 'string' && doc.failureId !== '');
}

// 单张清引用：清 fileId/failureId（§10.3 字段表）并去掉云存储路径；有文件引用时写 cleanedAt。
function clearedImageOf(image, nowDate) {
  const doc = image && typeof image === 'object' ? Object.assign({}, image) : {};
  const hadFile = typeof doc.fileId === 'string' && doc.fileId !== '';
  if (hadFile) {
    doc.cleanedAt = nowDate;
  }
  doc.fileId = '';
  if (typeof doc.failureId === 'string') {
    doc.failureId = '';
  }
  delete doc.cloudPath;
  return doc;
}

// 清订单截图引用（订单侧唯一入口，v1.0 逐张）：images[] 逐张清 fileId/failureId，引用计数归零再删云文件；
// 历史单 image{} 走 clearLegacyImage。幂等：没有可清引用时不写库、返回 cleared=0。
async function clearOrderImages(ctx, order) {
  const C = collectionsOf(ctx);
  if (!order || !Array.isArray(order.images)) {
    const legacy = await clearLegacyImage(ctx, order || {});
    return { cleared: legacy.cleared, images: [legacy.image] };
  }
  const nowDate = nowDateOf(ctx);
  const source = order.images;
  const fileIds = [];
  let cleared = 0;
  const next = source.map((image) => {
    if (!imageHasRef(image)) {
      return image;
    }
    const fileId = image && typeof image.fileId === 'string' ? image.fileId : '';
    if (fileId) {
      fileIds.push(fileId);
    }
    cleared += 1;
    return clearedImageOf(image, nowDate);
  });
  if (cleared === 0) {
    return { cleared: 0, images: source.slice() };
  }
  const patch = { images: next, updatedAt: nowDate };
  await ctx.dao.update(C.ORDERS, order._id, patch);
  // 混合形态兜底：v1.0 单理论上不写 image{}，但历史合并/回填异常时 legacy 引用也要清掉
  if (order.image && typeof order.image === 'object' && typeof order.image.fileId === 'string'
    && order.image.fileId !== '') {
    await clearLegacyImage(ctx, order);
  }
  await deleteFilesIfUnreferenced(ctx, fileIds);
  return { cleared: cleared, images: next };
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

// 审计写入幂等：requestKey 先查后插（唯一索引兜底捕获重复），失败不阻塞 sweep。
async function writeAuditOnce(ctx, doc) {
  const C = collectionsOf(ctx);
  const entry = doc || {};
  const requestKey = typeof entry.requestKey === 'string' ? entry.requestKey : '';
  try {
    if (requestKey) {
      const existed = await ctx.dao.findOne(C.ADMIN_AUDIT, { where: { requestKey } });
      if (existed) {
        return false;
      }
    }
    await ctx.dao.add(C.ADMIN_AUDIT, Object.assign({
      adminOpenid: SYSTEM,
      developerNo: SYSTEM,
      target: { type: '', id: '' },
      detail: {},
      at: nowDateOf(ctx)
    }, entry));
    return true;
  } catch (error) {
    if (ctx.dao && typeof ctx.dao.isDuplicateError === 'function' && ctx.dao.isDuplicateError(error)) {
      return false;
    }
    console.warn('[cleanup] 审计写入失败，下轮重试');
    return false;
  }
}

function auditDoc(ctx, action, target, detail, requestKey) {
  return {
    adminOpenid: SYSTEM,
    developerNo: SYSTEM,
    action,
    target: target || { type: '', id: '' },
    detail: detail || {},
    at: nowDateOf(ctx),
    requestKey: requestKey || ''
  };
}

module.exports = {
  BATCH,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SYSTEM,
  IMAGE_INDEX_SLOTS,
  enums,
  audit,
  collectionsOf,
  commandOf,
  msOf,
  nowDateOf,
  daysBefore,
  daysAfter,
  hoursBefore,
  minutesBefore,
  numberConfig,
  scanPage,
  prefixUpperBound,
  keyPrefixWhere,
  startsWith,
  orderImagesOf,
  imageFileIdsOf,
  deleteFileSafe,
  countFileRefs,
  deleteFileIfUnreferenced,
  deleteFilesIfUnreferenced,
  clearLegacyImage,
  clearOrderImage,
  clearOrderImages,
  clearedImageOf,
  eventDoc,
  removeOrderCascade,
  writeAuditOnce,
  auditDoc
};
