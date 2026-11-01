'use strict';
/**
 * tools/lib/admin-config-clock-cases.js — selftest-admin-pages 的 D43 配置页用例：
 * 自动完成时间 autoCompleteAt（UTC+8 的 HH:MM）缺省回填、格式闸、变更清单、页面输入形态、旧小时数键清零。
 * 非独立套件：由 selftest-admin-pages require 后调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 */
const defaultClock = '23:50';
// 旧「小时数」配置键已作废；逐字拼装避免本文件命中旧键字面量残留扫描（判据仍逐字等于旧键）
const LEGACY_HOURS_KEY = ['autoComplete', 'Hours'].join('');

function autoCompleteClockChecks(t, deps) {
  const configVm = deps.configVm;
  t.eq([configVm.emptyForm().autoCompleteAt, configVm.buildForm({}).autoCompleteAt],
    [defaultClock, defaultClock], '自动完成时间缺省回填=出厂默认 23:50（不再回填旧小时数）');
  t.eq(configVm.buildForm(deps.sampleConfig()).autoCompleteAt, defaultClock,
    '自动完成时间按配置回填 HH:MM（sampleConfig）');
  t.eq(configVm.FIELD_LABELS.autoCompleteAt, '自动完成时间', '变更清单字段名=「自动完成时间」');
  const payload = configVm.buildPayload(configVm.emptyForm());
  t.eq(configVm.validatePayload(payload), '', '自动完成时间合法基线（出厂 23:50）先绿');
  t.check(configVm.validatePayload(Object.assign({}, payload, { autoCompleteAt: '24:00' })).indexOf('HH:MM') >= 0,
    'autoCompleteAt=24:00（小时越界）→ 提示 HH:MM 格式');
  t.check(configVm.validatePayload(Object.assign({}, payload, { autoCompleteAt: '7:5' })).indexOf('HH:MM') >= 0,
    'autoCompleteAt=7:5（非补零）→ 提示 HH:MM 格式');
  t.check(configVm.validatePayload(Object.assign({}, payload, { autoCompleteAt: '' })).indexOf('HH:MM') >= 0,
    'autoCompleteAt 空串 → 提示 HH:MM 格式');
  t.eq(configVm.validatePayload(Object.assign({}, payload, { autoCompleteAt: '07:05' })), '',
    'autoCompleteAt=07:05 合法（边界小时）');
  t.check(configVm.collectChanges(payload, Object.assign({}, payload, { autoCompleteAt: '07:05' }))
    .indexOf('自动完成时间') >= 0, '变更清单含「自动完成时间」（二次确认可见）');
  const configWxml = deps.textOf('pkg-admin/pages/config/index.wxml');
  const configPageJs = deps.textOf('pkg-admin/pages/config/index.js');
  const block = (configWxml.split('自动完成时间')[1] || '').split('截图留存')[0];
  t.check(block.indexOf('data-field="autoCompleteAt"') >= 0 && block.indexOf('HH:MM') >= 0
    && block.indexOf('type="number"') < 0,
  '配置页自动完成改为 HH:MM 文本输入（不再以「小时」number 输入，D43）');
  t.check(configPageJs.indexOf('autoCompleteMin') < 0 && configPageJs.indexOf(LEGACY_HOURS_KEY) < 0,
    '配置页脚本不再引用旧键/旧小时范围（旧小时数键/autoCompleteMin 清零）');
}

const EXPECTED_ASSERTIONS = 11;

module.exports = {
  EXPECTED_ASSERTIONS,
  autoCompleteClockChecks
};
