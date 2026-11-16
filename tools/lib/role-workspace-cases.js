'use strict';
/**
 * tools/lib/role-workspace-cases.js — D86 user.bootstrap 工作区偏好判据
 * （从 selftest-cloud 拆出，保持套件 ≤1000 行）。由 selftest-cloud §7.3 传入同一 fake DB 上下文。
 */
async function run(t, ctx) {
  const apiOf = ctx.apiOf;
  const bDb = ctx.bDb;
  const userOf = ctx.userOf;
  const ROLES = ctx.ROLES;
  const ADMIN_OPENID = ctx.ADMIN_OPENID;
  const PARTNER_STATUS = ctx.PARTNER_STATUS;
  bDb.seed('users', [userOf('openid-boot-dual', [ROLES.CUSTOMER, ROLES.PARTNER])]);
  bDb.seed('customers', [{ _id: 'openid-boot-dual', customerNo: 'CABCDEFGJ', displayName: '小王', profileCompleted: true, zone: 'D', buildingNo: 4, room: '522', dormKey: 'D4-522' }]);
  bDb.seed('partners', [{ _id: 'partner-boot-dual', openid: 'openid-boot-dual', partnerNo: 'PABC234', displayName: '小李', status: PARTNER_STATUS.ACTIVE, serviceConfig: { acceptingOrders: true } }]);
  bDb.seed('bindings', [{ _id: 'binding-boot-dual', activeKey: 'openid-boot-dual', customerId: 'openid-boot-dual', partnerId: 'partner-boot-dual', status: 'ACTIVE', partnerNo: 'PABC234', roomTag: 'A', dormSnapshot: { dormKey: 'D4-522' } }]);
  const dualApi = apiOf(bDb, 'openid-boot-dual');
  const bDualDefault = await dualApi.call('user.bootstrap', {});
  t.eq([bDualDefault.data.activeRole, !!bDualDefault.data.binding], [ROLES.CUSTOMER, true], 'D86 双角色无偏好默认顾客且返回绑定投影');
  const bDualPartner = await dualApi.call('user.bootstrap', { preferredRole: 'PARTNER' });
  t.eq([bDualPartner.data.activeRole, bDualPartner.data.binding], [ROLES.PARTNER, null], 'D86 preferredRole=PARTNER 尊重偏好且不返回顾客绑定块');
  const bDualCustomer = await dualApi.call('user.bootstrap', { preferredRole: 'CUSTOMER' });
  t.eq([bDualCustomer.data.activeRole, !!bDualCustomer.data.binding], [ROLES.CUSTOMER, true], 'D86 preferredRole=CUSTOMER 返回完整顾客投影');
  const bDualBad = await dualApi.call('user.bootstrap', { preferredRole: 'ADMIN' });
  t.eq(bDualBad.data.activeRole, ROLES.CUSTOMER, 'D86 非法 preferredRole 忽略并回落默认顾客');
  const bDualView = await apiOf(bDb, ADMIN_OPENID).call('user.bootstrap', { preferredRole: 'PARTNER' }, { viewTicket: 'TK-VIEW1' });
  t.eq(bDualView.data.activeRole, ROLES.CUSTOMER, 'D86 切换会话忽略 preferredRole（票据角色优先）');
}

module.exports = { run };
