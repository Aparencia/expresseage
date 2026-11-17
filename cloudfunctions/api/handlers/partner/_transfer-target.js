// handlers/partner/_transfer-target.js · 转派目标共用判定（D87/D88）
// 口径：CONTRACT §13 D87/D88 + D58 Q9（主兼职可转任意 ACTIVE；子队员限本队）。
// 用途：候选检索（searchTransferTargets）与转派码解析（resolveTransferCode）共用同一套判定，避免两份漂移。
// 边界：纯判定 + 常量，不读写库、不拼错误文案（文案由调用方单源）。
'use strict';

const TEAM_SCOPE_MAIN = ''; // 主兼职 parentPartnerId 为空串（DATA_MODEL §2.3）

// 测试兼职 openid 为 'TEST-<random>' 合成串 → 无需 join users 即可判定真实×测试隔离。
function isTestOpenid(openid) {
  return String(openid || '').indexOf('TEST-') === 0;
}

// 子队员可转范围 = 队长本人 + 同队队员（与 order.requestTransfer 的 assertTeamScope 同口径）。
function inTeamScopeOf(row, mainPartnerId) {
  return String(row && row._id) === String(mainPartnerId)
    || String((row && row.parentPartnerId) || '') === String(mainPartnerId);
}

// 主兼职（无队长）可转任意 ACTIVE；子队员必须落在本队范围。
function canReach(target, mainPartnerId) {
  if (String(mainPartnerId || '') === TEAM_SCOPE_MAIN) {
    return true;
  }
  return inTeamScopeOf(target, mainPartnerId);
}

// 候选卡片投影（检索/最近使用共用）：只三键（无头像/openid/_id）；acceptingOrders 供「接单中/已暂停」标签。
function cardOf(row) {
  const config = row && row.serviceConfig && typeof row.serviceConfig === 'object' ? row.serviceConfig : {};
  return {
    partnerNo: String((row && row.partnerNo) || ''),
    displayName: String((row && row.displayName) || ''),
    acceptingOrders: config.acceptingOrders === true
  };
}

module.exports = {
  TEAM_SCOPE_MAIN,
  isTestOpenid,
  inTeamScopeOf,
  canReach,
  cardOf
};
