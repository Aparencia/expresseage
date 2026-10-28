// pkg-admin/pages/config/parts/view-model.js · 全局配置视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.8/§7.4——可编辑白名单字段（识别失败留存 7~30、站点名称 1~20 字唯一）、
//       只读项、变更清单与二次确认。站点名称单源 = shared/stations（默认名与 id 不复制第二份）。
'use strict';

const C = require('../../../common/constants');
const F = require('../../../common/format');
const stationsLib = require('../../../../shared/stations');

const FIELD_LABELS = {
  zoneLabels: '苑名',
  stations: '站点名称',
  serviceCatalog: '服务类型模板',
  announcement: '公告',
  maintenance: '维护模式',
  orderTimeoutMinutes: '接单超时',
  autoCompleteHours: '自动完成时长',
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

// 站点编辑行：当前配置名 + 默认名占位提示（id 固定 P1~P8，不自建/不增删）
function stationRowsOf(stations) {
  return stationsLib.stationsFromConfig({ stations: stations }).map(function mapStation(item) {
    return { id: item.id, name: item.name, defaultName: stationsLib.stationNameOf(item.id) };
  });
}

function emptyForm() {
  return {
    zones: [],
    stations: stationRowsOf(null),
    services: [],
    announcement: { enabled: false, title: '', text: '' },
    maintenance: { enabled: false, text: '' },
    orderTimeoutMinutes: '120',
    autoCompleteHours: '24',
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
  form.services = (source.serviceCatalog || []).map(function mapService(item) {
    // 契约口径（CONTRACT §6 / DATA_MODEL §2.10）：serviceCatalog 只有 {code,name,desc}，无展示开关
    return {
      code: item.code,
      name: item.name || '',
      desc: item.desc || ''
    };
  });
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
  form.autoCompleteHours = String(F.numOrZero(source.autoCompleteHours) || 24);
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
      return { id: item.id, name: String(item.name || '').trim() };
    }),
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
    autoCompleteHours: toInt(source.autoCompleteHours),
    screenshotRetentionDays: toInt(source.screenshotRetentionDays),
    recognitionFailureRetentionDays: toInt(source.recognitionFailureRetentionDays),
    ttlMinutes: toInt(source.ttlMinutes),
    avatarMaxBytes: toInt(source.avatarMaxKb) * 1024
  };
}

// 站点名称校验：8 个固定 id 全覆盖、名称 1~20 字且不重复（id 不可增删/改名）
function validateStationsOf(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length !== stationsLib.STATION_COUNT) {
    return '站点名称需覆盖全部 8 个站点。';
  }
  const seen = {};
  for (let i = 0; i < list.length; i += 1) {
    const name = String((list[i] && list[i].name) || '').trim();
    if (name.length < stationsLib.STATION_NAME_MIN || name.length > stationsLib.STATION_NAME_MAX) {
      return '站点名称需填 ' + stationsLib.STATION_NAME_MIN + '~' + stationsLib.STATION_NAME_MAX + ' 字。';
    }
    if (seen[name]) {
      return '站点名称不能重复。';
    }
    seen[name] = true;
  }
  return '';
}

function validatePayload(payload) {
  const data = payload || {};
  const range = C.CONFIG_RANGE;
  if (!(data.orderTimeoutMinutes >= range.orderTimeoutMin && data.orderTimeoutMinutes <= range.orderTimeoutMax)) {
    return '接单超时请填 ' + range.orderTimeoutMin + '~' + range.orderTimeoutMax + ' 分钟。';
  }
  if (!(data.autoCompleteHours >= range.autoCompleteMin && data.autoCompleteHours <= range.autoCompleteMax)) {
    return '自动完成时长请填 ' + range.autoCompleteMin + '~' + range.autoCompleteMax + ' 小时。';
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
  buildReadonlyInfo,
  buildPayload,
  validatePayload,
  collectChanges,
  buildApiPayload,
  maintenanceConfirmContent
};
