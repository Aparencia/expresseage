// middleware/validate.js · 通用入参校验（写动作 clientRequestId、expectedVersion；剥离未知/危险键）
// 业务字段级校验在 handler 内用 shared/validate.js 完成；本层只保证协议形状。
const sharedValidate = require('../shared/validate');
const errors = require('../lib/errors');

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

function sanitizePayload(payload) {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw errors.validation('data', '参数格式不正确，请刷新页面后重试');
  }
  const clean = {};
  Object.keys(payload).forEach((key) => {
    if (DANGEROUS_KEYS.indexOf(key) >= 0) {
      return;
    }
    clean[key] = payload[key];
  });
  return clean;
}

function hasClientRequestId(value) {
  return value !== undefined && value !== null && value !== '';
}

async function middleware(state) {
  const spec = state.meta.spec || {};
  const ctx = state.ctx;
  state.payload = sanitizePayload(state.payload);
  const clientRequestId = state.meta.clientRequestId;
  ctx.clientRequestId = typeof clientRequestId === 'string' ? clientRequestId : '';
  const isClientWrite = spec.visibility === 'client' && spec.write === true;
  if (isClientWrite || hasClientRequestId(clientRequestId)) {
    const check = sharedValidate.validateClientRequestId(clientRequestId);
    if (!check.ok) {
      throw errors.validation(check.field || 'clientRequestId', '请求标识缺失或格式不正确，请重试');
    }
  }
  const versionCheck = sharedValidate.validateExpectedVersion(state.meta.expectedVersion);
  if (!versionCheck.ok) {
    throw errors.validation(versionCheck.field || 'expectedVersion', '版本参数格式不正确，请刷新页面后重试');
  }
  ctx.expectedVersion = versionCheck.value === null ? undefined : versionCheck.value;
  return state;
}

module.exports = {
  middleware,
  sanitizePayload,
  DANGEROUS_KEYS
};
