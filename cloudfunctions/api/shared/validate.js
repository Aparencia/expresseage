// shared/validate.js · 字段校验纯件（编号/邀请码形态、宿舍身份、尾号、文本上限、取消原因）
// 契约：docs/V4_CONTRACT.md v0.9 §3/§3.1/§5.1/§5.2/§6；docs/V4_DATA_MODEL.md §6.5/§7；
//       docs/ENGINEERING §5.3（编号）、§5.3b（roomTag 由 utils/room-tag.js 校验）、§4.3（clientRequestId）。
// 返回约定：{ ok:true, ...归一后的值 } 或 { ok:false, reason, field }；reason 是内部原因码，
//           面向用户的文案在 shared/error-copy.js（校验层不拼人话，避免两份文案）。
// 调用方：云函数 validate 中间件、utils/ids.js、页面表单（资料/下单/留言/异常）。
'use strict';

const enums = require('./enums');
const zones = require('./zones');

// 文本上限（CONTRACT §5.2/§5.3 + DATA_MODEL §2；页面只提示不二次截断）
const TEXT_LIMITS = {
  note: 200,
  deliveryNote: 100,
  partnerNote: 100,
  msg: 200,
  exception: 200,
  lockerNo: 10,
  displayName: 20,
  releaseNote: 100,
  failureNote: 100
};

const PICKUP_CODE_MAX_RAW = 40;
const PICKUP_CODE_ALNUM_MIN = 4;
const PICKUP_CODE_ALNUM_MAX = 12;
const PICKUP_CODE_SEPARATOR = /[\s\-_#]/g;
const PICKUP_CODE_ALNUM = /^[0-9A-Za-z]+$/;
const LOCKER_TEXT_PATTERN = /^[0-9A-Za-z\u4e00-\u9fa5#-]+$/;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
const CONFIRM_TEXT_MAX = 8;

function fail(field, reason) {
  return { ok: false, reason: reason || 'FORMAT', field: field || '' };
}

function succeed(field, extra) {
  const result = { ok: true };
  if (field) {
    result.field = field;
  }
  if (extra) {
    Object.keys(extra).forEach((key) => {
      result[key] = extra[key];
    });
  }
  return result;
}

// 全角→半角（数字/字母/连字符等可见 ASCII），全角空格转半角空格
function toHalfWidth(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += text.charAt(i);
    }
  }
  return out;
}

// 编号归一：去首尾空白 → 全角转半角 → 去空白与连字符/下划线 → 大写
function canonicalCode(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return toHalfWidth(raw)
    .replace(/[\s\u00a0]/g, '')
    .replace(/[-_]/g, '')
    .toUpperCase();
}

function codeOf(raw, pattern) {
  const canonical = canonicalCode(raw);
  return { canonical, ok: canonical !== '' && pattern.test(canonical) };
}

function validateCustomerNo(raw) {
  const result = codeOf(raw, enums.CUSTOMER_NO_PATTERN);
  if (!result.ok) {
    return fail('customerNo');
  }
  return succeed('customerNo', { canonical: result.canonical });
}

function validatePartnerNo(raw) {
  const result = codeOf(raw, enums.PARTNER_NO_PATTERN);
  if (!result.ok) {
    return fail('partnerNo');
  }
  return succeed('partnerNo', { canonical: result.canonical });
}

function validateDeveloperNo(raw) {
  if (typeof raw !== 'string') {
    return fail('developerNo');
  }
  const text = toHalfWidth(raw).trim().replace(/\s+/g, '');
  if (!enums.DEVELOPER_NO_PATTERN.test(text)) {
    return fail('developerNo');
  }
  return succeed('developerNo', { canonical: text });
}

function validateInvitationCode(raw) {
  const result = codeOf(raw, enums.INVITATION_CODE_PATTERN);
  if (!result.ok) {
    return fail('invitationCode');
  }
  return succeed('invitationCode', { canonical: result.canonical });
}

// 房间级文本：去掉首尾空白后按"字符数"（码点）计，避免 emoji 被算成两个
function textLength(text) {
  return typeof text === 'string' ? Array.from(text).length : 0;
}

function validateText(value, max, field, required) {
  if (value === undefined || value === null || value === '') {
    return required ? fail(field, 'REQUIRED') : succeed(field, { value: '' });
  }
  if (typeof value !== 'string') {
    return fail(field, 'TYPE');
  }
  const text = value.trim();
  if (text === '' && required) {
    return fail(field, 'REQUIRED');
  }
  if (textLength(text) > max) {
    return fail(field, 'TOO_LONG');
  }
  return succeed(field, { value: text });
}

