// utils/aggregate.js · 纯函数：从原始数据派生视图（不碰存储、不碰 wx.*、不碰页面）
// 为什么独立：排序与筛选规则只允许有一处实现（DESIGN §5），页面只渲染不计算。
// 批 1 只做"每个客户的待办单数"；按站点整合清单在批 4 补齐（DESIGN §3）。
'use strict';

// 分段码判据复用 `utils/stations.js`（2026-09-21）：**同一规则不许有第二份实现**
// （宪法 §2 禁平行新建 + 教训卡 `2026-09-11_规则与样例分叉.md`：两份实现分叉时，样例会赢）。
// 本模块仍然不碰 wx、不碰存储；stations.js 同样是纯函数层，加这条 require 不引入新依赖。
const stations = require('./stations.js');

// 楼区地址（2026-09-22）：`D4` = 楼区 D + 栋号 4。楼区序是**固定数组**（用户裁决 `D X N B C`），
// 不是字母序 —— 字母序会排成 B<C<D<N<X，与本项目的录入面板顺序打架。
const buildings = require('./buildings.js');

// 待办口径（DESIGN §5 + DATA_DICT + 2026-09-17 #4 已取件口径改写）：
// 未删除、未归档、status = todo、**且还没被取走**（pickedAt 为空）
// ⚠️ 口径变更的连带影响（SCOPE M3 四处）：本函数被 countPendingByCustomer（客户卡片徽标）、
// buildPickupList（清单分组）、groupParcelsForCustomer（档案详情分组）复用——改这里等于同时改那三处。
// 不受影响的：countActiveByCustomer（"未删除总数"，删除确认框的 N）——它刻意不看 pickedAt
function isPending(parcel) {
  return !!parcel && parcel.status === 'todo' && !parcel.pickedAt && !parcel.deletedAt && !parcel.archivedAt;
}

// 已取件（第二段）：还在待办状态、但已经被取走 —— 既不属于"待办"，也还没"已送达"
function isPicked(parcel) {
  return !!parcel && parcel.status === 'todo' && !!parcel.pickedAt && !parcel.deletedAt && !parcel.archivedAt;
}

// 返回 { customerId: 待办单数 }
function countPendingByCustomer(parcels) {
  const counts = {};
  for (const parcel of parcels || []) {
    if (!isPending(parcel)) continue;
    counts[parcel.customerId] = (counts[parcel.customerId] || 0) + 1;
  }
  return counts;
}

// 某档案下"还活着"（未删除）的快递记录数——删除确认框要写明"会一起删除 N 条"
function countActiveByCustomer(parcels) {
  const counts = {};
  for (const parcel of parcels || []) {
    if (!parcel || parcel.deletedAt) continue;
    counts[parcel.customerId] = (counts[parcel.customerId] || 0) + 1;
  }
  return counts;
}

// 排序回退键：时间戳可能相等（同一毫秒创建的记录），此时必须再用一个**唯一**字段兜底，
// 否则顺序不确定——UI 会随机变、自测会随机红（2026-09-15 自测抓到，教训卡：时间戳当批次标记）
function byNewestFirst(timeOf) {
  return (a, b) => {
    const diff = timeOf(b) - timeOf(a);
    if (diff !== 0) return diff;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  };
}

// ── 清单待取区的**三类分档**（2026-09-21 顺手化改造；用户 2026-09-21 逐条裁决）────────────────
// 用户原话："注意区分取件码类型，有些是分段，此时直接按取件码本身升序，有时有快递柜 此时按快递柜升序。
// 此外需要新添一种类型叫做需要查明"；档序由用户后来明确为："先排需查明，在排快递柜，然后分段码"。
// 为什么档序是这个顺序：它对应跑站点的**实际动线** —— 先去柜台问（需查明）→ 再绕柜机（快递柜）→ 最后上货架（分段码），
// 一趟走完不折返。改这个顺序 = 改用户的动线，必须问过用户。
const TIER_NEEDS_LOOKUP = 1; // 「需查明」：要用运单后 5 位先去查取件码
const TIER_LOCKER = 2;       // 「快递柜」：纯数字码 + 知道几号柜
const TIER_SEGMENT = 3;      // 「分段码」：`109-2-3003` 这类，第一段就是货架/柜位
const TIER_OTHER = 4;        // 兜底：既无尾号也无柜号，且码形不是分段的（旧数据的混合形态）

