// handlers/partner/saveServiceConfig.js · partner.saveServiceConfig（服务类型启用/服务范围/接单开关）
// 口径：CONTRACT v0.9 §6 / v1.3 §13 D41（只有类型，不含任何交易语义）；DATA_MODEL §2.3.1（MVP 实现 services/zones/acceptingOrders）。
// D41（2026-10-28 用户拍板）：可选目录只认现行 5 类（shared/enums.SERVICE_CODES）。
// 旧配置里的已停用码（如 PICKUP_DOOR）在网络/旧客户端载荷里出现时**静默忽略、不报错**；
// 保存后 partners.serviceConfig.services 只剩现行 code，停用码自然不再出现在兼职端。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const zones = require('../../shared/zones');
const { errors } = require('../../lib/errors');
const identity = require('../user/_common');

const MAX_SERVICES = 5;

function normalizeServiceConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const servicesInput = Array.isArray(input.services) ? input.services : [];
  const seen = {};
  const services = [];
  servicesInput.forEach((item) => {
    const code = item && typeof item.code === 'string' ? item.code : '';
    // 目录外 code（D41 停用的 PICKUP_DOOR 等）：忽略，不算非法、不报错（历史配置兼容）
    if (enums.SERVICE_CODES.indexOf(code) < 0 || seen[code]) {
      return;
    }
    seen[code] = true;
    services.push({ code, enabled: item.enabled === true });
  });
  if (services.length === 0) {
    throw errors.validation('serviceConfig.services', '请至少启用一种服务类型');
  }
  if (!services.some((item) => item.enabled)) {
    throw errors.validation('serviceConfig.services', '请至少启用一种服务类型');
  }
  if (services.length > MAX_SERVICES) {
    throw errors.validation('serviceConfig.services', '服务类型数量不合法');
  }
  const zonesInput = Array.isArray(input.zones) ? input.zones : [];
  const zoneList = [];
  zonesInput.forEach((item) => {
    const zone = zones.normalizeZone(item);
    if (!zone) {
      throw errors.validation('serviceConfig.zones', '服务范围包含无效楼区');
    }
    if (zoneList.indexOf(zone) < 0) {
      zoneList.push(zone);
    }
  });
  if (zoneList.length === 0) {
    throw errors.validation('serviceConfig.zones', '请至少选择一个服务楼区');
  }
  return {
    services,
    zones: zoneList,
    acceptingOrders: input.acceptingOrders === true
  };
}

async function handler(ctx, payload) {
  identity.assertWritable(ctx);
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const serviceConfig = normalizeServiceConfig(input.serviceConfig || input);
  const nowDate = identity.nowDate(ctx);
  await ctx.dao.update(COLLECTIONS.PARTNERS, partner._id, { serviceConfig, updatedAt: nowDate });
  return { serviceConfig };
}

module.exports = { handler, normalizeServiceConfig };
