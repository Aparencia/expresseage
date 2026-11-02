'use strict';
/**
 * tools/lib/order-customer-pickup-cases.js — 批 25-C / D61 件级取件的**顾客端可见性**用例（Q 组，拆件守 #18）。
 *
 * 覆盖（任务卡「顾客端可见性 + 测试」）：
 *   Q1~Q4  部分取件详情：每件只读「已取件/待取件 + 取件时间」、摘要「已取 n/m 件」、
 *          提示「已取 n/m 件，全部取完后进入已取件」、进度条第 3 步仍由订单 status=PICKED 驱动；
 *   Q5~Q7  全部件取完后进度推进到第 3 步「已取件」、摘要/提示不再重复展示；
 *   Q8~Q11 0 件已取不显示、异常分支保留件级摘要但进度仍按 exception.fromStatus；
 *   Q12~Q14 旧单派生（服务端按订单状态派生的 picked/pickedAt 照常展示）、旧 DTO 缺字段兼容（不显示不崩）；
 *   Q15~Q16 顾客侧 parcel.actions 恒空：件级动作不进视图模型、页面零消费件级动作；
 *   Q17~Q19 详情 WXML 只读渲染/包裹区块无按件按钮/刷新经页面扩展视图；
 *   Q20~Q23 列表行「已取 n/m 件」标签四态（0/n、部分、全取、缺字段）与接线/样式、纯件零七状态字面量；
 *   Q24~Q25 件级取件事件通用人话（无英文事件名/内部编号，不改变订单状态展示）；
 *   Q26~Q27 端云联调：真实服务端 DTO（_dto.buildOrderDto side=CUSTOMER）→ 客户端逐字段消费一致；
 *   Q28~Q32 展示条件收敛（UX_CUSTOMER §3.4/§3.8）：列表标签终态（COMPLETED/CANCELLED）不显示、
 *          EXCEPTION 仍显示；详情件级「已取/待取」行与 n/m 摘要只在
 *          {ACCEPTED,PICKED,DELIVERED,COMPLETED,EXCEPTION} 出（SUBMITTED/CANCELLED 不渲染）+ 端云联调。
 *
 * 纪律：不 mock 全局 wx；夹具字段形状 = D61 冻结 DTO（订单 `pickedCount/parcelCount/allPicked`、
 *       每件 `picked/pickedAt/actions`，顾客侧 actions 恒空）；先合法基线再反例；样本非空。
 */
const path = require('path');
const caseLib = require('./order-customer-cases');
const format = require(path.resolve(__dirname, '../../pkg-customer/parts/format.js'));

