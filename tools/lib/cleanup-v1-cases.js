'use strict';
/**
 * tools/lib/cleanup-v1-cases.js — selftest-cleanup 的 v1.0 用例表（D23/D24/D25）：
 * 一单多图逐张清理、逐件匿名化、跨形态引用计数、M-02 FIXED 原图锁、测试账号/测试数据清理。
 * 非独立套件：由 selftest-cleanup require 后在各 § 内调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 *
 * 口径：CONTRACT v1.0 §4/§11.1；DATA_MODEL §10.1/§10.2/§10.3（截图逐张 7 天、匿名化逐件逐图）。
 */

// §D files · v1.0 多图逐张清理 + manualEntry 跳过 + 跨单/跨形态引用计数 + 时间旅行
async function filesChecks(t, deps) {
  const shot = (fileId) => ({ fileId: fileId, width: 800, height: 600 });
  const db = deps.makeWorld({
    orders: [
      deps.orderOf({
        _id: 'v1-multi', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 8 * deps.DAY,
        image: undefined, images: [shot('cloud://v1-a.jpg'), shot('cloud://v1-b.jpg')]
      }),
      deps.orderOf({
        _id: 'v1-fresh', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 6 * deps.DAY,
        image: undefined, images: [shot('cloud://v1-fresh.jpg')]
      }),
      deps.orderOf({
        _id: 'v1-manual', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 8 * deps.DAY,
        image: undefined, images: [], manualEntry: true
      }),
      deps.orderOf({
        _id: 'v1-shared-a', status: deps.enums.ORDER_STATUS.CANCELLED, statusUpdatedAt: deps.NOW - 8 * deps.DAY,
        image: undefined, images: [shot('cloud://v1-shared.jpg')]
      }),
      deps.orderOf({
        _id: 'v1-shared-b', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 1 * deps.DAY,
        image: undefined, images: [shot('cloud://v1-shared.jpg')]
      }),
      deps.orderOf({
        _id: 'v1-cross-legacy', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 8 * deps.DAY,
        image: { fileId: 'cloud://v1-cross.jpg', width: 1, height: 1, failureId: '' }
      }),
      deps.orderOf({
        _id: 'v1-cross-order', status: deps.enums.ORDER_STATUS.ACCEPTED, statusUpdatedAt: deps.NOW - 1 * deps.DAY,
        image: undefined, images: [shot('cloud://v1-cross.jpg')]
      })
    ]
  });
  const cloud = deps.createCloud();
  const ctx = deps.makeCtx(db, { cloud: cloud });
  const result = await deps.SWEEPS_RUN.files(ctx);
  const after = (id) => db.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(result.acted, 3, '§D v1.0：到期处理 3 单（多图单/共享单/历史单），未到期、无图手填、非终态均不动');
  t.eq([after('v1-multi').images[0].fileId, after('v1-multi').images[1].fileId,
    deps.dateMs(after('v1-multi').images[0].cleanedAt), deps.dateMs(after('v1-multi').images[1].cleanedAt)],
  ['', '', deps.NOW, deps.NOW], '§D 一单多图逐张清引用 + 逐张写 cleanedAt（不是只清第 1 张 image.fileId）');
  t.eq([cloud.deleted.indexOf('cloud://v1-a.jpg') !== -1, cloud.deleted.indexOf('cloud://v1-b.jpg') !== -1],
    [true, true], '§D 多图各文件引用归零 → 逐张删云文件');
  t.eq(after('v1-fresh').images[0].fileId, 'cloud://v1-fresh.jpg', '§D v1.0 阈值前不动（6 天）');
  t.eq(cloud.deleted.indexOf('cloud://v1-fresh.jpg'), -1, '§D 未到期不删文件（不是无条件清）');
  t.eq([after('v1-manual').manualEntry, after('v1-manual').images.length], [true, 0],
    '§D manualEntry=true 无截图单不进入截图清理（不误删/不误计）');
  t.eq([after('v1-shared-a').images[0].fileId, after('v1-shared-b').images[0].fileId],
    ['', 'cloud://v1-shared.jpg'], '§D images[] 跨单共享 fileId：先到期单清引用、未到期单保留');
  t.eq(cloud.deleted.indexOf('cloud://v1-shared.jpg'), -1, '§D 共享 fileId 仍被另一单 images[] 引用 → 不删文件');
  t.eq([after('v1-cross-legacy').image.fileId, cloud.deleted.indexOf('cloud://v1-cross.jpg')], ['', -1],
    '§D 历史 image{} 与 v1.0 images[] 跨形态共享：订单侧仍有引用（非终态 v1.0 单）→ 文件保留');
  t.eq((await deps.SWEEPS_RUN.files(ctx)).acted, 0, '§D v1.0 重跑幂等：acted=0（逐张已清不再重复清/重复删）');
  const later = deps.makeCtx(db, { cloud: cloud, now: deps.NOW + 8 * deps.DAY });
  const laterResult = await deps.SWEEPS_RUN.files(later);
  const sharedDeletes = cloud.deleted.filter((fileId) => fileId === 'cloud://v1-shared.jpg').length;
  t.eq([laterResult.acted, sharedDeletes], [2, 1],
    '§D 时间旅行：两张未到期单到期后清理，共享文件全部引用离开窗口才删且只删一次');
}

