// handlers/admin/setPartnerStatus.js · admin.setPartnerStatus（停用/恢复/注销；注销释放绑定并把进行中订单转异常）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
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
const MAX_BINDINGS_PER_RUN = 500;
const MAX_ORDERS_PER_RUN = 500;
const MAX_FILES_PER_RUN = 500;

function parseStatus(value) {
  if (enums.PARTNER_STATUS_LIST.indexOf(value) < 0) {
    throw errors.validation('status', '兼职状态不正确');
  }
  return value;
}

function assertTransition(from, to) {
  if (from === to) {
    return;
  }
  if (from === enums.PARTNER_STATUS.CLOSED) {
    throw errors.invalidTransition('已注销的兼职不能恢复');
  }
  if (to === enums.PARTNER_STATUS.ACTIVE && from !== enums.PARTNER_STATUS.SUSPENDED) {
    throw errors.invalidTransition('当前状态不支持恢复');
  }
}

async function releaseBindings(scope, partner) {
  const rows = await scope.dao.find(COLLECTIONS.BINDINGS, {
    where: { partnerId: partner._id, status: enums.BINDING_STATUS.ACTIVE },
    limit: MAX_BINDINGS_PER_RUN
  });
  for (let i = 0; i < rows.length; i += 1) {
    const binding = rows[i];
    await scope.dao.update(COLLECTIONS.BINDINGS, binding._id, {
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
}

async function moveOrdersToException(scope, partner, reason) {
  const rows = await scope.dao.find(COLLECTIONS.ORDERS, {
    where: { partnerId: partner._id },
    orderBy: [['createdAt', 'desc']],
    limit: MAX_ORDERS_PER_RUN
  });
  const targets = rows.filter((order) => ACTIVE_ORDER_STATUSES.indexOf(order.status) >= 0);
  for (let i = 0; i < targets.length; i += 1) {
    const order = targets[i];
    const note = reason || CLOSED_NOTE;
    await scope.dao.transaction(async (trx) => {
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
    });
  }
  return targets.length;
}

// 云文件删除（注销匿名化用）：失败只告警、不回滚业务写入（与 user/_common.tryDeleteFile 同口径）
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

// 引用计数：同一截图可能仍被订单/其它识别失败记录引用（DATA_MODEL §10.1 订单侧规则先行），归零才删文件
async function deleteFileIfUnreferenced(scope, fileId) {
  if (!fileId) {
    return false;
  }
  const orderRefs = await scope.dao.count(COLLECTIONS.ORDERS, { where: { 'image.fileId': fileId } });
  const failureRefs = await scope.dao.count(COLLECTIONS.RECOGNITION_FAILURES, { where: { fileId } });
  if (orderRefs > 0 || failureRefs > 0) {
    return false;
  }
  return deleteFileSafe(scope.ctx, fileId);
}

// §10.3：兼职 CLOSED 同口径清识别失败 uploaderOpenid/fileId 并回收无引用原图（保留 sourceRole/时间供审计）
async function anonymizeFailuresOfPartner(scope, partner) {
  const rows = await scope.dao.find(COLLECTIONS.RECOGNITION_FAILURES, {
    where: { uploaderOpenid: partner.openid },
    orderBy: [['createdAt', 'asc']],
    limit: MAX_FILES_PER_RUN
  });
  let changed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const fileId = typeof rows[i].fileId === 'string' ? rows[i].fileId : '';
    await scope.dao.update(COLLECTIONS.RECOGNITION_FAILURES, rows[i]._id, {
      uploaderOpenid: '',
      fileId: '',
      updatedAt: scope.nowDate
    });
    if (fileId) {
      await deleteFileIfUnreferenced(scope, fileId);
    }
    changed += 1;
  }
  return changed;
}

// DATA_MODEL §2.8/§10.4：邀请码 usedBy 置空、保留 usedAt/batchId（审计可追溯；邀请码不重新生效）
async function clearInvitationUsage(scope, partner) {
  const result = await scope.dao.updateWhere(COLLECTIONS.INVITATION_CODES, { usedBy: partner._id }, {
    usedBy: '',
    updatedAt: scope.nowDate
  });
  return result.updated;
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
  let avatarFileId = partner.avatarFileId;
  if (typeof avatarFileId !== 'string') {
    avatarFileId = '';
  }
  let affectedBindings = 0;
  let affectedOrders = 0;
  if (status === enums.PARTNER_STATUS.CLOSED) {
    affectedBindings = await releaseBindings(scope, partner);
    affectedOrders = await moveOrdersToException(scope, partner, reason);
    // DATA_MODEL §10.3/§10.4：CLOSED 同口径匿名化关联痕迹（邀请码 usedBy / 识别失败上传人 + 原图回收）
    await clearInvitationUsage(scope, partner);
    await anonymizeFailuresOfPartner(scope, partner);
  }
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
    // DATA_MODEL §10.3：partners 匿名化（displayName/avatarFileId/停用或关闭原因清空）；
    // 操作原因只留在 admin_audit.detail.reason（审计可追溯），文档保留审计不物理删。
    patch.deletedAt = scope.nowDate;
    patch.displayName = '';
    patch.avatarFileId = '';
    patch.suspendedReason = '';
    patch.closedReason = '';
  }
  await scope.dao.update(COLLECTIONS.PARTNERS, partner._id, patch);
  if (status === enums.PARTNER_STATUS.CLOSED && avatarFileId) {
    await deleteFileSafe(scope.ctx, avatarFileId);
  }
  const action = status === enums.PARTNER_STATUS.ACTIVE
    ? AUDIT_ACTIONS.PARTNER_RESTORE
    : AUDIT_ACTIONS.PARTNER_SUSPEND;
  await scope.writeAudit(
    action,
    { type: 'partner', id: noCheck.canonical },
    {
      partnerNo: noCheck.canonical,
      from: from,
      to: status,
      toState: status,
      reason: reason,
      affectedBindings: affectedBindings,
      affectedOrders: affectedOrders,
      requestId: clientRequestId
    },
    requestKey
  );
  const fresh = await getPartnerByNo(scope, noCheck.canonical);
  return {
    partner: dto.partnerBrief(fresh || partner, { bindings: 0, isTest: false }),
    affectedBindings: affectedBindings,
    affectedOrders: affectedOrders
  };
}

module.exports = handler;
