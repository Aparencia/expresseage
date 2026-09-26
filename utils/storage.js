// utils/storage.js · 存储层**对外门面** + 跨实体的生命周期
//
// 2026-09-25 卡 52（拆 TD-001）后本文件不再自己读写存储，而是：
//   · `utils/storage-core.js`   —— 读盘 / 写盘**单源**（全项目唯一碰 wx.*Storage* 的地方）
//   · `utils/storage-customers.js` —— 档案（客户）的读写
//   · `utils/storage-parcels.js`   —— 快递记录（件）的读写
//   · 本文件 = **门面（re-export，导出面与拆分前逐名一致）** + **跨实体生命周期**
//
// 为什么生命周期留在这里：软删档案要连带它名下的件、恢复要按批次串认领、真删要保证不留悬空引用、
// 「未归类」重归要改件的归属 —— 这些操作**同时动 customers 与 parcels**，属"归属"语义，
// 放进任一侧都会让那一侧反向依赖另一侧（循环）。放在最上层（只依赖内核）方向才是单向的。
//
// ⛔ 两个不变量（拆分时立的，改动本层时逐条自检）：
//   ① **读盘/写盘只有一份**（在 `storage-core.js`）—— 本层不许出现 `wx.getStorageSync`/`setStorageSync`；
//   ② **导出面不许少一个名字**：全仓 `require('.../utils/storage.js')` 的调用方按这 30 个名字用
//      （`selftest` 的 656 条断言就是这个面的回归网）。
'use strict';

const core = require('./storage-core.js');
const customersApi = require('./storage-customers.js');
const parcelsApi = require('./storage-parcels.js');

const loadStore = core.loadStore;
const saveStore = core.saveStore;
const cloneStore = core.cloneStore;
const newBatchId = core.newBatchId;
const normalizeText = core.normalizeText;
const okOf = core.okOf;
const failOf = core.failOf;
const isPlaceholderCustomer = core.isPlaceholderCustomer;
const PLACEHOLDER_CUSTOMER_ID = core.PLACEHOLDER_CUSTOMER_ID;

/**
 * 把「未归类」名下的件**整批改挂**到某位真实客户（2026-09-25 用户裁决 A 的重归出口）。
 * 为什么函数名里写死来源（而不是 `reassignParcels(from,to)`）：本批要的只是**这一个**出口；
 * 通用「在两真人之间搬件」是另一个设计问题（谁该被搬、搬完谁负责），不在本批范围里，别顺手开出来。
 * ⛔ 方向不能反：目标是占位档案 ⇒ `PLACEHOLDER_TARGET`（那正好是它的反面用法）。
 * 深防：`saveStore` 每次全库校验 ⇒ 万一搬出悬空引用，写盘直接失败（什么都不发生）。
 * @param {string} toId 目标客户 id（必须存在且未软删）
 * @returns {{ok:boolean, moved?:number, reason?:string, detail?:string}} 没得搬 ⇒ `moved:0`（不写盘）
 */
function reassignUnassigned(toId) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const to = normalizeText(toId);
  if (!to) return failOf('VALIDATION_FAILED', 'CUSTOMER_INVALID:id');
  const target = loaded.store.customers.filter((item) => item.id === to && !item.deletedAt)[0];
  if (!target) return failOf('CUSTOMER_NOT_FOUND');
  if (isPlaceholderCustomer(target)) return failOf('PLACEHOLDER_TARGET');
  const now = Date.now();
  const next = cloneStore(loaded.store);
  let moved = 0;
  for (const parcel of next.parcels) {
    if (parcel.customerId !== PLACEHOLDER_CUSTOMER_ID || parcel.deletedAt) continue;
    parcel.customerId = to;
    parcel.updatedAt = now;
    moved++;
  }
  if (moved === 0) return okOf({ moved: 0 });   // 没得搬 ⇒ 不做无意义的整库写
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ moved });
}

