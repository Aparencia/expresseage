// handlers/customer/saveProfile.js · customer.saveProfile（顾客资料：昵称/头像/宿舍身份/手机尾号）
// 口径：DATA_MODEL §2.2/§7.3；CONTRACT v0.9 §3/§4.2（首次生成 customerNo、头像仅绑定对方可见、
// 换宿舍=旧绑定 RELEASED+新绑定重新分配 roomTag）。昵称落库前过 security.msgSecCheck v2。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const { insertUnique, generateCustomerNo } = require('../../lib/id-generator');
const { customerSelf } = require('../../db/dto/full');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');
const uploadCommon = require('../upload/_common');
const bindCommon = require('../bind/_common');
const configCommon = require('../config/_common');

const DORM_FIELDS = ['zone', 'buildingNo', 'room'];

function pickDormInput(payload, existing) {
  const hasAny = DORM_FIELDS.some((field) => payload[field] !== undefined);
  if (!hasAny) {
    return { provided: false, valid: !!(existing && existing.dormKey), zone: existing ? existing.zone : '', buildingNo: existing ? existing.buildingNo : undefined, room: existing ? existing.room : '', dormKey: existing ? existing.dormKey : '', buildingText: existing ? (existing.zone || '') + (existing.buildingNo === undefined ? '' : String(existing.buildingNo)) : '' };
  }
  const merged = {
    zone: payload.zone !== undefined ? payload.zone : (existing && existing.zone),
    buildingNo: payload.buildingNo !== undefined ? payload.buildingNo : (existing && existing.buildingNo),
    room: payload.room !== undefined ? payload.room : (existing && existing.room)
  };
  const result = validate.validateDormIdentity(merged);
  if (!result.ok) {
    const message = result.field === 'room' ? '宿舍号需为 ≥100 的数字（如 522）' : '请选择苑并填写 1~10 的楼栋号';
    throw errors.validation(result.field || 'zone', message);
  }
  return { provided: true, valid: true, zone: result.zone, buildingNo: result.buildingNo, room: result.room, dormKey: result.dormKey, buildingText: result.buildingText };
}

