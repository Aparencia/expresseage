// middleware/request-guard.js · 入参总闸（体积/深度/键数/危险键；v1.1/D34 安全基线）
// 口径：CONTRACT §11.3（v1.1 安全基线）、ENGINEERING §7「后端安全基线」。
// 位置：中间件链第一个（只读 payload 形状，不依赖身份）；internal 动作同样受闸（空 payload 天然通过）。
// 纪律：越界只返回 13 码内 VALIDATION_FAILED 人话；不打印 payload 内容；不改变合法请求语义。
'use strict';

const errors = require('../lib/errors');

const DANGEROUS_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_KEYS = 256;
const MAX_STRING_LENGTH = 8192;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 深拷贝式净化：剥危险键、统计键数、限制层级与单字符串长度；返回新对象（不改原 payload）。
function sanitize(value, info, depth) {
  if (depth > MAX_DEPTH) {
    throw errors.validation('data', '请求内容层级过深，请重试');
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw errors.validation('data', '请求内容过长，请重试');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, info, depth + 1));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out = {};
  const keys = Object.keys(value);
  info.keys += keys.length;
  if (info.keys > MAX_KEYS) {
    throw errors.validation('data', '请求内容字段过多，请重试');
  }
  keys.forEach((key) => {
    if (DANGEROUS_KEYS.indexOf(key) >= 0) {
      info.stripped += 1;
      return;
    }
    out[key] = sanitize(value[key], info, depth + 1);
  });
  return out;
}

function payloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch (error) {
    throw errors.validation('data', '请求内容格式不正确，请重试');
  }
}

async function middleware(state) {
  const payload = state.payload;
  if (payload === undefined || payload === null) {
    state.payload = {};
    state.meta.requestGuard = { bytes: 0, keys: 0, stripped: 0 };
    return state;
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return state; // 非对象交给 validate 层统一报「参数格式不正确」
  }
  const bytes = payloadBytes(payload);
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw errors.validation('data', '请求内容过大，请重试');
  }
  const info = { bytes, keys: 0, stripped: 0 };
  state.payload = sanitize(payload, info, 0);
  state.meta.requestGuard = info;
  return state;
}

module.exports = {
  middleware,
  DANGEROUS_KEYS,
  MAX_PAYLOAD_BYTES,
  MAX_DEPTH,
  MAX_KEYS,
  MAX_STRING_LENGTH,
  sanitize,
  payloadBytes
};
