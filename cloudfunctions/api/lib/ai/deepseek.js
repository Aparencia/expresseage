'use strict';

/**
 * AI 识别兜底 · DeepSeek 外呼适配层（唯一外呼出口）。
 *
 * 口径：CONTRACT v0.9 §4.3 / ENGINEERING §4.10.2
 * - 传输层 `fetch` 由参数注入（单测替身，零真实外呼）；Key 只从环境变量读取。
 * - 超时 `config.aiFallback.timeoutMs`（默认 8000ms）；仅网络错误/5xx 重试 1 次；4xx 不重试。
 * - 连续 5 次失败熔断 `config.aiFallback.cooldownMinutes`（默认 10 分钟），熔断期内零外呼。
 * - 日志只记错误码/耗时/成功与否：本层不打印响应全文、不打印 Key、不打印入参文本。
 * - 本文件是唯一允许出现外呼端点与 Key 环境变量名的云函数文件。
 */

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const KEY_ENV_NAME = 'DEEPSEEK_API_KEY';

const { AI_PAYLOAD_KEYS, buildAiPayload, assertPayloadKeys } = require('./payload');
const { buildMessages } = require('./prompt');

const MAX_ATTEMPTS = 2;
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_COOLDOWN_MINUTES = 10;
const FAILURE_THRESHOLD = 5;
const MAX_TIMER_MS = 2147483647;
const MAX_CONTENT_LENGTH = 20000;

/** 内部排障码（记录字段 aiErrorCode；不映射业务错误码、不新增错误码）。 */
const AI_ERROR_CODES = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  HTTP_5XX: 'HTTP_5XX',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  PARSE_ERROR: 'PARSE_ERROR',
  DISABLED: 'DISABLED',
});

/** 进程内熔断状态（云函数实例级，尽力而为；不做持久化）。 */
const breakerState = {
  consecutiveFailures: 0,
  openUntil: 0,
};

function nowMsOf(now) {
  if (typeof now === 'function') {
    return now();
  }
  if (now instanceof Date) {
    return now.getTime();
  }
  if (typeof now === 'number') {
    return now;
  }
  return Date.now();
}

function normalizeAiConfig(config) {
  const fallback = config && typeof config.aiFallback === 'object' && config.aiFallback !== null
    ? config.aiFallback
    : null;
  if (!fallback) {
    return {
      enabled: false,
      model: DEFAULT_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
      maxPerUserPerDay: 5,
      dailyQuota: 200,
    };
  }
  const timeout = Number(fallback.timeoutMs);
  const cooldown = Number(fallback.cooldownMinutes);
  const perUser = Number(fallback.maxPerUserPerDay);
  const quota = Number(fallback.dailyQuota);
  return {
    enabled: fallback.enabled !== false,
    model: typeof fallback.model === 'string' && fallback.model ? fallback.model : DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_TIMER_MS) : DEFAULT_TIMEOUT_MS,
    cooldownMinutes: Number.isFinite(cooldown) && cooldown > 0 ? cooldown : DEFAULT_COOLDOWN_MINUTES,
    maxPerUserPerDay: Number.isFinite(perUser) && perUser > 0 ? Math.floor(perUser) : 5,
    dailyQuota: Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : 200,
  };
}

function resetCircuitBreaker() {
  breakerState.consecutiveFailures = 0;
  breakerState.openUntil = 0;
}

function isCircuitOpen(atMs) {
  return atMs < breakerState.openUntil;
}

function recordFailure(atMs, cooldownMs) {
  breakerState.consecutiveFailures += 1;
  if (breakerState.consecutiveFailures >= FAILURE_THRESHOLD) {
    breakerState.openUntil = atMs + cooldownMs;
    breakerState.consecutiveFailures = 0;
  }
}

function recordSuccess() {
  breakerState.consecutiveFailures = 0;
  breakerState.openUntil = 0;
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl;
  }
  if (typeof fetch === 'function') {
    return fetch;
  }
  return null;
}

/**
 * HTTP 失败归类到内部排障码（不新增业务错误码）。
 * @param {number} status HTTP 状态码
 * @returns {string}
 */
function classifyHttpFailure(status) {
  if (status >= 500) {
    return AI_ERROR_CODES.HTTP_5XX;
  }
  if (status === 429) {
    return AI_ERROR_CODES.QUOTA_EXCEEDED;
  }
  if (status === 401 || status === 403) {
    return AI_ERROR_CODES.DISABLED;
  }
  return AI_ERROR_CODES.PARSE_ERROR;
}

