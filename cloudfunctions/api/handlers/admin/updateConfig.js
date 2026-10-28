// handlers/admin/updateConfig.js · admin.updateConfig（白名单键 + 范围校验；aiFallback 不在白名单）
// 白名单唯一口径 = DATA_MODEL §7.6（行 750）与 CONTRACT §1.1 第 4 条：
//   · 可写：orderTimeoutMinutes/autoCompleteHours/screenshotRetentionDays/recognitionFailureRetentionDays/
//     viewTicketTtlMinutes/avatarMaxBytes/testAccountMaxPerRole/testDataRetentionDays/privacyVersion +
//     zoneLabels/serviceCatalog/announcement/maintenance；
//   · v1.0（D23）：orderMergeWindowMinutes 合并窗口 0~60（整数，默认 10，0=关闭；DATA_MODEL §2.10），
//     仅服务端判定、不进 config.getPublic 公开子集；
//   · v1.1（D32）：stations 站点正式名整表提交（固定 8 个 id、名称 1~20 字且唯一；进公开子集）；
//   · avatarMaxBytes 上限 = 200KB（DATA_MODEL §2.10「默认 200KB；102400~204800」，隐私承诺不得放宽）；
//   · privacyVersion 是文本键（非空 ≤32 字，隐私文本定稿流程用，审计 CONFIG_UPDATE）；
//   · 仅 aiFallback 不在白名单（只读展示；写入走部署配置脚本/控制台，DATA_MODEL §2.10）。
'use strict';

const { COLLECTIONS, CONFIG_DOC_ID } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const sharedStations = require('../../shared/stations');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  assertValid,
  truncateDetail
} = require('./_common');
const { DEFAULT_CONFIG, cloneDefault } = require('../../db/config');
const dto = require('./_dto');

const NUMBER_RULES = {
  orderTimeoutMinutes: { min: 5, max: 1440 },
  autoCompleteHours: { min: 1, max: 72 },
  screenshotRetentionDays: { min: 1, max: 7 },
  recognitionFailureRetentionDays: { min: 7, max: 30 },
  viewTicketTtlMinutes: { min: 5, max: 60 },
  avatarMaxBytes: { min: 102400, max: 200 * 1024 },
  testAccountMaxPerRole: { min: 1, max: 3 },
  testDataRetentionDays: { min: 7, max: 90 },
  // v1.0（D23/CONTRACT §4 config 行）：合并窗口 0~60 分钟，0=关闭合并；整数（normalizeNumber 已禁小数）
  orderMergeWindowMinutes: { min: 0, max: 60 }
};
const TEXT_KEYS = ['privacyVersion'];
const OBJECT_KEYS = ['zoneLabels', 'serviceCatalog', 'announcement', 'maintenance', 'stations'];
const WHITELIST = Object.keys(NUMBER_RULES).concat(TEXT_KEYS, OBJECT_KEYS);

function normalizeText(key, value) {
  if (typeof value !== 'string') {
    throw errors.validation(key, '配置格式不正确');
  }
  const text = value.trim();
  if (text === '' || text.length > 32) {
    throw errors.validation(key, '配置格式不正确');
  }
  return text;
}

function normalizeNumber(key, value) {
  const rule = NUMBER_RULES[key];
  const num = Number(value);
  if (!Number.isFinite(num) || Math.floor(num) !== num || num < rule.min || num > rule.max) {
    throw errors.validation(key, '配置值超出允许范围');
  }
  return num;
}

function normalizeZoneLabels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('zoneLabels', '苑名配置格式不正确');
  }
  const out = {};
  Object.keys(value).forEach((zone) => {
    if (enums.CODE_ALPHABET.indexOf(zone) < 0 && ['D', 'X', 'N', 'B', 'C'].indexOf(zone) < 0) {
      throw errors.validation('zoneLabels', '苑名配置包含未知苑');
    }
    const label = value[zone];
    if (typeof label !== 'string' || label.trim() === '' || label.trim().length > 10) {
      throw errors.validation('zoneLabels', '苑名需为 1~10 字');
    }
    out[zone] = label.trim();
  });
  return out;
}

function normalizeServiceCatalog(value) {
  if (!Array.isArray(value) || value.length !== enums.SERVICE_CODES.length) {
    throw errors.validation('serviceCatalog', '服务类型需覆盖全部 5 类');
  }
  const seen = {};
  const out = value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw errors.validation('serviceCatalog', '服务类型格式不正确');
    }
    const code = item.code;
    if (enums.SERVICE_CODES.indexOf(code) < 0 || seen[code]) {
      throw errors.validation('serviceCatalog', '服务类型编码不正确');
    }
    seen[code] = true;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const desc = typeof item.desc === 'string' ? item.desc.trim() : '';
    if (!name || name.length > 20 || desc.length > 60) {
      throw errors.validation('serviceCatalog', '服务名称/说明长度不正确');
    }
    return { code: code, name: name, desc: desc };
  });
  return out;
}

