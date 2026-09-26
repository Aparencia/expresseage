// utils/stations.js · 站点候选（纯函数；契约见 docs/registry/APIS.md §2）
//
// 为什么要有这个文件（2026-09-17 用户裁决方案 A）：
// 站点名长期是"手打 + OCR 预填"，结果是同一驿站被写成好几种名字（`湖工大苑一栋南面7号柜` /
// `湖工大西苑一栋南面7号柜` / `妈妈驿站代收点`），而取件清单**按站点名字符串分组**（aggregate.js:87）
// → 写法一分裂，清单就分成多组，用户要多跑一趟。
// 识别层那条路已证明不收敛（同一函数 8 轮未达标，见 docs/specs/20260917_station_extract/DESIGN.md §7），
// 所以换思路：**站点是有限集合 → 让人点选**。候选不落库、每次从记录派生（不碰数据模型，零迁移风险）。
//
// ⚠️ 本模块只做"候选与相似判断"，**不做模糊归一**（不把两个不同写法自动并成一个）：
// 并错 = 让人跑错驿站，是本项目最贵的一类错（SCOPE W1）。
'use strict';

const MAX_STATION_NAME = 40; // 与 utils/migrate.js 的字段上限同口径，避免产出落不了库的候选

// ⚠️ 事实源是 `docs/STATION_MAP.md` §2。
// 改规则 = 改下面这张表 + 同步改 `tools/selftest-wave6.js` 的 `runStationListSection`（站点清单节）
// + 改 STATION_MAP.md（规则与样例必须同步，教训卡 `2026-09-11_规则与样例分叉.md`：二者分叉时，样例会赢）。
// ⚠️ 位置（2026-09-21）：本表**必须在文件靠前处**定义 —— `BUILTIN_STATIONS` 直接引用它（同一份数据，
//    不许把 P1~P7 这 7 个名字再抄一遍）。定义放在文件下方会让 `const` 进入 TDZ（实测 `ReferenceError`）。
const STATION_POINTS = {
  P1: '西苑顺丰快递（西苑五食堂）',
  P2: '西苑京东快递（西苑五食堂）',
  P3: '西苑一栋南面快递中心',
  P4: '北部菜鸟驿站（北苑一食堂三楼）',
  P5: '西苑菜鸟驿站（西苑五食堂22栋）',
  P6: '南苑菜鸟驿站',
  // P7（2026-09-25 用户澄清新增；此前 6 个点）：用户原话「南面快递中心特指一个，然后是顺丰、京东、
  // 邮政，**三个分开的取件站点**」⇒ **邮政是独立取件点**，不是"快递公司词"（§5-⚠️-2 的旧裁决
  // 把 `邮政` 列在"不参与判定"里，本条的澄清**取代**它）。名字**用户可见**。
  // ✅ **正式名 = `西苑一栋邮政`**：
  //   · 2026-09-25 用户曾定名 `西苑邮政`；
  //   · **2026-09-26 用户改判**（原话：「**命中西 + 邮政 归到西苑一栋邮政**」）⇒ 加上位置，与新增的 P8
  //     `东苑一栋邮政` 对称。**本次改名把 2026-09-25 自己写下的"⛔ 别为旧名加别名"那条判断推翻了**：
  //     旧名 `西苑邮政` **不再被新名包含**（中间多了"一栋"）⇒ 不给别名，旧名与**已落库的旧记录**都会归不到它。
  //     故新增别名 `{alias: '西苑邮政', point: 'P7'}`（别名只给识别/手输归一用，⛔ 不进选择器）。
  // ⚠️ **代价如实记（数据面）**：清单**按站点名字符串分组** ⇒ 库里已存的 `西苑邮政` 件仍会单独成一组、
  //   不与新名合并；要不要把旧记录一次性归一，属**数据写入**（须用户批准），本次未做（见 STATE 未决）。
  P7: '西苑一栋邮政',
  // P8（2026-09-26 **用户指令新增**，正式名逐字用他给的写法）：`东苑一栋邮政`。
  // ⚠️ 与 P7 的**顺序冲突**（本项目最贵的一类错 = 跑错驿站）：这个名字里含"邮政" ⇒ 若让 `R2B`（`邮政`→P7）
  // 先命中，东苑的件会被判成**西苑**那个邮政点。所以 `R2C` 必须排在 `R2B` 之前（断言「§19④⑤」钉死）。
  // ✅ 2026-09-26 用户把 `R2C` 的**命中条件收紧为「东 + 邮政」同时出现**（原话：「**同时命中 东+邮政 就归到
  //    东苑一栋邮政**」）—— 收紧是对的：只写"东苑"不足以断定它是邮政点（东苑将来可能有别的取件点），
  //    那种情况应当**不判**（R15 留空 + ❓ 问人），而不是被抢到 P8。
  P8: '东苑一栋邮政'
};

