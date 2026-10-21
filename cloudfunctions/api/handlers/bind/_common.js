// handlers/bind/_common.js · 绑定写入（事务分配 roomTag / 释放 / 通知）与绑定 DTO
// 口径：CONTRACT v0.9 §4.2（绑定方向铁律、解绑即失联）、DATA_MODEL §2.4/§7.4/§9（大写 roomTag、activeKey 唯一）；
//       ARCHITECTURE §4.3（bindings 只由 bind.create 写入；代客下单路径不得写）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const time = require('../../lib/time');
const { allocateRoomTag } = require('../../lib/tag-allocator');
const { errors } = require('../../lib/errors');
const { customerSelf } = require('../../db/dto/full');

const BIND_RELEASED_TEMPLATE = 'BIND_RELEASED';

function buildDormSnapshot(customer) {
  const doc = customer || {};
  const zone = typeof doc.zone === 'string' ? doc.zone : '';
  const buildingNo = doc.buildingNo;
  const room = typeof doc.room === 'string' ? doc.room : '';
  const dormKey = typeof doc.dormKey === 'string' ? doc.dormKey : '';
  const buildingText = zone && buildingNo !== undefined && buildingNo !== null ? zone + String(buildingNo) : '';
  return { zone, buildingNo, room, dormKey, buildingText };
}

// 绑定创建（必须在事务内调用）：activeKey=customerId 唯一索引兜底并发；roomTag 按（兼职,dormKey）取号
async function createBindingInTx(trx, options) {
  const opts = options || {};
  const customer = opts.customer || {};
  const partner = opts.partner || {};
  const nowDate = opts.nowDate;
  const nowMs = opts.nowMs;
  const dormSnapshot = buildDormSnapshot(customer);
  if (!dormSnapshot.dormKey) {
    throw errors.invalidState('请先完善宿舍信息后再绑定');
  }
  const allocated = await allocateRoomTag(trx, partner._id, dormSnapshot.dormKey, nowMs);
  const doc = {
    activeKey: customer._id,
    customerId: customer._id,
    partnerId: partner._id,
    status: enums.BINDING_STATUS.ACTIVE,
    roomTag: allocated.roomTag,
    allocSeq: allocated.seq,
    tagKey: partner._id + ':' + dormSnapshot.dormKey + ':' + allocated.roomTag,
    dormSnapshot,
    partnerNote: opts.partnerNote || '',
    boundAt: nowDate,
    updatedAt: nowDate,
    releasedAt: null,
    releaseReason: '',
    releaseNote: '',
    releasedBy: ''
  };
  const created = await trx.add(COLLECTIONS.BINDINGS, doc);
  doc._id = created._id;
  return doc;
}

// 绑定释放（事务内调用）：RELEASED + activeKey 改为带 _id 的历史键，保证一顾客仅一条 ACTIVE
async function releaseBindingInTx(trx, binding, options) {
  const opts = options || {};
  const releasedAt = opts.nowDate;
  const activeKey = binding.customerId + ':' + enums.BINDING_STATUS.RELEASED + ':' + binding._id;
  await trx.update(COLLECTIONS.BINDINGS, binding._id, {
    status: enums.BINDING_STATUS.RELEASED,
    activeKey,
    releasedAt,
    releaseReason: opts.reason,
    releaseNote: opts.note || '',
    releasedBy: opts.releasedBy,
    updatedAt: releasedAt
  });
  return { releasedAt, releaseReason: opts.reason };
}

// 兼职解绑/停用通知顾客（站内消息中心；无关联订单时 orderId 为空，templateCode 标明系统通知）
async function notifyCustomerReleased(ctx, options) {
  const opts = options || {};
  if (!opts.customerId || !ctx || !ctx.dao) {
    return false;
  }
  try {
    await ctx.dao.add(COLLECTIONS.ORDER_MESSAGES, {
      orderId: '',
      orderNo: '',
      fromRole: enums.ROLES.PARTNER,
      fromId: opts.partnerOpenid || '',
      text: opts.text || '兼职已解除与你的绑定',
      templateCode: BIND_RELEASED_TEMPLATE,
      isTest: opts.isTest === true,
      createdAt: opts.nowDate,
      readAt: null
    });
    return true;
  } catch (error) {
    console.warn('[api] 解绑通知写入失败', ctx.requestId);
    return false;
  }
}

function bindingSummary(binding, partner) {
  if (!binding) {
    return null;
  }
  const doc = partner || {};
  const summary = {
    bindingId: binding._id || '',
    partnerNo: doc.partnerNo || '',
    partnerDisplayName: doc.displayName || '',
    roomTag: binding.roomTag || '',
    dormKey: binding.dormSnapshot ? binding.dormSnapshot.dormKey || '' : '',
    buildingText: binding.dormSnapshot ? binding.dormSnapshot.buildingText || '' : '',
    boundAt: time.toMs(binding.boundAt),
    status: binding.status || enums.BINDING_STATUS.ACTIVE
  };
  if (doc.avatarFileId) {
    summary.partnerAvatarFileId = doc.avatarFileId;
  }
  return summary;
}

// 兼职客户档案行（本人绑定数据完整值：含手机尾号/完整门牌；头像/昵称仅 ACTIVE 绑定期间返回）
function partnerBindingRow(binding, customer, activeOrderCount) {
  const dorm = binding.dormSnapshot || {};
  const doc = customer || {};
  const row = {
    bindingId: binding._id || '',
    customerNo: doc.customerNo || '',
    dormKey: dorm.dormKey || doc.dormKey || '',
    buildingText: dorm.buildingText || '',
    roomTag: binding.roomTag || '',
    displayName: doc.displayName || '',
    phoneTail: doc.phoneTail || '',
    partnerNote: binding.partnerNote || '',
    boundAt: time.toMs(binding.boundAt),
    activeOrderCount: activeOrderCount || 0
  };
  if (doc.avatarFileId) {
    row.avatarFileId = doc.avatarFileId;
  }
  return row;
}

function customerSelfDto(customer) {
  return customerSelf(customer);
}

module.exports = {
  BIND_RELEASED_TEMPLATE,
  buildDormSnapshot,
  createBindingInTx,
  releaseBindingInTx,
  notifyCustomerReleased,
  bindingSummary,
  partnerBindingRow,
  customerSelfDto
};
