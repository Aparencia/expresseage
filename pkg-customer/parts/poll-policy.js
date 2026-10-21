// pkg-customer/parts/poll-policy.js · 订单详情轮询策略（纯件，零 wx、零定时器、零随机）
// 口径：docs/V4_UX_CUSTOMER.md §8.1 / CONTRACT §9 / AC-C-29 / QA E17
//   页面可见 10s 一轮；失败退避 20s→40s（封顶 40s）；成功回 10s；onHide/onUnload stop 后不再排程。
// 调用方：pkg-customer/pages/order-detail/index.js（定时器在页面，策略状态在这里，页面层零数字判据）。
'use strict';

const BASE_MS = 10000;
const BACKOFF_MS = [20000, 40000];
const MAX_BACKOFF_MS = BACKOFF_MS[BACKOFF_MS.length - 1];

/** 空闲初始态（未 start 前不排程） */
function create() {
  return { running: false, failures: 0 };
}

/** 页面可见：开始轮询，失败计数归零（首次固定 10s） */
function start(state) {
  const current = state || create();
  return { running: true, failures: 0, lastDelayMs: BASE_MS, lastDelayWasBase: true, previousRunning: current.running === true };
}

/** 页面隐藏/卸载：停止轮询；之后 onSuccess/onFailure 都不得再排程 */
function stop() {
  return { running: false, failures: 0, lastDelayMs: 0, lastDelayWasBase: false };
}

/** 本轮成功后：失败计数清零，回到 10s 基线 */
function onSuccess(state) {
  const current = state || create();
  const running = current.running === true;
  return {
    running: running,
    failures: 0,
    lastDelayMs: running ? BASE_MS : 0,
    lastDelayWasBase: true
  };
}

/** 本轮失败后：连续失败 1 次→20s，2 次→40s，≥3 次仍 40s（封顶，不无限放大） */
function onFailure(state) {
  const current = state || create();
  const failures = (Number(current.failures) || 0) + 1;
  const running = current.running === true;
  const index = Math.min(failures - 1, BACKOFF_MS.length - 1);
  return {
    running: running,
    failures: failures,
    lastDelayMs: running ? BACKOFF_MS[index] : 0,
    lastDelayWasBase: false
  };
}

/** 下一次排程间隔（ms）：未运行 → 0（页面据此不排程） */
function delayOf(state) {
  const current = state || {};
  if (current.running !== true) return 0;
  if (!current.failures) return BASE_MS;
  return BACKOFF_MS[Math.min(current.failures - 1, BACKOFF_MS.length - 1)];
}

/** 是否还应排程下一轮（stop 后恒为 false） */
function shouldPoll(state) {
  return delayOf(state) > 0;
}

module.exports = {
  BASE_MS,
  BACKOFF_MS,
  MAX_BACKOFF_MS,
  create,
  start,
  stop,
  onSuccess,
  onFailure,
  delayOf,
  shouldPoll
};
