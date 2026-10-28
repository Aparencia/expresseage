// utils/share/pending-invite.js · 会话级「待绑定邀请」内存（D38；纯件：零 wx、零本地存储）
// 目的：分享卡经 launch 落到 role 邀请卡（?bind=）；新用户资料不完整时先补齐资料，
//   保存成功后自动续跳绑定页（?auto=1）完成绑定，不再要求二次点「确认绑定」。
// 安全/边界：只接受合法兼职编号 canonical（P+6）；不落盘、不跨进程、不携带头像/昵称/订单；
//   TTL 30 分钟（短时有效：避免很久以后从无关入口自动绑定旧邀请）；take() 取后即清，clear() 可取消。
'use strict';

const ids = require('../ids');

const TTL_MS = 30 * 60 * 1000;

let entry = null; // { partnerNo, expiresAt } —— 进程内唯一一条，后一次邀请覆盖前一次

// 只认合法兼职编号（P+6）；错对象/格式错/开发者编号一律拒收（不拿脏值兜底）
function canonicalOf(raw) {
  const parsed = ids.parseNo(ids.normalizeInput(raw));
  return parsed.ok && parsed.kind === ids.NO_KIND.PARTNER ? parsed.canonical : '';
}

function clockOf(now) {
  return typeof now === 'number' && isFinite(now) ? now : Date.now();
}

function isAlive(time) {
  return !!entry && entry.expiresAt > time;
}

// 记录/刷新待绑定邀请：返回是否接受（非法编号不覆盖既有邀请）
function remember(rawPartnerNo, now) {
  const partnerNo = canonicalOf(rawPartnerNo);
  if (!partnerNo) {
    return false;
  }
  entry = { partnerNo: partnerNo, expiresAt: clockOf(now) + TTL_MS };
  return true;
}

// 只读查看（不消费）：过期即清空并返回空串
function peek(now) {
  const time = clockOf(now);
  if (!isAlive(time)) {
    entry = null;
    return '';
  }
  return entry.partnerNo;
}

// 消费一次（取后即清）：返回 canonical 编号或空串
function take(now) {
  const partnerNo = peek(now);
  entry = null;
  return partnerNo;
}

function clear() {
  entry = null;
}

module.exports = {
  TTL_MS,
  canonicalOf,
  remember,
  peek,
  take,
  clear
};
