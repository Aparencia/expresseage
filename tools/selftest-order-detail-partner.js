'use strict';
/**
 * tools/selftest-order-detail-partner.js · 批 6「兼职工作台」订单详情（S4）端侧判据
 * 覆盖：A 动作映射（真实 _dto.buildActions 七状态）/ B 补码改站点面板 / C 异常上报解除 /
 *       D deliveryNote 与 guest 文案 / E 撤销条与失败文案 / F 凭证卡 / G 只读静态纪律 + fake transport。
 * 纪律：先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 独立运行：node tools/selftest-order-detail-partner.js（不改 tools/selftest.js 聚合入口）。
 */
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');

const partsDir = 'pkg-partner/pages/order-detail/parts';
const actionsPart = require(path.join(ROOT, partsDir, 'actions.js'));
const correctPanel = require(path.join(ROOT, partsDir, 'correct-panel.js'));
const deliveryPanel = require(path.join(ROOT, partsDir, 'delivery-panel.js'));
const exceptionPanel = require(path.join(ROOT, partsDir, 'exception-panel.js'));
const eventView = require(path.join(ROOT, partsDir, 'event-view.js'));
const orderView = require(path.join(ROOT, partsDir, 'order-view.js'));
const reasonPanel = require(path.join(ROOT, partsDir, 'reason-panel.js'));
const undoPart = require(path.join(ROOT, partsDir, 'undo.js'));
const voucherPart = require(path.join(ROOT, partsDir, 'voucher.js'));
const viewModel = require(path.join(ROOT, partsDir, 'view-model.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const format = require(path.join(ROOT, 'shared/format.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const orderApi = require(path.join(ROOT, 'api/modules/order.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));

const EXPECTED_ASSERTIONS = 170; // 实际断言总数（少算/多算都判红）
const STATUS = orderState.STATUS;
const STATUS_LITERALS = enums.ORDER_STATUS_LIST.slice();
const PAGE_JS = 'pkg-partner/pages/order-detail/index.js';
const PAGE_WXML = 'pkg-partner/pages/order-detail/index.wxml';
const DOC_MS = Date.parse('2026-10-22T10:00:00+08:00');
const NOW_MS = DOC_MS + 1000;
const ISO = new Date(DOC_MS).toISOString();

// 页面层扫描（与门禁 #21 同口径：只扫页面脚本 *.js；parts 是纯视图模型不在此列）
function layerHits(code) {
  const src = fsutil.stripComments(String(code || ''));
  const hits = [];
  if (/wx\.cloud\./.test(src)) hits.push('wx.cloud');
  if (/Math\.random|\brandom\(/.test(src)) hits.push('random');
  if (/client\.call\s*\(/.test(src)) hits.push('直调 client.call');
  STATUS_LITERALS.forEach((status) => {
    if (new RegExp("['\"]" + status + "['\"]").test(src)) hits.push('状态字面量 ' + status);
  });
  return hits;
}

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

// ── orders 集合文档夹具：交给真实 _dto.buildOrderDto 生成服务端 DTO（端云契约联调）──
function partnerDoc(status, extra) {
  const doc = {
    _id: 'order-' + status,
    orderNo: '20261022-0031',
    customerId: 'customer-it',
    partnerId: 'partner-it',
    customerNo: 'C-7K2M-9QX4',
    partnerNo: 'P-8F3-K2M',
    status: status,
    version: 3,
    source: enums.ORDER_SOURCE.CUSTOMER,
    parcel: {
      stationId: 'P4',
      stationName: '北部菜鸟驿站（北苑一食堂三楼）',
      pickupCode: '27-2-7016',
      lockerNo: '3 号柜',
      trackingTail: '66785',
      codeStatus: enums.CODE_STATUS.OK,
      recognitionSource: 'RULE'
    },
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    note: '放宿舍门口鞋柜上',
    deliveryNote: '',
    phoneTail: '6678',
    image: { fileId: 'cloud://test.env/orders/TKT/image.jpg' },
    exception: null,
    cancelReason: '',
    cancelledBy: '',
    statusUpdatedAt: DOC_MS,
    createdAt: DOC_MS,
    updatedAt: DOC_MS,
    acceptedAt: 0,
    pickedAt: 0,
    deliveredAt: 0,
    completedAt: 0,
    cancelledAt: 0
  };
  if (status === STATUS.ACCEPTED) {
    doc.acceptedAt = DOC_MS;
  }
  if (status === STATUS.PICKED) {
    doc.acceptedAt = DOC_MS - 60000;
    doc.pickedAt = DOC_MS;
  }
  if (status === STATUS.DELIVERED) {
    doc.acceptedAt = DOC_MS - 120000;
    doc.pickedAt = DOC_MS - 60000;
    doc.deliveredAt = DOC_MS;
  }
  if (status === STATUS.COMPLETED) {
    doc.acceptedAt = DOC_MS - 300000;
    doc.pickedAt = DOC_MS - 240000;
    doc.deliveredAt = DOC_MS - 120000;
    doc.completedAt = DOC_MS;
  }
  if (status === STATUS.EXCEPTION) {
    doc.acceptedAt = DOC_MS - 60000;
    doc.pickedAt = DOC_MS;
    doc.exception = {
      code: 'CABINET_ERROR',
      text: '3 号柜门卡住，驿站说 20 分钟后处理',
      fromStatus: STATUS.PICKED,
      by: 'PARTNER',
      at: DOC_MS
    };
  }
  if (status === STATUS.CANCELLED) {
    doc.cancelReason = 'CHANGED_MIND';
    doc.cancelledBy = 'CUSTOMER';
    doc.cancelledAt = DOC_MS;
  }
  return Object.assign(doc, extra || {});
}

const DTO_CTX = {
  dao: {
    get: function get() { return Promise.resolve(null); },
    find: function find() { return Promise.resolve([]); },
    findOne: function findOne() { return Promise.resolve(null); }
  },
  identity: {},
  now: NOW_MS
};

async function realDto(doc) {
  return serverDto.buildOrderDto(DTO_CTX, doc, { side: 'PARTNER' });
}

function serverActionsOf(doc, nowMs) {
  return serverDto.buildActions(doc, 'PARTNER', nowMs).map((item) => item.key);
}

const EXPECTED_ACTIONS = {};
EXPECTED_ACTIONS[STATUS.SUBMITTED] = ['accept', 'reject', 'correct', 'cancel', 'message'];
EXPECTED_ACTIONS[STATUS.ACCEPTED] = ['pick', 'exception', 'correct', 'cancel', 'message'];
EXPECTED_ACTIONS[STATUS.PICKED] = ['deliver', 'undoPick', 'exception', 'correct', 'cancel', 'message'];
// DELIVERED 不可补码（DATA_MODEL §7.5 order.correct 起始状态不含 DELIVERED / UX §4.4 / handler ACTION_RULES），
// 服务端 buildActions 已收敛为不下发 correct；本期望值即最终服务端口径。
EXPECTED_ACTIONS[STATUS.DELIVERED] = ['undoDeliver', 'exception', 'cancel', 'message'];
EXPECTED_ACTIONS[STATUS.COMPLETED] = [];
EXPECTED_ACTIONS[STATUS.CANCELLED] = [];
EXPECTED_ACTIONS[STATUS.EXCEPTION] = ['resolve', 'correct', 'cancel', 'message'];

function stubTransport(handler) {
  client.setTransport(handler);
}

function register(h) {
  // ---------------------------------------------------------------- A 动作映射
  h.section('A. 动作映射：真实 _dto.buildActions 七状态 ± 5 秒窗 + 页面零本地拼动作', async (t) => {
    const dtos = [];
    for (let i = 0; i < enums.ORDER_STATUS_LIST.length; i += 1) {
      dtos.push(await realDto(partnerDoc(enums.ORDER_STATUS_LIST[i])));
    }
    t.eq(dtos.length, 7, 'A1 七状态真实服务端 DTO 全部生成（样本非空）');
    t.eq(dtos.map((item) => item.status), STATUS_LITERALS.slice(), 'A2 状态顺序与 enums.ORDER_STATUS_LIST 一致');
    t.eq(dtos.map((item) => item.actions.map((action) => action.key)), STATUS_LITERALS.map((status) => EXPECTED_ACTIONS[status]),
      'A3 服务端动作条逐状态与 UX §3.3 矩阵一致（含 message，终态无 message）');
    t.check(dtos[4].actions.length === 0 && dtos[5].actions.length === 0,
      'A4 终态（已完成/已取消）服务端不下发任何写动作（只读归档）');
    const aged = partnerDoc(STATUS.PICKED);
    const agedDelivered = partnerDoc(STATUS.DELIVERED);
    t.eq([serverActionsOf(aged, DOC_MS + 1000), serverActionsOf(aged, DOC_MS + 6000)],
      [EXPECTED_ACTIONS[STATUS.PICKED], ['deliver', 'exception', 'correct', 'cancel', 'message']],
      'A5 撤销已取件仅在 5 秒窗内出现（服务端判定，6 秒后不下发）');
    t.eq(serverActionsOf(agedDelivered, DOC_MS + 6000),
      ['exception', 'cancel', 'message'],
      'A6 撤销已送达同样 5 秒后由服务端收回（DELIVERED 全程无 correct）');
    // 页面可见动作 = 服务端 actions[] 原样呈现（不增删、不重排）；服务端矩阵由 A3 独立锁定
    const expectedPageKeys = dtos.map((dto) => dto.actions.map((action) => action.key));
    const pageViews = dtos.map((dto) => viewModel.buildView(dto, [], { nowMs: NOW_MS }));
    t.eq(pageViews.map((view) => view.actions.map((item) => item.key)), expectedPageKeys,
      'A7 页面可见动作 = 服务端 actions[] 原样呈现（七状态逐项一致，不本地增删）');
    const pageLabels = pageViews.map((view) => view.actions.map((item) => item.label));
    t.eq(pageLabels, dtos.map((dto) => dto.actions.map((action) => action.label)),
      'A8 动作文案取服务端 label（页面不复制一套文案）');
    const mixed = actionsPart.buildVisibleActions({
      actions: [{ key: 'confirm', label: '确认已收到' }, { key: 'accept', label: '接单' }, 'message', null, {}, { label: '无 key' }]
    }, { readonly: false });
    t.eq(mixed.map((item) => item.key), ['accept', 'message'], 'A9 未知动作忽略、字符串动作兼容、坏项丢弃（不猜行为）');
    t.eq(mixed.map((item) => item.label), ['接单', '留言'], 'A10 缺 label 时用同语义兜底文案');
    const readonlyList = actionsPart.buildVisibleActions(dtos[1], { readonly: true });
    t.check(readonlyList.length > 0 && readonlyList.every((item) => item.disabled === true
      && item.readonlyHint === '开发者只读视角不能操作'),
    'A11 READONLY：所有写动作置灰并带只读提示（前端禁用）');
    t.check(actionsPart.buildVisibleActions(dtos[1], { readonly: false }).every((item) => item.disabled === false),
      'A12 非只读：动作可用');
    t.check(viewModel.buildView(dtos[2], [], { readonly: true, nowMs: NOW_MS }).undoBar.visible === false,
      'A12b READONLY：撤销条不出现（只读视角零写入口）');
    t.check(actionsPart.buildVisibleActions(dtos[1], { readonly: false }).every((item) => item.write === true && actionsPart.isWriteKey(item.key)),
      'A13 详情页动作全为写动作（都走 api 层与服务端二次校验）');
    t.eq([actionsPart.hasAction(dtos[0].actions, 'accept'), actionsPart.hasAction(dtos[0].actions, 'pick')],
      [true, false], 'A14 hasAction 按服务端清单判定（不按状态猜）');
    t.eq(actionsPart.undoTargetKeys(dtos[2].actions), ['undoPick'], 'A15 撤销条目标键取自服务端 actions（PICKED）');
    t.eq(actionsPart.undoTargetKeys(dtos[3].actions), ['undoDeliver'], 'A16 撤销条目标键取自服务端 actions（DELIVERED）');
    t.eq(actionsPart.undoTargetKeys(dtos[1].actions), [], 'A17 无撤销动作时不给撤销目标');
    const exceptionDtos = [
      await realDto(partnerDoc(STATUS.EXCEPTION)),
      await realDto(partnerDoc(STATUS.EXCEPTION, {
        exception: { code: 'CODE_INVALID', text: '', fromStatus: STATUS.ACCEPTED, by: 'PARTNER', at: DOC_MS }
      })),
      await realDto(partnerDoc(STATUS.EXCEPTION, {
        exception: { code: 'OTHER', text: '地址说不清', fromStatus: STATUS.DELIVERED, by: 'PARTNER', at: DOC_MS }
      })),
      await realDto(partnerDoc(STATUS.EXCEPTION, {
        exception: { code: 'OTHER', text: '未知来源', fromStatus: 'WEIRD', by: 'PARTNER', at: DOC_MS }
      }))
    ];
    t.eq(exceptionDtos.map((dto) => exceptionPanel.resolveTargetText(dto)),
      [orderState.statusText(STATUS.PICKED), orderState.statusText(STATUS.ACCEPTED),
        orderState.statusText(STATUS.DELIVERED), orderState.statusText(STATUS.ACCEPTED)],
      'A18 解除异常目标文案按服务端 exception.fromStatus 渲染（非法回落已接单）');
    t.eq(exceptionDtos.map((dto) => actionsPart.resolveTargetText(dto)),
      exceptionDtos.map((dto) => exceptionPanel.resolveTargetText(dto)),
      'A19 动作件与异常件的解除目标文案同源（不各写一套）');
    t.notEmpty(dtos, 'A 组样本非空');
    t.eq(reasonPanel.buildPanel('cancel').title, '取消原因', 'A20 取消面板标题（取消与拒单共用原因枚举）');
    t.eq(reasonPanel.buildPanel('reject').reasons,
      enums.CANCEL_REASONS[enums.ROLES.PARTNER].map((item) => ({ code: item.code, label: item.text })),
      'A21 取消/拒单原因单源 = shared/enums（页面不复制文案）');
    t.check(reasonPanel.validate('OTHER', '').message === '选「其他」时备注必填'
      && reasonPanel.validate('TOO_BUSY', '').ok === true,
    'A22 OTHER 必填、普通原因备注可空（取消/拒单同一校验）');
  });

  // ---------------------------------------------------------------- B 补码面板
  h.section('B. 补码/改站点面板：P1~P8 值域、PICKED 收窄、DELIVERED 隐藏、形态闸与 expectedVersion', async (t) => {
    const submitted = await realDto(partnerDoc(STATUS.SUBMITTED));
    const picked = await realDto(partnerDoc(STATUS.PICKED));
    const delivered = await realDto(partnerDoc(STATUS.DELIVERED));
    const panel = correctPanel.buildPanel(submitted);
    t.eq(panel.fields, ['stationId', 'pickupCode', 'lockerNo', 'trackingTail'], 'B1 待接单：站点/取件码/柜号/运单尾号全字段可改');
    t.eq(panel.stationOptions, stations.listStations(), 'B2 站点 picker 值域直接复用 shared/stations（P1~P8，不自建）');
    t.eq(panel.stationOptions.map((item) => item.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'B3 站点值域恰为 P1~P8（不含别名/自造站点）');
    t.eq(panel.stationIndex, 3, 'B4 当前站点 P4 反查 picker 下标');
    t.eq(panel.codeStatusText, '取件码可用', 'B5 codeStatus 文案取服务端 DTO（本地不派生）');
    const pickedPanel = correctPanel.buildPanel(picked);
    t.eq(pickedPanel.fields, ['lockerNo', 'trackingTail'], 'B6 已取件：字段收窄为柜号/运单尾号');
    t.check(pickedPanel.picked === true && pickedPanel.hint.indexOf('只能改柜号或运单尾号') >= 0,
      'B7 已取件：面板提示说明收窄原因');
    // 服务端已按 §4.4/DATA_MODEL §7.5 收敛（A3 锁定 DELIVERED 无 correct）；页面隐藏逻辑保留为双保险：
    // 反例注入一个误下发的 correct，页面仍不得渲染入口（不是「期望服务端下发」的挡箭牌）。
    const injectedDelivered = Object.assign({}, delivered, {
      actions: delivered.actions.concat([{ key: 'correct', label: '改取件码' }])
    });
    t.check(correctPanel.isBlocked(injectedDelivered)
      && correctPanel.buildPanel(injectedDelivered).visible === false
      && viewModel.buildView(injectedDelivered, [], { nowMs: NOW_MS }).actions.every((item) => item.key !== 'correct'),
    'B8 反例：服务端误下发已送达单的改码动作，页面仍隐藏入口（§4.4 双保险）');
    t.check(correctPanel.isBlocked(delivered) && correctPanel.buildPanel(delivered).blockedCopy === '已送达，不能再改取件码',
      'B9 已送达：取件码/站点入口隐藏并给「已送达，不能再改取件码」');
    t.eq([STATUS.COMPLETED, STATUS.CANCELLED].map((status) => correctPanel.buildPanel(partnerDoc(status)).visible),
      [false, false], 'B10 已完成/已取消：面板不可见（不能补码）');
    t.eq(correctPanel.buildPanel(await realDto(partnerDoc(STATUS.EXCEPTION))).fields.length, 4,
      'B11 异常单：站点/取件码仍可更正（服务端 EXCEPTION 全字段）');
    t.eq(correctPanel.buildEditor(submitted), {
      stationId: 'P4', pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785'
    }, 'B12 面板初值 = 服务端当前值（L3 只在原位出现）');
    const editCode = Object.assign(correctPanel.buildEditor(submitted), { pickupCode: '27-2-7018' });
    const codeSave = correctPanel.validateSave(editCode, submitted);
    t.check(codeSave.ok && codeSave.patch.pickupCode === '27-2-7018' && Object.keys(codeSave.patch).length === 1,
      'B13 只提交确实变化的字段（差异提交，未变化字段不上送）');
    const editStation = Object.assign(correctPanel.buildEditor(submitted), { stationId: 'P6' });
    const stationSave = correctPanel.validateSave(editStation, submitted);
    t.eq(stationSave.ok ? stationSave.patch : null, { stationId: 'P6', stationName: '南苑菜鸟驿站' },
      'B14 改站点按 P1~P8 归一为 {stationId, stationName}');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { stationId: 'P9' }), submitted).message
      .indexOf('P1~P8') >= 0, 'B15 非 P1~P8 站点被挡（不放宽站点值域）');
    const code40 = 'A'.repeat(40);
    t.eq(panel.pickupCodeMax, 40, 'B16 取件码输入上限 = 40（面板 maxlength 与服务端上限同源）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { pickupCode: 'A'.repeat(13) }), submitted).message
      .indexOf('取件码') >= 0, 'B17 超出形态闸的取件码被挡并说清规则（不静默截断/不放宽 shared/validate）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { pickupCode: code40 }), submitted).ok === false,
      'B17b 40 字符但形态非法的取件码仍被 shared/validate 拦下（长度上限 ≠ 合法形态）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { trackingTail: '6678' }), submitted).message
      .indexOf('5 位') >= 0, 'B18 运单尾号 4 位被挡（恰 5 位数字）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { trackingTail: '667855' }), submitted).message
      .indexOf('5 位') >= 0, 'B19 运单尾号 6 位被挡');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { trackingTail: '' }), submitted).ok,
      'B20 运单尾号可空（清空合法）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(submitted), { lockerNo: 'X'.repeat(11) }), submitted).ok === false,
      'B21 柜号 ≤10 字');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(picked), { pickupCode: '27-2-9999' }), picked).message
      .indexOf('已取件后只能改柜号或运单尾号') >= 0, 'B22 已取件单改取件码被挡（服务端同口径）');
    t.check(correctPanel.validateSave(Object.assign(correctPanel.buildEditor(picked), { lockerNo: '5号柜' }), picked).ok,
      'B23 已取件单改柜号合法');
    t.eq(correctPanel.validateSave(correctPanel.buildEditor(delivered), delivered).message, '已送达，不能再改取件码',
      'B24 已送达单保存直接被挡（入口隐藏 + 保存双保险）');
    t.eq(correctPanel.validateSave(correctPanel.buildEditor(submitted), submitted).message, '没有要保存的修改',
      'B25 无差异不提交（避免空更正/误记事件）');
    const submit = correctPanel.buildSubmit(submitted, codeSave.patch);
    t.eq([submit.data.orderNo, submit.opts.expectedVersion, submit.data.patch], ['20261022-0031', 3, { pickupCode: '27-2-7018' }],
      'B26 保存 data=orderNo+patch、expectedVersion 走 api 包络（乐观锁）');
    t.check(correctPanel.savedCopy(panel).indexOf('已更正，顾客端同步') >= 0, 'B27 保存成功文案「已更正，顾客端同步」');
    const needDoc = partnerDoc(STATUS.SUBMITTED, { parcel: Object.assign({}, partnerDoc(STATUS.SUBMITTED).parcel, { pickupCode: '', codeStatus: enums.CODE_STATUS.NEED_CODE }) });
    const needDto = await realDto(needDoc);
    t.check(correctPanel.buildPanel(needDto).codeStatusText.indexOf('需补充') >= 0
      && correctPanel.stillNeedCodeText(needDto).indexOf('需查明') >= 0,
    'B28 需查明单：状态文案与后续提示取服务端 codeStatus（补上码后刷新自动消失）');
    t.eq(orderView.buildDetail(needDto).pickupCodeText, '', 'B29 需查明单不伪造取件码（空 → 页面显示「需查明」占位）');
    t.notEmpty(panel.stationOptions, 'B 组样本非空');
  });

  // ---------------------------------------------------------------- C 异常面板
  h.section('C. 异常上报/解除：六原因枚举、备注 ≤200、OTHER 必填、解除目标按服务端 fromStatus', async (t) => {
    const panel = exceptionPanel.buildPanel();
    t.eq(panel.reasons.map((item) => item.code),
      ['CODE_INVALID', 'PARCEL_NOT_FOUND', 'CABINET_ERROR', 'CUSTOMER_UNREACHABLE', 'ADDRESS_ISSUE', 'OTHER'],
      'C1 原因枚举恰为六项（UX §4.13 / §5.2 逐字）');
    t.eq(panel.reasons, enums.EXCEPTION_CODES.map((item) => ({ code: item.code, label: item.text })),
      'C2 原因文案单源 = shared/enums（页面不复制一套）');
    t.eq(panel.noteMax, 200, 'C3 备注上限 200');
    t.eq(exceptionPanel.validateReport('CODE_INVALID', ''), {
      ok: true, field: '', message: '', payload: { code: 'CODE_INVALID' }
    }, 'C4 非 OTHER 备注可空（提交 payload 不带空 text）');
    const otherEmpty = exceptionPanel.validateReport('OTHER', '');
    t.check(otherEmpty.ok === false && otherEmpty.message === '选「其他」时备注必填',
      'C5 OTHER 必填备注（空被挡）');
    t.eq(exceptionPanel.validateReport('OTHER', '驿站让明天再来'), {
      ok: true, field: '', message: '', payload: { code: 'OTHER', text: '驿站让明天再来' }
    }, 'C6 OTHER 填备注后合法');
    t.eq(exceptionPanel.validateReport('CODE_INVALID', 'A'.repeat(200)).ok, true, 'C7 备注 200 字合法边界');
    const tooLong = exceptionPanel.validateReport('CODE_INVALID', 'A'.repeat(201));
    t.check(tooLong.ok === false && tooLong.message.indexOf('200') >= 0, 'C8 备注 201 字被挡并说清上限');
    t.check(exceptionPanel.validateReport('UNKNOWN', '').ok === false, 'C9 未登记原因被挡（不收自由文本原因码）');
    const reportSubmit = exceptionPanel.buildReportSubmit(partnerDoc(STATUS.ACCEPTED), { code: 'CABINET_ERROR', text: '柜门卡住' });
    t.eq([reportSubmit.data.orderNo, reportSubmit.data.code, reportSubmit.data.text],
      ['20261022-0031', 'CABINET_ERROR', '柜门卡住'],
      'C10 上报 data 装配 = {orderNo, code, text}（契约字段）');
    const resolveSubmit = exceptionPanel.buildResolveSubmit(await realDto(partnerDoc(STATUS.EXCEPTION)));
    t.eq([resolveSubmit.data.orderNo, resolveSubmit.opts.expectedVersion], ['20261022-0031', 3],
      'C11 解除异常 expectedVersion 走 api 包络（乐观锁）');
    t.check(exceptionPanel.resolveConfirmText(await realDto(partnerDoc(STATUS.EXCEPTION))).indexOf('恢复到「已取件·配送中」') >= 0,
      'C12 解除确认框写清恢复目标');
    const resolveDto = await realDto(partnerDoc(STATUS.EXCEPTION));
    t.check(exceptionPanel.resolveCopy(resolveDto).indexOf('已解除异常，订单恢复到「已取件·配送中」。') >= 0,
      'C13 解除成功文案按服务端 DTO 状态渲染');
    t.check(exceptionPanel.buildResolve(resolveDto).successCopy === exceptionPanel.resolveCopy(resolveDto)
      && exceptionPanel.buildResolve(resolveDto).confirmText === exceptionPanel.resolveConfirmText(resolveDto),
    'C14 buildResolve 输出与文案函数同源（wxml 只消费）');
    t.notEmpty(panel.reasons, 'C 组样本非空');
  });

  // ---------------------------------------------------------------- D deliveryNote
  h.section('D. 送达浮层：备注 ≤100/快捷标签/guest 24h 自动完成文案', async (t) => {
    const normal = await realDto(partnerDoc(STATUS.PICKED));
    const guestDoc = partnerDoc(STATUS.PICKED, {
      source: enums.ORDER_SOURCE.PARTNER,
      guest: { displayName: '室友', phoneTail: '1234', zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' }
    });
    const guest = await realDto(guestDoc);
    t.eq(deliveryPanel.QUICK_TAGS, ['放宿舍门口', '交到室友手里', '放 3 号柜'],
      'D1 deliveryNote 快捷标签恰为 UX §3.3 三条');
    const normalPanel = deliveryPanel.buildPanel(normal);
    t.check(normalPanel.guest === false && normalPanel.confirmText === '确认已送达？顾客会看到进度到「已送达·待确认」。',
      'D2 正常单确认框写清「已送达·待确认」');
    t.check(normalPanel.quickTags.length === 3 && normalPanel.noteMax === 100, 'D3 正常单浮层：快捷标签 + ≤100');
    const guestPanel = deliveryPanel.buildPanel(guest);
    t.eq(guestPanel.confirmText, '该顾客未绑定，无需确认，系统将在 24h 后自动完成',
      'D4 guest 单确认框改为 24h 自动完成文案（source=PARTNER）');
    t.check(guestPanel.guest === true && guestPanel.guestHint.indexOf('线下告知') >= 0,
      'D5 guest 单提示线下告知进度（无顾客确认路径）');
    t.eq([deliveryPanel.isGuestOrder(guest), deliveryPanel.isGuestOrder(normal)], [true, false],
      'D6 guest 判定只读服务端 DTO.source');
    const guestDelivered = await realDto(partnerDoc(STATUS.DELIVERED, { source: enums.ORDER_SOURCE.PARTNER, guest: { displayName: '室友' } }));
    t.check(deliveryPanel.deliveredChip(guestDelivered) === '已送达·待自动完成',
      'D7 guest 送达后 chip 显示「已送达·待自动完成」');
    t.eq([deliveryPanel.deliveredChip(normal), deliveryPanel.deliveredChip(guest)], ['', ''],
      'D8 非 guest/未送达不给该 chip（不冒充自动完成）');
    t.check(deliveryPanel.guestAutoCompleteHint(guestDelivered).indexOf('24h') >= 0,
      'D9 guest 送达后提示 24h 后自动完成');
    t.eq(deliveryPanel.validateNote('A'.repeat(100)), { ok: true, field: '', message: '', value: 'A'.repeat(100) },
      'D10 送达备注 100 字合法边界');
    t.check(deliveryPanel.validateNote('A'.repeat(101)).message.indexOf('100') >= 0, 'D11 送达备注 101 字被挡并说清上限');
    t.eq(deliveryPanel.validateNote('  '), { ok: true, field: '', message: '', value: '' },
      'D12 送达备注可空（全空格视为空）');
    const emptySubmit = deliveryPanel.buildSubmit(normal, '');
    t.check(emptySubmit.data.orderNo === '20261022-0031' && emptySubmit.opts.expectedVersion === 3
      && emptySubmit.data.deliveryNote === undefined, 'D13 空备注不带 deliveryNote 字段（不写空串）');
    t.eq(deliveryPanel.buildSubmit(normal, '  放门口  ').data.deliveryNote, '放门口',
      'D14 备注去首尾空格后提交');
    t.check(viewModel.buildView(normal, [], { nowMs: NOW_MS }).deliveryPanel.confirmText.indexOf('待确认') >= 0,
      'D15 视图装配把送达浮层文案带进页面快照');
    t.notEmpty(deliveryPanel.QUICK_TAGS, 'D 组样本非空');
  });

  // ---------------------------------------------------------------- E 撤销条
  h.section('E. 撤销条：仅服务端 undoPick/undoDeliver 可见、5s 倒计时、顾客已确认文案', async (t) => {
    const picked = await realDto(partnerDoc(STATUS.PICKED));
    const delivered = await realDto(partnerDoc(STATUS.DELIVERED));
    const bar = undoPart.buildBar(picked, picked.actions, DOC_MS + 1000);
    t.check(bar.visible === true && bar.kind === 'undoPick' && bar.remaining === 4,
      'E1 取件后 1 秒：撤销条可见且剩 4 秒（5 秒窗）');
    t.check(bar.label === '已把 1 件标记为已取件' && bar.undoLabel === '撤销',
      'E2 撤销条文案「已把 1 件标记为已取件 · 撤销」');
    t.eq(undoPart.buildBar(picked, picked.actions, DOC_MS + 5000).remaining, 0, 'E3 5 秒到点：倒计时归零');
    t.eq(undoPart.buildBar(picked, picked.actions, DOC_MS + 5000).visible, false, 'E4 倒计时结束撤销条消失（不提供历史撤销）');
    const lateBar = undoPart.buildBar(picked, picked.actions, DOC_MS + 6000);
    t.check(lateBar.visible === false, 'E5 超窗后即使旧快照残留也不显示（本地二道闸）');
    const deliverBar = undoPart.buildBar(delivered, delivered.actions, DOC_MS + 1200);
    t.check(deliverBar.kind === 'undoDeliver' && deliverBar.label === '已把 1 件标记为已送达' && deliverBar.remaining === 4,
      'E6 送达后撤销条：目标=undoDeliver、剩 4 秒');
    t.eq(undoPart.buildBar(delivered, [{ key: 'deliver', label: '标记已送达' }], DOC_MS + 1000).visible, false,
      'E7 服务端没给 undo 动作时不给撤销条（不本地猜窗口）');
    t.eq(undoPart.failureText({ code: 'INVALID_TRANSITION' }, { status: STATUS.COMPLETED }),
      '顾客已确认送达，不能撤销。', 'E8 顾客已确认后撤销被拒：说清不能撤销');
    t.eq(undoPart.failureText({ code: 'INVALID_STATE' }, { status: STATUS.PICKED }),
      '撤销失败：订单状态已变化，请刷新后再看。', 'E9 状态已变化：提示刷新后再看');
    t.eq(undoPart.failureText({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' }, { status: STATUS.PICKED }),
      '服务暂时不可用，请稍后重试', 'E10 其他失败沿用服务端人话，不吞错');
    t.eq(undoPart.failureText(null, null), '撤销没成功，请刷新后再看。', 'E11 空错误兜底文案');
    t.check(undoPart.successText('undoPick').indexOf('已接单') >= 0 && undoPart.successText('undoDeliver').indexOf('已取件') >= 0,
      'E12 撤销成功文案写清回退到哪个状态');
    const vm = viewModel.buildView(picked, eventView.buildEvents([{ type: 'PICKED', at: ISO, actorRole: 'PARTNER', note: '' }]), { nowMs: NOW_MS });
    t.check(vm.undoBar.visible === true, 'E13 视图装配把撤销条带进页面快照（页面不自己判断窗口）');
    t.notEmpty(picked.actions, 'E 组样本非空');
  });

  // ---------------------------------------------------------------- F 凭证卡
  h.section('F. 履约凭证卡：DTO/事件取数、不编造确认时间、guest 自动完成、L3 不上卡', async (t) => {
    const completed = await realDto(partnerDoc(STATUS.COMPLETED));
    const confirmAt = new Date(DOC_MS).toISOString();
    const events = serverDto.buildEventDtos([
      { type: 'ORDER_CREATED', at: DOC_MS - 300000, actorRole: 'CUSTOMER', note: '' },
      { type: 'ACCEPTED', at: DOC_MS - 250000, actorRole: 'PARTNER', note: '' },
      { type: 'PICKED', at: DOC_MS - 240000, actorRole: 'PARTNER', note: '' },
      { type: 'DELIVERED', at: DOC_MS - 120000, actorRole: 'PARTNER', note: '' },
      { type: 'COMPLETED', at: new Date(confirmAt), actorRole: 'CUSTOMER', note: '' }
    ]);
    const voucher = voucherPart.buildVoucher(completed, events);
    t.eq(voucher.confirmedAtText, format.formatDateTime(confirmAt), 'F1 顾客确认时间取服务端事件 COMPLETED 的 at');
    t.eq(voucher.confirmLabel, '顾客确认时间', 'F2 确认时间标签为「顾客确认时间」');
    t.eq(voucher.completedAtText, format.formatDateTime(completed.completedAt), 'F3 完成时间取 DTO.completedAt');
    t.eq(voucher.rows.map((row) => row.label), ['订单号', '站点', '服务类型', '接单时间', '取件时间', '送达时间', '完成时间', '送达备注', '顾客确认时间'],
      'F4 凭证卡字段 = UX §4.14 列表（订单号/站点/服务类型/四时间/备注/确认时间）');
    t.eq(voucher.footer, '凭证以订单事件记录为准；本单不可删除。', 'F5 凭证卡底部口径文案逐字一致');
    t.eq([voucher.orderNo, voucher.stationName, voucher.serviceName],
      ['20261022-0031', '北部菜鸟驿站（北苑一食堂三楼）', '标准代取'], 'F6 凭证卡三要素取 DTO');
    t.eq(voucher.partnerNo, 'P-8F3-K2M', 'F7 凭证卡小字显示本人兼职编号（客服核对用）');
    // 零费用语义：扫描目标词按字面量拆开拼（避免本测试文件自己被 #22 词表命中）
    const moneyWords = ['元', '费' + '用', '价' + '格', '金' + '额'];
    t.check(moneyWords.every((word) => JSON.stringify(voucher).indexOf(word) === -1),
      'F8 凭证卡零费用语义（服务类型只写做什么）');
    t.check(JSON.stringify(voucher).indexOf('27-2-7016') === -1, 'F9 取件码不上凭证卡（L3 不进凭证/被后置清理）');
    const noConfirm = voucherPart.buildVoucher(completed, serverDto.buildEventDtos([
      { type: 'DELIVERED', at: DOC_MS - 120000, actorRole: 'PARTNER', note: '' }
    ]));
    t.eq(noConfirm.confirmedAtText, '—', 'F10 无顾客确认事件时不编造确认时间（显示占位）');
    const autoCompleted = voucherPart.buildVoucher(completed, serverDto.buildEventDtos([
      { type: 'AUTO_COMPLETED', at: new Date(ISO), actorRole: 'SYSTEM', note: '' }
    ]));
    t.eq([autoCompleted.confirmLabel, autoCompleted.confirmedAtText],
      ['自动完成时间', format.formatDateTime(ISO)], 'F11 24h 自动完成：标「自动完成时间」，不冒充顾客确认');
    const guestCompleted = await realDto(partnerDoc(STATUS.COMPLETED, {
      source: enums.ORDER_SOURCE.PARTNER,
      guest: { displayName: '室友', dormKey: 'D4-522' },
      deliveryNote: '放宿舍门口鞋柜上'
    }));
    const guestVoucher = voucherPart.buildVoucher(guestCompleted, serverDto.buildEventDtos([
      { type: 'AUTO_COMPLETED', at: new Date(ISO), actorRole: 'SYSTEM', note: '' }
    ]));
    t.check(guestVoucher.guest === true && guestVoucher.guestAuto.indexOf('代客单无顾客确认') >= 0,
      'F12 guest 单凭证标明无顾客确认路径（系统自动完成）');
    t.eq(guestVoucher.deliveryNote, '放宿舍门口鞋柜上', 'F13 guest 单送达备注进凭证（线下交接依据）');
    t.check(voucherPart.customerConfirmEvent(events) !== null && voucherPart.autoCompleteEvent(events) === null,
      'F14 顾客确认事件/自动完成事件分别独立取数');
    const builtEvents = eventView.buildEvents(events);
    t.eq(builtEvents.map((item) => item.label),
      ['订单创建', '已接单', '已取件·配送中', '已送达·待确认', '已完成'],
      'F15 时间线事件 DTO → 人话（七状态文案走 shared/order-state）');
    t.eq(builtEvents[4].actor, '顾客', 'F16 顾客确认事件在时间线标「顾客」');
    t.check(viewModel.buildView(completed, events, { nowMs: NOW_MS }).voucher.confirmedAtText === format.formatDateTime(confirmAt),
      'F17 视图装配把凭证卡带进页面快照');
    t.notEmpty(voucher.rows, 'F 组样本非空');
  });

  // ---------------------------------------------------------------- G 只读/静态/端到端
  h.section('G. 只读与静态纪律：READONLY 事件层再挡、TEST_WRITE 提示、零状态字面量、写动作带 version', async (t) => {
    const control = layerHits(
      "wx.cloud.callFunction({ name: 'api' });\n"
      + "const s = 'CANCELLED';\n"
      + 'const r = Math.random();\n'
      + "client.call('order.get', {});\n"
    );
    t.eq(control.length, 4, 'G1 正控：合成违规样本被扫描命中 4 类（扫描有牙）');
    t.eq(layerHits('const x = 1; // wx.cloud.callFunction 与 Math.random 在注释里\n'), [],
      'G2 反例：注释内违规字样不误伤（剥注释后扫描）');
    t.eq(layerHits(textOf(PAGE_JS)), [], 'G3 页面脚本零 wx.cloud/零七状态字面量/零 random/零直调 client.call');
    const page = textOf(PAGE_JS);
    t.check(page.indexOf("api/modules/") >= 0 && page.indexOf('modeGuard') >= 0,
      'G4 页面只经 api/modules 出入，并接 mode-guard 做只读二道闸');
    const reportTap = page.slice(page.indexOf('onActionTap('), page.indexOf('onActionTap(') + 900);
    t.check(/guardReadonly\(\)/.test(reportTap) && reportTap.indexOf('orderApi') === -1,
      'G5 动作点击先过只读闸（READONLY 只 toast、不发请求）');
    t.check(/开发者只读视角不能操作/.test(page), 'G6 READONLY 点击文案「开发者只读视角不能操作」');
    t.check(/isTestWrite\(\)/.test(page) && /测试数据/.test(page),
      'G7 TEST_WRITE 写成功提示点明「测试数据」');
    t.check(/buildVisibleActions\([^)]*readonly/.test(page) || /viewModel\.buildView\([^)]*readonly/.test(page),
      'G8 只读标志进入动作装配（置灰来自视图层，不在 wxml 临时判断）');
    t.check(!/\.status\s*===/.test(page) && !/\.status\s*==[^=]/.test(page),
      'G9 页面无 status 字面量比较（动作与文案只消费 DTO/parts）');
    t.check(!/\?(?:.*=.*pickupCode|.*=.*trackingTail|.*=.*openid)/.test(page) && page.indexOf('openid') === -1,
      'G10 页面跳转参数不带 L3（只认 orderNo 深链）');
    const wxml = textOf(PAGE_WXML);
    t.check(wxml.indexOf('switch-bar') >= 0, 'G11 详情页保留切换会话顶栏（#23）');
    t.check(wxml.indexOf('bind.create') === -1 && wxml.indexOf('绑定顾客') === -1,
      'G12 兼职端零绑定入口/零「绑定顾客」文案（#28）');
    t.check(wxml.indexOf('voucher.rows') >= 0 && wxml.indexOf('voucher.footer') >= 0,
      'G13 WXML 渲染凭证卡（数据来自 voucher 纯件）');
    t.check(wxml.indexOf('deliveryPanel.quickTags') >= 0 && wxml.indexOf('deliveryPanel.confirmText') >= 0,
      'G14 WXML 渲染送达浮层（快捷标签 + guest 确认文案）');
    t.check(wxml.indexOf('correctPanel.stationOptions') >= 0 && wxml.indexOf('picker') >= 0,
      'G15 WXML 站点 picker 值域取 correctPanel.stationOptions（P1~P8）');
    t.check(wxml.indexOf('deliveredChip') >= 0 && wxml.indexOf('guestAutoHint') >= 0,
      'G16 WXML 显示 guest「已送达·待自动完成」chip/提示');
    t.check(wxml.indexOf('item.disabled') >= 0 && wxml.indexOf('actions') >= 0,
      'G17 WXML 动作条渲染服务端动作并支持置灰');
    t.check(wxml.indexOf('undoBar.visible') >= 0, 'G18 WXML 撤销条按视图快照渲染');
    t.check(wxml.indexOf('顾客编号') >= 0 && wxml.indexOf('customerNoText') >= 0,
      'G19 顾客编号独立小字行（不显示 openid）');
    t.check(/MESSAGE_POLL_MS = 10000/.test(page) && /onShow\(\)[\s\S]*startMessagePoll/.test(page),
      'G19b 留言 10s 轮询：onShow 起，onHide/onUnload 停（离开页面不空转）');
    t.check(/onHide\(\)[\s\S]*stopMessagePoll/.test(page) && /onUnload\(\)[\s\S]*stopMessagePoll/.test(page),
      'G19c 留言轮询与撤销倒计时在 onHide/onUnload 统一清理');
    const jsLines = fsutil.countLines(path.join(ROOT, PAGE_JS));
    t.check(jsLines > 0 && jsLines <= 500, 'G20 页面脚本 ≤500 行（实际 ' + jsLines + ' 行）');
    const selfLines = fsutil.countLines(path.join(ROOT, 'tools/selftest-order-detail-partner.js'));
    t.check(selfLines > 0 && selfLines <= 1000, 'G21 本测试文件 ≤1000 行（实际 ' + selfLines + ' 行）');
    // 端到端：fake transport 断言包络（expectedVersion / clientRequestId / 只带差异字段）
    store.reset();
    const captured = [];
    try {
      stubTransport(function transport(payload) {
        captured.push(payload);
        return Promise.resolve({ ok: true, data: { order: {}, correctedFields: [] }, serverTime: NOW_MS });
      });
      const submitted = await realDto(partnerDoc(STATUS.SUBMITTED));
      const editor = Object.assign(correctPanel.buildEditor(submitted), { pickupCode: '27-2-7018' });
      const checked = correctPanel.validateSave(editor, submitted);
      const submit = correctPanel.buildSubmit(submitted, checked.patch);
      await orderApi.correct(submit.data, submit.opts);
      const corrected = captured[captured.length - 1];
      t.eq([corrected.action, corrected.expectedVersion, corrected.data.patch],
        ['order.correct', 3, { pickupCode: '27-2-7018' }],
        'G22 补码端到端：action/expectedVersion/差异 patch 经 api 层透传');
      t.check(client.CLIENT_REQUEST_ID_PATTERN.test(corrected.clientRequestId) === true,
        'G23 写动作经 api 层自动带合法 clientRequestId（幂等键）');
      const picked = await realDto(partnerDoc(STATUS.PICKED));
      const deliverSubmit = deliveryPanel.buildSubmit(picked, '放宿舍门口');
      await orderApi.markDelivered(deliverSubmit.data, deliverSubmit.opts);
      const delivered = captured[captured.length - 1];
      t.eq([delivered.action, delivered.data.deliveryNote, delivered.expectedVersion],
        ['order.markDelivered', '放宿舍门口', 3], 'G24 送达端到端：deliveryNote + expectedVersion 透传');
      await orderApi.reportException(exceptionPanel.buildReportSubmit(picked, { code: 'CABINET_ERROR' }).data);
      t.eq(captured[captured.length - 1].data, { orderNo: '20261022-0031', code: 'CABINET_ERROR' },
        'G25 异常上报端到端：payload 只有登记字段（无未知键）');
      await orderApi.undo({ orderNo: '20261022-0031' });
      t.eq(captured[captured.length - 1].action, 'order.undo', 'G26 撤销走统一 order.undo 入口（不本地拼状态）');
      // READONLY：前端二道闸在 transport 前就挡（不发请求）
      store.setViewContext({ viewMode: enums.VIEW_MODE.READONLY, viewTicket: 'ticket-it', role: 'PARTNER', targetNo: 'P-8F3-K2M' });
      let readonlyError = null;
      const before = captured.length;
      try {
        await orderApi.correct({ orderNo: '20261022-0031', patch: { lockerNo: '5 号柜' } });
      } catch (err) {
        readonlyError = err;
      }
      t.check(readonlyError !== null && readonlyError.code === 'FORBIDDEN'
        && readonlyError.message === '开发者只读视角不能操作' && captured.length === before,
      'G27 READONLY：api 层先抛 FORBIDDEN，不发任何写请求（前端二道闸）');
      store.clearViewContext();
      // 顾客已确认后撤销被拒：服务端错误码 → 人话（配刷新后的 DTO）
      stubTransport(function conflict() {
        return Promise.resolve({ ok: false, code: 'INVALID_TRANSITION' });
      });
      let undoError = null;
      try {
        await orderApi.undo({ orderNo: '20261022-0031' });
      } catch (err) {
        undoError = err;
      }
      const completedDto = await realDto(partnerDoc(STATUS.COMPLETED));
      t.eq(undoPart.failureText(undoError, completedDto), '顾客已确认送达，不能撤销。',
        'G28 顾客已确认：撤销被拒文案「顾客已确认送达，不能撤销」');
      stubTransport(function rate() {
        return Promise.resolve({ ok: false, code: 'RATE_LIMITED' });
      });
      let rateError = null;
      try {
        await orderApi.correct({ orderNo: '20261022-0031', patch: { lockerNo: '5 号柜' } });
      } catch (err) {
        rateError = err;
      }
      t.check(rateError !== null && rateError.code === 'RATE_LIMITED'
        && rateError.message === errorCopy.CODE_COPY.RATE_LIMITED,
      'G29 写失败按 13 码人话展示（RATE_LIMITED → error-copy 单源）');
      // 真实 DTO + 事件 → 页面快照；确认时间来自服务端事件
      const completed = completedDto;
      const events = serverDto.buildEventDtos([
        { type: 'COMPLETED', at: new Date(ISO), actorRole: 'CUSTOMER', note: '' }
      ]);
      const vm = viewModel.buildView(completed, events, { readonly: false, nowMs: NOW_MS });
      t.check(vm.actions.length === 0 && vm.voucher.confirmedAtText === format.formatDateTime(ISO),
        'G30 真实 COMPLETED DTO：动作条为空 + 凭证确认时间取事件');
      t.check(vm.order.statusText === '已完成' && vm.order.customerNoText === 'C-7K2M-9QX4',
        'G31 视图快照消费服务端 statusText 与编号快照');
      t.check(vm.order.pickupCodeText === '27-2-7016' && vm.order.codeStatusText === '取件码可用',
        'G32 详情页 L3 只在原位展示（取件码/状态文案取 DTO）');
      t.notEmpty(captured, 'G 组端到端样本非空');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- H v1.0 多包裹/配送/无截图
  h.section('H. v1.0 一单多包裹/逐件纠错/配送地址/无截图·手填（CONTRACT D23/D24/D25）', async (t) => {
    function multiDto(overrides) {
      return Object.assign({
        orderNo: '20261022-0031', status: STATUS.ACCEPTED, statusText: '已接单', version: 3,
        source: enums.ORDER_SOURCE.CUSTOMER,
        parcels: [
          { stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', lockerNo: '3 号柜', trackingTail: '66785',
            codeStatus: 'OK', codeStatusText: '取件码可用', recognitionSource: 'RULE' },
          { stationId: 'P6', stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: '12345',
            codeStatus: enums.CODE_STATUS.NEED_CODE, codeStatusText: '需补充取件码', recognitionSource: 'MANUAL', failureId: 'F-2' }
        ],
        images: [{ fileId: 'cloud://a/1.jpg' }, { fileId: 'cloud://a/2.jpg' }],
        manualEntry: false,
        delivery: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522', buildingText: 'D4', recipientName: '小李', phoneTail: '6678' },
        service: { code: 'PICKUP_STD', name: '标准代取' }, appoint: { type: 'ASAP' },
        counterpart: { displayName: '小王' }, guest: null, exception: null,
        note: '', deliveryNote: '', customerNo: 'C-7K2M-9QX4', partnerNo: 'P-8F3-K2M'
      }, overrides || {});
    }
    const multi = multiDto();
    const detail = orderView.buildDetail(multi);
    t.eq([detail.parcels.length, detail.parcelCountText, detail.parcels[1].stationText, detail.parcels[1].trackingTailText],
      [2, '2 件', '南苑菜鸟驿站', '12345'], 'H1 多包裹逐件展示（站点/尾号逐件，不聚合猜测）');
    t.eq([detail.parcels[0].recognitionSourceText, detail.parcels[1].recognitionSourceText], ['截图识别', '手动填写'],
      'H2 逐件识别来源文案（RULE/MANUAL 单源 shared/enums）');
    t.eq([detail.needCode, detail.parcels[1].needCode, detail.failureHint], [true, true, true],
      'H3 任一包裹需查明/识别失败 → 整单聚合仍按服务端逐件字段');
    t.eq([detail.deliveryText, detail.deliveryRecipientText, detail.deliveryIsDefault],
      ['D4-522', '收件人：小李', false], 'H4 配送地址（D25）：本单收件人地址原样展示');
    const defaultDelivery = orderView.buildDetail(multiDto({ delivery: { zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' } }));
    t.eq([defaultDelivery.deliveryRecipientText, defaultDelivery.deliveryIsDefault], ['送至下单人宿舍', true],
      'H5 无收件人 → 明示送至下单人宿舍（不猜第三方）');
    const manualDto = multiDto({ manualEntry: true, images: [] });
    t.eq([manualDto.manualEntry, orderView.buildDetail(manualDto).manualEntryText], [true, '无截图·手填'],
      'H6 无截图·手填标识（D24）取服务端 manualEntry');
    t.check(orderView.buildDetail(multiDto({ manualEntry: true, images: [] })).manualEntryText === '无截图·手填'
      && orderView.buildDetail(multiDto()).manualEntryText === '', 'H6b 有截图单不显示「无截图·手填」');

    const panel = correctPanel.buildPanel(multi);
    t.check(panel.multi === true && panel.items.length === 2 && panel.items[1].index === 1,
      'H7 多包裹补码面板：逐件目标（items）可选');
    t.eq(correctPanel.buildEditor(multi, 1), { stationId: 'P6', pickupCode: '', lockerNo: '', trackingTail: '12345' },
      'H8 逐件编辑初值 = 该件服务端当前值');
    const perItem = correctPanel.validateSave(Object.assign(correctPanel.buildEditor(multi, 1), { pickupCode: '27-2-9999' }), multi, 1);
    t.check(perItem.ok && perItem.patch.pickupCode === '27-2-9999', 'H9 逐件差异校验按 itemIndex 取目标件');
    t.eq([correctPanel.buildSubmit(multi, perItem.patch, 1).data.itemIndex,
      'itemIndex' in correctPanel.buildSubmit(multi, perItem.patch, 0).data], [1, false],
      'H10 提交带 itemIndex（逐件纠正）；首件缺省 0 不传（兼容契约缺省）');
    const pageSrc = textOf(PAGE_JS);
    const wxmlSrc = textOf(PAGE_WXML);
    t.check(pageSrc.indexOf('itemIndex') >= 0 && pageSrc.indexOf('correctPanel.buildEditor(this.data.order, index)') >= 0,
      'H11 页面按 itemIndex 打开/提交逐件纠正（不改订单级动作）');
    t.check(wxmlSrc.indexOf('order.parcels') >= 0 && wxmlSrc.indexOf('deliveryText') >= 0
      && wxmlSrc.indexOf('manualEntryText') >= 0 && wxmlSrc.indexOf('onCorrectItemTap') >= 0,
    'H12 WXML 渲染多包裹列表 + 配送地址 + 无截图标识 + 逐件改码入口');
    t.check(pageSrc.indexOf('index: 0') >= 0 && pageSrc.indexOf('orderApi.imageUrl') >= 0,
      'H13 截图 URL 契约 v1.0：order.imageUrl 带 index');
    const legacy = await realDto(partnerDoc(STATUS.SUBMITTED));
    t.eq([orderView.buildDetail(legacy).parcels.length, orderView.buildDetail(legacy).stationText],
      [1, legacy.parcel.stationName], 'H14 单包裹历史 DTO 仍渲染 1 件（兼容窗口，不白屏）');
    t.eq(viewModel.buildView(multi, [], { nowMs: NOW_MS }).order.parcels.length, 2,
      'H15 视图快照透出 parcels[]（页面不直读服务端嵌套结构）');
    t.notEmpty(detail.parcels, 'H 组样本非空');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-order-detail-partner' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-order-detail-partner');
  h.setExpected(EXPECTED_ASSERTIONS === 0 ? -1 : EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
