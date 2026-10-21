// config/defaults.js · 全局配置出厂值（唯一默认值来源；admin.bootstrap 种子、admin 范围校验、公开子集）
// 契约：docs/V4_CONTRACT.md v0.9 §2/§4 config 行；docs/V4_DATA_MODEL.md §2.10（逐键值域）；
//       docs/ENGINEERING §3.6（键与默认/范围）。
// 纪律：值只含布尔/字符串/整数次数与毫秒；无 Key、无第三方服务标识（客户端包内零外呼痕迹）。
//       `aiFallback.model` 的出厂模型名由云函数 lib/ai 自持（本文件留空串表示"用云侧默认模型"）。
// 调用方：云函数 admin.bootstrap（种子）、admin.updateConfig（CONFIG_LIMITS 范围）、
//         config.getPublic / user.bootstrap（PUBLIC_CONFIG_KEYS 裁剪）、tools/selftest（基线）。
'use strict';

const enums = require('../shared/enums');
const zones = require('../shared/zones');

const PROMISE_RETENTION_DAYS = {
  screenshot: 7,
  recognitionFailure: 30,
  testData: 30
};

const DEFAULT_CONFIG = {
  zoneLabels: {
    D: zones.ZONE_LABELS.D,
    X: zones.ZONE_LABELS.X,
    N: zones.ZONE_LABELS.N,
    B: zones.ZONE_LABELS.B,
    C: zones.ZONE_LABELS.C
  },
  // 服务类型目录：只有类型名与说明（CONTRACT §6）
  serviceCatalog: enums.SERVICES.map((item) => ({ code: item.code, name: item.name, desc: item.desc })),
  announcement: { enabled: false, title: '', text: '', updatedAt: 0 },
  maintenance: { enabled: false, text: '' },
  orderTimeoutMinutes: 120,
  autoCompleteHours: 24,
  screenshotRetentionDays: PROMISE_RETENTION_DAYS.screenshot,
  recognitionFailureRetentionDays: PROMISE_RETENTION_DAYS.recognitionFailure,
  aiFallback: {
    enabled: true,
    model: '',
    timeoutMs: 8000,
    maxPerUserPerDay: 5,
    dailyQuota: 200,
    cooldownMinutes: 10
  },
  viewTicketTtlMinutes: 30,
  avatarMaxBytes: 200 * 1024,
  testAccountMaxPerRole: 3,
  testDataRetentionDays: PROMISE_RETENTION_DAYS.testData,
  subscribeTemplates: { enabled: false },
  privacyVersion: 'v4.0.0',
  updatedAt: 0
};

// admin.updateConfig 白名单字段的范围（未列出的键不接受后台改）
const CONFIG_LIMITS = {
  viewTicketTtlMinutes: { min: 5, max: 60 },
  recognitionFailureRetentionDays: { min: 7, max: 30 },
  avatarMaxBytes: { min: 100 * 1024, max: 500 * 1024 },
  testAccountMaxPerRole: { min: 1, max: 3 },
  testDataRetentionDays: { min: 7, max: 90 }
};

// config.getPublic 下发的公开子集（模板 ID / aiFallback / 治理参数一律不下发）
const PUBLIC_CONFIG_KEYS = [
  'zoneLabels',
  'serviceCatalog',
  'announcement',
  'maintenance',
  'privacyVersion',
  'orderTimeoutMinutes',
  'autoCompleteHours',
  'screenshotRetentionDays',
  'avatarMaxBytes',
  'viewTicketTtlMinutes'
];

// 上传/文件上限（客户端压缩目标与服务端复核共用）
const UPLOAD_LIMITS = {
  ticketMaxBytes: 500 * 1024,
  avatarMinBytes: 100 * 1024,
  avatarMaxBytes: DEFAULT_CONFIG.avatarMaxBytes,
  screenshotLongSide: 1440,
  avatarSuggestedSide: 200,
  extensions: enums.IMAGE_EXTENSIONS.slice(),
  mimeTypes: enums.IMAGE_MIME_TYPES.slice()
};

// 每位开发者的测试账号合计上限（每角色上限走 config.testAccountMaxPerRole）
const TEST_ACCOUNT_TOTAL_MAX = 6;

function createDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// 公开子集裁剪：subscribeEnabled 由 subscribeTemplates.enabled 派生（不下发模板 ID）
function pickPublicConfig(config) {
  const source = config && typeof config === 'object' ? config : DEFAULT_CONFIG;
  const out = {};
  PUBLIC_CONFIG_KEYS.forEach((key) => {
    out[key] = source[key] === undefined ? DEFAULT_CONFIG[key] : source[key];
  });
  out.subscribeEnabled = !!(source.subscribeTemplates && source.subscribeTemplates.enabled);
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  CONFIG_LIMITS,
  PUBLIC_CONFIG_KEYS,
  UPLOAD_LIMITS,
  TEST_ACCOUNT_TOTAL_MAX,
  createDefaultConfig,
  pickPublicConfig
};
