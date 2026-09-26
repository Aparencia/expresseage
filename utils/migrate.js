// utils/migrate.js · v2 初版本机库的结构版本与校验（SCHEMA_VERSION = 1，**零历史版本链**）
//
// 为什么做成"只操作普通对象"的纯函数：Node（人本地空跑/自测）与小程序真机必须跑**同一份**逻辑，
// 两套实现 = 规则与样例分叉（教训卡 docs/lessons/2026-09-11_规则与样例分叉.md）。
// 字段事实源：docs/specs/20260923_chat_pick/DESIGN.md §1（已按 v1 实码订正过）；键与字段同步
// docs/registry/DATA_DICT.md。
//
// 与 v1 同名文件的差异（刻意）：
//   ① v1 背了 v1→v4 四次升版的历史链；v2 是全新本机库、没有旧库要升 ⇒ **删掉整条版本链**。
//      `up` 只保留"缺字段才补"的幂等语义，`down` 在版本 1 上无事可做。
//   ② v1 的 `needsPickedAt / needsLockerNo / needsTrackingTail` 是"按库版本分档"的判据（v1 的库本来
//      就不该有 pickedAt，不能拿 v2 规则拒它）。v2 初版只有一个版本 ⇒ 全部收敛成**字段必须存在**。
//      ⚠️ 收敛的是"什么时候要求"，**不是校验强度**：必须存在 / 必须是字符串 / 空串合法（= 不适用）/
//      长度按 trim 后算 / 运单后 5 位必须恰好 5 位 ASCII 数字 —— 一条没降（降了就是静默写脏数据）。
//   ③ 新增 Customer.chatRoomId（v2 存在的理由）：可空、非唯一、不当主键，非空时卡死形态。
'use strict';

// ⚠️ 2026-09-26（V1→V2）：本模块第一次有了依赖 —— 站点名归一必须复用 `stations.matchBuiltinStation`
// （正式名 + 别名表的**唯一事实源**），⛔ 不在迁移里另写一份新旧名对照表（教训卡《规则与样例分叉》）。
// 依赖是**单向**的：`stations.js` 不 require 本模块 ⇒ 无环。
const stations = require('./stations.js');

const SCHEMA_VERSION = 2;

const CUSTOMER_REQUIRED = ['id', 'name', 'building', 'dorm', 'createdAt', 'updatedAt'];
const PARCEL_REQUIRED = ['id', 'customerId', 'stationName', 'pickupCode', 'status', 'source', 'createdAt', 'updatedAt'];
const PARCEL_STATUS = ['todo', 'done'];
const PARCEL_SOURCE = ['ocr', 'manual'];

// 长度上限（Magic Number 的出处 = DESIGN §1 的字段表；改这里必须同时改 DATA_DICT 与 DESIGN）
const MAX_CUSTOMER_FIELD = 20;   // name / building / dorm
const MAX_NOTE = 100;            // note（v1 实码口径就是 100，DESIGN 初版写的 20 已被订正）
const MAX_DELETE_BATCH = 40;     // deleteBatch（批次标记，见下方注释）
const MAX_STATION_NAME = 40;
const MAX_PICKUP_CODE = 40;      // pickupCode（v1 实码 40；DESIGN 初版的 20 同样已被订正）
const MAX_LOCKER_NO = 10;        // 柜号：按 **trim 后**算（与写入侧 trim 同口径）
const CHAT_ROOM_ID_MAX = 64;     // 会话标识长度上限（DESIGN §1 / SCOPE M11）

// 会话标识的字符集：平台给的 `open_single_roomid` 是字母数字串，这里额外允许 `-`/`_`。
// 为什么必须卡形态而不是只卡长度：这个值要参与"按会话自动归类"（aggregate.pickCustomerByRoom），
// 脏值（含空白/标点/被截断的半截 id）会让归类**静默命不中**——用户看到的是"它没认出我的客户"，
// 而真实原因是库里存了个不可能匹配上的字符串。宁可丢弃 + 提示，也不存假线索。
// ⚠️ 校验侧**不做 trim**：含空白的值不是合法会话标识，悄悄 trim 等于把两种不同写法当同一个键。
const CHAT_ROOM_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

// 运单后 5 位：写成 `[0-9]{5}` 而不是 `\d{5}`——两者在 JS 里等价（`\d` 只匹配 ASCII），
// 但显式字符类把"全角数字 `１２３４５` 必须拒绝"这个意图写在脸上，不必读者去查 `\d` 的语义。
const TRACKING_TAIL_SHAPE = /^[0-9]{5}$/;

