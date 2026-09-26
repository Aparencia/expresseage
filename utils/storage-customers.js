// utils/storage-customers.js · 档案（客户）的读写
// 拆自 `utils/storage.js`（2026-09-25 卡 52 拆 TD-001）；**行为逐字未变**，只是换了落点。
// 依赖方向：本文件 → `storage-core.js`（读盘/写盘单源）。⛔ 不许在这里再写一份 load/save。
// 跨实体的**生命周期**操作（软删档案连带名下的件、恢复、真删、重归）不在这里，
// 它们在 `utils/storage.js`（那一层同时要动 customers 与 parcels，属"归属"语义）。
'use strict';

const core = require('./storage-core.js');
const migrate = require('./migrate.js');

const loadStore = core.loadStore;
const saveStore = core.saveStore;
const cloneStore = core.cloneStore;
const newId = core.newId;
const normalizeText = core.normalizeText;
const okOf = core.okOf;
const failOf = core.failOf;
const isPlaceholderCustomer = core.isPlaceholderCustomer;
const PLACEHOLDER_CUSTOMER_ID = core.PLACEHOLDER_CUSTOMER_ID;
const PLACEHOLDER_CUSTOMER_NAME = core.PLACEHOLDER_CUSTOMER_NAME;

/**
 * 列档案。⚠️ 默认**不含**「未归类」占位档案（2026-09-25 用户裁决 A）：
 * 它是系统资产、不是真人 ⇒ 默认放它进来，档案页与客户选择器里就会冒出一条谁也认不出的"未归类"，
 * 用户还可能把它当客户去选/去改名/去删。要它必须**显式** `{includePlaceholder:true}`（清单分组用）。
 * @param {{includeDeleted?:boolean, includePlaceholder?:boolean}} [options]
 */
function listCustomers(options) {
  const opts = options || {};
  const includeDeleted = !!opts.includeDeleted;
  const includePlaceholder = !!opts.includePlaceholder;
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const customers = loaded.store.customers
    .filter((customer) => includeDeleted || !customer.deletedAt)
    .filter((customer) => includePlaceholder || !isPlaceholderCustomer(customer))
    .sort((a, b) => b.createdAt - a.createdAt); // 最新建的排前面
  return okOf({ customers, store: loaded.store });
}

function getCustomer(id) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const customer = loaded.store.customers.filter((item) => item.id === id && !item.deletedAt)[0];
  if (!customer) return failOf('NOT_FOUND');
  return okOf({ customer, store: loaded.store });
}

/**
 * 按**会话键**查档案（pick_friend：建档前的查重口，SCOPE M5 —— 同一条会话第二次选择要落回同一条档案）
 *
 * 为什么单独成一个函数，而不是让页面自己 `filter`：
 *   ① 键的"空"语义要只有一份 —— 没有键**不是错误**（手动新建、降级路径都走它），
 *      它与"读库失败"必须分开，否则调用方会把"读不出来"当成"没有已建档"；
 *   ② 软删必须排除：页面各写一份，迟早有一处忘了排除，把已删的人当成"已建档"而挡住建档。
 * @param {string} key 会话键（`utils/chat-tool.js` 的 `pairKeyOf` 产出的 16 位摘要）
 * @returns {{ok:boolean, customer?:object|null, reason?:string}} 键为空/非字符串 ⇒ `{ok:true, customer:null}`
 */
function findCustomerByChatKey(key) {
  // 没有键 = 这条路上"没有已建档"，不是失败（与 loadStore 的失败分支分开）
  if (typeof key !== 'string' || key === '') return okOf({ customer: null });
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const customer = loaded.store.customers.filter((item) => item.chatRoomId === key && !item.deletedAt)[0];
  return okOf({ customer: customer || null, store: loaded.store });
}

/**
 * 「未归类」占位档案：**惰性创建**（第一次真的需要时才建）。
 * 为什么不是开局就来一条：从没用过"取消建档"的人，档案列表里不该凭空多出一条系统档案（
 * 而且它会让 `hasCustomers` 变真 —— 那正是"一个档案都没有"要被如实说出来的那种状态）。
 * 合法性由 `migrate.validateCustomer` 的**占位分支**保证（楼栋/宿舍为空是它的正常形态）。
 * @returns {{ok:boolean, customer?:object, created?:boolean, reason?:string}} 已存在 ⇒ `created:false`
 */
