'use strict';
/**
 * tools/selftest-recognize.js — v4 识别规则纯件（utils/recognize/** 与 utils/ocr/** 的纯部分）。
 * 分层依据：docs/V4_ENGINEERING.md §7.1「识别规则」：码/站点/柜号/运单尾号/形态闸 + 语料样本。
 * 判据纪律：先合法基线、再只有该闸能挡的反例；样本非空（不许空集全绿）；期望值以
 *           docs/V4_CONTRACT.md §3/§4.3 为准；语料带 sha256 指纹钉，防样本被悄悄改动。
 * 接入：tools/selftest.js 里 `h.setExpected(require('./selftest-recognize').EXPECTED_ASSERTIONS)` 后 register(h)。
 * 零金额：本文件不得出现口径词表（ENGINEERING §7.6）字面量，需要时用构造串。
 */
const crypto = require('crypto');
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');

const ROOT = path.resolve(__dirname, '..');
const text = require(path.join(ROOT, 'utils/recognize/text.js'));
const codes = require(path.join(ROOT, 'utils/recognize/codes.js'));
const station = require(path.join(ROOT, 'utils/recognize/station.js'));
const recognize = require(path.join(ROOT, 'utils/recognize/index.js'));
const frame = require(path.join(ROOT, 'utils/ocr/frame.js'));
const vision = require(path.join(ROOT, 'utils/ocr/vision.js'));
const ocr = require(path.join(ROOT, 'utils/ocr/index.js'));
const sharedStations = require(path.join(ROOT, 'shared/stations.js'));
const sharedValidate = require(path.join(ROOT, 'shared/validate.js'));

const EXPECTED_ASSERTIONS = 195; // 改为实际断言数时同步核对 `node tools/selftest-recognize.js` 读数

// v3 真机语料（sha256 指纹钉：改动语料必须同步改这里的期望与解析断言）
const CORPUS_ONE = [
  '【菜鸟驿站】您的包裹已到西苑一栋南面快递中心，请凭取件码 8-2-3021 领取',
  '运单尾号 34567',
  '柜号：7号柜'
].join('\n');
const CORPUS_ONE_SHA256 = 'bd2e3fd5e022de1e6ddc5f206bbe29d4080ee0bd0f87b9732c8045276705fe8b';
const CORPUS_MULTI = [
  '取件码：2-3-4056',
  '取件码：8-2-3021',
  '站点：西苑京东快递（西苑五食堂）'
].join('\n');
const CORPUS_MULTI_SHA256 = 'b4448e4a9696c3f4567f7a5c88dfcf714793f0e39c0b5d0aad86d02cb2a0cbf8';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// ---------------------------------------------------------------- 文本归一
function sectionText(h) {
  h.section('§4.3 OCR 文本归一与切行', (t) => {
    t.eq(text.normalizeText('　ＡＢ１２\r\n\r\n x\u00a0y '), 'AB12\n\n x y',
      '§4.3 全角转半角、CRLF 归一、NBSP 转空格、去首尾空白');
    t.eq(text.splitLines('x\r\n\r\ny'), ['x', 'y'], '§4.3 切行去空行');
    t.eq(text.splitLines('  a   b  \n c '), ['a b', 'c'], '§4.3 行内空白折叠');
    t.eq(text.splitLines(''), [], '§4.3 空文本切行为空');
    t.eq(text.dedupeLines(['a', ' b ', 'a', '', 'b']), ['a', 'b'], '§4.3 行去重保序');
    t.eq(text.toHalfWidth('１２３'), '123', '§4.3 全角数字转半角');
  });
}

// ---------------------------------------------------------------- 去敏
function sectionMask(h) {
  h.section('§4.3 去敏（外发前二次去敏闸）', (t) => {
    t.eq(text.maskSensitive('手机号 13812345678 请联系'), '手机号 *** 请联系', '§4.3 手机号整体打码');
    t.eq(text.maskSensitive('身份证 110101199001011234 的件'), '身份证 *** 的件', '§4.3 身份证打码');
    t.eq(text.maskSensitive('单号 1234567890123456'), '单号 12****56', '§4.3 连续长数字中段掩码');
    t.eq(text.maskSensitive('尾号 6678 码 8-2-3021'), '尾号 6678 码 8-2-3021',
      '§4.3 四位尾号与短码保留（识别必需）');
    t.eq(text.maskSensitive('湖工大西苑3栋522室'), '***', '§4.3 详细门牌整行打码');
    t.eq(text.maskSensitive('a\u00a0b'), 'a b', '§4.3 NBSP 归一为空格');
    t.eq(text.maskSensitive('B'.repeat(5000)).length, 2000, '§4.3 去敏文本默认截到 2000 字');
    t.eq(recognize.maskForAi('A'.repeat(3000)).length, 2000, '§4.3 外发文本上限 2000 字');
  });
}

