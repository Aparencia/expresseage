// pkg-admin/pages/config/parts/view-model.js · 全局配置视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.8/§7.4——可编辑白名单字段（识别失败留存 7~30、站点名称 1~20 字唯一、
//       D43 自动完成时间为 UTC+8 的 HH:MM 文本键）、只读项、变更清单与二次确认。
//       站点名称单源 = shared/stations；时刻格式单源 = config/defaults.normalizeClockText（与服务端同一判据）。
// D41（2026-10-28 用户拍板）：服务目录固定 5 类，顺序/默认名称单源 = shared/enums；
//       旧目录（含已停用 PICKUP_DOOR 或缺新码 PICKUP_LOW）整表回退新默认，后台保存一次即完成迁移。
// D70/D71（2026-11-08 用户拍板）：站点双判据开关（fromImage/fromCode，缺省开）+ 站点顺序可调 + 每站别名；
//       行顺序 = 展示顺序；别名仅识别归一用（不展示/不产生新站点，兼职端仍按主站点归类）；取件码格式 `*`=任意字母数字。
'use strict';

const C = require('../../../common/constants');
const F = require('../../../common/format');
const stationsLib = require('../../../../shared/stations');
const stationRules = require('../../../../shared/station-rules');
const enums = require('../../../../shared/enums');
const defaults = require('../../../../config/defaults');

const FIELD_LABELS = {
  zoneLabels: '苑名',
  stations: '站点名称',
  stationInfer: '站点识别开关',
  serviceCatalog: '服务类型模板',
  announcement: '公告',
  maintenance: '维护模式',
  orderTimeoutMinutes: '接单超时',
  autoCompleteAt: '自动完成时间',
  screenshotRetentionDays: '截图留存天数',
  recognitionFailureRetentionDays: '识别失败留存天数',
  ttlMinutes: '切换会话时长',
  avatarMaxBytes: '头像大小上限'
};

const RECOGNITION_MIN = 7;
const RECOGNITION_MAX = 30;

function toInt(value) {
  const parsed = Number(value);
  return isNaN(parsed) ? NaN : Math.floor(parsed);
}

// 站点多项文本（别名/取件码格式）在输入框里的连接符；保存时按 [,，、\s]+ 拆分去空（D71）
const STATION_TEXT_JOIN = '、';
const STATION_TEXT_SEPARATOR_RE = /[,，、\s]+/;

function joinStationText(list) {
  return (Array.isArray(list) ? list : []).join(STATION_TEXT_JOIN);
}

// 编辑文本 → 数组：只做「拆项 + 去空白 + 丢空项」，不静默清洗（非法项留给 shared 严格校验出错误文案）
function splitStationText(text) {
  return String(text === undefined || text === null ? '' : text)
    .split(STATION_TEXT_SEPARATOR_RE)
    .map(function trimItem(item) { return item.trim(); })
    .filter(function notEmpty(item) { return item !== ''; });
}

// 站点编辑行：当前配置名/别名/取件码格式 + 默认名占位提示；行顺序 = 配置顺序 = 展示顺序（D71）
function stationRowsOf(stations) {
  return stationsLib.stationsFromConfig({ stations: stations }).map(function mapStation(item) {
    return {
      id: item.id,
      name: item.name,
      aliasesText: joinStationText(item.aliases),
      codePatternsText: joinStationText(item.codePatterns),
      defaultName: stationsLib.stationNameOf(item.id)
    };
  });
}

// 别名/格式输入框上限（单源 = shared/station-rules）：N 项 × 单项上限 + (N-1) 个分隔符
function stationInputLimits() {
  return {
    aliasTextMax: stationRules.STATION_ALIAS_MAX * (stationRules.STATION_ALIAS_LEN_MAX + 1) - 1,
    patternTextMax: stationRules.STATION_PATTERN_MAX * (stationRules.STATION_PATTERN_LEN_MAX + 1) - 1
  };
}

