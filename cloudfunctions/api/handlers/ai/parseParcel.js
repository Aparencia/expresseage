// handlers/ai/parseParcel.js · ai.parseParcel：识别兜底唯一外呼出口（DeepSeek 只在云函数侧调用）
// 口径：CONTRACT v0.9 §4.3；DATA_MODEL §4.9/§7.9；ENGINEERING §4.10。
// 硬判据：外发只发去敏文本（payload 白名单）、任何失败静默降级且必写 recognition_failures、不新增错误码。
// 合并策略：AI 只作预填建议；服务端规则快照命中的字段优先，用户手填仍由客户端保证优先。
// 原图关联：客户端把已上传截图的 fileId 一并传入，服务端只在上传票据（归属/purpose/有效期/云路径）全部通过时落库。
'use strict';

const stations = require('../../shared/stations');
const { errors } = require('../../lib/errors');
const { AI_ERROR_CODES, normalizeAiConfig, createDeepSeekClient } = require('../../lib/ai/deepseek');
const { buildAiPayload } = require('../../lib/ai/payload');
const uploadCommon = require('../upload/_common');
const common = require('./_common');

const NEEDS_REVIEW_FAILURE = {
  NO_TEXT: 'NO_TEXT',
  PARSE_MISS: 'PARSE_MISS',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  LLM_ERROR: 'LLM_ERROR'
};

function aiModelOf(config) {
  const cfg = normalizeAiConfig(config);
  return cfg.model || '';
}

function failureCodeFor(options) {
  const opt = options || {};
  if (opt.noText) {
    return NEEDS_REVIEW_FAILURE.NO_TEXT;
  }
  if (!opt.merged.recognized) {
    return opt.aiTried && opt.aiErrorCode ? NEEDS_REVIEW_FAILURE.LLM_ERROR : NEEDS_REVIEW_FAILURE.PARSE_MISS;
  }
  return NEEDS_REVIEW_FAILURE.LOW_CONFIDENCE;
}

// 入队参数唯一构造点：每个 recognized=false 返回点都经 recordFailure（门禁 #26）；
// fileId 只由调用方传入票据校验后的真实值（校验失败为 ''），此处绝不伪造。
function queueOf(ruleResult, ocrTextMasked, extras) {
  const extra = extras || {};
  return {
    failureCode: extra.failureCode || '',
    ruleResult: ruleResult,
    aiTried: extra.aiTried === true,
    aiModel: extra.aiModel || '',
    aiResult: extra.aiResult || null,
    aiErrorCode: extra.aiErrorCode || '',
    uploadTicketId: extra.uploadTicketId || '',
    fileId: extra.fileId || '',
    ocrTextMasked: ocrTextMasked
  };
}

function queueFields(merged, aiFields) {
  return {
    stationId: merged.stationId,
    stationName: merged.stationName,
    pickupCode: merged.pickupCode,
    trackingTail: merged.trackingTail,
    lockerNo: merged.lockerNo,
    confidence: aiFields && aiFields.confidence ? aiFields.confidence : '',
    recognized: merged.recognized
  };
}

