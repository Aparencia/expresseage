// handlers/admin/updateConfig.js · admin.updateConfig（白名单键 + 范围校验；aiFallback 不在白名单）
'use strict';

const { COLLECTIONS, CONFIG_DOC_ID } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  assertValid
} = require('./_common');
const { DEFAULT_CONFIG, cloneDefault } = require('../../db/config');
const dto = require('./_dto');

const NUMBER_RULES = {
  orderTimeoutMinutes: { min: 5, max: 1440 },
  autoCompleteHours: { min: 1, max: 72 },
  screenshotRetentionDays: { min: 1, max: 7 },
  recognitionFailureRetentionDays: { min: 7, max: 30 },
  viewTicketTtlMinutes: { min: 5, max: 60 },
  avatarMaxBytes: { min: 102400, max: 512000 },
  testAccountMaxPerRole: { min: 1, max: 3 },
  testDataRetentionDays: { min: 7, max: 90 }
};
const TEXT_KEYS = ['privacyVersion'];
const OBJECT_KEYS = ['zoneLabels', 'serviceCatalog', 'announcement', 'maintenance'];
const WHITELIST = Object.keys(NUMBER_RULES).concat(TEXT_KEYS, OBJECT_KEYS);

function normalizeNumber(key, value) {
  const rule = NUMBER_RULES[key];
  const num = Number(value);
  if (!Number.isFinite(num) || Math.floor(num) !== num || num < rule.min || num > rule.max) {
    throw errors.validation(key, '配置值超出允许范围');
  }
  return num;
}

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
    }
  });
  if (Object.keys(patch).length === 0) {
    throw errors.validation('config', '请至少修改一项配置');
  }
  return patch;
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
    changes[key] = { changed: true };
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
