// handlers/admin/setPartnerStatus.js · admin.setPartnerStatus（停用/恢复/注销；注销释放绑定并把进行中订单转异常）
// 口径：CONTRACT §11.4、DATA_MODEL §2.3/§10.3/§10.4、D59 级联。批 D（2026-10-31，rev6 有界分批事务）关闭 TD-053/055/056/057：
//  - TD-053：CLOSED 时 partners.openid 换唯一注销占位串 'CLOSED-<partners._id>'（原 openid 不留存），同一小事务
//    给 users 写 closedPartnerNo/partnerClosedAt（schema 只增）作为「不可再激活」锚点（partner.activate 据此 CONFLICT）。
//  - TD-055：云开发单事务硬上限 100 ops / 30 秒；旧实现全量塞一个事务 → 真实环境即超限（fake DB 假绿）。现为
//    **有界分批**：A 分批阶段每页独立事务（页大小见下）；B 最终关键段 users 注销标记 + partners patch 同一 2 ops
//    小事务；C 幂等收敛（分批已提交而最终段/审计未完成时同请求重试补做）。删文件与审计在事务外（失败仅告警）。
//  - TD-056：CLOSED 立即结束 targetId=partners._id 的有效会话（ACCOUNT_SWITCH_END 审计提交后写）。
//  - TD-057：进行中订单按活动状态分页全量转 EXCEPTION（每页 50 单≈100 ops；页数上限防死循环）。
//  - D59：主兼职停用/注销级联同队子队员 + 取消该队 PENDING 转派（见 teamCascadeOf；恢复不级联）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const identity = require('../user/_common');
const team = require('../partner/_team');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  assertValid,
  readNote,
  getPartnerByNo
} = require('./_common');
const dto = require('./_dto');

const ACTIVE_ORDER_STATUSES = [enums.ORDER_STATUS.SUBMITTED, enums.ORDER_STATUS.ACCEPTED, enums.ORDER_STATUS.PICKED];
const CLOSED_NOTE = '兼职已注销，订单转为异常待处理';
// TD-055 单批 ops 预算：绑定 50×1 / 订单 50×2=100（=平台单事务上限）/ 失败记录 50×1 / 会话 50×1 / 最终段 2。
const BINDING_PAGE_SIZE = 50;
const ORDER_PAGE_SIZE = 50;
const FAILURE_PAGE_SIZE = 50;
const SESSION_PAGE_SIZE = 50;
const MAX_BINDING_PAGES = 10; // 单次最多 500 条绑定
const MAX_ORDER_PAGES_PER_STATUS = 100; // 每状态页数上限（50×100=5000 单，与旧实现单次上限等价）
const MAX_FAILURE_PAGES = 10; // 单次最多 500 条失败记录
const MAX_SESSION_PAGES = 10; // 50×10=500 条，与旧实现单次上限等价
const IMAGE_INDEX_SLOTS = 10; // DATA_MODEL §10.1：v1.0 截图逐张下标点查（跨单共享 fileId 引用计数）

function parseStatus(value) {
  if (enums.PARTNER_STATUS_LIST.indexOf(value) < 0) throw errors.validation('status', '兼职状态不正确');
  return value;
}

function assertTransition(from, to) {
  if (from === to) return;
  if (from === enums.PARTNER_STATUS.CLOSED) throw errors.invalidTransition('已注销的兼职不能恢复');
  if (to === enums.PARTNER_STATUS.ACTIVE && from !== enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.invalidTransition('当前状态不支持恢复');
  }
}

function emptyOutcome() {
  return { affectedBindings: 0, affectedOrders: 0, failureFileIds: [] };
}

// 头像文件 id 取值：只接受字符串（partners.avatarFileId 在库内只有 string/空），非字符串按空串。
function avatarFileIdOf(partner) {
  const value = partner && partner.avatarFileId;
  return typeof value === 'string' ? value : '';
}