module.exports = async function aiParseParcel(ctx, payload) {
  const scope = common.assertBusinessRole(ctx);
  common.assertWritable(ctx);
  const input = common.normalizePayload(payload, scope);
  const now = common.nowMsOf(ctx);
  const config = ctx.config || {};
  const aiConfig = normalizeAiConfig(config);
  const ticket = await common.loadUploadTicket(ctx, input.uploadTicketId);
  const ticketStatus = common.ticketStatusOf(ticket, scope, now);
  const maskedPayload = buildAiPayload({
    ocrTextMasked: input.ocrTextMasked,
    hintTrackingTail: input.hintTrackingTail,
    role: input.role
  });
  const ruleResult = common.buildRuleResult(
    maskedPayload.ocrTextMasked,
    input.hintTrackingTail,
    ticketStatus,
    config
  );
  // 原图入队关联：上传票据归属/purpose=TICKET/未过期未消费 + fileId 恰好落在票据云路径上，才写入真实 fileId
  const fileId = ticketStatus.valid ? uploadCommon.resolveTicketFileId(ticket, input.fileId) : '';
  // 服务端规则与 AI prompt 都使用「当前配置站点名」（D32：后台可改正式名），只认注入站点表
  const stationTable = stations.listStations({ stations: stations.stationsFromConfig(config) });
  const aiFieldsEmpty = {
    stationId: ruleResult.stationId,
    stationName: ruleResult.stationName,
    pickupCode: ruleResult.pickupCode,
    trackingTail: ruleResult.trackingTail,
    lockerNo: ruleResult.lockerNo,
    confidence: 'LOW',
    recognized: !!(ruleResult.stationId && ruleResult.pickupCode)
  };

  // 幂等：同一 clientRequestId 重放返回同一 failureId（不重复入队、不重复外呼、不重复计数）
  const replay = await ctx.dao.findOne(common.COLLECTIONS.RECOGNITION_FAILURES, {
    where: { requestKey: [scope.openid, 'ai.parseParcel', ctx.clientRequestId || ''].join(':') }
  });
  if (replay) {
    return common.aiParse.buildDegradedDto({ failureNo: replay.failureNo }, aiFieldsEmpty, { source: 'NONE' });
  }

  // ① OCR 无文本：不外呼，直接入队 NO_TEXT（仍关联已上传原图）
  if (maskedPayload.ocrTextMasked === '') {
    const queue = await common.recordFailure(ctx, queueOf(ruleResult, '', {
      failureCode: NEEDS_REVIEW_FAILURE.NO_TEXT,
      uploadTicketId: input.uploadTicketId,
      fileId: fileId
    }));
    return common.aiParse.buildDegradedDto(queue, aiFieldsEmpty, { source: 'NONE' });
  }

  // ② 配额（5 次/人/日 + 全局日配额）：超限不外呼、静默降级并入队
  const quota = await common.checkQuota(ctx, scope.openid, now, aiConfig);
  if (!quota.allowed) {
    const queue = await common.recordFailure(ctx, queueOf(ruleResult, maskedPayload.ocrTextMasked, {
      failureCode: NEEDS_REVIEW_FAILURE.LLM_ERROR,
      aiErrorCode: AI_ERROR_CODES.QUOTA_EXCEEDED,
      uploadTicketId: input.uploadTicketId,
      fileId: fileId
    }));
    return common.aiParse.buildDegradedDto(queue, aiFieldsEmpty, { source: 'NONE' });
  }

  // ③ 开关关闭 / Key 缺失：不外呼、静默降级并入队（应用可正常启动）
  const client = createDeepSeekClient({ env: ctx.env, config, now: () => now });
  const clientStatus = client.status(now);
  if (!clientStatus.enabled || !clientStatus.hasKey) {
    const queue = await common.recordFailure(ctx, queueOf(ruleResult, maskedPayload.ocrTextMasked, {
      failureCode: NEEDS_REVIEW_FAILURE.LLM_ERROR,
      aiErrorCode: AI_ERROR_CODES.DISABLED,
      uploadTicketId: input.uploadTicketId,
      fileId: fileId
    }));
    return common.aiParse.buildDegradedDto(queue, aiFieldsEmpty, { source: 'NONE' });
  }

  // ④ 实际外呼（先计配额；payload 走白名单构造器，只发去敏文本）
  await common.countQuota(ctx, quota.keys, now);
  const result = await client.complete(maskedPayload, { stations: stationTable });
  if (!result.ok) {
    const queue = await common.recordFailure(ctx, queueOf(ruleResult, maskedPayload.ocrTextMasked, {
      failureCode: NEEDS_REVIEW_FAILURE.LLM_ERROR,
      aiTried: result.aiTried === true,
      aiModel: aiModelOf(config),
      aiErrorCode: result.errorCode || AI_ERROR_CODES.HTTP_5XX,
      uploadTicketId: input.uploadTicketId,
      fileId: fileId
    }));
    return common.aiParse.buildDegradedDto(queue, aiFieldsEmpty, { source: 'NONE' });
  }

  // ⑤ 解析模型输出：失败不重试、记 PARSE_ERROR 并入队
  const rawResult = common.aiParse.parseJsonObject(result.content);
  if (!rawResult) {
    client.noteParseFailure();
    const queue = await common.recordFailure(ctx, queueOf(ruleResult, maskedPayload.ocrTextMasked, {
      failureCode: NEEDS_REVIEW_FAILURE.LLM_ERROR,
      aiTried: true,
      aiModel: aiModelOf(config),
      aiErrorCode: AI_ERROR_CODES.PARSE_ERROR,
      uploadTicketId: input.uploadTicketId,
      fileId: fileId
    }));
    return common.aiParse.buildDegradedDto(queue, aiFieldsEmpty, { source: 'NONE' });
  }

  // ⑥ 字段裁剪 + 规则优先合并（AI 只补空位，不覆盖规则已确认字段）
  const aiFields = common.aiParse.normalizeAiFields(rawResult, {
    stationIds: stations.STATION_IDS,
    stations: stationTable
  });
  const mergedResult = common.aiParse.mergeFields(ruleResult, aiFields);
  const merged = mergedResult.fields;
  const recognized = !!(merged.stationId && merged.pickupCode);
  const needsReview = !recognized || aiFields.confidence === common.enums.CONFIDENCE_LEVEL.LOW;
  if (!needsReview) {
    return {
      recognized: true,
      stationId: merged.stationId,
      stationName: merged.stationName,
      pickupCode: merged.pickupCode,
      trackingTail: merged.trackingTail,
      lockerNo: merged.lockerNo,
      confidence: aiFields.confidence,
      source: mergedResult.source,
      needsReview: false
    };
  }

  // ⑦ 仍不可信/低置信：写队列（PARSE_MISS / LOW_CONFIDENCE）后静默降级
  const fields = queueFields(merged, aiFields);
  const queue = await common.recordFailure(ctx, queueOf(ruleResult, maskedPayload.ocrTextMasked, {
    failureCode: failureCodeFor({ merged: { recognized }, aiTried: true, aiErrorCode: '' }),
    aiTried: true,
    aiModel: aiModelOf(config),
    aiResult: fields,
    uploadTicketId: input.uploadTicketId,
    fileId: fileId
  }));
  return common.aiParse.buildDegradedDto(queue, fields, { source: mergedResult.source });
};
