// pkg-customer/pages/order-create/parts/ai-fallback.js · 识别失败文案 / 失败行 / 失败入队幂等键（纯件，零 wx）
// 口径：CONTRACT §4.3 v1.0（NO_TEXT 也入队、低置信只给建议）、DATA_MODEL §4.9（同图多件逐件一条记录）。
'use strict';

const ocr = require('../../../../utils/ocr/index');

const UPLOAD_TICKET_RE = /^[A-Za-z0-9]{32}$/;
const AI_SUGGESTION_HINT = '智能识别建议，请核对';

// §4.3.1 AI 兜底三态文案（关闭/超时/低置信；超限与关闭同句、不提示配额；用户取消 = 静默降级）
const AI_FALLBACK_COPY = {
  CLOSED: { text: '没识别出来，已反馈开发者复核，可手动填写。', next: '也可以换一张更清晰的图。' },
  TIMEOUT: { text: '智能识别超时，已反馈开发者复核，可手动填写或换一张图。', next: '手动填写不影响下单。' },
  LOW: { text: '识别结果不太确定，没自动填。', next: '已反馈开发者复核，可手动填写。' },
  USER_CANCEL: { text: '已取消智能识别，可以手动填写。', next: '也可以换一张更清晰的图。' }
};

// 低置信且「站点已识别、只缺取件码」时说真话（不说"没自动填"自相矛盾），并给下一步
const LOW_CODE_MISSING_COPY = {
  text: '取件码没把握，站点已识别，请核对或手动填写。',
  next: '已反馈开发者复核；取件码可手动填写，不影响下单。'
};

/** 三态文案选择（纯函数；state 非法按关闭处理，不装懂；context 用于低置信按缺失字段说真话） */
function aiFallbackCopy(state, context) {
  const info = context || {};
  if (state === 'LOW' && info.stationId && !info.pickupCode) {
    return LOW_CODE_MISSING_COPY;
  }
  return AI_FALLBACK_COPY[state] || AI_FALLBACK_COPY.CLOSED;
}

/** FNV-1a 32 位内容指纹（7 位 36 进制大写；纯函数、零随机） */
function contentHashOf(text) {
  const source = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return ('0000000' + (hash >>> 0).toString(36).toUpperCase()).slice(-7);
}

/**
 * 失败入队幂等键（16~32 位 [A-Za-z0-9]，确定性派生、零随机）：
 * 上传票据前 16 位 + OCR 内容指纹 + 件下标。同一张图同内容重试复用同一键（服务端 requestKey 幂等，
 * 不重复入队）；换图/内容变化/不同件自动分键（同图多件逐件各一条，DATA_MODEL §4.9）。
 */
function failureRequestIdOf(uploadTicketId, itemIndex, ocrTextMasked) {
  const ticket = typeof uploadTicketId === 'string' ? uploadTicketId.trim() : '';
  if (!UPLOAD_TICKET_RE.test(ticket)) {
    return '';
  }
  const index = Number.isInteger(itemIndex) && itemIndex >= 0 ? itemIndex : 0;
  const indexText = index < 10 ? '0' + index : String(index);
  return ticket.slice(0, 16) + contentHashOf(ocrTextMasked) + 'AI' + indexText;
}

/**
 * 失败态兜底文案（纯函数）：只有真的入队拿到 failureId 才敢说「已反馈开发者复核」；
 * 没入队（无票据/AI 调用异常）时用 OCR 单源文案，不撒谎。
 */
function failureCopyFor(code, fallback) {
  const info = fallback || {};
  const base = ocr.failureCopy(code);
  if (!info.failureId) {
    return base;
  }
  const aiCopy = aiFallbackCopy(info.aiState);
  return {
    text: base.text,
    next: aiCopy.text.indexOf('已反馈') >= 0 ? '已反馈开发者复核，也可以手动填写后提交。' : base.next
  };
}

/** 失败识别结果统一形状（纯函数）：image/ocrText 保持键位，页面按 failureCopy 出失败卡 */
function failureResultOf(file, image, failureCode, queued, detail) {
  return {
    ok: false,
    file: file || {},
    image: image || null,
    ocrText: '',
    failureCode: failureCode,
    failureCopy: failureCopyFor(failureCode, queued || {}),
    failureId: (queued && queued.failureId) || '',
    aiTried: !!(queued && queued.failureId),
    detail: detail || ''
  };
}

/** 失败卡行（纯函数）：只展示有人话文案的失败——copy 为空的记录不渲染空行（仍已入队，开发者可见） */
function failureRowsOf(results) {
  return (results || []).filter(function failed(result) {
    return !!result.failureCopy;
  }).map(function brief(result) {
    return {
      imageIndex: result.imageIndex,
      failureCode: result.failureCode || '',
      failureId: result.failureId || '',
      copy: result.failureCopy
    };
  });
}

module.exports = {
  AI_SUGGESTION_HINT,
  AI_FALLBACK_COPY,
  LOW_CODE_MISSING_COPY,
  aiFallbackCopy,
  contentHashOf,
  failureRequestIdOf,
  failureCopyFor,
  failureResultOf,
  failureRowsOf
};