// D71 站点顺序移动：dir=-1 上移 / 1 下移；边界不越界（原样返回），返回新数组且不改入参
function moveStation(rows, index, dir) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const from = Number(index);
  const step = Number(dir);
  if (step !== -1 && step !== 1) return list;
  if (!Number.isFinite(from) || Math.floor(from) !== from) return list;
  const to = from + step;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const moved = list[from];
  list[from] = list[to];
  list[to] = moved;
  return list;
}

// D41：目录是否「D41 之前」形态（空/含目录外 code/缺现行 code）→ 整表回退新默认；已迁移则保留后台改名。
function isLegacyServiceCatalog(list) {
  const stored = Array.isArray(list) ? list : [];
  if (!stored.length) return true;
  const codes = [];
  stored.forEach(function collect(item) {
    const code = item && typeof item.code === 'string' ? item.code : '';
    if (code && codes.indexOf(code) < 0) codes.push(code);
  });
  if (!codes.length) return true;
  return codes.some(function unknown(code) { return enums.SERVICE_CODES.indexOf(code) < 0; })
    || enums.SERVICE_CODES.some(function missing(code) { return codes.indexOf(code) < 0; });
}

// 服务类型编辑行：固定 5 行、顺序 = shared/enums；只有 code/name/desc（无启用开关）。
function serviceRowsOf(catalog) {
  const stored = Array.isArray(catalog) ? catalog : [];
  const legacy = isLegacyServiceCatalog(stored);
  const byCode = {};
  if (!legacy) {
    stored.forEach(function collect(item) {
      if (!item || enums.SERVICE_CODES.indexOf(item.code) < 0 || byCode[item.code]) return;
      byCode[item.code] = item;
    });
  }
  return enums.SERVICES.map(function mapService(item) {
    const hit = byCode[item.code];
    return {
      code: item.code,
      name: hit && typeof hit.name === 'string' && hit.name ? hit.name : item.name,
      desc: hit && typeof hit.desc === 'string' ? hit.desc : item.desc
    };
  });
}

function emptyForm() {
  return {
    zones: [],
    stations: stationRowsOf(null),
    // D70：站点双判据开关，缺省两项都开（站内既有站点识别/取件码反推都可用）
    stationInfer: stationsLib.stationInferOf({}),
    services: [],
    announcement: { enabled: false, title: '', text: '' },
    maintenance: { enabled: false, text: '' },
    orderTimeoutMinutes: '120',
    autoCompleteAt: defaults.DEFAULT_CONFIG.autoCompleteAt,
    screenshotRetentionDays: '7',
    recognitionFailureRetentionDays: '30',
    ttlMinutes: '30',
    avatarMaxKb: '200'
  };
}

function buildForm(config) {
  const source = config || {};
  const form = emptyForm();
  const zoneLabels = source.zoneLabels || {};
  form.zones = C.ZONE_KEYS.map(function mapZone(key) {
    return {
      key: key,
      placeHolder: C.ZONE_LABELS[key],
      value: zoneLabels[key] || ''
    };
  });
  form.stations = stationRowsOf(source.stations);
  // D70：双判据开关按配置回填（缺省/脏值一率按开，与服务端 stationInferOf 同一判据）
  form.stationInfer = stationsLib.stationInferOf({ stationInfer: source.stationInfer });
  // D41：服务类型固定 5 类（名称/说明可改，不新增/不删除）；旧目录回退新默认（保存一次即迁移）
  form.services = serviceRowsOf(source.serviceCatalog);
  const announcement = source.announcement || {};
  form.announcement = {
    enabled: announcement.enabled === true,
    title: announcement.title || '',
    text: announcement.text || ''
  };
  const maintenance = source.maintenance || {};
  form.maintenance = {
    enabled: maintenance.enabled === true,
    text: maintenance.text || ''
  };
  form.orderTimeoutMinutes = String(F.numOrZero(source.orderTimeoutMinutes) || 120);
  // D43：默认/缺失/非法都回填出厂时刻（UTC+8 的 HH:MM），后台不会把旧小时数当时间显示
  form.autoCompleteAt = defaults.normalizeClockText(source.autoCompleteAt)
    || defaults.DEFAULT_CONFIG.autoCompleteAt;
  form.screenshotRetentionDays = String(F.numOrZero(source.screenshotRetentionDays) || 7);
  form.recognitionFailureRetentionDays = String(
    F.numOrZero(source.recognitionFailureRetentionDays) || RECOGNITION_MAX
  );
  form.ttlMinutes = String(C.pickTtlMinutes(source));
  const avatarBytes = F.numOrZero(source.avatarMaxBytes) || C.CONFIG_RANGE.avatarKbMax * 1024;
  form.avatarMaxKb = String(Math.round(avatarBytes / 1024));
  return form;
}