// ── A 分批阶段（TD-055：每页一个独立事务，避开平台单事务 100 ops / 30s 上限；每页提交后不可回滚）──
async function releaseBindings(scope, partner) {
  let released = 0;
  for (let page = 0; page < MAX_BINDING_PAGES; page += 1) {
    const count = await scope.dao.transaction(async (trx) => {
      const rows = await trx.find(COLLECTIONS.BINDINGS, {
        where: { partnerId: partner._id, status: enums.BINDING_STATUS.ACTIVE },
        limit: BINDING_PAGE_SIZE
      });
      for (let i = 0; i < rows.length; i += 1) {
        const binding = rows[i];
        await trx.update(COLLECTIONS.BINDINGS, binding._id, {
          status: enums.BINDING_STATUS.RELEASED,
          activeKey: binding.customerId + ':RELEASED:' + binding._id,
          releasedAt: scope.nowDate,
          releaseReason: 'PARTNER_CLOSED',
          releasedBy: 'ADMIN',
          // DATA_MODEL §10.3：CLOSED 随释放保留历史行但清空 partnerNote
          partnerNote: '',
          updatedAt: scope.nowDate
        });
      }
      return rows.length;
    });
    released += count;
    if (count < BINDING_PAGE_SIZE) {
      break;
    }
  }
  return released;
}

async function moveOrderToException(trx, scope, order, note) {
  await trx.update(COLLECTIONS.ORDERS, order._id, {
    status: enums.ORDER_STATUS.EXCEPTION,
    exception: {
      code: 'OTHER',
      text: note.slice(0, 200),
      fromStatus: order.status,
      by: 'ADMIN',
      at: scope.nowDate
    },
    version: (Number(order.version) || 1) + 1,
    statusUpdatedAt: scope.nowDate,
    updatedAt: scope.nowDate
  });
  try {
    await trx.add(COLLECTIONS.ORDER_EVENTS, {
      orderId: order._id,
      orderNo: String(order.orderNo || ''),
      type: 'EXCEPTION_REPORTED',
      fromStatus: order.status,
      toStatus: enums.ORDER_STATUS.EXCEPTION,
      actorRole: enums.CANCELLED_BY.ADMIN,
      actorId: scope.actorOpenid,
      impersonatedBy: '',
      at: scope.nowDate,
      note: note.slice(0, 100),
      payload: { by: 'ADMIN', code: 'OTHER' },
      requestKey: order._id + ':admin.setPartnerStatus:CLOSED'
    });
  } catch (error) {
    // 同一单被异常恢复后再次注销：事件 requestKey 幂等复用旧事件，订单状态仍收敛为 EXCEPTION
    if (!trx.isDuplicateError || !trx.isDuplicateError(error)) {
      throw error;
    }
  }
}

// TD-057：按活动状态分页（改为 EXCEPTION 后自然不再命中 → 取空即停，无需 skip）；页数上限防死循环。
// TD-055：每页一个事务，页内 50 单 ×（1 update + 1 add）= 100 ops = 平台单事务操作上限。
async function paginateOrdersOfStatus(scope, partner, note, status) {
  let moved = 0;
  for (let page = 0; page < MAX_ORDER_PAGES_PER_STATUS; page += 1) {
    const count = await scope.dao.transaction(async (trx) => {
      const rows = await trx.find(COLLECTIONS.ORDERS, {
        where: { partnerId: partner._id, status: status },
        orderBy: [['createdAt', 'asc']],
        limit: ORDER_PAGE_SIZE
      });
      for (let i = 0; i < rows.length; i += 1) {
        await moveOrderToException(trx, scope, rows[i], note);
      }
      return rows.length;
    });
    moved += count;
    if (count < ORDER_PAGE_SIZE) {
      return moved;
    }
  }
  console.warn('[admin] 注销转异常达到单状态页数上限，剩余订单留待人工处置');
  return moved;
}

async function moveOrdersToException(scope, partner, reason) {
  const note = reason || CLOSED_NOTE;
  let moved = 0;
  for (let i = 0; i < ACTIVE_ORDER_STATUSES.length; i += 1) {
    moved += await paginateOrdersOfStatus(scope, partner, note, ACTIVE_ORDER_STATUSES[i]);
  }
  return moved;
}

// DATA_MODEL §2.8/§10.4：邀请码 usedBy 置空、保留 usedAt/batchId（审计可追溯；邀请码不重新生效）。单条写，独立事务。
async function clearInvitationUsage(scope, partner) {
  const result = await scope.dao.transaction((trx) => trx.updateWhere(
    COLLECTIONS.INVITATION_CODES, { usedBy: partner._id }, { usedBy: '', updatedAt: scope.nowDate }
  ));
  return result.updated;
}

