// pages/profile/parts/avatar-save.js · 头像票据过期的保存自愈（纯件：零 wx；save/reupload 由页面注入）
// 口径：CONTRACT §4.2/§5.3、D19、D42、docs/governance/V4_TECH_DEBT.md TD-027（头像票据一次性：过期/已消费重放 → INVALID_STATE）、
//       V4_UX_CUSTOMER §4.10；批 10 A 批 P1-10；2026-10-28 D42 改判保底语义。
// 阶梯（不无限重试、不重复消费票据、不掩盖其它错误）：
//   ① 保存失败且错误指向头像上传凭证 → 重新 prepare+上传 1 次换新票后重试保存；
//   ② 换票或第二次保存仍失败 → 退化为「不改头像、其余资料照常保存」（去掉票据与本次新 fileId，
//      服务端保留已有 avatarFileId）并如实提示可稍后重选——**不得清空已有头像**（D42 口径变更）；
//   ③ 非凭证类错误（网络/维护/进行中订单等）原样抛出，不重试、不改写文案。
'use strict';

// 服务端票据失败文案都含「上传凭证」（handlers/upload/_common.js 的 loadAvatarTicket：
// INVALID_STATE「头像上传凭证已失效，请重新上传」/ NOT_FOUND「头像上传凭证不存在或已失效」/
// VALIDATION_FAILED「上传凭证用途不符 / 上传凭证路径异常」）；其它 INVALID_STATE（维护闸、进行中订单）不含。
const TICKET_CODES = ['INVALID_STATE', 'NOT_FOUND', 'VALIDATION_FAILED'];
const TICKET_MESSAGE_HINT = '上传凭证';

function isAvatarTicketFailure(error) {
  if (!error) {
    return false;
  }
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  return TICKET_CODES.indexOf(code) >= 0 && message.indexOf(TICKET_MESSAGE_HINT) >= 0;
}

// 换票后的保存入参：只替换头像票据/文件，其它已校验字段原样保留
function withUploadedAvatar(payload, uploaded) {
  const next = Object.assign({}, payload || {});
  const ticket = uploaded && typeof uploaded.avatarTicket === 'string' ? uploaded.avatarTicket : '';
  if (!ticket) {
    return next;
  }
  next.avatarTicket = ticket;
  next.avatarFileId = uploaded.avatarFileId || '';
  return next;
}

// 退化为「不改头像、其余资料照常保存」（D42）：去掉本次票据与本次新 fileId，
// 服务端 saveProfile 见「无票据 + 无 avatarFileId」= 不动头像（保留已有 avatarFileId），不清空。
function keepAvatar(payload) {
  const next = Object.assign({}, payload || {});
  delete next.avatarTicket;
  delete next.avatarFileId;
  return next;
}

// 保存结果 → 用户提示（失败说真话：换票失败原因原样带上，不谎报头像已更新）
function resultCopy(result) {
  const value = result || {};
  if (value.mode === 'refreshed') {
    return '资料已保存，头像已更新';
  }
  if (value.mode === 'kept') {
    const reason = typeof value.reason === 'string' ? value.reason : '';
    return '资料已保存；头像没换上' + (reason ? '（' + reason + '）' : '')
      + '，仍用原来的头像，可稍后在「编辑资料」重新选择头像';
  }
  return '资料已保存';
}

function fallbackKeepAvatar(options, reason) {
  return Promise.resolve().then(function saveWithoutAvatarChange() {
    return options.save(keepAvatar(options.payload));
  }).then(function kept(saved) {
    return { mode: 'kept', saved: saved, reason: (reason && reason.message) || '' };
  });
}

// 换票 1 次 → 重试保存；区分「换票失败」与「第二次保存失败」以决定如实抛错还是保底
function refreshTicketThenRetry(options) {
  let stage = 'reupload';
  return Promise.resolve().then(function reupload() {
    return options.reupload();
  }).then(function saveAgain(uploaded) {
    stage = 'save';
    return options.save(withUploadedAvatar(options.payload, uploaded));
  }).then(function saved(saved) {
    return { mode: 'refreshed', saved: saved };
  }).catch(function onRefreshError(error) {
    if (stage === 'save' && !isAvatarTicketFailure(error)) {
      return Promise.reject(error);
    }
    return fallbackKeepAvatar(options, error);
  });
}

function saveWithRecovery(options) {
  const opts = options || {};
  return Promise.resolve().then(function firstSave() {
    return opts.save(opts.payload);
  }).then(function saved(saved) {
    return { mode: 'normal', saved: saved };
  }).catch(function onFirstError(error) {
    if (!isAvatarTicketFailure(error) || typeof opts.reupload !== 'function') {
      return Promise.reject(error);
    }
    return refreshTicketThenRetry(opts);
  });
}

module.exports = {
  isAvatarTicketFailure,
  withUploadedAvatar,
  keepAvatar,
  resultCopy,
  saveWithRecovery
};
