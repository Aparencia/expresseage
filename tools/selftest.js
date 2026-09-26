// tools/selftest.js · v2 批 1 行为自测（零依赖；内存 mock wx，**不碰真机数据、不 require 任何页面**）
//
// 为什么要它：必填校验、软删的"同批认领"、会话标识的三态、归类"宁可不猜"这些不变量，
// 靠人在页面上点是覆盖不到的；本项目 0 依赖 ⇒ 用最小断言把它们钉住（AGENTS §1 的 DoD 要真跑过的证据）。
//
// 三条写断言的纪律（每条都有过事故）：
//   ① **断言必须有判别力**：先跑"合法值通过"的基线，再跑"只有该闸能挡"的样本；
//      判据若改成什么样都不红，就是装饰（docs/lessons/2026-09-17_变异不红的两种含义.md）。
//   ② **不许在空集上刷全绿**：凡"跑在某批数据上"的断言，同段必须同时断言数据真的在、条数 > 0
//      （docs/lessons/2026-09-19_空集上的全绿.md）。
//   ③ **v1 的存储键是真实数据**：mock 记录"被碰过的键清单"，结尾机械证明全程只碰过
//      `ex_college_v2.store`，并断言访问次数 > 20（否则"从没碰过"也可能只是"从没读过"）（AGENTS §9 红线）。
'use strict';

const V1_KEY = 'ex_college.store';        // 只作为"绝不该被碰"的哨兵字符串出现，不参与任何读写
const V2_KEY = 'ex_college_v2.store';

const memory = {};
const touchedKeys = [];
function noteKey(key) { touchedKeys.push(key); }
function deepCopy(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

// 真机的 get/set 每次都过一遍序列化，所以两个方向都拷贝：
// 否则测试里"改一下内存对象"就等于改了盘上数据（真机不会这样，测出来的是假绿）
global.wx = {
  getStorageSync: (key) => {
    noteKey(key);
    return memory[key] === undefined ? '' : deepCopy(memory[key]);
  },
  setStorageSync: (key, value) => {
    noteKey(key);
    memory[key] = deepCopy(value);
  },
  removeStorageSync: (key) => {
    noteKey(key);
    delete memory[key];
  }
};

const migrate = require('../utils/migrate.js');
const storage = require('../utils/storage.js');
const aggregate = require('../utils/aggregate.js');
const customerInput = require('../utils/customer-input.js');
const reason = require('../utils/reason.js');
const parcelDrafts = require('../utils/parcel-drafts.js');
const chatTool = require('../utils/chat-tool.js');
const formParts = require('../pages/recognize/form-parts.js');

let passed = 0;
let failed = 0;
let incomplete = false;

// R2-C04（r2 代码侧审查·变异 M3 实证）：崩在中段时，旧写法只打印"断言 154 条"就退出 —— 那与"全绿"几乎同形，
// 读的人必须自己去数才发现少跑了一大截。这里把**预期条数钉死**：跑不满直接判红，不靠人 eyeball。
// ⚠️ 加/删断言必须同步改这个数；不改会立刻报红，而不是静默放过（这正是它存在的目的）。
const EXPECTED_ASSERTIONS = 774;   // 683 + §18「识别补丁」8 + §19「站点别名/P8/改名/邮政五条」12 + §20「真机原文」6 + §21「运单后 5 位」8 + §22「送检帧尺寸闸」5 + §23「空白帧判据」6 + §24「转发卡片」6 + §25「送检形态阶梯」5 + §1「V1→V2 站点名归一」6 + §26「批次合并」4 + §27「多选批次」8 + §28「单条保存入口」9 + §29「独立迁移审计」13（2026-09-26）   // 683 = 667 + §17「取会话键的跨动线能力」16 条（2026-09-25 B 段：清单动线取键 + 意图交接）   // 667 = 656 + §16「会话键的来源与绑定」11 条（2026-09-25 BUG：清单建档丢键）

function printSummary() {
  const total = passed + failed;
  incomplete = total !== EXPECTED_ASSERTIONS;
  console.log('');
  console.log('断言 ' + total + ' 条：通过 ' + passed + '，失败 ' + failed);
  if (incomplete) {
    console.log('  [FAIL] 只跑到 ' + total + ' 条，预期 ' + EXPECTED_ASSERTIONS
      + ' 条 ⇒ 有断言根本没跑（多半是取值链上抛错崩在中段）。**这不是通过。**');
  }
}

// R-11（24 审查的变异实验 B 实证）：断言取值链上任何一处抛错都会**终止进程** ——
// 于是后面上百条一条都不跑、末尾的总数行也不打印，审查者读到的是"没输出"，
// 分不清"全绿"和"崩在第三条"（这比崩本身更危险：它长得像没跑）。
// 这里兜住最后一层：抛错记成一条失败、把栈打出来、**照常打印总数**并以非 0 退出。
// 注意它只是"不吞掉读数"，不等于后面的断言还会跑 —— 真正的修法是每个取值点先判空（见 diskList/rowAt）。
process.on('uncaughtException', (err) => {
  failed++;
  console.log('  [FAIL] 断言取值时抛错，本行之后的断言没跑 —— ' + String((err && err.stack) || err));
  printSummary();
  console.log('行为自测未通过。禁止宣布完成。');
  process.exit(1);
});

// 同上，但覆盖**异步**断言（§10 的 await 链）：uncaughtException 抓不到被 Promise 吞掉的 rejection，
// Node 默认会直接以"未处理拒绝"退出 —— 那同样是一屏没有总数的读数。
process.on('unhandledRejection', (err) => {
  failed++;
  console.log('  [FAIL] 异步断言抛错（await 链断了，后面的断言没跑）—— ' + String((err && err.stack) || err));
  printSummary();
  console.log('行为自测未通过。禁止宣布完成。');
  process.exit(1);
});

function fmt(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value && typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 140 ? text.slice(0, 140) + '…' : text;
  }
  return String(value);
}

function check(label, condition, actual) {
  if (condition === true) {
    passed++;
    return;
  }
  failed++;
  process.exitCode = 1;
  // 失败要能指向根因（AGENTS §11.4）：打出实际值，而不是只说"不匹配"
  console.log('  [FAIL] ' + label + (actual === undefined ? '' : ' —— 实际：' + fmt(actual)));
}

function eq(label, actual, expected) {
  check(label, actual === expected, '期望 ' + fmt(expected) + '，实际 ' + fmt(actual));
}

function resetStore() {
  delete memory[V2_KEY];
}

function disk() {
  return memory[V2_KEY];
}

function diskBytes() {
  return JSON.stringify(memory[V2_KEY] === undefined ? null : memory[V2_KEY]);
}

// 盘上集合与接口返回值的**安全取法**（R-11）：前一条断言失败时这里可能是 undefined，
// 直接写 `disk().customers[1].chatRoomId` 会在"取实际值"这一步抛 TypeError 把整个进程带走 ——
// 那一条断言于是变成"没跑"而不是"红"，后面上百条也跟着一起消失。判空后最坏是红一条，进程继续。
function listFrom(result, key) {
  const list = result && result[key];
  return Array.isArray(list) ? list : [];
}

function diskList(key) {
  return listFrom(disk(), key);
}

function rowAt(list, index) {
  return (list || [])[index] || {};
}

/** 返回对象里的子对象（建档结果 `.customer` / 写库结果 `.parcel`）；取不到就是 `{}` */
function fieldOf(obj, field) {
  const value = obj && obj[field];
  return value === undefined || value === null ? {} : value;
}

/** 盘上字节没变（拒绝路径的通用钉法）。
 *  actual 只打"条数 + 是否相同"而不是整库 JSON：整库一打就是几千字，反而把真正那条 [FAIL] 挤出屏幕 */
function diskUnchanged(label, before) {
  check(label, diskBytes() === before,
    '盘上档案 ' + diskList('customers').length + ' 条 / 记录 ' + diskList('parcels').length + ' 条（期望与操作前逐字节相同）');
}

/** 结果对象里的 id（取不到就是 `''`：让断言红，不让进程崩） */
function idIn(result, key) {
  return fieldOf(result, key).id || '';
}

/** 一条合法客户（fixture：先证明它过得了校验，后面的"该红"才说明得了） */
function baseCustomer(extra) {
  return Object.assign({
    id: 'c1', name: '小王', building: 'D4', dorm: '522', note: '', chatRoomId: '',
    createdAt: 1700000000000, updatedAt: 1700000000000, deletedAt: null, deleteBatch: null
  }, extra || {});
}

/** 一条合法快递记录 */
function baseParcel(extra) {
  return Object.assign({
    id: 'p1', customerId: 'c1', stationName: '菜鸟驿站', pickupCode: '109-2-3003',
    status: 'todo', source: 'manual',
    createdAt: 1700000000000, updatedAt: 1700000000000,
    doneAt: null, pickedAt: null, archivedAt: null, deletedAt: null, deleteBatch: null,
    lockerNo: '', trackingTail: ''
  }, extra || {});
}

function validateState(customers, parcels) {
  return migrate.validateBody({ schemaVersion: migrate.SCHEMA_VERSION, customers: customers, parcels: parcels });
}

/** 改客户 fixture 的一个字段 → 返回错误码（通过时为 undefined） */
function customerReason(field, value) {
  const patch = {};
  patch[field] = value;
  const result = validateState([baseCustomer(patch)], [baseParcel()]);
  return result.reason;
}

/** 改记录 fixture 的一个字段 → 返回错误码（通过时为 undefined） */
function parcelReason(field, value) {
  const patch = {};
  patch[field] = value;
  const result = validateState([baseCustomer()], [baseParcel(patch)]);
  return result.reason;
}

/** 整条记录换掉（用来测"**字段不存在**"，字段级 patch 做不到：合并会把默认值留着） */
function parcelObjectReason(parcel) {
  return validateState([baseCustomer()], [parcel]).reason;
}

// ── §0 冒烟：mock 与存储键 ─────────────────────────────────────────────
console.log('§0 冒烟');
check('storage.STORE_KEY 是 v2 独立键', storage.STORE_KEY === V2_KEY, storage.STORE_KEY);
check('storage.STORE_KEY 不等于 v1 键（同 appid ⇒ 同命名空间，碰它 = 删真实数据）',
  storage.STORE_KEY !== V1_KEY, storage.STORE_KEY);
const firstRead = storage.listCustomers();
check('首次读取自动建库且列表为空', firstRead.ok === true && firstRead.customers.length === 0, firstRead);
// ⚠️ 2026-09-26 v2 第一次真实升版（V1→V2）：这里不再写死 `1`，改与当前版本比
// （版本号**只在 §1 里写死一次** —— 升版必须是一次自觉动作，其余处一律与常量比）
eq('建库已落盘且是当前版本', fieldOf(disk(), 'schemaVersion'), migrate.SCHEMA_VERSION);

