'use strict';
/**
 * tools/lib/ai-assert-helpers.js · selftest-ai 的纯断言助手（拆出以满足 #18 单文件 ≤1000 行）。
 * 只做取数/键集合，不含断言与业务逻辑。
 */

function failuresOf(db) {
  return db.dump('recognition_failures');
}

function lastFailure(db) {
  return failuresOf(db).slice(-1)[0] || {};
}

function buildDegradedKeys(dto) {
  return Object.keys(dto).sort().join(',');
}

module.exports = { failuresOf, lastFailure, buildDegradedKeys };
