// config/defaults.js · 全局配置出厂值（唯一默认值来源；admin.bootstrap 种子、admin 范围校验、公开子集）
// 契约：docs/contract/V4_CONTRACT.md v1.4 §4 config 行（含 autoCompleteAt（D43/D51）/orderMergeWindowMinutes（D23）/stations（D32）/
//       transferTtlMinutes·transferRate（D58）/teamMaxMembers·subInviteRate（D59））；
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
  // 服务类型目录：只有类型名与说明（CONTRACT §6）。校门代取 E 不进入该目录（避免改变 5 类服务口径）；
  // 其服务名/线型由 shared/enums 的 GATE_* 常量单源，订单按 line 分支展示。
  serviceCatalog: enums.SERVICES.map((item) => ({ code: item.code, name: item.name, desc: item.desc })),
  // E 校门代取：全局开关 + 校门点（首期只放东门；数组顺序=展示顺序，进公开子集）。
  gateEnabled: false,
  gatePoints: enums.DEFAULT_GATE_POINTS.map((item) => ({ id: item.id, name: item.name })),
  // v1.1（D32）：站点正式名（固定 P1~P8；名称非空、1~20 字、唯一；后台可改，进公开子集）
  // D70/D71（2026-11-08）：站点可配别名（仅识别归一）与取件码格式（`*`=1 位以上字母数字），数组顺序即展示顺序
  stations: stations.stationsFromConfig(null),
  // D70：站点双判据开关——从截图文本识别站点 / 从取件码格式反推站点（默认都开；后台可关）
  stationInfer: { fromImage: true, fromCode: true },
  announcement: { enabled: false, title: '', text: '', updatedAt: 0 },
  maintenance: { enabled: false, text: '' },
  orderTimeoutMinutes: 120,
  // D51（2026-11-01 用户拍板，CONTRACT §13）：送达单日结批时刻（UTC+8，HH:MM 字符串）。
  // 每单 cutoff =「该单 deliveredAt 所在 UTC+8 自然日的该时刻」，now ≥ cutoff 即转 COMPLETED：
  // 该时刻前送达 → 当天该时刻批完成；该时刻后送达 → 下一轮 10 分钟批即完成（≤10 分钟）。
  // 10 分钟触发器粒度 ⇒ 实际完成落在该时刻~+10 分钟；不额外保留顾客确认窗口。旧的「小时数」键作废。
  autoCompleteAt: '22:00',
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
  // 批 26（D58/D59）：转派邀请有效期/发起限流、主兼职队员上限/子码发码限流。
  // 出厂默认、只进 CONFIG_LIMITS；不进公开子集、不进 admin.updateConfig 白名单（本批后台不可改）。
  transferTtlMinutes: 10,
  transferRate: { perMinute: 3, perDay: 20 },
  teamMaxMembers: 5,
  subInviteRate: { perMinute: 3, perDay: 20 },
  avatarMaxBytes: 200 * 1024,
  testAccountMaxPerRole: 3,
  testDataRetentionDays: PROMISE_RETENTION_DAYS.testData,
  // 批 31（D73）：服务通知（一次性订阅）。模板 ID 为公开配置（非凭证）；enabled 默认关闭，
  // 上线前由用户在控制台 config/global 置 true。字段映射 key = 模板关键词，value = 值注册表键。
  subscribeTemplates: {
    enabled: false,
    delivered: {
      templateId: 'zxQ_yQgray66bHuDXPGGYEQTd6Fn-iCndeW6ImPl6ZQ',
      page: 'pages/launch/index?orderNo={orderNo}',
      fields: {
        character_string1: 'orderNo',
        time6: 'deliveredAt',
        thing3: 'fixed:快递已送达，请及时取件'
      }
    },
    newOrder: {
      templateId: 'GP0_nOdr_hn-a2UD0LVgHRhsmCkeHDI11C9c5DnDRKc',
      page: 'pages/partner/workbench/index',
      fields: {
        thing20: 'orderSourceText',
        thing24: 'serviceAreaText',
        number45: 'parcelCount'
      }
    }
  },
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
  orderMergeWindowMinutes: { min: 0, max: 60 },
  // 批 26（D58/D59）：转派/子码治理参数范围。rate 形制 = {perMinute:{min,max}, perDay:{min,max}}（对象型）；
  // 既有数字型键形制不变。四个键均不在 updateConfig 白名单（后台不可改），此处仅供后续放开时复用。
  transferTtlMinutes: { min: 1, max: 60 },
  transferRate: { perMinute: { min: 1, max: 30 }, perDay: { min: 1, max: 200 } },
  teamMaxMembers: { min: 1, max: 10 },
  subInviteRate: { perMinute: { min: 1, max: 30 }, perDay: { min: 1, max: 200 } }
};