function ensureUnassigned() {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const found = loaded.store.customers.filter((item) => item.id === PLACEHOLDER_CUSTOMER_ID)[0];
  if (found) return okOf({ customer: found, created: false });
  const now = Date.now();
  const customer = {
    id: PLACEHOLDER_CUSTOMER_ID,
    name: PLACEHOLDER_CUSTOMER_NAME,
    building: '', dorm: '', note: '', chatRoomId: '',
    // 唯一判据（migrate.isPlaceholderCustomer 认的就是它）：过滤、保护、清单分组三处共用
    placeholder: true,
    createdAt: now, updatedAt: now,
    deletedAt: null, deleteBatch: null
  };
  const next = cloneStore(loaded.store);
  next.customers.push(customer);
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ customer, created: true });
}

/**
 * 建档案（**唯一入口**：档案页浮层与聊天分包页两条路都走这里，规则才不会分叉）
 * @param {{name?:string,building?:string,dorm?:string,note?:string,chatRoomId?:string}} input
 *   `chatRoomId` = 单聊会话标识（v2 新增，SCOPE M11）：可空 = 未绑定；原样透传、**不 trim**（含空白的值本来就不合法）
 * @returns {{ok:boolean,customer?:object,reason?:string,detail?:string}}
 *   ⚠️ `ok:true` 时也可能带 `reason:'ROOM_ID_DISCARDED'` —— 它是**非致命提示**（会话标识格式不符被丢弃、
 *   但建档成功），页面要按"建好了 + 说明这一条不能按会话预选"来显示，**绝不允许把它当失败去回滚已写数据**
 */
function createCustomer(input) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const now = Date.now();
  const source = input || {};
  // 会话标识的形态规则**只在 migrate 里有一份**（isChatRoomId）：这里只决定"收还是丢"，不重抄正则与长度。
  // 为什么是"丢弃 + 仍建档"而不是拒绝整次建档：脏 id 只让"按会话预选"这一项收益失效，
  // 而建档本身（楼栋 + 宿舍 + 称呼）完全可用；因它拒绝会把 M3 手动建档一起堵死（M11 的裁决理由）。
  const roomIdValid = migrate.isChatRoomId(source.chatRoomId);
  const customer = {
    id: newId('c', now),
    name: normalizeText(source.name),
    building: normalizeText(source.building),
    dorm: normalizeText(source.dorm),
    note: normalizeText(source.note),
    // ⛔ chatRoomId 只进这一个字段：禁止塞进 note（那等于把 D3 会话标识复制进自由文本，
    // 而 note 会被显示与检索；也禁止落到本键之外的任何存储键）
    chatRoomId: roomIdValid ? (typeof source.chatRoomId === 'string' ? source.chatRoomId : '') : '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deleteBatch: null
  };
  const next = cloneStore(loaded.store);
  next.customers.push(customer);
  const saved = saveStore(next); // 字段规则由 validate() 判定；不通过就不落盘
  if (!saved.ok) return saved;
  const result = okOf({ customer });
  if (!roomIdValid) result.reason = 'ROOM_ID_DISCARDED';
  return result;
}

function updateCustomer(id, patch) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const index = loaded.store.customers.map((item) => item.id).indexOf(id);
  if (index < 0 || loaded.store.customers[index].deletedAt) return failOf('NOT_FOUND');
  // 「未归类」占位档案不可改名/换绑/软删/真删（依据见 migrate.js 顶部）：
  // 它一旦消失，名下快件立刻悬空 ⇒ 全库校验失败 ⇒ 连读盘都读不出来。
  if (isPlaceholderCustomer(loaded.store.customers[index])) return failOf('PLACEHOLDER_PROTECTED');
  const source = patch || {};
  const next = cloneStore(loaded.store);
  const customer = next.customers[index];
  if (source.name !== undefined) customer.name = normalizeText(source.name);
  if (source.building !== undefined) customer.building = normalizeText(source.building);
  if (source.dorm !== undefined) customer.dorm = normalizeText(source.dorm);
  if (source.note !== undefined) customer.note = normalizeText(source.note);
  customer.updatedAt = Date.now();
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ customer });
}

/**
 * 冲突时回给调用方的"持有者摘要"：**只给人话锚，不回显键**（键是 D3 邻域，页面只允许出指纹）。
 * 为什么连 `deleted` 也带出来：软删档案也占着键（见下），页面得能说清"那条已经删了"，
 * 否则用户看到"这个键已属于某条档案"却在列表里找不到它，只会当成 bug。
 */
function holderSummary(customer) {
  return {
    id: customer.id,
    building: customer.building,
    dorm: customer.dorm,
    name: customer.name,
    deleted: !!customer.deletedAt
  };
}

