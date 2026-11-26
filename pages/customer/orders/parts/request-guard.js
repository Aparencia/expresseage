// pages/customer/orders/parts/request-guard.js · 顾客订单列表请求代次判定（纯件，判据单源）
// 2026-11-26 审查修复（TD-100 同类）：onShow / 下拉 / 触底 / 切 tab 都会打同一个 order.listCustomer，
// 只有「最新代次 + 当前 tab」的响应能落地；旧包整包丢弃（不 setData、不清 loading、不上错误条）。
'use strict';

function isStaleRequest(current, taken) {
  if (!taken) {
    return true;
  }
  const now = current || {};
  return now.token !== taken.token || now.tab !== taken.tab;
}

module.exports = { isStaleRequest };
