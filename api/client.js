// api/client.js · 唯一 wx.cloud.callFunction 出口（v4 客户端请求层）
// 职责：组装包络 / 注入切换会话票据 / 超时 / 读动作重试 / 13 码→人话 / 校时
const store = require('../store/index');
const ACTIONS = require('../shared/actions');
const ERROR_COPY = require('../shared/error-copy');
const modeGuard = require('./mode-guard');

const CLOUD_FUNCTION = 'api';
const TIMEOUT_MS = 10000;
const RETRY_DELAYS = [300, 900];
const REQUEST_ID_LENGTH = 24;
const REQUEST_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
const RETRYABLE_CODES = ['DEPENDENCY_FAILED', 'INTERNAL_ERROR'];

class CallError extends Error {
  constructor(code, message, data, requestId) {
    super(message || '操作失败');
    this.name = 'CallError';
    this.code = code || 'INTERNAL_ERROR';
    this.data = data || null;
    this.requestId = requestId || '';
  }
}

let transport = defaultTransport;

function setTransport(fn) {
  transport = typeof fn === 'function' ? fn : defaultTransport;
}

function restoreTransport() {
  transport = defaultTransport;
}

function createRequestId() {
  let out = '';
  for (let i = 0; i < REQUEST_ID_LENGTH; i += 1) {
    out += REQUEST_ID_CHARS.charAt(Math.floor(Math.random() * REQUEST_ID_CHARS.length));
  }
  return out;
}

function isWriteAction(action) {
  const meta = ACTIONS.ACTION_MAP && ACTIONS.ACTION_MAP[action];
  return !!(meta && meta.write);
}

function isRetryAction(action) {
  const meta = ACTIONS.ACTION_MAP && ACTIONS.ACTION_MAP[action];
  return !!(meta && !meta.write);
}

function defaultTransport(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new CallError('DEPENDENCY_FAILED', '网络超时，请检查网络后重试'));
    }, TIMEOUT_MS);
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION,
      data: payload,
      success(res) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(res && res.result);
      },
      fail() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new CallError('DEPENDENCY_FAILED', '服务暂时不可用，请稍后重试'));
      }
    });
  });
}

function buildPayload(action, data) {
  const payload = { action, data: data || {}, clientRequestId: createRequestId() };
  const view = store.getViewContext();
  if (view && view.viewTicket) {
    payload.viewTicket = view.viewTicket;
  }
  return payload;
}

function copyOf(code) {
  const copy = ERROR_COPY && ERROR_COPY.CODE_COPY ? ERROR_COPY.CODE_COPY[code] : '';
  return copy || '操作失败，请稍后重试';
}

function normalizeResult(result) {
  if (!result || typeof result.ok !== 'boolean') {
    throw new CallError('INTERNAL_ERROR', '服务返回异常，请稍后重试');
  }
  if (typeof result.serverTime === 'number' && result.serverTime > 0) {
    store.set('serverTimeSkew', Date.now() - result.serverTime);
  }
  if (!result.ok) {
    if (result.code === 'VIEW_TICKET_EXPIRED') {
      store.clearViewContext();
    }
    const message = result.message || copyOf(result.code);
    throw new CallError(result.code, message, result.data, result.requestId);
  }
  return result.data === undefined ? {} : result.data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(action, data, opts) {
  const options = opts || {};
  modeGuard.assertWritable(action);
  const payload = buildPayload(action, data);
  const attempts = options.retry === true || (options.retry !== false && isRetryAction(action)) ? 3 : 1;
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await transport(payload);
      return normalizeResult(result);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof CallError && RETRYABLE_CODES.indexOf(err.code) >= 0;
      if (!retryable || i === attempts - 1) {
        throw err;
      }
      await sleep(RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)]);
    }
  }
  throw lastError || new CallError('INTERNAL_ERROR', '操作失败，请稍后重试');
}

module.exports = {
  call,
  CallError,
  setTransport,
  restoreTransport,
  isWriteAction,
  createRequestId,
  RETRYABLE_CODES
};