// ── 「未归类」占位档案（2026-09-25 用户裁决 A：「加"未归类"占位客户（改数据形态）」）──────────────
// 它要解决的死结：`validateParcel` 要求每件都快挂**已知档案**（`PARCEL_CUSTOMER_MISSING`，`saveStore`
// 每次全库校验）⇒ "在建档浮层里取消"的那一件**根本没有落脚点**，只能丢掉或谎称已存。
// 于是给一个**固定 id 的占位档案**：件能落库、清单里能看见、之后一键归给真实客户。
//
// ⚠️ 它是**数据形态变更**（用户已明文批准），所以规则必须写在 schema 这一层（而不是页面里 if 一下）：
//   · 真实档案：`CUSTOMER_REQUIRED` 六个字段一个都不能空（楼栋/宿舍是它的身份）；
//   · 占位档案：**只有 id 与 name 是身份**，楼栋/宿舍/备注/会话键全是空串 —— 用同一个 `validateCustomer`
//     会被 `CUSTOMER_INVALID:building` 拒掉，所以下面给它一条**独立的合法分支**（不是放宽真实档案的要求）。
// ⛔ 别把它当成"少了一条档案"：它一旦被删/被改名，名下快件立刻悬空 ⇒ 全库校验失败 ⇒ **连读盘都读不出来**。
const PLACEHOLDER_CUSTOMER_ID = 'unassigned';
const PLACEHOLDER_FLAG = 'placeholder';

/** 是不是「未归类」占位档案（标记字段是**唯一**判据 —— 不看 id，改名/换 id 也认得出） */
function isPlaceholderCustomer(customer) {
  return !!(customer && customer[PLACEHOLDER_FLAG] === true);
}

