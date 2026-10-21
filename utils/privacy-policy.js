// utils/privacy-policy.js · 隐私同意与版本判定纯件（零 wx、零文案硬编码）
// 口径：CONTRACT §11（隐私与留存）+ UX_CUSTOMER §9（隐私弹窗/授权时机）。
// 版本号与公开配置一律由调用方从 config.getPublic 传入（本文件不写死版本、不写死文案）；
// 页面只按 reason 取自己的文案，避免两端口径漂移。
'use strict';

const MAX_VERSION_LENGTH = 32;
const DOC_KINDS = ['privacy', 'terms', 'about'];
const STATUS = {
  OK: 'OK',
  FIRST_RUN: 'FIRST_RUN',
  VERSION_CHANGED: 'VERSION_CHANGED',
  CONFIG_MISSING: 'CONFIG_MISSING',
  INVALID_CONSENT: 'INVALID_CONSENT'
};
// 授权时机矩阵的键（不含文案）：页面把 key 映射成自己的提示。
const SCOPES = ['ALBUM', 'CAMERA', 'FILE', 'AVATAR', 'NICKNAME'];
const REQUIRED_SCOPES = ['NICKNAME'];
// 拒绝后的降级策略：全部不阻断主流程（NICKNAME 例外：必填，需用户补齐后才能完成资料）。
const SCOPE_FALLBACK = {
  ALBUM: 'MANUAL_INPUT',
  CAMERA: 'MANUAL_INPUT',
  FILE: 'CANCEL',
  AVATAR: 'DEFAULT_AVATAR',
  NICKNAME: 'REQUIRED_INPUT'
};

function normalizeVersion(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.trim();
  if (!text || text.length > MAX_VERSION_LENGTH) {
    return '';
  }
  return text;
}

function expectedVersionOf(configPublic) {
  if (!configPublic || typeof configPublic !== 'object') {
    return '';
  }
  return normalizeVersion(configPublic.privacyVersion);
}

function parseConsent(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const version = normalizeVersion(raw.version);
  if (!version) {
    return null;
  }
  const at = typeof raw.at === 'number' && isFinite(raw.at) && raw.at > 0 ? raw.at : 0;
  if (!at) {
    return null;
  }
  return { version: version, at: at };
}

// 同意记录的唯一构造点：版本非法/缺失时返回 null，调用方不得写库。
function buildConsent(version, at) {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    return null;
  }
  const time = typeof at === 'number' && isFinite(at) && at > 0 ? at : Date.now();
  return { version: normalized, at: time };
}

// 判定结果：页面只用 canProceed / needsPrompt / reason，不自行比较版本字符串。
function consentStatus(consent, configPublic) {
  const expectedVersion = expectedVersionOf(configPublic);
  const parsed = parseConsent(consent);
  const acceptedVersion = parsed ? parsed.version : '';
  const result = {
    expectedVersion: expectedVersion,
    acceptedVersion: acceptedVersion,
    accepted: false,
    needsPrompt: false,
    canProceed: false,
    reason: STATUS.CONFIG_MISSING
  };
  if (!expectedVersion) {
    // 公开配置未就绪：fail-closed，等 bootstrap/配置刷新后再放行（服务端同样会拒绝写）。
    return result;
  }
  if (acceptedVersion === expectedVersion) {
    result.accepted = true;
    result.canProceed = true;
    result.reason = STATUS.OK;
    return result;
  }
  result.needsPrompt = true;
  result.reason = acceptedVersion ? STATUS.VERSION_CHANGED : STATUS.FIRST_RUN;
  return result;
}

function needsConsent(consent, configPublic) {
  const status = consentStatus(consent, configPublic);
  return status.needsPrompt;
}

function isConsentValid(consent, configPublic) {
  return consentStatus(consent, configPublic).accepted;
}

// 帮助页/隐私弹窗「查看全文」的查询串；页面自己拼路由，本模块不持有页面路径。
function docQuery(kind) {
  if (DOC_KINDS.indexOf(kind) < 0) {
    return '';
  }
  return '?doc=' + kind;
}

function isRequiredScope(scope) {
  return REQUIRED_SCOPES.indexOf(scope) >= 0;
}

function fallbackFor(scope) {
  if (SCOPES.indexOf(scope) < 0) {
    return null;
  }
  return {
    scope: scope,
    required: isRequiredScope(scope),
    fallback: SCOPE_FALLBACK[scope],
    blocking: false
  };
}

// 返回副本，调用方不得修改单源矩阵。
function scopeMatrix() {
  return SCOPES.map(function (scope) {
    return fallbackFor(scope);
  });
}

module.exports = {
  MAX_VERSION_LENGTH,
  DOC_KINDS,
  STATUS,
  SCOPES,
  REQUIRED_SCOPES,
  SCOPE_FALLBACK,
  normalizeVersion,
  expectedVersionOf,
  parseConsent,
  buildConsent,
  consentStatus,
  needsConsent,
  isConsentValid,
  docQuery,
  isRequiredScope,
  fallbackFor,
  scopeMatrix
};