// 只读项：aiFallback 总开关 + 测试账号上限/测试数据保留（本期不开放编辑）
function buildReadonlyInfo(config) {
  const source = config || {};
  const fallback = source.aiFallback || {};
  return {
    aiFallbackText: fallback.enabled === false ? '已关闭（只读展示，不可在此修改）' : '已开启（只读展示，不可在此修改）',
    testAccountMaxPerRole: F.textOrDash(source.testAccountMaxPerRole),
    testDataRetentionDays: F.textOrDash(source.testDataRetentionDays)
  };
}

function buildPayload(form) {
  const source = form || emptyForm();
  return {
    zoneLabels: (source.zones || []).reduce(function reduceZones(acc, item) {
      acc[item.key] = String(item.value || '').trim();
      return acc;
    }, {}),
    stations: (source.stations || []).map(function mapStation(item) {
      // D71：数组顺序 = 展示顺序；别名/取件码格式按分隔符拆项（空项丢弃，非法项留给共享校验）
      return {
        id: item.id,
        name: String(item.name || '').trim(),
        aliases: splitStationText(item.aliasesText),
        codePatterns: splitStationText(item.codePatternsText)
      };
    }),
    stationInfer: {
      fromImage: (source.stationInfer || {}).fromImage !== false,
      fromCode: (source.stationInfer || {}).fromCode !== false
    },
    serviceCatalog: (source.services || []).map(function mapService(item) {
      // 只上行契约字段 code/name/desc；enabled 不在 CONTRACT §6 口径内，不得凭空新增
      return {
        code: item.code,
        name: String(item.name || '').trim(),
        desc: String(item.desc || '').trim()
      };
    }),
    announcement: {
      enabled: source.announcement.enabled === true,
      title: String(source.announcement.title || '').trim(),
      text: String(source.announcement.text || '').trim()
    },
    maintenance: {
      enabled: source.maintenance.enabled === true,
      text: String(source.maintenance.text || '').trim()
    },
    orderTimeoutMinutes: toInt(source.orderTimeoutMinutes),
    autoCompleteAt: String(source.autoCompleteAt || '').trim(),
    screenshotRetentionDays: toInt(source.screenshotRetentionDays),
    recognitionFailureRetentionDays: toInt(source.recognitionFailureRetentionDays),
    ttlMinutes: toInt(source.ttlMinutes),
    avatarMaxBytes: toInt(source.avatarMaxKb) * 1024
  };
}

// 站点整表校验（D32/D70/D71）：覆盖 8 个固定 id、名称唯一、别名 0~5（1~20 字、全局唯一）、
// 取件码格式 0~3（合法且全局唯一）；数组顺序任意（即新展示顺序）。
// 严格判据与中文文案单源 = shared/stations.validateStationConfig + stationErrorText（与 admin.updateConfig 同一闸）；
// 行数先用共享 STATION_COUNT 快检挡掉明显残缺表单，再走整表校验。
function validateStationsOf(list) {
  if (!Array.isArray(list) || list.length !== stationsLib.STATION_COUNT) {
    return stationsLib.stationErrorText('COUNT');
  }
  const error = stationsLib.validateStationConfig(list, stationsLib.STATIONS);
  return error ? stationsLib.stationErrorText(error) : '';
}