// 首版空库：客户与快递两个集合（v2 没有第三个集合；派生值一律现算，见 SCOPE W3）
function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, customers: [], parcels: [] };
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isTimestamp(value) {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

// 可空时间戳：字段缺失、null、或合法时间戳都算通过
function isOptionalTimestamp(value) {
  return value === undefined || value === null || isTimestamp(value);
}

// 可选短字符串（note / deleteBatch）：`undefined`/`null` 合法，非空时必须是**不超长的字符串**。
// ⚠️ 长度按**原串**算（v1 口径）：这两个字段是给人看的备注，不是匹配键，trim 后再比长度只会
// 让"101 个字符"合法落库、下轮按原串又判它违规——同一规则两次跑出不同结论。
function isOptionalString(value, maxLength) {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && value.length <= maxLength;
}

function hasKey(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

/**
 * 会话标识是否合法。三态全接受：`undefined`/`null`/`''` = 未绑定（与 lockerNo、trackingTail 同口径，
 * "没有"是一个明确的值，不是一种缺失）。非空时必须满足形态与长度。
 * 导出给 `utils/storage.js` 复用：**同一条规则不许有两份实现**（AGENTS §2 单一事实源）。
 * @param {unknown} value
 * @returns {boolean}
 */
function isChatRoomId(value) {
  if (value === undefined || value === null || value === '') return true;
  return typeof value === 'string' && value.length <= CHAT_ROOM_ID_MAX && CHAT_ROOM_ID_SHAPE.test(value);
}

/**
 * 正向迁移：把任意旧状态升到当前版本。
 * 返回 `{ok:true, state}` 或 `{ok:false, reason}`
 * @param {object|null} state 盘上读到的对象（可为 null = 首次运行）
 */
function up(state) {
  // 比本版本还新 = 用户装过更新版本又回退；覆盖会毁掉新数据 → 拒绝，交给上层提示
  if (state && typeof state.schemaVersion === 'number' && state.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'STORE_VERSION_MISMATCH' };
  }
  if (state === null || state === undefined) return { ok: true, state: emptyStore() };
  if (state.schemaVersion === SCHEMA_VERSION) return { ok: true, state: state };

  const next = Object.assign({}, state, { schemaVersion: SCHEMA_VERSION });
  // 逐条补字段（**只补缺失的**，既有值一字不动）：
  //   pickedAt（缺失 = 未取件）/ lockerNo（缺失 = 未知，空串）/ trackingTail（缺失 = 不适用，空串）
  // chatRoomId **不在这里补**：它按规则可缺（`undefined` 合法），up 只补"validate 会要求存在"的字段——
  // 补一个没被要求的字段等于让 up 的输出形状不再由校验规则决定，日后没人说得清谁该负责。
  // 这也是本函数对初版库**幂等**的原因：跑第二遍时字段都在，一个字节都不改。
  //
  // ── V1 → V2（2026-09-26 · **用户批准的数据写入**：「1、是」）────────────────────────────
  // 唯一变更 = **站点名归一**：P7 于同日改名（`西苑邮政` → `西苑一栋邮政`），而**取件清单按站点名字符串
  // 分组** ⇒ 库里已存的旧名件会单独成一组（同一个点两个名字，正是 SCOPE W1 要防的"多跑一趟"）。
  // ⛔ 四条纪律（缺一条这次迁移就不该跑）：
  //   ① **只动 `stationName` 一个字段**（取件码 / 尾号 / 柜号 / 手机号一个字都不碰）；
  //   ② 归一判定**复用 `stations.matchBuiltinStation`**（正式名 + 别名表的唯一事实源），⛔ **不写死新旧名对照表**
  //      —— 写死就等于在迁移里长出第二份站点表，下次改名必漏（教训卡《规则与样例分叉》）；
  //   ③ **幂等**：命不中 / `ambiguous` / 已是正式名 ⇒ 原样返回**同一个对象**（跑第二遍零改写）；
  //   ④ **不可逆**：迁移后"本来就叫新名"与"从旧名改过来的"在同一个字段上不可区分 ⇒ 不造反向步骤（见 `down`）。
  // ⚠️ 代价如实记：`matchBuiltinStation` 的 ③ 步是"包含"判定 ⇒ 恰好包含某个正式名的**自建**站点名会被一并
  //    收敛 —— 这正是"归一"的语义，且不确定的输入（`ambiguous`）一律不动。
  let stationRenamed = 0;
  next.parcels = (state.parcels || []).map((parcel) => {
    let copy = parcel;
    if (!hasKey(copy, 'pickedAt')) copy = Object.assign({}, copy, { pickedAt: null });
    if (!hasKey(copy, 'lockerNo')) copy = Object.assign({}, copy, { lockerNo: '' });
    if (!hasKey(copy, 'trackingTail')) copy = Object.assign({}, copy, { trackingTail: '' });
    const renamed = normalizedStationName(copy.stationName);
    if (renamed !== copy.stationName) {
      copy = Object.assign({}, copy, { stationName: renamed });
      stationRenamed += 1;
    }
    return copy;
  });
  next.customers = state.customers || [];
  // 读数随结果回传（**不落库**：往库里塞一个 `migrated` 字段等于扩 schema，那是另一件事）——
  // 屏上能不能看见它由调用方决定；用户可见的证据本来就是**清单里两组并成一组**。
  return { ok: true, state: next, stationRenamed: stationRenamed };
}

/**
 * 站点名的**归一判定**（只给 `up` 用）：能收敛到正式名就返回正式名，否则**原样返回**（⛔ 绝不写空串，
 * 也绝不猜）。为什么要单独一个函数：迁移里"改哪个值、改成什么"必须可被单测直接钉住，而 `up` 的入参是整个库。
 * @param {string} name 库里的站点名（可能是自建的任意串，也可能不是字符串）
 * @returns {string} 归一后的站点名
 */
function normalizedStationName(name) {
  if (typeof name !== 'string' || name === '') return name;
  const hit = stations.matchBuiltinStation(name);
  return hit && hit.ok ? hit.stationName : name;
}

/**
 * 反向迁移。**V2 没有反向步骤，且这是刻意的**：V1→V2 的动作是"把旧站点名归一成正式名"，
 * 迁移后"本来就叫新名"与"从旧名改过来的"在**同一个字段上不可区分** ⇒ 硬造一个"改回去"就是猜，
 * 会把本来就叫新名的件错改成旧名（比不做更坏）。所以对 V2 一律拒绝（`STORE_VERSION_MISMATCH`），
 * 交给上层提示"本地数据比程序新"—— 与 V1 那句"非数值版本号不静默当 v1"同一个取向：**不知道会删掉什么就别动手**。
 * @param {object|null} state
 */
function down(state) {
  if (state === null || state === undefined) return { ok: true, state: null };
  // R-10（v1 24 审查）：非数值版本号**不再静默当 v1** —— 那等于"不知道自己会删掉什么就动手"，
  // 回滚路径上最危险。这条与版本链长短无关，所以 v2 保留了它。
  if (typeof state.schemaVersion !== 'number') return { ok: false, reason: 'STORE_VERSION_MISMATCH' };
  // 版本 1 以下不是合法库（validate 会拒），但既然来了就按"无事可做"处理，不臆造反向步骤
  if (state.schemaVersion <= 1) return { ok: true, state: state };
  // V2（当前版本）与更高版本都到这里：**没有任何对应的反向步骤**（理由见函数头）
  return { ok: false, reason: 'STORE_VERSION_MISMATCH' };
}

/**
 * 结构校验（含版本判据）：读盘后与写盘前都要过（防手改、防半截写入导致真机白屏）。
 * @param {object} state
 */
function validate(state) {
  if (!state || typeof state !== 'object') return { ok: false, reason: 'STORE_CORRUPT' };
  if (typeof state.schemaVersion !== 'number' || state.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'STORE_VERSION_MISMATCH' };
  }
  return validateBody(state);
}

