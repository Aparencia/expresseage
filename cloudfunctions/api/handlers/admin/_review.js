// handlers/admin/_review.js · 识别失败复核共用件（上传者脱敏信息 / 关联订单号 / 站内通知）
// 口径：DATA_MODEL §2.14、ENGINEERING §4.10.6；通知只写站内消息（订阅消息 P1），不含原图/失败码细节。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const time = require('../../lib/time');
const { createDeepSeekClient } = require('../../lib/ai/deepseek');

const NOTIFY_TEMPLATE = 'RECOGNITION_REVIEW';
const NOTIFY_TEXT = '你的截图识别失败，开发者已处理；如需补充取件码，请到订单页面手动填写。';

// 批 39（D83）：复核归因枚举 —— 复核完成时记录「为什么识别失败」，供后台按月看 TOP 原因反哺规则/配置。
// 只进复核记录 resolution.rootCause（受控枚举），不新增集合/索引/客户端可见字段。
const ROOT_CAUSE = Object.freeze({
  CODE_PATTERN: 'CODE_PATTERN',
  ALIAS: 'ALIAS',
  TEXT_NOISE: 'TEXT_NOISE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  OCR_QUALITY: 'OCR_QUALITY',
  OTHER: 'OTHER'
});
const ROOT_CAUSE_LABELS = Object.freeze({
  CODE_PATTERN: '取件码格式配置',
  ALIAS: '站点别名缺失',
  TEXT_NOISE: '截图文字噪声',
  AI_UNAVAILABLE: 'AI 兜底不可用',
  OCR_QUALITY: 'OCR 质量差',
  OTHER: '其他'
});
function rootCauseOptions() {
  return Object.keys(ROOT_CAUSE).map((code) => ({ code: code, label: ROOT_CAUSE_LABELS[code] }));
}
// 可选入参：只接受枚举值或空串（页面可不填）；非法值 VALIDATION_FAILED 由调用方转错误码。
function normalizeRootCause(value, errors) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROOT_CAUSE[text]) {
    throw errors.validation('rootCause', '复核归因不正确');
  }
  return text;
}

// 只读 AI 兜底状态（供开发者判断开关/Key 未配/模型；hasKey 只返回布尔，绝不下发 Key 值）。
function aiStatusOf(ctx, config, nowMs) {
  const client = createDeepSeekClient({ env: ctx && ctx.env, config: config, now: nowMs });
  const status = client.status(nowMs);
  return {
    enabled: status.enabled === true,
    hasKey: status.hasKey === true,
    model: status.model || ''
  };
}

async function loadUploader(scope, record) {
  const openid = record && record.uploaderOpenid ? record.uploaderOpenid : '';
  const result = { openid: openid, no: '', displayName: '' };
  if (!openid) {
    return result;
  }
  if (record.sourceRole === 'CUSTOMER') {
    const customer = await scope.dao.get(COLLECTIONS.CUSTOMERS, openid);
    if (customer) {
      result.no = customer.customerNo || '';
      result.displayName = customer.displayName || '';
    }
    return result;
  }
  const partner = await scope.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: openid } });
  if (partner) {
    result.no = partner.partnerNo || '';
    result.displayName = partner.displayName || '';
  }
  return result;
}

async function orderNoOf(scope, record) {
  if (!record || !record.orderId) {
    return '';
  }
  const order = await scope.dao.get(COLLECTIONS.ORDERS, record.orderId);
  return order ? order.orderNo || '' : '';
}

// 同一记录同日重复通知幂等（只发一条）；无关联订单时不写站内消息。
async function notifyUploader(scope, record, failureNo) {
  if (!record || !record.orderId) {
    return false;
  }
  const today = time.dayKey(scope.now);
  const rows = await scope.dao.find(COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: record.orderId, templateCode: NOTIFY_TEMPLATE },
    limit: 20
  });
  const existed = rows.some((row) => time.dayKey(time.toMs(row.createdAt)) === today);
  if (existed) {
    return true;
  }
  await scope.dao.add(COLLECTIONS.ORDER_MESSAGES, {
    orderId: record.orderId,
    fromRole: record.sourceRole || 'CUSTOMER',
    fromId: 'SYSTEM',
    text: NOTIFY_TEXT,
    templateCode: NOTIFY_TEMPLATE,
    referenceNo: failureNo || '',
    createdAt: scope.nowDate,
    readAt: null
  });
  return true;
}

module.exports = {
  NOTIFY_TEMPLATE,
  NOTIFY_TEXT,
  ROOT_CAUSE,
  ROOT_CAUSE_LABELS,
  rootCauseOptions,
  normalizeRootCause,
  aiStatusOf,
  loadUploader,
  orderNoOf,
  notifyUploader
};
