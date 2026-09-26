// utils/storage-parcels.js · 快递记录（件）的读写
// 拆自 `utils/storage.js`（2026-09-25 卡 52 拆 TD-001）；**行为逐字未变**，只是换了落点。
// 依赖方向：本文件 → `storage-core.js`（读盘/写盘单源）。⛔ 不许在这里再写一份 load/save。
// 跨实体的生命周期（软删档案连带它的件、恢复、真删、重归）在 `utils/storage.js`。
// ── 快递记录（M3/M7；识别接入在批 5，本批只支持手工录入 source='manual'）──
'use strict';

const core = require('./storage-core.js');

const loadStore = core.loadStore;
const saveStore = core.saveStore;
const cloneStore = core.cloneStore;
const newId = core.newId;
const normalizeText = core.normalizeText;
const okOf = core.okOf;
const failOf = core.failOf;

function findParcelIndex(store, id) {
  return store.parcels.map((item) => item.id).indexOf(id);
}

function listParcels(options) {
  const filter = options || {};
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const parcels = loaded.store.parcels.filter((parcel) => {
    if (filter.customerId && parcel.customerId !== filter.customerId) return false;
    if (!filter.includeDeleted && parcel.deletedAt) return false;
    return true;
  });
  return okOf({ parcels, store: loaded.store });
}

// 记录字段构造**只有这一份**：单条（addParcel）与批量（addParcels）共用。
// 为什么必须共用：加字段时"两处一起改"是靠记性的约定，而约定会被忘（#4 加 pickedAt 时校验要求字段必须存在，
// 漏一处 = 整条落不了库）。共用后新增字段只改这里。id 用 newId（时间戳 + 随机段）→ 同毫秒建多条不撞。
function buildParcel(draft, now) {
  return {
    id: newId('p', now), customerId: draft.customerId,
    stationName: draft.stationName, pickupCode: draft.pickupCode,
    // 柜号（v3 新增，2026-09-19）：**空串 = 未知**是合法值 → 由 `migrate.validate` 单独校验（≤10 字），
    // 不能进非空字段表；这里只保证类型是字符串（缺省 → 空串）
    lockerNo: typeof draft.lockerNo === 'string' ? draft.lockerNo : '',
    // 运单后 5 位（v4 新增，2026-09-21）：**空串 = 不适用**（绝大多数件有取件码就直接取）是合法值；
    // 非空时 migrate.validate 会卡死"恰好 5 位数字"（位数不对就查不出取件码，等于存了个假线索）。
    // 「待查」状态**不落冗余字段**——由本字段是否非空派生（见 utils/parse.js 的 isNeedsLookup）
    trackingTail: typeof draft.trackingTail === 'string' ? draft.trackingTail : '',
    status: 'todo', source: draft.source === 'ocr' ? 'ocr' : 'manual',
    createdAt: now, updatedAt: now,
    doneAt: null, pickedAt: null, archivedAt: null, deletedAt: null, deleteBatch: null
  };
}

function addParcel(input) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const source = input || {};
  const customerId = normalizeText(source.customerId);
  // 归属校验放在这里（不是页面）：档案不存在或被删 → 直接拒绝，绝不产生孤儿记录
  const owner = loaded.store.customers.filter((item) => item.id === customerId && !item.deletedAt)[0];
  if (!owner) return failOf('CUSTOMER_NOT_FOUND');

  const now = Date.now();
  const parcel = buildParcel({
    customerId: customerId,
    stationName: normalizeText(source.stationName),
    pickupCode: normalizeText(source.pickupCode),
    lockerNo: normalizeText(source.lockerNo),
    trackingTail: normalizeText(source.trackingTail),
    source: source.source
  }, now);
  const next = cloneStore(loaded.store);
  next.parcels.push(parcel);
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel });
}

