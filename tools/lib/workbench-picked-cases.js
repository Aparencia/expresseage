'use strict';
/**
 * tools/lib/workbench-picked-cases.js — selftest-order-workbench 的 N 组用例表（批 25-B，D61/D62）。
 *
 * 覆盖：
 *   N01~N10  D62 多站点分组：一单在每个件站点组各出现一次、行内只列本站件、组头单/件数、
 *            组内四档/码序按本站件计算（整单最差件不再决定本站档位）、今日流水不拆组；
 *   N11~N16  D61 件行：picked/pickedAt 渲染、件动作映射（markPicked/unmarkPicked）、单件单不缩进/不显示
 *            「第 1 件」、单件单件按钮不重复行工具等价动作、READONLY 隐藏；
 *   N17~N22  D61 写请求/文案：itemIndex（首件 0 也传）+ expectedVersion + clientRequestId、免二次确认、
 *            toast 带件号、全部取完「已取 n/m 件」摘要；
 *   N23~N27  多选/批量按订单：跨站单在多个站组出现但勾选/全选/批量队列按 orderNo 去重（不重复执行）、
 *            选中跨站单提示整单作用、批量确认框写明「整单动作将作用于全部件」；
 *   N28~N31  页面接线静态：WXML 件行渲染 + onPieceAction/onCopyPieceCode 接线 + readonly 守卫、
 *            piece-flow 走 orderApi（非 client.call）、无二次确认（无 wx.showModal）。
 *
 * 非独立套件：由 tools/selftest-order-workbench require（拆出以控测试文件 ≤1000 行，门禁 #18；
 * tools/lib 不参与 selftest 注册完整性闸，先例 tools/lib/workbench-day-cases.js）。
 * 纪律：先合法基线再反例；样本非空；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '../..');

// 实际断言数（N01~N31 + G 联调另计）；与实际不相符由 harness 完整性闸判红
const EXPECTED_ASSERTIONS = 33;

const ISO = '2026-11-02T02:00:00.000Z';
const NOW = Date.parse(ISO);

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function textOfFile(rel) {
  return fsutil.readText(path.join(ROOT, rel));
}

function strippedOf(rel) {
  return fsutil.stripComments(textOfFile(rel));
}

// 逐件夹具：字段形状 = A 侧冻结契约（picked/pickedAt(毫秒)/actions[]）
function parcelOf(stationId, stationName, pickupCode, extra) {
  const base = {
    itemIndex: 0,
    stationId: stationId,
    stationName: stationName,
    pickupCode: pickupCode,
    lockerNo: '',
    trackingTail: '',
    codeStatus: 'OK',
    codeStatusText: '已补全',
    picked: false,
    pickedAt: 0,
    actions: ['markPicked']
  };
  return Object.assign(base, extra || {});
}

// D61+D62 基准单：ACCEPTED、3 件 / 2 站、第 1 件已取（件级），订单级动作仍是整单键
function pickedOrder(extra) {
  const base = {
    orderNo: 'N-1001',
    status: 'ACCEPTED',
    statusText: '已接单',
    bucket: 'accepted',
    version: 7,
    source: 'CUSTOMER',
    pickedCount: 1,
    parcelCount: 3,
    allPicked: false,
    parcels: [
      parcelOf('P4', '北部菜鸟驿站', '27-2-7016', {
        itemIndex: 0,
        lockerNo: '3号柜',
        picked: true,
        pickedAt: Date.parse('2026-11-02T01:40:00.000Z'),
        actions: ['unmarkPicked']
      }),
      parcelOf('P4', '北部菜鸟驿站', '27-2-7017', { itemIndex: 1, actions: ['markPicked'] }),
      parcelOf('P6', '南苑菜鸟驿站', '109-2-3003', { itemIndex: 2, actions: ['markPicked'] })
    ],
    actions: [
      { key: 'pick', label: '标记已取件' },
      { key: 'exception', label: '上报异常' },
      { key: 'correct', label: '改取件码' },
      { key: 'cancel', label: '取消订单' }
    ],
    dorm: { buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    counterpart: { displayName: '小王' },
    phoneTail: '6678',
    needCode: false,
    statusUpdatedAt: ISO,
    updatedAt: ISO,
    createdAt: ISO
  };
  return Object.assign(base, extra || {});
}

function unpickedOrder(orderNo, parcels, extra) {
  const base = pickedOrder({
    orderNo: orderNo,
    parcelCount: parcels.length,
    pickedCount: 0,
    allPicked: false,
    parcels: parcels,
    status: 'ACCEPTED'
  });
  return Object.assign(base, extra || {});
}

function pickedChecks(t, deps) {
  const parcelView = deps.parcelView;
  const groupView = deps.groupView;
  const pieceActions = deps.pieceActions;
  const selectionFlow = deps.selectionFlow;
  const batchView = deps.batchView;
  const loadView = deps.loadView;
  const order = pickedOrder();

  // ── N01~N10 D62 按件站点分组 ─────────────────────────────────────────────
  const groups = groupView.buildGroups([order], NOW);
  t.eq(groups.map((group) => group.stationId), ['P4', 'P6'],
    'N01 D62 一单出现在每个件站点组（P4 + P6 两组，不再只归首件组）');
  const p4 = groups[0];
  const p6 = groups[1];
  t.eq([p4.rows[0].pieceRows.length, p6.rows[0].pieceRows.length], [2, 1],
    'N02 行内只列本站件（P4 行 2 件 / P6 行 1 件）');
  t.eq([p4.rows[0].otherPiecesText, p6.rows[0].otherPiecesText],
    ['另 1 件在 P6', '另 2 件在 P4'], 'N03 行内标注「另 N 件在 Pn」（本站件之外的落点）');
  t.eq([p4.rows[0].stationId, p6.rows[0].stationId], ['P4', 'P6'],
    'N04 组内行归属本站（批量/全选本站按组定位）');
  t.eq([p4.rows[0].parcelCount, p4.rows[0].parcelCountText, p4.rows[0].pickedSummaryText],
    [3, '3 件', '已取 1/3 件'], 'N05 行摘要=整单视角（件数/已取 n/m 件跨站合计，不按本站件缩水）');
  t.eq([p4.count, p4.pieceCount, p4.countText], [1, 2, '1 单 · 2 件'],
    'N06 组头单数为主、件数不同才补（D62 组头计数口径）');
  t.eq(groups.map((group) => group.pieceCount).reduce((sum, value) => sum + value, 0), 3,
    'N07 各组本站件数之和 = 订单总件数（每件只落一个站点组，不重不漏）');

  // N08 组内四档/码序按本站件：整单最差件（P6 需查明）不得把 P4 行拉到需查明档
  const crossNeed = unpickedOrder('N-2001', [
    parcelOf('P4', '北部菜鸟驿站', '6001', { itemIndex: 0 }),
    parcelOf('P6', '南苑菜鸟驿站', '', {
      itemIndex: 1, codeStatus: 'NEED_CODE', codeStatusText: '需查明', actions: ['markPicked']
    })
  ], { needCode: true });
  const lockerOrder = unpickedOrder('N-2002', [
    parcelOf('P4', '北部菜鸟驿站', '3003', { itemIndex: 0, lockerNo: '5号柜' })
  ]);
  const sorted = groupView.buildGroups([crossNeed, lockerOrder], NOW);
  const p4Sorted = sorted.filter((group) => group.stationId === 'P4')[0];
  t.eq(p4Sorted.rows.map((row) => row.orderNo), ['N-2002', 'N-2001'],
    'N08 组内四档按本站件：P4 行（无本地需查明/无柜）排在 P4 快递柜行之后（整单最差件不再决定本站档）');
  t.eq(sorted.filter((group) => group.stationId === 'P6')[0].rows[0].orderNo, 'N-2001',
    'N09 需查明件所属的 P6 组按需查明档置顶（组内排序只看本站件）');
  const dayGroups = groupView.buildDayGroups([order], NOW);
  t.eq([dayGroups.length, dayGroups[0].rows[0].pieceRows.length, dayGroups[0].rows[0].otherPiecesText],
    [1, 3, ''], 'N10 今日流水单组平铺：行内列全部件、无站点组「另 N 件」提示（D53 口径不被 D62 拆开）');

  // ── N11~N16 D61 件行与动作映射 ────────────────────────────────────────────
  const p4Row = p4.rows[0];
  const pickedPiece = p4Row.pieceRows[0];
  const unpickedPiece = p4Row.pieceRows[1];
  t.eq([pickedPiece.picked, pickedPiece.pickedText, pickedPiece.pickedAtText],
    [true, '已取', '09:40'], 'N11 件行带已取状态 + 取件时间（deps.pickedAt 毫秒→HH:MM）');
  t.eq([unpickedPiece.picked, unpickedPiece.pickedText], [false, '待取'], 'N12 未取件显示待取（不吃整单聚合假已取）');
  t.eq([pickedPiece.action.key, pickedPiece.action.label, pickedPiece.action.method],
    ['unmarkPicked', '撤销已取', 'unmarkPicked'], 'N13 已取件动作=撤销已取（只消费服务端 parcel.actions）');
  t.eq([unpickedPiece.action.key, unpickedPiece.action.label], ['markPicked', '已取件'],
    'N14 未取件动作=已取件；动作键→请求方法/文案翻译在纯件');
  t.eq([p4Row.pieceIndent, p4Row.pieceRows[0].showIndex, p4Row.pieceRows[0].indexText],
    [true, true, '第 1 件'], 'N15 多件单缩进 + 显示「第 n 件」');
  const single = unpickedOrder('N-1002', [
    parcelOf('P4', '北部菜鸟驿站', '889900', { itemIndex: 0, actions: ['markPicked'] })
  ], { pickedCount: 0, parcelCount: 1, allPicked: false });
  const singleRow = groupView.buildGroups([single], NOW)[0].rows[0];
  t.eq([singleRow.parcelCount, singleRow.pieceIndent, singleRow.pieceRows.length,
    singleRow.pieceRows[0].showIndex, singleRow.pieceRows[0].action],
    [1, false, 1, false, null],
  'N16 单件单不缩进、不显示「第 1 件」；件按钮与行工具等价动作不重复渲染（pick 已覆盖）');

  // ── N17~N22 写请求形状 / 免二次确认 / 文案 ───────────────────────────────
  const write = pieceActions.writeOf('markPicked', p4Row.pieceRows[1], order.orderNo, order.version, 'PID0000000000000000001');
  t.eq([write.method, write.payload.orderNo, write.payload.itemIndex],
    ['markPicked', 'N-1001', 1], 'N17 件级写请求带 orderNo + itemIndex（首件 0 也显式传，不与整单动作混淆）');
  t.eq([write.opts.expectedVersion, write.opts.clientRequestId], [7, 'PID0000000000000000001'],
    'N18 件级写请求带 expectedVersion（乐观锁）+ 幂等键 clientRequestId');
  const undoWrite = pieceActions.writeOf('unmarkPicked', p4Row.pieceRows[0], order.orderNo, order.version, 'PID0000000000000000002');
  t.eq([undoWrite.method, undoWrite.payload.itemIndex], ['unmarkPicked', 0],
    'N19 撤销已取同样逐件带 itemIndex（首件 0 不省略）');
  t.eq([pieceActions.writeOf('markPicked', p4Row.pieceRows[1], 'N-1001', 0, '').opts.expectedVersion,
    pieceActions.writeOf('unknown', p4Row.pieceRows[1], 'N-1001', 7, 'x')],
  [undefined, null], 'N20 version=0 不带乐观锁、未知动作键不构造请求（返回 null 由页面兜底）');
  t.eq([pieceActions.toastOf('markPicked', p4Row.pieceRows[1]), pieceActions.toastOf('unmarkPicked', p4Row.pieceRows[0])],
    ['第 2 件已取件', '第 1 件已撤销已取'], 'N21 免二次确认的成功文案带件号（说清哪一件变了）');
  const allPicked = pickedOrder({
    pickedCount: 3,
    allPicked: true,
    parcels: [
      parcelOf('P4', '北部菜鸟驿站', '1-1', { itemIndex: 0, picked: true, actions: ['unmarkPicked'] }),
      parcelOf('P4', '北部菜鸟驿站', '1-2', { itemIndex: 1, picked: true, actions: ['unmarkPicked'] }),
      parcelOf('P6', '南苑菜鸟驿站', '1-3', { itemIndex: 2, picked: true, actions: ['unmarkPicked'] })
    ]
  });
  t.eq(groupView.buildGroups([allPicked], NOW)[0].rows[0].pickedSummaryText, '已取 3/3 件',
    'N22 全部取完摘要「已取 3/3 件」（订单状态由服务端聚合，客户端不自行判 PICKED）');

  // ── N23~N27 多选/批量仍按订单（D62 不重复执行）────────────────────────────
  const selected = selectionFlow.selectAll(groups);
  t.eq([selected.selectedCount, selected.selectableCount], [1, 1],
    'N23 跨站单在 2 个站点组出现，全选仍按订单计 1 单（不重复计数）');
  const selectedBoth = selected.groups.every((group) => group.rows[0].selected === true);
  t.eq(selectedBoth, true, 'N24 选中态落到该单的每个站点组行（视图一致，不出现半选）');
  const toggle = selectionFlow.toggleRow(groups, order.orderNo);
  t.eq([toggle.ok, toggle.hint], [true, '该单在其他站点还有件，整单操作将作用于全部件'],
    'N25 选中跨站单提示整单作用（批量动作按订单，作用于全部件）');
  const plan = batchView.plan('pick', groupView.selectedRows(selected.groups), { batchActionId: 'BID0000000000000000001' });
  t.eq([plan.queue.length, plan.crossStationCount], [1, 1],
    'N26 批量队列按 orderNo 去重（跨站单只执行一次），并记录跨站单数');
  t.check(plan.confirmText.indexOf('整单动作将作用于全部件') !== -1
    && plan.confirmText.indexOf('将 1 单（共 3 件）') !== -1,
  'N27 批量确认框写明整单语义与整单件数（3 件，不是本站 2 件）');
  const rowPickConfirm = deps.rowActions.confirmTextOf('pick', p4.rows[0]);
  const singlePickConfirm = deps.rowActions.confirmTextOf('pick', singleRow);
  t.check(rowPickConfirm.indexOf('本单 3 件一起标记为已取件') !== -1
    && singlePickConfirm === '将 1 件标记为已取件，顾客会看到「已取件·配送中」。',
  'N27b 订单级「已取件」确认文案按整单件数说真话（多件单不写「1 件」；单件单原文案不变）');

  // ── N28~N31 页面接线静态 ──────────────────────────────────────────────────
  const wxml = textOfFile('pages/partner/workbench/index.wxml');
  t.check(wxml.indexOf('row.pieceRows') !== -1 && wxml.indexOf('catchtap="onPieceAction"') !== -1
    && wxml.indexOf('onCopyPieceCode') !== -1,
  'N28 WXML 渲染件行并接线件动作/取件码复制（catchtap 阻止冒泡到整行）');
  t.check(wxml.indexOf('!readonly && piece.action') !== -1 && wxml.indexOf('row.pickedSummaryText') !== -1
    && wxml.indexOf('row.otherPiecesText') !== -1,
  'N29 WXML 只读隐藏件写按钮 + 渲染「已取 n/m 件」与「另 N 件在 Pn」');
  const flowSrc = strippedOf('pages/partner/workbench/parts/piece-flow.js');
  t.check(flowSrc.indexOf('pieceActions.writeOf(') !== -1 && flowSrc.indexOf('orderApi[write.method]') !== -1
    && flowSrc.indexOf('client.createRequestId()') !== -1 && flowSrc.indexOf('this.data.readonly') !== -1,
  'N30 件动作接线：只读先挡 → 纯件构造请求（itemIndex/幂等键）→ 经 orderApi 写 → 重拉');
  t.check(flowSrc.indexOf('showModal') === -1 && flowSrc.indexOf('wx.showModal') === -1,
    'N31 逐件动作免二次确认（不弹 wx.showModal；可撤销，D61 口径）');
  t.notEmpty([groups, plan, pieceActions], 'N 组样本非空');
}

module.exports = { EXPECTED_ASSERTIONS, pickedChecks };
