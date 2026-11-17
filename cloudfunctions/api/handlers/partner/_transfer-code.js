// handlers/partner/_transfer-code.js · 转派码共用件（D88：归一/展示/TTL/限流）
// 口径：CONTRACT §13 D88；DATA_MODEL §2.3（partners.transferCode/transferCodeExpiresAt）、§2.10（限流）。
// 纪律：码只做「人传人」的短凭证，不是口令、不参与鉴权；库内只存大写本体，展示加连字符便于口头传达。
'use strict';

const enums = require('../../shared/enums');
const time = require('../../lib/time');
const { errors } = require('../../lib/errors');
const { DEFAULT_CONFIG } = require('../../db/config');
const team = require('./_team');

const CODE_LENGTH = 6;
// 只认 CODE_ALPHABET（去掉 0/1/I/O 易混字符）；统一大写、去掉空格与连字符
const CODE_PATTERN = new RegExp('^[' + enums.CODE_ALPHABET + ']{' + CODE_LENGTH + '}$');
const MINUTE_MS = 60 * 1000;
const COPY = {
  invalid: '转派码无效或已过期，请让对方重新生成',
  self: '不能转派给自己'
};

function normalizeCode(raw) {
  const text = String(raw == null ? '' : raw).toUpperCase().replace(/[\s\-]/g, '');
  return CODE_PATTERN.test(text) ? text : '';
}

// 展示形：ABC-DEF（3+3 分组，便于口头/截图传达；解析时连字符会被归一掉）
function displayCodeOf(code) {
  const text = String(code || '');
  return text.length === CODE_LENGTH ? text.slice(0, 3) + '-' + text.slice(3) : text;
}

function ttlMinutesOf(config) {
  const value = Number(config && config.transferCodeTtlMinutes);
  return value > 0 ? value : Number(DEFAULT_CONFIG.transferCodeTtlMinutes);
}

function expiresAtOf(nowMs, config) {
  return time.toMs(nowMs) + ttlMinutesOf(config) * MINUTE_MS;
}

// 库内时间可能是 Date（管理端写）或毫秒数；无值/非法归 0（0 = 从未签发，视为无效）
function msOf(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value;
  }
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return isFinite(parsed) ? parsed : 0;
}

// 惰性过期（同 D58/TD-091）：不新增 sweep，只在签发/解析时判定
function isExpired(expiresAt, nowMs) {
  const ms = msOf(expiresAt);
  return !(ms > 0) || ms <= time.toMs(nowMs);
}

function rateOf(config) {
  const source = (config && config.transferCodeRate) || {};
  const pick = (value, fallback) => (Number(value) > 0 ? Number(value) : Number(fallback));
  return {
    perMinute: pick(source.perMinute, DEFAULT_CONFIG.transferCodeRate.perMinute),
    perDay: pick(source.perDay, DEFAULT_CONFIG.transferCodeRate.perDay)
  };
}

// 签发/解析共用同一桶 rl:transferCode:{openid}（一次签发+一次解析算同一轮，防"签发即无限试码"）
async function consumeCodeRate(ctx, nowMs, config) {
  const openid = String((ctx.identity && ctx.identity.effectiveOpenid) || ctx.openid || '');
  if (!openid) {
    return;
  }
  const rate = rateOf(config);
  const keys = {
    minute: 'rl:transferCode:' + openid + ':' + team.minuteWindowKeyOf(nowMs),
    day: 'rl:transferCode:' + openid + ':d' + time.dayKey(nowMs)
  };
  const used = await team.bumpRateCounters(ctx, keys, new Date(time.toMs(nowMs)));
  if (used.minute > rate.perMinute || used.day > rate.perDay) {
    throw errors.rateLimited('操作太频繁，请稍后再试');
  }
}

module.exports = {
  CODE_LENGTH,
  COPY,
  normalizeCode,
  displayCodeOf,
  ttlMinutesOf,
  expiresAtOf,
  msOf,
  isExpired,
  rateOf,
  consumeCodeRate
};
