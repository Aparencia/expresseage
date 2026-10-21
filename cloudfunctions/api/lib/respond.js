// lib/respond.js · flat 包络（{ok, code?, message?, data?, serverTime, requestId?}）
const crypto = require('crypto');
const { AppError, CODE } = require('./errors');
const { CODE_COPY } = require('../shared/error-copy');

const REQUEST_ID_BYTES = 8;

// requestId 只用于日志排障，不参与鉴权；服务端生成，客户端只透传不解释。
function newRequestId() {
  return crypto.randomBytes(REQUEST_ID_BYTES).toString('hex');
}

function buildMeta(options) {
  const opts = options || {};
  return {
    serverTime: typeof opts.serverTime === 'number' ? opts.serverTime : Date.now(),
    requestId: opts.requestId || newRequestId()
  };
}

function success(data, options) {
  const meta = buildMeta(options);
  return {
    ok: true,
    data: data === undefined || data === null ? {} : data,
    serverTime: meta.serverTime,
    requestId: meta.requestId
  };
}

function failure(error, options) {
  const meta = buildMeta(options);
  const appError = error instanceof AppError ? error : null;
  const code = appError ? appError.code : CODE.INTERNAL_ERROR;
  const copy = CODE_COPY && CODE_COPY[code];
  const message = (appError && appError.message) || (typeof copy === 'string' && copy ? copy : '操作失败，请稍后重试');
  const body = {
    ok: false,
    code,
    message,
    serverTime: meta.serverTime,
    requestId: meta.requestId
  };
  if (appError && appError.data && Object.keys(appError.data).length > 0) {
    body.data = appError.data;
  }
  return body;
}

module.exports = {
  newRequestId,
  success,
  failure
};
