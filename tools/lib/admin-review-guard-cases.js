'use strict';
/**
 * tools/lib/admin-review-guard-cases.js — 批 36 识别失败复核的状态/来源保护判据。
 * 口径：CONTRACT §13 D80（复核只纠正识别结果，不覆盖用户手填；已取件/终态不得再改站点/码）。
 * 拆出原因：selftest-admin.js 守 #18 ≤1000 行（与 admin-v1-cases / customer-cases 同形）。
 * 断言：F36 终态拒绝、F37 手填不可覆盖、F38 识别来源可纠正、F39 落库校验（expectCode 计 2 条）。
 */
const EXPECTED_ASSERTIONS = 12;

function register(h, deps) {
  const world = deps.world;
  const apiOf = deps.apiOf;
  const expectCode = deps.expectCode;
  const nextCrid = deps.nextCrid;
  const orderDoc = deps.orderDoc;
  const failureDoc = deps.failureDoc;
  const auditsOf = deps.auditsOf;
  const NOW = deps.NOW;
  h.section('批 36 复核补录：终态/手填/识别来源', async (t) => {
    const db = world();
    const api = apiOf(db, deps.ADMIN);
    db.seed('orders', [
      orderDoc('20260101-1001', 'COMPLETED', { _id: 'ord-rg-done' }),
      orderDoc('20260101-1002', 'SUBMITTED', {
        _id: 'ord-rg-manual', parcel: undefined,
        parcels: [{ stationId: 'P1', stationName: '菜鸟驿站P1', pickupCode: 'A1234', lockerNo: '', trackingTail: '', codeStatus: 'OK', recognitionSource: 'MANUAL' }]
      }),
      orderDoc('20260101-1003', 'SUBMITTED', {
        _id: 'ord-rg-rewrite', parcel: undefined,
        parcels: [{ stationId: 'P2', stationName: '错站', pickupCode: 'A1234', lockerNo: '', trackingTail: '', codeStatus: 'OK', recognitionSource: 'RULE' }]
      })
    ]);
    db.seed('recognition_failures', [
      failureDoc('F-20260101-RGDNE9', 'PENDING', { orderId: 'ord-rg-done' }),
      failureDoc('F-20260101-RGMANU', 'PENDING', { orderId: 'ord-rg-manual', itemIndex: 0 }),
      failureDoc('F-20260101-RGREWR', 'PENDING', { orderId: 'ord-rg-rewrite', itemIndex: 0 }),
      // D83：冲突快照 → 一键建议两条；orderId='' → 站内通知不可达；createdAt 超 24h → 积压计数
      failureDoc('F-20260101-RGSUGG', 'PENDING', {
        orderId: '',
        aiResult: null,
        createdAt: new Date(NOW - 30 * 60 * 60 * 1000),
        ruleResult: {
          stationId: 'P2', pickupCode: '64-4-4033',
          conflictStations: { code: { id: 'P3', name: 'P3' }, text: { id: 'P2', name: 'P2' } }
        }
      }),
      failureDoc('F-20260101-RGOLD2', 'PENDING', {
        orderId: '', aiResult: null, createdAt: new Date(NOW - 30 * 60 * 60 * 1000)
      })
    ]);
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-RGDNE9', stationId: 'P1' }, { clientRequestId: nextCrid('r36') }),
    'INVALID_STATE', 'F36 订单已取件/终态 → 复核不得改站点/取件码（只可忽略写备注）');
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-RGMANU', stationId: 'P2' }, { clientRequestId: nextCrid('r37') }),
    'VALIDATION_FAILED', 'F37 用户手填（recognitionSource=MANUAL）不可覆盖 → VALIDATION_FAILED');
    const rewrite = await api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-RGREWR', stationId: 'P3', pickupCode: 'C3456', rootCause: 'CODE_PATTERN' },
      { clientRequestId: nextCrid('r38') });
    t.eq([rewrite.ok, rewrite.data.orderPatchedFields.slice().sort(), rewrite.data.resolution.rootCause],
      [true, ['pickupCode', 'stationId', 'stationName'], 'CODE_PATTERN'], 'F38 识别来源（RULE）可被复核纠正（站点/码改写 + 归因）');
    const fixed = db.dump('orders').find((row) => row._id === 'ord-rg-rewrite');
    t.eq([fixed.parcels[0].stationId, fixed.parcels[0].pickupCode, fixed.parcels[0].recognitionSource],
      ['P3', 'C3456', 'MANUAL'], 'F39 复核改写落到命中件（站点/码/来源=MANUAL）');
    t.eq(auditsOf(db, 'FAILURE_FIX')[0].detail.rootCause, 'CODE_PATTERN',
      'F40 修复审计记归因码（不含取件码/OCR 明文）');
    const detail = await api.call('admin.getRecognitionFailure', { failureNo: 'F-20260101-RGSUGG' });
    t.eq([detail.data.suggestions.map((row) => row.stationId), detail.data.canNotify,
      detail.data.rootCauseOptions.length], [['P2', 'P3'], false, 6],
    'F41 复核详情：冲突给两条建议 + 无订单不可通知 + 归因 6 项');
    const ignored = await api.call('admin.ignoreRecognitionFailure',
      { failureNo: 'F-20260101-RGSUGG', note: '重复图', rootCause: 'ALIAS' }, { clientRequestId: nextCrid('r42') });
    t.eq([ignored.ok, ignored.data.resolution.rootCause], [true, 'ALIAS'], 'F42 忽略也可记归因（可选枚举）');
    await expectCode(t, api.call('admin.fixRecognitionFailure',
      { failureNo: 'F-20260101-ABCDEF', stationId: 'P1', rootCause: 'BAD' }, { clientRequestId: nextCrid('r43') }),
    'VALIDATION_FAILED', 'F43 非法归因 → VALIDATION_FAILED（受控枚举）');
    const counts = (await api.call('admin.listRecognitionFailures', {})).data.counts;
    t.check(typeof counts.pendingOver24h === 'number' && counts.pendingOver24h >= 1,
      'F44 积压计数含超 24h 待复核（服务端 count，单次查询）');
  });
}

module.exports = { register, EXPECTED_ASSERTIONS };