// §10.3：兼职 CLOSED 同口径清识别失败 uploaderOpenid/fileId（保留 sourceRole/时间供审计），
// 返回待回收的原图 fileId（云存储删除在全部提交后做）；按页独立事务，页内每行 1 op。
async function anonymizeFailuresOfPartner(scope, partner) {
  const openid = typeof partner.openid === 'string' ? partner.openid : '';
  const fileIds = [];
  if (!openid || identity.isClosedOpenid(openid)) {
    return fileIds;
  }
  for (let page = 0; page < MAX_FAILURE_PAGES; page += 1) {
    const result = await scope.dao.transaction(async (trx) => {
      const rows = await trx.find(COLLECTIONS.RECOGNITION_FAILURES, {
        where: { uploaderOpenid: openid },
        orderBy: [['createdAt', 'asc']],
        limit: FAILURE_PAGE_SIZE
      });
      const collected = [];
      for (let i = 0; i < rows.length; i += 1) {
        const fileId = typeof rows[i].fileId === 'string' ? rows[i].fileId : '';
        await trx.update(COLLECTIONS.RECOGNITION_FAILURES, rows[i]._id, {
          uploaderOpenid: '',
          fileId: '',
          updatedAt: scope.nowDate
        });
        if (fileId) {
          collected.push(fileId);
        }
      }
      return { count: rows.length, fileIds: collected };
    });
    fileIds.push.apply(fileIds, result.fileIds);
    if (result.count < FAILURE_PAGE_SIZE) {
      break;
    }
  }
  return fileIds;
}

// TD-056：立即结束 targetId=partners._id 的有效会话（endedAt 在事务内落库，审计提交后写）；每页独立事务。
async function endViewSessions(scope, partner) {
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const rows = await scope.dao.transaction(async (trx) => {
      const list = await trx.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, {
        where: { targetId: partner._id, endedAt: null },
        orderBy: [['createdAt', 'asc']],
        limit: SESSION_PAGE_SIZE
      });
      for (let i = 0; i < list.length; i += 1) {
        await trx.update(COLLECTIONS.ADMIN_VIEW_SESSIONS, list[i]._id, {
          endedAt: scope.nowDate,
          updatedAt: scope.nowDate
        });
      }
      return list;
    });
    if (rows.length < SESSION_PAGE_SIZE) {
      break;
    }
  }
}

// TD-053：users 标记（不可再激活锚点）；已注销占位串（重复 CLOSED）不重写。
async function writeClosedMarkers(trx, scope, partner) {
  const openid = typeof partner.openid === 'string' ? partner.openid : '';
  if (!openid || identity.isClosedOpenid(openid)) {
    return;
  }
  await trx.update(COLLECTIONS.USERS, openid, {
    closedPartnerNo: String(partner.partnerNo || ''),
    partnerClosedAt: scope.nowDate,
    updatedAt: scope.nowDate
  });
}

async function updatePartnerDoc(trx, scope, partner, status, reason) {
  const patch = {
    status: status,
    updatedAt: scope.nowDate,
    serviceConfig: Object.assign({}, partner.serviceConfig || {}, {
      acceptingOrders: status === enums.PARTNER_STATUS.ACTIVE
    })
  };
  if (status === enums.PARTNER_STATUS.SUSPENDED) {
    patch.suspendedAt = scope.nowDate;
    patch.suspendedReason = reason;
  }
  if (status === enums.PARTNER_STATUS.ACTIVE) {
    patch.suspendedAt = null;
    patch.suspendedReason = '';
  }
  if (status === enums.PARTNER_STATUS.CLOSED) {
    // DATA_MODEL §10.3：partners 匿名化（displayName/avatarFileId/停用或关闭原因清空、openid 换注销占位串）；
    // 操作原因只留在 admin_audit.detail.reason（审计可追溯），文档保留审计不物理删。
    patch.deletedAt = scope.nowDate;
    patch.displayName = '';
    patch.avatarFileId = '';
    patch.suspendedReason = '';
    patch.closedReason = '';
    patch.openid = identity.closedOpenidOf(partner);
  }
  await trx.update(COLLECTIONS.PARTNERS, partner._id, patch);
}

// ── B 最终关键段（TD-055 唯一必须原子的部分）：users 注销标记 + partners 状态/openid 占位同一 2 ops 小事务。
async function commitFinalSegment(scope, partner, status, reason) {
  return scope.dao.transaction(async (trx) => {
    if (status === enums.PARTNER_STATUS.CLOSED) {
      await writeClosedMarkers(trx, scope, partner);
    }
    await updatePartnerDoc(trx, scope, partner, status, reason);
  });
}

