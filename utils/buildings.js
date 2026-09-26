// utils/buildings.js · 校内楼区地址 `D4-522` 的解析 / 拼装 / 排序键（纯函数，零依赖）
//
// ── 为什么需要这个模块（事实源：docs/specs/20260922_zone_address/SCOPE.md，用户 2026-09-22 裁决）──
// 用户原话：「DXNBC 是五个楼区类型 D x N B C 应该需要支持输入小写，最终显示大写的能力」，并定下新形态
// `D4-522`：`D` = 楼区、`4` = 栋号、`522` = 宿舍号。它与既有 `3号楼/3栋/3幢/3舍/3座` 写法**并存**
// （老数据零迁移），但 `utils/customer-input.js` 的正则只认"数字或中文数字 + 量词"，**不认字母楼区**；
// 且它的"有空格分支"从不校验第 1 段（该分支在 `utils/customer-input.js` 的 `splitCustomerLine` 内）。
// ⚠️ **不要在此写别的文件的行号** —— 本文件初版写了 `:37-45`，同一个改动里就因新增代码而漂移，
// 被独立审查 r2 记 P3-02、r3 复核时发现**我在 `:8` 写明不要写行号、却在 `:25` 又写了一个**。
// 引位置请引**函数名**或**符号名**（跨文件引用行号 = 一定会过期的事实）。
// 所以新形态必须自成一处解析规则，而不是往老正则里塞分支。
// 三个消费点（客户页录入 / `customer-input.js` / `aggregate.js` 排序）**共用本文件**：
// 各写一份 = 三份会漂移的地址口径（本项目已吃过"同一契约两份实现"的亏，见 tools/check.js:300 的 11 条特征行）。
//
// ── 为什么零耦合于 `utils/stations.js`（用户裁决 6 原话）─────────────────────────
// 「注意区分两个：一个是快递站点，一个是用户档案」。快递站点是**取件点**（西苑/东苑/…），楼区是
// **客户档案里的住址**，两者之间没有任何有依据的映射（SCOPE §6 的 W3/W5 明确禁止猜）。
// 一旦这里 import 了站点词表，下一次"站点名归一化"就会顺手改到用户档案的地址——正是用户要求分开的那件事。
// 故本文件**不 require 项目内任何模块**（SCOPE §3.1 的依赖方向是单向的：它是最底层，被别人依赖）。
//
// ── 为什么楼区顺序是固定数组而不是字母序（用户裁决 2 原话）─────────────────────────
// 「坑 1 直接固定 DXNBC 的顺序」。字母序会排成 B C D N X，与用户在校内的实际习惯顺序不符。
// 更关键的是：**排序权重与录入面板的显示顺序必须同源**——两处各写一份顺序，就是两份会静默漂移的事实。
// `ZONES` 因此既是排序权重、也是面板显示顺序，且**只有这一处**。
//
// ── 为什么必须做三道值域闸（SCOPE §2.2 的实测根因）───────────────────────────────
// `customer-input.js:37-45` 的"有空格分支"不校验第 1 段：`D4-522 小王` 现在被**静默错解**成
// `building='D4-522'` / `dorm='小王'` / `name=''`，再被自动补名成 `D4-522 小王 A`——不报错、
// **看起来像对的**，而排序与查重从此全错。三道闸（楼区 ∈ ZONES、栋号 1~10、宿舍号 ≥100）是同一个动作：
// 只加楼区、不校验栋号与宿舍号，等于给会错解的输入多开一个入口。
//
// ⚠️ 两处 `zone` 的含义**不同**，签名已冻结，别互相代入：
//   · `parseRoomLine().zone` = 楼区**字母**（`'D'`）
//   · `buildingKey().zone`   = `ZONES` 的**下标**（`0`）
'use strict';

