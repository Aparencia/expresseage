// tools/lib/ai-station-cases.js · D70 服务端站点双判据/手机号闸断言（从 selftest-ai 拆出，守 #18 ≤1000 行）
// 口径：CONTRACT §13 D70/D72；DATA_MODEL §2.10。纯断言，不连真实云环境。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const AI_DIR = path.join(ROOT, 'cloudfunctions/api/handlers/ai');

// D70 双判据开关样本：缺省两项均开；显式 false 关闭单项/两项都关
const OFF_CODE = { stationInfer: { fromCode: false } };
const OFF_IMAGE = { stationInfer: { fromImage: false } };
const OFF_BOTH = { stationInfer: { fromImage: false, fromCode: false } };

/**
 * @param {object} t 断言器（eq/check）
 * @param {{ruleOf:function, parseLib:object, stations:object}} deps
 */
function registerStationInferCases(t, deps) {
  const ruleOf = deps.ruleOf;
  const parseLib = deps.parseLib;
  const stations = deps.stations;
  const stationIds = stations.STATION_IDS;
  const aiTable = stations.stationsFromConfig(null);
  const aiOptionsOf = (switches) => ({ stationIds: stationIds, stations: aiTable, stationInfer: switches });
  // 合法基线（两项开关开）：码为权威、手机号不当码
  const codeOnly = ruleOf('取件码 T-0-2051');
  t.eq([codeOnly.stationId, codeOnly.pickupCode, codeOnly.codeStatus], ['P3', 'T02051', 'OK'],
    'D70 服务端规则：无站点文本时由 T-0-2051 反推 P3');
  const conflict = ruleOf('西苑京东快递（西苑五食堂）\n取件码 64-4-4033');
  t.eq([conflict.stationId, conflict.stationConflict, conflict.conflicts.indexOf('STATION_CODE_DISAGREE') >= 0],
    ['', true, true], 'D80 识图站点与码反推冲突 → 不猜（站点留空 + 冲突码）');
  t.eq(ruleOf('取件码 18552133176').pickupCode, '', 'D70 手机号不当取件码（服务端规则）');
  t.eq(ruleOf('取件码 1855213376').pickupCode, '', 'D70 OCR 掉 1 位的 10 位手机号也不当码');
  t.eq([parseLib.normalizePickupCode('18552133176'), parseLib.normalizePickupCode('a1-23 4')], ['', 'A1234'],
    'D70 AI 输出归一：手机号置空、正常码去分隔符大写');
  const aiInferred = parseLib.normalizeAiFields({ stationId: 'P2', pickupCode: '64-4-4033' },
    { stationIds: stationIds, stations: aiTable });
  t.eq([aiInferred.stationId, aiInferred.pickupCode, aiInferred.confidence], ['', '6444033', 'LOW'],
    'D80 AI 站点与码反推冲突 → 站点留空 + LOW（触发复核，不静默覆盖）');
  const aiInferredOnly = parseLib.normalizeAiFields({ stationId: '', pickupCode: 'T-0-2051' },
    { stationIds: stationIds, stations: aiTable });
  t.eq([aiInferredOnly.stationId, aiInferredOnly.recognized], ['P3', true],
    'D70 AI 只给码：服务端补站点并判 recognized');

  // 负向：fromCode=false 时规则快照不做码反推（码仍抽取；站点回退识图或留空）
  const ruleOffCodeText = ruleOf('西苑京东快递（西苑五食堂）\n取件码 64-4-4033', '', OFF_CODE);
  t.eq([ruleOffCodeText.stationId, ruleOffCodeText.pickupCode], ['P2', '6444033'],
    'D70 开关 fromCode=false：规则快照不回码反推（识图站点 P2 保留、码照抽）');
  const ruleOffCodeOnly = ruleOf('取件码 T-0-2051', '', OFF_CODE);
  t.eq([ruleOffCodeOnly.stationId, ruleOffCodeOnly.pickupCode], ['', 'T02051'],
    'D70 开关 fromCode=false：只有码时规则快照不猜站点（站点留空、码照抽）');
  // 负向：fromImage=false 时规则快照不做截图文本站点归一（码反推照旧开）
  const ruleOffImage = ruleOf('西苑京东快递（西苑五食堂）取件码 A12345', '', OFF_IMAGE);
  t.eq(ruleOffImage.stationId, '', 'D70 开关 fromImage=false：规则快照不做截图文本站点归一（无码格式 → 站点留空）');
  // 负向：两关全关 → 规则快照不带任何站点来源
  const ruleBothOff = ruleOf('西苑京东快递（西苑五食堂）\n取件码 64-4-4033', '', OFF_BOTH);
  t.eq([ruleBothOff.stationId, ruleBothOff.pickupCode], ['', '6444033'],
    'D70 开关两关全关：规则快照既不归一也不反推（站点留空、码照抽）');

  // 负向：AI 输出同判（normalizeAiFields 读同一份 stationInfer）
  const aiOffCode = parseLib.normalizeAiFields({ stationId: 'P2', pickupCode: '64-4-4033' },
    aiOptionsOf({ fromCode: false }));
  t.eq([aiOffCode.stationId, aiOffCode.pickupCode], ['P2', '6444033'],
    'D70 开关 fromCode=false：AI 输出不回码反推（保留模型站点 P2、不换成 P3）');
  const aiOffCodeOnly = parseLib.normalizeAiFields({ stationId: '', pickupCode: 'T-0-2051' },
    aiOptionsOf({ fromCode: false }));
  t.eq([aiOffCodeOnly.stationId, aiOffCodeOnly.recognized], ['', false],
    'D70 开关 fromCode=false：AI 只给码时不补站点（recognized=false 交复核）');
  const aiOffImage = parseLib.normalizeAiFields({ stationId: 'P2', pickupCode: 'A12345' },
    aiOptionsOf({ fromImage: false }));
  t.eq([aiOffImage.stationId, aiOffImage.pickupCode], ['', 'A12345'],
    'D70 开关 fromImage=false：AI 输出不采信模型站点（码照归一、站点留空）');
  const aiBothOff = parseLib.normalizeAiFields({ stationId: 'P2', pickupCode: '64-4-4033' },
    aiOptionsOf({ fromImage: false, fromCode: false }));
  t.eq(aiBothOff.stationId, '', 'D70 开关两关全关：AI 输出不带任何站点来源（模型站点/码反推都不采信）');

  // 透传接线（静态）：ai.parseParcel 把同一份 stationInfer 交给规则快照与 AI 输出，两处同判
  const parseSrc = fs.readFileSync(path.join(AI_DIR, 'parseParcel.js'), 'utf8');
  t.check(/common\.buildRuleResult\([^)]*config\s*\)/.test(parseSrc)
    && parseSrc.indexOf('stationInfer: stations.stationInferOf(config)') >= 0,
  'D70 接线：ai.parseParcel 把 config 传给规则快照、把 stationInfer 传给 AI 输出（同开关）');
  const commonSrc = fs.readFileSync(path.join(AI_DIR, '_common.js'), 'utf8');
  t.check(/switches\.fromImage[\s\S]*?switches\.fromCode/.test(commonSrc),
    'D70 接线：buildRuleResult 用 switches.fromImage/fromCode 双门控（关时不归一/不反推）');
}

module.exports = { registerStationInferCases };