// ---------------------------------------------------------------- 尾号
function sectionTrackingTail(h) {
  h.section('§3 运单尾号候选（恰好 5 位数字）', (t) => {
    const keyword = text.pickTrackingTail(['运单尾号 34567']);
    t.eq(keyword.value, '34567', '§3 关键词行取尾号');
    t.eq(keyword.by, 'keyword', '§3 关键词命中来源标记');
    const standalone = text.pickTrackingTail(['34567']);
    t.eq(standalone.value, '34567', '§3 独立 5 位数字取尾号');
    t.eq(standalone.by, 'standalone', '§3 独立行来源标记');
    const none = text.pickTrackingTail(['取件码 8-2-3021']);
    t.eq(none.value, '', '§3 无 5 位数字返回空');
    t.eq(none.by, 'none', '§3 无候选来源标记 none');
    t.eq(text.pickTrackingTail([]).value, '', '§3 空行集返回空');
  });
}

// ---------------------------------------------------------------- 站点
function sectionStation(h) {
  h.section('§3/§4.2 站点归一（单源 shared/stations：P1~P8 正式名 + 别名）', (t) => {
    const list = station.listStations();
    t.eq(list.length, 8, '§4.2 站点恰好 P1~P8 八个');
    t.eq(list.map((item) => item.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      '§4.2 站点 id 顺序固定');
    // 单源判据有牙：同一数组对象（本地再复制一份表就会红，不只是"值相等"）
    t.check(station.STATIONS === sharedStations.STATIONS,
      '§4.2 识别站点表是 shared/stations 同一引用（无双份副本）');
    t.check(station.ALIASES === sharedStations.STATION_ALIASES,
      '§4.2 识别别名表是 shared/stations 同一引用（无双份副本）');
    t.check(station.normalizeStation === sharedStations.normalizeStation,
      '§4.2 归一函数直接委托 shared/stations.normalizeStation');
    t.check(station.ALIASES.every((item) => station.STATIONS.some((s) => s.id === item.id)),
      '§4.2 别名只指向已有站点（不自建站点）');
    t.eq(station.stationName('P1'), '西苑顺丰快递（西苑五食堂）', '§4.2 站点正式名');
    t.eq(station.stationName('P9'), '', '§4.2 未知站点无名称');
    t.eq(station.stationIdOfName('西苑一栋南面快递中心'), 'P3', '§4.2 正式名回查 id');
    t.eq(station.stationIdOfName('西苑顺丰快递(西苑五食堂)'), 'P1', '§4.2 标点差异仍可回查');
    t.eq(station.stationIdOfName('不存在驿站'), '', '§4.2 未登记站点不回查');
    t.eq(station.canonical('西苑 顺丰快递（西苑五食堂）'),
      sharedStations.canonicalStationText('西苑 顺丰快递（西苑五食堂）'),
      '§4.2 归一文本单源=shared/stations.canonicalStationText');
    const byName = station.matchStation('包裹已到西苑一栋南面快递中心，请及时领取');
    t.eq(byName.id, 'P3', '§4.3 文本命中正式名归一到 P3');
    t.check(['name', 'alias'].indexOf(byName.by) >= 0, '§4.3 命中来源标记在 name/alias 内');
    const byAlias = station.matchStation('北苑食堂三楼 到件通知');
    t.eq(byAlias.id, 'P4', '§4.3 shared 别名归一到 P4');
    t.eq(byAlias.by, 'alias', '§4.3 别名命中来源标记');
    t.eq(station.matchStation('西苑一栋南面快递中心 与 西苑一栋邮政'), null,
      '§4.3 同时命中两个正式名判歧义返回 null');
    t.eq(station.matchStation('西苑邮政 与 北苑食堂三楼'), null, '§4.3 两个别名指向不同站点判歧义');
    t.eq(station.matchStation('西苑顺丰 到件通知'), null,
      '§4.3 别名表未登记（单源=shared）不猜，留空手选');
    t.eq(station.matchStation('自建驿站到件'), null, '§4.3 未登记站点不猜');
    t.eq(station.matchStation(''), null, '§4.3 空文本不猜');
  });
}

// ---------------------------------------------------------------- 形态闸
function sectionCodes(h) {
  h.section('§3 取件码/柜号/运单尾号形态闸（含服务端紧凑闸复核）', (t) => {
    t.eq(codes.CODE_MAX, 40, '§3 取件码字段上限 40');
    t.eq(codes.LOCKER_MAX, sharedValidate.TEXT_LIMITS.lockerNo, '§3 柜号上限与服务端校验同源');
    t.eq(codes.normalizeCode('１２３４ ５６７８'), '12345678', '§3 取件码全角转半角去空白');
    t.check(['1234', '8-2-3021', 'A1234', '12-34'].every((code) => codes.isPlausibleCode(code)),
      '§3 合法码基线（含分隔符/字母混合）');
    t.check(['12', 'abcd', '2026-01-05', '13812345678', '12345', '']
      .every((code) => !codes.isPlausibleCode(code)),
    '§3 过短/无数字/日期/手机号/纯 5 位必须挡');
    t.check(codes.isPlausibleCode('1'.repeat(40)), '§3 恰好 40 位仍可识别');
    t.check(!codes.isPlausibleCode('1'.repeat(41)), '§3 超 40 位必须挡');
    t.check(codes.scoreCode('8-2-3021') > codes.scoreCode('123456'), '§3 分段码比纯数字码更可信');
    t.eq(codes.scoreCode('abcd'), 0, '§3 非法码打 0 分');
    t.eq(codes.pickCodes(['取件码：8-2-3021', '重复 8-2-3021']).length, 1, '§3 同图重复码去重');
    t.eq(codes.pickCodes(['取件码：123456', '码 8-2-3021'])[0].value, '8-2-3021', '§3 候选按可信度降序');
    t.eq(codes.pickCodes(['运单尾号 34567']).length, 0, '§3 纯 5 位尾号不当取件码');
    t.eq(codes.normalizeLocker('A B 12'), 'AB12', '§3 柜号去空白');
    t.eq(codes.normalizeLocker('ABCDEFGHIJK'), 'ABCDEFGHIJK', '§3 柜号归一不再静默截断（原样返回）');
    t.check(codes.isPlausibleLocker('A12') && codes.isPlausibleLocker('7-2'), '§3 柜号字符串都可收');
    t.check(codes.isPlausibleLocker('ABCDEFGHIJ'), '§3 柜号恰好 10 字仍可收');
    t.check(!codes.isPlausibleLocker('ABCDEFGHIJK'), '§3 柜号 11 字必须挡（先判原长再归一）');
    t.eq(codes.normalizeTail('１２３４５'), '12345', '§3 尾号全角转半角');
    t.eq(codes.normalizeTail('1234'), '', '§3 4 位不成尾号');
    t.eq(codes.normalizeTail('a12345b'), '12345', '§3 尾号从混排文本抽 5 位数字');
    t.check(codes.isPlausibleTail('12345') && !codes.isPlausibleTail('1234'), '§3 尾号形态判定');
    t.eq(codes.deriveCodeStatus('123456', ''), 'OK', '§3 有码为 OK');
    t.eq(codes.deriveCodeStatus('', '12345'), 'NEED_CODE', '§3 无码有尾号为 NEED_CODE');
    t.eq(codes.deriveCodeStatus('', ''), 'NONE', '§3 都无为 NONE');
    t.eq(codes.deriveCodeStatus('12', ''), 'NONE', '§3 无效码且无尾号为 NONE');
    // 紧凑闸（与服务端 validatePickupCode 同判；超长/奇怪符号的候选不自动填）
    t.eq(codes.compactCode('8-2-3021'), '823021', '§3 紧凑码=去空格/连字符/下划线/#');
    t.check(codes.isCompactCode('8-2-3021') && codes.isCompactCode('123456789012'),
      '§3 紧凑 4~12 位字母数字合法（含分隔符原样）');
    t.check(!codes.isCompactCode('1'.repeat(13)) && !codes.isCompactCode('1'.repeat(40)),
      '§3 紧凑超 12 位必须挡（端侧与服务端同闸）');
    t.check(!codes.isCompactCode('8*2*3021'), '§3 带 * 的候选过不了服务端紧凑闸');
    t.check(codes.isAutoFillCode('8-2-3021') && !codes.isAutoFillCode('1'.repeat(13)),
      '§3 自动填只认展示闸+紧凑闸都过的码');
    t.eq(codes.pickCodes(['取件码 1234567890123']).length, 0, '§3 超长紧凑候选不当取件码自动填');
    t.eq(codes.pickCodeCandidates(['取件码 1234567890123'])[0].compact, false,
      '§3 超长候选仍进候选池并标 compact=false（供"认出但不像"提示）');
    const compactSamples = ['1234', '8-2-3021', '123456789012', '1234567890123', '12-34',
      'ABCD1234', 'A1-B2-C3', '1'.repeat(40), '8*2*3021'];
    t.check(compactSamples.every((code) => codes.isCompactCode(code) === sharedValidate.validatePickupCode(code).ok),
      '§3 紧凑闸与 shared/validate.validatePickupCode 同判（逐样本一致）');
    t.eq(codes.deriveCodeStatus('1'.repeat(13), ''), 'NONE', '§3 紧凑超长码不可提交（避免服务端才拒）');
  });
}

// ---------------------------------------------------------------- 单件形态闸
function sectionValidateParcel(h) {
  h.section('§4.3 单件形态闸 validateParcel', (t) => {
    const empty = recognize.makeEmptyParcel();
    t.check(empty.codeStatus === 'NEED_CODE' && empty.recognized === false && empty.stationId === '',
      '§4.3 空件 DTO 初值');
    t.eq(Object.keys(recognize.FORM_ERROR).sort(),
      ['codeStatus', 'lockerNo', 'pickupCode', 'station', 'stationName'.slice(0, 0) + 'trackingTail'].sort(),
      '§4.3 行内提示键齐全');
    const blank = recognize.validateParcel({});
    t.check(blank.ok === false && !!blank.errors.station, '§4.3 无站点报行内错误');
    t.eq(blank.codeStatus, 'NONE', '§4.3 无码无尾号不可提交');
    const tailOnly = recognize.validateParcel({ stationId: 'P1', trackingTail: '12345' });
    t.check(tailOnly.ok === true, '§4.3 无码有尾号可先提交（手填兜底）');
    t.eq(tailOnly.codeStatus, 'NEED_CODE', '§4.3 有尾号置 NEED_CODE');
    const ready = recognize.validateParcel({ stationId: 'P1', pickupCode: '123456' });
    t.check(ready.ok === true && ready.codeStatus === 'OK', '§4.3 站点+码齐全为 OK');
    t.check(!!recognize.validateParcel({ stationId: 'P1', pickupCode: 'ab' }).errors.pickupCode,
      '§4.3 不像取件码给行内提示');
    t.check(!!recognize.validateParcel({ stationId: 'P1', trackingTail: '1234' }).errors.trackingTail,
      '§4.3 尾号非 5 位给行内提示');
    t.check(!!recognize.validateParcel({ stationId: 'P9' }).errors.station, '§4.3 非 P1~P8 站点给行内提示');
    t.check(!!recognize.validateParcel({ stationId: 'P1', pickupCode: '1'.repeat(41) }).errors.pickupCode,
      '§4.3 超长码给行内提示');
    t.check(!!recognize.validateParcel({ stationId: 'P1', pickupCode: '1'.repeat(13) }).errors.pickupCode,
      '§4.3 紧凑超 12 位给行内提示（服务端会拒的单子端侧先挡）');
    t.check(!!recognize.validateParcel({ stationId: 'P1', lockerNo: 'ABCDEFGHIJK' }).errors.lockerNo,
      '§4.3 柜号 11 字给行内提示（原长判定，不截断放行）');
    t.check(recognize.validateParcel({ stationId: 'P1', trackingTail: '12345', lockerNo: 'ABCDEFGHIJ' }).ok === true,
      '§4.3 柜号 10 字可通过');
  });
}

// ---------------------------------------------------------------- DTO 解析
function sectionParse(h) {
  h.section('§4.3 OCR 文本 → 订单字段 DTO（含 v3 语料指纹钉）', (t) => {
    t.notEmpty(CORPUS_ONE, '§4.3 语料样本非空（空集不得判绿）');
    t.eq(sha256(CORPUS_ONE), CORPUS_ONE_SHA256, '§4.3 语料一 sha256 指纹未漂移');
    const one = recognize.parseOcrText(CORPUS_ONE);
    t.check(one.found === true, '§4.3 语料一解析出件');
    t.eq(one.station.id, 'P3', '§4.3 语料一站点点归一到 P3');
    t.eq(one.trackingTail, '34567', '§4.3 语料一抽到运单尾号');
    t.eq(one.lockerNo, '7', '§4.3 语料一抽到柜号');
    t.eq(one.items.length, 1, '§4.3 语料一单码单件');
    t.eq(one.items[0].pickupCode, '8-2-3021', '§4.3 语料一取件码原样保留');
    t.eq(one.items[0].codeStatus, 'OK', '§4.3 语料一 codeStatus=OK');
    t.eq(one.items[0].confidence, 'MEDIUM', '§4.3 站点+尾号齐为 MEDIUM');
    t.eq(one.needsReview, false, '§4.3 语料一无需复核');

    t.eq(sha256(CORPUS_MULTI), CORPUS_MULTI_SHA256, '§4.3 语料二 sha256 指纹未漂移');
    const multi = recognize.parseOcrText(CORPUS_MULTI);
    t.eq(multi.station.id, 'P2', '§4.3 语料二站点点归一到 P2');
    t.eq(multi.items.length, 2, '§4.3 一图多码拆两件');
    t.eq(multi.items.map((item) => item.pickupCode), ['2-3-4056', '8-2-3021'],
      '§4.3 多码按候选顺序逐件');
    t.check(multi.items.every((item) => item.codeStatus === 'OK'), '§4.3 多件均 OK');

    const blank = recognize.parseOcrText('');
    t.check(blank.found === false && blank.items.length === 0, '§4.3 空文本不产出件');
    t.notEmpty(Object.keys(blank.formErrors), '§4.3 空文本给出可手填提示（样本非空）');
    const tailOnly = recognize.parseOcrText('运单尾号 34567');
    t.check(tailOnly.found === true && tailOnly.items.length === 1, '§4.3 无码有尾号产出一件');
    t.eq(tailOnly.items[0].codeStatus, 'NEED_CODE', '§4.3 无码件 codeStatus=NEED_CODE');
    const unknownStation = recognize.parseOcrText('取件码：8-2-3021');
    t.eq(unknownStation.station, null, '§4.3 未识别到站点时 station=null');
    t.eq(unknownStation.items[0].stationId, '', '§4.3 未识别站点时 stationId 留空');
    t.eq(unknownStation.items[0].confidence, 'LOW', '§4.3 缺站点置信度 LOW');
    t.eq(unknownStation.needsReview, true, '§4.3 缺站点需复核');
    t.check(recognize.parseOcrText(CORPUS_MULTI).items.every((item, index) => item.index === index),
      '§4.3 多件 index 从 0 递增');

    // 紧凑超长候选：认出但不像 → 不自动填，只回候选给页面提示
    const tooLong = recognize.parseOcrText('取件码：1234567890123');
    t.check(tooLong.found === false && tooLong.items.length === 0, '§4.3 紧凑超长码不产出可提交件');
    t.eq(tooLong.unalignedCodes, ['1234567890123'], '§4.3 超长候选进 unalignedCodes（认出但不像）');
    t.check(!!tooLong.formErrors.pickupCode, '§4.3 超长候选给行内提示文案');
    t.eq(tooLong.needsReview, true, '§4.3 超长候选需复核/可走 AI 兜底');
  });
}

// ---------------------------------------------------------------- AI 合并
function sectionApplyAi(h) {
  h.section('§4.3 AI 兜底合并（手填优先 / 只填空字段）', (t) => {
    const suggestion = {
      stationId: 'P1',
      pickupCode: '123456',
      trackingTail: '12345',
      lockerNo: 'A1',
      confidence: 'MEDIUM',
      source: 'RULE',
      recognized: true,
      needsReview: false,
      failureId: 'F-20260105-ABCDEF'
    };
    const merged = recognize.applyAiSuggestion({}, suggestion);
    t.eq(merged.changed.slice().sort(), ['lockerNo', 'pickupCode', 'station', 'trackingTail'],
      '§4.3 空件四字段都被补全');
    t.eq(merged.parcel.stationName, '西苑顺丰快递（西苑五食堂）', '§4.3 补站点时回填正式名');
    t.eq(merged.parcel.source, 'RULE', '§4.3 合并后来源标记');
    t.eq(merged.parcel.confidence, 'MEDIUM', '§4.3 合并后置信度');
    t.eq(merged.parcel.failureId, 'F-20260105-ABCDEF', '§4.3 failureId 透传');
    t.check(merged.parcel.aiApplied === true, '§4.3 有补全时标 aiApplied');
    t.eq(merged.parcel.needsReview, false, '§4.3 高可信合并不需复核');

    const manualFirst = recognize.applyAiSuggestion({ stationId: 'P2', pickupCode: '1234' }, suggestion);
    t.eq(manualFirst.parcel.stationId, 'P2', '§4.3 手填站点不被 AI 覆盖');
    t.eq(manualFirst.parcel.pickupCode, '1234', '§4.3 手填取件码不被 AI 覆盖');
    t.eq(manualFirst.changed, ['trackingTail', 'lockerNo'], '§4.3 只补空字段');

    const alreadyFilled = recognize.applyAiSuggestion(
      { stationId: 'P1', pickupCode: '123456', trackingTail: '12345', lockerNo: 'A1' }, suggestion);
    t.eq(alreadyFilled.changed, [], '§4.3 全已填时零改动');
    t.check(alreadyFilled.parcel.aiApplied !== true, '§4.3 零改动不标 aiApplied');

    const rejected = recognize.applyAiSuggestion({}, { pickupCode: 'ab', trackingTail: '1234' });
    t.eq(rejected.changed, [], '§4.3 不过形态闸的 AI 字段被丢弃');
    const aiTooLong = recognize.applyAiSuggestion({}, { pickupCode: '1234567890123' });
    t.eq(aiTooLong.changed, [], '§4.3 AI 给的紧凑超长码不自动填');
    t.eq(aiTooLong.parcel.aiPickupCodeUnaligned, '1234567890123',
      '§4.3 AI 超长候选只留痕"认出但不像"');
    const lowConf = recognize.applyAiSuggestion({}, { stationId: 'P1', confidence: 'LOW', recognized: false });
    t.eq(lowConf.parcel.needsReview, true, '§4.3 低置信/未识别置 needsReview');
    const prefillDegraded = recognize.applyAiSuggestion({}, {
      recognized: false, stationId: 'P1', trackingTail: '34567', needsReview: true, failureId: 'F-20260105-ABCDEF'
    });
    t.check(prefillDegraded.changed.indexOf('station') >= 0 && prefillDegraded.parcel.trackingTail === '34567',
      '§4.3 认失败只预填（recognized:false 也填可填字段）');
    t.eq(prefillDegraded.parcel.failureId, 'F-20260105-ABCDEF', '§4.3 失败单 failureId 透传');
    const recomputed = recognize.applyAiSuggestion({}, { stationId: 'P1', pickupCode: '123456' });
    t.eq(recomputed.parcel.codeStatus, 'OK', '§4.3 合并后重算 codeStatus');
  });
}

// ---------------------------------------------------------------- 摘要
function sectionSummary(h) {
  h.section('§4.3 页内摘要行', (t) => {
    t.eq(recognize.summarizeParcel({
      stationName: '西苑顺丰快递（西苑五食堂）', pickupCode: '123456', lockerNo: 'A1',
      trackingTail: '12345', codeStatus: 'OK'
    }), '西苑顺丰快递（西苑五食堂） · 123456 · 柜 A1 · 尾号 12345', '§4.3 摘要行按锚+键拼装');
    t.eq(recognize.summarizeParcel({ codeStatus: 'NEED_CODE' }), '需查明', '§4.3 待补码摘要提示需查明');
    t.eq(recognize.summarizeParcel({}), '', '§4.3 全空摘要为空串');
  });
}

// ---------------------------------------------------------------- 帧诊断
function sectionFrame(h) {
  h.section('§7 OCR 帧诊断与条带（纯函数）', (t) => {
    t.check(frame.MIN_EDGE === 64 && frame.MAX_EDGE === 4096 && frame.DEFAULT_MAX_EDGE === 1440,
      '§7 帧尺寸常量与 v3 阶梯一致');
    t.eq(frame.frameSize(3000, 2000, 1440), { ok: true, width: 1440, height: 960, scale: 0.48 },
      '§7 按长边等比缩放');
    t.eq(frame.frameSize(30, 30).code, 'IMAGE_DECODE_FAILED', '§7 过小图判解码失败');
    t.notEmpty(frame.frameSize(30, 30).detail, '§7 失败带可读原因');
    t.eq(frame.frameSize(100, 100, 10).width, 64, '§7 目标长边低于下限时抬到 64');
    t.eq(frame.frameSize(10000, 100, 1e9).width, 4096, '§7 目标长边高于上限时压到 4096');
    t.eq(frame.frameSize(0, 100).code, 'IMAGE_DECODE_FAILED', '§7 零尺寸判解码失败');
    t.eq(frame.frameSize(2000, 1000, NaN).width, 1440, '§7 非法长边回默认 1440');
    t.eq(frame.isUsableFrame(null).code, 'IMAGE_DECODE_FAILED', '§7 无帧判解码失败');
    t.eq(frame.isUsableFrame({ width: 100, height: 100, errno: 5 }).code, 'IMAGE_DECODE_FAILED',
      '§7 带 errno 判解码失败');
    t.eq(frame.isUsableFrame({ width: 100, height: 100, data: new Uint8Array(0) }).code,
      'IMAGE_DECODE_FAILED', '§7 空像素判解码失败');
    t.check(frame.isUsableFrame({ width: 100, height: 100 }).ok === true, '§7 尺寸合法帧可用');
    t.check(frame.isUsableFrame({ width: 100, height: 100, data: new Uint8Array(4) }).ok === true,
      '§7 非空像素帧可用');
    t.eq(frame.bandRanges(4), [
      { index: 0, from: 0, to: 0.25 },
      { index: 1, from: 0.25, to: 0.5 },
      { index: 2, from: 0.5, to: 0.75 },
      { index: 3, from: 0.75, to: 1 }
    ], '§7 四条带均分纵向');
    t.eq(frame.bandRanges(0).length, 1, '§7 条带数下限 1');
    t.eq(frame.bandRanges(9).length, 4, '§7 条带数上限 4');
    t.check(frame.bandRanges(2).every((range) => range.from >= 0 && range.to <= 1 && range.to > range.from),
      '§7 条带区间合法');
  });
}

// ---------------------------------------------------------------- 识别内核
function sectionVision(h) {
  h.section('§7 端侧识别阶梯内核（注入 deps，零 wx）', async (t) => {
    t.eq(vision.LADDER.map((step) => step.bands), [1, 2, 4], '§7 阶梯先整图再 2/4 条带');
    t.check(vision.IDLE_MS > 0 && vision.MAX_WAIT_MS > 0 && vision.FRAME_TIMEOUT_MS > 0
      && vision.OCR_MAX_MS > 0, '§7 识别预算常量齐全');
    t.eq(vision.fail('NO_TEXT').ok, false, '§7 fail 统一失败形状');

    t.eq(vision.classifyStartErrno(112).reason, 'VK_INIT_FAILED', '§7 未声明隐私指引判初始化失败');
    t.eq(vision.classifyStartErrno(2000002).reason, 'VK_UNSUPPORTED', '§7 设备不支持判不支持');
    t.eq(vision.classifyStartErrno(999).reason, 'VK_INIT_FAILED', '§7 未知 errno 保守判初始化失败');
    t.notEmpty(Object.keys(vision.classifyStartErrno(104)), '§7 errno 分类带 reason/detail');

    t.eq(vision.mergeTexts([{ texts: ['a', 'b'] }, { texts: [' b ', 'c', ''] }]), ['a', 'b', 'c'],
      '§7 多条带结果去重合并保序');

    const fast = await vision.withTimeout(Promise.resolve({ ok: true }), 50, 'NO_TEXT', '超时');
    t.check(fast.ok === true, '§7 withTimeout 快路径透传结果');
    const hung = await vision.withTimeout(new Promise(() => {}), 5, 'NO_TEXT', '超时');
    t.eq(hung.code, 'NO_TEXT', '§7 悬挂取像素超时收口（永不悬挂）');

    t.eq((await vision.recognizeImage({ hasVision: false }, {})).code, 'VK_UNSUPPORTED',
      '§7 不支持端侧识别时返回 VK_UNSUPPORTED');
    t.eq((await vision.recognizeImage({}, {})).code, 'VK_INIT_FAILED', '§7 能力未注入返回 VK_INIT_FAILED');

    const okDeps = {
      loadFrame: async () => ({ ok: true, frame: { width: 100, height: 100 } }),
      runVision: async () => ({ ok: true, texts: ['取件码 8-2-3021'] })
    };
    const okResult = await vision.recognizeImage(okDeps, { filePath: 'x' });
    t.check(okResult.ok === true, '§7 正常识别成功');
    t.eq(okResult.texts, ['取件码 8-2-3021'], '§7 正常识别返回文字行');

    const loadFail = await vision.recognizeImage({
      loadFrame: async () => ({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '坏图' }),
      runVision: async () => ({ ok: true, texts: [] })
    }, {});
    t.eq(loadFail.code, 'IMAGE_DECODE_FAILED', '§7 取帧失败直接返回失败码');
    t.eq(loadFail.detail, '坏图', '§7 取帧失败保留原因');

    const throwLoad = await vision.recognizeImage({
      loadFrame: async () => { throw new Error('boom'); },
      runVision: async () => ({ ok: true, texts: [] })
    }, {});
    t.eq(throwLoad.code, 'IMAGE_DECODE_FAILED', '§7 取帧抛错收口为统一失败');

    const runFail = await vision.recognizeImage({
      loadFrame: async () => ({ ok: true, frame: {} }),
      runVision: async () => ({ ok: false, code: 'NO_TEXT' })
    }, {});
    t.eq(runFail.code, 'NO_TEXT', '§7 识别内核失败码透传');

    let calls = 0;
    const ladder = await vision.recognizeImage({
      loadFrame: async () => ({ ok: true, frame: {} }),
      runVision: async () => {
        calls += 1;
        return calls === 1 ? { ok: true, texts: [] } : { ok: true, texts: ['分段文字'] };
      }
    }, {});
    t.check(ladder.ok === true, '§7 整图无字时降级条带重试成功');
    t.eq(ladder.texts, ['分段文字'], '§7 条带结果合并输出');
    t.eq(ladder.partial, true, '§7 降级结果标 partial');
    t.eq(calls, 3, '§7 阶梯逐级重试（整图+2条带+4条带）');
  });
}

// ---------------------------------------------------------------- OCR 出口
function sectionOcrEntry(h) {
  h.section('§7 OCR 统一出口与失败文案', async (t) => {
    t.eq(ocr.FAILURE_CODES.length, 4, '§7 端侧失败码 4 类');
    t.check(ocr.FAILURE_CODES.every((code) => {
      const copy = ocr.failureCopy(code);
      return copy && copy.text.length > 0 && copy.next.length > 0;
    }), '§7 每类失败码都有文案与下一步');
    t.check(ocr.failureCopy('NO_SUCH_CODE').text.length > 0, '§7 未知失败码有兜底文案');
    t.eq(ocr.failureCopy('NO_SUCH_CODE').next.length > 0, true, '§7 未知失败码有下一步');

    const okDeps = {
      loadFrame: async () => ({ ok: true, frame: {} }),
      runVision: async () => ({ ok: true, texts: ['取件码 8-2-3021'] })
    };
    const okResult = await ocr.recognize({ filePath: 'x' }, okDeps);
    t.check(okResult.ok === true, '§7 统一出口识别成功');
    t.eq(okResult.joined, '取件码 8-2-3021', '§7 统一出口返回合并文本');
    t.eq((await ocr.recognize({}, { hasVision: false })).code, 'VK_UNSUPPORTED',
      '§7 统一出口失败码透传');
  });
}

function sectionMergeParcels(h) {
  h.section('§5.2 多图汇总 mergeParcels（D23：一单 ≤10 件 / 去重 / 截断）', (t) => {
    t.eq([recognize.MAX_PARCELS_PER_ORDER, recognize.MAX_IMAGES_PER_ORDER], [10, 5],
      '§5.2 一单上限包裹 10 / 截图 5（CONTRACT §5.2/D23）');
    const a = recognize.parseOcrText('西苑顺丰快递 取件码 A12345');
    const b = recognize.parseOcrText('西苑顺丰快递 取件码 B23456');
    t.notEmpty(a.items, '§5.2 样本非空（规则解析出件）');
    const merged = recognize.mergeParcels([a.items, b.items]);
    t.eq(merged.items.length, 2, '§5.2 两图合并为同一单的 2 件（一单多包裹）');
    t.eq(merged.duplicated, 0, '§5.2 不同码件不去重');
    const dup = recognize.mergeParcels([a.items, a.items]);
    t.eq([dup.items.length, dup.duplicated], [1, 1], '§5.2 同一件跨图重复只留一件（去重）');
    const many = [];
    for (let i = 0; i < 12; i += 1) many.push([{ stationId: 'P3', pickupCode: 'C' + (12340 + i) }]);
    const capped = recognize.mergeParcels(many);
    t.eq([capped.items.length, capped.truncated, capped.dropped], [10, true, 2],
      '§5.2 超 10 件截断并标记（页面提示分单提交）');
    t.eq(recognize.parcelKey({ stationId: 'P3', pickupCode: 'A12345' }),
      recognize.parcelKey({ stationId: 'P3', pickupCode: 'A12345' }),
      '§5.2 去重键是纯函数（同内容同键）');
    t.neq(recognize.parcelKey({ stationId: 'P3', pickupCode: 'A12345' }),
      recognize.parcelKey({ stationId: 'P3', pickupCode: 'B23456' }),
      '§5.2 取件码不同 → 不同件（不误合并）');
  });
}

function register(h) {
  sectionText(h);
  sectionMask(h);
  sectionTrackingTail(h);
  sectionStation(h);
  sectionCodes(h);
  sectionValidateParcel(h);
  sectionParse(h);
  sectionApplyAi(h);
  sectionSummary(h);
  sectionFrame(h);
  sectionVision(h);
  sectionOcrEntry(h);
  sectionMergeParcels(h);
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-recognize' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }),
    'selftest-recognize');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