// 软删除档案（M8）：只打标记，不物理删；名下"还活着"的记录打上**同一个批次串**，
// 恢复时按批次串认领——单独删过的记录不会因此被复活（DESIGN §5）
function softDeleteCustomer(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = loaded.store.customers.map((item) => item.id).indexOf(id);
  if (index < 0 || loaded.store.customers[index].deletedAt) return failOf('NOT_FOUND');
  // 「未归类」占位档案不可改名/换绑/软删/真删（依据见 migrate.js 顶部）：
  // 它一旦消失，名下快件立刻悬空 ⇒ 全库校验失败 ⇒ 连读盘都读不出来。
  if (isPlaceholderCustomer(loaded.store.customers[index])) return failOf('PLACEHOLDER_PROTECTED');

  const now = Date.now();
  const batch = newBatchId(now);
  const next = cloneStore(loaded.store);
  next.customers[index].deletedAt = now;
  next.customers[index].deleteBatch = batch;
  next.customers[index].updatedAt = now;
  let deletedParcels = 0;
  for (const parcel of next.parcels) {
    if (parcel.customerId === id && !parcel.deletedAt) {
      parcel.deletedAt = now;
      parcel.deleteBatch = batch;
      parcel.updatedAt = now;
      deletedParcels++;
    }
  }
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ deletedParcels });
}

function restoreCustomer(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const found = loaded.store.customers.filter((item) => item.id === id && item.deletedAt)[0];
  if (!found) return failOf('NOT_FOUND');

  const mark = found.deleteBatch || null; // 认领标记：只复活与档案同批被删的记录
  const now = Date.now();
  const next = cloneStore(loaded.store);
  const customer = next.customers.filter((item) => item.id === id)[0];
  customer.deletedAt = null;
  customer.deleteBatch = null;
  customer.updatedAt = now;
  let restoredParcels = 0;
  for (const parcel of next.parcels) {
    // 有批次标记就精确匹配；旧数据（标记上线前删的）退回按删除时间匹配
    const sameBatch = mark ? parcel.deleteBatch === mark : parcel.deletedAt === found.deletedAt;
    if (parcel.customerId === id && parcel.deletedAt && sameBatch) {
      parcel.deletedAt = null;
      parcel.deleteBatch = null;
      parcel.updatedAt = now;
      restoredParcels++;
    }
  }
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ restoredParcels });
}

// 彻底删除（回收站的**第二步**，用户裁决④）：只对**已软删**档案生效 —— 真删不可逆，先软删才是默认路径。
// ⛔ 为什么必须连带删掉该档案名下**全部**快件（不是只删同批次串）：`migrate.validate` 的归属判据是
//    "每条快件的 customerId 必须指向存在的档案"（软删档案也算存在）⇒ 留下任何一条悬空引用，
//    整库 `validate` 就失败 ⇒ **连读盘都读不出来**（不是"少一条记录"，而是"应用不可用"）。
//    `restoreCustomer` 的批次串语义解决的是"恢复时不要连坐"，与"删除时不能留悬空"是两件事，两个方向口径本就不同。
// 纵深防御：`saveStore` 会对整库跑一次 `validate` ⇒ 这段逻辑万一被改坏，写盘会直接失败（什么都不发生）。
function purgeCustomer(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const target = normalizeText(id);
  const customer = loaded.store.customers.filter((item) => item.id === target)[0];
  if (!customer) return failOf('NOT_FOUND');
  // 占位档案连"先软删"这一步都走不到（软删口已拒），这里再钉一次：它的合法性判据是**存在**
  if (isPlaceholderCustomer(customer)) return failOf('PLACEHOLDER_PROTECTED');
  if (!customer.deletedAt) return failOf('PURGE_REQUIRES_SOFT_DELETE');

  const next = cloneStore(loaded.store);
  let purgedParcels = 0;
  next.parcels = next.parcels.filter((parcel) => {
    if (parcel.customerId !== target) return true;
    purgedParcels++;
    return false;
  });
  next.customers = next.customers.filter((item) => item.id !== target);
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ purgedParcels });
}