// 内置站点 = **取件点的正式名**（P1~P7；2026-09-21 用户裁决："只要命中 就选择内置存在的站点（无论识图还是手动输入）"）。
// ⚠️ 这里**引用** `STATION_POINTS` 而不是把名字再抄一遍：抄第二遍就是"规则与样例分叉"的入口
//    （教训卡 `2026-09-11_规则与样例分叉.md`：二者分叉时样例会赢）。改正式名只改 STATION_POINTS 一处。
// 为什么它此前是空数组（历史）：2026-09-17 时用户还没报出这些取件点，SCOPE 假设 A3 说"先留空"。
const BUILTIN_STATIONS = Object.keys(STATION_POINTS).map((id) => STATION_POINTS[id]);

// 别名表（**识别用**；2026-09-25 用户澄清后新增，处置 TD-025）——
// 真机卡片上写的是 `湖工大西苑一栋南面菜鸟驿站`，而取件点的正式名是 `西苑一栋南面快递中心`
// ⇒ 只靠"包含正式名"**永远命不中**（`matchBuiltinStation` 返回 `kind:'none'`），用户看到的永远是
// "没认出内置站点"（TD-025 的实测形态）。
// 三条纪律（缺一条就撞本模块最贵的那类错 —— 跑错驿站，SCOPE W1）：
//   ① **只指向一个点**，且用 **id**（`point:'P3'`）而不是抄正式名 ⇒ 将来改正式名只改 STATION_POINTS 一处；
//   ② 匹配口径 = **归一化后包含**（`canonicalStation` 去掉空白与标点）⇒ 真机那行的 `15:14` 时间戳
//      前缀、以及 OCR 的空格差都挡不住；**只认表里逐字列出的形态**，不做模糊归一；
//   ③ 别名**只给识别/手输的归一化用**，⛔ **绝不进 `listStationPoints()`** —— 那份是"给人选"的清单，
//      混进别名 = 同一个点在选择器里出现两次（断言「别名②」钉住这条）。
// 变体来源（每条都要有出处，⛔ 不许凭空造 —— 教训卡《2026-09-17_没有样本就不扩规则》）：
//   · 第 1 条 = **真机原文**去掉时间戳（`15:14湖工大西苑一栋南面菜鸟驿站`）；
//   · 第 2/4/5 条 = 派单与用户明列的显而易见变体（去 `湖工大` 前缀、`一栋` ↔ `1栋`）；
//   · 第 3 条 = 本文件顶部那段背景里记过的**历史真机写法** `湖工大**苑**一栋南面7号柜`（少一个"西"）。
const STATION_ALIASES = [
  { alias: '湖工大西苑一栋南面菜鸟驿站', point: 'P3' },
  { alias: '西苑一栋南面菜鸟驿站', point: 'P3' },
  { alias: '湖工大苑一栋南面菜鸟驿站', point: 'P3' },
  { alias: '湖工大西苑1栋南面菜鸟驿站', point: 'P3' },
  { alias: '西苑1栋南面菜鸟驿站', point: 'P3' },
  // 第 6 条（2026-09-26 BUG-04 批 · **先改 `docs/STATION_MAP.md` §5.5 再改这里**）：
  // 出处 = 用户真机截图（拼多多·物流服务页，**人工转录**）的站点行 `兔喜快递超市代收点 | 五食堂21栋楼下`
  // + 用户原话「**这个是西苑一栋南面快递中心**」。与既有 `R5`（`21栋` → P3）**同向**：同一行在两条路上
  // 都指向 P3（断言 §19③ 把这条一致性钉住），不会出现"识别说 P3、回填说别处"。
  // ⛔ 只加这一条形态：`兔喜` 是品牌泛称（多处代收点都可能叫），做成别名会把别的兔喜点也吞进 P3。
  { alias: '五食堂21栋楼下', point: 'P3' },
  // 第 7 条（2026-09-26 用户改名 P7 `西苑邮政` → `西苑一栋邮政` 时新增，见 `STATION_POINTS.P7` 的长注释）：
  // 旧名**不再被新名包含**（中间多了"一栋"）⇒ 不给别名，旧名与**已落库的旧记录**都归不到 P7。
  // 这是 2026-09-25 那句"⛔ 别为旧名加别名"的**例外**，例外理由 = 本次是**改名**（不是我给同一个点起第二个名字）。
  { alias: '西苑邮政', point: 'P7' }
];

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 站点候选列表 = 内置正式名（7 个取件点：P1~P7） + 历史记录里用过的站点名（去重）
 * @param {Array<{stationName?:string}>} parcels 记录集合（调用方负责只传未删除的）
 * @param {string[]} [seed] 内置种子表（默认用 BUILTIN_STATIONS；测试可注入）
 * @returns {{name:string,count:number,source:'builtin'|'history'}[]}
 *   排序：count 降序 → 名称字典序（**全序**：同 count 的名字也不会因渲染次序抖动）。
 *   ⚠️ 想"正式名排最前"不要改这里的排序（会破既有断言与全序理由）——用返回的 `source === 'builtin'` 在**渲染层**分组
 */
