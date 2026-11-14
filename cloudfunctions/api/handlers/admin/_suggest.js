// handlers/admin/_suggest.js · 批 39（D83）复核「一键建议」：从失败记录已有快照推导可回填的站点/取件码候选
// 口径：只读推导（不写库、不猜多解）：来源 = 规则快照 / 冲突双方（取件码格式 vs 截图文字）/ AI 结果 / 码格式反推；
// 每项带 reason + 中文来源；同一（stationId,pickupCode）去重；最多 3 条。
'use strict';

const stations = require('../../shared/stations');

const REASON_TEXT = Object.freeze({
  RULE: '规则识别结果',
  CODE_FORMAT: '取件码格式反推',
  IMAGE_TEXT: '截图站点文字',
  AI: 'AI 兜底结果',
  CODE_INFER: '取件码格式反推'
});

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function stationNameOf(stationId, config) {
  if (!stations.isStationId(stationId)) {
    return '';
  }
  const table = stations.stationsFromConfig(config);
  return stations.stationNameOf(stationId, { stations: table });
}

function pushUnique(list, item) {
  if (!stations.isStationId(item.stationId)) {
    return;
  }
  const duplicated = list.some((row) => row.stationId === item.stationId
    && row.pickupCode === item.pickupCode);
  if (duplicated) {
    return;
  }
  list.push(item);
}

function candidateOf(stationId, pickupCode, reason, config) {
  return {
    stationId: stationId,
    stationName: stationNameOf(stationId, config),
    pickupCode: pickupCode,
    reason: reason,
    reasonText: REASON_TEXT[reason] || ''
  };
}

function suggestionsOf(record, config) {
  const doc = record || {};
  const rule = doc.ruleResult && typeof doc.ruleResult === 'object' ? doc.ruleResult : {};
  const ai = doc.aiResult && typeof doc.aiResult === 'object' ? doc.aiResult : {};
  const conflict = rule.conflictStations && typeof rule.conflictStations === 'object'
    ? rule.conflictStations : null;
  const code = textOf(rule.pickupCode);
  const out = [];
  pushUnique(out, candidateOf(textOf(rule.stationId), code, 'RULE', config));
  if (conflict) {
    pushUnique(out, candidateOf(textOf(conflict.code && conflict.code.id), code, 'CODE_FORMAT', config));
    pushUnique(out, candidateOf(textOf(conflict.text && conflict.text.id), code, 'IMAGE_TEXT', config));
  }
  pushUnique(out, candidateOf(textOf(ai.stationId), textOf(ai.pickupCode) || code, 'AI', config));
  if (out.length === 0 && code) {
    const hit = stations.inferStationFromCode(code, { stations: stations.stationsFromConfig(config) });
    if (hit) {
      pushUnique(out, candidateOf(hit.id, code, 'CODE_INFER', config));
    }
  }
  return out.slice(0, 3);
}

module.exports = {
  REASON_TEXT,
  suggestionsOf
};