// 分段码判据**复用 stations.isSegmentedCode**（含 `-`/`_`/`#`）——不在这里再写一条正则：
// 两处口径一旦分叉，就会出现"清单按柜号排、但柜号面板不认它"这类互相打脸的行为。
// ⚠️ 它是**函数**不是正则常量：用得要像 `isSegmentedCode(code)` 这样调用（写成 `.test()` 会当场抛）
const isSegmentedCode = stations.isSegmentedCode;

/**
 * 某条记录的**档位**（越小越先做）。判据顺序即优先级，不要重排：
 *   ① 有运单后 5 位 → 需查明（**最高优先**：没这个就查不出取件码，到点才知道要问谁）
 *   ② 有柜号且取件码不是分段码 → 快递柜
 *   ③ 取件码是分段码 → 分段码
 *   ④ 其余 → 兜底档
 * @param {{trackingTail?:string,lockerNo?:string,pickupCode?:string}} item
 * @returns {number}
 */
function pickupTier(item) {
  const source = item || {};
  if (typeof source.trackingTail === 'string' && source.trackingTail.trim() !== '') return TIER_NEEDS_LOOKUP;
  const code = typeof source.pickupCode === 'string' ? source.pickupCode : '';
  if (typeof source.lockerNo === 'string' && source.lockerNo.trim() !== '' && !isSegmentedCode(code)) return TIER_LOCKER;
  if (isSegmentedCode(code)) return TIER_SEGMENT;
  return TIER_OTHER;
}

// 取件码里的数字段（`109-2-3003` → [109,2,3003]；`A-1` → [1]；纯数字 → [600000]）
function numericSegments(code) {
  const matches = String(code === undefined || code === null ? '' : code).match(/\d+/g);
  return matches ? matches.map((part) => parseInt(part, 10)) : [];
}

// 逐段比数字：先比第 1 段，相等再比第 2 段……某一方先没段则短的在前（`109` < `109-2`）
function compareSegments(a, b) {
  const left = numericSegments(a);
  const right = numericSegments(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l !== r) return l - r;
  }
  return 0;
}

// 柜号数字（`5号柜` → 5）；认不出数字 → 排在所有认得出的柜号**之后**（宁可放后面让人扫一眼，也不假装是 1 号柜）
function lockerRank(lockerNo) {
  const match = String(lockerNo || '').match(/\d+/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return parseInt(match[0], 10);
}

/**
 * 待取区组内排序（三类分档 → 档内数字升序 → 最终回退键）。
 * ⚠️ 最终必须用**唯一**字段（id）兜底：完全同码同档的两条记录若靠 localeCompare 返回 0，
 *    渲染顺序就随排序实现抖动（既有纪律，见 byNewestFirst 的注释）
 */
function comparePickupItems(a, b) {
  const tierDiff = pickupTier(a) - pickupTier(b);
  if (tierDiff !== 0) return tierDiff;
  const tier = pickupTier(a);
  let inner = 0;
  if (tier === TIER_NEEDS_LOOKUP) {
    inner = compareSegments(a.trackingTail, b.trackingTail);
    if (inner === 0) inner = compareSegments(a.pickupCode, b.pickupCode);
  } else if (tier === TIER_LOCKER) {
    inner = lockerRank(a.lockerNo) - lockerRank(b.lockerNo);
    if (inner === 0) inner = compareSegments(a.pickupCode, b.pickupCode);
  } else {
    inner = compareSegments(a.pickupCode, b.pickupCode);
  }
  if (inner !== 0) return inner;
  const nameDiff = String(a.pickupCode).localeCompare(String(b.pickupCode), 'zh');
  if (nameDiff !== 0) return nameDiff;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// 把某档案的记录拆成三组并排好序（DESIGN §5 的排序规则**只在这里实现一次**）：
// 待办 = createdAt 降序（最新置顶）；已完成 = doneAt 降序；已删除 = deletedAt 降序
function groupParcelsForCustomer(parcels, customerId) {
  const mine = (parcels || []).filter((parcel) => parcel && parcel.customerId === customerId);
  const todo = mine
    .filter((parcel) => isPending(parcel))
    .sort(byNewestFirst((parcel) => parcel.createdAt));
  // 已取件（2026-09-17 #4）：待办框不再含它们，单独一区；组内按**取件时间**降序（最近取的在上）
  const picked = mine
    .filter((parcel) => isPicked(parcel))
    .sort(byNewestFirst((parcel) => parcel.pickedAt));
  const done = mine
    // 已归档不进"已完成"框（DESIGN §5：archivedAt 非空 → 只出现在"已归档"区）
    // 2026-09-16 由 24 卡审查 R-03 抓出：这里原本漏了 !archivedAt，与 buildPickupList 口径相反
    .filter((parcel) => !parcel.deletedAt && !parcel.archivedAt && parcel.status === 'done')
    .sort(byNewestFirst((parcel) => parcel.doneAt || parcel.updatedAt));
  const deleted = mine
    .filter((parcel) => !!parcel.deletedAt)
    .sort(byNewestFirst((parcel) => parcel.deletedAt));
  // 已归档单独成组：R-03 修好"不再混进已完成"之后，详情页必须仍能看到它们，否则归档＝记录消失
  // （2026-09-16 重审 R2-01 抓到的可见性回退）
  const archived = mine
    .filter((parcel) => !parcel.deletedAt && !!parcel.archivedAt)
    .sort(byNewestFirst((parcel) => parcel.archivedAt));
  return { todo, picked, done, deleted, archived };
}

// 取件清单（M4）：待办按站点分组（站点名字典序升序、**组内三类分档后按数字升序**）；
// 已完成统一沉底（doneAt 降序）；已归档（M9）单独一组。排序规则只在这里实现（DESIGN §5）。
// ⚠️ 2026-09-21 口径变更：组内原先"最新置顶（createdAt 降序）"，改为**按取件动线排**
//    （需查明 → 快递柜 → 分段码，档内数字升序）——见 comparePickupItems 的注释。
function buildPickupList(parcels, customers) {
  const nameById = {};
  for (const customer of customers || []) nameById[customer.id] = customer.name;

  const groups = {};
  const pickedItems = [];
  const doneItems = [];
  const archivedItems = [];

  for (const parcel of parcels || []) {
    if (!parcel || parcel.deletedAt) continue;
    const item = {
      id: parcel.id,
      stationName: parcel.stationName,
      pickupCode: parcel.pickupCode,
      // 柜号（v3，2026-09-19）：清单页要在取件码旁显示"去哪个柜"。空串 = 未知 → 页面不渲染
      // （旧记录在迁移时被补成空串，所以这里不会是 undefined；真为 undefined 时下面兜成 ''）
      lockerNo: parcel.lockerNo || '',
      // 运单后 5 位（v4，2026-09-21）：非空 = 这件还没取件码，要先拿这 5 位去查（档 1）
      trackingTail: parcel.trackingTail || '',
      customerName: nameById[parcel.customerId] || '（客户已删除）',
      createdAt: parcel.createdAt,
      pickedAt: parcel.pickedAt || null,
      doneAt: parcel.doneAt || null
    };
    if (parcel.archivedAt) { archivedItems.push(item); continue; }
    if (parcel.status === 'done') { doneItems.push(item); continue; }
    // 已取件（#4）：不进站点待办分组，单独成区（口径见 isPicked；"整站取完"也因此不会连带标掉它们）
    if (parcel.pickedAt) { pickedItems.push(item); continue; }
    if (!groups[parcel.stationName]) groups[parcel.stationName] = [];
    groups[parcel.stationName].push(item);
  }

  const todoGroups = Object.keys(groups)
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((stationName) => ({
      // key 是给 WXML wx:key 用的**字段名**载体（wx:key 只接受字段名，不接受值——24 卡 R-02）
      key: stationName,
      stationName,
      items: groups[stationName].sort(comparePickupItems)
    }));

  // 已取件区（用户 2026-09-21 裁决 U4：站点升序 → 同站点按取件时间降序 → id 回退保证全序）。
  // 为什么按站点而不是纯时间：在这个区里"这是哪个站的"决定要不要顺路去看一眼，比"几分钟前拿的"更有用
  pickedItems.sort((a, b) => {
    const stationDiff = String(a.stationName).localeCompare(String(b.stationName), 'zh');
    if (stationDiff !== 0) return stationDiff;
    return byNewestFirst((item) => item.pickedAt || 0)(a, b);
  });
  doneItems.sort(byNewestFirst((item) => item.doneAt || 0));
  archivedItems.sort(byNewestFirst((item) => item.doneAt || 0));
  return { todoGroups, pickedItems, doneItems, archivedItems };
}

// 某站点下**未取件的待办**记录 id 列表（顺序确定：createdAt 降序 + id 回退）——"整站取完"的确认框与批量操作用它。
// ⚠️ 2026-09-17 #4 口径变更：**已取件的记录不在内**——它们在"已取件"区，不属"还没取"的待办
// 2026-09-19 修复批：本函数只负责"算出该改哪些 id"；真正写盘走 `storage.setParcelsStatus(ids,'done')`
//（一次整键写、要么全成要么全不改）。此前"批量语义留在页面逐条编排"的写法已被 24 审查 R-04 判为半完成态风险，
// 决策见 docs/decisions/DECISION_2026-09-19_整站取完批量写.md
function pendingIdsOfStation(parcels, stationName) {
  return (parcels || [])
    .filter((parcel) => parcel && isPending(parcel) && parcel.stationName === stationName)
    .sort(byNewestFirst((parcel) => parcel.createdAt))
    .map((parcel) => parcel.id);
}

// 待办空态判据（2026-09-19 修复批 M1 · 24 审查 R-01）：两个页面共用同一条规则，且做成可机械钉住的纯函数。
// 为什么必须下沉：这个口径出过**两次同类事故**——2026-09-16 R-06/TD-006 漏了"已归档"，
// 2026-09-17 新增"已取件"分区后又漏了它（每加一个分区就有一处判据要补，靠人记必漏）。
// 规则只有一条：**待办为空、且其余任何分区也为空，才是真的"什么都没有"**。
// 两页的入参形状不同：清单页传 buildPickupList 的结果（无 deletedItems）；档案详情传 groups 的四个分区 + deleted。
// ⚠️ 键名语义（R2-P3-05）：`todoGroups` 在清单页是**组数组**、在档案详情传的是**记录数组**——实现只取 `.length`，
// 所以两者都对；但**键名写错会静默当成空**（判据失效而不报错），传入前请核对键名与本函数的读取清单一致。
function todoEmptyState(list) {
  const source = list || {};
  const todoEmpty = (source.todoGroups || []).length === 0;
  const historyCount = (source.pickedItems || []).length
    + (source.doneItems || []).length
    + (source.archivedItems || []).length
    + (source.deletedItems || []).length;
  const hasHistory = historyCount > 0;
  return { todoEmpty: todoEmpty, hasHistory: hasHistory, isEmpty: todoEmpty && !hasHistory };
}

// ── 客户档案的排序与筛选（2026-09-21 顺手化改造；客户列表页与"客户选择浮层"**共用这一份**）────────
// 用户口径（2026-09-21）："我希望用户档案以楼栋+宿舍号为主要显示" ⇒ 列表与浮层都按**楼栋 → 宿舍号**排，
// 这样"3号楼 502"永远在"10号楼 101"前面（数字序，不是字典序：字典序会把 10 排在 3 前面）。
/**
 * 楼栋/宿舍号的比较器：按**自然数字序**（`3号楼` < `10号楼`），认不出数字的排在认得出的之后
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareLocation(a, b) {
  const left = String(a === undefined || a === null ? '' : a);
  const right = String(b === undefined || b === null ? '' : b);
  // `localeCompare` 的 `numeric:true` 是"按人读数字的方式比"的标准做法（3 < 10）
  // ⚠️ 必须显式给 'zh' 与 numeric：默认比较器会把 '10号楼' 排在 '3号楼' 前（字典序），那是用户看得出来的错
  return left.localeCompare(right, 'zh', { numeric: true, sensitivity: 'base' });
}

/**
 * 楼栋比较：**楼区固定序优先**（2026-09-22 用户裁决 `D X N B C`）。
 * 为什么单独一层而不是改 compareLocation：`compareLocation` 还被宿舍号与站点名用着（沉底区排序），
 * 而"楼区固定序"只该作用于**楼栋**这一列 —— 改它本身会连带改掉别处的次序。
 * 三段判据：① 两边都是楼区楼栋 → 先比楼区序号再比栋号
 *           ② 只有一边是 → 楼区楼栋在前（用户的地址体系里它是"正规写法"）
 *           ③ 都不是 → 落回原来的自然数字序（`3号楼` < `9号楼` < `10号楼`，老数据次序不变）
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareBuilding(a, b) {
  const left = buildings.buildingKey(a);
  const right = buildings.buildingKey(b);
  if (left && right) {
    if (left.zone !== right.zone) return left.zone - right.zone;
    return left.no - right.no;
  }
  if (left) return -1;
  if (right) return 1;
  return compareLocation(a, b);
}

/**
 * 客户档案排序：楼栋（**楼区固定序** → 非楼区自然数字序）→ 宿舍号（自然数字序）→ 姓名 → id 回退
 * @param {Array<{building?:string,dorm?:string,name?:string,id?:string}>} customers
 * @returns {Array} **新数组**（不改入参；与 pickqueue 的不可变口径一致）
 */
function sortCustomers(customers) {
  return (customers || []).slice().sort((a, b) => {
    const left = a || {};
    const right = b || {};
    const byBuilding = compareBuilding(left.building, right.building);
    if (byBuilding !== 0) return byBuilding;
    const byDorm = compareLocation(left.dorm, right.dorm);
    if (byDorm !== 0) return byDorm;
    const byName = String(left.name || '').localeCompare(String(right.name || ''), 'zh');
    if (byName !== 0) return byName;
    if (left.id === right.id) return 0;
    return String(left.id || '') < String(right.id || '') ? -1 : 1;
  });
}

/**
 * 客户档案筛选（"客户选择浮层"的搜索框用）：楼栋/宿舍号/姓名**任一命中**即算命中（不区分大小写）。
 * 为什么三字段都搜：用户在浮层里可能记得"502"也可能记得"小王"，逼他选一种等于白做搜索框。
 * @param {Array<object>} customers
 * @param {string} keyword 空串 = 不过滤（返回全量，**不改入参**）
 * @returns {Array} 新数组
 */
function filterCustomers(customers, keyword) {
  const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : '';
  const list = sortCustomers(customers);
  if (!needle) return list;
  return list.filter((customer) => {
    const item = customer || {};
    return [item.building, item.dorm, item.name].some((field) => (
      String(field === undefined || field === null ? '' : field).toLowerCase().indexOf(needle) >= 0
    ));
  });
}

/**
 * 按单聊会话标识挑客户（DESIGN §2 K6：归类是**纯函数**且**宁可不猜**）
 *
 * 三条规则：① `roomId` 为空或非字符串 ⇒ `''`（没标识就没依据，不参与匹配）
 *           ② 只在**未软删**的档案里找（已删档案随时可能恢复，拿它预选会让"删掉的人"又冒出来）
 *           ③ **唯一**命中才返回 id；**零命中与多命中都返回 `''`**
 * 为什么多命中必须返回空而不是"取第一个"：多人共用一个会话是真实场景（室友同用一个微信号），
 * 取第一个就是**静默把快递记到错的人名下** —— 那种错要到柜台才发现，代价远高于"让人手选"。
 * 调用方拿到 `''` 时的行为：不预选、要求手选（SCOPE M7 / V8），并把命中依据显示出来让人可改。
 * @param {Array<{id?:string,chatRoomId?:string,deletedAt?:number|null}>} customers
 * @param {string} roomId
 * @returns {string} 命中档案的 id；不确定时 `''`
 */
function pickCustomerByRoom(customers, roomId) {
  if (typeof roomId !== 'string' || roomId === '') return '';
  let hit = '';
  let matched = 0;
  for (const customer of customers || []) {
    if (!customer || customer.deletedAt) continue;
    // 只认字符串形态的值：缺字段（老数据没走 createCustomer）与脏值都不能当命中依据
    if (typeof customer.chatRoomId !== 'string' || customer.chatRoomId !== roomId) continue;
    matched++;
    if (matched === 1) hit = typeof customer.id === 'string' ? customer.id : '';
  }
  return matched === 1 ? hit : '';
}

/**
 * 客户标签的**唯一**合成处（单源：录入页选择项 / 查重提示 / 重锚冲突 / 行内换绑 / 换绑目标全用它）。
 *
 * 口径 = `楼栋 宿舍 称呼`，但**空称呼派生名不得把前缀拼第二遍**。为什么需要这一步（2026-09-25 真机缺陷
 * `D4 555 D4 555 A`）：称呼留空建档时，`utils/customer-input.js:nextCustomerName()` 会**自动补名**为
 * `<楼栋> <宿舍> <后缀 A/B/C>`（那条规则是有意设计：清单行只显示称呼，只叫 `A` 认不出人 —— 见该文件
 * Why 与 2026-09-21 用户裁定）⇒ `name` 里**已经带了定位前缀**，这里再无条件拼一次就会重复。
 *
 * 为什么用"前缀包含"判定而不是存档标志：`Customer` 只有 `name` 字段，没有"是否自动补名"的标记
 * （加字段 = 改表结构，须另立卡）；而派生名形态是确定的（`前缀 + 单个后缀`）。
 * ⚠️ 已知残余（TD-022）：建档后若改了楼栋/宿舍，派生名的旧前缀与字段不再一致 ⇒ 该客户标签会重新出现
 *    重复形态；彻底解法要么 `name` 不存前缀 + 清单行拼三字段，要么给 `Customer` 加 `autoNamed`（后者改表结构）。
 *
 * 2026-09-25 从 `pages/recognize/form-parts.js` **提升到本文件**：档案页另有 4 处同款拼法，跨页共用
 * 只能有一个实现（AGENTS §2.2 禁平行新建）⇒ `form-parts` 只 re-export，⛔ 不许再写第二份。
 * @param {{building?:string,dorm?:string,name?:string}} customer 原始档案（未归一化也安全）
 * @returns {string} 给人认的标签（字段缺失时退化为原行为，⛔ 不吐 "undefined"）
 */
function customerLabel(customer) {
  const one = customer || {};
  const building = String(one.building == null ? '' : one.building);
  const dorm = String(one.dorm == null ? '' : one.dorm);
  const name = String(one.name == null ? '' : one.name);
  const prefix = building + ' ' + dorm + ' ';
  // 派生名（如 `D4 555 A`）已以 prefix 开头 ⇒ 原样出；⛔ 别再拼一遍（否则 = 真机缺陷 `D4 555 D4 555 A`）
  return name.indexOf(prefix) === 0 ? name : prefix + name;
}

module.exports = {
  isPending,
  isPicked,
  countPendingByCustomer,
  countActiveByCustomer, // R-04/R-07 修复：删除确认框的 N 必须用它（口径 = 未删除总数，与 softDeleteCustomer 同源）
  groupParcelsForCustomer,
  buildPickupList,
  pendingIdsOfStation,
  todoEmptyState, // 2026-09-19 修复批（24 审查 R-01）：两页共用的待办空态判据
  byNewestFirst,
  compareLocation, // 2026-09-21：楼栋/宿舍号的自然数字序比较器（客户列表与选择浮层共用）
  compareBuilding, // 2026-09-22：**楼栋专用**比较器（楼区固定序 D→X→N→B→C 优先，非楼区落回自然序）
  sortCustomers,   // 2026-09-21：客户档案排序（按楼栋+宿舍号，用户口径"以楼栋+宿舍号为主要显示"）
  filterCustomers, // 2026-09-21：客户档案搜索（楼栋/宿舍号/姓名任一命中）
  pickCustomerByRoom, // 20260923_chat_pick 批 1（K6）：按会话标识归类客户，唯一命中才返回，零/多命中返回 ''
  customerLabel,      // 2026-09-25：客户标签**单源**（从 recognize/form-parts 提升上来；⛔ 别在别处再拼前缀）
  // 2026-09-21 顺手化改造：三类分档（需查明 → 快递柜 → 分段码）
  pickupTier,        // 单条判档（页面用它决定显示哪一种行形态）
  comparePickupItems // 组内排序器（导出给自测与"按同一规则排别的列表"复用）
};