// §F retention · v1.0 逐件匿名化（保留 stationId）+ 逐张清图 + delivery 置空
async function retentionChecks(t, deps) {
  const v1Anon = deps.orderOf({
    _id: 'ret-v1-anon', status: deps.enums.ORDER_STATUS.COMPLETED, statusUpdatedAt: deps.NOW - 181 * deps.DAY,
    completedAt: deps.NOW - 181 * deps.DAY, parcel: undefined, image: undefined, version: 5,
    parcels: [
      {
        itemIndex: 0, stationId: 'P1', stationName: '西苑顺丰快递', pickupCode: '7788', lockerNo: 'A12',
        trackingTail: '5678', codeStatus: deps.enums.CODE_STATUS.OK, recognitionSource: 'RULE'
      },
      {
        itemIndex: 1, stationId: 'P2', stationName: '西苑京东快递', pickupCode: '9900', lockerNo: 'B34',
        trackingTail: '4321', codeStatus: deps.enums.CODE_STATUS.NEED_CODE, failureId: 'failure-ret-v1'
      }
    ],
    images: [
      { fileId: 'cloud://v1-anon-a.jpg', width: 800, height: 600 },
      { fileId: '', width: 800, height: 600, failureId: 'failure-ret-v1', cleanedAt: new Date(deps.NOW - 170 * deps.DAY) }
    ],
    manualEntry: false,
    delivery: {
      zone: 'X', buildingNo: 3, room: '301', dormKey: 'X3-301', buildingText: 'X3',
      recipientName: '小李', phoneTail: '5678'
    }
  });
  const db = deps.makeWorld({ orders: [v1Anon] });
  const cloud = deps.createCloud();
  const result = await deps.SWEEPS_RUN.retention(deps.makeCtx(db, { cloud: cloud }));
  const after = db.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === 'ret-v1-anon')[0];
  t.eq(result.acted, 1, '§F v1.0 单 180 天到期匿名化（acted 按订单计，不按件数膨胀）');
  t.eq([after.parcels[0].stationId, after.parcels[0].stationName, after.parcels[0].pickupCode,
    after.parcels[0].lockerNo, after.parcels[0].trackingTail, after.parcels[0].codeStatus],
  ['P1', '', '', '', '', deps.enums.CODE_STATUS.OK], '§F 逐件匿名化：保留 stationId/codeStatus，清站名/码/柜号/尾号');
  t.eq([after.parcels[1].stationId, after.parcels[1].pickupCode, after.parcels[1].failureId],
    ['P2', '', ''], '§F 每件都清（不是只清第 1 件）+ failureId 清空');
  t.eq([after.images[0].fileId, after.images[1].fileId, after.images[1].failureId,
    deps.dateMs(after.images[1].cleanedAt)], ['', '', '', deps.NOW - 170 * deps.DAY],
  '§F 逐张清截图引用（保留已写 cleanedAt，供 cleaned 判据）');
  t.eq(after.delivery, null, '§F delivery 置空（第三方收件人/尾号/房号随匿名化清空，D25）');
  t.eq(after.parcel, undefined, '§F v1.0 单不写回 legacy parcel 字段');
  t.eq([after.version, deps.dateMs(after.anonymizedAt)], [6, deps.NOW], '§F version+1 且写 anonymizedAt（幂等判据）');
  t.eq(cloud.deleted.indexOf('cloud://v1-anon-a.jpg') !== -1, true, '§F 匿名化清逐张引用后按引用计数删截图文件');
  t.eq((await deps.SWEEPS_RUN.retention(deps.makeCtx(db, { cloud: cloud }))).acted, 0, '§F v1.0 重跑幂等：acted=0');
}