/**
 * 结构体校验（不含版本判据）：给"读时升级"用——升级**之前**要用它确认旧库本身没坏，
 * 否则损坏的库会被当成"待升级"去跑 up，原因码被包一层、掩盖真正的 STORE_CORRUPT。
 * @param {object} state
 */
function validateBody(state) {
  if (!state || typeof state !== 'object') return { ok: false, reason: 'STORE_CORRUPT' };
  if (!Array.isArray(state.customers) || !Array.isArray(state.parcels)) return { ok: false, reason: 'STORE_CORRUPT' };

  const customerIds = {};
  for (const customer of state.customers) {
    const reason = validateCustomer(customer);
    if (reason) return { ok: false, reason };
    if (customerIds[customer.id]) return { ok: false, reason: 'CUSTOMER_ID_DUPLICATE' };
    customerIds[customer.id] = true;
  }

  const parcelIds = {};
  for (const parcel of state.parcels) {
    // 归属校验放在客户之后：软删除的档案也算"存在"（恢复档案时它的记录要能一起回来）
    const reason = validateParcel(parcel, customerIds);
    if (reason) return { ok: false, reason };
    if (parcelIds[parcel.id]) return { ok: false, reason: 'PARCEL_ID_DUPLICATE' };
    parcelIds[parcel.id] = true;
  }

  return { ok: true };
}