// ── §1 migrate：版本语义 ────────────────────────────────────────────────
// ⚠️ 2026-09-26 **v2 的第一次真实升版**（V1 → V2 = 站点名归一，用户裁决「1、是」）。本节因此改了两处口径：
//   ① **版本号只在下面这一条里写死**（"写死一次"= 升版必须是一次自觉动作）；其余断言一律与
//      `migrate.SCHEMA_VERSION` 比 —— 否则每次升版都要满地改数字，改漏一处就变成"断言在描述历史"。
//   ② "太新的库"要用 `SCHEMA_VERSION + 1` 构造（原来写死的 `2` 现在已经不是"太新"了）。
console.log('§1 migrate 版本语义');
const CUR = migrate.SCHEMA_VERSION;
eq('SCHEMA_VERSION = 2（V1 是初版；**V2 = 站点名归一**，2026-09-26 用户批准的数据写入）', CUR, 2);
const fresh = migrate.emptyStore();
check('emptyStore 形状正确', fresh.schemaVersion === CUR && Array.isArray(fresh.customers) && Array.isArray(fresh.parcels), fresh);
const upNull = migrate.up(null);
check('up(null) → 当前版本空库', upNull.ok === true && upNull.state.schemaVersion === CUR && upNull.state.parcels.length === 0, upNull);
const upSame = migrate.up({ schemaVersion: CUR, customers: [], parcels: [] });
check('up(当前版本库) 原样返回（不臆造变换）', upSame.ok === true && upSame.state.schemaVersion === CUR, upSame.state && upSame.state.schemaVersion);
const upTooNew = migrate.up({ schemaVersion: CUR + 1, customers: [], parcels: [] });
check('up: schemaVersion > 当前 ⇒ 拒绝且码为 STORE_VERSION_MISMATCH',
  upTooNew.ok === false && upTooNew.reason === 'STORE_VERSION_MISMATCH', upTooNew);
const legacyParcel = { id: 'p1', customerId: 'c1', stationName: 'S', pickupCode: '1', status: 'todo', source: 'manual', createdAt: 1, updatedAt: 1 };
const legacy = migrate.up({ schemaVersion: 0, customers: [baseCustomer()], parcels: [legacyParcel] });
check('up: 缺字段才补（pickedAt=null / lockerNo="" / trackingTail=""）',
  legacy.ok === true && legacy.state.schemaVersion === CUR
  && legacy.state.parcels[0].pickedAt === null && legacy.state.parcels[0].lockerNo === '' && legacy.state.parcels[0].trackingTail === '',
  legacy.state && legacy.state.parcels[0]);
check('up: 既有值一字没动（补字段不是重写记录）—— 自建点名 `S` 不在站点表里 ⇒ 原样留下',
  legacy.state.parcels[0].pickupCode === '1' && legacy.state.parcels[0].stationName === 'S', legacy.state.parcels[0]);
const legacyTwice = migrate.up(legacy.state);
eq('up 幂等：跑第二遍一个字节都不改', JSON.stringify(legacyTwice.state), JSON.stringify(legacy.state));

// ── V1 → V2：站点名归一（2026-09-26 用户批准的数据写入：「1、是」）────────────────
// 为什么这组断言值得单列：它是**本项目第一次会改"既有值"的迁移**（此前 up 只补缺失字段）。
// 三个必须是硬纪律：**只动 stationName** / **靠站点表的别名判定（不写死新旧名对照）** / **幂等**。
const renamedParcel = Object.assign({}, legacyParcel, { id: 'p9', stationName: '西苑邮政' });
const keepParcel = Object.assign({}, legacyParcel, { id: 'p10', stationName: '自建点-东门' });
const v1Store = { schemaVersion: 1, customers: [baseCustomer()], parcels: [renamedParcel, keepParcel] };
const migrated = migrate.up(v1Store);
check('V1→V2①：旧正式名 `西苑邮政` ⇒ 归一成 `西苑一栋邮政`，并如实回传改写条数',
  migrated.state.parcels[0].stationName === '西苑一栋邮政' && migrated.stationRenamed === 1,
  migrated.state.parcels[0].stationName + '｜条数=' + migrated.stationRenamed);
// ⚠️ 比对前要**先摘掉 up 补的那三个字段**（pickedAt/lockerNo/trackingTail）：它们是"补缺失字段"那一半的产物，
// 不属于"只动 stationName"这条纪律的范围 —— 第一版忘了摘，断言当场红（正好证明它确实在逐字节比）。
// ⚠️ 2026-09-26 独立审查 M-C 修：第一版用 `JSON.stringify` 深比 ⇒ **键序敏感**。审稿人做了一次
// **语义等价**的改写（只把 `stationName` 挪到键序末尾）⇒ 断言判红 = **假红**（"键序"不是这条纪律的一部分）。
// 现在改成**逐字段比 + 键集合比**（两边键排序后比集合，值逐个比）：顺序无关，语义等价改写不再误报。
const sameFieldsIgnoringOrder = (a, b) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return false;
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};
const migratedNoAdd = Object.assign({}, migrated.state.parcels[0]);
delete migratedNoAdd.pickedAt; delete migratedNoAdd.lockerNo; delete migratedNoAdd.trackingTail;
check('V1→V2②：**只动 stationName** —— 其他字段逐字段不变、键集合一致（**不看键序**：语义等价的挪位不许判红）',
  sameFieldsIgnoringOrder(Object.assign({}, migratedNoAdd, { stationName: '西苑邮政' }), renamedParcel),
  migrated.state.parcels[0]);
check('V1→V2③：命不中的**自建**站点名原样留下（⛔ 绝不写空串、绝不猜）',
  migrated.state.parcels[1].stationName === '自建点-东门', migrated.state.parcels[1].stationName);
check('V1→V2④：**判定只能来自站点表**（⛔ 迁移里不写死新旧名对照表）—— 由 `tools/audit-migrate.js` 的 A4/B4 独立钉住（去注释后 `migrate.js` 里站点名字面量 **0 处** + 22 条探针等价式），本处不再重复',
  require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'migrate.js'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').indexOf('西苑') < 0,
  'src(去注释) 中站点名字面量出现位置 < 0 = 无');
const migratedTwice = migrate.up(migrated.state);
check('V1→V2⑤：**幂等** —— 升完再跑一遍返回同一个对象（零改写）',
  migratedTwice.state === migrated.state, migrated.state.parcels[0].stationName);
// ⚠️ 这一条是**设备安全闸**：`storage-core` 读完就走 `saveStore(upgraded.state)`（升级会**落盘**）
// ⇒ 归一后的库若过不了 `validate`，用户设备上的写回会失败。改名的产物必须是**合法库**。
check('V1→V2⑥：归一后的库**仍然通过 validate**（升级会落盘 ⇒ 不合法就意味着设备上写不回去）',
  migrate.validate(migrated.state).ok === true, migrate.validate(migrated.state));
const v2Customer = { id: 'c1', name: 'A', building: 'D4', dorm: '522', createdAt: 1, updatedAt: 1 };
const upNoChatRoom = migrate.up({ schemaVersion: 0, customers: [v2Customer], parcels: [] });
check('up 不替 chatRoomId 造值（该字段可缺，要不要它由 validate 说了算）',
  Object.prototype.hasOwnProperty.call(upNoChatRoom.state.customers[0], 'chatRoomId') === false, upNoChatRoom.state.customers[0]);

const downNull = migrate.down(null);
check('down(null) → 无事可做', downNull.ok === true && downNull.state === null, downNull);
const v1State = { schemaVersion: 1, customers: [baseCustomer()], parcels: [baseParcel()] };
const down1 = migrate.down(v1State);
check('down: 版本 1 = 无事可做、**原对象原样返回**（不是失败，也没删字段）',
  down1.ok === true && down1.state === v1State && down1.state.parcels[0].trackingTail === '', down1);
const downBadVersion = migrate.down({ schemaVersion: '1', customers: [], parcels: [] });
check('down: 非数值版本号必须拒绝（不知道自己会删什么就动手 = 回滚路径上最危险）',
  downBadVersion.ok === false && downBadVersion.reason === 'STORE_VERSION_MISMATCH', downBadVersion);
const downBadVersion2 = migrate.down({ customers: [], parcels: [] });
check('down: 连 schemaVersion 都没有 ⇒ 拒绝（不许当版本 1 顺手回滚）',
  downBadVersion2.ok === false && downBadVersion2.reason === 'STORE_VERSION_MISMATCH', downBadVersion2);
const downTooHigh = migrate.down({ schemaVersion: CUR, customers: [], parcels: [] });
check('down: **V2 刻意没有反向步骤**（"本来就叫新名"与"从旧名改过来的"在同一字段上不可区分 ⇒ 改回去就是猜）⇒ 拒绝',
  downTooHigh.ok === false && downTooHigh.reason === 'STORE_VERSION_MISMATCH', downTooHigh);
eq('validate: 非对象 ⇒ STORE_CORRUPT', migrate.validate(null).reason, 'STORE_CORRUPT');
eq('validate: 缺 parcels 数组 ⇒ STORE_CORRUPT', migrate.validate({ schemaVersion: CUR, customers: [] }).reason, 'STORE_CORRUPT');
eq('validate: 字符串版本号 ⇒ STORE_VERSION_MISMATCH（不许当 1 用）',
  migrate.validate({ schemaVersion: '1', customers: [], parcels: [] }).reason, 'STORE_VERSION_MISMATCH');
eq('validate: 版本号比当前新 ⇒ STORE_VERSION_MISMATCH',
  migrate.validate({ schemaVersion: CUR + 1, customers: [], parcels: [] }).reason, 'STORE_VERSION_MISMATCH');
check('validate: 合法库通过', migrate.validate({ schemaVersion: CUR, customers: [baseCustomer()], parcels: [baseParcel()] }).ok === true, null);

// ── §2 migrate.validateBody：字段强度一条都不许降 ──────────────────────
console.log('§2 字段校验强度');
// 口径说明：v1 的 validate 对 name/pickupCode 这类字段**不做 trim**（空白串按"有长度"放过），
// 脏值由**写入侧** `normalizeText` 先 trim 再撞必填闸 —— 所以"纯空格"要在 §4 的 storage 路径上钉，
// 本段只钉 `''`/`null`/缺字段这三形态。**没有降低强度，也没有顺手加严**（加严属于另立卡）。
const baseline = validateState([baseCustomer()], [baseParcel()]);
check('基线：合法 fixture（1 档案 + 1 记录）过得了校验 —— 下面每个"该红"都跑在它上面',
  baseline.ok === true, baseline);
