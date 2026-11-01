'use strict';
/**
 * tools/lib/cleanup-auto-complete-cases.js — selftest-cleanup 的 D43 日结批用例表：
 * 「最近一个已过的 23:50（UTC+8）」cutoff、deliveredAt ≤ cutoff 含等号、23:50 后顺延次日、
 * 幂等重跑、guest 同路径、autoCompleteAt 配置驱动与非法回落。
 * 非独立套件：由 selftest-cleanup require 后调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 *
 * 口径：CONTRACT §13 D43；DATA_MODEL §7.8（cleanup 单触发器）/§8 订单状态机。
 */
const CUTOFF_MS = Date.parse('2026-10-21T23:50:00+08:00');

async function autoCompleteChecks(t, deps) {
  const cutoffOf = deps.cleanupUtil.autoCompleteCutoffOf;
  t.eq(cutoffOf(Date.parse('2026-10-22T12:00:00+08:00'), '23:50'), CUTOFF_MS,
    '§C 纯函数 cutoff：今天 23:50 未到 → 昨天 23:50（UTC+8 日界，不读本机时区）');
  t.eq(cutoffOf(Date.parse('2026-10-22T23:50:00+08:00'), '23:50'), Date.parse('2026-10-22T23:50:00+08:00'),
    '§C 纯函数 cutoff：准点 23:50 已过 → 今天 23:50（deliveredAt ≤ cutoff 含等号）');
  t.eq(cutoffOf(Date.parse('2026-10-22T23:49:59+08:00'), '23:50'), CUTOFF_MS,
    '§C 纯函数 cutoff：23:49:59 未到 → 取昨天 23:50');
  t.eq(cutoffOf(Date.parse('2026-10-22T06:00:00+08:00'), '05:30'), Date.parse('2026-10-22T05:30:00+08:00'),
    '§C 纯函数 cutoff：时刻由配置给（05:30 已过取今天）');
  t.eq(cutoffOf(Date.parse('2026-10-22T12:00:00+08:00'), '12:00'), Date.parse('2026-10-22T12:00:00+08:00'),
    '§C 纯函数 cutoff：准点即当天（等号口径）');
  t.eq(cutoffOf(Date.parse('2026-10-22T12:00:00+08:00'), '25:99'), CUTOFF_MS,
    '§C 纯函数 cutoff：配置非法（25:99）回落默认 23:50');

  const due = deps.orderOf({ _id: 'auto-due', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: deps.NOW - 25 * deps.HOUR });
  const beforeCutoff = deps.orderOf({ _id: 'auto-before', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: deps.NOW - 13 * deps.HOUR });
  const boundary = deps.orderOf({ _id: 'auto-boundary', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: CUTOFF_MS });
  const afterCutoff = deps.orderOf({
    _id: 'auto-after-cutoff',
    status: deps.enums.ORDER_STATUS.DELIVERED,
    deliveredAt: CUTOFF_MS + deps.MINUTE
  });
  const today = deps.orderOf({ _id: 'auto-today', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: deps.NOW - 11 * deps.HOUR });
  const guest = deps.orderOf({
    _id: 'auto-guest',
    status: deps.enums.ORDER_STATUS.DELIVERED,
    deliveredAt: deps.NOW - 25 * deps.HOUR,
    customerId: '',
    customerOpenid: '',
    customerNo: '',
    guest: { name: '代客', phoneTail: '1234' }
  });
  const legacy = deps.orderOf({
    _id: 'auto-legacy',
    status: deps.enums.ORDER_STATUS.DELIVERED,
    deliveredAt: null,
    statusUpdatedAt: deps.NOW - 25 * deps.HOUR
  });
  const submitted = deps.orderOf({ _id: 'auto-submitted', status: deps.enums.ORDER_STATUS.SUBMITTED, statusUpdatedAt: deps.NOW - 300 * deps.HOUR });
  const completed = deps.orderOf({ _id: 'auto-completed', status: deps.enums.ORDER_STATUS.COMPLETED, deliveredAt: deps.NOW - 100 * deps.HOUR });
  const db = deps.makeWorld({ orders: [due, beforeCutoff, boundary, afterCutoff, today, guest, legacy, submitted, completed] });
  const ctx = deps.makeCtx(db);
  const result = await deps.SWEEPS_RUN.autoComplete(ctx);
  const after = (id) => db.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  const autoEvents = () => db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.type === 'AUTO_COMPLETED');
  t.eq(result.scanned, 5, '§C 日结批命中 5 单：deliveredAt ≤ cutoff（含等号）才完成');
  t.eq(result.acted, 5, '§C 命中单全部转 COMPLETED（批处理）');
  t.eq(after('auto-due').status, deps.enums.ORDER_STATUS.COMPLETED, '§C 前一天送达 → 已完成');
  t.eq(after('auto-before').status, deps.enums.ORDER_STATUS.COMPLETED, '§C 送达当天 cutoff 前送达 → 当日日结完成');
  t.eq(after('auto-boundary').status, deps.enums.ORDER_STATUS.COMPLETED, '§C deliveredAt=cutoff 含等号 → 完成（边界口径）');
  t.eq(after('auto-after-cutoff').status, deps.enums.ORDER_STATUS.DELIVERED, '§C cutoff 后 1 分钟送达 → 顺延次日（本轮不动）');
  t.eq(after('auto-today').status, deps.enums.ORDER_STATUS.DELIVERED, '§C 今天（cutoff 后）送达 → 次日 23:50 日结才完成');
  t.eq(after('auto-submitted').status, deps.enums.ORDER_STATUS.SUBMITTED, '§C 非 DELIVERED 单不动（待接单）');
  t.eq(after('auto-completed').status, deps.enums.ORDER_STATUS.COMPLETED, '§C 非 DELIVERED 单不动（已完成）');
  t.eq(deps.dateMs(after('auto-due').completedAt), deps.NOW, '§C completedAt=注入 now（不读系统时钟）');
  t.eq(db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'auto-due').map((row) => row.type),
    ['AUTO_COMPLETED'], '§C 逐单写 AUTO_COMPLETED 事件');
  t.eq(after('auto-guest').status, deps.enums.ORDER_STATUS.COMPLETED, '§C guest 单同样由日结批完成（无顾客确认路径）');
  t.eq(db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'auto-guest').length, 1,
    '§C guest 单同样写 1 条 AUTO_COMPLETED 事件');
  t.eq(after('auto-legacy').status, deps.enums.ORDER_STATUS.COMPLETED, '§C 缺 deliveredAt 的脏数据回落 statusUpdatedAt（不永久滞留）');
  t.eq(autoEvents().length, 5, '§C 事件条数 = 命中单数（逐单写，不多不少）');
  t.eq(autoEvents().every((row) => row.actorRole === deps.enums.CANCELLED_BY.SYSTEM
    && row.payload && row.payload.scheduledBy === 'SYSTEM'), true, '§C 事件 actorRole=SYSTEM + payload.scheduledBy=SYSTEM');
  const rerun = await deps.SWEEPS_RUN.autoComplete(ctx);
  t.eq(rerun.acted, 0, '§C 重跑幂等：acted=0');
  t.eq(autoEvents().length, 5, '§C 重跑不重复写事件');

  // 23:50~24:00 实际触发窗口：已过今天 23:50 ⇒ 当天 cutoff 前送达当天完成，23:52 送达顺延
  const lateNow = Date.parse('2026-10-22T23:55:00+08:00');
  const lateDb = deps.makeWorld({
    orders: [
      deps.orderOf({ _id: 'auto-late-today', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: lateNow - 115 * deps.MINUTE }),
      deps.orderOf({ _id: 'auto-late-after', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: lateNow - 3 * deps.MINUTE }),
      deps.orderOf({ _id: 'auto-late-yesterday', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: lateNow - 36 * deps.HOUR })
    ]
  });
  const lateResult = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(lateDb, { now: lateNow }));
  const lateRow = (id) => lateDb.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(lateResult.acted, 2, '§C 23:50~24:00 触发窗：当天 cutoff 前 + 昨天单完成（2 单）');
  t.eq(lateRow('auto-late-today').status, deps.enums.ORDER_STATUS.COMPLETED, '§C 当天 23:50 前送达 → 当天夜间日结完成');
  t.eq(lateRow('auto-late-after').status, deps.enums.ORDER_STATUS.DELIVERED, '§C 当天 23:52 送达 → 顺延次日 23:50');

  // 配置键 autoCompleteAt 真的驱动 cutoff（不是写死 23:50）
  const configOrder = () => deps.makeWorld({
    orders: [deps.orderOf({ _id: 'auto-config', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: deps.NOW - 2 * deps.HOUR })]
  });
  const cfgDb = configOrder();
  const cfgResult = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb, { config: { autoCompleteAt: '12:00' } }));
  t.eq(cfgResult.acted, 1, '§C config.autoCompleteAt=12:00 生效（10:00 送达 ≤ 今天 12:00 cutoff）');
  const cfgDb2 = configOrder();
  const cfgResult2 = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb2, { config: { autoCompleteAt: '23:59' } }));
  t.eq(cfgResult2.acted, 0, '§C config.autoCompleteAt=23:59 → cutoff=昨天 23:59，今天 10:00 送达不命中');
  const cfgDb3 = deps.makeWorld({
    orders: [deps.orderOf({ _id: 'auto-config-fallback', status: deps.enums.ORDER_STATUS.DELIVERED, deliveredAt: deps.NOW - 25 * deps.HOUR })]
  });
  const cfgResult3 = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb3, { config: { autoCompleteAt: '25:99' } }));
  t.eq(cfgResult3.acted, 1, '§C autoCompleteAt 非法 → 回落默认 23:50（昨天 11:00 送达命中）');
}

const EXPECTED_ASSERTIONS = 30;

module.exports = {
  EXPECTED_ASSERTIONS,
  autoCompleteChecks
};
