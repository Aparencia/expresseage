// pkg-admin/pages/recognition-review/parts/view-model.js · 识别失败复核视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.11/§5.6/§8.6——列表/详情脱敏字段、AI 排障码中文映射、补录/忽略校验、筛选参数。
'use strict';

const F = require('../../../common/format');
const C = require('../../../common/constants');

const DAY_MS = 24 * 60 * 60 * 1000;
const AI_TRIED_TEXT = { true: '已尝试', false: '未尝试' };

// 内部排障码 → 人话（只描述发生了什么 + 已入队待复核；不暴露英文码）
const AI_ERROR_LABELS = {
  TIMEOUT: '智能识别超时，已按识别失败入队。',
  HTTP_5XX: '智能识别服务暂时不可用，已按识别失败入队。',
  QUOTA_EXCEEDED: '智能识别配额已用完，已按识别失败入队。',
  PARSE_ERROR: '智能识别返回格式不可解析，已按识别失败入队。',
  DISABLED: '智能识别兜底已关闭，已按识别失败入队。',
  CIRCUIT_OPEN: '智能识别连续失败已熔断，已按识别失败入队。'
};

function aiErrorLabel(code) {
  const key = String(code || '');
  if (!key) return '';
  return AI_ERROR_LABELS[key] || '智能识别未成功，已按识别失败入队。';
}

function buildStatusTabs(activeStatus, counts) {
  return C.FAILURE_STATUS_TABS.map(function mapTab(tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

function decorateRow(item, expandedNo) {
  const row = item || {};
  return {
    failureNo: row.failureNo || '—',
    failureCodeText: C.FAILURE_CODE_LABELS[row.failureCode] || '识别失败',
    sourceRoleText: C.ROLE_LABELS[row.sourceRole] || '—',
    uploaderText: F.joinParts([row.uploaderNo, row.uploaderDisplayName], ' '),
    createdAtText: F.formatTime(row.createdAt),
    statusText: C.FAILURE_STATUS_LABELS[row.status] || '—',
    orderNo: row.orderNo || '',
    expanded: row.failureNo === expandedNo
  };
}

function decorateList(list, expandedNo) {
  return (list || []).map(function mapRow(item) {
    return decorateRow(item, expandedNo);
  });
}

function buildRuleText(rule) {
  if (!rule) return '规则未识别到站点或取件码';
  if (typeof rule === 'string') return rule;
  const parts = [];
  if (rule.stationId) parts.push('站点 ' + rule.stationId);
  if (rule.pickupCode) parts.push('取件码 ' + rule.pickupCode);
  return parts.length ? parts.join(' · ') : '规则未识别到站点或取件码';
}

function buildAiResultText(result) {
  if (!result) return '—';
  if (typeof result === 'string') return result;
  const parts = [];
  if (result.stationId) parts.push('站点 ' + result.stationId);
  if (result.pickupCode) parts.push('取件码 ' + result.pickupCode);
  if (typeof result.confidence === 'number') parts.push('置信度 ' + result.confidence);
  return parts.length ? parts.join(' · ') : '—';
}

function decorateDetail(data) {
  const row = data || {};
  const ocrText = row.ocrTextMasked || '';
  const fold = C.LIMITS.ocrFoldAt;
  const ocrFoldable = ocrText.length > fold;
  const resolution = row.resolution || {};
  return {
    failureNo: row.failureNo || '',
    failureCodeText: C.FAILURE_CODE_LABELS[row.failureCode] || '识别失败',
    sourceRoleText: C.ROLE_LABELS[row.sourceRole] || '—',
    uploaderText: F.joinParts([row.uploaderNo, row.uploaderDisplayName], ' '),
    orderNo: row.orderNo || '',
    statusText: C.FAILURE_STATUS_LABELS[row.status] || '—',
    canReview: row.status === C.FAILURE_STATUS_PENDING,
    createdAtText: F.formatTime(row.createdAt),
    reviewedAtText: row.reviewedAt ? F.formatTime(row.reviewedAt) : '',
    ocrText: ocrText,
    ocrShort: ocrFoldable ? ocrText.slice(0, fold) + '…' : ocrText,
    ocrFoldable: ocrFoldable,
    ocrExpanded: false,
    ruleText: buildRuleText(row.ruleResult),
    aiTriedText: row.aiTried ? AI_TRIED_TEXT.true : AI_TRIED_TEXT.false,
    aiModelText: row.aiModel || '—',
    aiResultText: buildAiResultText(row.aiResult),
    aiErrorText: aiErrorLabel(row.aiErrorCode),
    resolutionNote: resolution.note || '',
    resolutionAtText: resolution.at ? F.formatTime(resolution.at) : ''
  };
}

// 筛选入参：状态/失败码/来源角色/近 N 天（0=全部），分页游标由调用方补
function buildParams(state, nowMs) {
  const data = state || {};
  const params = { status: data.activeStatus, limit: data.limit };
  if (data.activeCode) params.failureCode = data.activeCode;
  if (data.activeSource) params.sourceRole = data.activeSource;
  const days = Number(data.activeDate);
  if (days > 0) params.dateFrom = Number(nowMs) - days * DAY_MS;
  return params;
}

function buildEmptyText(activeStatus) {
  if (activeStatus === C.FAILURE_STATUS_PENDING) {
    return '还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。';
  }
  return '没有符合当前筛选的识别失败记录。';
}

function fixConfirmContent(stationId, pickupCode) {
  return '将把站点改为 ' + (stationId || '（未填写）') + '、取件码改为 ' + (pickupCode || '（未填写）') +
    '，仅回填识别字段；不改订单状态、不代确认、不创建订单。确定保存？';
}

// 补录校验：站点 ∈ P1~P8（选择器限制）或取件码非空；取件码 ≤40 位
function validateFix(input) {
  const data = input || {};
  const pickupCode = String(data.pickupCode || '').trim();
  if (!data.stationId && !pickupCode) {
    return { ok: false, error: '请选择站点或填写取件码后再补录。' };
  }
  if (pickupCode.length > C.LIMITS.pickupCodeMax) {
    return { ok: false, error: '取件码最多 40 位。' };
  }
  if (data.stationId && C.STATION_OPTIONS.indexOf(data.stationId) < 0) {
    return { ok: false, error: '请选择 P1~P8 中的站点。' };
  }
  const result = { ok: true, stationId: data.stationId || '', pickupCode: pickupCode };
  return result;
}

function validateIgnoreNote(note) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, error: '请填写忽略原因（最多 100 字）。' };
  if (text.length > C.LIMITS.ignoreNoteMax) return { ok: false, error: '忽略原因最多 100 字。' };
  return { ok: true, note: text };
}

module.exports = {
  DAY_MS,
  AI_ERROR_LABELS,
  aiErrorLabel,
  buildStatusTabs,
  decorateRow,
  decorateList,
  decorateDetail,
  buildRuleText,
  buildAiResultText,
  buildParams,
  buildEmptyText,
  fixConfirmContent,
  validateFix,
  validateIgnoreNote
};