const ZONES = ['D', 'X', 'N', 'B', 'C']; // 顺序即固定顺序，也是录入面板显示顺序（见文件头）
const BUILDING_MAX = 10;                 // 栋号 1~10（用户原话「楼栋最高为 10」）
const DORM_MIN = 100;                    // 宿舍号下界（用户原话「宿舍号从 100 开始」）
const ZONE_LABELS = { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' };

// 与 `utils/migrate.js:118-120` 的 `isNonEmptyString(x, 20)` 同口径：超过 20 的值**落不了库**，
// 在这里先拦住比让存储层拒绝更早、更能指向根因。刻意重抄常量而不 require customer-input.js——
// 它是被依赖的底座，底座反向依赖上层就会成环（SCOPE §3.1）。
const MAX_FIELD = 20;
const MAX_NAME = 20;

// 横杠变体：中文输入法与聊天转发会产出全角 `－`、破折号 `—`、连字号 `–`、减号 `−`。
// 它们对用户是"同一个东西"，认不出的后果是同一间房被录成两种写法。
const DASHES = ['-', '\u2014', '\u2013', '\uff0d', '\u2212'];
// 分隔符**可省可多**：`D4-522` / `D4 522` / `D4--522` 都是同一间房。
// ⚠️ JS 的 `\s` 本身就含 `\u3000`（全角空格）与 `\u00a0`，故"全角空格当普通空格"无需额外替换。
const SEP = '(?:[\\s' + DASHES.join('') + '])*';
// "至少一个分隔符"（注意不能用 `SEP + '+'`：`SEP` 自带 `*`，拼起来是非法量词 `*+`，实测直接 SyntaxError）
const SEP_REQUIRED = '(?:[\\s' + DASHES.join('') + '])+';
// 尾部标点：用户从聊天里复制整句时带来的句号、逗号（`D4-522。`）。**必须先剥再拆**——
// 否则 `d4-522-3` 里多出来的 `-3` 会被当成姓名（原型实测缺陷，SCOPE §2.3）。
const TAIL_PUNCT = /[\s。，,、.；;！!？?~～]+$/;
// 楼区字母 + 栋号(1~2位，让 `10` 打得进去) + 可选量词(必须吞掉 `号楼`) + **至少一个分隔符** + 宿舍号 + 余下(姓名)
// 两步解析（**顺序不可换**），两个正则各自只管一种形态，互不抢匹配：
//  ① `ROOM_LINE_SEP`：有分隔符 —— `D4-522` / `D4 522` / `D4--522`（分隔符**至少一个**）
//  ② `ROOM_LINE_GLUED`：无分隔符 —— `D3520` → 楼栋 `D3` + 宿舍 `520`
//
// ⚠️ 为什么不能合成一个正则（实测踩了四次，记下来免得再试）：
//   · 若"有分隔符"支放宽成 `SEP*`（零宽可匹配），它会抢先吃下无分隔符形态：
//     `D3520` → `[D][35][][2][0]`（栋号 35 撞闸被拒，但 match 已成立 ⇒ 第二步轮不到）；
//     `D10522` → `[D][1][][0522]` ⇒ 落成 `D1`/`0522`（**静默写错数据**，比拒绝更糟）。
//   · 用 lookahead `(?=[0-9]{3,}\1)` 想一次搞定也不行：`\1` 出现在它所属捕获组**内部**属
//     "前向引用"，JS 会把它当**八进制转义**而不是回溯引用 ⇒ `D3520` 直接 NO MATCH（实测）。
//   ⇒ 老老实实两步。第一步要求"至少一个分隔符"，第二步只认"粘连"，两者天然互斥。
//
// ⚠️ 无分隔符那条的切点用**用户给的规则**（2026-09-22 原话："`D3520` 自动在以后**三位**进行切分与填表"）：
//    **末 3 位 = 宿舍号**，前面 1~2 位 = 栋号。为什么不按"尽量少占栋号"的惰性切法：
//    实测 `D10522` 在惰性切法下得到 `栋 1 + 宿舍 0522`（→ 归一成 `D1`/`522` 也**合法**），
//    与用户想要的 `D10`/`522` **不同**；两种切法都过三道闸 ⇒ 必须由规则定序，不能靠正则贪/惰。
//    "末 3 位"这条规则同时解释了 `D3520`→`3`+`520` 与 `D1520`→`1`+`520`。
//    位数不足 4 位（栋号至少 1 位 + 宿舍 3 位）的一律不认 → 交回调用方。
const ROOM_LINE_GLUED = /^([A-Za-z])([0-9]{2,})(.*)$/;
const GLUED_DORM_LEN = 3;
// ① 有分隔符形态：`D4-522` / `D4 522` / `D4--522`（**分隔符至少一个**，见上方"为什么不能合成一个正则"）
const ROOM_LINE_SEP = new RegExp('^([A-Za-z])' + SEP + '([0-9]{1,2})' + SEP_REQUIRED + '([0-9]+)(.*)$');

/**
 * 粘连形态切分：`D3520` → `{zone:'D', block:'3', dorm:'520', rest:''}`；切不出 → `null`。
 *
 * 为什么单独一个函数而不是塞进正则：切点规则是"**末 3 位是宿舍号**"（用户原话），
 * 用正则表达要走 lookahead/回溯引用，而回溯引用放在它所属组内部会被 JS 当八进制转义（实测踩过）。
 * 用 `slice(-3)` 表达这条规则反而**更直白、也更难写错**，且能返回 `null` 让调用方走"认不出"分支。
 * 位数下限是 4（栋号 1 位 + 宿舍 3 位）：`D999` 只有 3 位，既不够切也不该猜 → `null`。
 * @param {string} text
 * @returns {{zone:string, block:string, dorm:string, rest:string}|null}
 */
function splitGlued(text) {
  const match = typeof text === 'string' ? text.match(ROOM_LINE_GLUED) : null;
  if (!match) return null;
  const digits = match[2];
  // 至少 4 位数字，且扣掉末 3 位后剩下的栋号必须是 1~2 位（`D11001` → 栋号 `11` 会被闸 2 拒，
  // 不在这里提前拒，是为了让"楼区/栋号越界"与"认不出形态"落到同一个 `NO_BUILDING` 语义上）
  if (digits.length < GLUED_DORM_LEN + 1 || digits.length > GLUED_DORM_LEN + 2) return null;
  return {
    zone: match[1],
    block: digits.slice(0, digits.length - GLUED_DORM_LEN),
    dorm: digits.slice(-GLUED_DORM_LEN),
    rest: match[3]
  };
}

/**
 * 解析失败时的返回（形状冻结：失败也带 `name`，且 `buildingNo` 用 `0` 而不是 `null`——
 * 调用方要能直接把四个字段塞进 data 渲染，不必再判空）。
 * @param {'NO_BUILDING'|'NO_DORM'} reason
 */
function miss(reason) {
  return { ok: false, building: '', dorm: '', zone: '', buildingNo: 0, name: '', reason: reason };
}

/**
 * 一行地址 → 楼栋 / 宿舍号 / 姓名。
 *
 * 为什么失败分两种 reason：`NO_BUILDING` = 这一行**不是**（或不完整是）楼区地址，调用方应回落到别的形态
 * 或提示写法；`NO_DORM` = 楼区与栋号都认出来了，但宿舍号这个**具体字段**不合法，提示要指向宿舍号输入框。
 * 为什么 `D4`（缺宿舍号）算 `NO_BUILDING` 而不是 `NO_DORM`：整行的语法就没闭合，我们**无法断定**
 * 用户想录的是楼区地址还是别的什么（可能是"只填楼栋"的另一条路径），属于"认不出"而不是"字段填错"。
 *
 * @param {string} text 用户粘贴或手输的一行
 * @returns {{ok:boolean,building:string,dorm:string,zone:string,buildingNo:number,name:string,reason?:string}}
 *   `ok:true` → `building='D4'`（楼区已转大写）、`dorm='522'`、`zone='D'`、`buildingNo=4`
 */
function parseRoomLine(text) {
  if (typeof text !== 'string') return miss('NO_BUILDING');
  // 先 trim 再剥尾部标点：粘贴常带首尾空白，而尾部标点必须在**切分之前**去掉（见 TAIL_PUNCT 注释）
  const raw = text.trim().replace(TAIL_PUNCT, '');
  // 两步解析，顺序不可换（原因见两个正则上方的注释）
  //   ① 有分隔符：组 2=栋号 组 3=宿舍号 组 4=余下
  //   ② 粘连：   由 `splitGlued` 按"末 3 位是宿舍号"切（规则见 `ROOM_LINE_GLUED` 注释）
  const sepMatch = raw.match(ROOM_LINE_SEP);
  let match = sepMatch;
  if (!match) {
    const glued = splitGlued(raw);
    // 归一成与 ① 相同的形状（组 2=栋号 组 3=宿舍号 组 4=余下），后续只写一套取值逻辑
    if (glued) match = [raw, glued.zone, glued.block, glued.dorm, glued.rest];
  }
  if (!match) return miss('NO_BUILDING');
  const rest = match[4];

  // 闸 1：楼区必须在册。**先转大写再校验**——否则 `d4` 与 `D4` 会落成两条档案（用户要的是小写输入、大写落库）
  const zone = normalizeZone(match[1]);
  if (zone === '') return miss('NO_BUILDING');

  // 闸 2：栋号 1~10。`D11` / `D0` 在这里被拒
  const buildingNo = Number(match[2]);
  if (!isBuildingNo(buildingNo)) return miss('NO_BUILDING');

  // 宿舍号之后再出现横杠 = 多出来的一段（`d4-522-3`）。既不并进姓名（那是实测缺陷），
  // 也不猜它是什么（楼层？床位？）→ 按宿舍号不合法拒掉，让用户重填。
  if (isDash(rest.charAt(0))) return miss('NO_DORM');

  // 闸 3：宿舍号纯数字且 ≥100（`D1-99` 在这里被拒）；顺带覆盖前导零与超长
  const dorm = canonicalDorm(match[3]);
  if (dorm === '') return miss('NO_DORM');

  return {
    ok: true,
    building: zone + buildingNo, // `号楼` 后缀在正则里已被吞掉，落库的永远是 `D4` 这种规范形态
    dorm: dorm,
    zone: zone,
    buildingNo: buildingNo,
    name: clip(rest.replace(/\s+/g, ' ').trim(), MAX_NAME) // 含空格的姓名**拼回**：`小 王`
  };
}

/**
 * 拼显示形态：`formatRoomLine('D', 4, '522')` → `'D4-522'`。
 * 三道闸与 `parseRoomLine` **同一套**（否则本函数能造出 `parseRoomLine` 会拒绝的地址，库里就出现"存得进、读不懂"的值）。
 * 小写楼区与大数字符串都接受（页面 setData 里常见字符串形态），产出恒为大写规范形态。
 * @param {string} zone
 * @param {number|string} buildingNo
 * @param {number|string} dorm
 * @returns {string} 入参非法 → `''`（**不抛**：调用方在渲染路径上，抛错等于整页白屏）
 */
function formatRoomLine(zone, buildingNo, dorm) {
  const code = normalizeZone(zone);
  if (code === '') return '';
  const no = typeof buildingNo === 'string' ? Number(buildingNo.trim()) : buildingNo;
  if (!isBuildingNo(no)) return '';
  const dormNo = canonicalDorm(dorm);
  if (dormNo === '') return '';
  return code + no + '-' + dormNo;
}

/** 楼区字母是否合法（大小写不敏感；两侧空白容忍）。只认**单字母代码**，`'D4'`/`'D 区'` 都算非法。 */
function isZone(ch) {
  return normalizeZone(ch) !== '';
}

/**
 * 楼区在**固定顺序**里的下标（0..4），非法 → -1。
 * 只接受楼区**字母**：`buildingKey()` 返回的 `zone` 已经是下标，请直接用它，不要再绕回本函数。
 * @param {string} zone
 * @returns {number}
 */
function zoneRank(zone) {
  const code = normalizeZone(zone);
  return code === '' ? -1 : ZONES.indexOf(code);
}

/**
 * 客户档案 `building` 字段 → 排序键。楼区楼栋 → `{zone:下标, no:栋号}`，非楼区形态 → `null`
 * （`null` 表示"本模块不管它"，交回调用方既有的自然数字序比较器，例如 `3号楼`）。
 * 大小写不敏感：别让 `d4` 这种小写残值在列表里排到 `D4` 之外去。
 * ⚠️ 只认 `parseRoomLine` 产出的规范形态（`D4`）：`号楼` 在解析层已被吞掉，
 * 这里再容忍一次 `D4号楼` 等于给第二条落库路径开口子（SCOPE §2.3 要求排序与查重都基于规范形态）。
 * @param {string} buildingText
 * @returns {{zone:number,no:number}|null}
 */
function buildingKey(buildingText) {
  if (typeof buildingText !== 'string') return null;
  const match = buildingText.trim().match(/^([A-Za-z])([0-9]{1,2})$/);
  if (!match) return null;
  const code = normalizeZone(match[1]);
  const no = Number(match[2]);
  if (code === '' || !isBuildingNo(no)) return null;
  return { zone: ZONES.indexOf(code), no: no };
}

// ── 内部小工具（不导出：一旦导出就会有人拿去做第二套判定口径）────────────────────────

/** 楼区代码归一：非法 → `''`（大写化在这里，全模块只此一处，保证落库与显示都是大写） */
function normalizeZone(zone) {
  if (typeof zone !== 'string') return '';
  const code = zone.trim().toUpperCase();
  return code.length === 1 && ZONES.indexOf(code) >= 0 ? code : '';
}

/** 栋号值域：整数且在 1~BUILDING_MAX。用 `Number.isInteger` 挡住 `4.5` / `NaN` / `'4'` 这类脏输入 */
function isBuildingNo(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= BUILDING_MAX;
}

function isDash(ch) {
  return ch !== '' && DASHES.indexOf(ch) >= 0;
}

/**
 * 宿舍号归一：`522` / `'522'` → `'522'`；不合法 → `''`。
 * 前导零去掉（`0522` 与 `522` 是同一间房，留着会让查重判成两条）；
 * 超长**不许截断**——截断后的数字是**另一间房**，与姓名截断（纯装饰）不同，宁可拒绝。
 */
function canonicalDorm(value) {
  const text = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : (typeof value === 'string' ? value.trim() : '');
  if (!/^[0-9]+$/.test(text)) return '';
  const digits = text.replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_FIELD) return '';
  return Number(digits) >= DORM_MIN ? digits : '';
}

function clip(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

module.exports = {
  ZONES,
  BUILDING_MAX,
  DORM_MIN,
  // 以下三个当前**生产代码零消费者**（`formatRoomLine` / `zoneRank` / `ZONE_LABELS`），
  // 但**刻意保留**，不是死代码（独立审查 r2 的 P3-01 要求写明理由，否则下轮会被当成同族坑清掉）：
  //   · `ZONE_LABELS` —— SCOPE §6 W2 的"录入面板"要用它做五个楼区的显示名（本批不做面板 UI）
  //   · `formatRoomLine` —— 面板回填与页面显示的统一拼装口（现在只有自测在用；**它不在任何落库路径上**，
  //     所以它是"有闸但暂时没人走"，不是"闸坏了"）
  //   · `zoneRank` —— 对外暴露固定序下标，供 W2 面板排序用；生产代码目前直接读 `buildingKey().zone`
  ZONE_LABELS,
  parseRoomLine,
  formatRoomLine,
  isZone,
  zoneRank,
  buildingKey
};
