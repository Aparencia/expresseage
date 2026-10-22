// lib/id-generator.js · 云端唯一编号生成（唯一 crypto 随机 + 拒采样；唯一索引兜底重试）
// 规格单源 = shared/enums.js 的字母表/前缀/长度常量（CONTRACT §3.1 / DATA_MODEL §4）。
// 生成只用 crypto.randomBytes（不取 openid、不自增）；唯一索引是第二道闸，重试 ≤5 次后 DEPENDENCY_FAILED。
const crypto = require('crypto');
const enums = require('../shared/enums');
const { COLLECTIONS } = require('../db/collections');
const errors = require('./errors');
const time = require('./time');

const ALPHABET = enums.CODE_ALPHABET;
const CUSTOMER_NO_PREFIX = enums.CUSTOMER_NO_PREFIX;
const CUSTOMER_NO_BODY_LENGTH = enums.CUSTOMER_NO_BODY_LENGTH;
const PARTNER_NO_PREFIX = enums.PARTNER_NO_PREFIX;
const PARTNER_NO_BODY_LENGTH = enums.PARTNER_NO_BODY_LENGTH;
const INVITE_CODE_LENGTH = enums.INVITATION_CODE_LENGTH;
const TOKEN_LENGTH = enums.TOKEN_LENGTH;
const FAILURE_NO_BODY_LENGTH = 6;
const TEST_OPENID_PREFIX = 'TEST-';
const TEST_OPENID_RANDOM_LENGTH = 12;

const MAX_UNIQUE_ATTEMPTS = 5;
const MAX_ORDER_SEQ = 9999;

// crypto.randomBytes 逐字节拒采样：拒绝尾部余数区，保证 32 字母表上的均匀分布。
function randomFromAlphabet(length) {
  const size = ALPHABET.length;
  const limit = 256 - (256 % size);
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length - out.length + 4);
    for (let i = 0; i < bytes.length && out.length < length; i += 1) {
      if (bytes[i] < limit) {
        out += ALPHABET.charAt(bytes[i] % size);
      }
    }
  }
  return out;
}

function generateCustomerNo() {
  return CUSTOMER_NO_PREFIX + randomFromAlphabet(CUSTOMER_NO_BODY_LENGTH);
}

function generatePartnerNo() {
  return PARTNER_NO_PREFIX + randomFromAlphabet(PARTNER_NO_BODY_LENGTH);
}

function generateInviteCode() {
  return randomFromAlphabet(INVITE_CODE_LENGTH);
}

function generateFailureNo(nowMs) {
  return 'F-' + time.dayKey(nowMs) + '-' + randomFromAlphabet(FAILURE_NO_BODY_LENGTH);
}

function generateUploadTicket() {
  return randomFromAlphabet(TOKEN_LENGTH);
}

function generateViewTicket() {
  return randomFromAlphabet(TOKEN_LENGTH);
}

function generateRandomId(length) {
  const size = typeof length === 'number' && length > 0 ? Math.min(length, 64) : 24;
  return randomFromAlphabet(size);
}

function generateTestOpenid() {
  return TEST_OPENID_PREFIX + randomFromAlphabet(TEST_OPENID_RANDOM_LENGTH);
}

// 订单号：counters 事务内取当日全局序号（UTC+8，4 位零填充），同事务内可连取 N 个（一单多包裹/预留专用）。
async function nextOrderNos(trx, nowMs, count) {
  const total = typeof count === 'number' && count > 0 ? count : 1;
  const day = time.dayKey(nowMs);
  const key = 'orderNo:' + day;
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  let seq;
  if (!row) {
    seq = 1;
    // 首次取号一次预留 total 个（同事务连取 N 个）：计数器落 total，否则同日下一单从 2 开始撞已用 orderNo。
    await trx.add(COLLECTIONS.COUNTERS, { key, seq: total, updatedAt: nowMs });
  } else {
    const current = typeof row.seq === 'number' ? row.seq : 0;
    if (current + total > MAX_ORDER_SEQ) {
      throw errors.dependencyFailed('今日订单号已用完，请稍后重试');
    }
    seq = current + 1;
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq: current + total, updatedAt: nowMs });
  }
  if (seq + total - 1 > MAX_ORDER_SEQ) {
    throw errors.dependencyFailed('今日订单号已用完，请稍后重试');
  }
  const list = [];
  for (let i = 0; i < total; i += 1) {
    list.push(day + '-' + String(seq + i).padStart(4, '0'));
  }
  return list;
}

async function nextOrderNo(trx, nowMs) {
  const list = await nextOrderNos(trx, nowMs, 1);
  return list[0];
}

async function generateOrderNo(dao, nowMs) {
  return dao.transaction(async (trx) => nextOrderNo(trx, nowMs));
}

// 通用「生成编号 + 插入 + 唯一冲突重试」：唯一索引冲突 ≤5 次后 DEPENDENCY_FAILED。
async function insertUnique(dao, collection, options) {
  const opts = options || {};
  const field = opts.field;
  const generate = opts.generate;
  if (typeof generate !== 'function') {
    throw new Error('insertUnique 缺少生成函数');
  }
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt += 1) {
    const value = generate();
    const data = typeof opts.build === 'function'
      ? opts.build(value)
      : Object.assign({}, opts.build || {}, field ? { [field]: value } : {});
    try {
      const result = await dao.add(collection, data);
      return { _id: result._id, value };
    } catch (error) {
      if (!dao.isDuplicateError(error)) {
        throw error;
      }
    }
  }
  throw errors.dependencyFailed('编号生成失败，请稍后重试');
}

module.exports = {
  ALPHABET,
  MAX_UNIQUE_ATTEMPTS,
  MAX_ORDER_SEQ,
  randomFromAlphabet,
  generateCustomerNo,
  generatePartnerNo,
  generateInviteCode,
  generateFailureNo,
  generateUploadTicket,
  generateViewTicket,
  generateRandomId,
  generateTestOpenid,
  nextOrderNo,
  nextOrderNos,
  generateOrderNo,
  insertUnique
};
