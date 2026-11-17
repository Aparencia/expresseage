// handlers/partner/searchTransferTargets.js · partner.searchTransferTargets（D87-a，转派候选检索）
// 口径：CONTRACT §13 D87；DATA_MODEL §2.3 读屏蔽（D87 改写：仅转派场景的受限检索）/§2.10 限流。
// 边界：只回 partnerNo/displayName/acceptingOrders 三键（无 openid/_id/头像/stats）；无游标（反枚举）；
//       结果上限 20；真实×测试隔离与 order.requestTransfer 同口径（Q9：主兼职可转任意 ACTIVE、子队员限本队）。
// 实现取舍：DAO 不支持正则/前缀下推 → 有界扫描窗（SCAN_LIMIT）+ 内存前缀过滤，超窗盲区登记 TD（不静默）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const { errors } = require('../../lib/errors');
const time = require('../../lib/time');
const identity = require('../user/_common');
const configCommon = require('../config/_common');
const { DEFAULT_CONFIG } = require('../../db/config');
const team = require('./_team');
const targetScope = require('./_transfer-target');

const SCAN_LIMIT = 200; // 扫描窗（无游标：单次最多看 200 名在岗兼职）
const RESULT_LIMIT = 20; // 单次返回上限（反枚举：不给分页、不回总量）
const CODE_MIN = 3; // 编号本体最短前缀（不含前缀字母 P）
const NAME_MIN = 2; // 昵称最短前缀（按字符数）

// 关键词归一：去空白/连字符/下划线并大写；只用于编号匹配（昵称匹配用原串，保中文与大小写）。
function normalizeKeyword(raw) {
  return String(raw == null ? '' : raw).replace(/[\s\-_]/g, '').toUpperCase();
}

// 编号本体（去前导 P）：P-8F3-K2M / p8f3k2m / 8F3 三种输入都能命中同一前缀。
function codeBodyOf(keyword) {
  return /^P[0-9A-Z]*$/.test(keyword) ? keyword.slice(1) : keyword;
}

// 昵称闸：中文字符 ≥2 字，或任意字符 ≥4（挡住 2~3 位 ASCII 的暴力枚举空间，又不把英文昵称挡死）。
function nameOkOf(text) {
  const chars = Array.from(text);
  if (chars.length < NAME_MIN) {
    return false;
  }
  return /[^\x00-\x7F]/.test(text) || chars.length >= 4;
}

// 关键词闸：编号前缀 ≥3 或 昵称前缀（见 nameOkOf），二者都不满足 → VALIDATION_FAILED（页面零判据，文案在此单源）。
function readKeyword(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const normalized = normalizeKeyword(text);
  const codeBody = codeBodyOf(normalized);
  const codeOk = /^[0-9A-Z]+$/.test(codeBody) && codeBody.length >= CODE_MIN;
  const nameOk = nameOkOf(text);
  if (!codeOk && !nameOk) {
    throw errors.validation('keyword', '至少输入 2 个字，或编号的前 3 位');
  }
  return { text: text, codeBody: codeOk ? codeBody : '', nameOk: nameOk };
}


// 命中判定：编号前缀（本体 startsWith）或 昵称前缀（startsWith，不含片段/模糊）。
function matchOf(row, keyword) {
  const no = String(row.partnerNo || '').toUpperCase();
  const codeHit = !!keyword.codeBody && no.slice(1).indexOf(keyword.codeBody) === 0;
  const nameHit = keyword.nameOk && String(row.displayName || '').indexOf(keyword.text) === 0;
  return codeHit || nameHit;
}

// 限流：窗口/日两桶（与 D59 子码限流同形；计数已计，超阈值 RATE_LIMITED）。
function searchRateOf(config) {
  const source = (config && config.transferSearchRate) || {};
  const pick = (value, fallback) => (Number(value) > 0 ? Number(value) : Number(fallback));
  return {
    perMinute: pick(source.perMinute, DEFAULT_CONFIG.transferSearchRate.perMinute),
    perDay: pick(source.perDay, DEFAULT_CONFIG.transferSearchRate.perDay)
  };
}

async function consumeSearchRate(ctx, nowMs, config) {
  const openid = String((ctx.identity && ctx.identity.effectiveOpenid) || ctx.openid || '');
  if (!openid) {
    return;
  }
  const rate = searchRateOf(config);
  const keys = {
    minute: 'rl:transferSearch:' + openid + ':' + team.minuteWindowKeyOf(nowMs),
    day: 'rl:transferSearch:' + openid + ':d' + time.dayKey(nowMs)
  };
  const used = await team.bumpRateCounters(ctx, keys, new Date(time.toMs(nowMs)));
  if (used.minute > rate.perMinute || used.day > rate.perDay) {
    throw errors.rateLimited('查询太频繁，请稍后再试');
  }
}

// 扫描窗内过滤：在岗 + 同侧 + 排除自己 + 子队员限本队 + 关键词命中；编号序稳定（结果可复现）。
async function candidatesOf(ctx, partner, keyword) {
  const rows = await ctx.dao.find(COLLECTIONS.PARTNERS, {
    where: { status: enums.PARTNER_STATUS.ACTIVE },
    orderBy: [['partnerNo', 'asc']],
    limit: SCAN_LIMIT
  });
  const mySide = targetScope.isTestOpenid(partner.openid);
  const mainPartnerId = team.isSubMember(partner) ? team.parentPartnerIdOf(partner) : '';
  return rows
    .filter((row) => !!row && !row.deletedAt)
    .filter((row) => String(row._id) !== String(partner._id))
    .filter((row) => targetScope.isTestOpenid(row.openid) === mySide)
    .filter((row) => targetScope.canReach(row, mainPartnerId))
    .filter((row) => matchOf(row, keyword))
    .map(targetScope.cardOf);
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const input = payload && typeof payload === 'object' ? payload : {};
  const keyword = readKeyword(input.keyword);
  const config = await configCommon.loadRuntimeConfig(ctx);
  await consumeSearchRate(ctx, identity.nowMs(ctx), config);
  const cards = await candidatesOf(ctx, partner, keyword);
  const limit = Math.min(RESULT_LIMIT, Math.max(1, Number(input.limit) || RESULT_LIMIT));
  return { list: cards.slice(0, limit), truncated: cards.length > limit };
}

module.exports = { handler };