// A 阶段编排：顺序不可省——先释放绑定/转订单，再清邀请码/失败记录/结束会话；每页独立事务。
async function runBatchStage(scope, partner, reason) {
  const outcome = emptyOutcome();
  outcome.affectedBindings = await releaseBindings(scope, partner);
  outcome.affectedOrders = await moveOrdersToException(scope, partner, reason);
  await clearInvitationUsage(scope, partner);
  outcome.failureFileIds = await anonymizeFailuresOfPartner(scope, partner);
  await endViewSessions(scope, partner);
  return outcome;
}

// ── 事务外：云存储删除（失败只告警、不回滚业务写入；与 user/_common.tryDeleteFile 同口径）──────
async function deleteFileSafe(ctx, fileId) {
  const target = typeof fileId === 'string' ? fileId : '';
  if (!target || !ctx || !ctx.cloud || typeof ctx.cloud.deleteFile !== 'function') {
    return false;
  }
  try {
    await ctx.cloud.deleteFile({ fileList: [target] });
    return true;
  } catch (error) {
    console.warn('[admin] 注销删除云文件失败，留待清理任务重试');
    return false;
  }
}

// 引用计数：历史 image.fileId + v1.0 images[0..9].fileId（跨单共享）与失败记录共用同一 fileId，归零才删。
async function deleteFileIfUnreferenced(scope, fileId) {
  if (!fileId) {
    return false;
  }
  let orderRefs = await scope.dao.count(COLLECTIONS.ORDERS, { where: { 'image.fileId': fileId } });
  for (let i = 0; orderRefs === 0 && i < IMAGE_INDEX_SLOTS; i += 1) {
    const where = {};
    where['images.' + i + '.fileId'] = fileId;
    orderRefs = await scope.dao.count(COLLECTIONS.ORDERS, { where: where });
  }
  const failureRefs = await scope.dao.count(COLLECTIONS.RECOGNITION_FAILURES, { where: { fileId } });
  if (orderRefs > 0 || failureRefs > 0) {
    return false;
  }
  return deleteFileSafe(scope.ctx, fileId);
}

async function deleteClosedFiles(scope, avatarFileId, failureFileIds) {
  let deleted = 0;
  for (let i = 0; i < failureFileIds.length; i += 1) {
    if (await deleteFileIfUnreferenced(scope, failureFileIds[i])) {
      deleted += 1;
    }
  }
  if (avatarFileId && await deleteFileSafe(scope.ctx, avatarFileId)) {
    deleted += 1;
  }
  return deleted;
}

// TD-056：会话结束审计（事务外；requestKey=switch-end:<会话id> 幂等，重放不重复写）
async function writeSessionEndAudits(scope, sessions) {
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    await scope.writeAudit(
      AUDIT_ACTIONS.ACCOUNT_SWITCH_END,
      { type: 'view_session', id: session._id },
      {
        viewMode: session.viewMode || '',
        role: session.role || '',
        targetNo: session.targetNo || '',
        targetIsTest: !!session.targetIsTest,
        reason: 'TARGET_DELETED'
      },
      'switch-end:' + session._id
    );
  }
  return sessions.length;
}

// TD-056：目标兼职已结束会话的审计（事务外；requestKey 幂等，重试可补写首次中断时缺的审计）
async function auditEndedSessions(scope, partner) {
  const rows = await scope.dao.find(COLLECTIONS.ADMIN_VIEW_SESSIONS, { where: { targetId: partner._id } });
  return writeSessionEndAudits(scope, rows.filter((row) => !!row.endedAt));
}

// TD-055 C 幂等收敛（from=CLOSED 的重试）：分批阶段全量重跑（各分页查询只命中未完成项，已收敛时零写），
// 再补最终段（仅当 openid 占位缺失，原子补 users 标记与 partners patch），最后补事务外删文件与审计（幂等）。
async function convergeClosed(scope, partner, reason) {
  const outcome = await runBatchStage(scope, partner, reason);
  const openid = typeof partner.openid === 'string' ? partner.openid : '';
  if (!identity.isClosedOpenid(openid)) {
    await commitFinalSegment(scope, partner, enums.PARTNER_STATUS.CLOSED, reason);
  }
  await deleteClosedFiles(scope, avatarFileIdOf(partner), outcome.failureFileIds);
  await auditEndedSessions(scope, partner);
  return outcome;
}