// 批量新建（2026-09-19 一图多码"一键全存"）：一次全库读 → 内存建 N 条 → **一次整键写**。
// 为什么要有批量入口：一张图 4 件，逐条调 addParcel 是 4 次全库读 + 4 次整键写，中途失败会留"存了一半"——
// 而页面 toast 承诺的是"已存 4 条"，用户据此不会再核对（与 setParcelsStatus 同一取舍）。
/**
 * 批量新建快递（**要么全成、要么一条都不建**）
 * @param {Array<{customerId:string, stationName:string, pickupCode:string, lockerNo?:string, trackingTail?:string, source?:'ocr'|'manual'}>} list
 * @returns {{ok:boolean,parcels?:object[],created?:number,reason?:string,detail?:string}}
 *   空数组/非数组 → `VALIDATION_FAILED`；**任一**归属档案不存在或已软删除 → `CUSTOMER_NOT_FOUND`
 *   且**一条都不写**（禁止半完成态）；写盘失败原样上抛 `WRITE_FAILED` / `QUOTA_EXCEEDED`
 */
function addParcels(list) {
  if (!Array.isArray(list) || list.length === 0) return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:list');
  const loaded = loadStore();
  if (!loaded.ok) return loaded;

  // 先整体预校验（归属）再决定写不写盘 —— 与 addParcel 同口径：绝不产生孤儿记录
  const alive = {};
  for (const customer of loaded.store.customers) {
    if (!customer.deletedAt) alive[customer.id] = true;
  }
  const drafts = [];
  for (const item of list) {
    const source = item || {};
    const customerId = normalizeText(source.customerId);
    if (!alive[customerId]) return failOf('CUSTOMER_NOT_FOUND');
    drafts.push({
      customerId: customerId,
      stationName: normalizeText(source.stationName),
      pickupCode: normalizeText(source.pickupCode),
      lockerNo: normalizeText(source.lockerNo),
      trackingTail: normalizeText(source.trackingTail),
      source: source.source
    });
  }

  const now = Date.now();
  const next = cloneStore(loaded.store);
  const parcels = drafts.map((draft) => {
    const parcel = buildParcel(draft, now);
    next.parcels.push(parcel);
    return parcel;
  });
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcels: parcels, created: parcels.length });
}

function updateParcel(id, patch) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || loaded.store.parcels[index].deletedAt) return failOf('NOT_FOUND');

  const source = patch || {};
  const next = cloneStore(loaded.store);
  const parcel = next.parcels[index];
  if (source.stationName !== undefined) parcel.stationName = normalizeText(source.stationName);
  if (source.pickupCode !== undefined) parcel.pickupCode = normalizeText(source.pickupCode);
  // 柜号可改（用户 2026-09-19 裁决：档案详情也能填/改）；空串合法，长度由 migrate.validate 兜底（<=10）
  if (source.lockerNo !== undefined) parcel.lockerNo = normalizeText(source.lockerNo);
  // 运单后 5 位（v4，2026-09-21）：可改/可清空（空串 = 不适用）；非空时的"恰好 5 位数字"由 migrate.validate 兜底。
  // 为什么清空也走这里：用户查到真取件码后要能把尾号去掉（否则清单上会一直显示"需查明"）
  if (source.trackingTail !== undefined) parcel.trackingTail = normalizeText(source.trackingTail);
  parcel.updatedAt = Date.now();
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel });
}

function setParcelStatus(id, status) {
  if (status !== 'todo' && status !== 'done') return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:status');
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || loaded.store.parcels[index].deletedAt) return failOf('NOT_FOUND');

  const now = Date.now();
  const next = cloneStore(loaded.store);
  const parcel = next.parcels[index];
  parcel.status = status;
  parcel.doneAt = status === 'done' ? now : null; // 回退到待办时清掉完成时间（S4：状态可回退）
  parcel.updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel });
}

