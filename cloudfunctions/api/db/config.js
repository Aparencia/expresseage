// db/config.js · 云端运行时配置（config/_id='global'）+ 冻结默认值 + 公开子集
// 默认值口径 = docs/V4_ENGINEERING.md §3.6；配置种子由 admin.bootstrap 幂等写入。
// 客户端 config/defaults.js 不在 sync 复制范围，故云端保留同口径兜底默认值（字段名逐字一致）。
const { COLLECTIONS, CONFIG_DOC_ID } = require('./collections');

const DEFAULT_CONFIG = Object.freeze({
  zoneLabels: { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' },
  serviceCatalog: [
    { code: 'PICKUP_STD', name: '标准代取', desc: '驿站取件送到宿舍楼下或约定地点' },
    { code: 'PICKUP_DOOR', name: '送寝上门', desc: '送到寝室门口（上楼）' },
    { code: 'PICKUP_URGENT', name: '加急代取', desc: '优先处理，更快时效' },
    { code: 'DROP_OFF', name: '代寄快递', desc: '顾客把件交给兼职，兼职送驿站寄出' },
    { code: 'CUSTOM', name: '其他代办', desc: '需备注说明，兼职可拒单' }
  ],
  announcement: '',
  maintenance: { enabled: false, text: '' },
  orderTimeoutMinutes: 120,
  autoCompleteHours: 24,
  screenshotRetentionDays: 7,
  recognitionFailureRetentionDays: 30,
  viewTicketTtlMinutes: 30,
  avatarMaxBytes: 200 * 1024,
  testAccountMaxPerRole: 3,
  testDataRetentionDays: 30,
  privacyVersion: 'v4.0',
  aiFallback: {
    enabled: false,
    model: 'deepseek-chat',
    timeoutMs: 8000,
    maxPerUserPerDay: 5,
    dailyQuota: 200,
    cooldownMinutes: 10
  }
});

// config.getPublic 只下发以下子集：不含模板 ID、不含 aiFallback 细节、不含任何敏感键。
const PUBLIC_CONFIG_KEYS = Object.freeze([
  'zoneLabels',
  'serviceCatalog',
  'announcement',
  'maintenance',
  'privacyVersion',
  'orderTimeoutMinutes',
  'autoCompleteHours',
  'screenshotRetentionDays',
  'avatarMaxBytes',
  'viewTicketTtlMinutes',
  'subscribeEnabled'
]);

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// 读取全局配置种子；未初始化时返回默认值并标记 seeded=false（health.check / admin.bootstrap 用）。
async function readConfig(dao) {
  const doc = await dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
  if (!doc) {
    return { config: cloneDefault(), seeded: false };
  }
  return { config: Object.assign(cloneDefault(), doc), seeded: true };
}

// 公开子集：缺省键使用默认值补齐，保证客户端字段稳定。
function publicConfig(config) {
  const source = Object.assign(cloneDefault(), config || {});
  const out = {};
  PUBLIC_CONFIG_KEYS.forEach((key) => {
    if (source[key] !== undefined) {
      out[key] = source[key];
    }
  });
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  PUBLIC_CONFIG_KEYS,
  cloneDefault,
  readConfig,
  publicConfig
};