// 治理入口：ACTIVE/SUSPENDED 只写最终段；首次 CLOSED 走「分批 + 最终段 + 事务外副作用」；
// from 已是 CLOSED 且请求为 CLOSED 走幂等收敛（上次在最终段后/审计前中断的重试）。
async function governPartner(scope, partner, from, status, reason) {
  if (status !== enums.PARTNER_STATUS.CLOSED) {
    await commitFinalSegment(scope, partner, status, reason);
    return emptyOutcome();
  }
  if (from === enums.PARTNER_STATUS.CLOSED) {
    return convergeClosed(scope, partner, reason);
  }
  const avatarFileId = avatarFileIdOf(partner);
  const outcome = await runBatchStage(scope, partner, reason);
  await commitFinalSegment(scope, partner, status, reason);
  // 云存储删除在事务外：失败仅告警（cleanup/TD-051 兜底），不回滚已提交的 DB 治理结果
  await deleteClosedFiles(scope, avatarFileId, outcome.failureFileIds);
  await auditEndedSessions(scope, partner);
  return outcome;
}

async function writeStatusAudit(scope, info) {
  await scope.writeAudit(
    info.action,
    { type: 'partner', id: info.partnerNo },
    {
      partnerNo: info.partnerNo,
      from: info.from,
      to: info.status,
      toState: info.status,
      reason: info.reason,
      affectedBindings: info.outcome.affectedBindings,
      affectedOrders: info.outcome.affectedOrders,
      affectedMembers: Number(info.outcome.affectedMembers) || 0,
      cancelledTransfers: Number(info.outcome.cancelledTransfers) || 0,
      requestId: info.clientRequestId
    },
    info.requestKey
  );
}

async function replayOf(scope, replay) {
  if (!replay) {
    return null;
  }
  const partner = await getPartnerByNo(scope, (replay.target && replay.target.id) || '');
  if (!partner) {
    return null;
  }
  return {
    partner: dto.partnerBrief(partner, { bindings: 0, isTest: false }),
    affectedBindings: Number(replay.detail && replay.detail.affectedBindings) || 0,
    affectedOrders: Number(replay.detail && replay.detail.affectedOrders) || 0,
    duplicated: true
  };
}

// D59（CONTRACT §13）：主兼职 SUSPENDED/CLOSED 时级联同队子队员（复用本文件既有最终段/注销分批事务，不写第二份治理实现；恢复不级联）。
function teamCascadeOf(scope, partner, status, reason) {
  if (status === enums.PARTNER_STATUS.ACTIVE) {
    return Promise.resolve({ affectedMembers: 0, cancelledTransfers: 0 });
  }
  return team.cascadeSubMembers(scope, partner, status, reason, {
    suspendMember: (member) => commitFinalSegment(scope, member, status, reason),
    closeMember: (member) => governPartner(scope, member, member.status, enums.PARTNER_STATUS.CLOSED, reason)
  });
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const clientRequestId = requireClientRequestId(ctx);
  const input = payload || {};
  const noCheck = assertValid(sharedValidate.validatePartnerNo(input.partnerNo), '兼职编号格式不正确');
  const status = parseStatus(input.status);
  const reason = readNote(input.reason, 100, 'reason');
  if (status !== enums.PARTNER_STATUS.ACTIVE && !reason) {
    throw errors.validation('reason', '请填写操作原因');
  }
  const requestKey = auditKeyOf(ctx);
  const replay = await replayOf(scope, await scope.findAudit(requestKey));
  if (replay) {
    return replay;
  }
  const partner = await getPartnerByNo(scope, noCheck.canonical);
  if (!partner) {
    throw errors.notFound('兼职不存在');
  }
  if (await scope.isTestAccount(partner.openid)) {
    throw errors.invalidState('测试账号不能执行真实治理动作');
  }
  const from = partner.status;
  assertTransition(from, status);
  const outcome = await governPartner(scope, partner, from, status, reason);
  const teamOutcome = await teamCascadeOf(scope, partner, status, reason);
  outcome.affectedMembers = teamOutcome.affectedMembers;
  outcome.cancelledTransfers = teamOutcome.cancelledTransfers;
  const action = status === enums.PARTNER_STATUS.ACTIVE
    ? AUDIT_ACTIONS.PARTNER_RESTORE
    : AUDIT_ACTIONS.PARTNER_SUSPEND;
  await writeStatusAudit(scope, {
    action: action,
    partnerNo: noCheck.canonical,
    from: from,
    status: status,
    reason: reason,
    outcome: outcome,
    requestKey: requestKey,
    clientRequestId: clientRequestId
  });
  const fresh = await getPartnerByNo(scope, noCheck.canonical);
  return {
    partner: dto.partnerBrief(fresh || partner, { bindings: 0, isTest: false }),
    affectedBindings: outcome.affectedBindings,
    affectedOrders: outcome.affectedOrders
  };
}

module.exports = handler;