// 已取件（#4 两段式；2026-09-17）：picked=true 记时间戳，false 清空（可退回）。
// **不强制顺序**（用户裁决）：没点已取件也能直接 setParcelStatus('done')；已送达后仍可点已取件（不报错）。
// 为什么不复用 setParcelStatus：状态枚举刻意保持两态（SCOPE W1），"已取件"是待办内的一个时间戳子态
function setParcelPicked(id, picked) {
  if (picked !== true && picked !== false) return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:picked');
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || loaded.store.parcels[index].deletedAt) return failOf('NOT_FOUND');

  const now = Date.now();
  const next = cloneStore(loaded.store);
  const parcel = next.parcels[index];
  parcel.pickedAt = picked ? now : null;
  parcel.updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel });
}

// 批量改状态（2026-09-19 修复批 · 24 审查 R-04）：一次全库读 → 内存改 N 条 → **一次整键写**。
// 为什么要批量入口（推翻站点库原取舍"不新增批量 API"）：逐条调 setParcelStatus 是 N 次全库读 + N 次整键写，
// 中途失败会留"改了一半"的半完成态，而确认框向用户承诺的是"该站 N 条将标为已送达"。
// 语义仍是"改状态"，且仍只有本文件碰存储：**要么全部改成功、要么一条都不改**（卡 §②维度 2 禁半完成状态）。
// 决策与被否方案：docs/decisions/DECISION_2026-09-19_整站取完批量写.md
/**
 * 批量改状态（**一次整键写**：要么全部改成功、要么一条都不改）
 * @param {string[]} ids 目标记录 id；**重复 id 只算一次**（否则 changed 会虚高）；空数组 → `VALIDATION_FAILED`
 * @param {'todo'|'done'} status 目标状态
 * @returns {{ok:boolean,changed?:number,reason?:string,detail?:string,missing?:string[]}}
 *   `missing` 只在"有 id 找不到或已软删除"时出现——此时**一条都不写**（禁止半完成态）；
 *   写盘失败原样上抛 saveStore 的失败码（`WRITE_FAILED` / `QUOTA_EXCEEDED`）
 */
function setParcelsStatus(ids, status) {
  if (status !== 'todo' && status !== 'done') return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:status');
  if (!Array.isArray(ids) || ids.length === 0) return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:ids');
  const loaded = loadStore();
  if (!loaded.ok) return loaded;

  // 先整体预校验再决定写不写盘：任一 id 找不到/已删除 → 整体不写（半完成态是旧实现的病根）
  const indexes = [];
  const missing = [];
  for (const id of ids) {
    const index = findParcelIndex(loaded.store, id);
    if (index < 0 || loaded.store.parcels[index].deletedAt) missing.push(id);
    // 去重（2026-09-19 R2-P3-01）：同一 id 传两次时 findParcelIndex 返回同一 index，
    // 不去重会让 changed 虚高（数据没错、计数错），而 changed 是给用户看的"已取完 N 条"
    else if (indexes.indexOf(index) < 0) indexes.push(index);
  }
  if (missing.length > 0) {
    // 把"哪几条"带回页面：用户要知道是哪些条没改成，而不是只看到一个数字
    const failure = failOf('NOT_FOUND', 'PARCEL_BATCH_MISSING');
    failure.missing = missing;
    return failure;
  }

  const now = Date.now();
  const next = cloneStore(loaded.store);
  for (const index of indexes) {
    const parcel = next.parcels[index];
    parcel.status = status;
    parcel.doneAt = status === 'done' ? now : null; // 与单条接口同语义：回退到待办时清完成时间
    parcel.updatedAt = now;
  }
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ changed: indexes.length });
}

/**
 * 批量标记已取件（2026-09-21 顺手化改造）：清单页「本站全拿完」用它——一趟下来先把该站全部**拿到手**。
 * 与 `setParcelsStatus` 同构（同一份防半完成态取舍，决策见
 * docs/decisions/DECISION_2026-09-19_整站取完批量写.md），差别只在改的是 `pickedAt` 而不是 `status`。
 * 为什么不复用 setParcelsStatus('done')：那会**跳过"已取件"这一步**（用户 2026-09-21 裁决：勾选=已取到这件，
 * 与"已送达"是两段式），两个语义混在一个入口里，日后必然有人按错。
 * @param {string[]} ids 目标记录 id；重复 id 只算一次；空数组 → `VALIDATION_FAILED`
 * @param {boolean} picked true = 记取件时间戳，false = 清空（退回未取件）
 * @returns {{ok:boolean,changed?:number,reason?:string,detail?:string,missing?:string[]}}
 *   `missing` 只在"有 id 找不到或已软删除"时出现——此时**一条都不写**
 */
