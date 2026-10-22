// utils/preview-cache.js · 绑定页预览的一次性内存缓存（纯件：零 wx、零本地存储、进程内有效）
// 目的（批 10 A 批 P1-2）：角色页卡片落地已经 partner.getPublic 一次；绑定页落地优先取这份预览，
//   让「一次落地」的 getPublic 调用 ≤1（0 次「查询」点击 + 不重复扣每日 5 次限额）。
// 安全边界：只缓存绑定前可见的公开字段（昵称/服务/范围/接单状态），**绝不缓存头像**
//   （CONTRACT §5.3/D19：绑定前不显示头像）；不落盘、不跨会话（解绑/注销后内存随进程失效）。
// 生命周期：TTL 30s（角色页 → 绑定页的点击间隔内），take() 取后即删（一次落地只用一次）。
'use strict';

const ids = require('./ids');

const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 8;
// 绑定前公开字段白名单：DTO 将来新增敏感字段也不会被这里带走
const PUBLIC_FIELDS = ['partnerNo', 'displayName', 'services', 'zones', 'acceptingOrders', 'status'];

const entries = [];

// 只认合法兼职编号（P+6 位）；其它编号/脏值不进缓存、也不命中
function canonicalOf(raw) {
  const parsed = ids.parseNo(ids.normalizeInput(raw));
  return parsed.ok && parsed.kind === ids.NO_KIND.PARTNER ? parsed.canonical : '';
}

function clockOf(now) {
  return typeof now === 'number' && isFinite(now) ? now : Date.now();
}

function isAlive(entry, now) {
  return entry.expiresAt > now;
}

function dropExpired(now) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (!isAlive(entries[i], now)) {
      entries.splice(i, 1);
    }
  }
}

function pickPublic(source) {
  const picked = {};
  PUBLIC_FIELDS.forEach(function copy(field) {
    if (source[field] !== undefined) {
      picked[field] = source[field];
    }
  });
  if (Array.isArray(picked.services)) {
    picked.services = picked.services.slice();
  }
  if (Array.isArray(picked.zones)) {
    picked.zones = picked.zones.slice();
  }
  return picked;
}

// 角色页卡片预览成功时调一次（同编号覆盖旧值；总数有界，避免内存无限增长）
function remember(partnerNo, preview, now) {
  const source = preview || null;
  const rawKey = typeof partnerNo === 'string' ? partnerNo.trim() : '';
  // 显式传入编号时只认它（非法编号直接拒收，不拿 preview.partnerNo 兜底，避免脏键混入）
  const key = rawKey ? canonicalOf(rawKey) : canonicalOf(source && source.partnerNo);
  if (!key || !source) {
    return false;
  }
  const time = clockOf(now);
  dropExpired(time);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].key === key) {
      entries.splice(i, 1);
    }
  }
  const value = pickPublic(Object.assign({}, source, { partnerNo: source.partnerNo || key }));
  entries.unshift({ key: key, value: value, expiresAt: time + TTL_MS });
  while (entries.length > MAX_ENTRIES) {
    entries.pop();
  }
  return true;
}

// 绑定页落地优先取：命中返回预览（并立即从缓存删除），未命中/过期返回 null
function take(partnerNo, now) {
  const key = canonicalOf(partnerNo);
  const time = clockOf(now);
  if (!key) {
    return null;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].key !== key) {
      continue;
    }
    const entry = entries.splice(i, 1)[0];
    return isAlive(entry, time) ? entry.value : null;
  }
  return null;
}

module.exports = {
  TTL_MS,
  remember,
  take,
  canonicalOf
};
