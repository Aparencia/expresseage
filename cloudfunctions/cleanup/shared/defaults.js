// config/defaults.js · 全局配置出厂值（唯一默认值来源；admin.bootstrap 种子、admin 范围校验、公开子集）
// 契约：docs/contract/V4_CONTRACT.md v1.4 §4 config 行（含 autoCompleteAt（D43）/orderMergeWindowMinutes（D23）/stations（D32））；
//       docs/data/V4_DATA_MODEL.md §2.10。docs/ENGINEERING §3.6（键与默认/范围）。
// 纪律：值只含布尔/字符串/整数次数与毫秒；无 Key、无第三方服务标识（客户端包内零外呼痕迹）。
//       `aiFallback.model` 的出厂模型名由云函数 lib/ai 自持（本文件留空串表示"用云侧默认模型"）。
// 调用方：云函数 admin.bootstrap（种子）、admin.updateConfig（CONFIG_LIMITS 范围/文本格式闸）、
//         config.getPublic / user.bootstrap（PUBLIC_CONFIG_KEYS 裁剪）、后台配置页与顾客订单详情（HH:MM 归一）、tools/selftest（基线）。
'use strict';

const enums = require('../shared/enums');
const zones = require('../shared/zones');
const stations = require('../shared/stations');

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
  // v1.1（D32）：站点正式名（固定 P1~P8；名称非空、1~20 字、唯一；后台可改，进公开子集）
  stations: stations.stationsFromConfig(null),
  announcement: { enabled: false, title: '', text: '', updatedAt: 0 },
  maintenance: { enabled: false, text: '' },
  orderTimeoutMinutes: 120,
  // D43（2026-11-01 用户拍板，CONTRACT §13）：送达单日结批时刻（UTC+8，HH:MM 字符串）。
  // cleanup 每日取「最近一个已过的该时刻」为 cutoff，deliveredAt ≤ cutoff 的 DELIVERED 单转 COMPLETED；
  // 10 分钟触发器粒度 ⇒ 实际完成落在该时刻~+10 分钟；不额外保留顾客确认窗口。旧的「小时数」键作废。
  autoCompleteAt: '23:50',
  screenshotRetentionDays: PROMISE_RETENTION_DAYS.screenshot,
  recognitionFailureRetentionDays: PROMISE_RETENTION_DAYS.recognitionFailure,
  // v1.0（D23）：短间隔重复提交自动并入同一订单的时间窗；0=关闭合并；仅服务端行为，不进公开子集
  orderMergeWindowMinutes: 10,
  aiFallback: {
    enabled: true,
    model: '',
    timeoutMs: 8000,
    maxPerUserPerDay: 0, // D40：0=不设每人每日次数上限（用户 2026-10-28 拍板「AI 不限额」）；全局日配额仍由 dailyQuota 兜底
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
// 头像上限 = 200KB：与 CONTRACT §4.12 / 隐私文本「≤200KB」一致，不得放宽（批 8 收口统一，TD 记于 CHANGELOG）。
const CONFIG_LIMITS = {
  viewTicketTtlMinutes: { min: 5, max: 60 },
  recognitionFailureRetentionDays: { min: 7, max: 30 },
  avatarMaxBytes: { min: 100 * 1024, max: 200 * 1024 },
  testAccountMaxPerRole: { min: 1, max: 3 },
  testDataRetentionDays: { min: 7, max: 90 },
  // v1.0（D23/CONTRACT §4 config 行）：合并窗口 0~60 分钟，0=关闭
  orderMergeWindowMinutes: { min: 0, max: 60 }
};

// config.getPublic 下发的公开子集（模板 ID / aiFallback / 治理参数一律不下发）
const PUBLIC_CONFIG_KEYS = [
  'zoneLabels',
  'stations',
  'serviceCatalog',
  'announcement',
  'maintenance',
  'privacyVersion',
  'orderTimeoutMinutes',
  'autoCompleteAt',
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

// 时刻配置（autoCompleteAt，D43）归一：UTC+8 的 HH:MM（00:00~23:59，补零）。
// 非法/缺失返回 ''，调用方回落 DEFAULT_CONFIG.autoCompleteAt。单源供 admin.updateConfig（服务端格式闸）、
// 后台配置页（前端校验/回填）与顾客端送达提示（展示归一）共用，避免三处各写一份格式判据（历史 1~72 vs 1~168 漂移）。
const CLOCK_TEXT_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function normalizeClockText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return CLOCK_TEXT_PATTERN.test(text) ? text : '';
}

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
  // stations 按配置净化（缺省/非法条目回退内置默认；输出固定 8 条、名称唯一），避免把脏配置下发端侧
  out.stations = stations.stationsFromConfig(source);
  out.subscribeEnabled = !!(source.subscribeTemplates && source.subscribeTemplates.enabled);
  return out;
}

module.exports = {
  DEFAULT_CONFIG,
  CONFIG_LIMITS,
  PUBLIC_CONFIG_KEYS,
  UPLOAD_LIMITS,
  TEST_ACCOUNT_TOTAL_MAX,
  CLOCK_TEXT_PATTERN,
  normalizeClockText,
  createDefaultConfig,
  pickPublicConfig
};