async function ensureCustomerDoc(ctx, openid, base) {
  const existing = await identity.loadCustomer(ctx, openid);
  if (existing) {
    return { customer: existing, created: false };
  }
  try {
    await insertUnique(ctx.dao, COLLECTIONS.CUSTOMERS, {
      field: 'customerNo',
      generate: () => (ctx.ids && typeof ctx.ids.customerNo === 'function' ? ctx.ids.customerNo() : generateCustomerNo()),
      build: (customerNo) => Object.assign({ _id: openid, customerNo }, base)
    });
  } catch (error) {
    const raced = await identity.loadCustomer(ctx, openid);
    if (raced) {
      return { customer: raced, created: false };
    }
    throw error;
  }
  return { customer: await identity.loadCustomer(ctx, openid), created: true };
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const scope = await identity.assertBusinessRole(ctx, enums.ROLES.CUSTOMER);
  const input = payload && typeof payload === 'object' ? payload : {};
  const nowMs = identity.nowMs(ctx);
  const nowDate = identity.nowDate(ctx);
  const existing = await identity.loadCustomer(ctx, scope.openid);

  // 昵称：必填（首次）/可改；≤20 字截断；msgSecCheck v2 内容安全
  let displayNamePatch = null;
  if (input.displayName !== undefined) {
    const checked = validate.validateDisplayName(input.displayName);
    if (!checked.ok) {
      throw errors.validation('displayName', '请填写 1~20 字的昵称');
    }
    displayNamePatch = checked.value;
    if (!existing || existing.displayName !== displayNamePatch) {
      await identity.assertTextSafe(ctx, displayNamePatch, 'displayName');
    }
  } else if (!existing) {
    throw errors.validation('displayName', '请填写昵称');
  }

  const dorm = pickDormInput(input, existing);
  if (!existing && !dorm.provided) {
    throw errors.validation('zone', '请完善苑/楼栋/宿舍号');
  }
  let phoneTailPatch = null;
  if (input.phoneTail !== undefined) {
    const checked = validate.validatePhoneTail(input.phoneTail);
    if (!checked.ok) {
      throw errors.validation('phoneTail', '手机尾号需为 4 位数字，或留空');
    }
    phoneTailPatch = checked.value;
  } else if (!existing) {
    phoneTailPatch = '';
  }

  // 头像票据消费：purpose=AVATAR、归属 effectiveOpenid、路径前缀 avatars/{role}/、大小/类型
  let avatarTicket = null;
  let avatarFileId = null;
  const avatarTicketId = input.avatarTicket || input.avatarTicketId || '';
  if (avatarTicketId) {
    const config = await configCommon.loadRuntimeConfig(ctx);
    avatarTicket = await uploadCommon.loadAvatarTicket(ctx, avatarTicketId, nowMs);
    const providedFileId = input.avatarFileId || input.fileId || '';
    avatarFileId = uploadCommon.assertAvatarFile(providedFileId, avatarTicket, uploadCommon.avatarMaxBytes(config));
  } else if (input.avatarFileId === '') {
    avatarFileId = '';
  }

  const displayName = displayNamePatch !== null ? displayNamePatch : (existing ? existing.displayName || '' : '');
  const completedFlag = displayName !== '' && dorm.valid;

  const patch = { updatedAt: nowDate };
  if (displayNamePatch !== null) {
    patch.displayName = displayNamePatch;
    patch.profileUpdatedAt = nowDate;
  }
  if (dorm.provided) {
    patch.zone = dorm.zone;
    patch.buildingNo = dorm.buildingNo;
    patch.room = dorm.room;
    patch.dormKey = dorm.dormKey;
  }
  if (phoneTailPatch !== null) {
    patch.phoneTail = phoneTailPatch;
  }
  if (avatarFileId !== null) {
    patch.avatarFileId = avatarFileId;
    patch.profileUpdatedAt = nowDate;
  }
  patch.profileCompleted = completedFlag;

  // 换宿舍（已绑定、dormKey 变化）：无进行中订单才允许 → 旧绑定 RELEASED + 新绑定重新分配 roomTag
  const binding = existing ? await identity.getActiveBinding(ctx, scope.openid) : null;
  const dormChanged = !!(binding && dorm.provided && existing && existing.dormKey && dorm.dormKey !== existing.dormKey);
  if (dormChanged) {
    const activeOrder = await identity.hasActiveOrder(ctx, scope.openid, '');
    if (activeOrder) {
      throw errors.invalidState('有进行中的订单，暂不能修改宿舍信息');
    }
  }

  if (!existing) {
    await ensureCustomerDoc(ctx, scope.openid, Object.assign({
      roles: [enums.ROLES.CUSTOMER],
      displayName: displayNamePatch || '',
      avatarFileId: avatarFileId === null ? '' : avatarFileId,
      zone: dorm.zone || '',
      buildingNo: dorm.buildingNo === undefined ? null : dorm.buildingNo,
      room: dorm.room || '',
      dormKey: dorm.dormKey || '',
      phoneTail: phoneTailPatch || '',
      profileCompleted: completedFlag,
      createdAt: nowDate,
      updatedAt: nowDate,
      profileUpdatedAt: nowDate
    }));
  } else {
    const partner = dormChanged ? await identity.loadPartnerById(ctx, binding.partnerId) : null;
    if (dormChanged && !partner) {
      throw errors.invalidState('绑定的兼职已不可用，请重新绑定');
    }
    await ctx.dao.transaction(async (trx) => {
      await trx.update(COLLECTIONS.CUSTOMERS, scope.openid, patch);
      if (dormChanged) {
        await bindCommon.releaseBindingInTx(trx, binding, {
          reason: 'CUSTOMER_INITIATED',
          note: '换宿舍',
          releasedBy: enums.CANCELLED_BY.CUSTOMER,
          nowDate
        });
        const freshCustomer = Object.assign({}, existing, { zone: dorm.zone, buildingNo: dorm.buildingNo, room: dorm.room, dormKey: dorm.dormKey });
        await bindCommon.createBindingInTx(trx, {
          customer: freshCustomer,
          partner,
          nowMs,
          nowDate
        });
      }
    });
  }

  // 头像替换：写库成功后再删旧文件 + 消费票据（失败只告警，不回滚资料）
  if (avatarTicket) {
    if (existing && existing.avatarFileId && existing.avatarFileId !== avatarFileId) {
      await identity.tryDeleteFile(ctx, existing.avatarFileId);
    }
    await uploadCommon.consumeTicket(ctx, avatarTicket, nowMs);
  }

  const fresh = await identity.loadCustomer(ctx, scope.openid);
  const freshBinding = await identity.getActiveBinding(ctx, scope.openid);
  const result = {
    profile: customerSelf(fresh || {}),
    profileCompleted: !!(fresh && fresh.profileCompleted),
    customerNo: fresh ? fresh.customerNo || '' : '',
    avatarFileId: fresh ? fresh.avatarFileId || '' : '',
    binding: freshBinding
      ? { bindingId: freshBinding._id, dormKey: freshBinding.dormSnapshot ? freshBinding.dormSnapshot.dormKey : '', roomTag: freshBinding.roomTag || '' }
      : null
  };
  return result;
}

module.exports = { handler };
