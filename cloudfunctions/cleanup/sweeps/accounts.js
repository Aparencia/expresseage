// cloudfunctions/cleanup/sweeps/accounts.js · 注销账号两阶段清理 + 测试账号级联删除兜底
// 口径：ENGINEERING §4.7 accountDeletion；DATA_MODEL §10.3/§10.4；CONTRACT §11.1/§11.4。
//   阶段一（deletionRequestedAt 起每轮，立即口径）：customers PII 匿名化（昵称/头像/尾号/宿舍）+ 头像文件删除
//     + 订单匿名化 + 截图删除 + 识别失败记录 uploaderOpenid 置空 + 上传票据删除 + 相关切换会话 endedAt
//     （ACCOUNT_SWITCH_END，reason=TARGET_DELETED，requestKey 幂等）；
//   阶段二（deletionRequestedAt+30d）：物理删 users/customers/bindings/票据 + 头像文件兜底。
//   幂等：每项都按"是否已处理"判定（customer.anonymizedAt / anonymizedAt exists(false) / 会话已结束），
//   重跑 acted 收敛为 0，不重复写审计。
'use strict';

const util = require('./_util');
const retention = require('./retention');

const DELETION_DAYS = 30;
const TEST_ID_PREFIX = 'TEST-';

function unendedWhereOf(ctx, targetId) {
  const command = util.commandOf(ctx);
  const where = { targetId };
  if (command && typeof command.in === 'function') {
    where.endedAt = command.in([null, 0]);
  }
  return where;
}

// 结束目标账号的全部有效切换会话，并补 ACCOUNT_SWITCH_END（reason=TARGET_DELETED；每票至多一条）
async function endSessionsOfTarget(ctx, targetId) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const rows = await ctx.dao.find(C.ADMIN_VIEW_SESSIONS, {
    where: unendedWhereOf(ctx, targetId),
    limit: util.BATCH
  });
  let ended = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const session = rows[i];
    if (session.endedAt) {
      continue;
    }
    await ctx.dao.update(C.ADMIN_VIEW_SESSIONS, session._id, { endedAt: nowDate, updatedAt: nowDate });
    await util.writeAuditOnce(ctx, util.auditDoc(
      ctx,
      util.audit.AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
      { type: 'view_session', id: String(session._id) },
      {
        viewMode: session.viewMode || '',
        role: session.role || '',
        targetNo: session.targetNo || '',
        targetIsTest: session.targetIsTest === true,
        reason: 'TARGET_DELETED'
      },
      'switch-end:' + String(session._id)
    ));
    ended += 1;
  }
  return ended;
}

// customers 匿名化（§10.3：清 PII 含 displayName/avatarFileId/phoneTail/宿舍，写 deletedAt/anonymizedAt/purgeAt）
async function anonymizeCustomer(ctx, customer) {
  const C = util.collectionsOf(ctx);
  const nowDate = util.nowDateOf(ctx);
  const avatarFileId = typeof customer.avatarFileId === 'string' ? customer.avatarFileId : '';
  await ctx.dao.update(C.CUSTOMERS, customer._id, {
    displayName: '',
    avatarFileId: '',
    phoneTail: '',
    zone: '',
    buildingNo: 0,
    room: '',
    dormKey: '',
    profileCompleted: false,
    deletedAt: nowDate,
    anonymizedAt: nowDate,
    purgeAt: new Date(util.daysAfter(ctx.now, DELETION_DAYS)),
    updatedAt: nowDate
  });
  if (avatarFileId) {
    await util.deleteFileSafe(ctx, avatarFileId);
  }
  return avatarFileId !== '';
}

// 顾客订单：立即删截图引用（写 image.cleanedAt → api cleaned 判定）+ 按 §10.3 匿名化（幂等）
async function anonymizeOrdersOfCustomer(ctx, openid) {
  const C = util.collectionsOf(ctx);
  const command = util.commandOf(ctx);
  const where = { customerId: openid };
  if (command && typeof command.exists === 'function') {
    where.anonymizedAt = command.exists(false);
  }
  const rows = await ctx.dao.find(C.ORDERS, {
    where,
    orderBy: [['statusUpdatedAt', 'asc']],
    limit: util.BATCH
  });
  let changed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const order = rows[i];
    if (order.anonymizedAt) {
      continue;
    }
    const image = order.image || {};
    const cleanedAt = util.nowDateOf(ctx);
    if (typeof image.fileId === 'string' && image.fileId !== '') {
      await util.clearOrderImage(ctx, order);
    }
    await retention.anonymizeOrder(ctx, Object.assign({}, order, {
      image: { fileId: '', cleanedAt: image.fileId ? cleanedAt : (image.cleanedAt || null) }
    }));
    changed += 1;
  }
  return changed;
}