function validateNote(value) {
  return validateText(value, TEXT_LIMITS.note, 'note', false);
}

function validateDeliveryNote(value) {
  return validateText(value, TEXT_LIMITS.deliveryNote, 'deliveryNote', false);
}

function validatePartnerNote(value) {
  return validateText(value, TEXT_LIMITS.partnerNote, 'partnerNote', false);
}

function validateMessageText(value) {
  return validateText(value, TEXT_LIMITS.msg, 'text', true);
}

function validateExceptionText(value) {
  return validateText(value, TEXT_LIMITS.exception, 'text', false);
}

function validateLockerNo(value) {
  if (value === undefined || value === null || value === '') {
    return succeed('lockerNo', { value: '' });
  }
  if (typeof value !== 'string') {
    return fail('lockerNo', 'TYPE');
  }
  const text = value.trim();
  if (textLength(text) > TEXT_LIMITS.lockerNo) {
    return fail('lockerNo', 'TOO_LONG');
  }
  if (text !== '' && !LOCKER_TEXT_PATTERN.test(text)) {
    return fail('lockerNo');
  }
  return succeed('lockerNo', { value: text });
}

// 昵称：必填、≤20 字（超长按口径截断而非报错）、去首尾空白；内容安全由云端 msgSecCheck 接续
function validateDisplayName(value) {
  if (typeof value !== 'string') {
    return fail('displayName', 'TYPE');
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return fail('displayName', 'REQUIRED');
  }
  const chars = Array.from(trimmed);
  if (chars.length > TEXT_LIMITS.displayName) {
    return succeed('displayName', { value: chars.slice(0, TEXT_LIMITS.displayName).join(''), truncated: true });
  }
  return succeed('displayName', { value: trimmed, truncated: false });
}

function validateReleaseNote(value) {
  return validateText(value, TEXT_LIMITS.releaseNote, 'note', false);
}

function validateFailureNote(value) {
  return validateText(value, TEXT_LIMITS.failureNote, 'note', false);
}

// 手机尾号：'' 或恰好 4 位数字（永不收集完整手机号）
function validatePhoneTail(value) {
  if (value === undefined || value === null || value === '') {
    return succeed('phoneTail', { value: '' });
  }
  const text = toHalfWidth(String(value)).trim();
  if (!/^[0-9]{4}$/.test(text)) {
    return fail('phoneTail');
  }
  return succeed('phoneTail', { value: text });
}

// 宿舍身份：zone/buildingNo/room 三项联合校验，成功时回 dormKey 与 buildingText
function validateDormIdentity(input) {
  const source = input && typeof input === 'object' ? input : {};
  const zone = zones.normalizeZone(source.zone);
  if (!zone) {
    return fail('zone');
  }
  const buildingNo = typeof source.buildingNo === 'string' ? Number(source.buildingNo) : source.buildingNo;
  if (!zones.isBuildingNo(buildingNo)) {
    return fail('buildingNo', 'RANGE');
  }
  const room = zones.canonicalRoom(source.room);
  if (!room) {
    return fail('room', 'RANGE');
  }
  return succeed('dorm', {
    zone,
    buildingNo,
    room,
    buildingText: zones.buildingText(zone, buildingNo),
    dormKey: zones.dormKey(zone, buildingNo, room)
  });
}

// 取件码：允许空（NEED_CODE 待补）；非空时去空格/连字符后 4~12 位字母数字，原始输入 ≤40
function validatePickupCode(value) {
  if (value === undefined || value === null || value === '') {
    return succeed('pickupCode', { value: '', empty: true });
  }
  if (typeof value !== 'string') {
    return fail('pickupCode', 'TYPE');
  }
  const raw = value.trim();
  if (raw.length > PICKUP_CODE_MAX_RAW) {
    return fail('pickupCode', 'TOO_LONG');
  }
  const compact = raw.replace(PICKUP_CODE_SEPARATOR, '');
  if (!PICKUP_CODE_ALNUM.test(compact)) {
    return fail('pickupCode');
  }
  if (compact.length < PICKUP_CODE_ALNUM_MIN || compact.length > PICKUP_CODE_ALNUM_MAX) {
    return fail('pickupCode');
  }
  return succeed('pickupCode', { value: raw });
}

// 运单尾号：'' 或恰好 5 位数字
function validateTrackingTail(value) {
  if (value === undefined || value === null || value === '') {
    return succeed('trackingTail', { value: '' });
  }
  const text = toHalfWidth(String(value)).trim();
  if (!/^[0-9]{5}$/.test(text)) {
    return fail('trackingTail');
  }
  return succeed('trackingTail', { value: text });
}