/** 单个客户档案：通过返回 `''`，否则返回错误码。 */
function validateCustomer(customer) {
  const item = customer || {};
  // 占位档案走**独立分支**：它的身份只有 id 与 name（楼栋/宿舍/备注/会话键按"可为空"校验）。
  // 为什么不是"给真实档案放宽"：真实档案的楼栋宿舍是它的身份，放宽等于允许写一条谁也认不出的档案。
  if (isPlaceholderCustomer(item)) {
    if (!isNonEmptyString(item.id, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:id';
    if (!isNonEmptyString(item.name, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:name';
    if (!isOptionalString(item.building, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:building';
    if (!isOptionalString(item.dorm, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:dorm';
    if (!isOptionalString(item.note, MAX_NOTE)) return 'CUSTOMER_INVALID:note';
    if (!isChatRoomId(item.chatRoomId)) return 'CUSTOMER_INVALID:chatRoomId';
    if (!isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt) || !isOptionalTimestamp(item.deletedAt)) {
      return 'CUSTOMER_INVALID:time';
    }
    if (!isOptionalString(item.deleteBatch, MAX_DELETE_BATCH)) return 'CUSTOMER_INVALID:deleteBatch';
    return '';
  }
  for (const field of CUSTOMER_REQUIRED) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      return 'CUSTOMER_INVALID:' + field;
    }
  }
  if (!isNonEmptyString(item.name, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:name';
  if (!isNonEmptyString(item.building, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:building';
  if (!isNonEmptyString(item.dorm, MAX_CUSTOMER_FIELD)) return 'CUSTOMER_INVALID:dorm';
  // 备注可空（v1 口径：undefined/null/'' 合法）。⛔ 约定：note 禁止写 chatRoomId 与取件码
  // （D3 卫生，SCOPE M11）——形态上查不出来，所以靠"两个入口都只塞 splitCustomerLine 的产物"这条结构约束
  if (!isOptionalString(item.note, MAX_NOTE)) return 'CUSTOMER_INVALID:note';
  // 会话标识（v2 新增）：可空；非空时卡形态（见 CHAT_ROOM_ID_SHAPE 的注释）。刻意**不做唯一约束**：
  // 两人共用一个会话是真实场景，判重会误伤，归类侧的多命中交由 aggregate.pickCustomerByRoom 交人判
  if (!isChatRoomId(item.chatRoomId)) return 'CUSTOMER_INVALID:chatRoomId';
  if (!isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt) || !isOptionalTimestamp(item.deletedAt)) {
    return 'CUSTOMER_INVALID:time';
  }
  // 批次标记可选；有就必须是短字符串——它用来区分"同一次删除"，不能用时间戳代替
  // （同毫秒内两次不同删除会撞车，教训卡 docs/lessons/2026-09-15_时间戳当批次标记.md）
  if (!isOptionalString(item.deleteBatch, MAX_DELETE_BATCH)) return 'CUSTOMER_INVALID:deleteBatch';
  return '';
}

/**
 * 单条快递记录：通过返回 `''`，否则返回错误码。
 * @param {object} parcel
 * @param {Object<string,true>} knownCustomerIds 已校验过的客户 id 集合（含软删档案）
 */
function validateParcel(parcel, knownCustomerIds) {
  const item = parcel || {};
  for (const field of PARCEL_REQUIRED) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      return 'PARCEL_INVALID:' + field;
    }
  }
  if (!knownCustomerIds[item.customerId]) return 'PARCEL_CUSTOMER_MISSING';
  if (!isNonEmptyString(item.stationName, MAX_STATION_NAME)) return 'PARCEL_INVALID:stationName';
  if (!isNonEmptyString(item.pickupCode, MAX_PICKUP_CODE)) return 'PARCEL_INVALID:pickupCode';
  if (PARCEL_STATUS.indexOf(item.status) < 0) return 'PARCEL_INVALID:status';
  if (PARCEL_SOURCE.indexOf(item.source) < 0) return 'PARCEL_INVALID:source';
  if (!isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt)
    || !isOptionalTimestamp(item.doneAt) || !isOptionalTimestamp(item.archivedAt)
    || !isOptionalTimestamp(item.deletedAt)) {
    return 'PARCEL_INVALID:time';
  }
  // 已取件时间戳：v1 是"v2 起的库必须存在"，v2 初版 ⇒ **必须存在**（`null` = 未取到）。
  // 缺失 = 这条没走过 up，直接报出来，而不是当成"未取件"悄悄放过
  if (!hasKey(item, 'pickedAt')) return 'PARCEL_INVALID:pickedAt';
  if (!isOptionalTimestamp(item.pickedAt)) return 'PARCEL_INVALID:pickedAt';
  // 柜号：**必须存在**且必须是字符串；**空串合法**（= 未知），所以它不能进 PARCEL_REQUIRED。
  // 长度按 trim 后算（写入侧也 trim，两处同口径，否则"存得进、读不懂"）
  if (!hasKey(item, 'lockerNo')) return 'PARCEL_INVALID:lockerNo';
  if (typeof item.lockerNo !== 'string') return 'PARCEL_INVALID:lockerNo';
  if (item.lockerNo.trim().length > MAX_LOCKER_NO) return 'PARCEL_INVALID:lockerNo';
  // 运单后 5 位：与柜号同构的三条闸（必须存在 / 必须是字符串 / 空串 = 不适用）。
  // 为什么非空时卡死"恰好 5 位数字"：这个值唯一的用途是"拿去找取件码"，位数不对就查不出来，
  // 放行等于存了个假线索（清单会把它排进"需查明"档，用户跑到柜台才发现是废值）
  if (!hasKey(item, 'trackingTail')) return 'PARCEL_INVALID:trackingTail';
  if (typeof item.trackingTail !== 'string') return 'PARCEL_INVALID:trackingTail';
  const tail = item.trackingTail.trim();
  if (tail !== '' && !TRACKING_TAIL_SHAPE.test(tail)) return 'PARCEL_INVALID:trackingTail';
  if (!isOptionalString(item.deleteBatch, MAX_DELETE_BATCH)) return 'PARCEL_INVALID:deleteBatch';
  return '';
}

module.exports = {
  SCHEMA_VERSION,
  CHAT_ROOM_ID_MAX,
  PLACEHOLDER_CUSTOMER_ID,   // 「未归类」占位档案的固定 id（data 层与 UI 都从这里取，⛔ 别在别处再写字面量）
  isPlaceholderCustomer,     // 标记字段是唯一判据（过滤/保护/清单分组三处共用）
  emptyStore,
  up,
  down,
  validate,
  validateBody,
  isChatRoomId
};
