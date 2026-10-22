'use strict';
/**
 * tools/lib/admin-v1-cases.js — selftest-admin 的 v1.0 用例（D23/D24/D25）：
 * 后台订单多包裹/无截图手填/合并窗口配置/按件补录。非独立套件：由 selftest-admin require 后注册为 §H。
 * 拆出原因：门禁 #18 测试文件 ≤1000 行；本文件是夹具+用例表，不含断言器。
 *
 * 口径：CONTRACT v1.0 §4（D23/D24/D25）、DATA_MODEL §2.10/§2.5/§7.6（admin 只做脱敏投影）。
 */
const V1_LINKED_FAILURE_ID = 'fail-linked';

// v1.0 订单模型夹具：一单两件包裹 + 两张截图 + 本单配送地址（他人宿舍，L3 字段齐全）。
// parcels[].failureId / images[].failureId 指向同一条识别失败记录（_id=fail-linked），用于按件回填断言。
function v1OrderDoc(deps, orderNo, extra) {
  const base = {
    orderNo: orderNo,
    status: 'SUBMITTED',
    customerId: deps.C1,
    customerOpenid: deps.C1,
    customerNo: 'CADEFGHJK',
    partnerId: deps.PID1,
    partnerOpenid: deps.P1,
    partnerNo: 'PAAAAAA',
    isTest: false,
    version: 3,
    source: 'CUSTOMER',
    service: { code: 'PICKUP_STD', name: '标准代取' },
    parcels: [
      {
        itemIndex: 0, stationId: 'P1', stationName: '菜鸟驿站P1', pickupCode: 'A9999', lockerNo: '7号柜',
        trackingTail: '1234', codeStatus: 'OK', recognitionSource: 'RULE', imageIndex: 0
      },
      {
        itemIndex: 1, stationId: 'P2', stationName: '菜鸟驿站P2', pickupCode: '', lockerNo: '',
        trackingTail: '', codeStatus: 'NEED_CODE', recognitionSource: 'DEEPSEEK',
        failureId: V1_LINKED_FAILURE_ID, imageIndex: 1
      }
    ],
    images: [
      { fileId: 'cloud://env/orders/v1a/image.jpg', width: 800, height: 600 },
      { fileId: 'cloud://env/orders/v1b/image.jpg', width: 800, height: 600, failureId: V1_LINKED_FAILURE_ID }
    ],
    manualEntry: false,
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
    delivery: {
      zone: 'X', buildingNo: 3, buildingText: 'X3', room: '301', dormKey: 'X3-301',
      recipientName: '小李', phoneTail: '5678'
    },
    phoneTail: '6678',
    createdAt: new Date(deps.NOW - 3 * deps.HOUR),
    statusUpdatedAt: new Date(deps.NOW - 2 * deps.HOUR),
    updatedAt: new Date(deps.NOW - 2 * deps.HOUR)
  };
  return Object.assign(base, extra || {});
}

// 无截图手填单（D24）：images=[] + manualEntry=true + 无 delivery
function v1ManualOrderDoc(deps, orderNo, extra) {
  const base = v1OrderDoc(deps, orderNo);
  return Object.assign(base, {
    parcels: [{
      itemIndex: 0, stationId: 'P3', stationName: '菜鸟驿站P3', pickupCode: 'C2002', lockerNo: '',
      trackingTail: '', codeStatus: 'OK', recognitionSource: 'MANUAL'
    }],
    images: [],
    manualEntry: true,
    delivery: null
  }, extra || {});
}