eq('Customer：id 缺失 ⇒ CUSTOMER_INVALID:id', customerReason('id', undefined), 'CUSTOMER_INVALID:id');
eq('Customer：空称呼 ⇒ CUSTOMER_INVALID:name', customerReason('name', ''), 'CUSTOMER_INVALID:name');
eq('Customer：null 称呼 ⇒ CUSTOMER_INVALID:name', customerReason('name', null), 'CUSTOMER_INVALID:name');
eq('Customer：空楼栋 ⇒ CUSTOMER_INVALID:building', customerReason('building', ''), 'CUSTOMER_INVALID:building');
eq('Customer：空宿舍号 ⇒ CUSTOMER_INVALID:dorm', customerReason('dorm', null), 'CUSTOMER_INVALID:dorm');
eq('Customer：楼栋 21 字 ⇒ 被拒（≤20）', customerReason('building', 'D'.repeat(21)), 'CUSTOMER_INVALID:building');
eq('Customer：note 100 字合法', customerReason('note', 'x'.repeat(100)), undefined);
eq('Customer：note 101 字被拒', customerReason('note', 'x'.repeat(101)), 'CUSTOMER_INVALID:note');
eq('Customer：note 非字符串被拒', customerReason('note', 123), 'CUSTOMER_INVALID:note');
eq('Customer：note 空串合法', customerReason('note', ''), undefined);
eq('Customer：时间戳 0 ⇒ CUSTOMER_INVALID:time', customerReason('createdAt', 0), 'CUSTOMER_INVALID:time');
eq('Customer：deletedAt 非时间戳被拒', customerReason('deletedAt', '昨天'), 'CUSTOMER_INVALID:time');
eq('Customer：deleteBatch 41 字被拒', customerReason('deleteBatch', 'b'.repeat(41)), 'CUSTOMER_INVALID:deleteBatch');
eq('Customer：deleteBatch 缺字段合法（可选）', customerReason('deleteBatch', undefined), undefined);
eq('Parcel：空取件码 ⇒ PARCEL_INVALID:pickupCode', parcelReason('pickupCode', ''), 'PARCEL_INVALID:pickupCode');
eq('Parcel：null 取件码 ⇒ PARCEL_INVALID:pickupCode', parcelReason('pickupCode', null), 'PARCEL_INVALID:pickupCode');
eq('Parcel：取件码 40 字合法', parcelReason('pickupCode', '1'.repeat(40)), undefined);
eq('Parcel：取件码 41 字被拒', parcelReason('pickupCode', '1'.repeat(41)), 'PARCEL_INVALID:pickupCode');
eq('Parcel：站点名 41 字被拒', parcelReason('stationName', 's'.repeat(41)), 'PARCEL_INVALID:stationName');
eq('Parcel：status 不在枚举 ⇒ PARCEL_INVALID:status', parcelReason('status', 'doing'), 'PARCEL_INVALID:status');
eq('Parcel：source=chat 被拒（本期刻意不加该值）', parcelReason('source', 'chat'), 'PARCEL_INVALID:source');
eq('Parcel：customerId 空 ⇒ PARCEL_INVALID:customerId', parcelReason('customerId', ''), 'PARCEL_INVALID:customerId');
eq('Parcel：时间戳非法 ⇒ PARCEL_INVALID:time', parcelReason('updatedAt', 'x'), 'PARCEL_INVALID:time');
eq('Parcel：doneAt 可空', parcelReason('doneAt', null), undefined);
eq('Parcel：deleteBatch 41 字被拒', parcelReason('deleteBatch', 'b'.repeat(41)), 'PARCEL_INVALID:deleteBatch');
eq('Parcel：归属指向不存在的档案 ⇒ PARCEL_CUSTOMER_MISSING', parcelReason('customerId', 'ghost'), 'PARCEL_CUSTOMER_MISSING');
check('Parcel：归属可指向**软删**档案（恢复时记录要能一起回来）',
  validateState([baseCustomer({ deletedAt: 1700000001000 })], [baseParcel()]).ok === true, null);

// chatRoomId 三态（M11 / DESIGN §1 的 [新增] 行）
eq('chatRoomId：缺字段合法（未绑定）', customerReason('chatRoomId', undefined), undefined);
eq('chatRoomId：null 合法', customerReason('chatRoomId', null), undefined);
eq('chatRoomId：空串合法', customerReason('chatRoomId', ''), undefined);
eq('chatRoomId：64 字合法', customerReason('chatRoomId', 'a'.repeat(64)), undefined);
eq('chatRoomId：65 字被拒', customerReason('chatRoomId', 'a'.repeat(65)), 'CUSTOMER_INVALID:chatRoomId');
eq('chatRoomId：含空格被拒', customerReason('chatRoomId', 'room 1'), 'CUSTOMER_INVALID:chatRoomId');
eq('chatRoomId：含标点被拒', customerReason('chatRoomId', 'room.1'), 'CUSTOMER_INVALID:chatRoomId');
eq('chatRoomId：中文数字类型被拒', customerReason('chatRoomId', 7), 'CUSTOMER_INVALID:chatRoomId');
eq('chatRoomId：全角字母被拒（形态只认 ASCII）', customerReason('chatRoomId', 'ｒｏｏｍ'), 'CUSTOMER_INVALID:chatRoomId');
eq('chatRoomId：中划线/下划线合法', customerReason('chatRoomId', 's7Ab9-_C2'), undefined);

// v2 起"必须存在"的三个字段：缺失 = 没走迁移，立刻报，不许当成"没有柜号"放过
const noPickedAt = baseParcel();
delete noPickedAt.pickedAt;
eq('Parcel：pickedAt **字段不存在**被拒', parcelObjectReason(noPickedAt), 'PARCEL_INVALID:pickedAt');
const noLockerNo = baseParcel();
delete noLockerNo.lockerNo;
eq('Parcel：lockerNo **字段不存在**被拒', parcelObjectReason(noLockerNo), 'PARCEL_INVALID:lockerNo');
const noTail = baseParcel();
delete noTail.trackingTail;
eq('Parcel：trackingTail **字段不存在**被拒', parcelObjectReason(noTail), 'PARCEL_INVALID:trackingTail');
eq('Parcel：lockerNo 非字符串（null）被拒', parcelReason('lockerNo', null), 'PARCEL_INVALID:lockerNo');
eq('Parcel：lockerNo 空串合法（= 未知）', parcelReason('lockerNo', ''), undefined);
eq('Parcel：lockerNo 10 字合法', parcelReason('lockerNo', '1234567890'), undefined);
eq('Parcel：lockerNo 长度按 trim 后算 ⇒ 11 字被拒', parcelReason('lockerNo', ' 12345678901 '), 'PARCEL_INVALID:lockerNo');
eq('Parcel：lockerNo 首尾空白 trim 后合法', parcelReason('lockerNo', '   1234567890   '), undefined);
eq('Parcel：trackingTail 非字符串被拒', parcelReason('trackingTail', 12345), 'PARCEL_INVALID:trackingTail');
eq('Parcel：trackingTail 空串合法（= 不适用）', parcelReason('trackingTail', ''), undefined);
eq('Parcel：trackingTail 恰好 5 位数字合法', parcelReason('trackingTail', '12345'), undefined);
eq('Parcel：trackingTail 前后空白可容忍（trim 后判）', parcelReason('trackingTail', '  12345  '), undefined);
eq('Parcel：trackingTail 4 位被拒（位数不对查不出码 = 假线索）', parcelReason('trackingTail', '1234'), 'PARCEL_INVALID:trackingTail');
eq('Parcel：trackingTail 6 位被拒', parcelReason('trackingTail', '123456'), 'PARCEL_INVALID:trackingTail');
eq('Parcel：trackingTail 含字母被拒', parcelReason('trackingTail', '12a45'), 'PARCEL_INVALID:trackingTail');
eq('Parcel：trackingTail **全角数字**被拒（只认 ASCII 位）', parcelReason('trackingTail', '１２３４５'), 'PARCEL_INVALID:trackingTail');
eq('Customer 主键重复 ⇒ CUSTOMER_ID_DUPLICATE', validateState([baseCustomer(), baseCustomer()], []).reason, 'CUSTOMER_ID_DUPLICATE');
eq('Parcel 主键重复 ⇒ PARCEL_ID_DUPLICATE', validateState([baseCustomer()], [baseParcel(), baseParcel()]).reason, 'PARCEL_ID_DUPLICATE');
check('isChatRoomId 由 migrate 单点导出（storage 复用同一份规则，不重抄正则）',
  typeof migrate.isChatRoomId === 'function' && migrate.isChatRoomId('ok_1-2') === true && migrate.isChatRoomId('bad id') === false, null);

// ── §3 reason：文案覆盖与卫生 ──────────────────────────────────────────
console.log('§3 reason');
const CONTRACT_CODES = [
  // ⚠️ `PARCEL_NOT_FOUND` 原先在这里被当契约码断言，但它是**死文案**：实码是 `NOT_FOUND`、
  //   全仓零产生处（24 审查 R-13/R-14）。留着它 = 用一条断言替死码续命，所以**码与断言一起删**。
  'STORE_CORRUPT', 'STORE_VERSION_MISMATCH', 'VALIDATION_FAILED', 'WRITE_FAILED', 'QUOTA_EXCEEDED',
  'NOT_FOUND', 'PARCEL_BATCH_MISSING', 'CUSTOMER_NOT_FOUND',
  'CUSTOMER_ID_DUPLICATE', 'PARCEL_ID_DUPLICATE', 'PARCEL_CUSTOMER_MISSING',
  'ROOM_ID_DISCARDED', 'CUSTOMER_LINE_UNPARSED', 'ZONE_OUT_OF_RANGE', 'ZONE_INVALID', 'BLOCK_INVALID', 'DORM_INVALID',
  'NO_BUILDING', 'NO_DORM',
  'CHAT_UNSUPPORTED', 'CHAT_BIND_FAILED', 'CHAT_BIND_CANCELLED', 'CHAT_ID_UNAVAILABLE', 'CHAT_ID_EMPTY',
  // pick_friend：批 2 的打开链路两个码；后三个是**批 1 的回写补齐**（当时只写了文案与 registry，
  // 漏了这一张"每个契约码都要有非空文案"的对帐表 —— 漏登记 = 缺文案，将来只会以 UNKNOWN 的样子出现）
  'CHAT_OPEN_FAILED', 'CHAT_OPEN_CANCELLED', 'CHAT_MEMBERS_FAILED', 'CHAT_NOT_SINGLE_CHAT', 'BAD_MEMBERS',
  // pick_friend 批 3（换绑）：冲突是**用户可见**的拒绝（文案必须存在，页面不许自己另写一份人话）
  'REBIND_CONFLICT',
  // 2026-09-25 详情页/回收站批：彻底删除是**不可逆**动作，它被拒时给的是"下一步先软删"（用户可见）
  'PURGE_REQUIRES_SOFT_DELETE',
  'OCR_UNAVAILABLE', 'OCR_FAILED', 'OCR_EMPTY', 'VK_UNSUPPORTED', 'VK_INIT_FAILED', 'IMAGE_DECODE_FAILED', 'NO_TEXT',
  'PRIVACY_DENIED', 'PRIVACY_DENIED_CAMERA', 'PRIVACY_ALBUM_DENIED', 'PRIVACY_CAMERA_DENIED',
  'NO_STATION', 'NO_CODE', 'AMBIGUOUS', 'UNKNOWN'
];
let missingText = '';
for (const code of CONTRACT_CODES) {
  if (typeof reason.TEXTS[code] !== 'string' || reason.TEXTS[code] === '') missingText = missingText + code + ' ';
}
check('DESIGN §3 与 migrate 会产生的每个码都有非空文案（缺：' + (missingText || '无') + '）', missingText === '', missingText);
check('被查码数本身够多（防"拿空码表过检"）', CONTRACT_CODES.length >= 35, CONTRACT_CODES.length);
check('R-14：死文案 PARCEL_NOT_FOUND 已删（实码是 NOT_FOUND，留着它只会骗下一个读者）',
  Object.prototype.hasOwnProperty.call(reason.TEXTS, 'PARCEL_NOT_FOUND') === false, Object.keys(reason.TEXTS).length);

const LABEL_FIELDS = ['id', 'name', 'building', 'dorm', 'note', 'chatRoomId', 'createdAt', 'updatedAt', 'time',
  'deletedAt', 'deleteBatch', 'customerId', 'stationName', 'pickupCode', 'status', 'source', 'lockerNo',
  'trackingTail', 'pickedAt', 'picked', 'ids', 'list'];
let missingLabel = '';
for (const field of LABEL_FIELDS) {
  if (typeof reason.FIELD_LABELS[field] !== 'string' || reason.FIELD_LABELS[field] === '') missingLabel = missingLabel + field + ' ';
}
check('字段级码的每个字段都有中文名（缺：' + (missingLabel || '无') + '）', missingLabel === '', missingLabel);
check('未登记字段落到占位（证明上一条不是摆设）',
  reason.fieldLabel('nope').indexOf('未登记的字段') >= 0, reason.fieldLabel('nope'));

