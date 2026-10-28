'use strict';
/**
 * tools/selftest-partner-customers.js — 批 7-A「兼职客户档案/统计」云端侧断言套件（task-71；A~F）。
 *
 * A. partner.listBindings：响应形/服务端排序（dormKey 自然序 + 同宿舍 roomTag 大写序）/搜索六字段/
 *    游标分页与不透明游标/activeOrderCount 按顾客现算且测试隔离/已释放与他人绑定不出现在列表。
 * B. partner.getCustomer：归属（他人/不存在→FORBIDDEN、已释放→INVALID_STATE）/档案行/订单只含白名单字段/
 *    statusUpdatedAt desc 游标分页/from-to 过滤/activeOrderCount 与 unbindEligibility 同源/openid 不入参不出参。
 * C. partner.stats：今日/本周（周一起）/本月三区间精确计数、completionRate 分母 0→null、
 *    近 7 自然日 series 固定 7 项、recent ≤10 且仅四键、todayCompleted、active 不随区间、测试数据一律排除。
 * D. partner.unbindCustomer：按该顾客进行中单判定（他人有进行中单不误拦）/有进行中单 INVALID_STATE/
 *    归属 FORBIDDEN/reason 枚举与 note≤100/已释放自然幂等/READONLY 禁写。
 * E. partner.saveCustomerNote：≤100/归属/仅 ACTIVE/同值不写/已释放 NOT_FOUND/READONLY 禁写。
 * F. 隐私与静态纪律：DTO 零内部键与零 openid 泄漏、READONLY 白名单三项可读、零 db.collection、零金额扫描。
 *
 * 夹具/期望值在 ./selftest-partner-customers-cases.js（两文件都受门禁 #18 ≤1000 行约束）。
 * 纪律：fake DB + 真实 handler/api，不 mock 全局 wx、不连真实网络；先合法基线再反例，样本非空；
 *      EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-partner-customers.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { createHarness, installCrashGuard } = require('./selftest');
const zeroMoney = require('./zero-money-scan');
const cases = require('./selftest-partner-customers-cases');

const PARTNER_DIR = cases.PARTNER_DIR;
const listBindings = require(path.join(PARTNER_DIR, 'listBindings.js'));
const getCustomer = require(path.join(PARTNER_DIR, 'getCustomer.js'));
const stats = require(path.join(PARTNER_DIR, 'stats.js'));
const unbindCustomer = require(path.join(PARTNER_DIR, 'unbindCustomer.js'));
const saveCustomerNote = require(path.join(PARTNER_DIR, 'saveCustomerNote.js'));
const { VIEW_READ_WHITELIST } = require(path.join(cases.API, 'middleware/switch-session.js'));

const {
  EXPECTED_ASSERTIONS, NOW, HOUR, DAY, TODAY_START, C1, C2, C3, C4, C5, P1, PID1, P2, PID2,
  TEST_C, TEST_P, TEST_PID, B1, B2, B3, B4, B5, B6, B7, BT,
  BINDING_ROW_KEYS, ORDER_ROW_KEYS, DTO_BANNED_KEYS,
  ROLES, PARTNER_STATUS, VIEW_MODE, SUBMITTED, ACCEPTED, PICKED, DELIVERED, COMPLETED, CANCELLED,
  EXCEPTION, ROOT, API, apiOf, handlerCtxOf, nextCrid, orderDoc, world, pickRow, rowsOf,
  collectKeyPaths, errorInfoOf, expectCode, expectField, jsonOf, handlerFiles, relOf
} = cases;

const ACTIVE = 'ACTIVE';

function boundPartners(db) {
  return rowsOf(db, 'bindings').map((row) => row._id + ':' + row.status + ':' + row.activeKey);
}

function keySetsOf(list) {
  return (list || []).map((row) => Object.keys(row).sort());
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

// ================================================================ A. listBindings
async function sectionA(h) {
  h.section('§7.4 A. partner.listBindings：服务端排序/搜索/游标分页/activeOrderCount 同源', async (t) => {
    const db = world({
      orders: [
        orderDoc('20261022-7001', SUBMITTED, { customerId: C1, statusUpdatedAt: new Date(NOW - 1000) }),
        orderDoc('20261022-7002', PICKED, { customerId: C1, statusUpdatedAt: new Date(NOW - 2000) }),
        orderDoc('20261022-7003', COMPLETED, {
          customerId: C2, completedAt: new Date(NOW - 3000), statusUpdatedAt: new Date(NOW - 3000)
        }),
        orderDoc('20261022-7004', EXCEPTION, {
          customerId: C3, statusUpdatedAt: new Date(NOW - 4000),
          exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 4000) }
        }),
        orderDoc('20261022-7005', ACCEPTED, { customerId: C5, statusUpdatedAt: new Date(NOW - 5000) }),
        orderDoc('20261022-7006', SUBMITTED, { customerId: C1, isTest: true, statusUpdatedAt: new Date(NOW - 6000) }),
        orderDoc('20261022-7007', SUBMITTED, {
          customerId: C1, partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
          statusUpdatedAt: new Date(NOW - 7000)
        }),
        orderDoc('20261022-7008', SUBMITTED, {
          customerId: '', customerOpenid: '', customerNo: '', source: 'PARTNER', phoneTail: '5678',
          guest: { displayName: '代客小张', phoneTail: '5678', zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
          statusUpdatedAt: new Date(NOW - 8000)
        }),
        orderDoc('20261022-7009', SUBMITTED, {
          customerId: TEST_C, partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PCCCCCC',
          isTest: true, statusUpdatedAt: new Date(NOW - 9000)
        }),
        orderDoc('20261022-7010', SUBMITTED, {
          customerId: TEST_C, partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PCCCCCC',
          isTest: false, statusUpdatedAt: new Date(NOW - 10000)
        })
      ]
    });
    const pApi = apiOf(db, P1);
    const base = await pApi.call('partner.listBindings');
    t.eq(sortedKeys(base.data), ['list', 'nextCursor'], 'A1 listBindings 响应顶层键恰为 list/nextCursor');
    t.eq(base.data.list.map((row) => row.bindingId), [B1, B2, B3, B4, B5],
      'A2 排序=dormKey 自然序（苑 D→X→N→B→C、楼栋/宿舍号数字序）→ 同宿舍 allocSeq（roomTag 大写字母序）');
    t.eq(base.data.list.map((row) => row.roomTag), ['A', 'B', 'A', 'A', 'A'],
      'A3 roomTag 恒大写展示（同宿舍第二人=B）');
    t.eq(base.data.list.map((row) => row.activeOrderCount), [2, 1, 0, 0, 1],
      'A4 activeOrderCount 按该顾客名下非终态单现算（C1 两单、C5 一单、C3 一单、C2/C4 零）');
    t.eq(base.data.list.map((row) => row.phoneTail), ['6678', '5555', '1234', '4321', '9999'],
      'A5 行信息含尾号四位（本人绑定数据完整值）');
    t.eq(base.data.list.every((row) => typeof row.boundAt === 'number' && row.boundAt > 0), true,
      'A6 boundAt 为毫秒时间戳');
    const b1Row = pickRow(base.data.list, B1);
    const b3Row = pickRow(base.data.list, B3);
    t.eq(Object.keys(b1Row).sort(), BINDING_ROW_KEYS.slice().sort(),
      'A7 行 DTO 顶层键全部在白名单（ACTIVE 且有头像时含 avatarFileId）');
    t.eq(Object.keys(b3Row).sort(), BINDING_ROW_KEYS.slice().filter((key) => key !== 'avatarFileId').sort(),
      'A8 无头像时不出现 avatarFileId 键（不是空串占位）');
    t.eq(base.data.list.filter((row) => row.bindingId === B6).length, 0,
      'A9 已释放绑定（B6）不出现在客户列表（只列 ACTIVE）');
    t.eq(base.data.list.filter((row) => row.bindingId === B7).length, 0,
      'A10 他人（P2）绑定不出现在本兼职列表（只搜/只列自己 ACTIVE 绑定）');
    t.eq(jsonOf(base.data).indexOf('openid-b7') >= 0, false,
      'A11 列表响应不含任何 openid 字样（既不回传也不贴内部键）');

    const byTail = await pApi.call('partner.listBindings', { keyword: '6678' });
    t.eq(byTail.data.list.map((row) => row.bindingId), [B1], 'A12 keyword 命中手机尾号四位');
    const byName = await pApi.call('partner.listBindings', { keyword: '小李' });
    t.eq(byName.data.list.map((row) => row.bindingId), [B3], 'A13 keyword 命中昵称');
    const byDorm = await pApi.call('partner.listBindings', { keyword: 'D4-1002' });
    t.eq(byDorm.data.list.map((row) => row.bindingId), [B3], 'A14 keyword 命中宿舍 dormKey');
    const byBuilding = await pApi.call('partner.listBindings', { keyword: 'D10' });
    t.eq(byBuilding.data.list.map((row) => row.bindingId), [B4], 'A15 keyword 命中楼栋 buildingText');
    const byTag = await pApi.call('partner.listBindings', { keyword: 'b' });
    t.eq(byTag.data.list.map((row) => row.bindingId), [B2], 'A16 keyword 命中 roomTag（大小写不敏感）');
    const byNo = await pApi.call('partner.listBindings', { keyword: 'CAD' });
    t.eq(byNo.data.list.map((row) => row.bindingId), [B1], 'A17 keyword 命中 customerNo 包含匹配');
    const byNoDashed = await pApi.call('partner.listBindings', { keyword: 'C-ADEF-GHJK' });
    t.eq(byNoDashed.data.list.map((row) => row.bindingId), [B1],
      'A18 keyword 支持顾客编号展示格式（去连字符后匹配库内规范值）');
    const byNone = await pApi.call('partner.listBindings', { keyword: '不存在的词' });
    t.eq([byNone.data.list.length, byNone.data.nextCursor], [0, null],
      'A19 无命中返回空列表（不是全量兜底）');

    await expectField(t, pApi.call('partner.listBindings', { keyword: 'x'.repeat(41) }),
      'VALIDATION_FAILED', 'keyword', 'A20 keyword 超 40 字 → VALIDATION_FAILED 且 data.field=keyword');
    await expectField(t, pApi.call('partner.listBindings', { keyword: 123 }),
      'VALIDATION_FAILED', 'keyword', 'A21 keyword 非字符串 → VALIDATION_FAILED 且 data.field=keyword');

    const pageNos = [];
    const cursors = [];
    let cursor = null;
    let pages = 0;
    for (;;) {
      const page = await pApi.call('partner.listBindings', { limit: 2, cursor });
      page.data.list.forEach((row) => pageNos.push(row.bindingId));
      cursors.push(page.data.nextCursor);
      cursor = page.data.nextCursor;
      pages += 1;
      if (!cursor || pages > 10) {
        break;
      }
    }
    t.eq([pageNos, new Set(pageNos).size], [[B1, B2, B3, B4, B5], 5],
      'A22 limit=2 游标翻页不重不漏，顺序与单页一致');
    t.eq([cursors.length, cursors[cursors.length - 1]], [3, null],
      'A23 三页取尽且末页 nextCursor=null');
    t.eq(cursors.slice(0, 2).filter((item) => jsonOf(item).indexOf('openid') >= 0).length, 0,
      'A24 nextCursor 不透明且不含 openid（只编码排序锚 dormKey+allocSeq）');
    await expectField(t, pApi.call('partner.listBindings', { cursor: 'not-a-cursor' }),
      'VALIDATION_FAILED', 'cursor', 'A25 畸形游标 → VALIDATION_FAILED 且 data.field=cursor（不静默回到首页）');
    const single = await pApi.call('partner.listBindings', { limit: 1 });
    t.eq([single.data.list.length, single.data.nextCursor === null], [1, false],
      'A26 limit=1 时首批非空且仍有下一页（hasMore 按过滤后全量判定）');

    const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED });
    await expectCode(t, apiOf(suspendedDb, P1).call('partner.listBindings'), 'PARTNER_CLOSED',
      'A27 SUSPENDED 兼职查客户列表 → PARTNER_CLOSED');
    await expectCode(t, apiOf(db, C1).call('partner.listBindings'), 'FORBIDDEN',
      'A28 顾客调 partner.listBindings → FORBIDDEN（仅兼职身份）');

    const testCtx = handlerCtxOf(db, TEST_P, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, isTestAccount: true
    });
    const testList = await listBindings.handler(testCtx, {});
    const testRow = pickRow(testList.list, BT);
    t.eq([testList.list.length, testRow.activeOrderCount], [1, 1],
      'A29 TEST_WRITE 会话：只列测试绑定、activeOrderCount 只数 isTest 单（真实/污染单不混入）');
  });
}

// ================================================================ B. getCustomer
function customerWorldOrders() {
  return [
    orderDoc('20261022-3001', SUBMITTED, { customerId: C1, statusUpdatedAt: new Date(NOW - 1000) }),
    orderDoc('20261022-3002', COMPLETED, {
      customerId: C1, completedAt: new Date(NOW - 2000), statusUpdatedAt: new Date(NOW - 2000)
    }),
    orderDoc('20261022-3003', CANCELLED, {
      customerId: C1, cancelledAt: new Date(NOW - 3000), statusUpdatedAt: new Date(NOW - 3000),
      cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
    }),
    orderDoc('20261022-3004', DELIVERED, {
      customerId: C1, deliveredAt: new Date(NOW - 1600), statusUpdatedAt: new Date(NOW - 1500)
    }),
    orderDoc('20260912-3005', COMPLETED, {
      customerId: C1, completedAt: new Date(NOW - 40 * DAY), statusUpdatedAt: new Date(NOW - 40 * DAY)
    }),
    orderDoc('20261022-3006', ACCEPTED, { customerId: C2, statusUpdatedAt: new Date(NOW - 900) }),
    orderDoc('20261022-3007', SUBMITTED, {
      customerId: C1, partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
      statusUpdatedAt: new Date(NOW - 800)
    }),
    orderDoc('20261022-3008', SUBMITTED, {
      customerId: '', customerOpenid: '', customerNo: '', source: 'PARTNER', phoneTail: '5678',
      guest: { displayName: '代客小张', phoneTail: '5678', zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
      statusUpdatedAt: new Date(NOW - 700)
    }),
    orderDoc('20261022-3009', SUBMITTED, {
      customerId: TEST_C, partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PCCCCCC',
      isTest: true, statusUpdatedAt: new Date(NOW - 600)
    }),
    orderDoc('20261022-3010', SUBMITTED, {
      customerId: TEST_C, partnerId: TEST_PID, partnerOpenid: TEST_P, partnerNo: 'PCCCCCC',
      isTest: false, statusUpdatedAt: new Date(NOW - 500)
    })
  ];
}

async function sectionB(h) {
  h.section('§7.4 B. partner.getCustomer：归属/档案行/解绑资格同源（TD-049 起无 orders 字段）', async (t) => {
    const db = world({ orders: customerWorldOrders() });
    const pApi = apiOf(db, P1);
    const base = await pApi.call('partner.getCustomer', { bindingId: B1 });
    t.eq(sortedKeys(base.data), ['activeOrderCount', 'customer', 'partnerNo', 'unbindEligibility'],
      'B1 getCustomer 响应顶层键恰四项（TD-049：orders/nextCursor 已下线）');
    const customerRow = base.data.customer;
    t.eq([customerRow.bindingId, customerRow.displayName, customerRow.customerNo, customerRow.roomTag,
      customerRow.dormKey, customerRow.buildingText, customerRow.phoneTail, customerRow.avatarFileId,
      customerRow.activeOrderCount],
    [B1, '小王', 'CADEFGHJK', 'A', 'D4-522', 'D4', '6678', 'cloud://avatar-c1.jpg', 2],
    'B2 customer 档案行=客户列表同源字段（含编号/锚/尾号/头像/进行中单数）');
    t.eq(Object.keys(customerRow).sort(), BINDING_ROW_KEYS.slice().sort(),
      'B3 customer 行顶层键与 listBindings 行白名单一致');
    t.check(base.data.orders === undefined,
      "B4 响应不含 orders 字段（顾客历史订单唯一来源 = order.listPartner({view:'customer'})）");
    t.check(base.data.nextCursor === undefined,
      'B5 响应不含 nextCursor（不暴露第二套订单游标，避免双来源分页）');
    t.eq([base.data.activeOrderCount, base.data.unbindEligibility],
      [2, { canUnbind: false, activeOrderCount: 2 }],
      'B6 activeOrderCount 与 unbindEligibility 同源：该顾客有进行中单→不可解绑');
    t.eq(base.data.partnerNo, 'PAAAAAA', 'B7 回传本人兼职编号（页面底部「服务兼职编号」用）');
    const legacy = await pApi.call('partner.getCustomer', {
      bindingId: B1, limit: 2, cursor: { sortValue: 1, orderNo: 'X' }, from: 'not-a-time', to: NOW
    });
    t.eq([legacy.data.customer.bindingId, legacy.data.orders],
      [B1, undefined], 'B8 旧订单分页参数（limit/cursor/from/to）不再参与取数：不影响档案、不报错、不回 orders');
    const noOrderDetail = await pApi.call('partner.getCustomer', { bindingId: B4 });
    t.eq([noOrderDetail.data.activeOrderCount, noOrderDetail.data.unbindEligibility],
      [0, { canUnbind: true, activeOrderCount: 0 }],
      'B9 无订单顾客：进行中 0 + 可解绑（canUnbind 与解绑守卫同源）');
    await expectCode(t, pApi.call('partner.getCustomer', { bindingId: B7 }), 'FORBIDDEN',
      'B10 他人 bindingId → FORBIDDEN（不泄露绑定是否存在）');
    await expectCode(t, pApi.call('partner.getCustomer', { bindingId: 'bind-not-exist' }), 'FORBIDDEN',
      'B11 不存在的 bindingId → FORBIDDEN（与越权同码，避免枚举）');
    await expectCode(t, pApi.call('partner.getCustomer', { bindingId: B6 }), 'INVALID_STATE',
      'B12 自己已释放的 bindingId → INVALID_STATE（档案可留、关系已结束）');
    await expectField(t, pApi.call('partner.getCustomer', {}), 'VALIDATION_FAILED', 'bindingId',
      'B13 缺 bindingId → VALIDATION_FAILED 且 data.field=bindingId');
    await expectCode(t, apiOf(db, C1).call('partner.getCustomer', { bindingId: B1 }), 'FORBIDDEN',
      'B14 顾客身份调 partner.getCustomer → FORBIDDEN');
    await expectCode(t, pApi.call('partner.getCustomer', { bindingId: C1 }), 'FORBIDDEN',
      'B15 把顾客 openid 当 bindingId 传入 → FORBIDDEN（页面参数只能是 bindingId）');
    const ignoredOpenid = await pApi.call('partner.getCustomer', { bindingId: B1, customerId: C2 });
    t.eq([ignoredOpenid.data.customer.bindingId, ignoredOpenid.data.orders],
      [B1, undefined], 'B16 额外传 customerId/openid 被忽略：仍按 bindingId 归属取数，不扩大/不缩小范围');
    t.eq(collectKeyPaths(base.data, DTO_BANNED_KEYS, '', []), [],
      'B17 getCustomer 响应递归零内部键（openid/主键/幂等键/isTest 等）');
    const testCtx = handlerCtxOf(db, TEST_P, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, isTestAccount: true
    });
    const testDetail = await getCustomer.handler(testCtx, { bindingId: BT });
    t.eq(testDetail.activeOrderCount, 1,
      'B18 TEST_WRITE 会话：进行中单数只看 isTest 数据（真实/污染单不混入）');
    const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED, orders: customerWorldOrders() });
    await expectCode(t, apiOf(suspendedDb, P1).call('partner.getCustomer', { bindingId: B1 }),
      'PARTNER_CLOSED', 'B19 SUSPENDED 兼职查顾客详情 → PARTNER_CLOSED');
  });
}
// ================================================================ C. stats
function statsWorldOrders() {
  return [
    orderDoc('20261022-1001', COMPLETED, { completedAt: new Date(NOW - 1 * HOUR), statusUpdatedAt: new Date(NOW - 1 * HOUR) }),
    orderDoc('20261022-1002', COMPLETED, { completedAt: new Date(NOW - 8 * HOUR), statusUpdatedAt: new Date(NOW - 8 * HOUR) }),
    orderDoc('20261022-1003', COMPLETED, { completedAt: new Date(TODAY_START), statusUpdatedAt: new Date(TODAY_START) }),
    orderDoc('20261021-1004', COMPLETED, {
      completedAt: new Date(TODAY_START - 60000), statusUpdatedAt: new Date(TODAY_START - 60000)
    }),
    orderDoc('20261020-1005', COMPLETED, { completedAt: new Date(NOW - 2 * DAY), statusUpdatedAt: new Date(NOW - 2 * DAY) }),
    orderDoc('20261013-1006', COMPLETED, { completedAt: new Date(NOW - 9 * DAY), statusUpdatedAt: new Date(NOW - 9 * DAY) }),
    orderDoc('20260912-1007', COMPLETED, { completedAt: new Date(NOW - 40 * DAY), statusUpdatedAt: new Date(NOW - 40 * DAY) }),
    orderDoc('20261022-1008', CANCELLED, {
      cancelledAt: new Date(NOW - 2 * HOUR), statusUpdatedAt: new Date(NOW - 2 * HOUR),
      cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
    }),
    orderDoc('20261014-1009', CANCELLED, {
      cancelledAt: new Date(NOW - 8 * DAY), statusUpdatedAt: new Date(NOW - 8 * DAY),
      cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
    }),
    orderDoc('20261022-1010', EXCEPTION, {
      statusUpdatedAt: new Date(NOW - 3 * HOUR),
      exception: { code: 'CABINET_ERROR', text: '柜门故障', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 3 * HOUR) }
    }),
    orderDoc('20261022-1011', SUBMITTED, { customerId: C2, statusUpdatedAt: new Date(NOW - 20 * DAY) }),
    orderDoc('20261022-1012', ACCEPTED, { customerId: C3, statusUpdatedAt: new Date(NOW - 20 * DAY) }),
    orderDoc('20261022-1013', PICKED, { statusUpdatedAt: new Date(NOW - 20 * DAY) }),
    orderDoc('20261022-1014', DELIVERED, {
      customerId: C5, deliveredAt: new Date(NOW - 6 * HOUR), statusUpdatedAt: new Date(NOW - 6 * HOUR)
    }),
    orderDoc('20261022-1015', COMPLETED, {
      customerId: '', customerOpenid: '', customerNo: '', source: 'PARTNER', phoneTail: '5678',
      guest: { displayName: '代客小张', phoneTail: '5678', zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
      completedAt: new Date(NOW - 4 * HOUR), statusUpdatedAt: new Date(NOW - 4 * HOUR)
    }),
    orderDoc('20261022-1016', COMPLETED, {
      isTest: true, completedAt: new Date(NOW - 30 * 60000), statusUpdatedAt: new Date(NOW - 30 * 60000)
    }),
    orderDoc('20261022-1017', COMPLETED, {
      partnerId: PID2, partnerOpenid: P2, partnerNo: 'PBBBBBB',
      completedAt: new Date(NOW - 45 * 60000), statusUpdatedAt: new Date(NOW - 45 * 60000)
    }),
    orderDoc('20261020-1018', EXCEPTION, {
      statusUpdatedAt: new Date(NOW - 2 * DAY),
      exception: { code: 'PARCEL_NOT_FOUND', text: '找不到件', fromStatus: ACCEPTED, by: ROLES.PARTNER, at: new Date(NOW - 2 * DAY) }
    }),
    orderDoc('20261012-1019', EXCEPTION, {
      statusUpdatedAt: new Date(NOW - 10 * DAY),
      exception: { code: 'ADDRESS_ISSUE', text: '地址问题', fromStatus: PICKED, by: ROLES.PARTNER, at: new Date(NOW - 10 * DAY) }
    })
  ];
}

async function sectionC(h) {
  h.section('§7.4 C. partner.stats：三区间精确计数/分母 null/series 7 项/recent 四键/排除测试数据', async (t) => {
    const db = world({ orders: statsWorldOrders() });
    const pApi = apiOf(db, P1);

    const today = await pApi.call('partner.stats');
    t.eq(sortedKeys(today.data),
      ['completionRate', 'counts', 'range', 'recent', 'series', 'todayCompleted'],
      'C1 stats 响应顶层键按契约固定六项');
    t.eq(today.data.range, 'today', 'C2 range 缺省=today（页面首屏不传）');
    t.eq(Object.keys(today.data.counts).sort(), ['active', 'cancelled', 'completed', 'exceptions'],
      'C3 counts 恰为四项 completed/active/cancelled/exceptions');
    t.eq(today.data.counts, { completed: 4, active: 7, cancelled: 1, exceptions: 1 },
      'C4 今日四项计数精确（完成 4=含 00:00 边界与代客单、排除测试单与他人单；进行中 7；取消 1；异常 1）');
    t.eq(today.data.completionRate, 4 / (4 + 1 + 1),
      'C5 completionRate = completed/(completed+cancelled+exceptions)，比率 0..1');
    t.eq(today.data.todayCompleted, 4, 'C6 todayCompleted=今日自然日完成数');
    t.eq(today.data.series.length, 7, 'C7 series 固定 7 项（缺日补 0，不返回短数组）');
    t.eq(today.data.series.map((item) => item.completed), [0, 0, 0, 0, 1, 1, 4],
      'C8 series 逐日完成数：近 7 自然日最早→今天');
    t.eq(today.data.series.map((item) => item.date),
      ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'],
      'C9 series.date 按 serverTime 自然日（UTC+8）连续 7 天');
    t.eq([today.data.series[0].label, today.data.series[6].label], ['10-16', '10-22'],
      'C10 series.label 为补零 MM-DD（端侧直接渲染，不二次拼日期）');
    t.eq(Object.keys(today.data.series[0]).sort(), ['completed', 'date', 'label'],
      'C11 series 每项恰为 date/label/completed 三键');
    t.eq(today.data.recent.length, 7, 'C12 recent 只取区间内最近单（今日 7 条，≤10）');
    t.eq(today.data.recent.map((row) => row.orderNo),
      ['20261022-1001', '20261022-1008', '20261022-1010', '20261022-1015',
        '20261022-1014', '20261022-1002', '20261022-1003'],
      'C13 recent 按 statusUpdatedAt desc（含进行中状态，供日报摘要）');
    t.eq(today.data.recent.map((row) => row.statusText),
      ['已完成', '已取消', '异常·待处理', '已完成', '已送达·待确认', '已完成', '已完成'],
      'C14 recent.statusText 是服务端人话（DELIVERED 带「·待确认」后缀）');
    t.eq(today.data.recent.filter((row) => Object.keys(row).sort().join(',') !== 'at,orderNo,status,statusText').length, 0,
      'C15 recent 每项恰四键 orderNo/status/statusText/at');
    t.eq(today.data.recent.every((row) => typeof row.at === 'string' && /Z$/.test(row.at)), true,
      'C16 recent.at 为 ISO 时间字符串');

    const week = await pApi.call('partner.stats', { range: 'week' });
    t.eq(week.data.range, 'week', 'C17 range 原样回传');
    t.eq(week.data.counts, { completed: 6, active: 7, cancelled: 1, exceptions: 2 },
      'C18 本周（周一起）计数：完成 6、取消 1、异常 2（含仍在 EXCEPTION 的旧上报、不含 10-13）');
    t.eq(week.data.completionRate, 6 / (6 + 1 + 2), 'C19 本周完成率按公式精确（比率 0..1）');
    t.eq(week.data.todayCompleted, 4, 'C20 todayCompleted 不随 range 变化（恒为今天）');

    const month = await pApi.call('partner.stats', { range: 'month' });
    t.eq(month.data.counts, { completed: 7, active: 7, cancelled: 2, exceptions: 3 },
      'C21 本月（自然月）计数：完成 7、取消 2、异常 3（9 月单不进本月）');
    t.eq(month.data.completionRate, 7 / (7 + 2 + 3), 'C22 本月完成率精确');
    t.eq([today.data.counts.active, week.data.counts.active, month.data.counts.active], [7, 7, 7],
      'C23 active=当前非终态单量，不随区间变化');
    t.eq(month.data.series.map((item) => item.completed), [0, 0, 0, 0, 1, 1, 4],
      'C24 series 恒看近 7 自然日，不随 range 缩窗');

    await expectField(t, pApi.call('partner.stats', { range: 'year' }), 'VALIDATION_FAILED', 'range',
      'C25 非法 range → VALIDATION_FAILED 且 data.field=range');
    const emptyDb = world();
    const empty = await apiOf(emptyDb, P1).call('partner.stats');
    t.eq(empty.data.counts, { completed: 0, active: 0, cancelled: 0, exceptions: 0 },
      'C26 空数据：四项计数为 0（不是空对象/缺键）');
    t.eq(empty.data.completionRate, null, 'C27 分母为 0 → completionRate=null（页面显示「暂无」而不是 0%）');
    t.eq([empty.data.series.length, empty.data.series.every((item) => item.completed === 0), empty.data.recent],
      [7, true, []], 'C28 空数据：series 仍 7 项全 0、recent 空数组');
    t.eq(empty.data.todayCompleted, 0, 'C29 空数据 todayCompleted=0');

    const testCtx = handlerCtxOf(db, TEST_P, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.TEST_WRITE, isTestAccount: true
    });
    const testStats = await stats.handler(testCtx, { range: 'month' });
    t.eq([testStats.counts, testStats.completionRate, testStats.recent,
      testStats.series.every((item) => item.completed === 0)],
    [{ completed: 0, active: 0, cancelled: 0, exceptions: 0 }, null, [], true],
    'C30 TEST_WRITE 会话统计一律排除测试数据（全 0 空模板，不是报错）');

    const readonlyCtx = handlerCtxOf(db, P1, {
      role: ROLES.PARTNER, viewMode: VIEW_MODE.READONLY
    });
    const readonlyStats = await stats.handler(readonlyCtx, {});
    t.eq([readonlyStats.range, readonlyStats.counts.completed], ['today', 4],
      'C31 READONLY 真实兼职可读统计（数据与本人一致，只读不写）');
    t.eq(collectKeyPaths(today.data, DTO_BANNED_KEYS, '', []), [],
      'C32 stats 响应递归零内部键（无 openid/主键/测试标记）');
    t.eq(jsonOf(today.data).indexOf('openid-b7') >= 0, false, 'C33 stats 响应不含 openid 字样');
    await expectCode(t, apiOf(db, C1).call('partner.stats'), 'FORBIDDEN',
      'C34 顾客身份调 partner.stats → FORBIDDEN');
    const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED, orders: statsWorldOrders() });
    await expectCode(t, apiOf(suspendedDb, P1).call('partner.stats'), 'PARTNER_CLOSED',
      'C35 SUSPENDED 兼职查统计 → PARTNER_CLOSED');
  });
}

// ================================================================ D. unbindCustomer
async function sectionD(h) {
  h.section('§7.4 D. partner.unbindCustomer：按该顾客判定/归属/枚举与长度/自然幂等', async (t) => {
    const db = world({
      orders: [
        orderDoc('20261022-4001', SUBMITTED, { customerId: C3, statusUpdatedAt: new Date(NOW - 1000) }),
        orderDoc('20261022-4002', SUBMITTED, { customerId: C1, statusUpdatedAt: new Date(NOW - 2000) })
      ]
    });
    const pApi = apiOf(db, P1);
    const released = await pApi.call('partner.unbindCustomer',
      { bindingId: B3, reason: 'PARTNER_INITIATED', note: '顾客搬宿舍' },
      { clientRequestId: nextCrid('unbind-ok') });
    const releasedData = released.data || {};
    t.eq([released.ok, releasedData.releaseReason, releasedData.duplicated],
      [true, 'PARTNER_INITIATED', false], 'D1 基线：无进行中单的顾客可解绑，回 releaseReason/duplicated=false');
    t.eq([typeof releasedData.releasedAt, releasedData.releasedAt > 0], ['number', true],
      'D2 releasedAt 为毫秒时间戳');
    const b3After = rowsOf(db, 'bindings').filter((row) => row._id === B3)[0];
    t.eq([b3After.status, b3After.releasedBy, b3After.releaseNote, b3After.releaseReason],
      ['RELEASED', 'PARTNER', '顾客搬宿舍', 'PARTNER_INITIATED'],
      'D3 释放落库：status/releasedBy/releaseNote/releaseReason');
    t.eq(b3After.activeKey, C2 + ':RELEASED:' + B3,
      'D4 释放后 activeKey 拼入 _id（保证一顾客仅一条 ACTIVE 唯一索引）');
    t.eq(rowsOf(db, 'order_messages').filter((row) => row.templateCode === 'BIND_RELEASED').length, 1,
      'D5 解绑后给顾客写一条站内通知（BIND_RELEASED）');
    const b5After = rowsOf(db, 'bindings').filter((row) => row._id === B5)[0];
    t.eq(b5After.status, ACTIVE,
      'D6 他人（C3）有进行中单不影响本顾客解绑（守卫口径=该 binding.customerId，不是兼职全量）');

    const businessBefore = { bindings: db.dump('bindings'), orders: db.dump('orders'), messages: db.dump('order_messages') };
    await expectCode(t, pApi.call('partner.unbindCustomer',
      { bindingId: B1, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-blocked') }),
    'INVALID_STATE', 'D7 该顾客有进行中单 → INVALID_STATE');
    const b1After = rowsOf(db, 'bindings').filter((row) => row._id === B1)[0];
    const businessAfter = { bindings: db.dump('bindings'), orders: db.dump('orders'), messages: db.dump('order_messages') };
    t.eq([b1After.status, businessAfter], [ACTIVE, businessBefore],
      'D8 拦截路径零业务落库（绑定仍 ACTIVE；仅安全基线限流计数会写 counters，业务集合零写入）');
    await expectCode(t, pApi.call('partner.unbindCustomer',
      { bindingId: B7, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-other') }),
    'FORBIDDEN', 'D9 他人 bindingId → FORBIDDEN（不泄露绑定存在性）');
    await expectCode(t, pApi.call('partner.unbindCustomer',
      { bindingId: 'bind-not-exist', reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-none') }),
    'FORBIDDEN', 'D10 不存在的 bindingId → FORBIDDEN（与越权同码）');
    await expectField(t, pApi.call('partner.unbindCustomer',
      { bindingId: B1, reason: 'NOT_A_REASON' }, { clientRequestId: nextCrid('unbind-bad-reason') }),
    'VALIDATION_FAILED', 'reason', 'D11 非法 reason → VALIDATION_FAILED 且 data.field=reason');
    await expectField(t, pApi.call('partner.unbindCustomer',
      { bindingId: B1 }, { clientRequestId: nextCrid('unbind-no-reason') }),
    'VALIDATION_FAILED', 'reason', 'D12 缺 reason → VALIDATION_FAILED 且 data.field=reason');
    await expectField(t, pApi.call('partner.unbindCustomer',
      { bindingId: B1, reason: 'PARTNER_INITIATED', note: 'x'.repeat(101) },
      { clientRequestId: nextCrid('unbind-long-note') }),
    'VALIDATION_FAILED', 'note', 'D13 note 超 100 字 → VALIDATION_FAILED 且 data.field=note');

    const replay = await pApi.call('partner.unbindCustomer',
      { bindingId: B3, reason: 'PARTNER_INITIATED', note: '顾客搬宿舍' },
      { clientRequestId: nextCrid('unbind-replay') });
    const replayData = replay.data || {};
    t.eq([replay.ok, replayData.duplicated, replayData.releaseReason, replayData.releasedAt],
      [true, true, 'PARTNER_INITIATED', releasedData.releasedAt],
      'D14 已释放重放 → 自然幂等（duplicated=true，原释放结果不变）');
    t.eq(rowsOf(db, 'order_messages').filter((row) => row.templateCode === 'BIND_RELEASED').length, 1,
      'D15 幂等重放不重复写通知（只 1 条）');

    const readonlyCtx = handlerCtxOf(db, P1, { role: ROLES.PARTNER, viewMode: VIEW_MODE.READONLY });
    const readonlyError = await errorInfoOf(() => unbindCustomer.handler(readonlyCtx,
      { bindingId: B5, reason: 'PARTNER_INITIATED' }));
    t.eq(readonlyError.code, 'FORBIDDEN', 'D16 READONLY 会话解绑 → FORBIDDEN（只读视角禁写）');
    await expectCode(t, apiOf(db, C1).call('partner.unbindCustomer',
      { bindingId: B1, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-customer') }),
    'FORBIDDEN', 'D17 顾客身份调 partner.unbindCustomer → FORBIDDEN');

    const doneDb = world({
      orders: [
        orderDoc('20261022-4101', COMPLETED, {
          customerId: C1, completedAt: new Date(NOW - 2000), statusUpdatedAt: new Date(NOW - 2000)
        }),
        orderDoc('20261022-4102', CANCELLED, {
          customerId: C1, cancelledAt: new Date(NOW - 3000), statusUpdatedAt: new Date(NOW - 3000),
          cancelReason: 'CHANGED_MIND', cancelledBy: 'CUSTOMER'
        })
      ]
    });
    const doneUnbind = await apiOf(doneDb, P1).call('partner.unbindCustomer',
      { bindingId: B1, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-done') });
    t.eq([doneUnbind.ok, doneUnbind.data.releaseReason], [true, 'PARTNER_INITIATED'],
      'D18 终态单（COMPLETED/CANCELLED）不算进行中，可正常解绑');
    const suspendedDb = world({ partnerStatus: PARTNER_STATUS.SUSPENDED });
    await expectCode(t, apiOf(suspendedDb, P1).call('partner.unbindCustomer',
      { bindingId: B1, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('unbind-suspended') }),
    'PARTNER_CLOSED', 'D19 SUSPENDED 兼职解绑 → PARTNER_CLOSED');
  });
}

// ================================================================ E. saveCustomerNote
async function sectionE(h) {
  h.section('§7.4 E. partner.saveCustomerNote：≤100/归属/仅 ACTIVE/同值不写', async (t) => {
    const db = world();
    const pApi = apiOf(db, P1);
    const saved = await pApi.call('partner.saveCustomerNote',
      { bindingId: B3, partnerNote: '门口第二个柜子' }, { clientRequestId: nextCrid('note-save') });
    const b3Row = rowsOf(db, 'bindings').filter((row) => row._id === B3)[0];
    t.eq([saved.ok, (saved.data || {}).partnerNote, b3Row.partnerNote],
      [true, '门口第二个柜子', '门口第二个柜子'], 'E1 备注保存成功并落库（顾客不可见字段）');
    const updatesBefore = db.stats.updates;
    const replay = await pApi.call('partner.saveCustomerNote',
      { bindingId: B3, partnerNote: '门口第二个柜子' }, { clientRequestId: nextCrid('note-same') });
    t.eq([replay.ok, db.stats.updates], [true, updatesBefore],
      'E2 同值重放不写库（字段级幂等）');
    const cleared = await pApi.call('partner.saveCustomerNote',
      { bindingId: B3, partnerNote: '' }, { clientRequestId: nextCrid('note-clear') });
    const b3Cleared = rowsOf(db, 'bindings').filter((row) => row._id === B3)[0];
    t.eq([(cleared.data || {}).partnerNote, b3Cleared.partnerNote], ['', ''],
      'E3 清空备注（空串）合法且落库');
    await expectField(t, pApi.call('partner.saveCustomerNote',
      { bindingId: B3, partnerNote: 'x'.repeat(101) }, { clientRequestId: nextCrid('note-long') }),
    'VALIDATION_FAILED', 'partnerNote', 'E4 备注超 100 字 → VALIDATION_FAILED 且 data.field=partnerNote');
    await expectCode(t, pApi.call('partner.saveCustomerNote',
      { bindingId: B7, partnerNote: '越权' }, { clientRequestId: nextCrid('note-other') }),
    'FORBIDDEN', 'E5 他人 bindingId → FORBIDDEN（不泄露绑定存在性）');
    await expectCode(t, pApi.call('partner.saveCustomerNote',
      { bindingId: B6, partnerNote: '已解绑' }, { clientRequestId: nextCrid('note-released') }),
    'NOT_FOUND', 'E6 自己已释放的 bindingId → NOT_FOUND（备注只对 ACTIVE 绑定开放）');
    await expectField(t, pApi.call('partner.saveCustomerNote',
      { partnerNote: '缺主键' }, { clientRequestId: nextCrid('note-no-id') }),
    'VALIDATION_FAILED', 'bindingId', 'E7 缺 bindingId → VALIDATION_FAILED 且 data.field=bindingId');
    await expectField(t, pApi.call('partner.saveCustomerNote',
      { bindingId: B3, partnerNote: 42 }, { clientRequestId: nextCrid('note-type') }),
    'VALIDATION_FAILED', 'partnerNote', 'E8 备注非字符串 → VALIDATION_FAILED 且 data.field=partnerNote');
    await expectCode(t, apiOf(db, C1).call('partner.saveCustomerNote',
      { bindingId: B1, partnerNote: '顾客自己写' }, { clientRequestId: nextCrid('note-customer') }),
    'FORBIDDEN', 'E9 顾客身份调 partner.saveCustomerNote → FORBIDDEN');
    const readonlyCtx = handlerCtxOf(db, P1, { role: ROLES.PARTNER, viewMode: VIEW_MODE.READONLY });
    const readonlyError = await errorInfoOf(() => saveCustomerNote.handler(readonlyCtx,
      { bindingId: B1, partnerNote: '只读视角' }));
    t.eq(readonlyError.code, 'FORBIDDEN', 'E10 READONLY 会话写备注 → FORBIDDEN');
  });
}

// ================================================================ F. 隐私与静态纪律
async function sectionF(h) {
  h.section('§7.4/§12 F. 隐私与静态纪律：DTO 零内部键/READONLY 可读/零 db.collection/零金额', async (t) => {
    const files = handlerFiles();
    t.check(files.length >= 9, 'F1 handlers/partner 文件清单非空（静态纪律样本 ' + files.length + ' 个）');
    const dbCollectionHits = files.filter((file) => fs.readFileSync(file, 'utf8').indexOf('db.collection(') >= 0)
      .map(relOf);
    t.eq(dbCollectionHits, [], 'F2 handlers/partner 零 db.collection（数据访问只经 db/dao）');
    const allow = zeroMoney.loadAllowlist(ROOT);
    t.eq(allow.issues, [], 'F3 零金额扫描白名单无配置错误');
    const moneyHits = [];
    files.forEach((file) => {
      const rel = relOf(file);
      const allowed = allow.index.get(rel) || new Set();
      zeroMoney.scanText(fs.readFileSync(file, 'utf8')).forEach((hit) => {
        if (!allowed.has(hit.text)) {
          moneyHits.push(rel + ':' + hit.line + ':' + hit.token);
        }
      });
    });
    t.eq(moneyHits, [], 'F4 handlers/partner 零金额扫描 0 命中（无任何交易类语义）');

    const db = world({ orders: customerWorldOrders() });
    const pApi = apiOf(db, P1);
    const listRes = await pApi.call('partner.listBindings');
    const detailRes = await pApi.call('partner.getCustomer', { bindingId: B1 });
    const statsRes = await pApi.call('partner.stats');
    const unbindRes = await pApi.call('partner.unbindCustomer',
      { bindingId: B3, reason: 'PARTNER_INITIATED' }, { clientRequestId: nextCrid('f-unbind') });
    const noteRes = await pApi.call('partner.saveCustomerNote',
      { bindingId: B4, partnerNote: 'F 段备注' }, { clientRequestId: nextCrid('f-note') });
    const responses = [listRes.data, detailRes.data, statsRes.data, unbindRes.data, noteRes.data];
    const bannedHits = responses.reduce((acc, item) => acc.concat(collectKeyPaths(item, DTO_BANNED_KEYS, '', [])), []);
    t.eq(bannedHits, [],
      'F5 五个客户域读/写响应递归零内部键（openid/主键/幂等键/取件码/宿舍/测试标记）');
    const readWhitelist = ['partner.listBindings', 'partner.getCustomer', 'partner.stats'];
    t.eq(readWhitelist.filter((action) => VIEW_READ_WHITELIST.indexOf(action) < 0), [],
      'F6 READONLY 切换会话读白名单含三项客户域只读动作（写动作仍不在白名单）');

    const readonlyCtx = handlerCtxOf(db, P1, { role: ROLES.PARTNER, viewMode: VIEW_MODE.READONLY });
    const readonlyResults = [];
    readonlyResults.push(await errorInfoOf(async () => {
      const value = await listBindings.handler(readonlyCtx, {});
      return value.list.length;
    }));
    readonlyResults.push(await errorInfoOf(async () => {
      const value = await getCustomer.handler(readonlyCtx, { bindingId: B1 });
      return value.customer.bindingId;
    }));
    readonlyResults.push(await errorInfoOf(async () => {
      const value = await stats.handler(readonlyCtx, {});
      return value.range;
    }));
    t.eq(readonlyResults.map((item) => item.code), ['NO_ERROR', 'NO_ERROR', 'NO_ERROR'],
      'F7 READONLY 会话三个客户域读 handler 均可执行（只读不写，非白名单外拒绝）');
    t.eq(jsonOf([listRes.data, detailRes.data, statsRes.data]).indexOf('TEST-b7') >= 0, false,
      'F8 真实会话响应不含测试账号标识（测试数据不进真实口径）');
  });
}

// ---------------------------------------------------------------- 注册
function register(h) {
  h.setExpected(EXPECTED_ASSERTIONS);
  sectionA(h);
  sectionB(h);
  sectionC(h);
  sectionD(h);
  sectionE(h);
  sectionF(h);
}

module.exports = { register, EXPECTED_ASSERTIONS };

if (require.main === module) {
  const harness = createHarness({ name: 'selftest-partner-customers' });
  installCrashGuard(() => ({ count: harness.count, passed: harness.passed, failures: harness.failures.length }),
    'selftest-partner-customers');
  register(harness);
  const ret = harness.finish();
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {});
  }
}
