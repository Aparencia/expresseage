// handlers/bind/getCurrent.js · bind.getCurrent（当前 ACTIVE 绑定摘要 + 兼职公开资料）
// 口径：CONTRACT v0.9 §5.3；DATA_MODEL §2.4 读屏蔽/§7.4：无绑定回 binding:null；解绑后不返回对方头像/昵称。
'use strict';

const enums = require('../../shared/enums');
const { partnerPublic } = require('../../db/dto/full');
const identity = require('../user/_common');

function bindingDto(binding) {
  return {
    bindingId: binding._id || '',
    dormKey: binding.dormSnapshot ? binding.dormSnapshot.dormKey || '' : '',
    buildingText: binding.dormSnapshot ? binding.dormSnapshot.buildingText || '' : '',
    roomTag: binding.roomTag || '',
    boundAt: binding.boundAt ? new Date(binding.boundAt).getTime() : 0
  };
}

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  if (scope.role && scope.role !== enums.ROLES.CUSTOMER) {
    return { binding: null, partnerPublic: null, serverTime: identity.nowMs(ctx) };
  }
  const binding = await identity.getActiveBinding(ctx, scope.openid);
  if (!binding) {
    return { binding: null, partnerPublic: null, serverTime: identity.nowMs(ctx) };
  }
  const partner = await identity.loadPartnerById(ctx, binding.partnerId);
  // D42：绑定对方头像 5 分钟临时 URL（仅当前 ACTIVE 绑定且签发成功时下发）；avatarFileId 保留作回退键。
  // 解绑后本函数回 {binding:null,partnerPublic:null}，URL 随之停发。
  const partnerFileId = partner && typeof partner.avatarFileId === 'string' ? partner.avatarFileId : '';
  const urls = await identity.signAvatarUrls(ctx, [partnerFileId]);
  return {
    binding: bindingDto(binding),
    partnerPublic: partner ? partnerPublic(partner, { bound: true, avatarUrl: urls[partnerFileId] }) : null,
    serverTime: identity.nowMs(ctx)
  };
}

module.exports = { handler };
