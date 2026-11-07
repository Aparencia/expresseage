// pkg-admin/common/customer-status.js · 顾客账号治理文案与校验（纯件，零 wx；D68）
// 口径：UX_DEVELOPER §3.3/§3.4——停用=冻结登录与写、资料/绑定/订单不动；注销不可逆。
// 调用方：pkg-admin/pages/customers 与 customer-detail 的视图模型（同一份文案单源）。
'use strict';

const C = require('./constants');

function suspendConfirmContent(item) {
  const row = item || {};
  const who = row.displayName && row.displayName !== '—' ? row.displayName : '该顾客';
  return '停用后，' + who + '（' + (row.customerNo || '—') + '）将无法登录与下单；' +
    '资料、绑定与进行中订单保持不变，恢复后即刻可用。确定停用？';
}

function resumeConfirmContent(item) {
  const row = item || {};
  const who = row.displayName && row.displayName !== '—' ? row.displayName : '该顾客';
  return '恢复后，' + who + '（' + (row.customerNo || '—') + '）可重新登录与下单；' +
    '停用期间产生的订单状态不会被回滚。确定恢复？';
}

function validateSuspendReason(text) {
  const value = String(text || '').trim();
  if (!value) {
    return { ok: false, error: '请填写停用原因（最多 100 字）。' };
  }
  if (value.length > C.SUSPEND_REASON_MAX) {
    return { ok: false, error: '停用原因最多 100 字。' };
  }
  return { ok: true, reason: value };
}

module.exports = {
  suspendConfirmContent,
  resumeConfirmContent,
  validateSuspendReason
};
