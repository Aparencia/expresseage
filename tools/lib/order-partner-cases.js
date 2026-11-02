'use strict';
/**
 * tools/lib/order-partner-cases.js — selftest-order-partner 的用例表（A 段 listPartner 工作台 + I 段 D61 件级取件）。
 *
 * 为什么拆：门禁 #18「tools 单文件 ≤1000 行」——selftest-order-partner.js 已近满闸；A 段 31 条断言
 *   （响应形/counts 六项/视图/counts 稳定/keyword 含越窗命中/翻页/行内 actions[]/DTO 白名单/
 *   listCustomer 只增不改/CLOSED·SUSPENDED/isTest 隔离）与 I 段 D61 件级取件断言逐条外移，
 *   主套件保留 B~H 断言段落。
 * 非独立套件：由 tools/selftest-order-partner.js require 后在其对应 section 内调用
 *   （tools/lib 不参与 selftest 注册完整性闸）。
 * 口径：期望值逐字来自 docs/contract/V4_CONTRACT.md §5/§5.1（D61）、docs/data/V4_DATA_MODEL.md §2.5/§4.1/§8.4。
 */
const path = require('path');
const cases = require('../selftest-order-partner-cases');

const listPartnerHandler = require(path.join(cases.API, 'handlers/order/listPartner.js'));

const {
  NOW, HOUR, DAY, C1, P1, TEST_P, TEST_PID, COUNTS_KEYS, DTO_ROW_KEYS, DTO_BANNED_KEYS,
  ROLES, PARTNER_STATUS, VIEW_MODE, CODE_STATUS, SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED,
  CANCELLED, EXCEPTION, apiOf, handlerCtxOf, orderDoc, world, pickRow, actionKeysOf,
  collectKeyPaths, expectCode, expectField, rowOf, eventsFor, nextCrid, iso
} = cases;

