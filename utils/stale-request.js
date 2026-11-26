// utils/stale-request.js · 请求代次判定（纯件，多页共用；单源）
// 场景：同一页面多个入口（onShow / 下拉 / 触底 / 切 tab / 搜索防抖）会并发打同一个列表接口，
// 只有「最新一次请求」的响应能落地；旧包整包丢弃（不 setData、不清 loading、不写错误条）。
// 约定：taken = { token, tab? }；current = { token, tab? }。taken.tab 存在时同时比对 tab（跨 tab 不落地）。
'use strict';

function isStaleRequest(current, taken) {
  if (!taken) {
    return true;
  }
  const now = current || {};
  if (now.token !== taken.token) {
    return true;
  }
  if (taken.tab !== undefined && now.tab !== taken.tab) {
    return true;
  }
  return false;
}

module.exports = { isStaleRequest };
