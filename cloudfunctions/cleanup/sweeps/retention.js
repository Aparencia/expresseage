// cloudfunctions/cleanup/sweeps/retention.js · 终态订单留存：180 天匿名化 → 再 30 天物理删；软删 7 天物理删
// 口径：DATA_MODEL §10.1/§10.2 步骤 5/6、§10.3 匿名化字段表；ENGINEERING §4.7 retention。
// 幂等判据 = anonymizedAt（禁止重复匿名化）。三类到期条件各自走带条件的查询，避免"已处理过的旧单
// 占满批 100 把后面待匿名化/待物理删的单挡住"（隐私留存超标的真实风险）。
'use strict';

const util = require('./_util');

const TERMINAL_STATUSES = [util.enums.ORDER_STATUS.COMPLETED, util.enums.ORDER_STATUS.CANCELLED];
const ANONYMIZE_DAYS = 180;
const PURGE_AFTER_ANONYMIZE_DAYS = 30;
const PURGE_AFTER_DELETE_DAYS = 7;

// §10.3 匿名化字段表（v1.0/D23 逐件逐图）：去 openid/编号快照/尾号/备注/宿舍/代客信息/本单配送地址/
// 取件码类/截图引用 + P1 认领字段。parcels[*] 保留 stationId（站点维度统计），清站名/码/柜号/尾号/failureId。
function anonymizedParcelOf(parcel) {
  const doc = parcel && typeof parcel === 'object' ? Object.assign({}, parcel) : {};
  doc.stationName = '';
  doc.pickupCode = '';
  doc.lockerNo = '';
  doc.trackingTail = '';
  if (typeof doc.failureId === 'string') {
    doc.failureId = '';
  }
  return doc;
}

function anonymizedParcelsOf(order) {
  return Array.isArray(order.parcels) ? order.parcels.map(anonymizedParcelOf) : null;
}

// 逐张清截图引用（images[*].fileId/failureId 清空；cloudPath 是存储路径同属引用，一并清掉）。
// cleanedAt 已由截图清理链路写入时必须保留（api order.get 的 cleaned 判据）。
function anonymizedImageOf(image) {
  const doc = image && typeof image === 'object' ? Object.assign({}, image) : {};
  doc.fileId = '';
  if (typeof doc.failureId === 'string') {
    doc.failureId = '';
  }
  delete doc.cloudPath;
  return doc;
}

function anonymizedPatch(order, nowDate) {
  const image = order.image || {};
  const patch = {
    customerId: '',
    customerOpenid: '',
    partnerOpenid: '',
    customerNo: '',
    partnerNo: '',
    phoneTail: '',
    note: '',
    deliveryNote: '',
    cancelReason: '',
    exception: null,
    dorm: null,
    guest: null,
    // v1.0（D25）：本单配送地址可能含第三方收件人称呼/尾号/房间号 → 匿名化一并清空（DATA_MODEL §10.3）
    delivery: null,
    claimTokenHash: '',
    claimExpiresAt: null,
    claimedAt: null,
    anonymizedAt: nowDate,
    updatedAt: nowDate,
    version: (order.version || 1) + 1
  };
  const parcels = anonymizedParcelsOf(order);
  if (parcels) {
    patch.parcels = parcels;
  } else {
    patch.parcel = anonymizedParcelOf(order.parcel || {});
  }
  if (Array.isArray(order.images)) {
    patch.images = order.images.map(anonymizedImageOf);
  } else {
    patch.image = { fileId: '', width: 0, height: 0, failureId: '', cleanedAt: image.cleanedAt || null };
  }
  return patch;
}

const MAX_CHILD_ROUNDS = 50;

// 子文档（留言/事件）全量匿名化：逐批清到「不再有未匿名化行」为止（M-17）。
// 单订单子文档可能远超 100 条（30 条/日留言 × 多日/多次改码）；旧实现只清首批 100 条就写
// anonymizedAt，剩余文本/fromId 会残留到 30 天后物理删。这里用服务端 neq 过滤未处理行循环收敛。
async function anonymizeChildren(ctx, collection, orderId, filterField, filterValue, patch, isDone) {
  const C = util.collectionsOf(ctx);
  const command = util.commandOf(ctx);
  const useFilter = command && typeof command.neq === 'function';
  let changed = 0;
  for (let round = 0; round < MAX_CHILD_ROUNDS; round += 1) {
    const where = { orderId: orderId };
    if (useFilter) {
      where[filterField] = command.neq(filterValue);
    }
    const rows = await ctx.dao.find(collection, { where: where, limit: util.BATCH });
    if (rows.length === 0) {
      break;
    }
    let mutated = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (isDone(rows[i])) {
        continue;
      }
      await ctx.dao.update(collection, rows[i]._id, patch);
      mutated += 1;
    }
    changed += mutated;
    if (!useFilter || rows.length < util.BATCH || mutated === 0) {
      // 无服务端过滤能力时退化为单批（旧行为，干净路径仍可用）；有过滤时清空即自然收敛。
      break;
    }
  }
  return changed;
}

