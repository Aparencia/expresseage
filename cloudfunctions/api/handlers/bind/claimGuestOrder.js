// handlers/bind/claimGuestOrder.js · bind.claimGuestOrder（P1 预留；MVP 不开放顾客认领）
// 口径：CONTRACT v0.9 §5.3（P1）、DATA_MODEL §7.4（MVP 返回 NOT_FOUND，不暴露内部状态）。
'use strict';

const { errors } = require('../../lib/errors');

async function handler() {
  throw errors.notFound('代客单认领暂未开放');
}

module.exports = { handler };