function listStationOptions(parcels, seed) {
  const builtin = Array.isArray(seed) ? seed : BUILTIN_STATIONS;
  const counts = {};
  const builtinSet = {};

  for (const name of builtin) {
    const key = normalizeName(name);
    if (!key || key.length > MAX_STATION_NAME) continue;
    builtinSet[key] = true;
    if (counts[key] === undefined) counts[key] = 0;
  }
  for (const parcel of parcels || []) {
    const key = normalizeName(parcel && parcel.stationName);
    if (!key || key.length > MAX_STATION_NAME) continue;
    counts[key] = (counts[key] || 0) + 1;
  }

  return Object.keys(counts)
    .map((name) => ({ name: name, count: counts[name], source: builtinSet[name] ? 'builtin' : 'history' }))
    .sort((a, b) => (b.count - a.count) || compareName(a.name, b.name));
}

function compareName(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 找一个"很像但不完全相同"的候选（**只提示，不自动改**——用户裁决 2026-09-17）
 * 返回 `kind` 让页面能说清是哪种情况：`'spacing'`（只差空格）/ `'similar'`（其它相似）
 * @param {string} input 用户手输的站点名
 * @param {Array<{name:string,count?:number}>} [options] 候选列表（畸形项直接跳过，不抛错）
 * @returns {{name:string,count:number,kind:'spacing'|'similar'}|null} 命中时返回**最该提示**的那个候选
 */
function findSimilar(input, options) {
  const value = normalizeName(input);
  if (!value) return null;
  const hits = [];
  for (const option of options || []) {
    // 畸形入参（null / 无 name / 空名）直接跳过：以前会 `option.name` 抛 TypeError（24 审查 R-14），
    // 而"空名候选"一旦漏进来更糟——空串是任何串的子串，会变成假命中
    const name = normalizeName(option && option.name);
    if (!name) continue;
    const kind = similarityKind(value, name);
    // count 必须是数字（R2-P3-01 附）：旧写法 `(option.count) || 0` 会把字符串原样带出去，
    // 与"畸形入参被跳过、不产生脏候选"的宣称不符
    const count = typeof (option && option.count) === 'number' ? option.count : 0;
    if (kind) hits.push({ name: name, count: count, kind: kind });
  }
  if (hits.length === 0) return null;
  // 命中多个时的排序：**只差空格的排最前**（它正是"清单会裂成两组"的那种，最该拦），
  // 其余按使用次数降序 → 名称字典序（全序，渲染稳定）
  hits.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || (b.count - a.count) || compareName(a.name, b.name));
  return { name: hits[0].name, count: hits[0].count, kind: hits[0].kind };
}

function kindRank(kind) {
  return kind === 'spacing' ? 0 : 1;
}

// 相似阈值取值理由（24 审查 R-08：Magic Number 必须解释，否则下一个人不敢动也不敢改）
//   SIMILAR_MIN_SUFFIX = 6：站点名的**区分度集中在尾部**（`…一栋南面7号柜` / `…3号楼`），
//     真实样本里最短的可辨识尾段形如 `栋南面7号柜`（6 字）——取 6 是"刚好够识别同一驿站的不同写法"。
//   SIMILAR_MAX_LEN_DIFF = 4：差异形态就两种——"少一个后缀"或"多写一段前缀"；超过 4 字通常已是另一个叫法。
//   ⚠️ 如实说明：这两个值是**经验值**，没有真实误报/漏报数据集（VERIFY §7 第 3 条同源）。
//   改它们必须同步改 tools/selftest.js 的相似断言与 tools/scenario-walk.js 情景 12。
const SIMILAR_MIN_SUFFIX = 6;
const SIMILAR_MAX_LEN_DIFF = 4;

