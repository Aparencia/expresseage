// pkg-partner/pages/customer-detail/parts/unbind-flow.js · 解绑流程纯件（零 wx、零请求）
// 口径：docs/V4_UX_PARTNER.md §3.6（无进行中单才可解绑；原因必填 + 二次确认 + 成功通知顾客）
//      docs/V4_DATA_MODEL.md §7.4 partner.unbindCustomer：{bindingId,reason,note?}；
//      兼职侧释放原因恒为 PARTNER_INITIATED（顾客侧走另一入口，枚举见 §2.4）
//      docs/V4_UX_PARTNER.md §6.3：READONLY 下解绑置灰（点击只提示，不发请求）
'use strict';

const enums = require('../../../../shared/enums');

const REASON = 'PARTNER_INITIATED';
const NOTE_MAX = 100;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function noteText(raw) {
  return textOf(raw);
}

// 用户在弹窗里填的是"解绑原因说明"（落 releaseNote，≤100）；接口 reason 由端侧按固定枚举传，不给用户改
function validateNote(raw) {
  const note = noteText(raw);
  if (!note) {
    return { ok: false, note: '', message: '原因必填，写一句就好' };
  }
  if (note.length > NOTE_MAX) {
    return { ok: false, note: note, message: '说明不能超过 ' + NOTE_MAX + ' 字' };
  }
  return { ok: true, note: note, message: '' };
}

function reasonText() {
  return enums.RELEASE_REASON_TEXT[REASON] || '兼职解除绑定';
}

// 解绑资格：服务端 unbindEligibility.canUnbind 是唯一判据（按该顾客名下进行中单判定，§7.4）
function buildBlock(customer, eligibility, options) {
  const opts = options || {};
  const info = eligibility || {};
  const row = customer || {};
  const active = typeof info.activeOrderCount === 'number'
    ? info.activeOrderCount
    : (typeof row.activeOrderCount === 'number' ? row.activeOrderCount : 0);
  const readonly = opts.readonly === true;
  const canUnbind = info.canUnbind === true;
  let lockText = '';
  if (readonly) {
    lockText = '开发者只读视角不能操作';
  } else if (!canUnbind) {
    lockText = active > 0
      ? '还有 ' + active + ' 单未完成，完成后才能解绑'
      : '现在不能解绑，请刷新后再试';
  }
  return {
    visible: true,
    disabled: readonly || !canUnbind,
    readonly: readonly,
    activeOrderCount: active,
    lockText: lockText,
    buttonText: '解绑顾客',
    reasonText: reasonText()
  };
}

// 打开解绑弹窗：原因说明必填（≤100）
function firstDialog() {
  return {
    title: '填写解绑原因',
    editable: true,
    placeholderText: '原因（必填，≤' + NOTE_MAX + ' 字，会通知顾客）'
  };
}

// 二次确认（UX §3.6 固定文案）
function confirmDialog() {
  return {
    title: '确认解绑',
    content: '解绑后顾客需重新绑定才能下单，历史订单保留；双方将不再看到对方头像与昵称。',
    confirmText: '确认解绑',
    confirmColor: '#E54D42'
  };
}

// 提交体：bindingId + 固定枚举 reason + 用户填写的说明
function buildPayload(bindingId, rawNote) {
  const id = textOf(bindingId);
  const checked = validateNote(rawNote);
  if (!id) {
    return { ok: false, data: null, message: '没有找到这位顾客，请回客户列表重试' };
  }
  if (!checked.ok) {
    return { ok: false, data: null, message: checked.message };
  }
  return { ok: true, data: { bindingId: id, reason: REASON, note: checked.note }, message: '' };
}

function successText(isTestWrite) {
  return '已解绑，已通知顾客' + (isTestWrite ? '（测试数据）' : '');
}

function failureText(err) {
  return (err && err.message) || '解绑失败，请重试';
}

module.exports = {
  REASON,
  NOTE_MAX,
  buildBlock,
  buildPayload,
  confirmDialog,
  failureText,
  firstDialog,
  reasonText,
  successText,
  validateNote
};