function normalizeAnnouncement(value) {
  if (typeof value === 'string') {
    if (value.length > 500) {
      throw errors.validation('announcement', '公告正文最多 500 字');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('announcement', '公告配置格式不正确');
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (title.length > 30 || text.length > 500) {
    throw errors.validation('announcement', '公告标题/正文超长');
  }
  return { enabled: value.enabled === true, title: title, text: text };
}

function normalizeMaintenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('maintenance', '维护配置格式不正确');
  }
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (text.length > 500) {
    throw errors.validation('maintenance', '维护说明最多 500 字');
  }
  return { enabled: value.enabled === true, text: text };
}

// v1.1（D32）：站点名称整表提交——固定 8 个 P1~P8、名称非空去空白 1~20 字、名称唯一（不增删站点 id）
function normalizeStations(value) {
  if (!Array.isArray(value) || value.length !== sharedStations.STATION_COUNT) {
    throw errors.validation('stations', '站点名称需覆盖全部 8 个站点');
  }
  const byId = {};
  value.forEach((item) => {
    if (!item || typeof item !== 'object' || sharedStations.STATION_IDS.indexOf(item.id) < 0) {
      throw errors.validation('stations', '站点编码不正确（只允许 P1~P8）');
    }
    if (byId[item.id] !== undefined) {
      throw errors.validation('stations', '站点编码重复');
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name.length < sharedStations.STATION_NAME_MIN || name.length > sharedStations.STATION_NAME_MAX) {
      throw errors.validation('stations', '站点名称需为 1~20 字');
    }
    byId[item.id] = name;
  });
  const seen = {};
  sharedStations.STATION_IDS.forEach((id) => {
    if (byId[id] === undefined) {
      throw errors.validation('stations', '站点名称需覆盖全部 8 个站点');
    }
    if (seen[byId[id]]) {
      throw errors.validation('stations', '站点名称不能重复');
    }
    seen[byId[id]] = true;
  });
  return sharedStations.STATION_IDS.map((id) => ({ id: id, name: byId[id] }));
}

function normalizePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw errors.validation('config', '配置格式不正确');
  }
  const patch = {};
  Object.keys(input).forEach((key) => {
    if (WHITELIST.indexOf(key) < 0) {
      throw errors.validation('config', '配置项不在可修改白名单内');
    }
    const value = input[key];
    if (NUMBER_RULES[key]) {
      patch[key] = normalizeNumber(key, value);
    } else if (TEXT_KEYS.indexOf(key) >= 0) {
      patch[key] = normalizeText(key, value);
    } else if (key === 'zoneLabels') {
      patch[key] = normalizeZoneLabels(value);
    } else if (key === 'serviceCatalog') {
      patch[key] = normalizeServiceCatalog(value);
    } else if (key === 'announcement') {
      patch[key] = normalizeAnnouncement(value);
    } else if (key === 'maintenance') {
      patch[key] = normalizeMaintenance(value);
    } else if (key === 'stations') {
      patch[key] = normalizeStations(value);
    }
  });
  if (Object.keys(patch).length === 0) {
    throw errors.validation('config', '请至少修改一项配置');
  }
  return patch;
}

// DATA_MODEL §2.11：CONFIG_UPDATE 的 detail 必须可追溯「变更前后关键字段」。
// 数值/布尔原值记录；文本与对象序列化后按审计 detail 上限 120 字截断（长公告不落全量到审计）。
function summarizeValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return truncateDetail(value);
  }
  return truncateDetail(JSON.stringify(value));
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const patch = normalizePatch(input.config);
  patch.updatedAt = scope.nowDate;
  const requestKey = auditKeyOf(ctx);
  const replay = await scope.findAudit(requestKey);
  if (replay) {
    return { config: dto.configForAdmin(scope.config), duplicated: true };
  }
  const changes = {};
  Object.keys(patch).forEach((key) => {
    if (key === 'updatedAt') {
      return;
    }
    changes[key] = { before: summarizeValue(scope.config[key]), after: summarizeValue(patch[key]) };
  });
  if (scope.configSeeded) {
    await scope.dao.update(COLLECTIONS.CONFIG, CONFIG_DOC_ID, patch);
  } else {
    const seed = Object.assign(cloneDefault(), patch, { _id: CONFIG_DOC_ID });
    await scope.dao.add(COLLECTIONS.CONFIG, seed);
  }
  await scope.writeAudit(
    AUDIT_ACTIONS.CONFIG_UPDATE,
    { type: 'config', id: CONFIG_DOC_ID },
    { keys: Object.keys(patch).filter((key) => key !== 'updatedAt'), changes: changes },
    requestKey
  );
  const fresh = Object.assign({}, DEFAULT_CONFIG, scope.config, patch);
  return { config: dto.configForAdmin(fresh) };
}

module.exports = handler;