/**
 * 相似判定：返回**命中类型**而不是布尔（页面文案要区分两种；2026-09-19 修复批 M4 · 24 审查 R-02）
 * ① 逐字完全相同 → null（无需提示）
 * ② 去掉所有空白后相同 → `'spacing'`：**必须提示**。分组键是原字符串（`utils/aggregate.js`），
 *    不提示的话用户以为写法已统一，清单却分成两组、要多跑一趟 —— 这恰是本功能最该拦的场景。
 *    旧实现在这一支 `return false`（静默放过），就是 R-02 的根因。
 * ③ 一方包含另一方 → `'similar'`
 * ④ 公共后缀 ≥ SIMILAR_MIN_SUFFIX 且长度差 ≤ SIMILAR_MAX_LEN_DIFF → `'similar'`
 */
function similarityKind(a, b) {
  if (a === b) return null;
  // 比较用副本去掉所有空白：OCR 常把"3号楼"吐成"3 号楼"，那属于**同一个名字的不同写法**
  //（但 **分组键仍是原字符串** —— 是否合并由人点选决定，SCOPE W1）
  const x = a.replace(/\s+/g, '');
  const y = b.replace(/\s+/g, '');
  if (x === y) return 'spacing';
  if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return 'similar';
  const shared = sharedSuffixLength(x, y);
  if (shared >= SIMILAR_MIN_SUFFIX && Math.abs(x.length - y.length) <= SIMILAR_MAX_LEN_DIFF) return 'similar';
  return null;
}

function sharedSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++;
  return n;
}

// —— 一图多码（2026-09-19 · M2）：线索 → 取件点 ——
//
// 为什么把"猜站点名"改成"6 选 1"（用户 2026-09-19 原话："**我需要知道去哪里找这些快递**"）：
// 产物不是站点字符串，而是**该去哪个取件点**。取件点数量是**封闭的**（用户报了 7 个，
// 这才是本方案能收敛的原因 —— 识别层的字符串归一已证明不收敛（20260917_station_extract/DESIGN.md §7）。
//
// ⚠️ 规则事实源是 `docs/STATION_MAP.md` §2；`STATION_POINTS` 表本身在**文件靠前处**（见上方，被 BUILTIN_STATIONS 引用）。
// A 段：站点文字线索。**自顶向下先命中先赢，顺序即优先级 —— 不要按"看起来更合理"重排**：
//   · R5(`21栋`) 必须排在 R8(`菜鸟`+`五食堂`) 之前，否则样本 #2/#3 会从 P3 漂到 P5；
//   · R7(`22栋`) 若不先命中，`22栋通道菜鸟驿站` 会被 R8 判成 P5 —— 结论相同但**依据**不同，
//     而"依据"要显示给人核对（S1），依据错了人会以为规则对。
//   · R1/R2 放最前是用户明确要求："京东、顺丰只要识别到这两个词就可以锁定（唯一）"（前提：校内各只有一处）。
const STATION_RULES = [
  { id: 'R1', any: ['京东'], point: 'P2' },
  { id: 'R2', any: ['顺丰'], point: 'P1' },
  // R2B（2026-09-25 用户澄清新增）：`邮政` → **P7**，与京东/顺丰同类"出现即锁定"。
  // ⚠️ **必须排在 R3~R12 之前**：邮政点就在"西苑一栋南面"，若被 R4（`西苑一栋`）先命中会判成 P3
  //   （快递中心）⇒ 不仅结论错，**依据**也错（屏上"依据"列是人核对的锚，依据错了人会以为规则对
  //   —— 同 §2 里 R5 排在 R8 前的那条理由）。断言「邮政②」把这条顺序钉死。
  // 代价（与 §5-⚠️-4 同族，如实写）：只要整屏出现"邮政"就锁定 P7，前提是**校内邮政点只有一处**
  //   （用户 2026-09-25 把它与顺丰/京东并列为"三个分开的取件站点"）。
  // 翻案路径：真机出现"邮政 北苑代收点"这类反例 ⇒ 把本行下移到 R12 之后（改一行，同步 STATION_MAP §2）。
  // R2C（2026-09-26 用户指令新增 P8；同日用户把条件**收紧**）：**「东 + 邮政」同时命中** → **P8**。
  // ⚠️ **必须排在 R2B 之前**：P8 的正式名里含"邮政"，被 `R2B`（`邮政`→P7）先命中就判成**西苑**那个邮政点
  //   ⇒ 人与件跑错驿站（本项目最贵的一类错）。与"`R2B` 必须排在 `R4` 之前"是同一条纪律，断言「§19⑤」钉死。
  // ⚠️ 收紧的理由（用户原话「同时命中 东+邮政 就归到东苑一栋邮政」）：只写"东苑"不足以断定它是邮政点 ⇒
  //   那种文本应当**不判**（R15 留空 + ❓ 问人），而不是被抢到 P8。断言「§19⑥」钉住这一侧。
  { id: 'R2C', all: ['东苑'], any: ['邮政'], point: 'P8' },
  { id: 'R2B', any: ['邮政'], point: 'P7' },
  { id: 'R3', any: ['妈妈驿站'], point: 'P3' },
  { id: 'R4', any: ['西苑一栋'], point: 'P3' },
  { id: 'R5', any: ['21栋'], point: 'P3' },
  { id: 'R6', any: ['快递中心'], point: 'P3' },
  { id: 'R7', any: ['22栋'], point: 'P5' },
  { id: 'R8', all: ['菜鸟'], any: ['西苑', '五食堂'], point: 'P5' },
  { id: 'R9', all: ['菜鸟'], any: ['北苑', '北部', '一食堂', '三楼'], point: 'P4' },
  { id: 'R10', all: ['菜鸟'], any: ['南苑'], point: 'P6' },
  { id: 'R11', any: ['北苑', '北部', '一食堂'], point: 'P4' },
  { id: 'R12', any: ['南苑', '南区'], point: 'P6' }
];

