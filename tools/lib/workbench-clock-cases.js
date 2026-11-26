'use strict';
/**
 * tools/lib/workbench-clock-cases.js — 工作台 L 组「日结批自动完成时刻配置化」用例表（TD-083）。
 *
 * 拆件来由：2026-11-26 迟到响应守卫批要在 selftest-order-workbench 新增 P 组，而该套件文件已顶到
 * 门禁 #18 的 1000 行上限 → 把 L 组实现逐字搬到这里（断言不变、编号不变），页面文件只留一行注册。
 *
 * 非独立套件：由 tools/selftest-order-workbench.js require。
 * 纪律：不 mock 全局 wx；纯件断言（batch-view.plan + 源码静态扫描）；样本非空。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const defaults = require(path.join(ROOT, 'config/defaults.js'));
const fsutil = require('./fsutil');

const EXPECTED_ASSERTIONS = 15; // L01~L15

function clockChecks(t, deps) {
  const d = deps || {};
  const batchView = d.batchView;
  const textOf = d.textOf;
  const rowsOf = d.rowsOf;
  const dto = d.dto;
  const STATUS = d.STATUS;
  const PAGES = d.PAGES;

  const fallbackAt = defaults.DEFAULT_CONFIG.autoCompleteAt;
  const pickedRows = rowsOf([dto(STATUS.PICKED, { orderNo: 'L-1' }), dto(STATUS.PICKED, { orderNo: 'L-2' })]);
  const at2230 = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '22:30' } });
  t.check(at2230.confirmText.indexOf('系统每天 22:30 自动完成送达单') >= 0,
    'L01 TD-083 合法基线：注入 config.autoCompleteAt=22:30 → 送达确认文案按配置时刻生成');
  const at2115 = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '21:15' } });
  t.eq([(at2115.confirmText.match(/21:15/g) || []).length, at2115.confirmText.indexOf(fallbackAt)], [1, -1], 'L02 文案时刻按配置值单处渲染（D91 文案只提一次时刻；缺省值不出现在配置生效文案里）');
  const noConfig = batchView.plan('deliver', pickedRows, {});
  t.check(noConfig.confirmText.indexOf('系统每天 ' + fallbackAt + ' 自动完成送达单') >= 0,
    'L03 缺配置 → 回退出厂默认（唯一默认单源 = config/defaults.DEFAULT_CONFIG.autoCompleteAt）');
  const outOfRange = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '25:00' } });
  t.eq([outOfRange.confirmText.indexOf(fallbackAt) >= 0, outOfRange.confirmText.indexOf('25:00')],
    [true, -1], 'L04 非法配置（25:00 越界）→ 回退默认，不把非法时刻上屏');
  const emptyClock = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '' } });
  t.eq(emptyClock.confirmText.indexOf('系统每天 ' + fallbackAt + ' 自动完成送达单') >= 0, true,
    'L05 空串配置值 → 同样回退默认（不生成「系统每天  自动完成」残句）');
  const nonString = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: 2230 } });
  t.eq([nonString.confirmText.indexOf(fallbackAt) >= 0, nonString.confirmText.indexOf('2230')], [true, -1],
    'L06 非字符串配置值（数字 2230）→ 回退默认，不上屏半截时刻');
  const trimmed = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: ' 22:30 ' } });
  t.check(trimmed.confirmText.indexOf('系统每天 22:30 自动完成送达单') >= 0,
    'L07 配置前后空格归一后使用（normalizeClockText 单源，不把脏值直接拼进文案）');
  const pickWithConfig = batchView.plan('pick', pickedRows, { config: { autoCompleteAt: '22:30' } });
  const pickNoConfig = batchView.plan('pick', pickedRows, {});
  t.eq(pickWithConfig.confirmText, pickNoConfig.confirmText,
    'L08 其它批量动作不受影响（无占位模板逐字一致，配置化只作用于送达文案）');
  t.check(at2230.confirmText.indexOf('将 2 单（共 2 件）') >= 0
    && at2230.confirmText.indexOf('guest 单无需确认') >= 0,
    'L09 配置化不影响件数替换与 guest 口径原文（N/M 与时刻同时正确）');
  const batchSrc = fsutil.stripComments(textOf('pages/partner/workbench/parts/batch-view.js'));
  t.check(batchSrc.indexOf(fallbackAt) === -1 && batchSrc.indexOf('{autoCompleteAt}') >= 0,
    'L10 纯件零第二处时刻字面量（剥注释后无默认时刻）、模板用 {autoCompleteAt} 占位单源');
  t.check(batchSrc.indexOf('defaults.DEFAULT_CONFIG.autoCompleteAt') >= 0
    && batchSrc.indexOf('defaults.normalizeClockText(') >= 0,
    'L11 默认值/归一判据都引用 config/defaults（唯一默认值来源），零件不本地写死时刻');
  t.check(at2230.confirmText.indexOf('该时刻前送达的当天完成') >= 0 && at2230.confirmText.indexOf('下一轮') === -1
    && at2230.confirmText.indexOf('该时刻及之后送达的送达即完成') >= 0 && at2230.confirmText.indexOf('顺延次日') === -1,
    'L12 D91 文案语义：该时刻前送达的当天完成、该时刻及之后送达的送达即完成（旧「下一轮/顺延次日」作废）');
  const at2350 = batchView.plan('deliver', pickedRows, { config: { autoCompleteAt: '23:50' } });
  t.check(at2350.confirmText.indexOf('系统每天 23:50 自动完成送达单') >= 0,
    'L13 显式注入 23:50 的可配置用例：文案按注入值生效（旧默认已成配置可改项）');
  const actionSrc = textOf(PAGES.actions);
  const tapBody = actionSrc.slice(actionSrc.indexOf('onBatchTap('));
  t.check(tapBody.indexOf("store.get('config')") >= 0
    && /batchTapIntent\([\s\S]{0,200}?this\.data\.readonly,\s*config\)/.test(tapBody),
    "L14 页面接线：onBatchTap 读 store.get('config') 并注入 actionFlow.batchTapIntent");
  const flowSrc = textOf('pages/partner/workbench/parts/action-flow.js');
  t.check(/function batchTapIntent\(key, groups, readonly, config\)/.test(flowSrc)
    && flowSrc.indexOf('batchView.plan(key, rows, { config: config })') >= 0,
    'L15 action-flow 接线：config 参数透传到 batch-view.plan（不吞配置、不本地判时刻）');
}

module.exports = { EXPECTED_ASSERTIONS, clockChecks };