const roomHint = reason.reasonText('CUSTOMER_INVALID:chatRoomId');
check('CUSTOMER_INVALID:chatRoomId → 文案指向"会话键"且不落 UNKNOWN（24 卡 R-07：该字段自批 1 起存本地摘要键）',
  roomHint.indexOf('会话键') >= 0 && roomHint.indexOf(reason.TEXTS.UNKNOWN) < 0, roomHint);
const tailHint = reason.reasonText('PARCEL_INVALID:trackingTail');
check('PARCEL_INVALID:trackingTail → 文案指向"运单后五位"', tailHint.indexOf('运单后五位') >= 0, tailHint);
check('PARCEL_INVALID:<未知字段> 不静默变空串', reason.reasonText('PARCEL_INVALID:zzz').length > 0, null);
eq('未登记的码一律落 UNKNOWN', reason.reasonText('SOMETHING_ELSE'), reason.TEXTS.UNKNOWN);
eq('reasonText 接受非字符串（不抛）', reason.reasonText(undefined), reason.TEXTS.UNKNOWN);
check('ROOM_ID_DISCARDED 文案写明"档案已建好"（非致命，不能被当失败）',
  reason.TEXTS.ROOM_ID_DISCARDED.indexOf('已经建好') >= 0, reason.TEXTS.ROOM_ID_DISCARDED);

// R-05：`failureText` 是页面拼"失败提示"的唯一出口，两条分支各有各的事故，各钉一条。
// 变异实验（本次修复批）就是对这两条做的：把 CODE_SHAPE 判据摘掉 ⇒ 下面第一条立刻红。
const validationHint = reason.failureText('VALIDATION_FAILED', 'PARCEL_INVALID:stationName');
check('R-05：detail 是内部码时改用**码自己的文案**，内部码一个字都不上屏',
  validationHint === reason.reasonText('PARCEL_INVALID:stationName')
  && validationHint.indexOf('PARCEL_INVALID') < 0 && validationHint.indexOf('stationName') < 0, validationHint);
const errnoHint = reason.failureText('VK_INIT_FAILED', 'VisionKit 需要相机权限（errno=104），请授权后重试。');
check('R-05：detail 是人话（errno/errMsg 原文）时**保留**作括号后缀，不许被 reasonText 吞成 UNKNOWN',
  errnoHint.indexOf('errno=104') >= 0 && errnoHint.indexOf(reason.TEXTS.UNKNOWN) < 0, errnoHint);
const noDetailHint = reason.failureText('CUSTOMER_NOT_FOUND', undefined);
eq('R-05：没有 detail 时等于 reasonText(reason)（不拖尾括号）', noDetailHint, reason.reasonText('CUSTOMER_NOT_FOUND'));
eq('R-05：两个都拿不到时落 UNKNOWN（不返回空串）', reason.failureText(undefined, ''), reason.TEXTS.UNKNOWN);

