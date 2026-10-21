// utils/ids.js · 唯一编号零件（归一回显/解析/展示/前缀提示；零 wx、零生成）
// 契约：docs/V4_CONTRACT.md v0.9 §3/§3.1；docs/ENGINEERING §5.3（导出名单、归一顺序、错前缀文案同源）；
//       docs/ARCHITECTURE.md §4.3（客户端只做归一/展示/校验，生成为云端 lib/id-generator.js）。
// 依赖：rules 全部来自 shared/enums.js（字母表/长度/正则），归一与形态来自 shared/validate.js，
//       提示文案来自 shared/error-copy.js（本文件不复制字符串，避免两份口径）。
// 路径说明：require('../shared/x') 在客户端（utils/ids.js）与云函数副本（<fn>/shared/ids.js）两种位置
//           都解析到同一份 shared/x.js，故云侧 id-generator 可直接消费同一实现。
// 同步：tools/sync-cloud-shared.js 逐字节复制为 cloudfunctions/*/shared/ids.js。
'use strict';

const enums = require('../shared/enums');
const validate = require('../shared/validate');
const ERROR_COPY = require('../shared/error-copy');

const NO_KIND = enums.NO_KIND;
const PREFIX_HINT_REASON = {
  CUSTOMER: 'CUSTOMER_PREFIX',
  DEVELOPER: 'DEVELOPER_PREFIX',
  OTHER: 'FORMAT'
};

// 纯归一：去首尾空白、全角转半角、去空白与连字符、大写（供输入框实时回显）
function normalizeInput(raw) {
  return validate.canonicalCode(raw);
}

function kindOfCanonical(canonical) {
  if (canonical === '') {
    return NO_KIND.UNKNOWN;
  }
  if (canonical.indexOf(enums.DEVELOPER_NO_PREFIX) === 0) {
    return NO_KIND.DEVELOPER;
  }
  if (canonical.charAt(0) === enums.CUSTOMER_NO_PREFIX) {
    return NO_KIND.CUSTOMER;
  }
  if (canonical.charAt(0) === enums.PARTNER_NO_PREFIX) {
    return NO_KIND.PARTNER;
  }
  return NO_KIND.UNKNOWN;
}

function displayCustomerNo(canonical) {
  const body = canonical.slice(1);
  if (body.length !== enums.CUSTOMER_NO_BODY_LENGTH) {
    return '';
  }
  return enums.CUSTOMER_NO_PREFIX + '-' + body.slice(0, 4) + '-' + body.slice(4);
}

function displayPartnerNo(canonical) {
  const body = canonical.slice(1);
  if (body.length !== enums.PARTNER_NO_BODY_LENGTH) {
    return '';
  }
  return enums.PARTNER_NO_PREFIX + '-' + body.slice(0, 3) + '-' + body.slice(3);
}

function displayInvitationCode(canonical) {
  if (canonical.length !== enums.INVITATION_CODE_LENGTH) {
    return '';
  }
  return canonical.slice(0, 4) + '-' + canonical.slice(4, 8) + '-' + canonical.slice(8);
}

// 展示：传 canonical 或已分组展示串都行（幂等：displayNo(parseNo(display).kind, display) === display）
function displayNo(kind, value) {
  const canonical = validate.canonicalCode(value);
  if (kind === NO_KIND.CUSTOMER) {
    return displayCustomerNo(canonical) || canonical;
  }
  if (kind === NO_KIND.PARTNER) {
    return displayPartnerNo(canonical) || canonical;
  }
  if (kind === NO_KIND.DEVELOPER) {
    return displayDeveloperNo(value);
  }
  return canonical;
}

function displayDeveloperNo(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return validate.toHalfWidth(raw).trim().replace(/\s+/g, '');
}

// 只做前缀判定（用于"输错对象也给出正确提示"；不以格式合法为前提）
function detectKind(raw) {
  if (typeof raw !== 'string') {
    return NO_KIND.UNKNOWN;
  }
  const compact = validate.canonicalCode(raw);
  return kindOfCanonical(compact);
}

