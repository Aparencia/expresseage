// handlers/order/_dto-party.js · 订单 DTO 的「对方资料 / 事件裁剪 / admin 脱敏 / 时间片段」
// 从 _dto.js 拆出（门禁 #18 单文件 ≤500 行）；口径不变：D42/D19 隐私边界、D58 转派目标视角、D29 事件裁剪。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const mask = require('../../db/dto/mask');
const { counterpart: counterpartDto } = require('../../db/dto/full');
const avatarUrl = require('../../lib/avatar-url');
const {
  textOf,
  isoOf,
  buildParcelDto,
  buildImageDto,
  maskDeliveryDto
} = require('./_dto-fields');

function sameId(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }
  return String(left) === String(right);
}

async function loadPartnerById(ctx, partnerId) {
  if (partnerId === undefined || partnerId === null || partnerId === '') {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.PARTNERS, partnerId);
}

async function loadActiveBinding(ctx, customerId) {
  if (!customerId) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

// 对方公开资料：仅「当前 ACTIVE 绑定关系」内下发昵称与头像（解绑/停用/注销后不返回）
// D42/task-20：兼职→顾客方向随 DTO 下发 5 分钟临时 URL（src 优先，avatarFileId 回退）。
// D58（批 26）T9：顾客侧 counterpart 恒 = **绑定兼职**（绑定关系不随转派变），不是当前履约人；
// order.partnerId 可能已被转派改写，故按 binding.partnerId 取人（无绑定/非 ACTIVE 仍不返回）。
async function resolveCounterpart(ctx, order, side) {
  if (!order) {
    return null;
  }
  if (side === 'CUSTOMER') {
    const binding = await loadActiveBinding(ctx, order.customerId);
    if (!binding) {
      return null;
    }
    const partner = await loadPartnerById(ctx, binding.partnerId);
    if (!partner || partner.status !== enums.PARTNER_STATUS.ACTIVE || partner.deletedAt) {
      return null;
    }
    return counterpartDto({ displayName: textOf(partner.displayName), avatarFileId: partner.avatarFileId });
  }
  if (side === 'PARTNER' && order.customerId) {
    const binding = await loadActiveBinding(ctx, order.customerId);
    if (!binding || !sameId(binding.partnerId, order.partnerId)) {
      return null;
    }
    const customer = await ctx.dao.get(COLLECTIONS.CUSTOMERS, order.customerId);
    if (!customer) {
      return null;
    }
    const fileId = textOf(customer.avatarFileId);
    const urls = await avatarUrl.signAvatarUrls(ctx, [fileId]);
    return counterpartDto(
      { displayName: textOf(customer.displayName), avatarFileId: fileId },
      { avatarUrl: fileId ? urls[fileId] : '' }
    );
  }
  return null;
}

// admin 真实会话：默认脱敏（不返回完整 L3、不展示头像、昵称脱敏；完整 L3 只经只读视角）
// v1.0：多包裹逐件脱敏取件码；images[] 剔除 fileId（只留 status/hasImage/cleaned）；delivery 按宿舍/称呼脱敏。
function applyAdminMask(dto, counterpart) {
  const parcels = Array.isArray(dto.parcels) ? dto.parcels : [];
  parcels.forEach((parcel) => {
    parcel.pickupCode = mask.maskPickupCode(parcel.pickupCode);
  });
  dto.parcel = parcels[0] || buildParcelDto(null);
  const images = Array.isArray(dto.images) ? dto.images : [];
  dto.image = images[0] || buildImageDto(null);
  dto.phoneTail = mask.maskPhoneTail(dto.phoneTail);
  if (dto.dorm) {
    dto.dorm = {
      zone: dto.dorm.zone,
      buildingNo: dto.dorm.buildingNo,
      buildingText: mask.maskDorm(dto.dorm),
      room: '',
      dormKey: '',
      roomTag: ''
    };
  }
  if (dto.delivery) {
    dto.delivery = maskDeliveryDto(dto.delivery);
  }
  if (dto.guest) {
    dto.guest = {
      displayName: mask.maskDisplayName(dto.guest.displayName),
      phoneTail: mask.maskPhoneTail(dto.guest.phoneTail),
      zone: dto.guest.zone,
      buildingNo: dto.guest.buildingNo,
      buildingText: mask.maskDorm(dto.guest),
      room: '',
      dormKey: ''
    };
  }
  dto.counterpart = counterpart
    ? { displayName: mask.maskDisplayName(counterpart.displayName) }
    : null;
}

// 时间片段（订单 DTO 的 9 个时间键）：只经 isoOf 归一，'' = 没有这个时间。
function buildTimeFields(order) {
  return {
    statusUpdatedAt: isoOf(order.statusUpdatedAt),
    createdAt: isoOf(order.createdAt),
    updatedAt: isoOf(order.updatedAt),
    acceptedAt: isoOf(order.acceptedAt),
    pickedAt: isoOf(order.pickedAt),
    deliveredAt: isoOf(order.deliveredAt),
    completedAt: isoOf(order.completedAt),
    cancelledAt: isoOf(order.cancelledAt),
    deletedByCustomerAt: isoOf(order.deletedByCustomerAt)
  };
}

// 裁剪事件：type/at/actorRole/note（去 actorId/payload）。
// D58（批 26）：顾客侧拉黑 4 个私有转派事件（MESSAGE_HIDDEN_EVENT_TYPES，与 message.list 同口径）；
// TRANSFER_ACCEPTED 保留可见；PARTNER/ADMIN 侧全量下发（转派双方与后台需要完整留痕）。
function buildEventDtos(events, side) {
  const list = Array.isArray(events) ? events : [];
  const hidden = side === 'CUSTOMER' ? (enums.MESSAGE_HIDDEN_EVENT_TYPES || []) : [];
  return list
    .filter((event) => hidden.indexOf(event.type) < 0)
    .map((event) => ({
      type: textOf(event.type),
      at: isoOf(event.at),
      actorRole: textOf(event.actorRole),
      note: textOf(event.note)
    }));
}

module.exports = {
  resolveCounterpart,
  applyAdminMask,
  buildTimeFields,
  buildEventDtos
};