// B 段：码形兜底 —— **只在 A 段全不命中时启用**，不是同级。
// 为什么必须降级：样本 #1 站点行写 `22栋通道菜鸟驿站`、码却是分段码 `23-5-3009`；同权会自相矛盾（P5 ↔ P3）。
// 用户原话："快递码具有其对应特点 比如几号柜 、xxx-x-xxxx,都是西苑快递中心的"。
const SEGMENT_CODE = /^\d{1,3}(-\d{1,4}){1,2}$/; // 分段码（`23-5-3009`）；纯 6 位连数**不在**此列（归属未知，走 R15）

/**
 * 线索 → 取件点（纯函数；一图多码 M2）
 * @param {string} text 识别原文片段（整屏或该条附近的一段；非字符串按空处理）
 * @param {string} [code] 该条的取件码（**只给 B 段码形兜底用**，可缺省）
 * @returns {{stationName:string,ruleId:string,matched:string}}
 *   `stationName`：取件点正式名之一（P1~P7）；**未命中时是空串**（页面显示"❓需问客户"，绝不猜点 —— 猜错 = 跑错驿站）
 *   `ruleId`：命中的规则号（`R1`…`R14`）或 `R15`（未命中）
 *   `matched`：命中的线索词（多个用 `+` 连）；页面"依据"列与人工核对都用它
 */
function inferStation(text, code) {
  // 空白不敏感：OCR 常把 `21栋` 吐成 `21 栋`（与 findSimilar 同口径）
  const body = typeof text === 'string' ? text.replace(/\s+/g, '') : '';
  const codeText = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
  const hit = matchStationRules(body) || matchCodeShapeRules(body, codeText);
  if (!hit) return { stationName: '', ruleId: 'R15', matched: '' };
  return { stationName: STATION_POINTS[hit.point] || '', ruleId: hit.id, matched: hit.matched };
}

function matchStationRules(body) {
  if (!body) return null;
  for (const rule of STATION_RULES) {
    const tokens = hitTokens(body, rule);
    if (tokens) return { id: rule.id, point: rule.point, matched: tokens.join('+') };
  }
  return null;
}

/** 返回命中的词（`all` 全中 + `any` 中一个）；不命中返回 null */
function hitTokens(body, rule) {
  const all = rule.all || [];
  for (const token of all) {
    if (body.indexOf(token) < 0) return null;
  }
  const any = rule.any || [];
  for (const token of any) {
    if (body.indexOf(token) >= 0) return all.concat([token]);
  }
  return any.length === 0 ? all : null;
}

