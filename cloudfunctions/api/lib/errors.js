// lib/errors.js · 13 码唯一错误集与服务端 AppError（错误码常量只来自 shared/error-codes）
const { ERROR_CODES } = require('../shared/error-codes');
const { CODE_COPY } = require('../shared/error-copy');

const CODE_LIST = Array.isArray(ERROR_CODES) ? ERROR_CODES.slice() : Object.keys(ERROR_CODES || {});
const CODE = Object.freeze(CODE_LIST.reduce((acc, code) => {
  acc[code] = code;
  return acc;
}, {}));
const FALLBACK_MESSAGE = '操作失败，请稍后重试';

function isKnownCode(code) {
  return CODE_LIST.indexOf(code) >= 0;
}

function defaultMessage(code) {
  const copy = CODE_COPY && CODE_COPY[code];
  return typeof copy === 'string' && copy ? copy : FALLBACK_MESSAGE;
}

// 服务端业务错误：只有 AppError 的 message 可以原样进入响应包络，其余异常统一 INTERNAL_ERROR。
class AppError extends Error {
  constructor(code, message, data) {
    super(message || defaultMessage(code));
    this.name = 'AppError';
    this.code = isKnownCode(code) ? code : CODE.INTERNAL_ERROR;
    this.data = data === undefined ? null : data;
    this.expose = true;
  }
}

function make(code, message, data) {
  return new AppError(code, message || defaultMessage(code), data);
}

const errors = {
  validation(field, message) {
    const data = {};
    if (field) {
      data.field = field;
    }
    return make(CODE.VALIDATION_FAILED, message, data);
  },
  forbidden(message) {
    return make(CODE.FORBIDDEN, message);
  },
  notFound(message) {
    return make(CODE.NOT_FOUND, message);
  },
  conflict(message) {
    return make(CODE.CONFLICT, message);
  },
  invalidTransition(message) {
    return make(CODE.INVALID_TRANSITION, message);
  },
  invalidState(message) {
    return make(CODE.INVALID_STATE, message);
  },
  rateLimited(message) {
    return make(CODE.RATE_LIMITED, message);
  },
  inviteExpired(message) {
    return make(CODE.INVITE_EXPIRED, message);
  },
  inviteUsed(message) {
    return make(CODE.INVITE_USED, message);
  },
  viewTicketExpired(message) {
    return make(CODE.VIEW_TICKET_EXPIRED, message);
  },
  partnerClosed(message) {
    return make(CODE.PARTNER_CLOSED, message);
  },
  dependencyFailed(message) {
    return make(CODE.DEPENDENCY_FAILED, message);
  },
  internalError(message) {
    return make(CODE.INTERNAL_ERROR, message);
  }
};

// 未知异常一律收敛为 INTERNAL_ERROR，避免把数据库/运行时细节带给客户端。
function from(error) {
  if (error instanceof AppError) {
    return error;
  }
  return errors.internalError();
}

module.exports = {
  AppError,
  CODE,
  CODE_LIST,
  errors,
  from,
  isKnownCode,
  // 兼容两种引用习惯：const { errors } = require('.../lib/errors') 与 require('.../lib/errors').forbidden(...)
  validation: errors.validation,
  forbidden: errors.forbidden,
  notFound: errors.notFound,
  conflict: errors.conflict,
  invalidTransition: errors.invalidTransition,
  invalidState: errors.invalidState,
  rateLimited: errors.rateLimited,
  inviteExpired: errors.inviteExpired,
  inviteUsed: errors.inviteUsed,
  viewTicketExpired: errors.viewTicketExpired,
  partnerClosed: errors.partnerClosed,
  dependencyFailed: errors.dependencyFailed,
  internalError: errors.internalError
};