/**
 * 回收站「全部彻底删除」：把所有**已软删**的档案，连同各自名下**全部**快件一起真删。
 *
 * ⚠️ 为什么是"名下全部"而不是"同 `deleteBatch` 串"（与 `restoreCustomer` 的口径**刻意不同**）：
 *   `migrate.validate` 对每条快件查 `knownCustomerIds[item.customerId]`，缺了就返回
 *   `PARCEL_CUSTOMER_MISSING`；而**软删档案仍算存在** ⇒ 只删同批会留下悬空引用 ⇒ 整库校验失败
 *   ⇒ 连读盘都读不出来（不是"少一条记录"，是"应用不可用"）。所以真删这条路上快件必须跟着走干净。
 *   （恢复那条路要的是"别连坐"，两条路的方向本来就不同。）
 *
 * 红线（AGENTS §4）：本函数只提供"库内真删"这个能力，**动作永远由用户在回收站里点两下按钮触发**；
 * agent 不执行任何删除。
 * @returns {{ok:true, purgedCustomers:number, purgedParcels:number}|{ok:false, reason:string}}
 */
function purgeAllDeleted() {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const victims = loaded.store.customers.filter((item) => item && item.deletedAt);
  if (victims.length === 0) return okOf({ purgedCustomers: 0, purgedParcels: 0 });
  const hit = {};
  for (const item of victims) hit[item.id] = true;
  const next = cloneStore(loaded.store);
  let purgedParcels = 0;
  next.parcels = next.parcels.filter((parcel) => {
    if (!hit[parcel.customerId]) return true;
    purgedParcels++;
    return false;
  });
  next.customers = next.customers.filter((item) => !hit[item.id]);
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ purgedCustomers: victims.length, purgedParcels: purgedParcels });
}

// 导出面 = **拆分前逐名一致**（30 个）。⚠️ 刻意逐个列出、不用展开运算符：
// 这样"门面多出内部工具"或"漏掉一个名字"在 diff 里一眼可见（拆分时的核心验收就是这条）。
module.exports = {
  STORE_KEY: core.STORE_KEY,
  loadStore: core.loadStore,
  saveStore: core.saveStore,
  listCustomers: customersApi.listCustomers,
  getCustomer: customersApi.getCustomer,
  findCustomerByChatKey: customersApi.findCustomerByChatKey, // pick_friend 批 2：建档前的查重口（同一条会话第二次选择要落回同一条档案）
  rebindCustomerChatKey: customersApi.rebindCustomerChatKey, // pick_friend 批 3：换绑口（平台换了会话 id 之后把客户重新认回来）
  createCustomer: customersApi.createCustomer,
  updateCustomer: customersApi.updateCustomer,
  softDeleteCustomer,
  restoreCustomer,
  purgeCustomer, // 2026-09-25 详情页/回收站批：回收站的第二步（只对已软删档案生效；真删档案 + 其名下全部快件）
  purgeAllDeleted, // 2026-09-25 真机反馈批：回收站「全部彻底删除」（所有已软删档案 + 各自名下全部快件）
  ensureUnassigned: customersApi.ensureUnassigned,      // 2026-09-25「未归类」批：占位档案**惰性创建**（第一次真的需要时才建）
  reassignUnassigned,    // 2026-09-25「未归类」批：把占位档案名下的件整批改挂到某位真实客户
  PLACEHOLDER_CUSTOMER_ID: core.PLACEHOLDER_CUSTOMER_ID,
  PLACEHOLDER_CUSTOMER_NAME: core.PLACEHOLDER_CUSTOMER_NAME,
  isPlaceholderCustomer: core.isPlaceholderCustomer,
  listParcels: parcelsApi.listParcels,
  addParcel: parcelsApi.addParcel,
  addParcels: parcelsApi.addParcels, // 2026-09-19 一图多码（M4）：一张图 N 件的"一键全存"，一次整键写、要么全成要么一条都不建
  updateParcel: parcelsApi.updateParcel,
  setParcelStatus: parcelsApi.setParcelStatus,
  setParcelPicked: parcelsApi.setParcelPicked, // #4 已取件（2026-09-17）：写/清 pickedAt；状态枚举保持两态
  setParcelsStatus: parcelsApi.setParcelsStatus, // 2026-09-19 修复批（24 审查 R-04）：整站取完的批量入口，一次整键写
  setParcelsPicked: parcelsApi.setParcelsPicked, // 2026-09-21 顺手化改造：清单页「本站全拿完」的批量入口（改 pickedAt，不是 status）
  softDeleteParcel: parcelsApi.softDeleteParcel,
  restoreParcel: parcelsApi.restoreParcel,
  archiveDoneParcels: parcelsApi.archiveDoneParcels,
  unarchiveParcel: parcelsApi.unarchiveParcel
};
