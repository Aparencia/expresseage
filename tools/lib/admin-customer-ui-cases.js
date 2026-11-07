'use strict';
/**
 * tools/lib/admin-customer-ui-cases.js — D68 顾客状态界面（列表/详情视图模型）用例表。
 * 从 selftest-admin-pages.js 拆出（主套件已 997 行，门禁 #18 ≤1000）；断言数并入主套件 EXPECTED_ASSERTIONS。
 */

const CLIENT_ASSERTIONS = 6;

function register(h, deps) {
  const { customersVm, customerDetailVm } = deps;

  h.section('Q D68 顾客状态界面：列表/详情的状态标签与停用恢复前置条件', (t) => {
    const active = customersVm.decorateRow({ customerNo: 'C-1', status: 'ACTIVE' });
    t.check(active.statusText === '' && active.canSuspend === true && active.canResume === false,
      'Q1 正常顾客：无状态标签、可停用、不可恢复');

    const suspended = customersVm.decorateRow({
      customerNo: 'C-2', status: 'SUSPENDED', suspendedReason: '违规下单'
    });
    t.eq([suspended.statusText, suspended.canSuspend, suspended.canResume, suspended.suspendedReason],
      ['已停用', false, true, '违规下单'], 'Q2 停用顾客：标签「已停用」+ 可恢复 + 展示停用原因');

    const deactivated = customersVm.decorateRow({ customerNo: 'C-3', status: 'DEACTIVATED' });
    t.eq([deactivated.statusText, deactivated.canSuspend, deactivated.canResume],
      ['已注销', false, false], 'Q3 已注销顾客：标签「已注销」且无任何治理按钮（不可恢复）');

    const testRow = customersVm.decorateRow({ customerNo: 'CTESTAAAA', status: 'ACTIVE', isTest: true });
    t.eq([testRow.canSuspend, testRow.canResume, testRow.canSwitch],
      [false, false, false], 'Q4 测试账号：不可停用/恢复/切换（真实治理动作对测试账号关闭）');

    // 真实服务端形状：{customer:{...,binding,orderSummary}, recentOrders}（批 8 起；旧顶层形状仅兼容）
    const real = customerDetailVm.buildDetailView({
      customer: {
        customerNo: 'C-4', status: 'SUSPENDED', suspendedReason: '刷单',
        binding: { partnerNo: 'P-1', displayName: '老**', status: 'ACTIVE' },
        orderSummary: { activeOrders: 2, completedOrders: 5, exceptionOrders: 1 }
      },
      recentOrders: []
    }, 'C-4');
    t.eq([real.binding && real.binding.partnerNo, real.orderSummaryText, real.customer.canResume],
      ['P-1', '进行中 2 · 已完成 5 · 异常 1', true],
      'Q5 详情读服务端真实形状：绑定摘要/订单摘要/停用顾客可恢复');

    const deleted = customerDetailVm.buildDetailView({
      customer: { customerNo: 'C-5', status: 'DEACTIVATED', deleted: true, anonymized: true }
    }, 'C-5');
    t.eq([deleted.customer.statusText, deleted.customer.canSuspend, deleted.customer.canSwitch],
      ['已注销', false, false], 'Q6 详情已注销：状态文案 + 禁停用 + 禁切换只读视角');
  });
}

module.exports = { CLIENT_ASSERTIONS, register };