const ROOT = caseLib.ROOT;
const parcelView = require(path.join(ROOT, 'pkg-customer/pages/order-detail/parts/parcel-view.js'));
const view = require(path.join(ROOT, 'pkg-customer/parts/status-view.js'));
const ordersView = require(path.join(ROOT, 'pages/customer/parts/orders-view.js'));
const pickupTag = require(path.join(ROOT, 'pages/customer/orders/parts/pickup-tag.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));

const STATUS = caseLib.STATUS;
const ISO = caseLib.ISO;
const PICKED_AT = '2026-10-22T12:00:00+08:00';
const PICKED_AT_TEXT = format.formatDateTime(PICKED_AT);

/** 一单多件的顾客侧 DTO 夹具：parcels[] 每件带 picked/pickedAt/actions（顾客侧 actions 恒空） */
function multiOrder(status, pickedFlags, extra) {
  const parcels = pickedFlags.map(function map(picked, index) {
    return {
      itemIndex: index,
      stationId: 'P3',
      stationName: '菜鸟驿站-3号楼',
      pickupCode: '8-2-302' + (index + 1),
      lockerNo: '',
      trackingTail: '',
      codeStatus: 'OK',
      codeStatusText: '有取件码',
      picked: picked,
      pickedAt: picked ? PICKED_AT : '',
      actions: []
    };
  });
  const pickedCount = pickedFlags.filter(function filter(flag) { return flag === true; }).length;
  const parcelCount = parcels.length;
  return caseLib.dto(status, Object.assign({
    parcels: parcels,
    pickedCount: pickedCount,
    parcelCount: parcelCount,
    allPicked: parcelCount > 0 && pickedCount === parcelCount
  }, extra || {}));
}

function progressStates(order) {
  return view.progressView(order).steps.map(function map(step) { return step.state; }).join(',');
}

function detailText(rel) {
  return caseLib.textOf(rel);
}

function registerQ(t) {
  const PARTIAL = multiOrder(STATUS.ACCEPTED, [true, false, false]);
  const partialExtras = parcelView.pageExtras(PARTIAL, {}, caseLib.NOW);
  t.eq(partialExtras.parcels.map(function map(row) { return [row.picked, row.pickedText, row.pickedAtText]; }),
    [[true, '已取件', PICKED_AT_TEXT], [false, '待取件', ''], [false, '待取件', '']],
    'Q1 部分取件详情：每件只读显示「已取件/待取件 + 取件时间」（服务端 parcels[].picked/pickedAt，无操作按钮）');
  t.eq([partialExtras.pickupSummary, partialExtras.pickupPartialHint],
    ['已取 1/3 件', '已取 1/3 件，全部取完后进入已取件'],
    'Q2 部分取件摘要/提示只读 DTO pickedCount/parcelCount/allPicked（不按件推导）');
  t.eq(progressStates(PARTIAL), 'done,current,future,future,future',
    'Q3 D61 部分取件进度条不推进：第 3 步「已取件」仍由订单 status=ACCEPTED 驱动（前端不假装推进）');
  t.eq(view.progressView(PARTIAL).mode, 'normal', 'Q4 部分取件仍是正常进度分支（不是异常/取消分支）');

  const FULL = multiOrder(STATUS.PICKED, [true, true]);
  const fullExtras = parcelView.pageExtras(FULL, {}, caseLib.NOW);
  t.eq(progressStates(FULL), 'done,done,current,future,future',
    'Q5 全部件取完（订单 status=PICKED）后进度推进到第 3 步「已取件」当前节点');
  t.eq(fullExtras.parcels.map(function map(row) { return row.pickedText; }), ['已取件', '已取件'],
    'Q6 全取后每件都显示「已取件」，件级取件时间保留');
  t.eq([fullExtras.pickupSummary, fullExtras.pickupPartialHint], ['', ''],
    'Q7 全取后不再显示「已取 n/m 件」摘要/提示（与订单状态「已取件」重复，避免信息噪声）');

  const ZERO = multiOrder(STATUS.ACCEPTED, [false, false]);
  t.eq([parcelView.pageExtras(ZERO, {}, caseLib.NOW).pickupSummary,
    parcelView.pageExtras(ZERO, {}, caseLib.NOW).pickupPartialHint], ['', ''],
  'Q8 一件未取（0/n）不显示部分取件摘要/提示');
  t.eq(parcelView.pageExtras(ZERO, {}, caseLib.NOW).parcels.map(function map(row) { return row.pickedText; }),
    ['待取件', '待取件'], 'Q9 一件未取时每件显示「待取件」（取件时间为空）');

  const EXCEPTION_PARTIAL = multiOrder(STATUS.EXCEPTION, [true, false], {
    exception: { code: 'PARCEL_NOT_FOUND', codeText: '驿站找不到件', text: '驿站暂时没找到这个件', fromStatus: STATUS.ACCEPTED, at: ISO }
  });
  const exceptionExtras = parcelView.pageExtras(EXCEPTION_PARTIAL, {}, caseLib.NOW);
  t.eq([exceptionExtras.pickupSummary, exceptionExtras.pickupPartialHint], ['已取 1/2 件', ''],
    'Q10 异常分支保留件级摘要（已取件事实不隐藏），但「全部取完后进入已取件」提示只在已接单状态给');
  t.eq(progressStates(EXCEPTION_PARTIAL), 'done,exception,future,future,future',
    'Q11 异常分支进度仍按 exception.fromStatus（件级已取不改变订单状态展示）');

  const legacy = caseLib.dto(STATUS.PICKED, {
    parcel: Object.assign({}, caseLib.dto(STATUS.PICKED).parcel, { picked: true, pickedAt: PICKED_AT }),
    parcels: undefined
  });
  t.eq(parcelView.parcelsView(legacy).map(function map(row) { return [row.picked, row.hasPickState]; }),
    [[true, true]], 'Q12 旧单（历史单 parcel 单件 + 服务端派生的 picked/pickedAt）照常显示「已取件 + 取件时间」');
  const legacyMissing = caseLib.dto(STATUS.ACCEPTED, { parcels: undefined });
  t.eq(parcelView.parcelsView(legacyMissing).map(function map(row) { return row.hasPickState; }), [false],
    'Q13 旧 DTO 无件级字段（picked 缺失）→ 件级「已取/待取」行不渲染（不把缺失冒充「待取件」）');
  t.eq([parcelView.pageExtras(legacyMissing, {}, caseLib.NOW).pickupSummary, pickupTag.tagOf(legacyMissing)], ['', ''],
    'Q14 旧 DTO 无 pickedCount/parcelCount → 详情摘要与列表标签都不显示（不猜、不崩）');

  const parcelHasActions = parcelView.pageExtras(PARTIAL, {}, caseLib.NOW).parcels
    .some(function some(row) { return Object.prototype.hasOwnProperty.call(row, 'actions'); });
  t.eq([parcelHasActions, PARTIAL.parcels.every(function every(parcel) { return Array.isArray(parcel.actions) && parcel.actions.length === 0; })],
    [false, true], 'Q15 顾客侧每件 actions 恒空：件级动作不进视图模型（页面零消费件级动作）');
  t.check(parcelView.parcelsView(multiOrder(STATUS.ACCEPTED, [true, false])).every(function every(row) {
    return row.actions === undefined && row.action === undefined;
  }), 'Q16 即使 DTO 夹带件级动作键，顾客端包裹行也不暴露 actions/action（只读渲染）');

  const detailWxml = detailText(caseLib.PAGES.detailWxml);
  const detailJs = detailText(caseLib.PAGES.detail);
  const parcelBlock = detailWxml.slice(detailWxml.indexOf('wx:for="{{parcels}}"'), detailWxml.indexOf('服务类型'));
  t.check(/pickupSummary/.test(detailWxml) && /pickupPartialHint/.test(detailWxml)
    && /item\.pickedText/.test(detailWxml) && /item\.pickedAtText/.test(detailWxml),
  'Q17 详情 WXML 渲染件级已取/待取+时间、部分取件摘要与提示');
  t.check(parcelBlock.length > 0 && parcelBlock.indexOf('bindtap') < 0 && parcelBlock.indexOf('<button') < 0,
    'Q18 详情包裹列表只读：件级区块无 bindtap/button（顾客不能按件操作，D61 动作只在兼职端）');
  t.check(/pageExtras\(payload\.order, this\.data\.config, Date\.now\(\)\)/.test(detailJs),
    'Q19 详情页刷新用页面扩展视图重算件级取件/摘要（数据来源 = DTO，页面零业务判据）');

  const tagCases = [
    [multiOrder(STATUS.ACCEPTED, [false, false, false]), ''],
    [multiOrder(STATUS.ACCEPTED, [true, false, false]), '已取 1/3 件'],
    [multiOrder(STATUS.ACCEPTED, [true, true, false]), '已取 2/3 件'],
    [multiOrder(STATUS.PICKED, [true, true, true]), ''],
    [caseLib.dto(STATUS.ACCEPTED, { parcels: undefined }), ''],
    [multiOrder(STATUS.ACCEPTED, [true, false], { allPicked: true }), '']
  ];
  t.eq(tagCases.map(function map(item) { return pickupTag.tagOf(item[0]); }),
    tagCases.map(function map(item) { return item[1]; }),
    'Q20 列表行标签四态：0/n 不显示、部分「已取 n/m 件」、全取不显示、缺字段（旧 DTO）不显示、allPicked=true 优先全取');
  const partialRow = Object.assign(ordersView.rowView(multiOrder(STATUS.ACCEPTED, [true, false]), {
    nowMs: caseLib.NOW, config: { orderTimeoutMinutes: 120 }
  }), { pickupTag: pickupTag.tagOf(multiOrder(STATUS.ACCEPTED, [true, false])) });
  t.eq([partialRow.pickupTag, partialRow.status], ['已取 1/2 件', STATUS.ACCEPTED],
    'Q21 列表行视图在订单行字段外挂 pickupTag（不改 order-row 组件、不改共享 orders-view）');

  const ordersJs = detailText(caseLib.PAGES.orders);
  const ordersWxml = detailText(caseLib.PAGES.ordersWxml);
  const ordersWxss = detailText('pages/customer/orders/index.wxss');
  t.check(/parts\/pickup-tag/.test(ordersJs) && /pickupTag\.tagOf\(order\)/.test(ordersJs)
    && /item\.pickupTag/.test(ordersWxml) && /\.pickup-tag\s*\{/.test(ordersWxss),
  'Q22 列表标签接线：页面经 parts/pickup-tag 计算、WXML 渲染 item.pickupTag、样式类已定义（门禁 #09）');
  t.eq([caseLib.layerHits(detailText('pkg-customer/pages/order-detail/parts/parcel-view.js')),
    caseLib.layerHits(detailText('pages/customer/orders/parts/pickup-tag.js'))], [[], []],
  'Q23 新增纯件零 wx.cloud/零七状态字面量/零 random/零直调 client.call（页面层零判据）');

  const eventPick = view.buildEvents([{ type: 'PARCEL_PICKED', at: ISO, note: '' }], {})[0].text;
  const eventRevert = view.buildEvents([{ type: 'PARCEL_PICKED_REVERTED', at: ISO, note: '' }], {})[0].text;
  t.eq([eventPick, eventRevert, eventPick.indexOf('PARCEL_PICKED')], ['兼职已取走一件', '兼职撤销了一件已取件', -1],
    'Q24 件级取件事件时间线给通用人话（不出现英文事件名/内部编号；不改变订单状态文案）');
  t.check(view.buildEvents([{ type: 'PARCEL_PICKED', at: ISO, note: '' }], {}).length === 1,
    'Q25 件级取件事件样本非空');

  // ── 展示条件收敛（Lead 裁决：列表标签非终态才显示；详情件级状态/摘要只在履约状态集显示）──
  const terminalTags = [STATUS.CANCELLED, STATUS.COMPLETED].map(function map(status) {
    return pickupTag.tagOf(multiOrder(status, [true, false]));
  });
  t.eq(terminalTags, ['', ''],
    'Q28 终态订单不显示列表「已取 n/m 件」标签：已取消（部分取件后被取消）/已完成 → 空串（不误导还能操作/还有进度）');
  const exceptionTag = multiOrder(STATUS.EXCEPTION, [true, false]);
  t.eq([pickupTag.tagOf(exceptionTag), parcelView.pageExtras(exceptionTag, {}, caseLib.NOW).pickupSummary],
    ['已取 1/2 件', '已取 1/2 件'],
    'Q29 异常中（EXCEPTION）件级进度仍有信息量：列表标签与详情摘要照常显示（只终态隐藏）');
  const PICK_VISIBLE = [STATUS.ACCEPTED, STATUS.PICKED, STATUS.DELIVERED, STATUS.COMPLETED, STATUS.EXCEPTION];
  const statusTable = caseLib.STATUS_LITERALS.map(function map(key) {
    const status = STATUS[key];
    const extras = parcelView.pageExtras(multiOrder(status, [true, false]), {}, caseLib.NOW);
    return [status, extras.pickupSummary, extras.parcels.every(function every(row) { return row.hasPickState; })];
  });
  t.eq(statusTable, caseLib.STATUS_LITERALS.map(function map(key) {
    const status = STATUS[key];
    const show = PICK_VISIBLE.indexOf(status) !== -1;
    return [status, show ? '已取 1/2 件' : '', show];
  }),
  'Q30 详情件级展示条件按状态收敛：SUBMITTED（兼职未接，逐件「待取件」是噪音）/CANCELLED 不出件级「已取/待取」行与 n/m 摘要，其余五状态出');
  t.check(/wx:if="\{\{item\.hasPickState\}\}"/.test(detailWxml)
    && /wx:if="\{\{pickupSummary\}\}"/.test(detailWxml)
    && /wx:if="\{\{pickupPartialHint\}\}"/.test(detailWxml),
  'Q31 详情 WXML 仍只按视图字段 wx:if 渲染（状态展示条件全在纯件内，页面零状态判据）');

  return integrationCheck(t);
}

/**
 * Q26/Q27 端云联调：真实服务端 DTO（handlers/order/_dto.buildOrderDto，side=CUSTOMER，A 的 D61 实现）
 * → 顾客端 parcelView/pickupTag 逐字段消费一致（字段名/类型/pickedAt 毫秒/顾客侧 actions 恒空）。
 */
function integrationCheck(t) {
  const doc = caseLib.orderDoc(STATUS.ACCEPTED, {
    parcels: [
      { stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3021', codeStatus: 'OK', pickedAt: caseLib.DOC_MS },
      { stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3022', codeStatus: 'OK', pickedAt: null }
    ]
  });
  return serverDto.buildOrderDto(caseLib.FAKE_DTO_CTX, doc, { side: 'CUSTOMER' }).then(function apply(dto) {
    const extras = parcelView.pageExtras(dto, {}, caseLib.NOW);
    t.eq([dto.pickedCount, dto.parcelCount, dto.allPicked,
      dto.parcels.map(function map(parcel) { return [parcel.picked, parcel.pickedAt > 0, parcel.actions.length]; })],
    [1, 2, false, [[true, true, 0], [false, false, 0]]],
    'Q26 联调：真实服务端 DTO 下发 pickedCount/parcelCount/allPicked + 每件 picked/pickedAt(ms)/actions（顾客侧恒空）');
    t.eq([extras.pickupSummary, extras.pickupPartialHint,
      extras.parcels[0].pickedText, extras.parcels[0].pickedAtText !== '', extras.parcels[1].pickedText,
      pickupTag.tagOf(dto)],
    ['已取 1/2 件', '已取 1/2 件，全部取完后进入已取件', '已取件', true, '待取件', '已取 1/2 件'],
    'Q27 联调：真实服务端 DTO → 详情摘要/提示/每件只读状态与取件时间、列表标签逐字段一致');
    // 终态如实下发件级进度（服务端不抹数据），但顾客端展示条件收敛 → 标签/摘要都不出（Q28/Q30 的端云版反例）
    const cancelledDoc = caseLib.orderDoc(STATUS.CANCELLED, {
      parcels: [
        { stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3021', codeStatus: 'OK', pickedAt: caseLib.DOC_MS },
        { stationId: 'P3', stationName: '菜鸟驿站-3号楼', pickupCode: '8-2-3022', codeStatus: 'OK', pickedAt: null }
      ]
    });
    return serverDto.buildOrderDto(caseLib.FAKE_DTO_CTX, cancelledDoc, { side: 'CUSTOMER' })
      .then(function apply2(cancelled) {
        t.eq([cancelled.status, cancelled.pickedCount, cancelled.parcelCount,
          pickupTag.tagOf(cancelled), parcelView.pageExtras(cancelled, {}, caseLib.NOW).pickupSummary,
          parcelView.pageExtras(cancelled, {}, caseLib.NOW).parcels.every(function every(row) { return row.hasPickState; })],
        [STATUS.CANCELLED, 1, 2, '', '', false],
        'Q32 联调：真实服务端已取消单（部分取件后被取消）仍下发 pickedCount=1/2，顾客端标签与件级状态/摘要一律不显示');
        return null;
      });
  });
}

module.exports = {
  ASSERTIONS: 32,
  registerQ
};
