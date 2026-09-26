// utils/storage-core.js · 存储层**内核**（读盘 / 写盘 / 共享工具）
//
// ⚠️ 本文件是**全项目唯一**真正读写本地存储的地方（`loadStore` / `saveStore` 各一份实现）。
//    门禁 `tools/check.js` 第 6 条会机械拦"utils/ 之外直接调 wx.*Storage*"。
//    为什么 IO 全收在这一层：本地存储是"整键覆盖"且**无事务** —— 校验、失败回滚、错误码归一只能在一处做（DESIGN §3.1）。
//
// 为什么把内核单独拆出来（2026-09-25 卡 52 拆 TD-001 时定）：
//   实体模块（客户/快件）都要用 `loadStore`/`saveStore`，而 `storage.js` 又要 re-export 实体模块 ⇒
//   若内核留在 `storage.js` 里，就形成 `storage ⇄ storage-customers` 的**循环依赖**（项目已因循环依赖被期望值闸抓过一次）。
//   拆出内核后依赖是单向的：`storage-core` ← `storage-customers` / `storage-parcels` ← `storage`（门面 + 跨实体生命周期）。
//   ⛔ 由此产生的不变量：**任何模块都不许再写第二份读盘/写盘**（要 IO 就 require 本文件）。
//
// 字段规则不在本文件重复实现：一律交给 utils/migrate.js 的 validate()，避免"规则与样例分叉"。
'use strict';

const migrate = require('./migrate.js');

// 存储键（v2 起用独立命名空间，**一个字节都不读写 v1 的 `ex_college.store`**）。
// 为什么必须换键而不是沿用：v1 与 v2 是**同一个 appid** ⇒ 同一台手机上是**同一个 storage 命名空间**。
// 读写 v1 那个键等于删真实数据（AGENTS §9 红线，DESIGN §1 末的硬约束），所以两版永远分开、也永不互当迁移源。
const STORE_KEY = 'ex_college_v2.store';
// 「未归类」占位档案：id 与判据**只有 migrate 一份**（schema 层是事实源）⇒ 这里只转发，
// 让 data 层、页面、测试都从同一个地方取。⛔ 别在别处再写 'unassigned' 这个字面量。
const PLACEHOLDER_CUSTOMER_ID = migrate.PLACEHOLDER_CUSTOMER_ID;
const isPlaceholderCustomer = migrate.isPlaceholderCustomer;
const PLACEHOLDER_CUSTOMER_NAME = '未归类';

function okOf(extra) { return Object.assign({ ok: true }, extra || {}); }
function failOf(reason, detail) {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

// 存储数据都是纯 JSON，深拷贝一份再改：防止校验失败时已经把内存里的 store 改脏
function cloneStore(store) {
  return JSON.parse(JSON.stringify(store));
}

function newId(prefix, now) {
  return prefix + '_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// 删除批次标记：**必须是唯一字符串**。用 deletedAt 时间戳当标记会在"同一毫秒内发生两次不同删除"时撞车，
// 导致恢复档案时把单独删掉的记录一并复活（2026-09-15 被 tools/selftest.js 当场抓到）。
function newBatchId(now) {
  return newId('b', now);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function loadStore() {
  let raw;
  try {
    raw = wx.getStorageSync(STORE_KEY);
  } catch (err) {
    return failOf('STORE_CORRUPT', (err && (err.errMsg || err.message)) || String(err));
  }
  if (raw === '' || raw === null || raw === undefined) {
    // 首次运行：按 v1 结构建库（同一份 up() 也被迁移脚本使用）
    const created = migrate.up(null);
    if (!created.ok) return failOf(created.reason);
    const written = saveStore(created.state);
    if (!written.ok) return written;
    return okOf({ store: created.state });
  }
  // 版本升级（2026-09-17 #4 已取件）：更旧的库不是"损坏"而是"待升级"——先走同一份 migrate.up，
  // 落盘成功后再用。**失败不写盘**（宁可报错，也不要把半截状态写回去）
  if (raw.schemaVersion < migrate.SCHEMA_VERSION) {
    // ⚠️ 先校验**旧结构本身**：损坏的库不能当"待升级"处理，否则原因码会被包成 VALIDATION_FAILED，
    // 掩盖真正的 STORE_CORRUPT（2026-09-17 由自测"损坏库仍须报 STORE_CORRUPT"当场抓出）
    const incoming = migrate.validateBody(raw);
    if (!incoming.ok) return failOf(incoming.reason);
    const upgraded = migrate.up(raw);
    if (!upgraded.ok) return failOf(upgraded.reason);
    const saved = saveStore(upgraded.state);
    if (!saved.ok) return saved;
    return okOf({ store: upgraded.state });
  }
  const check = migrate.validate(raw);
  if (!check.ok) return failOf(check.reason);
  return okOf({ store: raw });
}

function saveStore(store) {
  const check = migrate.validate(store);
  if (!check.ok) return failOf('VALIDATION_FAILED', check.reason);
  try {
    wx.setStorageSync(STORE_KEY, store);
    return okOf();
  } catch (err) {
    const message = (err && (err.errMsg || err.message)) || String(err);
    // ⚠️ 超限报错文案没有稳定契约：这里按关键字判定（启发式）。真机复现出确切文案后收紧。
    if (message.toLowerCase().indexOf('exceed') >= 0) return failOf('QUOTA_EXCEEDED', message);
    return failOf('WRITE_FAILED', message);
  }
}

module.exports = {
  STORE_KEY,
  PLACEHOLDER_CUSTOMER_ID,
  PLACEHOLDER_CUSTOMER_NAME,
  isPlaceholderCustomer,
  okOf,
  failOf,
  cloneStore,
  newId,
  newBatchId,
  normalizeText,
  loadStore,
  saveStore
};