/**
 * 把**新会话键**挂到一条已有档案上（pick_friend 批 3 / SCOPE M7）
 *
 * 为什么要单独一个写入口，而不解禁 `updateCustomer` 收 `chatRoomId`：
 *   `updateCustomer` 是"改档案资料"的通用口，键是**会话身份**、有唯一性与冲突语义；
 *   两者混在一起，下一次有人给 `updateCustomer` 加字段就会顺手把键也放进去，冲突检查被绕过。
 *   单一用途 + 单一冲突判据 = 这条路上"库里不会出现两条同键档案"只在一处保证。
 *
 * 语义（用户裁决 + DESIGN §4）：
 *   · 档案不存在（**含软删**，与 `getCustomer` 同口径）⇒ `NOT_FOUND`（复活走恢复路径，不是靠改键）
 *   · 键已属于**另一条**档案 ⇒ `REBIND_CONFLICT` + `holder`（**拒绝**：不自动合并、不摘旧键、两边都不改）
 *   · 重绑到自己（同档案同键）⇒ 幂等 `ok:true` 且**不写盘**（少一次整键覆盖）
 *   · 键为 `''` ⇒ **解绑**（回到"无键、手选归类"态）
 *   · 形态不合法 ⇒ `VALIDATION_FAILED` + `detail='CUSTOMER_INVALID:chatRoomId'`（规则只在 migrate 里一份）
 *
 * ⚠️ 冲突检查**把软删档案也算持有者**：否则"删掉的人"手里的键能被转给另一个活人，
 *   等那条档案一恢复，库里就有两条同键档案 ⇒ `findCustomerByChatKey` 当场二义（M5 的核心矛盾）。
 *   宁可拒绝，让人先处理那一条 —— 这也正是"拒绝 + 人工处理"的裁决含义。
 * @param {string} id 目标档案 id
 * @param {string} key 新的会话键（16 位摘要）或 `''`（解绑）
 * @returns {{ok:boolean, customer?:object, unchanged?:boolean, reason?:string, detail?:string, holder?:object}}
 */
function rebindCustomerChatKey(id, key) {
  const loaded = loadStore();
  if (!loaded.ok) return loaded;
  const targetId = normalizeText(id);
  const index = loaded.store.customers.map((item) => item.id).indexOf(targetId);
  if (index < 0 || loaded.store.customers[index].deletedAt) return failOf('NOT_FOUND');
  // 「未归类」占位档案不可改名/换绑/软删/真删（依据见 migrate.js 顶部）：
  // 它一旦消失，名下快件立刻悬空 ⇒ 全库校验失败 ⇒ 连读盘都读不出来。
  if (isPlaceholderCustomer(loaded.store.customers[index])) return failOf('PLACEHOLDER_PROTECTED');


  // R-06（24 卡 P2）：非字符串（含 `undefined`/`null`/数字）⇒ **校验失败**，不解释成"解绑"。
  // 写入口把"调用方传错类型"当成"抹掉绑定"并回 `ok:true` 是**静默数据损失**（调用方少判一次 `ok`
  // 就会把某个客户的绑定悄悄清掉）；只有**显式 `''`** 才是解绑。
  if (typeof key !== 'string') return failOf('VALIDATION_FAILED', 'CUSTOMER_INVALID:chatRoomId');
  const nextKey = key.trim();
  // 形态规则**不在这里重抄**：`migrate.isChatRoomId` 认 undefined/null/'' = 未绑定
  if (nextKey !== '' && !migrate.isChatRoomId(nextKey)) {
    return failOf('VALIDATION_FAILED', 'CUSTOMER_INVALID:chatRoomId');
  }
  const current = loaded.store.customers[index];
  // 幂等优先于冲突：自己已经持有这个键时，哪怕库里还有别人也轮不到"冲突"（同键两条本就是被禁止的状态）
  if (current.chatRoomId === nextKey) return okOf({ customer: current, unchanged: true });

  if (nextKey !== '') {
    const holder = loaded.store.customers
      .filter((item) => item.id !== targetId && item.chatRoomId === nextKey)[0];
    // 冲突时**一个字节都不改**（连 updatedAt 都不动）：拒绝的含义是"这次什么都没发生"
    if (holder) return { ok: false, reason: 'REBIND_CONFLICT', holder: holderSummary(holder) };
  }

  const now = Date.now();
  const next = cloneStore(loaded.store);
  next.customers[index].chatRoomId = nextKey;
  next.customers[index].updatedAt = now;
  const saved = saveStore(next);
  if (!saved.ok) return saved;
  return okOf({ customer: next.customers[index] });
}

module.exports = {
  listCustomers,
  getCustomer,
  findCustomerByChatKey, // pick_friend 批 2：建档前的查重口（同一条会话第二次选择要落回同一条档案）
  rebindCustomerChatKey, // pick_friend 批 3：换绑口（平台换了会话 id 之后把客户重新认回来）
  createCustomer,
  updateCustomer,
  ensureUnassigned // 2026-09-25「未归类」批：占位档案**惰性创建**（第一次真的需要时才建）
};