function sectionH(h, deps) {
  h.section('§H v1.0 一单多包裹/无截图手填/合并窗口配置（D23/D24/D25）', async (t) => {
    const db = deps.world();
    db.seed('orders', [
      v1OrderDoc(deps, '20260101-0101', { _id: 'ord-v1' }),
      v1ManualOrderDoc(deps, '20260101-0102', { _id: 'ord-v1-manual' })
    ]);
    db.seed('recognition_failures', [deps.failureDoc('F-20260101-VLNKMX', 'PENDING', {
      _id: V1_LINKED_FAILURE_ID, orderId: 'ord-v1', fileId: 'cloud://env/orders/v1b/image.jpg'
    })]);
    const api = deps.apiOf(db, deps.ADMIN);
    const rowOf = (id) => db.dump('orders').find((row) => row._id === id);
    const rows = (await api.call('admin.listOrders', {})).data.list;
    const merged = rows.find((row) => row.orderNo === '20260101-0101');
    const manual = rows.find((row) => row.orderNo === '20260101-0102');
    t.eq([merged.parcelCount, merged.needCodeCount, merged.manualEntry], [2, 1, false],
      'H1 列表行：合并单件数=2、需查明按件计数=1 件、manualEntry=false（单量仍按订单计）');
    t.eq(merged.delivery, { zone: 'X', buildingNo: 3, buildingText: 'X3' },
      'H2 列表行 delivery 只到苑/楼栋（收件人/尾号/房号/房型键均不下发）');
    t.eq(deps.bannedKeysOf(merged, ['pickupCode', 'lockerNo', 'trackingTail', 'room', 'roomTag',
      'recipientName', 'phoneTail', 'openid', 'fileId'], 'listOrders.v1'), [],
    'H3 列表行零逐件码/柜号/尾号/房间号/收件人/内部键（脱敏在详情，列表只出聚合件数）');
    t.eq([manual.parcelCount, manual.needCodeCount, manual.manualEntry, manual.delivery], [1, 0, true, null],
      'H4 无截图手填行：manualEntry=true、件数=1、无 delivery');
    const stats = (await api.call('admin.stats', {})).data;
    t.eq([stats.today.orders, stats.today.parcels], [6, 7],
      'H5 统计：今日单量按订单计=6（不按包裹数），件数独立指标=7');
    const detail = (await api.call('admin.getOrder', { orderNo: '20260101-0101' })).data.order;
    t.eq(detail.parcels.length, 2, 'H6 详情输出 parcels[] 两件（不再只给第 1 件）');
    t.eq([detail.parcels[0].stationId, detail.parcels[0].pickupCode, detail.parcels[0].lockerNo,
      detail.parcels[0].trackingTail, detail.parcels[0].codeStatus],
    ['P1', 'A***9', '***', '***34', 'OK'], 'H7 逐件字段+打码口径：码保首末、柜号只表示有值、尾号仅后 2 位');
    t.eq([detail.parcels[1].stationId, detail.parcels[1].codeStatus], ['P2', 'NEED_CODE'],
      'H8 顺序=itemIndex，第 2 件 NEED_CODE 原样标出（后台按件呈现「1 件需查明」）');
    t.eq(detail.parcel, detail.parcels[0], 'H9 保留 parcel=首件兼容（旧后台页/断言不炸，同构）');
    t.eq([detail.manualEntry, detail.delivery], [false, { zone: 'X', buildingNo: 3, buildingText: 'X3' }],
      'H10 详情 delivery 同样只到苑+楼栋');
    t.eq(deps.keysOf(detail.delivery), ['buildingNo', 'buildingText', 'zone'], 'H11 delivery 投影恰 3 键');
    t.eq([detail.images.length, detail.images[0].hasImage, detail.images[1].hasImage, detail.imageUploaded],
      [2, true, true, true], 'H12 images[] 逐张 hasImage/cleaned 摘要（无 fileId）+ imageUploaded=任一张有图');
    t.eq(deps.bannedKeysOf(detail, ['fileId', 'cloudPath', 'openid', 'avatarFileId', 'roomTag', 'room'],
      'getOrder.v1'), [], 'H13 详情零 fileId/cloudPath/openid/头像/roomTag/房间号键');
    const manualDetail = (await api.call('admin.getOrder', { orderNo: '20260101-0102' })).data.order;
    t.eq([manualDetail.manualEntry, manualDetail.parcels.length, manualDetail.delivery, manualDetail.imageUploaded],
      [true, 1, null, false], 'H14 手填单详情：manualEntry=true/images=[]/delivery=null/无图');
    const fix = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-VLNKMX', stationId: 'P2', pickupCode: 'B1002' },
      { clientRequestId: deps.nextCrid('h15') });
    t.eq([fix.ok, fix.data.orderPatchedFields.slice().sort()], [true, ['pickupCode', 'stationId', 'stationName']],
      'H15 v1.0 补录：只回填识别三字段（orderPatchedFields 与旧口径一致）');
    const patched = rowOf('ord-v1');
    t.eq([patched.parcels[1].stationId, patched.parcels[1].stationName, patched.parcels[1].pickupCode,
      patched.parcels[1].recognitionSource, patched.parcels[0].pickupCode],
    ['P2', '西苑京东快递（西苑五食堂）', 'B1002', 'MANUAL', 'A9999'],
    'H16 只回填 failureId 命中的那一件（第 1 件不动）');
    t.eq([patched.version, patched.status, patched.parcel], [4, 'SUBMITTED', undefined],
      'H17 version+1、状态不变、v1.0 单不写回 legacy parcel 字段');
    const cfgZero = await api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: 0 } },
      { clientRequestId: deps.nextCrid('h18') });
    t.eq([cfgZero.ok, cfgZero.data.config.orderMergeWindowMinutes], [true, 0],
      'H18 orderMergeWindowMinutes=0 可写（0=关闭合并，DATA_MODEL §2.10）');
    const cfgAudit = deps.auditsOf(db, 'CONFIG_UPDATE')[0];
    t.eq(cfgAudit.detail.changes.orderMergeWindowMinutes, { before: 10, after: 0 },
      'H19 CONFIG_UPDATE 审计可追溯合并窗口变更前后值（默认 10 → 0）');
    const cfgMax = await api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: 60 } },
      { clientRequestId: deps.nextCrid('h20') });
    t.eq([cfgMax.ok, cfgMax.data.config.orderMergeWindowMinutes], [true, 60], 'H20 上限 60 可写');
    const cfgDefault = await api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: 10 } },
      { clientRequestId: deps.nextCrid('h21') });
    t.eq([cfgDefault.ok, cfgDefault.data.config.orderMergeWindowMinutes], [true, 10],
      'H21 默认 10 可写（恢复默认）');
    await deps.expectCode(t, api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: -1 } },
      { clientRequestId: deps.nextCrid('h22') }), 'VALIDATION_FAILED', 'H22 -1 越界 → VALIDATION_FAILED');
    await deps.expectCode(t, api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: 61 } },
      { clientRequestId: deps.nextCrid('h23') }), 'VALIDATION_FAILED', 'H23 61 越界 → VALIDATION_FAILED');
    await deps.expectCode(t, api.call('admin.updateConfig', { config: { orderMergeWindowMinutes: 1.5 } },
      { clientRequestId: deps.nextCrid('h24') }), 'VALIDATION_FAILED', 'H24 非整数 → VALIDATION_FAILED');
    t.eq((await api.call('admin.stats', {})).data.config.orderMergeWindowMinutes, 10,
      'H25 admin.stats.config 下发合并窗口（配置页可读可编辑，DATA_MODEL §7.6）');
    t.eq(stats.counts.orders, 6, 'H26 counts.orders 按订单计（2 张 v1.0 单各算 1，不按包裹数膨胀）');
  });
}

// 断言数：H1~H26 = 23 条 t.eq/t.check + 3 次 expectCode（每次 2 条）= 29
const EXPECTED_ASSERTIONS = 29;

module.exports = {
  EXPECTED_ASSERTIONS,
  register: (h, deps) => sectionH(h, deps)
};