// 阶段一：立即匿名化（每轮幂等执行；已处理项返回 0 变化）
async function anonymizeAccount(ctx, user) {
  const C = util.collectionsOf(ctx);
  const openid = user._id;
  let changed = 0;
  const customer = await ctx.dao.get(C.CUSTOMERS, openid);
  if (customer && !customer.anonymizedAt) {
    await anonymizeCustomer(ctx, customer);
    changed += 1;
  }
  changed += await anonymizeOrdersOfCustomer(ctx, openid);
  changed += await endSessionsOfTarget(ctx, openid);
  const failures = await ctx.dao.updateWhere(C.RECOGNITION_FAILURES, { uploaderOpenid: openid }, {
    uploaderOpenid: '',
    updatedAt: util.nowDateOf(ctx)
  });
  if (failures.updated > 0) {
    changed += 1;
  }
  const tickets = await ctx.dao.removeWhere(C.UPLOAD_TICKETS, { openid });
  if (tickets.removed > 0) {
    changed += 1;
  }
  return { changed };
}

// 阶段二：物理删关联数据（头像文件兜底删除）
async function deleteAccount(ctx, user) {
  const C = util.collectionsOf(ctx);
  const openid = user._id;
  const customer = await ctx.dao.get(C.CUSTOMERS, openid);
  const avatarFileId = customer && typeof customer.avatarFileId === 'string' ? customer.avatarFileId : '';
  await ctx.dao.removeWhere(C.BINDINGS, { customerId: openid });
  await ctx.dao.removeWhere(C.UPLOAD_TICKETS, { openid });
  await ctx.dao.updateWhere(C.RECOGNITION_FAILURES, { uploaderOpenid: openid },
    { uploaderOpenid: '', updatedAt: util.nowDateOf(ctx) });
  await endSessionsOfTarget(ctx, openid);
  await ctx.dao.remove(C.CUSTOMERS, openid);
  await ctx.dao.remove(C.USERS, openid);
  if (avatarFileId) {
    await util.deleteFileSafe(ctx, avatarFileId);
  }
}

async function runAccountDeletion(ctx) {
  const C = util.collectionsOf(ctx);
  const deadline = util.daysBefore(ctx.now, DELETION_DAYS);
  const rows = await util.scanPage(ctx, C.USERS, { status: util.enums.USER_STATUS.DEACTIVATED },
    [['deletionRequestedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const user = rows[i];
    const requestedAt = util.msOf(user.deletionRequestedAt);
    if (!requestedAt) {
      continue;
    }
    scanned += 1;
    try {
      const phaseOne = await anonymizeAccount(ctx, user);
      if (requestedAt < deadline) {
        await deleteAccount(ctx, user);
        acted += 1;
      } else if (phaseOne.changed > 0) {
        acted += 1;
      }
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

// 兜底：admin.deleteTestAccount 同步级联中断留下的孤儿测试数据（账号/头像已无引用时清数据）。
// 客户主键前缀 TEST- 走范围查询（禁止 where({}) 全表扫描，DATA_MODEL §5.3）；订单级联删事件/留言防孤儿 PII。
async function runTestAccountsDeletion(ctx) {
  const C = util.collectionsOf(ctx);
  const rows = await util.scanPage(ctx, C.CUSTOMERS, util.keyPrefixWhere(ctx, '_id', TEST_ID_PREFIX),
    [['updatedAt', 'asc']]);
  let scanned = 0;
  let acted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const customer = rows[i];
    if (!util.startsWith(customer._id, TEST_ID_PREFIX)) {
      continue;
    }
    scanned += 1;
    try {
      const user = await ctx.dao.get(C.USERS, customer._id);
      if (!user || user.isTestAccount !== true) {
        const orders = await ctx.dao.find(C.ORDERS, {
          where: { customerId: customer._id, isTest: true },
          limit: util.BATCH
        });
        for (let o = 0; o < orders.length; o += 1) {
          await util.removeOrderCascade(ctx, orders[o]);
        }
        await ctx.dao.removeWhere(C.BINDINGS, { customerId: customer._id });
        await ctx.dao.removeWhere(C.UPLOAD_TICKETS, { openid: customer._id });
        await ctx.dao.remove(C.CUSTOMERS, customer._id);
        acted += 1;
      }
    } catch (error) {
      failed += 1;
    }
  }
  return { scanned, acted, failed };
}

module.exports = {
  DELETION_DAYS,
  runAccountDeletion,
  runTestAccountsDeletion
};
