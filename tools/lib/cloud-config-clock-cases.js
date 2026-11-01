'use strict';
/**
 * tools/lib/cloud-config-clock-cases.js — selftest-cloud 的 D43/D51 配置合同用例：
 * autoCompleteAt 出厂默认（D51：'22:00'）/白名单/公开子集/HH:MM 格式闸/旧小时数键作废/审计留痕。
 * 非独立套件：由 selftest-cloud require 后调用（拆出以控测试文件 ≤1000 行，门禁 #18）。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API = path.join(ROOT, 'cloudfunctions/api');

async function clockChecks(t, deps) {
  const app = require(path.join(API, 'app.js'));
  const configLib = require(path.join(API, 'db/config.js'));
  const defaultsLib = require(path.join(API, 'shared/defaults.js'));
  t.eq(defaultsLib.DEFAULT_CONFIG.autoCompleteAt, '22:00', '出厂默认 autoCompleteAt=22:00（UTC+8 日结批时刻，D51）');
  t.eq(Object.prototype.hasOwnProperty.call(defaultsLib.DEFAULT_CONFIG, deps.legacyHoursKey), false,
    '出厂默认不再含旧小时数键（不作半死兼容键）');
  t.eq(configLib.PUBLIC_CONFIG_KEYS.indexOf('autoCompleteAt') >= 0, true,
    'config.getPublic 公开子集含 autoCompleteAt（端侧文案要按配置时刻展示）');
  t.eq(configLib.PUBLIC_CONFIG_KEYS.indexOf(deps.legacyHoursKey), -1, '公开子集不再含旧小时数键');
  const pub = configLib.publicConfig(configLib.cloneDefault());
  t.eq(pub.autoCompleteAt, '22:00', '公开子集 autoCompleteAt=出厂默认 22:00');
  t.eq(['orderMergeWindowMinutes', 'aiFallback', deps.legacyHoursKey].filter((key) => pub[key] !== undefined), [],
    '公开子集不含治理/内部键（合并窗口/aiFallback/旧小时数键）');
  const db = deps.createTestDb();
  db.seed('users', [{ _id: deps.adminOpenid, roles: [], status: deps.userStatusActive, isTestAccount: false }]);
  const api = app.createApi({ db, now: () => deps.now, openid: deps.adminOpenid, env: deps.adminEnv });
  const good = await api.call('admin.updateConfig', { config: { autoCompleteAt: ' 07:05 ' } },
    { clientRequestId: 'cfg-clock-request-0000000001' });
  t.eq([good.ok, good.data.config.autoCompleteAt], [true, '07:05'],
    'admin.updateConfig 接受 HH:MM 并去空白落库（autoCompleteAt 为白名单文本键）');
  const bad = await api.call('admin.updateConfig', { config: { autoCompleteAt: '24:00' } },
    { clientRequestId: 'cfg-clock-request-0000000002' });
  t.check(bad.ok === false && bad.code === 'VALIDATION_FAILED',
    'autoCompleteAt=24:00 → VALIDATION_FAILED（小时越界）');
  const bad2 = await api.call('admin.updateConfig', { config: { autoCompleteAt: '7:5' } },
    { clientRequestId: 'cfg-clock-request-0000000003' });
  t.check(bad2.ok === false && bad2.code === 'VALIDATION_FAILED',
    'autoCompleteAt=7:5（非补零 HH:MM）→ VALIDATION_FAILED');
  const legacy = await api.call('admin.updateConfig', { config: { [deps.legacyHoursKey]: 24 } },
    { clientRequestId: 'cfg-clock-request-0000000004' });
  t.check(legacy.ok === false && legacy.code === 'VALIDATION_FAILED',
    '旧小时数键已作废：不在白名单 → VALIDATION_FAILED');
  const cfgDoc = db.dump('config').filter((row) => row._id === 'global')[0] || {};
  t.eq(cfgDoc.autoCompleteAt, '07:05', '落库 config.autoCompleteAt=07:05（服务端唯一真值）');
  t.check(db.dump('admin_audit').some((row) => row.action === deps.auditConfigUpdate
    && (row.detail.keys || []).indexOf('autoCompleteAt') >= 0), true,
  '配置变更写 CONFIG_UPDATE 审计并记录 autoCompleteAt 键名（可追溯）');
}

const EXPECTED_ASSERTIONS = 12;

module.exports = {
  EXPECTED_ASSERTIONS,
  clockChecks
};