function matchCodeShapeRules(body, codeText) {
  // R13：柜号 —— 落在**站点/码所在的那一行**上（`五食堂21栋楼下` / `5号柜 | 取件码 …`）。
  // （原实现还查了 `codeText`，那**不可达**：`firstCodeAfterLabel` 已把"标签后紧跟的柜号"剥掉，
  //   取件码里不会再剩"号柜"；24 审查 R-12 指出该分支与它给的理由都不成立 → 已删，只留可达的这一支。
  //   `codeText` 形参保留：R14 仍用它判码形，且签名已在 `APIS.md` 登记 —— 改签名要同步契约）
  if (body.indexOf('号柜') >= 0) return { id: 'R13', point: 'P3', matched: '号柜' };
  // R14：分段码 —— 只看码本身（**不看整段原文**，否则站点行里的其他数字会误触发）
  if (SEGMENT_CODE.test(codeText)) return { id: 'R14', point: 'P3', matched: '分段码' };
  return null;
}

/**
 * 取件点的**正式名清单**（落库/分组/候选点选三处共用同一份，按 P1…P7 顺序 —— 顺序稳定，渲染不抖）
 * ⚠️ 这里**只出正式名**：别名（`STATION_ALIASES`）是识别用的，混进来会让同一个点在选择器里出现两次
 * @returns {string[]}
 */
function listStationPoints() {
  return Object.keys(STATION_POINTS).map((id) => STATION_POINTS[id]);
}

/**
 * 柜号清单（2026-09-19 用户裁决："**内置柜台 1-8**，然后用与站点一样的方式，**仅在非分段码进行**"）
 *
 * 为什么**封闭成 1~8**（而不是自由提取 `N号柜`）：自由提取得靠"数字前不能是汉字"来排除门牌
 * （`湖工大西苑一栋南门面8号柜` 的 `8号柜`），结果把 `请到5号柜取件` 这种**真柜号**也一起拒了
 * （24 审查 **R-01** 实测 17 例）。封闭集合 + 只从**非站点行**取（见 `utils/parse.js`）两个问题一起消失。
 * **只在非分段码上用**：分段码（`109-2-3003`）的第一段本身就是"货架/柜"信息（清单分组的键），
 * 再叠一层柜号语义会打架。值域 = 这 8 个之一或空串；**不做模糊归一**（与站点同纪律：并错 = 跑错柜）。
 */
const LOCKER_OPTIONS = ['1号柜', '2号柜', '3号柜', '4号柜', '5号柜', '6号柜', '7号柜', '8号柜'];

/** 柜号清单（按 1→6，顺序稳定） @returns {string[]} */
function listLockerOptions() {
  return LOCKER_OPTIONS.slice();
}

/**
 * 是不是"分段码"（`109-2-3003` / `8-2-3021` 这类带 `-`/`_`/`#` 的）—— 柜号只对**非分段码**有意义
 * @param {string} code
 * @returns {boolean}
 */