// 解析唯一编号（顾客 C+8 / 兼职 P+6 / 开发者白名单 DEV-01）
// 返回 { ok, kind, canonical, display, reason? }；reason ∈ {FORMAT, CUSTOMER_PREFIX, DEVELOPER_PREFIX}
function parseNo(raw) {
  const kind = detectKind(raw);
  if (kind === NO_KIND.DEVELOPER) {
    const result = validate.validateDeveloperNo(raw);
    if (result.ok) {
      return { ok: true, kind, canonical: result.canonical, display: result.canonical, reason: '' };
    }
    return { ok: false, kind, canonical: '', display: '', reason: PREFIX_HINT_REASON.DEVELOPER };
  }
  if (kind === NO_KIND.CUSTOMER) {
    const result = validate.validateCustomerNo(raw);
    if (result.ok) {
      return { ok: true, kind, canonical: result.canonical, display: displayCustomerNo(result.canonical), reason: '' };
    }
    return { ok: false, kind, canonical: '', display: '', reason: PREFIX_HINT_REASON.CUSTOMER };
  }
  if (kind === NO_KIND.PARTNER) {
    const result = validate.validatePartnerNo(raw);
    if (result.ok) {
      return { ok: true, kind, canonical: result.canonical, display: displayPartnerNo(result.canonical), reason: '' };
    }
    return { ok: false, kind, canonical: '', display: '', reason: PREFIX_HINT_REASON.OTHER };
  }
  return { ok: false, kind: NO_KIND.UNKNOWN, canonical: '', display: '', reason: PREFIX_HINT_REASON.OTHER };
}

function isCustomerNo(raw) {
  const parsed = parseNo(raw);
  return parsed.ok && parsed.kind === NO_KIND.CUSTOMER;
}

function isPartnerNo(raw) {
  const parsed = parseNo(raw);
  return parsed.ok && parsed.kind === NO_KIND.PARTNER;
}

function isDeveloperNo(raw) {
  const parsed = parseNo(raw);
  return parsed.ok && parsed.kind === NO_KIND.DEVELOPER;
}

// 错前缀提示（同源文案）：返回 { reason, message }；页面显示 message，云函数把它塞进
// VALIDATION_FAILED.message（只描述格式，不暴露该编号是否存在）
function prefixHint(raw) {
  const kind = detectKind(raw);
  let reason = PREFIX_HINT_REASON.OTHER;
  if (kind === NO_KIND.CUSTOMER) {
    reason = PREFIX_HINT_REASON.CUSTOMER;
  } else if (kind === NO_KIND.DEVELOPER) {
    reason = PREFIX_HINT_REASON.DEVELOPER;
  }
  return { reason, message: ERROR_COPY.prefixHintOf(reason) };
}

module.exports = {
  NO_KIND,
  // 归一/解析/展示/判定（ENGINEERING §5.3 冻结名单）
  normalizeInput,
  parseNo,
  displayNo,
  isCustomerNo,
  isPartnerNo,
  isDeveloperNo,
  prefixHint,
  // 展示补充（邀请码分组展示；激活页/后台邀请码列表用）
  displayInvitationCode,
  detectKind,
  // 生成侧常量转出（云端 lib/id-generator.js 单点引用；定义在 shared/enums.js）
  ALPHABET: enums.CODE_ALPHABET,
  CUSTOMER_NO_PREFIX: enums.CUSTOMER_NO_PREFIX,
  CUSTOMER_NO_BODY_LENGTH: enums.CUSTOMER_NO_BODY_LENGTH,
  CUSTOMER_NO_LENGTH: enums.CUSTOMER_NO_LENGTH,
  CUSTOMER_NO_PATTERN: enums.CUSTOMER_NO_PATTERN,
  PARTNER_NO_PREFIX: enums.PARTNER_NO_PREFIX,
  PARTNER_NO_BODY_LENGTH: enums.PARTNER_NO_BODY_LENGTH,
  PARTNER_NO_LENGTH: enums.PARTNER_NO_LENGTH,
  PARTNER_NO_PATTERN: enums.PARTNER_NO_PATTERN,
  INVITATION_CODE_LENGTH: enums.INVITATION_CODE_LENGTH,
  INVITATION_CODE_PATTERN: enums.INVITATION_CODE_PATTERN,
  ORDER_NO_PATTERN: enums.ORDER_NO_PATTERN,
  ORDER_NO_LENGTH: enums.ORDER_NO_LENGTH,
  FAILURE_NO_PATTERN: enums.FAILURE_NO_PATTERN,
  FAILURE_NO_LENGTH: enums.FAILURE_NO_LENGTH,
  TOKEN_LENGTH: enums.TOKEN_LENGTH,
  TOKEN_PATTERN: enums.TOKEN_PATTERN
};