async function readJsonBody(response) {
  if (!response || typeof response.json !== 'function') {
    return null;
  }
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

function readContent(body) {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0];
  const message = first && typeof first === 'object' ? first.message : null;
  const content = message && typeof message.content === 'string' ? message.content : '';
  return content.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * 构造唯一的外呼请求体（外发数据只来自 AI_PAYLOAD_KEYS 白名单）。
 * 这是全仓唯一构造外呼 body 的位置：先 `buildAiPayload()` 归一，再断言键集合，
 * 最后把白名单数据拼进 messages，绝不做手拼 body 或追加额外字段。
 * @param {object} payload `{ocrTextMasked, hintTrackingTail?, role}`
 * @param {{stations?: Array}} options 站点表（服务端注入，用于 prompt）
 * @returns {object|null} 不合法时返回 null
 */
function buildRequestBody(payload, options) {
  let outbound = null;
  try {
    outbound = buildAiPayload(payload);
  } catch (err) {
    return null;
  }
  if (!assertPayloadKeys(outbound)) {
    return null;
  }
  const keys = Object.keys(outbound);
  for (let i = 0; i < keys.length; i += 1) {
    if (AI_PAYLOAD_KEYS.indexOf(keys[i]) < 0) {
      return null;
    }
  }
  return {
    model: options && typeof options.model === 'string' && options.model ? options.model : DEFAULT_MODEL,
    messages: buildMessages(outbound, options),
    temperature: 0,
    response_format: { type: 'json_object' },
    stream: false,
  };
}

/**
 * 创建外呼客户端。
 * @param {{
 *   fetchImpl?: Function,
 *   env?: object,
 *   config?: object,
 *   now?: Function|number|Date
 * }} options
 */
function createDeepSeekClient(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const cfg = normalizeAiConfig(opts.config);
  const env = opts.env && typeof opts.env === 'object' ? opts.env : {};
  const apiKey = typeof env[KEY_ENV_NAME] === 'string' ? env[KEY_ENV_NAME].trim() : '';
  const fetchImpl = resolveFetch(opts.fetchImpl);

  /**
   * 单次外呼（带超时）。
   * @returns {Promise<{ok: boolean, content?: string, errorCode?: string, retryable?: boolean, latencyMs: number}>}
   */
  async function attemptOnce(requestBody, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const startedAt = nowMsOf(opts.now);
    if (controller) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller ? controller.signal : undefined,
      });
      const latencyMs = nowMsOf(opts.now) - startedAt;
      const status = response && typeof response.status === 'number' ? response.status : 0;
      if (!response || response.ok !== true) {
        return {
          ok: false,
          errorCode: classifyHttpFailure(status),
          retryable: status >= 500,
          latencyMs,
        };
      }
      const body = await readJsonBody(response);
      const content = readContent(body);
      if (!content) {
        return { ok: false, errorCode: AI_ERROR_CODES.PARSE_ERROR, retryable: false, latencyMs };
      }
      return { ok: true, content, latencyMs };
    } catch (err) {
      const latencyMs = nowMsOf(opts.now) - startedAt;
      const aborted = !!(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
      return {
        ok: false,
        errorCode: aborted ? AI_ERROR_CODES.TIMEOUT : AI_ERROR_CODES.TIMEOUT,
        retryable: true,
        latencyMs,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  return {
    /** 当前开关/Key/熔断状态（不泄露 Key 值）。 */
    status(atMs) {
      const at = typeof atMs === 'number' ? atMs : nowMsOf(opts.now);
      return {
        enabled: cfg.enabled,
        hasKey: apiKey.length > 0,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        cooldownMinutes: cfg.cooldownMinutes,
        circuitOpen: isCircuitOpen(at),
      };
    },

    /**
     * 外呼一次（内部至多重试 1 次）。
     * @param {{ocrTextMasked: string, hintTrackingTail?: string, role: string}} payload 白名单入参
     * @param {{stations?: Array}} promptOptions 站点表（服务端注入）
     * @returns {Promise<{ok: boolean, content?: string, aiTried: boolean, errorCode: string, latencyMs: number}>}
     */
    async complete(payload, promptOptions) {
      const at = nowMsOf(opts.now);
      if (!cfg.enabled) {
        return { ok: false, aiTried: false, errorCode: AI_ERROR_CODES.DISABLED, latencyMs: 0 };
      }
      if (!apiKey || !fetchImpl) {
        return { ok: false, aiTried: false, errorCode: AI_ERROR_CODES.DISABLED, latencyMs: 0 };
      }
      if (isCircuitOpen(at)) {
        return { ok: false, aiTried: false, errorCode: AI_ERROR_CODES.CIRCUIT_OPEN, latencyMs: 0 };
      }
      const requestBody = buildRequestBody(payload, {
        stations: promptOptions && promptOptions.stations,
        model: cfg.model,
      });
      if (!requestBody) {
        return { ok: false, aiTried: false, errorCode: AI_ERROR_CODES.PARSE_ERROR, latencyMs: 0 };
      }
      let last = { ok: false, aiTried: true, errorCode: AI_ERROR_CODES.HTTP_5XX, latencyMs: 0 };
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const result = await attemptOnce(requestBody, cfg.timeoutMs);
        last = {
          ok: result.ok,
          content: result.content,
          aiTried: true,
          errorCode: result.ok ? '' : result.errorCode,
          latencyMs: result.latencyMs,
        };
        if (result.ok) {
          recordSuccess();
          return last;
        }
        if (!result.retryable) {
          break;
        }
      }
      recordFailure(nowMsOf(opts.now), cfg.cooldownMinutes * 60 * 1000);
      return last;
    },

    /** 记录一次模型输出解析失败（计入熔断阈值）。 */
    noteParseFailure() {
      recordFailure(nowMsOf(opts.now), cfg.cooldownMinutes * 60 * 1000);
      return AI_ERROR_CODES.PARSE_ERROR;
    },
  };
}

module.exports = {
  ENDPOINT,
  KEY_ENV_NAME,
  AI_ERROR_CODES,
  AI_PAYLOAD_KEYS,
  buildRequestBody,
  normalizeAiConfig,
  createDeepSeekClient,
  resetCircuitBreaker,
  breakerSnapshot() {
    return {
      consecutiveFailures: breakerState.consecutiveFailures,
      openUntil: breakerState.openUntil,
    };
  },
};
