// lib/tx.js · 事务写冲突的有界重试（并发绑定/换宿舍在真实云 DB 写冲突时不再直接 INTERNAL_ERROR）
// 口径：DATA_MODEL §7.4/§9（roomTag 必须在事务内分配）；只有"事务冲突"才重试，业务错误/唯一索引冲突语义不变。
'use strict';

// 冲突判定：errCode / errMsg / message / code 任一命中（真实云 DB 事务冲突码 -50200x、write conflict、
// transaction abort）。判定只看错误自述，不改变 dao.transaction 的提交/回滚行为。
const CONFLICT_RE = /transaction|tx.*(conflict|abort)|(conflict|abort).*transaction|write conflict|-50200\d/i;
// 唯一索引冲突（幂等重放/并发重复）不是事务冲突：不重试，交给调用方 isDuplicateError 分支（避免把
// 幂等读回延迟成 3 次回滚；fake DB 与云 DB 的 duplicate 错误 errMsg 均含 duplicate key error）。
const DUPLICATE_RE = /duplicate key|E11000/i;
const DEFAULT_ATTEMPTS = 3;

function isTransactionConflict(error) {
  if (!error) {
    return false;
  }
  const fields = [error.errCode, error.errMsg, error.message, error.code];
  const textOf = (field) => (field === undefined || field === null ? '' : String(field));
  if (fields.some((field) => DUPLICATE_RE.test(textOf(field)))) {
    return false;
  }
  return fields.some((field) => {
    if (textOf(field) === '') {
      return false;
    }
    return CONFLICT_RE.test(textOf(field));
  });
}

// dao.transaction(fn) 的有界重试：默认最多 3 次尝试，只重试事务冲突；非冲突错误/尝试耗尽原样上抛，
// 由调用方按原有分支处理（例如唯一索引冲突 → 幂等读回）。options.requestId 只进警告日志定位，
// 不落敏感值；options.maxAttempts（兼容 attempts）可覆盖默认次数。
async function retryOnConflict(dao, fn, options) {
  const opts = options || {};
  const maxAttempts = Math.max(1, Number(opts.maxAttempts || opts.attempts) || DEFAULT_ATTEMPTS);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await dao.transaction(fn);
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= maxAttempts) {
        throw error;
      }
      console.warn('[api] 事务冲突重试', opts.requestId || '');
    }
  }
}

module.exports = { isTransactionConflict, retryOnConflict };