// config.getPublic 下发的公开子集（aiFallback/治理参数一律不下发；D73：订阅启用时单独下发模板 ID，不下发字段映射）
const PUBLIC_CONFIG_KEYS = [
  'zoneLabels',
  'stations',
  'stationInfer',
  'serviceCatalog',
  'gateEnabled',
  'gatePoints',
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

// 时刻配置（autoCompleteAt，D43/D51）归一：UTC+8 的 HH:MM（00:00~23:59，补零）。
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

// E 校门点净化：只认 {id,name} 两键、去空/去重、最多 5 个；非法/空数组回落出厂东门。
// 顺序即展示顺序（与 stations 的「数组顺序=展示顺序」同口径），客户端不自行排序。
const GATE_POINT_MAX = 5;
function gatePointsOf(value) {
  const fallback = enums.DEFAULT_GATE_POINTS.map((item) => ({ id: item.id, name: item.name }));
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const ids = {};
  list.forEach((item) => {
    if (!item || typeof item !== 'object' || out.length >= GATE_POINT_MAX) return;
    const id = typeof item.id === 'string' ? item.id.trim().toUpperCase() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(id) || !name || name.length > 20 || ids[id]) return;
    ids[id] = true;
    out.push({ id, name });
  });
  return out.length ? out : fallback;
}

// 公开子集裁剪：subscribeEnabled 由 subscribeTemplates.enabled 派生；D73 起 enabled 时另下发模板 ID
function pickPublicConfig(config) {
  const source = config && typeof config === 'object' ? config : DEFAULT_CONFIG;
  const out = {};
  PUBLIC_CONFIG_KEYS.forEach((key) => {
    out[key] = source[key] === undefined ? DEFAULT_CONFIG[key] : source[key];
  });
  // stations 按配置净化（缺省/非法条目回退内置默认；输出固定 8 条、名称/别名唯一、顺序=配置顺序），避免把脏配置下发端侧
  out.stations = stations.stationsFromConfig(source);
  // D70：双判据开关按布尔净化（缺省=开；显式 false 才关），避免脏配置把能力意外关掉
  out.stationInfer = stations.stationInferOf({ stationInfer: source.stationInfer });
  out.gateEnabled = source.gateEnabled === true;
  out.gatePoints = gatePointsOf(source.gatePoints);
  out.subscribeEnabled = !!(source.subscribeTemplates && source.subscribeTemplates.enabled);
  // 批 31（D73）：客户端授权必须拿到模板 ID（非密钥）；只下发 ID，不下发字段映射/其它治理配置。
  if (out.subscribeEnabled && source.subscribeTemplates) {
    const delivered = source.subscribeTemplates.delivered || {};
    const newOrder = source.subscribeTemplates.newOrder || {};
    out.subscribeTemplateIds = {
      delivered: typeof delivered.templateId === 'string' ? delivered.templateId : '',
      newOrder: typeof newOrder.templateId === 'string' ? newOrder.templateId : ''
    };
  }
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
  gatePointsOf,
  createDefaultConfig,
  pickPublicConfig
};