function setParcelsPicked(ids, picked) {
  if (picked !== true && picked !== false) return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:picked');
  if (!Array.isArray(ids) || ids.length === 0) return failOf('VALIDATION_FAILED', 'PARCEL_INVALID:ids');
  const loaded = loadStore();
  if (!loaded.ok) return loaded;

  const indexes = [];
  const missing = [];
  for (const id of ids) {
    const index = findParcelIndex(loaded.store, id);
    if (index < 0 || loaded.store.parcels[index].deletedAt) missing.push(id);
    else if (indexes.indexOf(index) < 0) indexes.push(index);
  }
  if (missing.length > 0) {
    const failure = failOf('NOT_FOUND', 'PARCEL_BATCH_MISSING');
    failure.missing = missing;
    return failure;
  }

  const now = Date.now();
  const next = cloneStore(loaded.store);
  for (const index of indexes) {
    const parcel = next.parcels[index];
    parcel.pickedAt = picked ? now : null;
    parcel.updatedAt = now;
  }
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ changed: indexes.length });
}

function softDeleteParcel(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || loaded.store.parcels[index].deletedAt) return failOf('NOT_FOUND');

  const now = Date.now();
  const next = cloneStore(loaded.store);
  next.parcels[index].deletedAt = now;
  next.parcels[index].deleteBatch = null; // 单条删除不属于任何批次
  next.parcels[index].updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel: next.parcels[index] });
}

function restoreParcel(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || !loaded.store.parcels[index].deletedAt) return failOf('NOT_FOUND');

  const now = Date.now();
  const next = cloneStore(loaded.store);
  next.parcels[index].deletedAt = null;
  next.parcels[index].deleteBatch = null;
  next.parcels[index].updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel: next.parcels[index] });
}

// 软归档（M9）：把已完成且未删除、未归档的记录打上 archivedAt。**不物理删除**（Won't W5）。
function archiveDoneParcels() {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const now = Date.now();
  const next = cloneStore(loaded.store);
  let archived = 0;
  for (const parcel of next.parcels) {
    if (parcel.status === 'done' && !parcel.deletedAt && !parcel.archivedAt) {
      parcel.archivedAt = now;
      parcel.updatedAt = now;
      archived++;
    }
  }
  if (archived === 0) return okOf({ archived: 0 }); // 无事可做就不写盘（少一次整键覆盖）
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ archived });
}

function unarchiveParcel(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = findParcelIndex(loaded.store, id);
  if (index < 0 || !loaded.store.parcels[index].archivedAt) return failOf('NOT_FOUND');

  const now = Date.now();
  const next = cloneStore(loaded.store);
  next.parcels[index].archivedAt = null;
  next.parcels[index].updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ parcel: next.parcels[index] });
}

module.exports = {
  listParcels,
  addParcel,
  addParcels, // 2026-09-19 一图多码（M4）：一张图 N 件的"一键全存"，一次整键写、要么全成要么一条都不建
  updateParcel,
  setParcelStatus,
  setParcelPicked, // #4 已取件（2026-09-17）：写/清 pickedAt；状态枚举保持两态
  setParcelsStatus, // 2026-09-19 修复批（24 审查 R-04）：整站取完的批量入口，一次整键写
  setParcelsPicked, // 2026-09-21 顺手化改造：清单页「本站全拿完」的批量入口（改 pickedAt，不是 status）
  softDeleteParcel,
  restoreParcel,
  archiveDoneParcels,
  unarchiveParcel
};
