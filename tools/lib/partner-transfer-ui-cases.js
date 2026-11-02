'use strict';
/**
 * tools/lib/partner-transfer-ui-cases.js — 批 26-W4（D58 转派兼职端 UI）用例表：
 *   ① detailTransferChecks：订单详情「发起入口 / 邀请卡 / 等待卡 / 结果态 / 二次确认 / 只读 / 零判据」；
 *   ② workbenchTransferChecks：工作台「待接收转派」计数（服务端 transferPending）/ 行文案 / 排序 /
 *      区块状态 / 红点复用 / 页面接线静态闸。
 *
 * 非独立套件：由 tools/selftest-order-detail-partner.js 与 tools/selftest-order-workbench.js require
 * （拆出以控测试文件 ≤1000 行，门禁 #18；tools/lib 不参与 selftest 注册完整性闸，先例 tools/lib/workbench-day-cases.js）。
 * 纪律：先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等；
 *       页面可见性一律喂「真实 _dto.buildOrderDto 产出」，不手抄 DTO 形状。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');
const enums = require(path.join(ROOT, 'shared/enums.js'));
const orderState = require(path.join(ROOT, 'shared/order-state.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));
const transferPart = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/transfer.js'));
const actionsPart = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/actions.js'));
const viewModel = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/view-model.js'));
const transferView = require(path.join(ROOT, 'pages/partner/workbench/parts/transfer.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));

const STATUS = orderState.STATUS;
const TRANSFER_STATUS = enums.TRANSFER_STATUS;
const ISO = '2026-11-02T02:00:00.000Z';
const NOW = Date.parse(ISO);
const MINUTE = 60 * 1000;
const PAGE_JS = 'pkg-partner/pages/order-detail/index.js';
const PAGE_WXML = 'pkg-partner/pages/order-detail/index.wxml';
const WORKBENCH_JS = 'pages/partner/workbench/index.js';
const WORKBENCH_WXML = 'pages/partner/workbench/index.wxml';
const WORKBENCH_FLOW = 'pages/partner/workbench/parts/transfer-flow.js';
const WORKBENCH_LOAD_FLOW = 'pages/partner/workbench/parts/load-flow.js';
const DETAIL_PART = 'pkg-partner/pages/order-detail/parts/transfer.js';
const WB_PART = 'pages/partner/workbench/parts/transfer.js';
const STATUS_LITERALS = enums.ORDER_STATUS_LIST.slice();

function readText(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function stripped(rel) {
  return fsutil.stripComments(readText(rel));
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

// ── 服务端 DTO 夹具：真实 _dto.buildOrderDto（transfer 块由 _transfer.blockOf 按角色剪裁）──
const DTO_CTX = {
  dao: {
    get: function get() { return Promise.resolve(null); },
    find: function find() { return Promise.resolve([]); },
    findOne: function findOne() { return Promise.resolve(null); }
  },
  identity: {},
  now: NOW
};

function parcelOf(extra) {
  return Object.assign({
    itemIndex: 0,
    stationId: 'P4',
    stationName: '北部菜鸟驿站',
    pickupCode: '27-2-7016',
    lockerNo: '3 号柜',
    trackingTail: '66785',
    codeStatus: 'OK',
    recognitionSource: 'RULE',
    picked: false,
    pickedAt: 0
  }, extra || {});
}

function orderDoc(status, extra) {
  const doc = {
    _id: 'order-d58',
    orderNo: '20261102-0007',
    customerId: 'customer-it',
    partnerId: 'partner-it',
    customerNo: 'C-7K2M-9QX4',
    partnerNo: 'P-8F3-K2M',
    status: status,
    version: 5,
    source: enums.ORDER_SOURCE.CUSTOMER,
    parcels: [parcelOf()],
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { type: 'ASAP' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    note: '放宿舍门口鞋柜上',
    deliveryNote: '',
    phoneTail: '6678',
    exception: null,
    cancelReason: '',
    cancelledBy: '',
    statusUpdatedAt: NOW,
    createdAt: NOW - 3600000,
    updatedAt: NOW,
    acceptedAt: status === STATUS.ACCEPTED ? NOW : 0,
    pickedAt: 0,
    deliveredAt: 0,
    completedAt: 0,
    cancelledAt: 0
  };
  return Object.assign(doc, extra || {});
}

// orders.transfer 块（8 子键；status 由用例指定）
function transferBlock(status, extra) {
  return Object.assign({
    status: status,
    fromPartnerId: 'partner-it',
    fromPartnerNo: 'P-8F3-K2M',
    toPartnerId: 'partner-2',
    toPartnerNo: 'P-2ABC-DEF',
    requestedAt: isoAt(NOW - MINUTE),
    expiresAt: isoAt(NOW + 9 * MINUTE),
    resolvedAt: '',
    resolveReason: ''
  }, extra || {});
}

function pendingBlock(extra) {
  return transferBlock(TRANSFER_STATUS.PENDING, extra);
}

async function dtoOf(doc, options) {
  return serverDto.buildOrderDto(DTO_CTX, doc, Object.assign({ side: 'PARTNER' }, options || {}));
}

// 目标兼职视角 DTO（_dto 的 transferTarget 分支：只给邀请卡动作 + 遮蔽顾客昵称/头像/客户编号）
async function targetDtoOf(doc) {
  return dtoOf(doc, { transferTarget: true });
}

function keysOf(actions) {
  return (Array.isArray(actions) ? actions : []).map((item) => (typeof item === 'string' ? item : item.key));
}

function cardOfDto(dto, options) {
  // 与生产同形：喂 viewModel 同款「注册表规范化后的动作对象」（服务端 label 优先）
  const visible = actionsPart.buildVisibleActions(dto, { readonly: !!(options && options.readonly) });
  return transferPart.cardOf(dto, visible, Object.assign({ nowMs: NOW }, options || {}));
}

function viewOf(dto, options) {
  return viewModel.buildView(dto, [], Object.assign({ nowMs: NOW }, options || {}));
}

function jsonOf(value) {
  return JSON.stringify(value || {});
}

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

// ══════════════════════════════════════════════════════════════════════════════
// ① 订单详情（D58）
// ══════════════════════════════════════════════════════════════════════════════
async function detailTransferChecks(t) {
  // ── 合法基线：ACCEPTED 未取件 → 服务端下发 requestTransfer，页面出发起入口 ──
  const requestable = await dtoOf(orderDoc(STATUS.ACCEPTED));
  const requestCard = cardOfDto(requestable);
  t.eq([requestCard.visible, requestCard.request.visible, requestCard.request.title, requestCard.request.actionText],
    [true, true, '转派给其他兼职', '转派给其他兼职'],
    'K01 合法基线：ACCEPTED 未取件 → DTO actions 含 requestTransfer → 发起入口可见（文案取服务端 label）');
  t.check(requestCard.request.hint.indexOf('转给另一位兼职') >= 0 && requestCard.request.hint.indexOf('消失') >= 0,
    'K02 发起入口免责说明写清「转给另一位兼职、这单从你的列表消失」（说真话）');
  t.eq(requestCard.invite.visible || requestCard.waiting.visible || requestCard.result.visible, false,
    'K03 无 transfer 块 → 邀请/等待/结果三态都不渲染（只有入口）');

  // ── 发起方 PENDING：等待对方确认（剩余 N 分钟）+ 撤回转派 ──
  const initiatorDoc = orderDoc(STATUS.ACCEPTED, { transfer: pendingBlock() });
  const initiatorDto = await dtoOf(initiatorDoc);
  const waitingCard = cardOfDto(initiatorDto);
  t.eq([waitingCard.request.visible, waitingCard.waiting.visible, waitingCard.invite.visible],
    [false, true, false], 'K04 发起方 PENDING：不再出转派入口，改出「等待对方确认」卡');
  t.eq(waitingCard.waiting.title, '等待对方确认（剩余 9 分钟）',
    'K05 等待卡文案「等待对方确认（剩余 N 分钟）」按服务端 expiresAt - now 计算');
  t.eq(waitingCard.waiting.targetText, '转给 P-2ABC-DEF', 'K06 等待卡显示目标编号（partnerNo 快照，不出现内部 id）');
  t.eq(waitingCard.waiting.cancel && waitingCard.waiting.cancel.label, '撤回转派',
    'K07 等待卡「撤回转派」动作与文案同源（服务端 actions[] + label）');
  t.eq([waitingCard.waiting.cancel && waitingCard.waiting.cancel.key], ['cancelTransfer'],
    'K08 撤回动作键 = 服务端短键 cancelTransfer（页面不拼全名）');

  // ── 目标兼职视角：邀请卡（发起方编号 + 剩余 N 分钟 + 确认接收/拒收）──
  const targetDoc = orderDoc(STATUS.ACCEPTED, { transfer: pendingBlock() });
  const targetDto = await targetDtoOf(targetDoc);
  const inviteCard = cardOfDto(targetDto);
  t.eq(keysOf(targetDto.actions), ['acceptTransfer', 'declineTransfer'],
    'K09 目标兼职视角 DTO 只有邀请动作（无履约人动作 → 越权入口为零）');
  t.eq(viewOf(targetDto).actions.length, 0, 'K10 目标视角页面底部动作条为空（不渲染 pick/cancel 等履约动作）');
  t.eq([inviteCard.visible, inviteCard.invite.visible], [true, true], 'K11 目标视角渲染邀请卡');
  t.eq(inviteCard.invite.title, '来自 P-8F3-K2M 的转派邀请', 'K12 邀请卡显示发起方编号');
  t.eq(inviteCard.invite.remainingText, '剩余 9 分钟', 'K13 邀请卡显示「剩余 N 分钟」');
  t.eq([inviteCard.invite.accept && inviteCard.invite.accept.label, inviteCard.invite.decline && inviteCard.invite.decline.label],
    ['确认接收', '拒收'], 'K14 确认接收/拒收按钮文案取服务端 label');
  t.eq([inviteCard.invite.accept && inviteCard.invite.accept.key, inviteCard.invite.decline && inviteCard.invite.decline.key],
    ['acceptTransfer', 'declineTransfer'], 'K15 邀请动作键 = 服务端短键');
  t.eq(inviteCard.keys, ['acceptTransfer', 'declineTransfer'], 'K16 转派区块渲染键 = 服务端转派动作键（不增删）');

  // ── 目标视角 DTO 遮蔽：transfer 只白名单 7 键、不返回顾客昵称头像/内部 id ──
  t.eq(Object.keys(targetDto.transfer).sort(),
    ['expiresAt', 'fromPartnerNo', 'requestedAt', 'resolveReason', 'resolvedAt', 'status', 'toPartnerNo'],
    'K17 transfer 块键集合 = 草案 §1.4 白名单 7 键（无 statusText，中文文案由 shared 单源）');
  t.eq([!!targetDto.transfer.toPartnerId, !!targetDto.transfer.fromPartnerId], [false, false],
    'K18 transfer 块不返回内部 id（只 partnerNo）');
  t.check(viewOf(targetDto).order.counterpart === null && !('customerNo' in targetDto),
    'K19 目标视角不返回顾客昵称/头像/客户编号（页面不得自行补取）');
  const targetJson = jsonOf(targetDto) + jsonOf(viewOf(targetDto).transferCard);
  t.check(targetJson.indexOf('displayName') === -1 && targetJson.indexOf('avatarUrl') === -1
    && targetJson.indexOf('openid') === -1 && targetJson.indexOf('toPartnerId') === -1,
  'K20 目标视角 DTO + 转派视图字符串级不含 displayName/avatarUrl/openid/toPartnerId');

  // ── 过期：过期/已被撤回时只读提示（按钮收回）──
  const expiredDoc = orderDoc(STATUS.ACCEPTED, {
    transfer: pendingBlock({ expiresAt: isoAt(NOW - MINUTE), requestedAt: isoAt(NOW - 11 * MINUTE) })
  });
  const expiredInvite = cardOfDto(await targetDtoOf(expiredDoc));
  t.eq([expiredInvite.invite.accept, expiredInvite.invite.decline], [null, null],
    'K21 邀请已过期 → 确认接收/拒收按钮收回（不把必然失败的按钮留在屏上）');
  t.eq(expiredInvite.invite.hint, '邀请已过期，刷新页面后查看最新状态',
    'K22 邀请过期给只读提示 + 下一步（刷新后看最新状态）');
  const expiredWaiting = cardOfDto(await dtoOf(expiredDoc));
  t.eq([expiredWaiting.waiting.cancel, expiredWaiting.waiting.title], [null, '等待对方确认（邀请已过期）'],
    'K23 发起方侧过期：撤回按钮收回，标题带过期文案');
  t.eq(expiredWaiting.waiting.hint, '邀请已过期，刷新后这单仍在你的列表里',
    'K24 发起方过期提示说明订单归属没有变（说真话）');

  // ── 只读会话：写按钮一律不出，只留说明 ──
  const readonlyInvite = cardOfDto(await targetDtoOf(targetDoc), { readonly: true });
  t.eq([readonlyInvite.invite.accept, readonlyInvite.invite.decline, readonlyInvite.invite.hint],
    [null, null, '开发者只读视角不能操作'], 'K25 READONLY：邀请卡不渲染写按钮，只给只读提示');
  const readonlyRequest = cardOfDto(requestable, { readonly: true });
  t.eq([readonlyRequest.request.visible, readonlyRequest.request.readonlyHint],
    [true, '开发者只读视角不能操作'], 'K26 READONLY：发起入口仍可见但按钮由 wxml 隐藏 + 只读提示');

  // ── 结果态：四种终态中文文案（服务端 status 单源 → shared 文案）──
  const declinedCard = cardOfDto(await dtoOf(orderDoc(STATUS.ACCEPTED, {
    transfer: transferBlock(TRANSFER_STATUS.DECLINED, { resolvedAt: isoAt(NOW - MINUTE), resolveReason: enums.TRANSFER_RESOLVE_REASON.TARGET_DECLINED })
  })));
  t.eq([declinedCard.result.visible, declinedCard.result.text], [true, '对方已拒收'],
    'K27 结果态 DECLINED → 「对方已拒收」');
  t.eq([declinedCard.request.visible, declinedCard.result.hint], [true, '如仍要转派，可以重新发起。'],
    'K28 对方拒收后仍可重新发起（入口来自服务端 actions，页面不猜状态）');
  const cancelledCard = cardOfDto(await dtoOf(orderDoc(STATUS.ACCEPTED, {
    transfer: transferBlock(TRANSFER_STATUS.CANCELLED, { resolvedAt: isoAt(NOW - MINUTE), resolveReason: enums.TRANSFER_RESOLVE_REASON.FROM_CANCELLED })
  })));
  t.eq([cancelledCard.result.text, cancelledCard.result.hint], ['已撤回', '如仍要转派，可以重新发起。'],
    'K29 结果态 CANCELLED → 「已撤回」+ 可重新发起');
  const expiredResult = cardOfDto(await dtoOf(orderDoc(STATUS.ACCEPTED, {
    transfer: transferBlock(TRANSFER_STATUS.EXPIRED, { resolvedAt: isoAt(NOW - MINUTE), resolveReason: enums.TRANSFER_RESOLVE_REASON.EXPIRED })
  })));
  t.eq(expiredResult.result.text, '邀请已过期', 'K30 结果态 EXPIRED → 「邀请已过期」');
  const acceptedDto = await dtoOf(orderDoc(STATUS.ACCEPTED, {
    partnerId: 'partner-2',
    transfer: transferBlock(TRANSFER_STATUS.ACCEPTED, {
      resolvedAt: isoAt(NOW - MINUTE), resolveReason: enums.TRANSFER_RESOLVE_REASON.TARGET_ACCEPTED
    })
  }));
  const acceptedCard = cardOfDto(acceptedDto);
  t.eq(acceptedCard.result.text, '已转派：由 P-2ABC-DEF 接手履约',
    'K31 结果态 ACCEPTED → 「已转派：由 P-xxx 接手履约」（只编号，不昵称头像）');
  t.eq([acceptedCard.result.visible, acceptedCard.request.visible, acceptedCard.keys], [true, true, ['requestTransfer']],
    'K32 接手后新履约人仍可再次转派（入口取服务端 actions，不本地判历史结果/不隐藏入口）');

  // ── 收口：一件已取 / 其它状态 → 服务端不下发转派入口，页面零入口 ──
  const pickedDoc = orderDoc(STATUS.ACCEPTED, { parcels: [parcelOf({ picked: true, pickedAt: NOW - MINUTE })] });
  const pickedCard = cardOfDto(await dtoOf(pickedDoc));
  t.eq([pickedCard.visible, pickedCard.request.visible], [false, false],
    'K33 D61 收口：一件已取 → 服务端不下发 requestTransfer（必然 INVALID_STATE）→ 页面零入口');
  const submittedCard = cardOfDto(await dtoOf(orderDoc(STATUS.SUBMITTED)));
  t.eq(submittedCard.visible, false, 'K34 非 ACCEPTED（待接单）→ 无转派任何入口');
  const completedCard = cardOfDto(await dtoOf(orderDoc(STATUS.COMPLETED)));
  t.eq(completedCard.visible, false, 'K35 终态（已完成）→ 无转派任何入口');

  // ── 纯件边界：剩余分钟 / 编号归一 / 空输入 / 动作拆分 ──
  t.eq([transferPart.remainingText(isoAt(NOW + 9 * MINUTE), NOW), transferPart.remainingText(isoAt(NOW + 30 * 1000), NOW),
    transferPart.remainingText(isoAt(NOW - 1), NOW), transferPart.remainingText('', NOW)],
  ['剩余 9 分钟', '剩余 1 分钟', '邀请已过期', ''],
  'K36 remainingText 纯件：整分钟/不足 1 分钟向上取整/已过期/缺字段空串');
  t.eq([transferPart.normalizePartnerNo(' p-8f3-k2m '), transferPart.normalizePartnerNo('P8F3K2M')],
    ['P8F3K2M', 'P8F3K2M'], 'K37 编号归一：去空格/连字符并大写（用户粘贴带连字符也能提交）');
  t.eq(transferPart.inputOf(''), { ok: false, toPartnerNo: '', message: '请先填对方的完整兼职编号' },
    'K38 空输入本地拦下（不发请求），提示给下一步');
  t.eq(transferPart.inputOf(' P-8F3-K2M '), { ok: true, toPartnerNo: 'P8F3K2M', message: '' },
    'K39 合法输入归一后提交（形态校验交给服务端，页面零业务判据）');
  t.eq(transferPart.inputOf('P').ok, true, 'K40 过短编号不在本地拦截（由服务端 VALIDATION_FAILED 文案说真话）');
  const mixedSplit = transferPart.splitActions([
    { key: 'pick', label: '标记已取件' },
    { key: 'requestTransfer', label: '转派给其他兼职' },
    { key: 'cancelTransfer', label: '撤回转派' },
    { key: 'message', label: '留言' }
  ]);
  t.eq([keysOf(mixedSplit.status), keysOf(mixedSplit.transfer)],
    [['pick', 'message'], ['requestTransfer', 'cancelTransfer']],
    'K41 splitActions：转派动作从底部条移出、其余动作顺序不变');

  // ── view-model 集成：页面动作条与转派区块合起来 = 服务端 actions[] 原样（不增删）──
  const initiatorView = viewOf(initiatorDto);
  t.eq(keysOf(initiatorView.actions), ['pick', 'exception', 'correct', 'cancel', 'message'],
    'K42 发起方 PENDING：底部条 = 服务端动作去掉转派键（顺序不变）');
  t.eq(initiatorView.transferCard.keys, ['cancelTransfer'], 'K43 转派键只出现在转派区块（不重复出按钮）');

  // ── 二次确认 / 成功文案（文案纪律：说真话 + 给下一步）──
  const requestConfirm = transferPart.requestConfirmOf('P2ABCDEF');
  t.check(requestConfirm.content.indexOf('P2ABCDEF') >= 0 && requestConfirm.content.indexOf('撤回') >= 0
    && requestConfirm.title === '确认转派', 'K44 发起二次确认写清目标、失去该单与可撤回');
  const declineConfirm = transferPart.declineConfirmOf();
  t.check(declineConfirm.content.indexOf('仍在对方名下') >= 0 && declineConfirm.content.indexOf('重新发起') >= 0,
    'K45 拒收二次确认写清订单归属不变与下一步');
  const cancelConfirm = transferPart.cancelConfirmOf();
  t.check(cancelConfirm.content.indexOf('仍由你处理') >= 0 && cancelConfirm.content.indexOf('重新发起') >= 0,
    'K46 撤回二次确认写清订单仍由你处理与下一步');
  t.eq(['request', 'accept', 'decline', 'cancel'].map((kind) => transferPart.successTextOf(kind)),
    ['已发起转派，等待对方确认', '已接收转派，这单由你处理', '已拒收，订单仍在对方名下', '已撤回，订单仍由你处理'],
    'K47 四个写动作成功提示逐句（含 TEST_WRITE 测试数据后缀由页面拼接）');
  t.eq(transferPart.requestPanel().maxLength >= 7, true, 'K48 面板输入长度上限允许完整编号（含连字符）');

  // ── 静态纪律：页面零判据 / 零直拼 action / 零 wx.cloud / 零内部 id ──
  const pageSrc = stripped(PAGE_JS);
  const pageHits = layerHits(pageSrc);
  t.eq(pageHits, [], 'K49 页面层零判据静态闸：零 wx.cloud / 零 random / 零直调 client.call / 零七状态字面量（有牙反例见 K50）');
  t.eq(layerHits('var x = "ACCEPTED";'), ['状态字面量 ACCEPTED'], 'K50 扫描有牙：注入状态字面量必红（不空集全绿）');
  t.check(pageSrc.indexOf("'requestTransfer'") === -1 && pageSrc.indexOf("'acceptTransfer'") === -1
    && pageSrc.indexOf("'cancelTransfer'") === -1 && pageSrc.indexOf("'declineTransfer'") === -1,
  'K51 页面脚本不直拼转派动作字符串（动作键只在 parts/actions 注册表与 parts/transfer）');
  t.check(pageSrc.indexOf('onTransferRequestTap(') >= 0 && pageSrc.indexOf('onTransferSubmit(') >= 0
    && pageSrc.indexOf('onTransferAcceptTap(') >= 0 && pageSrc.indexOf('onTransferDeclineTap(') >= 0
    && pageSrc.indexOf('onTransferCancelTap(') >= 0,
  'K52 四个写动作 + 面板提交都有页面接线（点下去真发请求）');
  t.check(pageSrc.indexOf('orderApi.requestTransfer(') >= 0 && pageSrc.indexOf('orderApi.acceptTransfer(') >= 0
    && pageSrc.indexOf('orderApi.declineTransfer(') >= 0 && pageSrc.indexOf('orderApi.cancelTransfer(') >= 0,
  'K53 写请求一律经 api/modules（orderApi.*Transfer），不直调 client.call');
  t.eq((pageSrc.match(/client\.createRequestId\(\)/g) || []).length >= 4, true,
    'K54 四个写动作都带 clientRequestId（服务端幂等 requestKey）');
  t.check(pageSrc.indexOf('writeOpts(') >= 0 && pageSrc.indexOf('expectedVersion') >= 0,
    'K55 写请求带 expectedVersion（乐观锁，CONFLICT 由服务端说真话）');
  const wxmlSrc = stripped(PAGE_WXML);
  t.check(wxmlSrc.indexOf('transferCard.request.visible') >= 0 && wxmlSrc.indexOf("panel === 'transfer'") >= 0
    && wxmlSrc.indexOf('bindtap="onTransferSubmit"') >= 0 && wxmlSrc.indexOf('bindtap="onTransferAcceptTap"') >= 0
    && wxmlSrc.indexOf('bindtap="onTransferDeclineTap"') >= 0 && wxmlSrc.indexOf('bindtap="onTransferCancelTap"') >= 0,
  'K56 WXML 渲染发起入口/转派面板/邀请卡/等待卡按钮（事件绑定齐全）');
  const partSrc = stripped(DETAIL_PART);
  t.check(partSrc.indexOf('enums.TRANSFER_STATUS') >= 0 && partSrc.indexOf('enums.TRANSFER_STATUS_TEXT') >= 0,
    'K57 转派纯件用 shared 枚举/文案单源（不在页面复制一套状态文案）');
  t.check(partSrc.indexOf("'PENDING'") === -1 && partSrc.indexOf("'ACCEPTED'") === -1
    && partSrc.indexOf("'DECLINED'") === -1 && partSrc.indexOf("'EXPIRED'") === -1,
  'K58 转派纯件零转派状态字面量（只做枚举常量比较，非状态判据）');
  t.check(partSrc.indexOf('toPartnerId') === -1 && partSrc.indexOf('fromPartnerId') === -1
    && partSrc.indexOf('openid') === -1 && partSrc.indexOf('customerNo') === -1,
  'K59 纯件不读内部 id / 顾客隐私字段（只用 partnerNo 快照）');
  t.check(actionsPart.ACTIONS.requestTransfer.label === '转派给其他兼职'
    && actionsPart.ACTIONS.acceptTransfer.label === '确认接收'
    && actionsPart.ACTIONS.declineTransfer.label === '拒收'
    && actionsPart.ACTIONS.cancelTransfer.label === '撤回转派',
  'K60 动作注册表补 4 个短键兜底文案（服务端 label 优先，注册表保证不被页面丢弃）');
  t.eq(actionsPart.isWriteKey('requestTransfer') && actionsPart.isWriteKey('acceptTransfer')
    && actionsPart.isWriteKey('declineTransfer') && actionsPart.isWriteKey('cancelTransfer'), true,
  'K61 四个转派动作都按写动作登记（READONLY 自动进拒绝集）');
  t.notEmpty([requestable, initiatorDto, targetDto, acceptedDto], 'K62 K 组样本非空（真实 DTO 4 份）');
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 工作台（D58 待接收转派区块）
// ══════════════════════════════════════════════════════════════════════════════
function transferListRow(extra) {
  return Object.assign({
    orderNo: '20261102-0011',
    parcelCount: 2,
    dorm: { roomTag: 'A' },
    transfer: {
      status: TRANSFER_STATUS.PENDING,
      fromPartnerNo: 'P-8F3-K2M',
      toPartnerNo: 'P-2ABC-DEF',
      requestedAt: isoAt(NOW - MINUTE),
      expiresAt: isoAt(NOW + 9 * MINUTE),
      resolvedAt: '',
      resolveReason: ''
    }
  }, extra || {});
}

function workbenchTransferChecks(t) {
  // ── N 的唯一来源 = 服务端顶层 transferPending（客户端不自算）──
  t.eq(transferView.pendingOf({ transferPending: 3 }), 3, 'O01 计数取服务端顶层 transferPending（不按行数/不自算）');
  t.eq(transferView.pendingOf({ transferPending: 2, list: [1, 2, 3, 4] }), 2,
    'O02 行数与计数不一致时以服务端 count 为准（list 只作展示）');
  t.eq([transferView.pendingOf({}), transferView.pendingOf({ transferPending: -2 }), transferView.pendingOf({ transferPending: 'x' })],
    [null, 0, null],
    'O03 主响应缺字段/非数字 → null（未知，不编造 0）；负数按 0（交给页面用待接收列表响应的服务端计数兜底）');
  t.eq(transferView.pendingOf({ transferPending: 2.9 }), 2, 'O04 计数取整（服务端应为整数，脏值不出现小数）');

  // ── 查询：服务端过滤（客户端零过滤）──
  t.eq(transferView.query(), { view: 'transfer', limit: transferView.PAGE_LIMIT },
    'O05 待接收行查询 = view:transfer + limit（服务端过滤 PENDING，客户端不传 status/关键字）');

  // ── 行文案：发起方编号 / 剩余分钟 / 件数房标 ──
  const rows = transferView.rowsOf([transferListRow()], NOW);
  t.eq(rows.length, 1, 'O06 行样本非空（1 行待接收转派）');
  t.eq([rows[0].orderNo, rows[0].fromText, rows[0].remainingText, rows[0].metaText],
    ['20261102-0011', '来自 P-8F3-K2M 的转派邀请', '剩余 9 分钟', '2 件 · 房标 A'],
    'O07 行文案：订单号 + 发起方编号 + 剩余 N 分钟 + 件数/房标');
  const sparse = transferView.rowsOf([{ orderNo: 'X-1', transfer: { status: TRANSFER_STATUS.PENDING, expiresAt: isoAt(NOW + MINUTE) } }], NOW);
  t.eq([sparse[0].fromText, sparse[0].metaText], ['', ''],
    'O08 缺字段不拼残句（无 fromPartnerNo/件数/房标时给空串，不显示「来自」半句）');
  t.eq(transferView.rowsOf([{ orderNo: 'X-2' }], NOW).length, 0,
    'O09 无 transfer 块的行不进待接收区（防御脏数据）');

  // ── 排序：最早过期在前（同刻按单号稳定）──
  const sortRows = transferView.rowsOf([
    transferListRow({ orderNo: 'B', transfer: pendingBlockOf(5) }),
    transferListRow({ orderNo: 'A', transfer: pendingBlockOf(2) }),
    transferListRow({ orderNo: 'C', transfer: pendingBlockOf(5) })
  ], NOW);
  t.eq(sortRows.map((row) => row.orderNo), ['A', 'B', 'C'],
    'O10 行排序：最早过期在前；同一时刻按订单号稳定排序（不依赖服务端顺序）');

  // ── 区块状态：count 恒为服务端值；loading/失败/更多都给下一步 ──
  const state = transferView.stateOf(2, rows, {});
  t.eq([state.visible, state.count, state.title], [true, 2, '待接收转派（2）'],
    'O11 区块态：有 N 条时可见、标题「待接收转派（N）」');
  t.eq(transferView.closedState().visible, false, 'O12 无待接收时区块隐藏（closedState 结构完整）');
  const more = transferView.stateOf(3, rows, {});
  t.eq([more.count, more.moreText], [3, '还有 2 条，下拉刷新后再看'],
    'O13 count 恒为服务端值；行未取全时提示还有 N 条（不自减计数）');
  const loading = transferView.stateOf(2, [], { loading: true });
  t.eq([loading.visible, loading.loading, loading.hintText], [true, true, '正在加载待接收转派…'],
    'O14 首次拉行时区块先出标题 + 加载提示（不空白跳变）');
  const failed = transferView.stateOf(2, [], { loadFail: true });
  t.eq([failed.hintText, failed.moreText], ['待接收转派没加载出来，点刷新重试', ''],
    'O15 拉行失败给可续的下一步提示（不误报还有 N 条）');
  const emptyRows = transferView.stateOf(0, rows, {});
  t.eq([emptyRows.visible, emptyRows.rows.length], [false, 0], 'O16 count=0 时清空行（不残留上一轮待接收）');

  // ── 红点复用既有机制：badges.workbenchPending = 待接单 + 待接收转派，messages 不受影响 ──
  t.eq(loadView.badgePatch({ submitted: 5 }, { messages: 2 }, 3), { workbenchPending: 8, messages: 2 },
    'O17 红点复用既有 workbenchPending：待接单 + 待接收转派（不新增红点键、不覆盖 messages）');
  t.eq(loadView.badgePatch({ submitted: 5, messages: 0 }, { workbenchPending: 1, messages: 2 }),
    { workbenchPending: 5, messages: 2 },
    'O18 旧两参调用仍成立（transferPending 缺省 0，向后兼容）');
  t.eq(loadView.badgePatch({ submitted: 0 }, {}, 2), { workbenchPending: 2, messages: 0 },
    'O19 待接单清零但有待接收转派 → 红点仍亮（不能漏掉待办）');
  t.eq(loadView.badgePatch({ submitted: 0 }, {}, 0), { workbenchPending: 0, messages: 0 },
    'O20 两类待办都清零 → 红点归零');

  // ── 页面接线静态：count 来自响应、行来自 view=transfer、点行进详情、不自行计数 ──
  const flowSrc = stripped(WORKBENCH_FLOW);
  t.check(flowSrc.indexOf('transferView.pendingOf(response)') >= 0
    && flowSrc.indexOf('orderApi.listPartner(transferView.query())') >= 0,
  'O21 接线：count 取响应 transferPending、行取 order.listPartner({view:transfer})（服务端过滤）');
  t.check(flowSrc.indexOf('const fallback = transferView.pendingOf(data)') >= 0
    && flowSrc.indexOf('this.syncBadge(this.data.counts, count)') >= 0,
  'O21b 主响应缺 transferPending 时用待接收列表响应的服务端计数兜底并补红点（客户端仍不按行数自算）');
  t.check(flowSrc.indexOf('rows.length') === -1 && flowSrc.indexOf('list.length') === -1,
    'O21c 接线代码不出现「按行数算 N」（count 只来自服务端字段，防退回客户端计数）');
  t.check(flowSrc.indexOf('DETAIL_PAGE') >= 0 && flowSrc.indexOf('wx.navigateTo(') >= 0,
    'O22 待接收行点击进订单详情（行可点，不只是展示）');
  t.check(flowSrc.indexOf('_transferToken') >= 0 && flowSrc.indexOf('onTransferRowTap') >= 0,
    'O23 旧响应按 token 丢弃（轮询竞态不把旧数据落到新状态）');
  t.check(flowSrc.indexOf('onToggleRow') === -1 && flowSrc.indexOf('selecting') === -1,
    'O24 待接收行点击不受多选态影响（不触发勾选/批量）');
  const loadFlowSrc = stripped(WORKBENCH_LOAD_FLOW);
  t.check(loadFlowSrc.indexOf('transferView.pendingOf(data)') >= 0
    && loadFlowSrc.indexOf('this.syncBadge(plan.counts, transferView.pendingOf(data))') >= 0
    && loadFlowSrc.indexOf('this.applyTransfer(data)') >= 0,
  'O25 每次列表刷新都同步红点与待接收区块（count 服务端下发，客户端不自行 ++/--）');
  t.check(loadFlowSrc.indexOf('store.patch({ badges: next })') >= 0,
    'O26 红点走既有 store.patch({badges}) 机制（复用，不新建红点通道）');
  const indexSrc = stripped(WORKBENCH_JS);
  t.check(indexSrc.indexOf("require('./parts/transfer-flow')") >= 0
    && indexSrc.indexOf("require('./parts/transfer')") >= 0
    && indexSrc.indexOf('transfer: transferView.closedState()') >= 0,
  'O27 index.js 拆件后接线：待接收纯件 + 接线件都 require，data 初值结构完整');
  t.eq(layerHitsWorkbench(indexSrc), [],
    'O28 工作台页面零判据（拆件后 index.js 仍零 wx.cloud/零 random/零七状态字面量）');
  t.eq(layerHitsWorkbench(stripped(WB_PART)), [],
    'O29 待接收纯件零判据（零 wx.cloud/零 random/零七状态字面量）');
  const wxmlSrc = stripped(WORKBENCH_WXML);
  t.check(wxmlSrc.indexOf('transfer.visible') >= 0 && wxmlSrc.indexOf('transfer.title') >= 0
    && wxmlSrc.indexOf('row.remainingText') >= 0 && wxmlSrc.indexOf('row.fromText') >= 0
    && wxmlSrc.indexOf('bindtap="onTransferRowTap"') >= 0,
  'O30 WXML 顶部待接收区块：标题/行（发起方编号 + 剩余分钟）/点行进详情');
  t.eq(wxmlSrc.indexOf('transfer-card') < wxmlSrc.indexOf('counts-card'), true,
    'O31 区块位于工作台顶部（计数卡之前，打开就能看到待接收）');
  t.check(wxmlSrc.indexOf('onTransferAcceptTap') === -1 && wxmlSrc.indexOf('onTransferDeclineTap') === -1
    && wxmlSrc.indexOf('onTransferCancelTap') === -1,
  'O32 待接收区块只读（写操作只在订单详情，不自造第二套入口）');
  t.notEmpty([rows, state, more], 'O33 O 组样本非空（行/区块态/更多提示）');
}

function pendingBlockOf(minutes) {
  return {
    status: TRANSFER_STATUS.PENDING,
    fromPartnerNo: 'P-8F3-K2M',
    toPartnerNo: 'P-2ABC-DEF',
    requestedAt: isoAt(NOW - MINUTE),
    expiresAt: isoAt(NOW + minutes * MINUTE),
    resolvedAt: '',
    resolveReason: ''
  };
}

// 工作台页面扫描：与既有 selftest-order-workbench.layerHits 同口径（无 client.call 项外的差异）
function layerHitsWorkbench(code) {
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

module.exports = {
  DETAIL_EXPECTED_ASSERTIONS: 62,
  WORKBENCH_EXPECTED_ASSERTIONS: 35,
  detailTransferChecks,
  workbenchTransferChecks
};