async function anonymizeOrder(ctx, order) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const fileIds = util.imageFileIdsOf(order);
  // 先清子文档再写 anonymizedAt：中途失败时订单仍未匿名化，下轮 retention 会重访继续收敛，
  // 不会出现「订单已置匿名化但留言/事件 PII 残留到物理删」的空窗（M-17）。
  await anonymizeChildren(ctx, C.ORDER_MESSAGES, order._id, 'text', '[已删除]',
    { text: '[已删除]', fromId: '' },
    (row) => row.text === '[已删除]' && row.fromId === '');
  await anonymizeChildren(ctx, C.ORDER_EVENTS, order._id, 'actorId', '',
    { actorId: '', payload: {} },
    (row) => row.actorId === '' && (!row.payload || Object.keys(row.payload).length === 0));
  await ctx.dao.update(C.ORDERS, order._id, anonymizedPatch(order, nowDate));
  // 截图引用已随整值写入清空，再按引用计数删文件（仍被其它订单/复核记录引用时保留）
  return util.deleteFilesIfUnreferenced(ctx, fileIds);
}

function whereExists(ctx, base, field, exists) {
  const command = util.commandOf(ctx);
  if (command && typeof command.exists === 'function') {
    const cond = Object.assign({}, base);
    cond[field] = command.exists(exists);
    return cond;
  }
  return Object.assign({}, base);
}

// ① 匿名化：终态且无 anonymizedAt 且超 180 天
async function anonymizePass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, ANONYMIZE_DAYS);
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, { status: TERMINAL_STATUSES[s] }, 'anonymizedAt', false),
      [['statusUpdatedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      if (order.anonymizedAt || util.msOf(order.statusUpdatedAt) >= deadline) {
        continue;
      }
      collected.scanned += 1;
      try {
        await anonymizeOrder(ctx, order);
        collected.acted += 1;
      } catch (error) {
        collected.failed += 1;
      }
    }
  }
}

// ② 物理删：匿名化满 30 天
async function purgeAnonymizedPass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, PURGE_AFTER_ANONYMIZE_DAYS);
  for (let s = 0; s < TERMINAL_STATUSES.length; s += 1) {
    const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, { status: TERMINAL_STATUSES[s] }, 'anonymizedAt', true),
      [['anonymizedAt', 'asc']]);
    for (let i = 0; i < rows.length; i += 1) {
      const order = rows[i];
      const anonymizedAt = util.msOf(order.anonymizedAt);
      if (!anonymizedAt || anonymizedAt >= deadline) {
        continue;
      }
      collected.scanned += 1;
      try {
        // v1.0 逐张清引用（历史 image{} 同一入口）；引用计数归零才删云文件，最后级联删订单
        await util.clearOrderImages(ctx, order);
        await util.removeOrderCascade(ctx, order);
        collected.acted += 1;
      } catch (error) {
        collected.failed += 1;
      }
    }
  }
}

// ③ 物理删：顾客"删除记录"（软删）满 7 天
async function purgeSoftDeletedPass(ctx, collected) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, PURGE_AFTER_DELETE_DAYS);
  const rows = await util.scanPage(ctx, C.ORDERS, whereExists(ctx, {}, 'deletedByCustomerAt', true),
    [['deletedByCustomerAt', 'asc']]);
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    const deletedAt = util.msOf(order.deletedByCustomerAt);
    if (!deletedAt || deletedAt >= deadline) {
      continue;
    }
    collected.scanned += 1;
    try {
      await util.clearOrderImages(ctx, order);
      await util.removeOrderCascade(ctx, order);
      collected.acted += 1;
    } catch (error) {
      collected.failed += 1;
    }
  }
}

async function runRetention(ctx) {
  const collected = { scanned: 0, acted: 0, failed: 0 };
  await anonymizePass(ctx, collected);
  await purgeAnonymizedPass(ctx, collected);
  await purgeSoftDeletedPass(ctx, collected);
  return collected;
}

module.exports = {
  ANONYMIZE_DAYS,
  PURGE_AFTER_ANONYMIZE_DAYS,
  PURGE_AFTER_DELETE_DAYS,
  anonymizeOrder,
  runRetention
};