async function listPartnerChecks(t) {
  const db = world();
  db.seed('orders', [
    orderDoc('20261022-0001', SUBMITTED, { statusUpdatedAt: new Date(NOW - 500) }),
    orderDoc('20261022-0002', ACCEPTED, { statusUpdatedAt: new Date(NOW - 600), acceptedAt: new Date(NOW - 4000) }),
    orderDoc('20261022-0003', PICKED, {
      statusUpdatedAt: new Date(NOW - 700), acceptedAt: new Date(NOW - 4000), pickedAt: new Date(NOW - 2000)
    }),
    orderDoc('20261022-0004', PICKED, {
      statusUpdatedAt: new Date(NOW - 800), acceptedAt: new Date(NOW - 40000), pickedAt: new Date(NOW - 20000)
    }),
    orderDoc('20261022-0005', DELIVERED, {
      statusUpdatedAt: new Date(NOW - 900), acceptedAt: new Date(NOW - 4000),
      pickedAt: new Date(NOW - 3000), deliveredAt: new Date(NOW - 900)
    }),
    orderDoc('20261022-0006', EXCEPTION, {
      statusUpdatedAt: new Date(NOW - 1000), acceptedAt: new Date(NOW - 5000),
      exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 1000) }
    }),
    orderDoc('20261022-0007', COMPLETED, {
      statusUpdatedAt: new Date(NOW - 2000), completedAt: new Date(NOW - 2000)
    }),
    orderDoc('20261022-0008', COMPLETED, {
      statusUpdatedAt: new Date(NOW - DAY - 3 * HOUR), completedAt: new Date(NOW - DAY - 3 * HOUR)
    }),
    orderDoc('20261022-0009', CANCELLED, {
      statusUpdatedAt: new Date(NOW - 3000), cancelledAt: new Date(NOW - 3000),
      cancelReason: 'CHANGED_MIND', cancelledBy: ROLES.CUSTOMER
    }),
    orderDoc('20261022-0010', COMPLETED, { isTest: true, statusUpdatedAt: new Date(NOW - 1000), completedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-0011', SUBMITTED, {
      statusUpdatedAt: new Date(NOW - 1500), customerId: '', customerOpenid: '', customerNo: '',
      source: 'PARTNER', phoneTail: '5678', dorm: null,
      guest: { displayName: '代客小张', phoneTail: '5678', zone: 'X', buildingNo: 2, buildingText: 'X2', room: '301', dormKey: 'X2-301' }
    }),
    orderDoc('20260901-0001', SUBMITTED, {
      statusUpdatedAt: new Date(NOW - 50 * DAY), createdAt: new Date(NOW - 50 * DAY),
      parcel: { pickupCode: 'OLD99' }
    })
  ]);
  const pApi = apiOf(db, P1);
  const cApi = apiOf(db, C1);

  const workbench = await pApi.call('order.listPartner', { view: 'workbench' });
  t.eq(Object.keys(workbench.data || {}).sort(), ['counts', 'list', 'nextCursor', 'summary'],
    'A1 listPartner 工作台响应顶层键 = counts/list/nextCursor/summary（summary 只增、无 groups/raw）');
  t.eq(Object.keys(workbench.data.counts).sort(), COUNTS_KEYS.slice().sort(),
    'A2 counts 恰为六项（submitted/accepted/picked/delivered/exception/todayCompleted）');
  t.eq(workbench.data.counts, {
    submitted: 3, accepted: 1, picked: 2, delivered: 1, exception: 1, todayCompleted: 1
  }, 'A3 counts 六项逐值精确（含 guest/历史单；测试单与昨日完成不计入）');
  const activeNos = workbench.data.list.map((row) => row.orderNo);
  t.eq(activeNos, ['20261022-0001', '20261022-0002', '20261022-0003', '20261022-0004',
    '20261022-0005', '20261022-0006', '20261022-0011', '20260901-0001'],
  'A4 workbench 只含进行中五态（不含 COMPLETED/CANCELLED），按 statusUpdatedAt desc');

  const filtered = await pApi.call('order.listPartner', {
    view: 'workbench', status: PICKED, keyword: '不存在的搜索词'
  });
  t.eq([filtered.data.list.length, filtered.data.counts], [0, workbench.data.counts],
    'A5 counts 为全量口径：不受 status/keyword 筛选影响（与列表同响应下发）');

  const history = await pApi.call('order.listPartner', { view: 'history' });
  t.eq(history.data.list.map((row) => row.orderNo), ['20261022-0007', '20261022-0009', '20261022-0008'],
    'A6 history 视图只含 COMPLETED/CANCELLED，按 statusUpdatedAt desc');
  t.eq(history.data.list.every((row) => actionKeysOf(row).length === 0), true,
    'A7 history 行不下发 actions（工作台行级快捷操作只服务 workbench，不扩大历史页面）');

  const byPick = await pApi.call('order.listPartner', { view: 'workbench', status: PICKED });
  t.eq(byPick.data.list.map((row) => row.orderNo), ['20261022-0003', '20261022-0004'],
    'A8 status 过滤生效（PICKED 两单，状态内按 statusUpdatedAt desc）');

  const byCode = await pApi.call('order.listPartner', { view: 'workbench', keyword: 'old99' });
  t.eq(byCode.data.list.map((row) => row.orderNo), ['20260901-0001'],
    'A9 keyword 命中取件码（大小写不敏感）');

  const byGuest = await pApi.call('order.listPartner', { view: 'workbench', keyword: '代客' });
  t.eq(byGuest.data.list.map((row) => row.orderNo), ['20261022-0011'],
    'A10 keyword 命中代客单 guest.displayName（工作台搜索含「称呼」）');

  await expectField(t, pApi.call('order.listPartner', { view: 'workbench', keyword: 'x'.repeat(41) }),
    'VALIDATION_FAILED', 'keyword', 'A11 keyword 超 40 字 → VALIDATION_FAILED 且 data.field=keyword');
  await expectField(t, pApi.call('order.listPartner', { view: 'bogus' }), 'VALIDATION_FAILED', 'view',
    'A12 非法 view → VALIDATION_FAILED 且 data.field=view');

  const pageNos = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const page = await pApi.call('order.listPartner', { view: 'workbench', limit: 2, cursor });
    page.data.list.forEach((row) => pageNos.push(row.orderNo));
    cursor = page.data.nextCursor;
    pages += 1;
    if (!cursor || pages > 10) {
      break;
    }
  }
  t.eq([pageNos, new Set(pageNos).size], [activeNos, activeNos.length],
    'A13 limit=2 游标翻页不重不漏（两页合计=全量且顺序一致）');

  const rowSub = pickRow(workbench.data.list, '20261022-0001');
  const rowAcc = pickRow(workbench.data.list, '20261022-0002');
  const rowPick = pickRow(workbench.data.list, '20261022-0003');
  const rowPickOld = pickRow(workbench.data.list, '20261022-0004');
  const rowDeliver = pickRow(workbench.data.list, '20261022-0005');
  const rowException = pickRow(workbench.data.list, '20261022-0006');
  t.check(workbench.data.list.every((row) => Array.isArray(row.actions) && row.actions.length > 0),
    'A14 workbench 每行内联 actions[] 非空（行级操作只消费服务端动作，前端不自行判定状态机）');
  t.eq(actionKeysOf(rowSub), ['accept', 'cancel', 'correct', 'message', 'reject'],
    'A15 SUBMITTED 行动作集（接单/拒单/补码/取消/留言）');
  t.eq(actionKeysOf(rowAcc), ['cancel', 'correct', 'exception', 'message', 'pick'],
    'A16 ACCEPTED 行动作集（已取件/异常/改码/取消/留言）');
  t.eq(actionKeysOf(rowPick), ['cancel', 'correct', 'deliver', 'exception', 'message', 'undoPick'],
    'A17 PICKED 行动作集含 5s 窗内 undoPick');
  t.eq(actionKeysOf(rowPickOld).indexOf('undoPick'), -1,
    'A18 超出 5s 窗的 PICKED 行不再广告 undoPick（窗口判定逐行）');
  t.eq(actionKeysOf(rowDeliver), ['cancel', 'exception', 'message', 'undoDeliver'],
    'A19 DELIVERED 行动作集含 undoDeliver、且不广告非法 correct（DELIVERED 不可补码）');
  t.eq(actionKeysOf(rowException), ['cancel', 'correct', 'message', 'resolve'],
    'A20 EXCEPTION 行动作集（解除异常/补码/取消/留言）');

  const detail = await pApi.call('order.get', { orderNo: '20261022-0005' });
  t.eq(actionKeysOf(detail.data.order), actionKeysOf(rowDeliver),
    'A21 同单详情与工作台行动作集一致（GET 与 LIST 同源矩阵）');
  t.eq(workbench.data.list.filter((row) => row.actions.some((item) => !item.label)).length, 0,
    'A22 行动作逐项带中文 label（页面零文案硬编码）');
  t.eq(workbench.data.list.map((row) => collectKeyPaths(row, DTO_BANNED_KEYS, '', [])).reduce((a, b) => a.concat(b), []),
    [], 'A23 工作台列表 DTO 递归零内部键（_id/openid/partnerId/requestKey/fileId/batchActionId…）');
  const extraKeys = [];
  workbench.data.list.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (DTO_ROW_KEYS.indexOf(key) < 0) {
        extraKeys.push(key);
      }
    });
  });
  t.eq(extraKeys, [], 'A24 行 DTO 顶层键全部在白名单（无 raw 文档字段泄漏）');

  const customerList = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS' });
  t.eq([customerList.data.list.length,
    customerList.data.list.every((row) => actionKeysOf(row).length === 0)],
  [7, true], 'A25 listCustomer「只增不改」：行 DTO 不新增 actions 内联（仍为空数组）');

  const oldTargetDb = world();
  const filler = [];
  for (let i = 0; i < 70; i += 1) {
    filler.push(orderDoc('20261022-5' + String(i).padStart(3, '0'), SUBMITTED,
      { statusUpdatedAt: new Date(NOW - i * 1000) }));
  }
  oldTargetDb.seed('orders', filler.concat([orderDoc('20260801-0001', SUBMITTED, {
    statusUpdatedAt: new Date(NOW - 80 * DAY),
    parcel: { pickupCode: 'FAR77' }
  })]));
  const farHit = await apiOf(oldTargetDb, P1).call('order.listPartner', {
    view: 'workbench', keyword: '20260801-0001'
  });
  t.eq(farHit.data.list.map((row) => row.orderNo), ['20260801-0001'],
    'A26 完整订单号命中扫描窗之外的旧单（索引精确查询兜底，不再被 300 条窗口截断漏单）');

  const closedDb = world({ partnerStatus: PARTNER_STATUS.CLOSED });
  await expectCode(t, apiOf(closedDb, P1).call('order.listPartner', { view: 'workbench' }), 'PARTNER_CLOSED',
    'A27 CLOSED 兼职查工作台 → PARTNER_CLOSED（停用/注销不返回业务数据）');
  const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED });
  await expectCode(t, apiOf(suspendedDb, P1).call('order.listPartner', { view: 'workbench' }), 'PARTNER_CLOSED',
    'A28 SUSPENDED 兼职查工作台 → PARTNER_CLOSED');
  await expectCode(t, cApi.call('order.listPartner', { view: 'workbench' }), 'FORBIDDEN',
    'A29 顾客调 order.listPartner → FORBIDDEN（仅兼职身份可查工作台）');

  const isoDb = world();
  isoDb.seed('orders', [
    orderDoc('20261022-6001', SUBMITTED),
    orderDoc('20261022-6002', COMPLETED, { completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-6003', SUBMITTED, { isTest: true, partnerId: TEST_PID, partnerOpenid: TEST_P }),
    orderDoc('20261022-6004', COMPLETED, {
      isTest: true, partnerId: TEST_PID, partnerOpenid: TEST_P,
      completedAt: new Date(NOW - 1000), statusUpdatedAt: new Date(NOW - 1000)
    })
  ]);
  const realView = await apiOf(isoDb, P1).call('order.listPartner', { view: 'workbench' });
  t.eq([realView.data.list.map((row) => row.orderNo), realView.data.counts],
    [['20261022-6001'], { submitted: 1, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 1 }],
  'A30 真实会话：测试单不进列表也不进 counts（isTest 隔离）');
  const testView = await listPartnerHandler(
    handlerCtxOf(isoDb, TEST_P, { role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, developerNo: 'DEV-01' }),
    { view: 'workbench' }
  );
  t.eq([testView.list.map((row) => row.orderNo), testView.counts],
    [['20261022-6003'], { submitted: 1, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 1 }],
  'A31 TEST_WRITE 会话：只见测试单，counts 也独立成口径');
}

// ---------------------------------------------------------------- I 段：D61 件级取件（服务端）
// 冻结契约（CONTRACT §5/§5.1 D61）：件级 pickedAt/pickedByNo 落库；markPicked/unmarkPicked 可选 itemIndex；
// 订单 PICKED 由「全部件已取」聚合派生；DTO pickedCount/parcelCount/allPicked + 每件 picked/pickedAt/actions；
// 旧单无件级字段按订单状态派生（无数据迁移）；事件 PARCEL_PICKED / PARCEL_PICKED_REVERTED。
function pieceOf(extra) {
  return Object.assign({
    stationId: 'P1', stationName: 'P1 一号站', pickupCode: 'A11111', lockerNo: '', trackingTail: '',
    codeStatus: CODE_STATUS.OK, recognitionSource: 'RULE', confidence: 'HIGH'
  }, extra || {});
}

// 新形态多件单（parcels[]；删掉 orderDoc 的 legacy parcel{} 兼容键，避免双形态混淆）
function parcelOrderOf(orderNo, status, parcels, extra) {
  const doc = orderDoc(orderNo, status, Object.assign({ parcels }, extra || {}));
  delete doc.parcel;
  return doc;
}

function pickedEventOf(db, orderNo, type) {
  return eventsFor(db, orderNo).filter((event) => event.type === type)[0] || {};
}

async function parcelPickChecks(t) {
  const db = world();
  db.seed('orders', [
    parcelOrderOf('20261022-0901', ACCEPTED, [pieceOf(), pieceOf({ pickupCode: 'A22222' }),
      pieceOf({ pickupCode: 'A33333' })], { acceptedAt: new Date(NOW - 3000) }),
    parcelOrderOf('20261022-0902', ACCEPTED, [pieceOf(), pieceOf({ pickupCode: '', codeStatus: CODE_STATUS.NEED_CODE })],
      { acceptedAt: new Date(NOW - 3000) }),
    parcelOrderOf('20261022-0903', ACCEPTED, [pieceOf({ pickupCode: '', codeStatus: CODE_STATUS.NEED_CODE })],
      { acceptedAt: new Date(NOW - 3000), service: { code: 'DROP_OFF', name: '代寄快递' } }),
    parcelOrderOf('20261022-0905', ACCEPTED, [pieceOf(), pieceOf({ pickupCode: 'A55555' })],
      { acceptedAt: new Date(NOW - 3000) }),
    parcelOrderOf('20261022-0917', PICKED, [pieceOf(), pieceOf({ pickupCode: 'A77777' })],
      { acceptedAt: new Date(NOW - 5000), pickedAt: new Date(NOW - 2000) }),
    parcelOrderOf('20261022-0918', ACCEPTED, [pieceOf(), pieceOf({ pickupCode: 'A88888' })],
      { acceptedAt: new Date(NOW - 3000) }),
    // 旧单（无件级 pickedAt 自有属性）：单 parcel{} 形态 + 七状态派生矩阵
    orderDoc('20261022-0906', ACCEPTED, { acceptedAt: new Date(NOW - 3000) }),
    orderDoc('20261022-0911', PICKED, { acceptedAt: new Date(NOW - 5000), pickedAt: new Date(NOW - 4000) }),
    orderDoc('20261022-0912', DELIVERED, {
      acceptedAt: new Date(NOW - 6000), pickedAt: new Date(NOW - 5000), deliveredAt: new Date(NOW - 4000)
    }),
    orderDoc('20261022-0913', COMPLETED, {
      acceptedAt: new Date(NOW - 7000), pickedAt: new Date(NOW - 6000),
      deliveredAt: new Date(NOW - 5000), completedAt: new Date(NOW - 4000)
    }),
    orderDoc('20261022-0914', EXCEPTION, {
      acceptedAt: new Date(NOW - 6000), pickedAt: new Date(NOW - 5000),
      exception: {
        code: 'CABINET_ERROR', text: '柜门故障', fromStatus: PICKED, by: ROLES.PARTNER, at: new Date(NOW - 4000)
      }
    }),
    orderDoc('20261022-0915', EXCEPTION, {
      acceptedAt: new Date(NOW - 6000),
      exception: {
        code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 4000)
      }
    }),
    orderDoc('20261022-0916', ACCEPTED, { acceptedAt: new Date(NOW - 2000) })
  ]);
  const pApi = apiOf(db, P1);
  const cApi = apiOf(db, C1);

  // 基线 + 逐件取件聚合
  const before = (await pApi.call('order.get', { orderNo: '20261022-0901' })).data.order;
  t.eq([before.pickedCount, before.parcelCount, before.allPicked], [0, 3, false],
    'I1 基线：3 件单未取 → pickedCount=0 / parcelCount=3 / allPicked=false');
  t.eq([before.parcels[0].picked, before.parcels[0].pickedAt, before.parcels[0].actions],
    [false, 0, ['markPicked']],
    'I2 件级 DTO：picked=false / pickedAt=0（毫秒）/ actions=["markPicked"]（ACCEPTED 未取件）');
  t.eq(before.parcels.map((parcel) => parcel.actions[0]), ['markPicked', 'markPicked', 'markPicked'],
    'I3 每件各自动作（逐件独立入口，订单级 actions 语义不变）');

  const first = await pApi.call('order.markPicked', { orderNo: '20261022-0901', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-pick0') });
  const row0 = rowOf(db, '20261022-0901');
  t.eq([first.ok, first.data.order.status, row0.status, row0.pickedAt], [true, ACCEPTED, ACCEPTED, null],
    'I4 第 1/3 件取件：部分取件不推进订单状态（仍 ACCEPTED、订单 pickedAt 不写）');
  t.eq([new Date(row0.parcels[0].pickedAt).getTime(), row0.parcels[0].pickedByNo, row0.parcels[1].pickedAt],
    [NOW, 'PAAAAAA', null],
    'I5 件级落库：parcels[0].pickedAt=server now + pickedByNo=兼职编号快照；未操作件显式 null');
  const afterFirst = (await pApi.call('order.get', { orderNo: '20261022-0901' })).data.order;
  t.eq([afterFirst.pickedCount, afterFirst.allPicked,
    afterFirst.parcels[0].pickedAt, afterFirst.parcels[0].actions, afterFirst.parcels[1].actions],
  [1, false, NOW, ['unmarkPicked'], ['markPicked']],
  'I6 DTO 聚合与动作矩阵：1/3、已取件给撤销、未取件给取件');
  const event0 = pickedEventOf(db, '20261022-0901', 'PARCEL_PICKED');
  t.eq([event0.type, event0.fromStatus, event0.toStatus, event0.payload],
    ['PARCEL_PICKED', ACCEPTED, ACCEPTED, { itemIndex: 0 }],
    'I7 部分取件事件 PARCEL_PICKED（from=to=ACCEPTED，payload={itemIndex:0}）');

  await pApi.call('order.markPicked', { orderNo: '20261022-0901', itemIndex: 1 },
    { clientRequestId: nextCrid('d61-pick1') });
  const second = (await pApi.call('order.get', { orderNo: '20261022-0901' })).data.order;
  t.eq([second.status, second.pickedCount, second.allPicked], [ACCEPTED, 2, false],
    'I8 第 2/3 件：pickedCount=2、allPicked=false、订单仍 ACCEPTED');
  const last = await pApi.call('order.markPicked', { orderNo: '20261022-0901', itemIndex: 2 },
    { clientRequestId: nextCrid('d61-pick2') });
  const rowAll = rowOf(db, '20261022-0901');
  t.eq([last.ok, last.data.order.status, new Date(rowAll.pickedAt).getTime()], [true, PICKED, NOW],
    'I9 最后一件取完：订单聚合转 PICKED 并写订单级 pickedAt');
  const eventLast = pickedEventOf(db, '20261022-0901', 'PICKED');
  t.eq([eventLast.payload, eventLast.fromStatus, eventLast.toStatus],
    [{ itemIndex: 2, lastParcel: true }, ACCEPTED, PICKED],
    'I10 最后一件写 PICKED 事件 payload={itemIndex,lastParcel:true}（ACCEPTED → PICKED）');
  const afterAll = (await pApi.call('order.get', { orderNo: '20261022-0901' })).data.order;
  t.eq([afterAll.pickedCount, afterAll.parcelCount, afterAll.allPicked,
    afterAll.parcels.map((parcel) => parcel.actions[0])],
  [3, 3, true, ['unmarkPicked', 'unmarkPicked', 'unmarkPicked']],
  'I11 全部件已取：allPicked=true、每件动作=撤销已取');

  // 逐件撤销：PICKED → ACCEPTED 与部分撤销两种事件
  const revertFirst = await pApi.call('order.unmarkPicked', { orderNo: '20261022-0901', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-unpick0') });
  const rowRevert = rowOf(db, '20261022-0901');
  t.eq([revertFirst.data.order.status, rowRevert.pickedAt], [ACCEPTED, null],
    'I12 逐件撤销（订单原 PICKED）：订单回 ACCEPTED、清订单 pickedAt');
  t.eq([rowRevert.parcels[0].pickedAt, rowRevert.parcels[1].pickedAt !== null, revertFirst.data.order.pickedCount],
    [null, true, 2], 'I13 只清该件、其余件保留已取（pickedCount=2，进度不丢）');
  const revertEvent = pickedEventOf(db, '20261022-0901', 'PICKED_REVERTED');
  t.eq([revertEvent.type, revertEvent.payload], ['PICKED_REVERTED', { itemIndex: 0, undoneAction: 'order.markPicked' }],
    'I14 逐件撤销（原 PICKED）事件 PICKED_REVERTED payload={itemIndex,undoneAction}');

  const revertPartial = await pApi.call('order.unmarkPicked', { orderNo: '20261022-0901', itemIndex: 1 },
    { clientRequestId: nextCrid('d61-unpick1') });
  const partialEvent = pickedEventOf(db, '20261022-0901', 'PARCEL_PICKED_REVERTED');
  t.eq([revertPartial.data.order.status, revertPartial.data.order.pickedCount, partialEvent.type, partialEvent.payload],
    [ACCEPTED, 1, 'PARCEL_PICKED_REVERTED', { itemIndex: 1 }],
    'I15 部分撤销（订单 ACCEPTED）→ 状态不变、PARCEL_PICKED_REVERTED payload={itemIndex}');

  // 负向：形态闸 / 越界 / 重复 / 缺码 / 整单码闸 / 状态闸；失败零落库
  const zeroBefore = [eventsFor(db, '20261022-0902').length, rowOf(db, '20261022-0902').version];
  await expectField(t, pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 1.5 },
    { clientRequestId: nextCrid('d61-fraction') }), 'VALIDATION_FAILED', 'itemIndex',
  'I16 itemIndex=1.5 非整数 → VALIDATION_FAILED(field=itemIndex)');
  await expectField(t, pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 10 },
    { clientRequestId: nextCrid('d61-over9') }), 'VALIDATION_FAILED', 'itemIndex',
  'I17 itemIndex=10 超出 0~9 → VALIDATION_FAILED(field=itemIndex)');
  await expectField(t, pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 9 },
    { clientRequestId: nextCrid('d61-overlen') }), 'VALIDATION_FAILED', 'itemIndex',
  'I18 itemIndex=9 超出本单 2 件 → VALIDATION_FAILED(field=itemIndex)（越界不静默取第 0 件）');
  t.eq([eventsFor(db, '20261022-0902').length, rowOf(db, '20261022-0902').version], zeroBefore,
    'I19 形态闸失败零落库（无事件、version 不变）');

  const coded = await pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-needcode-ok') });
  t.eq([coded.ok, coded.data.order.pickedCount, coded.data.order.allPicked], [true, 1, false],
    'I20 有码件可单独取件（同单另一件缺码不阻断逐件取件）');
  await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 1 },
    { clientRequestId: nextCrid('d61-needcode-bad') }), 'INVALID_STATE',
  'I21 缺码件逐件取件 → INVALID_STATE（文案要求先补码，不静默放行）');
  await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0902', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-repeat') }), 'INVALID_STATE',
  'I22 已取件重复取件 → INVALID_STATE（逐件幂等靠状态闸）');
  await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0902' },
    { clientRequestId: nextCrid('d61-whole-need') }), 'INVALID_STATE',
  'I23 整单取件仍要求全部件有码（逐件取件不放松整单码闸）');
  await expectCode(t, pApi.call('order.markPicked', { orderNo: '20261022-0917', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-picked-state') }), 'INVALID_TRANSITION',
  'I24 订单已 PICKED（全部件取完）再逐件取件 → INVALID_TRANSITION（markPicked 仅 ACCEPTED 起始）');

  const dropOff = await pApi.call('order.markPicked', { orderNo: '20261022-0903', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-dropoff') });
  t.eq([dropOff.ok, dropOff.data.order.status, dropOff.data.order.parcels[0].picked],
    [true, PICKED, true], 'I25 代寄（DROP_OFF）无码件逐件取件 → 允许且单件聚合转 PICKED');

  const batched = await pApi.call('order.markPicked', {
    orderNo: '20261022-0905', itemIndex: 0, batchActionId: 'BATCH-D61-0001'
  }, { clientRequestId: nextCrid('d61-batch') });
  t.eq([batched.ok, rowOf(db, '20261022-0905').batchActionId], [true, 'BATCH-D61-0001'],
    'I26 逐件取件兼容 batchActionId 落库（批量逐件可审计）');

  await expectField(t, pApi.call('order.unmarkPicked', { orderNo: '20261022-0901', itemIndex: 3 },
    { clientRequestId: nextCrid('d61-unpick-range') }), 'VALIDATION_FAILED', 'itemIndex',
  'I27 逐件撤销越界（3 件单 itemIndex=3）→ VALIDATION_FAILED(field=itemIndex)');
  await expectCode(t, pApi.call('order.unmarkPicked', { orderNo: '20261022-0901' },
    { clientRequestId: nextCrid('d61-unpick-all-accepted') }), 'INVALID_TRANSITION',
  'I28 ACCEPTED 且无 itemIndex 的整单撤销 → INVALID_TRANSITION（整单撤销仅 PICKED）');
  await expectCode(t, pApi.call('order.unmarkPicked', { orderNo: '20261022-0901', itemIndex: 1 },
    { clientRequestId: nextCrid('d61-unpick-twice') }), 'INVALID_STATE',
  'I29 已撤销件再撤销 → INVALID_STATE（该件尚未取件）');

  // 整单路径（旧客户端兼容）：整单取件 → 全部件落库；undo 撤销同时清件级
  const whole = await pApi.call('order.markPicked', { orderNo: '20261022-0918' },
    { clientRequestId: nextCrid('d61-whole') });
  const wholeRow = rowOf(db, '20261022-0918');
  t.eq([whole.ok, whole.data.order.status, whole.data.order.allPicked, whole.data.order.pickedCount],
    [true, PICKED, true, 2], 'I30 无 itemIndex 整单取件保持旧行为：全部件写 pickedAt、订单 PICKED');
  t.eq([wholeRow.parcels.every((parcel) => parcel.pickedAt !== null),
    wholeRow.parcels.every((parcel) => parcel.pickedByNo === 'PAAAAAA')], [true, true],
  'I31 整单取件全部件落 pickedAt/pickedByNo（旧客户端路径也产生件级真实数据）');
  const undone = await pApi.call('order.undo', { orderNo: '20261022-0918' },
    { clientRequestId: nextCrid('d61-undo') });
  t.eq([undone.ok, undone.data.order.status,
    rowOf(db, '20261022-0918').parcels.every((parcel) => parcel.pickedAt === null), undone.data.order.pickedCount],
  [true, ACCEPTED, true, 0],
  'I32 order.undo 撤销整单取件同时清件级 pickedAt（否则 ACCEPTED 单仍报已取 N 件）');

  await pApi.call('order.markPicked', { orderNo: '20261022-0905' },
    { clientRequestId: nextCrid('d61-whole2') });
  const unpickAll = await pApi.call('order.unmarkPicked', { orderNo: '20261022-0905' },
    { clientRequestId: nextCrid('d61-unpick-all') });
  const unpickRow = rowOf(db, '20261022-0905');
  t.eq([unpickAll.ok, unpickAll.data.order.status, unpickRow.pickedAt,
    unpickRow.parcels.every((parcel) => parcel.pickedAt === null)],
  [true, ACCEPTED, null, true], 'I33 整单撤销（PICKED）：清全部件 + 订单 pickedAt、回 ACCEPTED');
  const unpickEvent = pickedEventOf(db, '20261022-0905', 'PICKED_REVERTED');
  t.eq([unpickEvent.payload && unpickEvent.payload.undoneAction,
    unpickEvent.payload && new Date(unpickEvent.payload.previousAt).getTime()],
  ['order.markPicked', NOW], 'I34 整单撤销事件保留旧口径 undoneAction + previousAt');

  // 历史单 parcel{} 形态 + 旧单派生（无数据迁移）
  const legacyShape = await pApi.call('order.markPicked', { orderNo: '20261022-0906', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-legacy-shape') });
  const legacyShapeRow = rowOf(db, '20261022-0906');
  t.eq([legacyShapeRow.parcels === undefined, new Date(legacyShapeRow.parcel.pickedAt).getTime(),
    legacyShape.data.order.status], [true, NOW, PICKED],
  'I35 历史单 parcel{} 形态逐件操作仍写单包裹字段（不改成 parcels[] 混合态）');

  const legacyNos = ['20261022-0911', '20261022-0912', '20261022-0913',
    '20261022-0914', '20261022-0915', '20261022-0916'];
  const derived = {};
  for (let i = 0; i < legacyNos.length; i += 1) {
    derived[legacyNos[i]] = (await pApi.call('order.get', { orderNo: legacyNos[i] })).data.order;
  }
  t.eq(legacyNos.map((no) => derived[no].parcels[0].picked), [true, true, true, true, false, false],
    'I36 旧单派生：PICKED/DELIVERED/COMPLETED/EXCEPTION(from=PICKED) 已取；EXCEPTION(from=ACCEPTED)/ACCEPTED 未取');
  t.eq([derived['20261022-0911'].pickedAt, derived['20261022-0911'].parcels[0].actions,
    derived['20261022-0914'].parcels[0].actions],
  [iso(NOW - 4000), ['unmarkPicked'], []],
  'I37 旧单 DTO：已取派生给撤销入口、EXCEPTION 状态不下发件级写动作');

  const customerDto = (await cApi.call('order.get', { orderNo: '20261022-0911' })).data.order;
  t.eq([customerDto.parcels[0].actions, customerDto.parcels[0].picked, customerDto.pickedCount], [[], true, 1],
    'I38 顾客侧 DTO：件级 actions 恒空（仅展示进度），picked/pickedCount 照常下发');
  t.eq(Object.prototype.hasOwnProperty.call(customerDto.parcels[0], 'pickedByNo'), false,
    'I39 件级 DTO 不下发 pickedByNo（兼职编号快照只落库/内部审计）');

  // 旧多件单（无件级字段）逐件撤销后进度不丢：其余件按派生值显式落库
  const legacyBefore = (await pApi.call('order.get', { orderNo: '20261022-0917' })).data.order;
  t.eq([legacyBefore.pickedCount, legacyBefore.parcelCount, legacyBefore.allPicked,
    legacyBefore.parcels[0].pickedAt], [2, 2, true, NOW - 2000],
  'I40 旧多件单（无件级字段）按订单状态派生：全部件已取、pickedAt 回退订单 pickedAt');
  const legacyRevert = await pApi.call('order.unmarkPicked', { orderNo: '20261022-0917', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-legacy-unpick') });
  const legacyRow = rowOf(db, '20261022-0917');
  t.eq([legacyRevert.data.order.status, legacyRevert.data.order.pickedCount, legacyRow.parcels[0].pickedAt,
    new Date(legacyRow.parcels[1].pickedAt).getTime()],
  [ACCEPTED, 1, null, NOW - 2000],
  'I41 旧单逐件撤销：回 ACCEPTED、只清该件、其余件按派生值显式落库（进度不丢）');
  const legacyRepick = await pApi.call('order.markPicked', { orderNo: '20261022-0917', itemIndex: 0 },
    { clientRequestId: nextCrid('d61-legacy-repick') });
  t.eq([legacyRepick.data.order.status, legacyRepick.data.order.allPicked], [PICKED, true],
    'I42 旧单逐件撤销后重新取满 → 聚合重回 PICKED');
}

module.exports = { listPartnerChecks, parcelPickChecks };
