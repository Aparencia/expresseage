// db/dto/full.js · 本人 / 当前 ACTIVE 绑定对方视角的完整 DTO（L3 只允许在本文件与本人接口出现）
// 口径 = DATA_MODEL §2.2/§2.3/§7.3/§7.4：头像/昵称只随当前 ACTIVE 绑定关系返回；后台不走这里。
'use strict';

const genderLib = require('../../shared/gender');
const enums = require('../../shared/enums');

function customerSelf(customer) {
  const doc = customer || {};
  return {
    customerNo: doc.customerNo || '',
    displayName: doc.displayName || '',
    avatarFileId: doc.avatarFileId || '',
    zone: doc.zone || '',
    buildingNo: doc.buildingNo === undefined ? null : doc.buildingNo,
    room: doc.room || '',
    dormKey: doc.dormKey || '',
    phoneTail: doc.phoneTail || '',
    gender: genderLib.normalizeGender(doc.gender),
    genderManual: doc.genderManual === true,
    profileCompleted: !!doc.profileCompleted
  };
}

function partnerSelf(partner) {
  const doc = partner || {};
  return {
    partnerNo: doc.partnerNo || '',
    displayName: doc.displayName || '',
    avatarFileId: doc.avatarFileId || '',
    status: doc.status || '',
    serviceConfig: doc.serviceConfig || {},
    stats: doc.stats || {}
  };
}

// bound=true 仅在调用方与目标存在当前 ACTIVE 绑定关系时传；绑定前只回昵称、不回头像。
// avatarUrl（D42）：服务端签发的 5 分钟临时 URL（仅 ACTIVE 绑定且签发成功时下发），avatarFileId 保留作回退键。
function partnerPublic(partner, options) {
  const doc = partner || {};
  const opts = options || {};
  const config = doc.serviceConfig || {};
  const out = {
    partnerNo: doc.partnerNo || '',
    displayName: doc.displayName || '',
    status: doc.status || '',
    services: (Array.isArray(config.services) ? config.services : [])
      .filter((item) => item && enums.SERVICE_CODES.indexOf(item.code) >= 0),
    zones: Array.isArray(config.zones) ? config.zones : [],
    acceptingOrders: !!config.acceptingOrders
  };
  if (opts.bound === true && doc.avatarFileId) {
    out.avatarFileId = doc.avatarFileId;
    if (typeof opts.avatarUrl === 'string' && opts.avatarUrl) {
      out.avatarUrl = opts.avatarUrl;
    }
  }
  return out;
}

// 订单/客户档案内联的对方摘要：只用于当前 ACTIVE 绑定关系；解绑/停用/注销后调用方不要传 profile。
function counterpart(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const out = { displayName: profile.displayName || '' };
  if (profile.avatarFileId) {
    out.avatarFileId = profile.avatarFileId;
  }
  return out;
}

module.exports = {
  customerSelf,
  partnerSelf,
  partnerPublic,
  counterpart
};
