// pkg-admin/pages/overview/parts/view-model.js · 总览页视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.1——统计卡（排除测试数据由服务端保证）、抬头、红点、状态条、审计区块。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

const AUDIT_FALLBACK = '其他操作';
const HEADER_HINT = '仅用于治理与排障';

function num(value) {
  return F.numOrZero(value);
}

// 抬头：developerNo 只作展示（来源 admin.stats.developerNo），有值才拼接编号，无值只留治理提示；
// 不参与任何权限判断（无权限五态只由 common/feedback 的 FORBIDDEN 接管）。
function buildHeader(stats) {
  const raw = (stats || {}).developerNo;
  let developerNo = '';
  if (typeof raw === 'string') {
    developerNo = raw.trim();
  } else if (typeof raw === 'number' && isFinite(raw)) {
    developerNo = String(raw);
  }
  return {
    developerNo: developerNo,
    subtitle: developerNo ? developerNo + ' · ' + HEADER_HINT : HEADER_HINT
  };
}

// admin.stats → 统计卡 + 红点（待处理异常 + PENDING 识别失败）
function buildCounts(stats) {
  const source = stats || {};
  const counts = source.counts || {};
  const today = source.today || {};
  const exceptions = num(counts.exceptions);
  const pendingFailures = num(counts.pendingRecognitionFailures === undefined
    ? counts.pendingFailures
    : counts.pendingRecognitionFailures);
  return {
    counts: {
      todayOrders: num(today.orders === undefined ? counts.todayOrders : today.orders),
      exceptions: exceptions,
      activePartners: num(counts.activePartners),
      customers: num(counts.customers),
      pendingFailures: pendingFailures
    },
    badge: exceptions + pendingFailures
  };
}

// 状态条：维护中 / 公告已启用（顺序固定，供页面直接渲染）
function buildStatusBar(config) {
  const source = config || {};
  const lines = [];
  const maintenance = source.maintenance || {};
  const announcement = source.announcement || {};
  if (maintenance.enabled === true) {
    lines.push('维护中：' + (maintenance.text || '系统维护中'));
  }
  if (announcement.enabled === true) {
    lines.push('公告：' + (announcement.title || '已启用'));
  }
  return lines;
}

function decorateTarget(target) {
  if (!target) return '—';
  if (typeof target === 'string') return target || '—';
  const label = target.no || target.displayName || target.type || '';
  return label ? String(label) : '—';
}

function decorateAudit(item) {
  const row = item || {};
  return {
    actionText: C.AUDIT_ACTION_LABELS[row.action] || AUDIT_FALLBACK,
    developerNo: row.developerNo || '—',
    targetText: decorateTarget(row.target),
    timeText: F.formatTime(row.at)
  };
}

function decorateAuditList(list) {
  return (list || []).map(decorateAudit);
}

module.exports = {
  AUDIT_FALLBACK,
  buildHeader,
  buildCounts,
  buildStatusBar,
  decorateTarget,
  decorateAudit,
  decorateAuditList
};
