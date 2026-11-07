'use strict';
/**
 * tools/lib/admin-customer-cases.js — D68 顾客停用/恢复（admin.setCustomerStatus）用例表。
 * 从 selftest-admin.js 拆出（控主套件 ≤1000 行，门禁 #18）；断言数并入主套件 EXPECTED_ASSERTIONS。
 *
 * 口径：CONTRACT §13 D68 / DATA_MODEL §2.1/§7 / UX_DEVELOPER §3.3/§3.4。
 * 覆盖：停用/恢复落库、资料/绑定/订单零副作用、审计、鉴权分流（FORBIDDEN/文案）、
 *      原因必填、非法状态、测试账号、已注销不可逆、未知顾客、非白名单、幂等重放、DTO 脱敏、列表状态。
 */

const EXPECTED_ASSERTIONS = 20;

function register(h, deps) {
  const { world, apiOf, auditsOf, nextCrid, bannedKeysOf, ADMIN, C1, C2, TEST_C } = deps;

  h.section('§J 顾客停用/恢复（D68：只冻结登录与写，资料/绑定/订单不动）', async (t) => {
    const db = world();
    const api = apiOf(db, ADMIN);
    const userOf = (openid) => db.dump('users').find((row) => row._id === openid) || {};
    const bindingOf = (id) => db.dump('bindings').find((row) => row._id === id) || {};
    const orderSnapshot = () => db.dump('orders').map((row) => row.orderNo + ':' + row.status).sort();

    // H1 基线
    t.eq(userOf(C1).status, 'ACTIVE', 'H1 基线：顾客 C1 为 ACTIVE');

    // H2/H3 停用落库
    const beforeOrders = orderSnapshot();
    const beforeBinding = bindingOf('bind-1').status;
    const suspended = await api.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'SUSPENDED', reason: '违规下单' },
      { clientRequestId: nextCrid('h', 1) });
    t.eq(suspended.ok, true, 'H2 停用成功（ACTIVE → SUSPENDED）');
    t.eq([userOf(C1).status, !!userOf(C1).suspendedAt, userOf(C1).suspendedReason],
      ['SUSPENDED', true, '违规下单'], 'H3 users.status/suspendedAt/suspendedReason 落库');

    // H4 零副作用：绑定与订单不动
    t.eq([bindingOf('bind-1').status, orderSnapshot()], [beforeBinding, beforeOrders],
      'H4 停用不动绑定状态与任何订单状态（D68 口径 A）');

    // H5/H6 审计
    const suspendAudits = auditsOf(db, 'CUSTOMER_SUSPEND');
    t.eq(suspendAudits.length, 1, 'H5 写恰一条 CUSTOMER_SUSPEND 审计');
    const suspendDetail = suspendAudits[0] && suspendAudits[0].detail ? suspendAudits[0].detail : {};
    t.eq([suspendDetail.customerNo, suspendDetail.from, suspendDetail.to, suspendDetail.reason],
      ['CADEFGHJK', 'ACTIVE', 'SUSPENDED', '违规下单'], 'H6 审计 detail 含 customerNo/from/to/reason');

    // H7 停用后除 bootstrap 外一律 FORBIDDEN（文案说真话）
    const blocked = await apiOf(db, C1).call('customer.getProfile', {});
    t.eq([blocked.ok, blocked.code, String(blocked.message || '').indexOf('账号已停用') >= 0],
      [false, 'FORBIDDEN', true], 'H7 停用顾客调业务动作 → FORBIDDEN『账号已停用』');

    // H8 bootstrap 放行（客户端据此渲染状态页）
    const boot = await apiOf(db, C1).call('user.bootstrap', {});
    t.eq([boot.ok, boot.data && boot.data.status], [true, 'SUSPENDED'],
      'H8 停用顾客仍可 bootstrap，且回 status=SUSPENDED');

    // H9/H10 恢复
    const restored = await api.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'ACTIVE' },
      { clientRequestId: nextCrid('h', 2) });
    t.eq(restored.ok, true, 'H9 恢复成功（SUSPENDED → ACTIVE）');
    t.eq([userOf(C1).status, userOf(C1).suspendedAt, userOf(C1).suspendedReason],
      ['ACTIVE', null, ''], 'H10 恢复清 suspendedAt/suspendedReason（父级空值写入不崩）');

    // H11 恢复审计
    t.eq(auditsOf(db, 'CUSTOMER_RESTORE').length, 1, 'H11 写恰一条 CUSTOMER_RESTORE 审计');

    // H12 停用原因必填
    const noReason = await api.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'SUSPENDED' }, { clientRequestId: nextCrid('h', 3) });
    t.eq([noReason.ok, noReason.code], [false, 'VALIDATION_FAILED'], 'H12 停用缺原因 → VALIDATION_FAILED');

    // H13 状态值域：不允许直接设 DEACTIVATED
    const badStatus = await api.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'DEACTIVATED', reason: 'x' }, { clientRequestId: nextCrid('h', 4) });
    t.eq([badStatus.ok, badStatus.code], [false, 'VALIDATION_FAILED'], 'H13 status 只允许 ACTIVE/SUSPENDED');

    // H14 测试账号不可治理
    const testSuspend = await api.call('admin.setCustomerStatus',
      { customerNo: 'CTESTAAAA', status: 'SUSPENDED', reason: 'x' }, { clientRequestId: nextCrid('h', 5) });
    t.eq([testSuspend.ok, testSuspend.code], [false, 'INVALID_STATE'], 'H14 测试账号不能执行真实治理动作');

    // H15 已注销不可恢复/不可再停用
    const deactDb = world();
    const c1User = deactDb.dump('users').find((row) => row._id === C1);
    deactDb.seed('users', [Object.assign({}, c1User, { status: 'DEACTIVATED', deletionRequestedAt: new Date() })]);
    const deact = await apiOf(deactDb, ADMIN).call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'ACTIVE' }, { clientRequestId: nextCrid('h', 6) });
    t.eq([deact.ok, deact.code], [false, 'INVALID_TRANSITION'], 'H15 DEACTIVATED 不可恢复（注销不可逆）');

    // H16 未知顾客
    const missing = await api.call('admin.setCustomerStatus',
      { customerNo: 'CZZZZZZZZ', status: 'ACTIVE' }, { clientRequestId: nextCrid('h', 7) });
    t.eq([missing.ok, missing.code], [false, 'NOT_FOUND'], 'H16 未知顾客 → NOT_FOUND');

    // H17 非白名单
    const forbidden = await apiOf(db, C2).call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'SUSPENDED', reason: 'x' }, { clientRequestId: nextCrid('h', 8) });
    t.eq([forbidden.ok, forbidden.code], [false, 'FORBIDDEN'], 'H17 非白名单调治理动作 → FORBIDDEN');

    // H18 幂等重放：同 clientRequestId 不重复写审计
    const replayDb = world();
    const replayApi = apiOf(replayDb, ADMIN);
    const crid = nextCrid('h', 9);
    const first = await replayApi.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'SUSPENDED', reason: '重放' }, { clientRequestId: crid });
    const again = await replayApi.call('admin.setCustomerStatus',
      { customerNo: 'CADEFGHJK', status: 'SUSPENDED', reason: '重放' }, { clientRequestId: crid });
    t.eq([first.ok, again.ok, again.data && again.data.duplicated, auditsOf(replayDb, 'CUSTOMER_SUSPEND').length],
      [true, true, true, 1], 'H18 同请求重放幂等（duplicated=true、审计不重复）');

    // H19 DTO：含 status，无内部键/头像 fileId
    const dtoRow = (await replayApi.call('admin.getCustomer', { customerNo: 'CADEFGHJK' })).data.customer;
    t.eq([dtoRow.status, bannedKeysOf(dtoRow, ['openid', '_id', 'avatarFileId'], 'getCustomer')],
      ['SUSPENDED', []], 'H19 详情 DTO 含 status 且零 openid/_id/头像 fileId');

    // H20 列表行带状态
    const list = await replayApi.call('admin.listCustomers', {});
    const listRow = list.data.list.find((row) => row.customerNo === 'CADEFGHJK') || {};
    t.eq(listRow.status, 'SUSPENDED', 'H20 顾客列表行携带 status（后台可辨识停用）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };
