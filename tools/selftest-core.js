'use strict';
/**
 * tools/selftest-core.js — 口径纯件骨架断言（ENGINEERING §7.1/§7.2；本文件是"骨架"，随落盘收口加断言）。
 * 覆盖：编号 ids / roomTag / 状态机 / 13 错误码 / 14 集合 / action 注册表 / 零金额扫描器牙口。
 * 纪律：有判别力（先合法基线、再只有该闸能挡的反例）；不许空集全绿；EXPECTED_ASSERTIONS 只在本文件登记。
 *
 * 零金额词样本一律用构造串（String.fromCharCode / 拼接），避免本测试文件自身被 #22 扫中。
 */
const path = require('path');
const project = require('./lib/project');

const ROOT = path.resolve(__dirname, '..');
const ids = require(path.join(ROOT, 'utils/ids.js'));
const roomTag = require(path.join(ROOT, 'utils/room-tag.js'));
const state = require(path.join(ROOT, 'shared/order-state.js'));
const errorCodes = require(path.join(ROOT, 'shared/error-codes.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const collections = require(path.join(ROOT, 'shared/collections.js'));
const actions = require(path.join(ROOT, 'shared/actions.js'));
const ZM = require('./zero-money-scan');

// 构造样本（源码中不出现连续词面，防止门禁自命中）
const SAMPLE_TRANSPORT = String.fromCharCode(0x8fd0, 0x8d39);
const SAMPLE_PRICE = 'pri' + 'ce';
const SAMPLE_FEN = 'total' + 'Fen';
// 费用类动作名禁词正则也用拼接构造，避免本文件被 #22 扫中
const FEE_ACTION_RE = new RegExp(['[Ff]' + 'en', 'pri' + 'ce', 'f' + 'ee'].join('|'));
const CLEAN_TEXT = '订单状态与取件码信息整理，本程序只做下单/接单/履约与消息通知。';

const EXPECTED_ASSERTIONS = 58;

function register(h) {
  // ---------------------------------------------------------------- §7.1 编号
  h.section('§7.1 编号 ids', (t) => {
    t.eq(ids.CUSTOMER_NO_PREFIX, 'C', '顾客编号前缀 C');
    t.eq(ids.PARTNER_NO_PREFIX, 'P', '兼职编号前缀 P');
    t.check(ids.isCustomerNo('C-ABCD-2345'), '合法顾客编号可解析');
    t.check(ids.isPartnerNo('P-ABC-234'), '合法兼职编号可解析');
    t.check(!ids.isCustomerNo('P-ABC-234'), '错前缀不得当顾客编号');
    t.eq(ids.parseNo('C-ABCD-2345').display, 'C-ABCD-2345', '展示分组幂等');
    t.eq(ids.displayNo(ids.NO_KIND.PARTNER, 'PABC234'), 'P-ABC-234', '兼职编号按 3-3 分组展示');
    t.eq(ids.CUSTOMER_NO_LENGTH, 9, '顾客编号长度 9（C+8）');
    t.check(ids.CUSTOMER_NO_PATTERN.test('CABCD2345'), '顾客编号正则匹配 canonical 串（去连字符口径）');
    t.eq(ids.prefixHint('C-ABCD-2345').reason, 'CUSTOMER_PREFIX', '错前缀提示命中"这是顾客编号"');
    t.check(ids.prefixHint('P-ABC-234').message.length > 0, '错前缀提示文案非空');
    t.notEmpty([ids.prefixHint('C-ABCD-2345').message], '错前缀提示样本');
  });

  // ---------------------------------------------------------------- §7.1 roomTag
  h.section('§7.1 roomTag（恒大写/Excel 序）', (t) => {
    t.eq(roomTag.toTag(1), 'A', '1→A');
    t.eq(roomTag.toTag(26), 'Z', '26→Z');
    t.eq(roomTag.toTag(27), 'AA', '27→AA');
    t.eq(roomTag.toTag(52), 'AZ', '52→AZ');
    t.eq(roomTag.toTag(53), 'BA', '53→BA');
    t.eq(roomTag.tagRank('AA'), 27, 'AA 回推 27');
    t.eq(roomTag.tagRank('Z'), 26, 'Z 回推 26');
    t.check(roomTag.isValidTag('AA'), '大写多字母合法');
    t.check(!roomTag.isValidTag('a') && !roomTag.isValidTag(''), '小写/空串非法（恒大写）');
    t.check(roomTag.compareByDormTag({ dormKey: 'D4-522', tag: 'A' }, { dormKey: 'D4-522', tag: 'AA' }) < 0,
      '同宿舍按 Excel 序（A 在 AA 前，禁字符串排序）');
    t.eq(roomTag.formatDormTag('D4-522', 'AA'), 'D4-522AA', '展示拼装');
    t.eq(roomTag.formatDormTag('D4-522', 'a'), 'D4-522', '非法 tag 不拼展示');
  });

  // ---------------------------------------------------------------- §7.1 状态机
  h.section('§7.1 订单状态机', (t) => {
    t.eq(state.STATUS_LIST.length, 7, '七状态');
    t.check(state.canTransition(state.STATUS.SUBMITTED, state.STATUS.ACCEPTED), '合法基线 SUBMITTED→ACCEPTED');
    t.check(!state.canTransition(state.STATUS.PICKED, state.STATUS.COMPLETED), '反例：PICKED→COMPLETED 直跳必须挡');
    t.check(!state.canTransition(state.STATUS.COMPLETED, state.STATUS.ACCEPTED), '终态不可回退');
    t.eq(state.UNDO_WINDOW_MS, 5000, 'undo 窗口 5 秒');
    t.eq(state.MAX_CREATE_BATCH, 5, '一图多码批量上限 5');
    t.notEmpty(Object.keys(state.ACTION_RULES || {}), '动作转移表非空');
    t.check(Object.keys(state.ACTION_RULES || {}).every((a) => !FEE_ACTION_RE.test(a)),
      '动作表零费用类动作名');
  });

  // ---------------------------------------------------------------- §7.1 错误码
  h.section('§7.1 错误码（13 码唯一集）', (t) => {
    t.eq(errorCodes.ERROR_CODES.length, 13, '恰好 13 码');
    t.eq(errorCodes.ERROR_CODE_COUNT, 13, 'ERROR_CODE_COUNT=13');
    t.eq(errorCodes.ERROR_CODES.slice().sort(), project.ERROR_CODES.slice().sort(), '与 CONTRACT 镜像双向一致');
    t.check(project.OLD_ERROR_CODES.every((c) => errorCodes.ERROR_CODES.indexOf(c) === -1), '旧错误码零残留');
    t.check(errorCodes.ERROR_CODES.every((c) => !!errorCopy.copyOf(c)), '每码都有同源文案');
    t.notEmpty(errorCodes.ERROR_CODES, '错误码样本');
  });

  // ---------------------------------------------------------------- §7.1 集合
  h.section('§7.1 集合（14 集合）', (t) => {
    t.eq(collections.COLLECTION_COUNT, 14, '恰好 14 集合');
    t.eq(collections.ALL_COLLECTIONS.slice().sort(), project.COLLECTIONS.slice().sort(), '集合注册表与 CONTRACT 镜像一致');
    t.notEmpty(collections.ALL_COLLECTIONS, '集合样本');
  });

  // ---------------------------------------------------------------- §7.1 action 注册表
  h.section('§7.1 action 注册表（visibility/write）', (t) => {
    const registered = Object.keys(actions.ACTION_MAP);
    const client = registered.filter((a) => actions.ACTION_MAP[a].visibility === 'client');
    const internal = registered.filter((a) => actions.ACTION_MAP[a].visibility === 'internal');
    const expectedClient = Object.keys(project.ACTIONS).filter((a) => project.ACTIONS[a].visibility === 'client');
    const expectedInternal = Object.keys(project.ACTIONS).filter((a) => project.ACTIONS[a].visibility === 'internal');
    t.eq(client.length, expectedClient.length, 'client 动作数与 CONTRACT 镜像一致');
    t.eq(internal.length, expectedInternal.length, 'internal 动作数与 CONTRACT 镜像一致');
    t.check(expectedClient.every((a) => registered.indexOf(a) !== -1), 'client 动作全部在册');
    t.check(expectedInternal.every((a) => registered.indexOf(a) !== -1), 'internal 动作全部在册');
    t.check(registered.every((a) => !!project.ACTIONS[a] || project.P1_ACTIONS.indexOf(a) !== -1), '注册表无未登记动作');
    t.check(registered.every((a) => typeof actions.ACTION_MAP[a].write === 'boolean'), '每条都有 write 布尔');
    t.check(internal.every((a) => /^(admin\.bootstrap|health\.check|cleanup\.)/.test(a)),
      'internal 只允许 admin.bootstrap/health.check/cleanup.*');
  });

  // ---------------------------------------------------------------- §7.6 零金额扫描器牙口
  h.section('§7.6 零金额扫描器（门禁自测）', (t) => {
    t.check(ZM.scanText(SAMPLE_TRANSPORT).length >= 1, '注入样本 1 必须命中');
    t.check(ZM.scanText(SAMPLE_PRICE).length >= 1, '注入样本 2 必须命中');
    t.check(ZM.scanText(SAMPLE_FEN).length >= 1, '注入样本 3（*Fen 后缀）必须命中');
    t.eq(ZM.scanText(CLEAN_TEXT).length, 0, '删除样本后必须绿');
    t.eq(ZM.scanText('零金额').length, 0, '固定术语「零金额」整体放行');
    t.eq(ZM.scanText('payload').length, 0, '英文按 token 边界，payload 不误报');
    const al = ZM.loadAllowlist(ROOT);
    t.eq(al.issues.length, 0, '白名单 schema 校验无问题');
    t.notEmpty(al.entries, '白名单项样本');
    t.check(al.entries.every((e) => !/[*?[\]{}]/.test(e.file)), '白名单无整文件/目录通配');
    t.check(al.entries.every((e) => typeof e.reason === 'string' && e.reason.trim().length > 0), '白名单每项都有理由');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };
