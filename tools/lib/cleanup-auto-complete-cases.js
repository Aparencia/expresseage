'use strict';
/**
 * tools/lib/cleanup-auto-complete-cases.js — selftest-cleanup 的 D51 日结批用例表：
 * 每单 cutoff =「该单 deliveredAt 所在 UTC+8 自然日的 config.autoCompleteAt（默认 22:00）」，now ≥ cutoff 即完成。
 * 效果：22:00 前送达 → 当日 22:00 批完成；22:00~24:00 送达 → 当日该时刻已过，下一轮 10 分钟批即完成
 * （≤10 分钟）；跨 0 点补扫不漏（cutoff 用 deliveredAt 自己的日，不依赖 now 所在日）。
 * 另覆盖：含等号边界、幂等重跑、guest 同路径、autoCompleteAt 配置驱动与非法回落。
 * 非独立套件：由 selftest-cleanup require 后调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 *
 * 口径：CONTRACT §13 D51；DATA_MODEL §7.8（cleanup 单触发器）/§8 订单状态机。
 */
const DEFAULT_AT = '22:00';
const CUTOFF_10_21 = Date.parse('2026-10-21T22:00:00+08:00');
const CUTOFF_10_22 = Date.parse('2026-10-22T22:00:00+08:00');

function ms(iso) {
  return Date.parse(iso);
}

async function autoCompleteChecks(t, deps) {
  const cutoffOf = deps.cleanupUtil.autoCompleteCutoffOf;
  const completed = deps.enums.ORDER_STATUS.COMPLETED;
  const delivered = deps.enums.ORDER_STATUS.DELIVERED;

  // ── 纯函数：cutoff 只由 deliveredAt 所在 UTC+8 自然日 + 配置时刻决定（与 now 无关）
  t.eq(cutoffOf(ms('2026-10-22T12:00:00+08:00'), DEFAULT_AT), CUTOFF_10_22,
    '§C 纯函数 cutoff：当天送达 → cutoff=当日 22:00（与 now 无关）');
  t.eq(cutoffOf(ms('2026-10-22T23:52:00+08:00'), DEFAULT_AT), CUTOFF_10_22,
    '§C 纯函数 cutoff：22:00 后送达仍取当日 22:00（已过 ⇒ 下一轮批即完成）');
  t.eq(cutoffOf(ms('2026-10-22T00:30:00+08:00'), DEFAULT_AT), CUTOFF_10_22,
    '§C 纯函数 cutoff：凌晨送达 → 等当天 22:00（UTC+8 自然日）');
  t.eq(cutoffOf(ms('2026-10-21T23:59:00+08:00'), DEFAULT_AT), CUTOFF_10_21,
    '§C 纯函数 cutoff：前一日 23:59 送达 → 前一日 22:00（日界各算各日）');
  t.eq(cutoffOf(ms('2026-10-22T12:00:00+08:00'), '05:30'), ms('2026-10-22T05:30:00+08:00'),
    '§C 纯函数 cutoff：时刻由配置给（05:30 当天）');
  t.eq(cutoffOf(ms('2026-10-22T12:00:00+08:00'), '25:99'), CUTOFF_10_22,
    '§C 纯函数 cutoff：配置非法（25:99）回落出厂默认 22:00（单源 config/defaults）');
  t.eq(cutoffOf(ms('2026-10-22T12:00:00+08:00')), CUTOFF_10_22,
    '§C 纯函数 cutoff：缺配置回落出厂默认 22:00（不写死旧 23:50）');

  // ── 12:00 批（默认 NOW）：只完成前一日及更早送达的单，当天送达等 22:00
  const due = deps.orderOf({ _id: 'auto-due', status: delivered, deliveredAt: ms('2026-10-21T11:00:00+08:00') });
  const before = deps.orderOf({ _id: 'auto-before', status: delivered, deliveredAt: ms('2026-10-21T23:00:00+08:00') });
  const earlyToday = deps.orderOf({ _id: 'auto-early-today', status: delivered, deliveredAt: ms('2026-10-22T01:00:00+08:00') });
  const daytime = deps.orderOf({ _id: 'auto-daytime', status: delivered, deliveredAt: ms('2026-10-22T11:00:00+08:00') });
  const guest = deps.orderOf({
    _id: 'auto-guest',
    status: delivered,
    deliveredAt: ms('2026-10-21T11:00:00+08:00'),
    customerId: '',
    customerOpenid: '',
    customerNo: '',
    guest: { name: '代客', phoneTail: '1234' }
  });
  const legacy = deps.orderOf({
    _id: 'auto-legacy',
    status: delivered,
    deliveredAt: null,
    statusUpdatedAt: ms('2026-10-21T11:00:00+08:00')
  });
  const submitted = deps.orderOf({ _id: 'auto-submitted', status: deps.enums.ORDER_STATUS.SUBMITTED, statusUpdatedAt: ms('2026-10-09T00:00:00+08:00') });
  const completedRow = deps.orderOf({ _id: 'auto-completed', status: completed, deliveredAt: ms('2026-10-18T00:00:00+08:00') });
  const db = deps.makeWorld({ orders: [due, before, earlyToday, daytime, guest, legacy, submitted, completedRow] });
  const ctx = deps.makeCtx(db);
  const result = await deps.SWEEPS_RUN.autoComplete(ctx);
  const after = (id) => db.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  const autoEvents = () => db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.type === 'AUTO_COMPLETED');
  t.eq(result.scanned, 4, '§C 12:00 批命中 4 单（前一日送达 + 缺 deliveredAt 脏数据；当天送达等 22:00）');
  t.eq(result.acted, 4, '§C 命中单全部转 COMPLETED（批处理）');
  t.eq(after('auto-due').status, completed, '§C 前一天白天送达 → 已完成');
  t.eq(after('auto-before').status, completed, '§C 前一日 22:00 后送达 → 补扫完成（不再顺延到次日 22:00）');
  t.eq(after('auto-early-today').status, delivered, '§C 当天凌晨送达 → 等当天 22:00 批（12:00 不动）');
  t.eq(after('auto-daytime').status, delivered, '§C 当天白天送达 → 等当天 22:00 批（12:00 不动）');
  t.eq(after('auto-submitted').status, deps.enums.ORDER_STATUS.SUBMITTED, '§C 非 DELIVERED 单不动（待接单）');
  t.eq(after('auto-completed').status, completed, '§C 非 DELIVERED 单不动（已完成）');
  t.eq(deps.dateMs(after('auto-due').completedAt), deps.NOW, '§C completedAt=注入 now（不读系统时钟）');
  t.eq(db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'auto-due').map((row) => row.type),
    ['AUTO_COMPLETED'], '§C 逐单写 AUTO_COMPLETED 事件');
  t.eq(after('auto-guest').status, completed, '§C guest 单同样由日结批完成（无顾客确认路径）');
  t.eq(db.dump(deps.COLLECTIONS.ORDER_EVENTS).filter((row) => row.orderId === 'auto-guest').length, 1,
    '§C guest 单同样写 1 条 AUTO_COMPLETED 事件');
  t.eq(after('auto-legacy').status, completed, '§C 缺 deliveredAt 的脏数据回落 statusUpdatedAt（不永久滞留）');
  t.eq(autoEvents().length, 4, '§C 事件条数 = 命中单数（逐单写，不多不少）');
  t.eq(autoEvents().every((row) => row.actorRole === deps.enums.CANCELLED_BY.SYSTEM
    && row.payload && row.payload.scheduledBy === 'SYSTEM'), true, '§C 事件 actorRole=SYSTEM + payload.scheduledBy=SYSTEM');
  const rerun = await deps.SWEEPS_RUN.autoComplete(ctx);
  t.eq(rerun.acted, 0, '§C 重跑幂等：acted=0');
  t.eq(autoEvents().length, 4, '§C 重跑不重复写事件');

  // ── 22:00 窗口：22:00 前一分不动、准点（now ≥ cutoff 含等号）当轮完成
  const winDb = deps.makeWorld({
    orders: [deps.orderOf({ _id: 'auto-win', status: delivered, deliveredAt: ms('2026-10-22T15:00:00+08:00') })]
  });
  const winRow = () => winDb.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === 'auto-win')[0];
  const beforeCut = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(winDb, { now: ms('2026-10-22T21:59:00+08:00') }));
  t.eq([beforeCut.acted, winRow().status], [0, delivered], '§C 当天 21:59 批不完成 15:00 送达单（等 22:00）');
  const atCut = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(winDb, { now: CUTOFF_10_22 }));
  t.eq([atCut.acted, winRow().status], [1, completed], '§C 准点 22:00 批即完成（now ≥ cutoff 含等号）');

  // ── 22:00~24:00 尾窗：送达即完成（旧「次日结批」规则已作废）
  const lateNow = ms('2026-10-22T22:05:00+08:00');
  const lateDb = deps.makeWorld({
    orders: [
      deps.orderOf({ _id: 'auto-late-pre', status: delivered, deliveredAt: ms('2026-10-22T21:00:00+08:00') }),
      deps.orderOf({ _id: 'auto-late-exact', status: delivered, deliveredAt: CUTOFF_10_22 }),
      deps.orderOf({ _id: 'auto-late-after', status: delivered, deliveredAt: ms('2026-10-22T22:03:00+08:00') }),
      deps.orderOf({ _id: 'auto-late-yesterday', status: delivered, deliveredAt: ms('2026-10-21T23:52:00+08:00') })
    ]
  });
  const lateResult = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(lateDb, { now: lateNow }));
  const lateRow = (id) => lateDb.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq([lateResult.scanned, lateResult.acted], [4, 4],
    '§C 22:05 批：当天 22:00 前/准点/22:00 后送达 + 前一日 22:00 后送达全部完成（4 单）');
  t.eq(lateRow('auto-late-after').status, completed,
    '§C 22:03 送达 → 当轮 10 分钟批即完成（旧规则要等次日 22:00）');

  // ── 跨 0 点补扫：cutoff 用 deliveredAt 自己的日，前一晚 23:58 送达不漏、当天 00:02 送达不误完成
  const crossDb = deps.makeWorld({
    orders: [
      deps.orderOf({ _id: 'auto-cross-late', status: delivered, deliveredAt: ms('2026-10-22T23:58:00+08:00') }),
      deps.orderOf({ _id: 'auto-cross-new', status: delivered, deliveredAt: ms('2026-10-23T00:02:00+08:00') })
    ]
  });
  const crossResult = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(crossDb, { now: ms('2026-10-23T00:05:00+08:00') }));
  const crossRow = (id) => crossDb.dump(deps.COLLECTIONS.ORDERS).filter((row) => row._id === id)[0];
  t.eq(crossResult.acted, 1, '§C 跨 0 点补扫：只完成前一日 23:58 送达单（1 单）');
  t.eq(crossRow('auto-cross-late').status, completed,
    '§C 前一日 23:58 送达 → 次日 0 点批补完成（cutoff 用 deliveredAt 自己的日，不依赖 now）');
  t.eq(crossRow('auto-cross-new').status, delivered, '§C 当天 00:02 刚送达 → 等当天 22:00（不误完成）');

  // ── 配置键 autoCompleteAt 真的驱动 cutoff（不是写死 22:00；显式 23:50 注入保留证明可配置）
  const configWorld = (deliveredIso) => deps.makeWorld({
    orders: [deps.orderOf({ _id: 'auto-config', status: delivered, deliveredAt: ms(deliveredIso) })]
  });
  const cfgDb = configWorld('2026-10-22T10:00:00+08:00');
  const cfgResult = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb, {
    config: { autoCompleteAt: '12:00' }, now: ms('2026-10-22T12:00:00+08:00')
  }));
  t.eq(cfgResult.acted, 1, '§C config.autoCompleteAt=12:00 生效（10:00 送达单在 12:00 批完成）');
  const cfgDb2 = configWorld('2026-10-22T10:00:00+08:00');
  const cfgResult2 = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb2, {
    config: { autoCompleteAt: '23:59' }, now: ms('2026-10-22T12:00:00+08:00')
  }));
  t.eq(cfgResult2.acted, 0, '§C config.autoCompleteAt=23:59 → 当天 cutoff 未到（12:00 不动）');
  const cfgDb3 = configWorld('2026-10-22T23:52:00+08:00');
  const cfgResult3 = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb3, {
    config: { autoCompleteAt: '23:50' }, now: ms('2026-10-22T23:55:00+08:00')
  }));
  t.eq(cfgResult3.acted, 1, '§C 显式注入 23:50 配置仍生效（23:52 送达 → 23:55 批完成）');
  const cfgDb4 = configWorld('2026-10-22T16:00:00+08:00');
  const cfgResult4 = await deps.SWEEPS_RUN.autoComplete(deps.makeCtx(cfgDb4, {
    config: { autoCompleteAt: '25:99' }, now: ms('2026-10-22T22:30:00+08:00')
  }));
  t.eq(cfgResult4.acted, 1, '§C autoCompleteAt 非法 → 回落出厂默认 22:00（22:30 批命中 16:00 送达单；旧 23:50 则不命中）');
}

const EXPECTED_ASSERTIONS = 35;

module.exports = {
  EXPECTED_ASSERTIONS,
  autoCompleteChecks
};