function validatePayload(payload) {
  const data = payload || {};
  const range = C.CONFIG_RANGE;
  if (!(data.orderTimeoutMinutes >= range.orderTimeoutMin && data.orderTimeoutMinutes <= range.orderTimeoutMax)) {
    return '接单超时请填 ' + range.orderTimeoutMin + '~' + range.orderTimeoutMax + ' 分钟。';
  }
  // D43/D51：自动完成时间 = UTC+8 的 HH:MM（与服务端 shared/defaults.normalizeClockText 同一判据，不再有 1~72/1~168 两套范围）
  if (!defaults.normalizeClockText(data.autoCompleteAt)) {
    return '自动完成时间请填 HH:MM（00:00~23:59，如 22:00）。';
  }
  if (!(data.screenshotRetentionDays > 0 && data.screenshotRetentionDays <= range.screenshotMax)) {
    return '截图留存天数不能超过 ' + range.screenshotMax + ' 天。';
  }
  if (!(data.recognitionFailureRetentionDays >= RECOGNITION_MIN
    && data.recognitionFailureRetentionDays <= RECOGNITION_MAX)) {
    return '识别失败留存天数请填 ' + RECOGNITION_MIN + '~' + RECOGNITION_MAX + ' 天。';
  }
  if (!(data.ttlMinutes >= range.ttlMin && data.ttlMinutes <= range.ttlMax)) {
    return '切换会话时长请填 ' + range.ttlMin + '~' + range.ttlMax + ' 分钟。';
  }
  if (!(data.avatarMaxBytes >= range.avatarKbMin * 1024 && data.avatarMaxBytes <= range.avatarKbMax * 1024)) {
    return '头像大小上限请填 ' + range.avatarKbMin + '~' + range.avatarKbMax + 'KB。';
  }
  if (data.announcement && data.announcement.title.length > C.LIMITS.announcementTitleMax) {
    return '公告标题最多 ' + C.LIMITS.announcementTitleMax + ' 字。';
  }
  if (data.announcement && data.announcement.text.length > C.LIMITS.announcementTextMax) {
    return '公告正文最多 ' + C.LIMITS.announcementTextMax + ' 字。';
  }
  if (data.maintenance && data.maintenance.text.length > C.LIMITS.maintenanceTextMax) {
    return '维护说明最多 ' + C.LIMITS.maintenanceTextMax + ' 字。';
  }
  if (data.zoneLabels && Object.keys(data.zoneLabels).some(function emptyZone(key) {
    return !data.zoneLabels[key];
  })) {
    return '五个苑名都不能为空。';
  }
  const stationError = validateStationsOf(data.stations);
  if (stationError) {
    return stationError;
  }
  // D70：双判据开关只接受布尔（页面由开关只产出布尔；直接构造上行载荷时挡住字符串/缺项）
  const stationInfer = data.stationInfer || {};
  if (typeof stationInfer.fromImage !== 'boolean' || typeof stationInfer.fromCode !== 'boolean') {
    return '站点识别开关只接受开启/关闭。';
  }
  return '';
}

// 变更清单：只列真实变化的字段（中文标签），供二次确认展示
function collectChanges(before, payload) {
  const oldData = before || {};
  const next = payload || {};
  return Object.keys(FIELD_LABELS).filter(function changed(key) {
    return JSON.stringify(oldData[key]) !== JSON.stringify(next[key]);
  }).map(function labelOf(key) {
    return FIELD_LABELS[key];
  });
}

// 上行入参：页面展示字段 ttlMinutes → 契约字段名（配置键从 constants 取，避免票据变量名进页面层）
function buildApiPayload(payload, ttlKey) {
  const result = Object.assign({}, payload);
  result[ttlKey] = result.ttlMinutes;
  delete result.ttlMinutes;
  return result;
}

function maintenanceConfirmContent(enabled) {
  return enabled
    ? '开启维护模式后，顾客/兼职端将看到维护公告，写操作被拒绝；后台不受影响。确定开启？'
    : '关闭维护模式后，顾客/兼职端立即恢复读写；维护说明保留供下次开启使用。确定关闭？';
}

module.exports = {
  FIELD_LABELS,
  RECOGNITION_MIN,
  RECOGNITION_MAX,
  toInt,
  emptyForm,
  buildForm,
  stationInputLimits,
  moveStation,
  serviceRowsOf,
  buildReadonlyInfo,
  buildPayload,
  validatePayload,
  collectChanges,
  buildApiPayload,
  maintenanceConfirmContent
};
