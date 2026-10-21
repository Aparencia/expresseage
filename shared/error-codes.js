// shared/error-codes.js · 业务错误码唯一集（恰好 13 个，大写_下划线）
// 契约：docs/V4_CONTRACT.md v0.9 §5.3 末段；docs/ENGINEERING §4.4 映射表。
// 纪律：全仓只认这 13 个 code；旧码（INVALID_PARAM / CODE_EXPIRED / PAYMENT_* 等）一律禁止出现。
//       新增失败场景先改写语义或复用 INVALID_STATE，不得新增 code（v0.8/v0.9 均坚持不新增）。
// 调用方：云函数 respond/errors、shared/error-copy、tools 门禁（与 CONTRACT 双向核对 13 码）。
'use strict';

const ERROR_CODES = [
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_TRANSITION',
  'INVALID_STATE',
  'RATE_LIMITED',
  'INVITE_EXPIRED',
  'INVITE_USED',
  'VIEW_TICKET_EXPIRED',
  'PARTNER_CLOSED',
  'DEPENDENCY_FAILED',
  'INTERNAL_ERROR'
];

// 与 ERROR_CODES 等价的对象形态（云端判定常量/查表时用，避免字符串字面量散落）
const ERROR_CODE_MAP = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_STATE: 'INVALID_STATE',
  RATE_LIMITED: 'RATE_LIMITED',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_USED: 'INVITE_USED',
  VIEW_TICKET_EXPIRED: 'VIEW_TICKET_EXPIRED',
  PARTNER_CLOSED: 'PARTNER_CLOSED',
  DEPENDENCY_FAILED: 'DEPENDENCY_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

const ERROR_CODE_COUNT = 13;

function isKnownCode(code) {
  return typeof code === 'string' && ERROR_CODES.indexOf(code) !== -1;
}

module.exports = {
  ERROR_CODES,
  ERROR_CODE_MAP,
  ERROR_CODE_COUNT,
  isKnownCode
};
