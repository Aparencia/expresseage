// tools/lib/ai-station-cases.js · D70 服务端站点双判据/手机号闸断言（从 selftest-ai 拆出，守 #18 ≤1000 行）
// 口径：CONTRACT §13 D70/D72；DATA_MODEL §2.10。纯断言，不连真实云环境。
'use strict';

/**
 * @param {object} t 断言器（eq/check）
 * @param {{ruleOf:function, parseLib:object, stations:object}} deps
 */
function registerStationInferCases(t, deps) {
  const ruleOf = deps.ruleOf;
  const parseLib = deps.parseLib;
  const stations = deps.stations;
  // D70：取件码格式反推站点（服务端规则快照同源；码为权威，覆盖识图站点）
  const codeOnly = ruleOf('取件码 T-0-2051');
  t.eq([codeOnly.stationId, codeOnly.pickupCode, codeOnly.codeStatus], ['P3', 'T02051', 'OK'],
    'D70 服务端规则：无站点文本时由 T-0-2051 反推 P3');
  const conflict = ruleOf('西苑京东快递（西苑五食堂）\n取件码 64-4-4033');
  t.eq(conflict.stationId, 'P3', 'D70 识图站点与取件码规则冲突 → 以码为准（P3）');
  t.eq(ruleOf('取件码 18552133176').pickupCode, '', 'D70 手机号不当取件码（服务端规则）');
  t.eq(ruleOf('取件码 1855213376').pickupCode, '', 'D70 OCR 掉 1 位的 10 位手机号也不当码');
  t.eq([parseLib.normalizePickupCode('18552133176'), parseLib.normalizePickupCode('a1-23 4')], ['', 'A1234'],
    'D70 AI 输出归一：手机号置空、正常码去分隔符大写');
  const aiTable = stations.stationsFromConfig(null);
  const aiInferred = parseLib.normalizeAiFields({ stationId: 'P2', pickupCode: '64-4-4033' }, {
    stationIds: stations.STATION_IDS, stations: aiTable
  });
  t.eq([aiInferred.stationId, aiInferred.pickupCode], ['P3', '6444033'],
    'D70 AI 码命中格式 → 站点以码为准（覆盖模型给的 P2）');
  const aiInferredOnly = parseLib.normalizeAiFields({ stationId: '', pickupCode: 'T-0-2051' }, {
    stationIds: stations.STATION_IDS, stations: aiTable
  });
  t.eq([aiInferredOnly.stationId, aiInferredOnly.recognized], ['P3', true],
    'D70 AI 只给码：服务端补站点并判 recognized');
}

module.exports = { registerStationInferCases };