function isSegmentedCode(code) {
  return typeof code === 'string' && /[-_#]/.test(code);
}

// 去空白与标点后再比：OCR 与手打最常见的差异就是空格（`5 号柜` / `西苑 一栋`），标点次之。
// 只去掉**不影响语义**的字符（空白与中英标点），不删汉字 —— 删汉字就成了模糊归一（本模块明确不做）
function canonicalStation(value) {
  return normalizeName(value).replace(/[\s·、,，.。;；:：/\\|()（）\[\]【】\-—_]+/g, '');
}

/**
 * 归一化到**内置正式名**（2026-09-21 用户裁决："只要命中 就选择内置存在的站点（无论识图还是手动输入）；
 * 若无命中，则允许自创建"）。
 *
 * 判定**三步，从严到宽**（用户 2026-09-21 选 A：严格口径）：
 *   ① 一字不差
 *   ② 去空白与标点后一字不差（`西苑 一栋南面快递中心` → 正式名）
 *   ②b **别名表命中**（2026-09-25 新增；`kind:'alias'`）——真机/OCR 写的是驿站俗称
 *       （`湖工大西苑一栋南面菜鸟驿站`）而正式名是取件点名 ⇒ 用 `STATION_ALIASES` 收敛。
 *       多个别名指向**不同点**，或"别名命中"与"输入里出现的正式名"**冲突** ⇒ `ambiguous` 不自动改。
 *   ③ 输入**包含且仅包含一个**正式名（`西苑一栋南面快递中心8号柜` → `西苑一栋南面快递中心`）
 * 若输入同时包含**多个**正式名 → 判 `ambiguous` **不自动改**：那通常是一屏多点的拼接文本，
 * 猜错 = 让人跑错驿站（本项目最贵的一类错，SCOPE W1）。
 *
 * ⚠️ `菜鸟`/`西苑`/`顺丰` 等是 **A 段线索词**（`STATION_RULES` 用来推断取件点），**不是站名**：
 *    光输它们属于"未命中"→ 允许用户自建（用户明确选了严格口径）。
 * ⚠️ 与 `findSimilar` 的分工：那个管"两种**自建**写法之间的相似"（只提示不自动改）；
 *    本函数管"收敛到正式名"。命中正式名后页面**不要再显示相似提示**，否则同一行两个提示打架。
 *
 * @param {string} input 用户手输或识别预填的站点名
 * @param {string[]} [seed] 正式名清单（默认 P1~P7 这 7 个取件点；测试可注入）
 * @returns {{ok:boolean, stationName:string, kind:'exact'|'canonical'|'alias'|'contains'|'ambiguous'|'none'}}
 *   `ok:true` 时 `stationName` 是**正式名**；`ok:false` 时 `stationName` 恒为 `''`（调用方用原文，不要用这个空值覆盖输入）
 */
function matchBuiltinStation(input, seed) {
  const raw = normalizeName(input);
  const points = Array.isArray(seed) ? seed : BUILTIN_STATIONS;
  if (!raw) return { ok: false, stationName: '', kind: 'none' };

  // ① 一字不差
  if (points.indexOf(raw) >= 0) return { ok: true, stationName: raw, kind: 'exact' };

  // ② 去空白与标点后一字不差
  const canonicalInput = canonicalStation(raw);
  for (const name of points) {
    if (canonicalInput && canonicalStation(name) === canonicalInput) {
      return { ok: true, stationName: name, kind: 'canonical' };
    }
  }

  // ②b 别名（2026-09-25 新增，处置 TD-025）：真机/OCR 写俗称、正式名是取件点名 ⇒ 用别名表收敛。
  //     ⚠️ 位置必须在 ③ 之前：这样"别名命中 + 输入里另有正式名"的**冲突**能被判出来（不猜），
  //        而不是被 ③ 抢先按正式名定案（一屏多点拼接时那正是"跑错驿站"的入口，SCOPE W1）。
  const aliasTargets = [];
  for (const item of STATION_ALIASES) {
    const key = canonicalStation(item.alias);
    if (!key || canonicalInput.indexOf(key) < 0) continue;
    const target = STATION_POINTS[item.point] || '';
    // 目标必须在本次的 `points` 里（调用方注入自定义 seed 时，别名不越权产出列表外的名字）
    if (target && points.indexOf(target) >= 0 && aliasTargets.indexOf(target) < 0) aliasTargets.push(target);
  }
  if (aliasTargets.length > 1) return { ok: false, stationName: '', kind: 'ambiguous' };
  if (aliasTargets.length === 1) {
    const conflict = points.filter((name) => raw.indexOf(name) >= 0 && name !== aliasTargets[0]);
    if (conflict.length > 0) return { ok: false, stationName: '', kind: 'ambiguous' };
    return { ok: true, stationName: aliasTargets[0], kind: 'alias' };
  }

  // ③ 输入包含且仅包含一个正式名
  const contained = points.filter((name) => raw.indexOf(name) >= 0);
  if (contained.length === 1) return { ok: true, stationName: contained[0], kind: 'contains' };
  if (contained.length > 1) return { ok: false, stationName: '', kind: 'ambiguous' };

  return { ok: false, stationName: '', kind: 'none' };
}

// 不直接导出 BUILTIN_STATIONS（24 审查 R-13：导出但全仓零消费 = 死代码）。
// 它现在等于 `listStationPoints()` 的同一份数据；调用方要注入别的种子走带 `seed` 参数的函数
module.exports = {
  listStationOptions,
  findSimilar,
  inferStation,
  listStationPoints,
  listLockerOptions,
  isSegmentedCode,
  matchBuiltinStation // 2026-09-21 顺手化改造：站点名规范化（命中正式名 / 未命中允许自建）
};