// 取消原因：必须命中提交方对应枚举；OTHER 必填备注（CONTRACT §5.2）
function validateCancelReason(code, by) {
  const list = enums.CANCEL_REASONS[by];
  if (!list) {
    return fail('reason', 'NOT_ALLOWED');
  }
  const hit = list.filter((item) => item.code === code)[0];
  if (!hit) {
    return fail('reason', 'NOT_ALLOWED');
  }
  return succeed('reason', { value: hit.code });
}

function validateCancelNote(code, note) {
  const result = validateNote(note);
  if (!result.ok) {
    return result.field === 'note' ? fail('note', result.reason) : result;
  }
  if (code === enums.OTHER_REASON_CODE && result.value === '') {
    return fail('note', 'REQUIRED');
  }
  return succeed('note', { value: result.value });
}

// 解绑原因：命中 releaseReason 枚举；note ≤100 可选
function validateReleaseReason(code, note) {
  const hit = enums.RELEASE_REASONS.filter((item) => item.code === code)[0];
  if (!hit) {
    return fail('reason', 'NOT_ALLOWED');
  }
  const noteResult = validateReleaseNote(note);
  if (!noteResult.ok) {
    return noteResult;
  }
  return succeed('reason', { value: hit.code, note: noteResult.value });
}

// 异常上报：code 六值；OTHER 必填 text；text ≤200
function validateException(code, text) {
  const hit = enums.EXCEPTION_CODES.filter((item) => item.code === code)[0];
  if (!hit) {
    return fail('code', 'NOT_ALLOWED');
  }
  const textResult = validateExceptionText(text);
  if (!textResult.ok) {
    return textResult;
  }
  if (code === enums.EXCEPTION_OTHER_CODE && textResult.value === '') {
    return fail('text', 'REQUIRED');
  }
  return succeed('code', { value: hit.code, text: textResult.value });
}

// 写动作幂等键：16~32 位 [A-Za-z0-9_-]
function validateClientRequestId(value) {
  if (typeof value !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(value)) {
    return fail('clientRequestId');
  }
  return succeed('clientRequestId', { value });
}

// 乐观锁版本号：缺省允许；给了就必须是非负整数
function validateExpectedVersion(value) {
  if (value === undefined || value === null) {
    return succeed('expectedVersion', { value: null });
  }
  if (typeof value !== 'number' || Math.floor(value) !== value || value < 0) {
    return fail('expectedVersion', 'RANGE');
  }
  return succeed('expectedVersion', { value });
}

// 32 位不可猜票据（上传票据与切换会话票据同形，生成只在云端）
function validateToken(value, field) {
  const name = field || 'token';
  if (typeof value !== 'string' || !enums.TOKEN_PATTERN.test(value)) {
    return fail(name);
  }
  return succeed(name, { value });
}

// 二次确认文案（删除测试账号=「删除」、清空测试数据=「清空」）
function validateConfirmText(value, expected) {
  if (typeof value !== 'string') {
    return fail('confirmText', 'REQUIRED');
  }
  const text = value.trim();
  if (textLength(text) > CONFIRM_TEXT_MAX) {
    return fail('confirmText', 'TOO_LONG');
  }
  if (text !== expected) {
    return fail('confirmText', 'NOT_ALLOWED');
  }
  return succeed('confirmText', { value: text });
}

function validateViewMode(value) {
  if (enums.VIEW_MODE_LIST.indexOf(value) === -1) {
    return fail('mode', 'NOT_ALLOWED');
  }
  return succeed('mode', { value });
}

function validateRole(value) {
  if (enums.ROLE_LIST.indexOf(value) === -1) {
    return fail('role', 'NOT_ALLOWED');
  }
  return succeed('role', { value });
}

module.exports = {
  TEXT_LIMITS,
  PICKUP_CODE_MAX_RAW,
  toHalfWidth,
  canonicalCode,
  textLength,
  validateText,
  validateDisplayName,
  validateNote,
  validateDeliveryNote,
  validatePartnerNote,
  validateMessageText,
  validateExceptionText,
  validateLockerNo,
  validatePhoneTail,
  validateDormIdentity,
  validatePickupCode,
  validateTrackingTail,
  validateCustomerNo,
  validatePartnerNo,
  validateDeveloperNo,
  validateInvitationCode,
  validateCancelReason,
  validateCancelNote,
  validateReleaseReason,
  validateException,
  validateClientRequestId,
  validateExpectedVersion,
  validateToken,
  validateConfirmText,
  validateViewMode,
  validateRole
};