let hygieneBad = '';
for (const code of Object.keys(reason.TEXTS)) {
  const text = reason.TEXTS[code];
  if (/[0-9]{4,}/.test(text)) hygieneBad = hygieneBad + code + '(连续数字，疑似回显 D3 值) ';
  if (/DESIGN|SCOPE|RESEARCH|TECH_DEBT|SPEC|§/.test(text)) hygieneBad = hygieneBad + code + '(内部文档编号) ';
  if (/\{\{|\}\}|undefined|\[object/.test(text)) hygieneBad = hygieneBad + code + '(占位符) ';
}
check('全部文案过 D3 与内部编号卫生（问题：' + (hygieneBad || '无') + '）', hygieneBad === '', hygieneBad);
check('卫生检查真的扫过文案（条目数 > 30）', Object.keys(reason.TEXTS).length > 30, Object.keys(reason.TEXTS).length);

// ── §4 storage：M11 三态 + M4 一行切分与自动补名 ───────────────────────
console.log('§4 建档（M4 / M11）');
resetStore();
const goodRoom = storage.createCustomer({ building: 'D4', dorm: '522', name: '小王', note: '', chatRoomId: 's7Ab9-C_1' });
const goodRoomCustomer = fieldOf(goodRoom, 'customer');
const diskCustomersAfterGood = diskList('customers');
check('M11①：合法 chatRoomId 存下且不带提示',
  goodRoom.ok === true && goodRoomCustomer.chatRoomId === 's7Ab9-C_1' && goodRoom.reason === undefined, goodRoom);
check('M11①：值真的落盘（不是只在返回值里）',
  diskCustomersAfterGood.length === 1 && rowAt(diskCustomersAfterGood, 0).chatRoomId === 's7Ab9-C_1', diskCustomersAfterGood);
const badRoom = storage.createCustomer({ building: 'D4', dorm: '522', name: '小李', chatRoomId: 'room 1!' });
const badRoomCustomer = fieldOf(badRoom, 'customer');
const diskCustomersAfterBad = diskList('customers');
check('M11②：非法 chatRoomId ⇒ **建档仍然成功**', badRoom.ok === true && !!badRoomCustomer.id, badRoom);
check('M11②：非法值被丢弃成空串（盘上也没有脏值）',
  badRoomCustomer.chatRoomId === '' && rowAt(diskCustomersAfterBad, 1).chatRoomId === '', rowAt(diskCustomersAfterBad, 1));
eq('M11②：提示码为 ROOM_ID_DISCARDED', badRoom.reason, 'ROOM_ID_DISCARDED');
eq('M11②：丢弃该值后盘上仍是 2 条档案（没被回滚）', diskCustomersAfterBad.length, 2);
const noRoom = storage.createCustomer({ building: 'X3', dorm: '301', name: '小张' });
check('M11③：不传 chatRoomId ⇒ 存空串且无提示',
  noRoom.ok === true && fieldOf(noRoom, 'customer').chatRoomId === '' && noRoom.reason === undefined, noRoom);
eq('M11：三条档案都在盘上', diskList('customers').length, 3);

const splitZone = customerInput.splitCustomerLine('D4-522');
check('M4：`D4-522` 认（带横杠）', splitZone.ok === true && splitZone.building === 'D4' && splitZone.dorm === '522', splitZone);
const splitGlued = customerInput.splitCustomerLine('D4522');
check('M4：`D4522` 认（无横杠，末三位当宿舍号）',
  splitGlued.ok === true && splitGlued.building === 'D4' && splitGlued.dorm === '522', splitGlued);
const splitNamed = customerInput.splitCustomerLine('D4-522 小王');
check('M4：`D4-522 小王` 拆出称呼', splitNamed.ok === true && splitNamed.name === '小王', splitNamed);
const zoneReject = customerInput.splitCustomerLine('E4-522');
check('M4：楼区 ∉ D/X/N/B/C ⇒ ok:false 且**不猜**（三格全空）',
  zoneReject.ok === false && zoneReject.building === '' && zoneReject.name === '', zoneReject);
eq('M4：非枚举楼区的码是 NO_BUILDING（不是 UNKNOWN）', zoneReject.reason, 'NO_BUILDING');
const blockReject = customerInput.splitCustomerLine('D11-522');
check('M4：栋号 11 ⇒ 拒绝（不许静默错解成楼栋 "D11"）', blockReject.ok === false, blockReject);
const dormReject = customerInput.splitCustomerLine('D4-99');
check('M4：宿舍号 99 ⇒ 拒绝且 reason 指向宿舍号', dormReject.ok === false && dormReject.reason === 'NO_DORM', dormReject);

resetStore();
const autoA = customerInput.buildCustomerInput(storage.listCustomers().customers, 'D4-522');
const madeA = storage.createCustomer(autoA);
check('M4：称呼留空 ⇒ 自动补名 "D4 522 A" 并落库',
  autoA.ok === true && autoA.auto === true && madeA.ok === true && madeA.customer.name === 'D4 522 A', madeA.customer);
const autoB = customerInput.buildCustomerInput(storage.listCustomers().customers, 'D4522');
const madeB = storage.createCustomer(autoB);
check('M4：同栋同舍再建一条 ⇒ "D4 522 B"（A→B 连续，靠盘上真实条数）',
  madeB.ok === true && madeB.customer.name === 'D4 522 B', madeB.customer);
eq('M4：自动补名后盘上 2 条', diskList('customers').length, 2);

const refusedBefore = diskBytes();
const refused = storage.createCustomer(customerInput.splitCustomerLine('E4-522 小王'));
check('V4：越界那一行**不建档**（VALIDATION_FAILED + 字段级 detail）',
  refused.ok === false && refused.reason === 'VALIDATION_FAILED' && refused.detail === 'CUSTOMER_INVALID:name', refused);
eq('V4：拒绝路径盘上字节不变', diskBytes(), refusedBefore);
const blankNameBefore = diskBytes();
const blankName = storage.createCustomer({ building: 'D4', dorm: '522', name: '   ' });
check('写入侧先 trim：纯空格称呼被拒（validate 不 trim，靠 normalizeText 收成空串后由必填闸拦下）',
  blankName.ok === false && blankName.reason === 'VALIDATION_FAILED' && blankName.detail === 'CUSTOMER_INVALID:name', blankName);
eq('纯空格称呼没落盘', diskBytes(), blankNameBefore);
const badCodeBefore = diskBytes();
const badParcel = storage.addParcel({ customerId: idIn(madeA, 'customer'), stationName: '菜鸟驿站', pickupCode: '   ', source: 'manual' });
check('Parcel：空取件码被拒且 detail 指向根因',
  badParcel.ok === false && badParcel.reason === 'VALIDATION_FAILED' && badParcel.detail === 'PARCEL_INVALID:pickupCode', badParcel);
eq('Parcel：拒绝路径盘上字节不变', diskBytes(), badCodeBefore);
const parcelsBeforeGoodWrite = diskList('parcels').length;
const goodParcel = storage.addParcel({
  customerId: idIn(madeA, 'customer'), stationName: '菜鸟驿站', pickupCode: '109-2-3003', lockerNo: '5', trackingTail: '', source: 'manual'
});
check('Parcel：合法入参确实写盘（上一条"字节不变"不是因为根本没写过）',
  goodParcel.ok === true && diskList('parcels').length === parcelsBeforeGoodWrite + 1, diskList('parcels').length);
eq('Parcel：柜号原样存下', fieldOf(goodParcel, 'parcel').lockerNo, '5');
const badTailBefore = diskBytes();
const badTail = storage.addParcel({ customerId: idIn(madeA, 'customer'), stationName: '菜鸟驿站', pickupCode: '1', trackingTail: '１２３４５', source: 'manual' });
check('Parcel：全角尾号在写盘路径上也拒（detail=PARCEL_INVALID:trackingTail）',
  badTail.ok === false && badTail.detail === 'PARCEL_INVALID:trackingTail', badTail);
eq('Parcel：全角尾号没落盘', diskBytes(), badTailBefore);
const orphanBefore = diskBytes();
const orphan = storage.addParcel({ customerId: 'ghost', stationName: 'S', pickupCode: '1', source: 'manual' });
check('Parcel：归属不存在 ⇒ CUSTOMER_NOT_FOUND，绝不产生孤儿记录', orphan.ok === false && orphan.reason === 'CUSTOMER_NOT_FOUND', orphan);
eq('Parcel：孤儿拒绝路径盘上字节不变', diskBytes(), orphanBefore);

// ── §4b storage.addParcels：M8「一键全存」的原子性（修 R-10：原先**零断言**）────────
// 为什么必须单独钉：APIS.md 对 `addParcels` 的承诺是"要么全成、要么一条都不建"，而 M12 要求自测覆盖 M8。
// 这条承诺一旦破口，表现正是 R-01 那个 P1（一行空站点 ⇒ 整批失败、提示还不指行）——
// 也就是说：**没有本段，R-01 这类回归上一轮就已经抓不到了**（v1 的 228 条同样没覆盖）。
// 四组各自都要断言**盘上字节**：只断返回值 = 只看被告自述，写了一半也照样"绿"。
console.log('§4b 批量落库 addParcels（M8 原子性）');
resetStore();
const batchOwner = storage.createCustomer({ building: 'D4', dorm: '522', name: '批量客户' });
const batchCustomerId = idIn(batchOwner, 'customer');
check('前置：本段跑在 1 条真档案上（不在空集上刷全绿）', !!batchCustomerId, batchOwner);

// ① 全成
const multiOk = storage.addParcels([
  { customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3001', lockerNo: '3', source: 'manual' },
  { customerId: batchCustomerId, stationName: '驿站-B', pickupCode: '109-2-3002', source: 'ocr' }
]);
const batchRows = diskList('parcels');
check('M8①：两行合法草稿 ⇒ 一次整键写全成（created 与盘上条数同数）',
  multiOk.ok === true && multiOk.created === 2 && batchRows.length === 2, { result: multiOk, onDisk: batchRows.length });
eq('M8①：盘上第 1 行的码是真的（不是只报了个计数）', rowAt(batchRows, 0).pickupCode, '109-2-3001');
eq('M8①：盘上第 2 行的站点是真的', rowAt(batchRows, 1).stationName, '驿站-B');
eq('M8①：柜号缺省 ⇒ 盘上是空串（合法值，不是 undefined 落库）', rowAt(batchRows, 1).lockerNo, '');
check('M8①：两条 id 不撞（同一毫秒建多条 = newId 带随机段的理由）',
  !!rowAt(batchRows, 0).id && rowAt(batchRows, 0).id !== rowAt(batchRows, 1).id, batchRows.map((item) => item.id));
check('M8①：source 按传入值落库（ocr 不会被批量路径写成 manual）',
  rowAt(batchRows, 1).source === 'ocr' && rowAt(batchRows, 0).source === 'manual',
  batchRows.map((item) => item.source));

// ② 归属客户不存在（含软删档案）：一条都不许先进库
const ghostBefore = diskBytes();
const ghostRun = storage.addParcels([
  { customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3003', source: 'manual' },
  { customerId: 'ghost', stationName: '菜鸟驿站', pickupCode: '109-2-3004', source: 'manual' }
]);
check('M8②：任一行归属不存在 ⇒ CUSTOMER_NOT_FOUND',
  ghostRun.ok === false && ghostRun.reason === 'CUSTOMER_NOT_FOUND', ghostRun);
diskUnchanged('M8②：失败时**一个字节都不许变**（第 1 行也不能先进 = 禁止半完成态）', ghostBefore);
const softOwner = storage.createCustomer({ building: 'X3', dorm: '301', name: '会被删的人', chatRoomId: 'softOwnerRoom' });
storage.softDeleteCustomer(idIn(softOwner, 'customer'));
const softBefore = diskBytes();
const softRun = storage.addParcels([{ customerId: idIn(softOwner, 'customer'), stationName: '菜鸟驿站', pickupCode: '1', source: 'manual' }]);
check('M8②：软删档案同样不算归属（不产生"恢复后才看得见"的记录）',
  softRun.ok === false && softRun.reason === 'CUSTOMER_NOT_FOUND', softRun);
diskUnchanged('M8②：软删归属失败后盘上字节不变', softBefore);

// ②b 回收站「全部彻底删除」（2026-09-25 真机反馈批）：这一族此前**一条存储层断言都没有**
//     （上一批只测了"确认词"那种文案级东西）⇒ 把"只删已软删""快件跟着走干净"钉在这里。
//     为什么必须验"快件跟着走干净"：`migrate.validate` 对每条快件查 `knownCustomerIds`，留下悬空引用
//     ⇒ 整库校验失败 ⇒ 连读盘都读不出来（不是少一条记录，是应用不可用）。
const purgeAllOwner = storage.createCustomer({ building: 'E1', dorm: '101', name: '整批删除甲' });
const purgeAllOwner2 = storage.createCustomer({ building: 'E1', dorm: '102', name: '整批删除乙' });
const purgeAllAlive = storage.createCustomer({ building: 'E1', dorm: '103', name: '不许被删的人' });
const purgeAllIds = [
  idIn(purgeAllOwner, 'customer'), idIn(purgeAllOwner2, 'customer'), idIn(purgeAllAlive, 'customer')
];
for (const cid of purgeAllIds) {
  storage.addParcels([{ customerId: cid, stationName: '菜鸟驿站', pickupCode: '9-' + cid.slice(-2), source: 'manual' }]);
}
storage.softDeleteCustomer(purgeAllIds[0]);
storage.softDeleteCustomer(purgeAllIds[1]);
// ⚠️ 用**相对口径**断言：本文件前面的用例已经软删过别的档案（`softOwner` 等），
//    而"全部删除"的定义就是"删掉当时全部已软删" ⇒ 绝对数字会被用例顺序带跑（首跑就是这么红的）。
const softPending = storage.listCustomers({ includeDeleted: true }).customers.filter((c) => c.deletedAt).length;
const purgeAllRun = storage.purgeAllDeleted();
eq('回收站·全部删除：删掉当时全部已软删（含先前用例留下的）', purgeAllRun.purgedCustomers, softPending);
eq('回收站·全部删除：名下快件一起走干净（不留悬空引用）', purgeAllRun.purgedParcels, 2);
const afterPurgeAll = storage.listCustomers({ includeDeleted: true });
eq('回收站·全部删除：未软删的那位**一个字都没被碰**',
  afterPurgeAll.customers.filter((c) => c.id === purgeAllIds[2]).length, 1);
eq('回收站·全部删除：已删的两位真的没了',
  afterPurgeAll.customers.filter((c) => purgeAllIds.indexOf(c.id) >= 0 && purgeAllIds.indexOf(c.id) < 2).length, 0);
eq('回收站·全部删除：快件也没了（含已删件口径）',
  storage.listParcels({ includeDeleted: true }).parcels.filter((p) => purgeAllIds.indexOf(p.customerId) >= 0 && purgeAllIds.indexOf(p.customerId) < 2).length, 0);
const purgeAllAgain = storage.purgeAllDeleted();
eq('回收站·全部删除：回收站空时 ⇒ 0/0 且不报错', String(purgeAllAgain.ok) + '/' + purgeAllAgain.purgedCustomers + '/' + purgeAllAgain.purgedParcels, 'true/0/0');
const validAfterPurge = migrate.validate(storage.loadStore().store);
check('回收站·全部删除之后整库仍通过校验（悬空引用会在这里炸）', validAfterPurge.ok === true, validAfterPurge);


// ③ 空数组 / 非数组：调用方漏判时存储层必须自己挡（页面 saveDrafts 的拦空提示靠它兜底）
const emptyBefore = diskBytes();
const emptyRun = storage.addParcels([]);
check('M8③：空数组 ⇒ VALIDATION_FAILED 且 detail 指向 list',
  emptyRun.ok === false && emptyRun.reason === 'VALIDATION_FAILED' && emptyRun.detail === 'PARCEL_INVALID:list', emptyRun);
eq('M8③：非数组同样拒绝且不抛（null 走同一条早退）', storage.addParcels(null).reason, 'VALIDATION_FAILED');
diskUnchanged('M8③：空入参没写盘', emptyBefore);

// ④ 写盘失败：mock 让 setStorageSync 抛（真机 = 存储不可用 / 配额满）
//    为什么用"换掉 mock"而不是构造脏数据：写盘失败与数据合法性是两件事，
//    用非法数据去测只会测到校验分支（上面①②③已经测过了）。
const writeFailBefore = diskBytes();
const realSetStorage = global.wx.setStorageSync;
global.wx.setStorageSync = (key) => { noteKey(key); throw new Error('setStorageSync:fail storage is unavailable'); };
const writeFailRun = storage.addParcels([{ customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3005', source: 'manual' }]);
global.wx.setStorageSync = realSetStorage;
check('M8④：写盘抛错 ⇒ 原样上抛 WRITE_FAILED（不许当成功返回 created）',
  writeFailRun.ok === false && writeFailRun.reason === 'WRITE_FAILED' && writeFailRun.created === undefined, writeFailRun);
diskUnchanged('M8④：写盘失败后盘上字节不变（内存里改脏没落盘 = 下一次读取仍是旧库）', writeFailBefore);
const quotaBefore = diskBytes();
global.wx.setStorageSync = (key) => { noteKey(key); throw new Error('setStorageSync:fail max size exceed'); };
const quotaRun = storage.addParcels([{ customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3006', source: 'manual' }]);
global.wx.setStorageSync = realSetStorage;
check('M8④：配额满走 QUOTA_EXCEEDED（文案与"写入异常"不同，人要做的动作也不同）',
  quotaRun.ok === false && quotaRun.reason === 'QUOTA_EXCEEDED', quotaRun);
diskUnchanged('M8④：配额满也没写盘', quotaBefore);
check('M8④：mock 已还原，后面的断言仍写得进去',
  storage.addParcels([{ customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3007', source: 'manual' }]).ok === true, null);

// ⑤ R-01 的根因钉：库里 `stationName` 必填 ⇒ 一行空站点 = **整批**失败且一条都不建。
//    页面层"写盘前按行拦空并指名第几件"就是为了让这一条永远轮不到发生（见 pages/recognize saveDrafts）。
const stationlessBefore = diskBytes();
const stationless = storage.addParcels([
  { customerId: batchCustomerId, stationName: '菜鸟驿站', pickupCode: '109-2-3008', source: 'manual' },
  { customerId: batchCustomerId, stationName: '', pickupCode: '109-2-3009', source: 'manual' }
]);
check('R-01：任一行站点为空 ⇒ 整批 VALIDATION_FAILED + detail 指向站点（数据层语义不动）',
  stationless.ok === false && stationless.reason === 'VALIDATION_FAILED' && stationless.detail === 'PARCEL_INVALID:stationName',
  stationless);
diskUnchanged('R-01：空站点那一行不会把**同批其它合法行**带进盘（一条都不建）', stationlessBefore);

// ── §4c parcel-drafts：R-36（修复批新发现）unknown 必须跟着落库值走 ────────
// 现象：`updateDraft` 换了 `stationName` 却不重算 `unknown` ⇒ 人选完取件点，那行的 ❓ 还挂着，
// 且 `summarizeDrafts` 继续把它算成"没判出点"——界面在说一句错话。
// 断言刻意**不走 inferStation**：推理结果不是这里的被测对象，写死草稿才能确定性复现。
console.log('§4c 草稿行状态一致性（R-36）');
const r36Base = [{
  key: 'd0', pickupCode: '109-2-3009', stationName: '', unknown: true, needStation: true,
  lockerNo: '', matched: '', stationRaw: '', customerId: 'c-r36', source: 'ocr'
}];
// ⚠️ 必须用 `STATION_POINTS` 里的**逐字正式名**：`officialStationName` 只做精确匹配（不模糊归一），
// 传「菜鸟驿站」这种半截名字会被判成"不是正式名"而清空 ⇒ 断言就测不到自己要测的东西（首轮就是这么翻的车）。
const r36Picked = parcelDrafts.updateDraft(r36Base, 'd0', { stationName: '南苑菜鸟驿站' });
check('R-36：选完取件点 ⇒ stationName 落正式名且 unknown 转 false',
  r36Picked[0].stationName === '南苑菜鸟驿站' && r36Picked[0].unknown === false, r36Picked[0]);
const r36Cleared = parcelDrafts.updateDraft(r36Picked, 'd0', { stationName: '' });
check('R-36：把取件点清空 ⇒ unknown 回到 true（界面状态与落库值同向）',
  r36Cleared[0].stationName === '' && r36Cleared[0].unknown === true, r36Cleared[0]);
check('R-36：summarizeDrafts 的 unknown 计数跟着走（1→0→1）',
  [r36Base, r36Picked, r36Cleared].map((list) => parcelDrafts.summarizeDrafts(list).unknown).join(',') === '1,0,1',
  [parcelDrafts.summarizeDrafts(r36Base).unknown, parcelDrafts.summarizeDrafts(r36Picked).unknown,
    parcelDrafts.summarizeDrafts(r36Cleared).unknown]);
check('不可变性（与 pickqueue 同口径）：updateDraft 不改入参数组',
  r36Base[0].unknown === true && r36Base[0].stationName === '' && r36Base.length === 1, r36Base[0]);
check('key 不存在 ⇒ 原样返回一份拷贝，不得凭空造出 unknown',
  parcelDrafts.updateDraft(r36Base, 'no-such-key', { stationName: '菜鸟驿站' })[0].unknown === true);

// R2-C06 收口：`unknown`（❓）与 `needStation`（⚠ 存不进去）是**两个不同判据**，
// 都必须由 withFlags 一处算；下面四条各自钉住一种"只在某分支里算"的写法。
check('R2-C06：选完取件点 ⇒ needStation 与 unknown 同向转 false（行内 ⚠ 跟着消失）',
  r36Picked[0].needStation === false && r36Picked[0].unknown === false, r36Picked[0]);
check('R2-C06：清空取件点 ⇒ needStation 回 true（有码没点 = 存不进去）',
  r36Cleared[0].needStation === true && r36Cleared[0].unknown === true, r36Cleared[0]);
// 这一条是"把重算塞进 stationName 分支"的专用探测器：只改码不动站点，标记也必须跟着变
check('R2-C06：只改码（改成空）⇒ needStation 转 false 而 unknown 仍 true（两判据不同源）',
  parcelDrafts.updateDraft(r36Base, 'd0', { pickupCode: '' })[0].needStation === false
    && parcelDrafts.updateDraft(r36Base, 'd0', { pickupCode: '' })[0].unknown === true,
  parcelDrafts.updateDraft(r36Base, 'd0', { pickupCode: '' })[0]);
check('R2-C06：入参形状与 buildDrafts 产出同形（`matched` 是线索词字符串，不是布尔）',
  typeof parcelDrafts.buildDrafts([{ pickupCode: '8-1-3021', stationName: '', segment: '' }])[0].matched === 'string'
    && r36Base[0].matched === '', typeof r36Base[0].matched);

// R2-C05：拦空判据从页面下沉到这里 —— 删掉它自测必须变红（页面里的版本自测够不到）
// ⚠️ 码要挑**不会被推成站点**的形态：`109-2-3009`/`8-1-3021` 这类分段码会走 R14 命中"西苑一栋南面快递中心"
// ⇒ 那行就不是"有码没点"了，断言会测不到自己要测的东西（首轮实测：`findRowsWithoutStation` 返回空）。
const c05Rows = parcelDrafts.buildDrafts([
  { pickupCode: '600000', stationName: '', segment: '' },                  // 有码没点 → 该拦
  { pickupCode: '8-1-3021', stationName: '', segment: '南苑菜鸟驿站' },     // 段落里带正式名 → 放行
  { pickupCode: '', stationName: '', segment: '' }                         // 没码 → 不拦（它本来就不进待存数组）
], { customerId: 'c-c05' });
eq('R2-C05：findRowsWithoutStation 只点名"有码却没点"的行（0 基下标）',
  parcelDrafts.findRowsWithoutStation(c05Rows).join(','), '0');
eq('R2-C05：整批都选好点 ⇒ 返回空数组（不拦人）',
  parcelDrafts.findRowsWithoutStation(parcelDrafts.updateDraft(c05Rows, 'd0', { stationName: '南苑菜鸟驿站' })).join(','), '');
eq('R2-C05：屏上"第 N 件"= 下标 +1（含没码行占的序号，不能按待存数组数）',
  parcelDrafts.findRowsWithoutStation(c05Rows).map((order) => order + 1).join(','), '1');
check('R2-C05：buildDrafts 出的行自带 needStation（WXML 只读布尔，模板里不许有规则）',
  c05Rows[0].needStation === true && c05Rows[1].needStation === false && c05Rows[2].needStation === false,
  c05Rows.map((row) => row.needStation).join(','));

// ── §5 K6：按会话标识归类 ──────────────────────────────────────────────
console.log('§5 归类 K6');
const ROOM_A = 'roomAAA';
const k6List = [
  { id: 'k1', chatRoomId: ROOM_A, deletedAt: null },
  { id: 'k2', chatRoomId: 'roomBBB', deletedAt: null },
  { id: 'k3', chatRoomId: '', deletedAt: null }
];
eq('K6：唯一命中返回**该** id', aggregate.pickCustomerByRoom(k6List, ROOM_A), 'k1');
eq('K6：零命中返回空串（不猜）', aggregate.pickCustomerByRoom(k6List, 'roomCCC'), '');
eq('K6：roomId 空串 ⇒ 空（没依据）', aggregate.pickCustomerByRoom(k6List, ''), '');
eq('K6：roomId 非字符串（undefined）⇒ 空', aggregate.pickCustomerByRoom(k6List, undefined), '');
eq('K6：roomId 是数字 ⇒ 空', aggregate.pickCustomerByRoom(k6List, 1), '');
eq('K6：多命中 ⇒ 空（两人共用一个会话属异常，交人判）',
  aggregate.pickCustomerByRoom(k6List.concat([{ id: 'k4', chatRoomId: ROOM_A, deletedAt: null }]), ROOM_A), '');
eq('K6：软删档案不算命中（删掉的人不该冒出来）',
  aggregate.pickCustomerByRoom([{ id: 'k1', chatRoomId: ROOM_A, deletedAt: 1700000009000 }], ROOM_A), '');
check('K6：入参非数组不抛错',
  aggregate.pickCustomerByRoom(null, ROOM_A) === '' && aggregate.pickCustomerByRoom(undefined, ROOM_A) === '', null);
eq('K6：老数据（无 chatRoomId 字段）不被当命中', aggregate.pickCustomerByRoom([{ id: 'k9', deletedAt: null }], ROOM_A), '');
const boundRoom = storage.createCustomer({ building: 'C1', dorm: '101', name: '小赵', chatRoomId: 'boundRoom1' });
eq('K6×storage：真档案可被会话命中（链路接得上）',
  aggregate.pickCustomerByRoom(storage.listCustomers().customers, 'boundRoom1'), idIn(boundRoom, 'customer'));
eq('K6×storage：未绑定的会话不命中任何档案',
  aggregate.pickCustomerByRoom(storage.listCustomers().customers, 'nopeRoom'), '');
eq('K6×storage：未绑定档案（chatRoomId 空串）不会被空会话误命中',
  aggregate.pickCustomerByRoom(storage.listCustomers().customers, ''), '');

// ── §5b 会话键查重（pick_friend 批 2）─────────────────────────────────
// 为什么单列：M5 的价值全在"同一条会话第二次选择要落回同一条档案"，而它的实现只有一个查询口
// （`storage.findCustomerByChatKey`）—— 这里钉的就是那一个口，页面不许自己 filter（软删会漏）。
console.log('§5b 会话键查重');
resetStore();
const KEY_A = '78de35a10e586ed5';
const keyCustomer = storage.createCustomer({ building: 'D4', dorm: '522', name: '带键客户', chatRoomId: KEY_A });
eq('带键档案建得进来（先证明 fixture 合法，后面的"该红"才说明得了）', keyCustomer.ok, true);
const keyHit = storage.findCustomerByChatKey(KEY_A);
eq('按会话键命中已有档案',
  keyHit.ok === true && keyHit.customer !== null && keyHit.customer.id === idIn(keyCustomer, 'customer'), true);
eq('未登记的键 ⇒ ok 且 customer 为 null（是"没有"，不是失败）',
  storage.findCustomerByChatKey('ffffffffffffffff').customer, null);
eq('空键 ⇒ 直接 ok + null（手动新建这条路不许因为"没有键"报错）',
  storage.findCustomerByChatKey('').ok && storage.findCustomerByChatKey('').customer === null, true);
eq('非字符串键（undefined）⇒ 同样 ok + null，不抛', storage.findCustomerByChatKey(undefined).customer, null);
eq('数字键也不当键（避免 1 命中字符串 "1" 这种隐式转换）', storage.findCustomerByChatKey(1).customer, null);
// 软删的人不该被当成"已建档"：否则删掉档案之后那个人再也建不回来（查重会一直把他挡住）
storage.softDeleteCustomer(idIn(keyCustomer, 'customer'));
eq('软删档案不参与查重（删掉的人还建得回来）', storage.findCustomerByChatKey(KEY_A).customer, null);
check('查重是**只读口**：查了这么多次，那条软删档案仍在库里（没有顺手写盘）',
  listFrom(storage.listCustomers({ includeDeleted: true }), 'customers').length === 1,
  listFrom(storage.listCustomers({ includeDeleted: true }), 'customers').length);

// ── §5c 换绑（pick_friend 批 3 / SCOPE M7）───────────────────────────
// 只钉**一个写入口**（`storage.rebindCustomerChatKey`）：键唯一性、软删口径、幂等、解绑、形态闸
// 全在它一处保证（页面不许自己改 `chatRoomId` ⇒ 库里不会出现两条同键档案只在这条路上守）。
console.log('§5c 换绑');
resetStore();
const KEY_R1 = '1111111111111111';
const KEY_R2 = '2222222222222222';
const rOwner = storage.createCustomer({ building: 'D4', dorm: '522', name: '有键的人', chatRoomId: KEY_R1 });
const rOwnerId = idIn(rOwner, 'customer');
const rOther = storage.createCustomer({ building: 'X3', dorm: '301', name: '没键的人' });
const rOtherId = idIn(rOther, 'customer');
const rKeyOf = (id) => diskList('customers').filter((c) => c.id === id)[0].chatRoomId;

const rBind = storage.rebindCustomerChatKey(rOtherId, KEY_R2);
eq('成功：把新键挂到没键的档案上', rBind.ok, true);
eq('成功：返回值带改后的档案（键确实写进去了）', rBind.customer.chatRoomId, KEY_R2);
eq('成功：按键查得到它（改键 × 查重链路接得上）', storage.findCustomerByChatKey(KEY_R2).customer.id, rOtherId);

const rIdem = storage.rebindCustomerChatKey(rOtherId, KEY_R2);
eq('幂等：自己重绑自己 ⇒ ok（不算冲突）', rIdem.ok, true);
eq('幂等：明确标 unchanged（不写盘，省一次整键覆盖）', rIdem.unchanged, true);
eq('幂等：updatedAt 一个字没动', rIdem.customer.updatedAt, rBind.customer.updatedAt);

const rClash = storage.rebindCustomerChatKey(rOtherId, KEY_R1);
eq('冲突：键属于另一条档案 ⇒ REBIND_CONFLICT（拒绝，不自动合并）', rClash.reason, 'REBIND_CONFLICT');
eq('冲突：带回持有者摘要（页面才好指名；摘要里只有锚，没有键）',
  rClash.holder && (rClash.holder.building + rClash.holder.dorm + rClash.holder.name), 'D4522有键的人');
eq('冲突时**两边都没被改**（拒绝 = 这次什么都没发生）',
  rKeyOf(rOwnerId) + '|' + rKeyOf(rOtherId), KEY_R1 + '|' + KEY_R2);
eq('重绑到自己当前的键 ⇒ 幂等 ok，不报冲突',
  storage.rebindCustomerChatKey(rOwnerId, KEY_R1).unchanged === true, true);
eq('目标不存在 ⇒ NOT_FOUND', storage.rebindCustomerChatKey('c_不存在', KEY_R2).reason, 'NOT_FOUND');
eq('目标已软删 ⇒ 同样 NOT_FOUND（与 getCustomer 同口径；复活走恢复路径，不是靠改键）',
  (() => { storage.softDeleteCustomer(rOwnerId); return storage.rebindCustomerChatKey(rOwnerId, KEY_R2).reason; })(),
  'NOT_FOUND');
// 软删档案**仍然占着键**：否则"删掉的人"手里的键能被转给活人，等那条档案一恢复就两条同键 ⇒ 查重当场二义
const rDeletedHolder = storage.rebindCustomerChatKey(rOtherId, KEY_R1);
eq('软删档案也占着键（复活的二义性宁可在这里被拒）', rDeletedHolder.reason, 'REBIND_CONFLICT');
eq('冲突摘要标明那条已删除（页面才说得清"列表里找不到它"）', rDeletedHolder.holder.deleted, true);

// 解绑与形态闸：换一个干净库，免得上面的软删状态串味
resetStore();
const rUnbind = storage.createCustomer({ building: 'C1', dorm: '101', name: '要解绑的人', chatRoomId: KEY_R1 });
const rUnbindId = idIn(rUnbind, 'customer');
const rDone = storage.rebindCustomerChatKey(rUnbindId, '');
eq('空键 = 解绑（回到"无键、手选归类"态）', rDone.ok === true && rDone.customer.chatRoomId === '', true);
eq('解绑后按旧键查不到它了', storage.findCustomerByChatKey(KEY_R1).customer, null);
const rBad = storage.rebindCustomerChatKey(rUnbindId, 'room 1!');
eq('形态不合法 ⇒ VALIDATION_FAILED（复用 migrate.isChatRoomId，不在这里重抄规则）', rBad.reason, 'VALIDATION_FAILED');
eq('形态不合法：detail 指到具体字段（页面才说得清是哪一项没填对）', rBad.detail, 'CUSTOMER_INVALID:chatRoomId');
check('形态不合法时**没有写盘**（键仍是空串，没被半个值污染）', rKeyOf(rUnbindId) === '', rKeyOf(rUnbindId));

// R-06（24 卡 P2）：非字符串**不是**解绑 —— 把"调用方传错类型"当解绑并回 `ok:true` 是静默数据损失
const rBack = storage.rebindCustomerChatKey(rUnbindId, KEY_R2);
eq('R-06 前置：先给它绑上一个键，好验证"非字符串没把它抹掉"', rBack.ok && rKeyOf(rUnbindId) === KEY_R2, true);
const rUndef = storage.rebindCustomerChatKey(rUnbindId, undefined);
eq('R-06：key 传 undefined ⇒ VALIDATION_FAILED（**不当解绑**）', rUndef.reason, 'VALIDATION_FAILED');
eq('R-06：undefined 的 detail 也指到具体字段', rUndef.detail, 'CUSTOMER_INVALID:chatRoomId');
eq('R-06：undefined **没有改库**（键还在，没被静默抹掉）', rKeyOf(rUnbindId), KEY_R2);
eq('R-06：key 传数字同样 VALIDATION_FAILED', storage.rebindCustomerChatKey(rUnbindId, 7).reason, 'VALIDATION_FAILED');
eq('R-06：key 传 null 同样 VALIDATION_FAILED', storage.rebindCustomerChatKey(rUnbindId, null).reason, 'VALIDATION_FAILED');
eq('R-06：key 传对象同样 VALIDATION_FAILED', storage.rebindCustomerChatKey(rUnbindId, {}).reason, 'VALIDATION_FAILED');
eq('R-06：显式空串**仍然**是解绑（收紧不许把唯一合法的解绑路径也堵掉）',
  (() => { const out = storage.rebindCustomerChatKey(rUnbindId, ''); return out.ok && rKeyOf(rUnbindId) === ''; })(),
  true);

// ── §6 软删与恢复（同批认领）───────────────────────────────────────────
console.log('§6 软删与恢复');
resetStore();
const delCustomer = storage.createCustomer({ building: 'D4', dorm: '522', name: '小王', chatRoomId: 'roomDel' });
const delId = idIn(delCustomer, 'customer');
const soloKill = storage.addParcel({ customerId: delId, stationName: '驿站-A', pickupCode: 'A-1', source: 'manual' });
storage.addParcel({ customerId: delId, stationName: '驿站-B', pickupCode: 'B-1', source: 'manual' });
check('前置：1 档案 + 2 记录在盘上（下面几条不跑在空集上）',
  diskList('customers').length === 1 && diskList('parcels').length === 2, disk());
check('单条软删成功', storage.softDeleteParcel(idIn(soloKill, 'parcel')).ok === true, null);
const delRun = storage.softDeleteCustomer(delId);
eq('删档案连带删除"还活着"的记录（1 条；已单删的不重复计）', delRun.deletedParcels, 1);
eq('普通列表看不到软删档案', listFrom(storage.listCustomers(), 'customers').length, 0);
eq('includeDeleted 仍看得到', listFrom(storage.listCustomers({ includeDeleted: true }), 'customers').length, 1);
eq('getCustomer 对软删档案返回 NOT_FOUND', storage.getCustomer(delId).reason, 'NOT_FOUND');
eq('软删档案不可作为新记录的归属',
  storage.addParcel({ customerId: delId, stationName: 'S', pickupCode: '1', source: 'manual' }).reason, 'CUSTOMER_NOT_FOUND');
const deletedRow = rowAt(listFrom(storage.listCustomers({ includeDeleted: true }), 'customers'), 0);
check('批次标记不是时间戳字符串（同毫秒两次删除会撞车）',
  typeof deletedRow.deleteBatch === 'string' && deletedRow.deleteBatch !== String(deletedRow.deletedAt)
  && /^b_/.test(deletedRow.deleteBatch), deletedRow);
eq('K6：软删档案即使带会话标识也不再被预选', aggregate.pickCustomerByRoom([deletedRow], 'roomDel'), '');
const restoreRun = storage.restoreCustomer(delId);
eq('恢复档案连带恢复 1 条', restoreRun.restoredParcels, 1);
eq('恢复后档案回到普通列表', listFrom(storage.listCustomers(), 'customers').length, 1);
const afterRestore = listFrom(storage.listParcels({ customerId: delId, includeDeleted: true }), 'parcels');
eq('恢复后该档案记录总数 2', afterRestore.length, 2);
check('单独删过的那条仍是删除态（不被连带复活）',
  afterRestore.filter((item) => item.id === idIn(soloKill, 'parcel') && item.deletedAt).length === 1, afterRestore);
const restoredRow = storage.getCustomer(delId);
check('恢复后 deletedAt / deleteBatch 都被清空',
  restoredRow.ok === true && fieldOf(restoredRow, 'customer').deletedAt === null
  && fieldOf(restoredRow, 'customer').deleteBatch === null, restoredRow.customer);
check('恢复后仍可被会话预选（软删只是标记，不是删除）',
  aggregate.pickCustomerByRoom(storage.listCustomers().customers, 'roomDel') === delId, null);

// ── §7 勾选与待办口径（M10）───────────────────────────────────────────
console.log('§7 待办口径与勾选');
resetStore();
const pickedCustomer = storage.createCustomer({ building: 'D4', dorm: '522', name: '小王' });
const pickId = idIn(pickedCustomer, 'customer');
const oneP = storage.addParcel({ customerId: pickId, stationName: '驿站-A', pickupCode: '1-1', source: 'manual' });
const twoP = storage.addParcel({ customerId: pickId, stationName: '驿站-A', pickupCode: '1-2', source: 'manual' });
const onePId = idIn(oneP, 'parcel');
const twoPId = idIn(twoP, 'parcel');
check('前置：1 档案 + 2 记录（本段断言的数据基础）',
  diskList('customers').length === 1 && diskList('parcels').length === 2, disk());
const picked = storage.setParcelPicked(onePId, true);
check('M10：勾选写 pickedAt 时间戳，且 status **仍是 todo**（勾选=已取到，不是已送达）',
  picked.ok === true && fieldOf(picked, 'parcel').status === 'todo' && fieldOf(picked, 'parcel').pickedAt > 0, picked.parcel);
eq('M10：勾上确实落盘', rowAt(diskList('parcels'), 0).pickedAt > 0, true);
eq('待办口径：勾掉的那条不再算待办',
  aggregate.countPendingByCustomer(listFrom(storage.listParcels(), 'parcels'))[pickId], 1);
const unPicked = storage.setParcelPicked(onePId, false);
check('取消勾选清空 pickedAt（状态可退回）',
  unPicked.ok === true && fieldOf(unPicked, 'parcel').pickedAt === null, unPicked.parcel);
eq('取消后待办数回到 2', aggregate.countPendingByCustomer(listFrom(storage.listParcels(), 'parcels'))[pickId], 2);
check('isPending / isPicked 互斥（已取件不进待办）',
  aggregate.isPending(baseParcel({ pickedAt: null })) === true
  && aggregate.isPicked(baseParcel({ pickedAt: 1 })) === true
  && aggregate.isPending(baseParcel({ pickedAt: 1 })) === false
  && aggregate.isPicked(baseParcel({ pickedAt: null })) === false, null);
const built = aggregate.buildPickupList(listFrom(storage.listParcels(), 'parcels'), listFrom(storage.listCustomers(), 'customers'));
eq('清单：同一站点合成一组', listFrom(built, 'todoGroups').length, 1);
eq('清单：组内 2 条', listFrom(rowAt(listFrom(built, 'todoGroups'), 0), 'items').length, 2);
eq('整站待取 id 数 = 2（"整站取完"的输入形状）',
  aggregate.pendingIdsOfStation(listFrom(storage.listParcels(), 'parcels'), '驿站-A').length, 2);
const batchMiss = storage.setParcelsStatus([onePId, 'ghost'], 'done');
check('批量：有 id 不存在 ⇒ 一条都不改且回带 missing',
  batchMiss.ok === false && batchMiss.reason === 'NOT_FOUND' && batchMiss.detail === 'PARCEL_BATCH_MISSING'
  && Array.isArray(batchMiss.missing) && batchMiss.missing.length === 1, batchMiss);
eq('批量失败后盘上 status 未被改动（无半完成态）', rowAt(diskList('parcels'), 0).status, 'todo');
const batchOk = storage.setParcelsPicked([onePId, onePId, twoPId], true);
check('批量勾选：重复 id 只算一次（changed 不虚高）', batchOk.ok === true && batchOk.changed === 2, batchOk);
eq('批量勾选确实落盘', diskList('parcels').filter((item) => item.pickedAt).length, 2);
const allPickedState = aggregate.buildPickupList(listFrom(storage.listParcels(), 'parcels'), listFrom(storage.listCustomers(), 'customers'));
eq('全取走后待取区空、已取件区有 2 条',
  listFrom(allPickedState, 'todoGroups').length + listFrom(allPickedState, 'pickedItems').length, 2);
check('空态判据：待办为空但有已取件记录 ⇒ 不算"什么都没有"',
  aggregate.todoEmptyState(allPickedState).todoEmpty === true && aggregate.todoEmptyState(allPickedState).isEmpty === false,
  aggregate.todoEmptyState(allPickedState));
check('空态判据：真的什么都没有 ⇒ isEmpty 才为 true',
  aggregate.todoEmptyState({ todoGroups: [], pickedItems: [], doneItems: [], archivedItems: [] }).isEmpty === true, null);

// ── §8 版本闸门（storage 侧）───────────────────────────────────────────
console.log('§8 版本闸门');
// ⚠️ "太新的库"必须用**当前版本 +1** 构造：写死 `2` 在 V2 之后就不再是"太新"了（2026-09-26 升版时已踩过）
memory[V2_KEY] = { schemaVersion: migrate.SCHEMA_VERSION + 1, customers: [baseCustomer()], parcels: [] };
eq('装过更新版又回退 ⇒ 读接口报 STORE_VERSION_MISMATCH', storage.listCustomers().reason, 'STORE_VERSION_MISMATCH');
eq('同一状态下写接口也拒绝（不覆盖新数据）', storage.createCustomer({ building: 'D4', dorm: '522', name: 'x' }).reason, 'STORE_VERSION_MISMATCH');
eq('拒绝时盘上的高版本库没被改写', fieldOf(disk(), 'schemaVersion'), migrate.SCHEMA_VERSION + 1);
memory[V2_KEY] = { schemaVersion: 1, customers: 'not-an-array', parcels: [] };
eq('集合不是数组 ⇒ STORE_CORRUPT（不被包成版本码）', storage.listCustomers().reason, 'STORE_CORRUPT');
memory[V2_KEY] = { schemaVersion: 1, customers: [], parcels: [{ id: 'p1' }] };
eq('记录缺必填 ⇒ 读接口把字段级码原样带出', storage.listParcels().reason, 'PARCEL_INVALID:customerId');
resetStore();
const recreated = storage.listCustomers();
check('删键后下一次读取重建当前版本空库（回滚 = 删掉这个键）',
  recreated.ok === true && fieldOf(disk(), 'schemaVersion') === migrate.SCHEMA_VERSION, disk());

// ── §9 红线：v1 的存储键一个字节都没碰 ────────────────────────────────
console.log('§9 存储键隔离');
check('全程 mock 只被问过 v2 键', touchedKeys.every((key) => key === V2_KEY),
  touchedKeys.filter((key) => key !== V2_KEY).join(','));
check('v1 键从未出现在被访问列表里', touchedKeys.indexOf(V1_KEY) < 0, null);
eq('内存 mock 里只有 v2 一个键', Object.keys(memory).join(','), V2_KEY);
check('上面三条不是"零次访问"造成的假绿（访问次数 > 20）', touchedKeys.length > 20, touchedKeys.length);


// ── 汇总 ──────────────────────────────────────────────────────────────
// §10/§11 是异步链上的一环：不 await 就打印总数的话，那几十条**永远不计入读数**（假绿的新形态）。
// ⚠️ R3-02（r3 审查实证）：光靠 `.then()` 链不够 —— 如果某个断言里的 Promise **永远不结算**
// （变异实验 S7：把 `bind` 换成 `new Promise(()=>{})`），链子既不 resolve 也不 reject，
// `printSummary()` 就永远不会被调用，进程带着"没有汇总行"的读数**以退出码 0 结束** ⇒
// 上面那两个 `incomplete` 闸形同虚设（它只在 printSummary 真被调用时才生效），而 `check.ps1` 只看退出码。
// 所以这里加一条**看门狗**：到点没跑完就自己打印判红并 exit 1。
const ASYNC_BUDGET_MS = 20000;
let chainDone = false;
const watchdog = setTimeout(() => {
  if (chainDone) return;
  failed++;
  console.log('  [FAIL] 异步断言链在 ' + ASYNC_BUDGET_MS + ' 毫秒内没有跑完（多半是某个 Promise 永不结算）'
    + ' —— 这不是通过，这是**没测**。');
  printSummary();
  console.log('行为自测未通过。禁止宣布完成。');
  process.exit(1);
}, ASYNC_BUDGET_MS);

// §10/§11b/§11c/§11d 住在 `./selftest-wave5.js`，**§11（录入页零件）住在 `./selftest-wave6.js`**
// —— 拆出去的理由都是"测试文件 ≤1000 行"这条硬上限：wave5 在 2026-09-25 范围扩展批撞线后，
// 把 §11 整体搬进 wave6（与当初 §10/§11 从本文件搬进 wave5 同因）。
// 判定器 `eq`/`check` 由这里传进去 —— **同一个计数器**，否则"断言 N 条"那个读数是假的。
const wave5 = require('./selftest-wave5.js');
const wave6 = require('./selftest-wave6.js');
// §18 识别补丁（`planParsePatch`）—— BUG-04 的机器闸；wave6 已 990 非空行（≤1000 上限），照同一条理由再开一个
const wave7 = require('./selftest-wave7.js');
const wave8 = require('./selftest-wave8.js');   // §28 单条保存入口（第 2 件批 3，2026-09-26；本文件已贴线故另开 wave）
const wave9 = require('./selftest-wave9.js');   // §29 独立迁移审计（TD-003 到期项，队友 migrate-audit 写；本文件已贴线故另开 wave）
// `sheetFlow` = `pages/archive-list/sheet-flow.js`：24 卡修复批（R-01/R-11）抽出来的**页面专用零件**，
// "保存时该用哪个键"因此第一次有了机器闸（页面层本身没有断言能力 —— TD-016）。
const sheetFlow = require('../pages/archive-list/sheet-flow.js');
// `intakeParts` = `pages/recognize/intake-parts.js`：录入页的"落件决议 + 内联建档 + **保存时归类裁决**"。
// §14 需要它（2026-09-25 交互改判：归属改到保存那一刻裁决 ⇒ 规则必须住在可断言的地方）
const intakeParts = require('../pages/recognize/intake-parts.js');
const kit = { eq: eq, check: check, chatTool: chatTool, formParts: formParts, sheetFlow: sheetFlow, intakeParts: intakeParts, storage: storage, reason: reason };

Promise.resolve()
  .then(() => wave5.runChatToolSection(kit))
  .then(() => wave6.runFormPartsSection(kit))
  // §12 站点清单与别名（2026-09-25 用户澄清批）：位置在"会真删 fixture"的 §purge 之前
  .then(() => wave6.runStationListSection(kit))
  // §13 常态屏与文案单源（**交互改判后重写**：常驻入口撤除 ⇒ 旧的三条入口断言作废并重写）
  .then(() => wave6.runIntakeEntrySection(kit))
  // §14 保存时的归类裁决（手选 > 会话键唯一命中 > 当场建档；含落件决议的 stub 写盘断言）
  .then(() => wave6.runSaveGateSection(kit))
  .then(() => wave5.runChatKeyHintSection(kit))
  .then(() => wave5.runSheetFlowSection(kit))
  // 2026-09-25 详情页批：① 左滑/回收站/拆行的纯判据 ② 彻底删除（唯一不可逆写入口，**放最后**：它会真删自己造的 fixture）
  .then(() => wave5.runDeleteFlowSection(kit))
  .then(() => wave5.runPurgeSection(kit))
  // §16 会话键的来源与绑定（2026-09-25 BUG：清单建档丢键）—— **放 §15 之前**：它只用 stub 不写库
  .then(() => wave6.runSessionKeySourceSection(kit))
  // §17 取会话键的跨动线能力（2026-09-25 B 段：清单动线也能取键 + 意图交接）—— 同样不碰库
  .then(() => wave6.runKeyFlowSection(kit))
  // §18 识别补丁（2026-09-26 BUG-04：这个函数此前 0 条断言 ⇒ 缺 require 也能全绿）—— 不碰库
  .then(() => wave7.runParsePatchSection(kit))
  // §19 站点别名新增条（五食堂21栋楼下 → P3，BUG-04 批 3 用户裁决）—— 同样不碰库
  .then(() => wave7.runStationAliasSection(kit))
  // §20 **真机原文**（整屏一整行 + 值在标签前：`111-1-1111`，2026-09-26 09:24 用户截图）—— 不碰库
  .then(() => wave7.runRealOcrSection(kit))
  // §21 运单后 5 位（`取件出示快递单号后五位` 形态，2026-09-26 用户反馈）—— 不碰库
  .then(() => wave7.runTrackingTailSection(kit))
  // §22 送检帧尺寸闸（0×0/1×1 不许冒充"认过了"，2026-09-26 用户实测「那张图次次没文字」）—— 不碰库
  .then(() => wave7.runFrameSizeSection(kit))
  // §23 空白帧判据（覆盖率；同一轮第二读数"送检像素 665×1440"把 §22 的假设否掉之后）—— 不碰库
  .then(() => wave7.runFrameBlankSection(kit))
  // §24 转发卡片（用户裁决 A：只在录入页开、卡片零业务值）—— 不碰库
  .then(() => wave7.runShareSection(kit))
  // §25 送检形态阶梯（用户读数「明暗跨度 255」之后：同一引擎换形态）—— 不碰库
  .then(() => wave7.runSplitDeliverySection(kit))
  // §26 批次合并（第 2 件「一次性多选多录入」批 1：多张图 → 一个列表，key 重编号）—— 不碰库
  .then(() => wave7.runBatchMergeSection(kit))
  // §27 多选批次（批 2：补丁→行 / 逐张原文 / 批次→一屏 / 路径收齐）—— 不碰库
  .then(() => wave7.runBatchFlowSection(kit))
  // §28 单条保存入口（批 3：与「全部保存」同一套拦空 + 行出列表重编号 + 定位失败显式）—— 不碰库
  .then(() => wave8.runRowSaveSection(kit))
  // §29 独立迁移审计（TD-003 到期项：外部真值驱动 + 属性式检查；队友 migrate-audit 写）—— 不碰库
  .then(() => wave9.runMigrateAuditSection(kit))
  // §15 「未归类」占位档案（2026-09-25 裁决 A：改数据形态）—— **放在最后**：它会真写库（客户+件）
  .then(() => wave6.runUnassignedSection(kit))
  .then(() => {
    chainDone = true;
    clearTimeout(watchdog);
    printSummary();
    if (failed > 0 || incomplete) {
      console.log('行为自测未通过。禁止宣布完成。');
      process.exit(1);
    }
    console.log('行为自测通过（本文件与 ./selftest-wave5.js 只覆盖纯函数与页面零件；真机验收另见 25 卡）。');
  });

