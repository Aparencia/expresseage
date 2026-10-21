// pkg-admin/pages/messages/parts/view-model.js · 后台消息视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §2.5/§3.10——异常工单 + 识别失败摘要 + 系统状态；计数口径由服务端给。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

function decorateOrder(item) {
  const row = item || {};
  const exception = row.exception || {};
  return {
    orderNo: row.orderNo || '—',
    exceptionText: exception.codeText || exception.text || (exception.code ? '已上报异常' : '异常工单'),
    reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : '',
    partnerNo: row.partnerNo || '',
    isTest: row.isTest === true
  };
}

function decorateFailure(item) {
  const row = item || {};
  return {
    failureNo: row.failureNo || '—',
    failureCodeText: C.FAILURE_CODE_LABELS[row.failureCode] || '识别失败',
    sourceRoleText: C.ROLE_LABELS[row.sourceRole] || '—',
    uploaderText: F.joinParts([row.uploaderNo, row.uploaderDisplayName], ' '),
    createdAtText: F.formatTime(row.createdAt),
    orderNo: row.orderNo || ''
  };
}

function decorateList(list, decorator) {
  return (list || []).map(decorator);
}

// 系统状态提示（维护中 / 公告已启用）
function buildSystemLines(config) {
  const source = config || {};
  const lines = [];
  const maintenance = source.maintenance || {};
  const announcement = source.announcement || {};
  if (maintenance.enabled === true) {
    lines.push('维护中：' + (maintenance.text || '系统维护中'));
  }
  if (announcement.enabled === true) {
    lines.push('公告已启用：' + (announcement.title || '请查看端侧公告'));
  }
  return lines;
}

// 服务端计数（含超过一页的真实总数）优先；缺失时退回当前页条数
function buildTotals(stats, lists) {
  const counts = (stats && stats.counts) || {};
  const data = lists || {};
  const exceptionTotal = counts.exceptions === undefined ? (data.exceptions || []).length : F.numOrZero(counts.exceptions);
  const failureTotal = counts.pendingRecognitionFailures === undefined
    ? (data.failures || []).length
    : F.numOrZero(counts.pendingRecognitionFailures);
  return {
    exceptionTotal: exceptionTotal,
    failureTotal: failureTotal,
    hasAny: exceptionTotal + failureTotal > 0
  };
}

module.exports = {
  decorateOrder,
  decorateFailure,
  decorateList,
  buildSystemLines,
  buildTotals
};