// §L recognitionFailures · M-02 锁：FIXED 原图仍被 v1.0 订单 images[] 引用时不删文件
async function recognitionLockChecks(t, deps) {
  const failure = (id, overrides) => Object.assign({
    _id: 'failure-' + id,
    failureNo: 'F-20260901-' + id.toUpperCase().padEnd(6, 'X').slice(0, 6),
    requestKey: 'rf-' + id,
    uploaderOpenid: 'CUST-A',
    sourceRole: 'CUSTOMER',
    status: deps.enums.FAILURE_STATUS.PENDING,
    createdAt: deps.NOW - 31 * deps.DAY,
    retentionDays: 30,
    fileId: '',
    orderId: ''
  }, overrides);
  const db = deps.makeWorld({
    recognition_failures: [failure('fixed-v1', {
      status: deps.enums.FAILURE_STATUS.FIXED,
      fileId: 'cloud://f-fixed-v1.jpg',
      resolution: { note: '已补录', by: 'DEV-01', at: deps.NOW - 2 * deps.DAY }
    })],
    orders: [deps.orderOf({
      _id: 'recog-v1-order',
      status: deps.enums.ORDER_STATUS.SUBMITTED,
      image: undefined,
      images: [{ fileId: 'cloud://f-fixed-v1.jpg', width: 800, height: 600 }]
    })]
  });
  const cloud = deps.createCloud();
  const result = await deps.SWEEPS_RUN.recognitionFailures(deps.makeCtx(db, { cloud: cloud }));
  t.eq(result.acted, 1, '§L FIXED 到期：记录侧仍清原图引用（状态与复核结果保留）');
  t.eq(cloud.deleted.indexOf('cloud://f-fixed-v1.jpg'), -1,
    '§L M-02 锁：原图仍被 v1.0 订单 images[] 引用 → 引用计数未归零，不删云文件');
}

// §G accountDeletion · 注销立即清 v1.0 多图 + delivery（与 legacy 单并存）
function delOrdersOf(orderOf, enums, NOW, DAY) {
  return [orderOf({
    _id: 'del-order-v1',
    customerId: 'CUST-DEL',
    customerOpenid: 'CUST-DEL',
    customerNo: 'CDELDEL1',
    status: enums.ORDER_STATUS.COMPLETED,
    statusUpdatedAt: NOW - 5 * DAY,
    image: undefined,
    parcels: [{
      itemIndex: 0, stationId: 'P1', stationName: '西苑顺丰快递', pickupCode: '1234', lockerNo: 'A1',
      trackingTail: '8899', codeStatus: enums.CODE_STATUS.OK
    }],
    images: [
      { fileId: 'cloud://shot-del-v1a.jpg', width: 800, height: 600 },
      { fileId: 'cloud://shot-del-v1b.jpg', width: 800, height: 600 }
    ],
    delivery: { zone: 'X', buildingNo: 3, room: '301', dormKey: 'X3-301', buildingText: 'X3', recipientName: '小李' }
  })];
}

function accountDeletionChecks(t, db, cloud, deps) {
  const after = db.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === 'del-order-v1')[0];
  t.eq([after.images[0].fileId, after.images[1].fileId, deps.dateMs(after.images[0].cleanedAt)], ['', '', deps.NOW],
    '§G 注销立即清 v1.0 多图引用（逐张写 cleanedAt）');
  t.eq([cloud.deleted.indexOf('cloud://shot-del-v1a.jpg') !== -1,
    cloud.deleted.indexOf('cloud://shot-del-v1b.jpg') !== -1], [true, true],
  '§G 注销立即删多图云文件（不是只删第 1 张）');
  t.eq(after.delivery, null, '§G 注销立即清 delivery（第三方地址 L3 不留存）');
}

// §H testAccountsDeletion · 孤儿测试订单多图清理不留孤儿文件
function orphanExtraOrdersOf(orderOf, enums) {
  return [orderOf({
    _id: 'orphan-order-3', customerId: 'TEST-ORPHAN', customerOpenid: 'TEST-ORPHAN', isTest: true,
    status: enums.ORDER_STATUS.COMPLETED, image: undefined,
    images: [{ fileId: 'cloud://orphan-v1.jpg', width: 800, height: 600 }]
  })];
}

function testAccountsChecks(t, cloud) {
  t.eq(cloud.deleted.indexOf('cloud://orphan-v1.jpg') !== -1, true,
    '§H 删测试订单前清 v1.0 images[] 引用并按引用计数删文件（不留孤儿截图）');
}

// §M testData · 到期测试账号清理多图订单
function testDataExtraOrdersOf(orderOf) {
  return [orderOf({
    _id: 'td-order-v1', customerId: 'TEST-DATA-0', customerOpenid: 'TEST-DATA-0', customerNo: 'CTEST000',
    isTest: true, image: undefined, images: [{ fileId: 'cloud://td-v1-shot.jpg', width: 800, height: 600 }]
  })];
}

function testDataChecks(t, cloud) {
  t.eq(cloud.deleted.indexOf('cloud://td-v1-shot.jpg') !== -1, true,
    '§M 清 v1.0 测试单前先清 images[] 引用并删截图文件（不留孤儿）');
}

// 断言数：files 11 + retention 9 + recognition 2 + accountDeletion 3 + testAccounts 1 + testData 1 = 27
const EXPECTED_ASSERTIONS = 27;

module.exports = {
  EXPECTED_ASSERTIONS,
  filesChecks,
  retentionChecks,
  recognitionLockChecks,
  delOrdersOf,
  accountDeletionChecks,
  orphanExtraOrdersOf,
  testAccountsChecks,
  testDataExtraOrdersOf,
  testDataChecks
};
