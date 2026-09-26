// utils/customer-input.js · 客户一行文本 → 楼栋 / 宿舍号 / 姓名（纯函数，零依赖）
//
// 为什么要有这个文件（2026-09-21 用户原话）：
//   "客户档案在创建时有浮窗，浮窗内只有一个输入框，输入顺序为楼栋+空格+宿舍号
//    完成后自动分段并填入已有表格，允许备注与用户名为空"
// 现实场景是**客户在微信里发来一句话**（`3号楼 502 小王`），用户在浮窗里粘贴 → 期望自动拆开，
// 而不是让人分三次填三个框。所以拆解规则必须独立成纯函数（可机械钉住），不写在页面里。
//
// ⚠️ 两条纪律（都来自 CONVENTIONS 与既有教训）：
//   ① **不做楼栋写法归一化**：`3号楼` 与 `3栋` 仍是两个楼栋。归一化会误合并真实不同的位置
//      （与站点名"只提示不自动改"同一取向；用户 2026-09-21 接受 U2 默认值）
//   ② **猜不出就说猜不出**：返回 `ok:false`，由页面显示正确写法示例。绝不塞一个"猜的"楼栋进去
'use strict';

const MAX_FIELD = 20;   // 与 utils/migrate.js 的 building/dorm 上限同口径（避免产出落不了库的值）
const MAX_NAME = 20;    // `Customer.name` 的校验上限（同为 ≤20）

// 楼区地址的解析规则（楼区枚举、栋号 1~10、宿舍号 ≥100 三道闸）**只在 utils/buildings.js 一份**。
// 本文件原先零 require；2026-09-22 新增这一条：buildings.js 同为纯函数层（不碰 wx、不碰存储），
// 加它不引入新依赖；但换来的是"地址规则不许抄两遍"（宪法 §2 + 教训卡 2026-09-11_规则与样例分叉）。
const buildings = require('./buildings.js');

// "看起来像**楼区地址**"的判据 —— 用**结构特征**，不用字母集合。
//
// 形状 = `字母` + `1~2 位数字` + （**分隔符或楼栋量词**二者其一）+ `还有内容`
//   命中例：`Z4-522` / `D11-522` / `A4-99` / `M10-101` / `D4号楼`；不命中例：`A302` / `3号楼` / `22栋` / `D4`
//
// ⚠️ 为什么必须是"结构特征"而不是"首字母是否在枚举内" —— 这条判据被独立审查**打回两次**，两次都是同一个病根：
//   · 第 1 版 `^[A-Za-z]\s*[0-9]{1,2}$`（要求是**纯**楼区码）：`D11-522` **含横杠**过不了形状 ⇒ 守卫短路
//     ⇒ 落库成 `building='D11-522'` / `dorm='小王'`（r1 实测落库）
//   · 第 2 版加了"首字母必须是枚举楼区 `D/X/N/B/C`"：洞从"含横杠"挪到"字母不在册"，**类别没变** ——
//     `Z4-522 小王` / `K4-522 小王` / `M10-101 小王` / `z4-522 小王` 等 **21 个非枚举字母全部漏过**（r2 实测落库）
//   ⇒ 教训：判据不要依赖"值域是否合法"（那正是它要拦的东西），只依赖**形态**。
//
// ⚠️ 分隔符/量词必须是**必需项**，且**两支都要有**（`(?:…|号楼|号|栋|幢|舍|座)`）：
//   · "分隔符必需"是判别力来源 —— 旧形态楼栋（`3号楼`/`22栋`）与旧形态宿舍号（`A302`/`502`）都不含分隔符。
//   · **量词那一支是第三次被打回才补上的**：只写分隔符时，`D4号楼 522 小王` 的第 1 段是 `D4号楼`，
//     数字后跟的是 `号`（CJK）而不是分隔符 ⇒ **不命中 ⇒ 守卫放行 ⇒ 落库成 `building='D4号楼'`**
//     （r3 沙箱实测真落库；后果：`buildingKey('D4号楼')` = null ⇒ 不算楼区、被排到 `D5` 之后、同一间房开出两条档案）。
//     而当时 `APIS.md` 已写"`号楼` 一律拒" ⇒ **契约说拒、实测接受**。
//   ⇒ 教训：守卫语料的**形态覆盖面**要和契约一样宽 —— 前三次打回都栽在"我只测了自己想到的那一种写法"。
//     现覆盖：`D4-522 小王`（分隔符）、`D4号楼 522 小王`（量词）、`D11-522 小王`（越界）、`Z4-522 小王`（非枚举）。
const ZONE_ADDRESS_SHAPE = /^[A-Za-z][0-9]{1,2}(?:[\s\-—–－−]|号楼|号|栋|幢|舍|座)/;

/**
 * 该 token 是否"长得像新形态楼区地址"。
 *
 * 语义很窄：**只看形态，不看值域**。值域合法性由 `buildings.parseRoomLine` 判（唯一事实源）；
 * 本函数只负责回答"第 1 段到底该不该被当成楼栋收下"。
 *
 * 为什么必须存在：`splitCustomerLine` 的"有空格分支"会无条件把第 1 段当楼栋、第 2 段当宿舍号。
 * 对 `Z4-522 小王` 这种输入，那个行为产出 `building='Z4-522'` / `dorm='小王'` / 姓名空 →
 * 再自动补名成 `Z4-522 小王 A`：**不报错、看起来像对的**，而排序与查重从此全错。
 * ⇒ 命中本形状就整行拒绝，让人重填（宁可红字，不许错解）。
 *
 * @param {string} token
 * @returns {boolean}
 */
function isRejectedZoneAddress(token) {
  const text = typeof token === 'string' ? token.trim() : '';
  return ZONE_ADDRESS_SHAPE.test(text);
}

/**
 * 一行的拆解规则（自顶向下，第一个成功即返回）：
 *   ⓪ 楼区形态（2026-09-22 新增）：`D4-522` / `D4-522 小王` / `d4 522`
 *      —— 交给 `utils/buildings.js`，**规则只有那一份**（含楼区枚举 + 三道值域闸）
 *   ① 有空格：第 1 段 = 楼栋、第 2 段 = 宿舍号、**其余拼回** = 姓名（`3号楼 502 小王`）
 *   ② 无空格但有楼栋形态（`3号楼502` / `3号楼 502小王`）：楼栋与宿舍直接切，余下 = 姓名
 *   ③ 都切不出 → `ok:false`（页面提示正确写法，**不猜**）
 * 姓名可空；楼栋与宿舍号必须都有值。
 *
 * @param {string} text 用户粘贴或手输的一行
 * @returns {{ok:boolean, building:string, dorm:string, name:string, reason?:'NO_BUILDING'|'NO_DORM'}}
 */
function splitCustomerLine(text) {
  const empty = { ok: false, building: '', dorm: '', name: '' };
  if (typeof text !== 'string') return Object.assign({}, empty, { reason: 'NO_BUILDING' });

  // ⓪ 楼区形态优先（`D4-522`）。放在最前面，是为了让"地址形态"的判定**只有一处实现**：
  //    楼区枚举、栋号 1~10、宿舍号 ≥100 三道闸都在 buildings.js，本文件不再抄一遍
  //    （抄第二遍 = `docs/lessons/2026-09-11_规则与样例分叉.md` 那个坑）
  const zone = buildings.parseRoomLine(text);
  if (zone.ok) {
    return {
      ok: true,
      building: clip(zone.building, MAX_FIELD),
      dorm: clip(zone.dorm, MAX_FIELD),
      name: clip(zone.name, MAX_NAME)
    };
  }
  // ⓪ 失败时**保留它的 reason**（`NO_DORM` = 楼栋认出来了但宿舍号不合法，提示该指向宿舍号输入框）。
  // 为什么不能一律塌成 NO_BUILDING：`docs/registry/APIS.md` 把两种码登记为对外返回，
  // 全塌成一种会让契约名不副实（2026-09-22 独立审查 P2-02）。
  const zoneReason = zone.reason;

  // 全角空格最常见（手机输入法），先归一；再去首尾空白与**末尾**标点（用户从聊天里复制会带上句号）
  const raw = text.replace(/\u3000/g, ' ').trim().replace(/[\s。，,、.；;！!？?~～]+$/g, '');
  if (!raw) return Object.assign({}, empty, { reason: 'NO_BUILDING' });

  const tokens = raw.split(/\s+/).filter((token) => token !== '');
  if (tokens.length >= 2) {
    // ① 楼栋 + 未知形态的宿舍（宿舍号不限定成"纯数字"：`A302` / `12-3` / `502` 都合法）
    const building = clip(tokens[0], MAX_FIELD);
    const dorm = clip(tokens[1], MAX_FIELD);
    // 第 3 段起是姓名（含空格的名字如 `小 王` 会被拼回 `小 王`——刻意不再二次切，避免把复姓切开）
    const name = clip(tokens.slice(2).join(' '), MAX_NAME);
    if (!building) return Object.assign({}, empty, { reason: 'NO_BUILDING' });
    if (!dorm) return Object.assign({}, empty, { reason: 'NO_DORM' });
    // ⚠️ 静默错解的总闸：第 1 段长得像楼区地址、但 ⓪ 没能接受它 ⇒ **整行拒绝**。
    //    若不拦，`D11-522 小王` 会被按"第 1 段=楼栋、第 2 段=宿舍"收成
    //    `building='D11-522'` / `dorm='小王'` / 姓名空 → 再自动补名成 `D11-522 小王 A`：
    //    **不报错、看起来像对的**，而排序与查重从此全错（2026-09-22 独立审查 P1-01 实测复现）。
    //    为什么判据放在 buildings.js 侧同源：见 `isRejectedZoneAddress` 的注释。
    if (isRejectedZoneAddress(tokens[0])) {
      return Object.assign({}, empty, { reason: zoneReason || 'NO_BUILDING' });
    }
    return { ok: true, building: building, dorm: dorm, name: name };
  }

  // ② 无空格：靠"楼栋形态"定位切点。为什么用正则而不是按字符位置猜：
  //    楼栋的写法是有限的（`N号楼` / `N栋` / `N幢` / 中文数字），而姓名与宿舍号是自由的
  const match = raw.match(/^([\d０-９一二三四五六七八九十百]+(?:号楼|号|栋|幢|舍|座))(?:宿舍)?(.+)$/);
  // 走到这里仍认不出时，若 ⓪ 给过更具体的 reason（`NO_DORM` = 楼栋认出来了但宿舍号不合法），
  // 就把它带出去 —— 否则 `D1-99` 这类"只差宿舍号"的输入会显示成"整行看不懂"，
  // 与 `docs/registry/APIS.md` 登记的两种码语义不符（2026-09-22 独立审查 P2-02）。
  if (!match) return Object.assign({}, empty, { reason: zoneReason || 'NO_BUILDING' });

  let rest = match[2].replace(/^(宿舍)/, '').trim();
  if (!rest) return Object.assign({}, empty, { reason: 'NO_DORM' });

  // 分隔符（`3-502` / `3号楼-502`）不算宿舍号的一部分
  rest = rest.replace(/^[-—_·]+/, '');
  if (!rest) return Object.assign({}, empty, { reason: 'NO_DORM' });

  // 宿舍号是开头那段连续的字母数字（可含一个连字符，如 `12-3`），其后若还有汉字就是姓名
  const dormMatch = rest.match(/^([0-9A-Za-z]+(?:-[0-9A-Za-z]+)?)(.*)$/);
  if (!dormMatch) return Object.assign({}, empty, { reason: 'NO_DORM' });
  const dorm = clip(dormMatch[1], MAX_FIELD);
  const name = clip(dormMatch[2], MAX_NAME);
  if (!dorm) return Object.assign({}, empty, { reason: 'NO_DORM' });

  return { ok: true, building: clip(match[1], MAX_FIELD), dorm: dorm, name: name };
}

function clip(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * 姓名留空时的自动命名（2026-09-21 用户原话："允许重复 此时若有用户名则直接放置，若没有则按 A-Z 顺序命名"）。
 *
 * 计数口径：**同一楼栋 + 同一宿舍号**（精确比较，不归一化）的**未删除**档案条数 N →
 * 新档案叫 `<楼栋> <宿舍> ` + 第 N+1 个后缀。为什么带上楼栋与宿舍：`3号楼 502 A` 本身就能当识别标识，
 * 而只叫 `A` 的话在清单上完全看不出是谁（清单行只显示客户称呼）。
 *
 * ⚠️ 为什么必须自动起名（而不是真存空）：`utils/migrate.js` 对 `Customer.name` 的校验是**非空且 ≤20**
 *    —— 空名会被 `CUSTOMER_INVALID:name` 拦住，落不了库。所以"允许用户名为空"的落法是**由系统补名**。
 *
 * @param {Array<{building?:string,dorm?:string,deletedAt?:number|null}>} customers 现有档案（含已删除的会被排除）
 * @param {string} building
 * @param {string} dorm
 * @param {string} [existingName] 用户填了姓名就直接用（原样 trim）
 * @returns {{name:string, auto:boolean, sequence:number}}
 *   `auto:true` 表示这是自动补的名，`sequence` 是它在该"楼栋+宿舍"下的序号（1-based）
 */
function nextCustomerName(customers, building, dorm, existingName) {
  const given = clip(existingName, MAX_NAME);
  if (given) return { name: given, auto: false, sequence: 0 };

  const targetBuilding = clip(building, MAX_FIELD);
  const targetDorm = clip(dorm, MAX_FIELD);
  let count = 0;
  for (const customer of customers || []) {
    if (!customer || customer.deletedAt) continue;
    if (clip(customer.building, MAX_FIELD) !== targetBuilding) continue;
    if (clip(customer.dorm, MAX_FIELD) !== targetDorm) continue;
    count++;
  }

  const sequence = count + 1;
  const base = (targetBuilding + ' ' + targetDorm).trim();
  // 后缀从 sequence 派生（A…Z，再 AA/AB…）：不扫已有名字取名，避免"删掉 B 之后再建又变成 B"这种撞名
  const name = clip(base + ' ' + suffixOf(sequence), MAX_NAME);
  return { name: name, auto: true, sequence: sequence };
}

const AUTO_SUFFIX_FALLBACK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 1→A、26→Z、27→AA（Excel 列名的同一套算法）
function suffixOf(sequence) {
  if (!(sequence > 0)) return AUTO_SUFFIX_FALLBACK.charAt(0);
  let rest = sequence;
  let out = '';
  while (rest > 0) {
    const index = (rest - 1) % 26;
    out = AUTO_SUFFIX_FALLBACK.charAt(index) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

/**
 * 页面一次调用拿到全部结果（拆解 + 补名），让页面**只做 setData**（宪法 §11：纯逻辑与副作用分文件）。
 * @param {Array<object>} customers 现有档案
 * @param {string} text 浮窗里那唯一一行输入
 * @returns {{ok:boolean,building:string,dorm:string,name:string,auto:boolean,reason?:string}}
 *   `ok:false` 时页面显示正确写法示例（`3号楼 502 小王`），**不要拿返回值去覆盖输入框**
 */
function buildCustomerInput(customers, text) {
  const split = splitCustomerLine(text);
  if (!split.ok) return { ok: false, building: '', dorm: '', name: '', auto: false, reason: split.reason };
  const named = nextCustomerName(customers, split.building, split.dorm, split.name);
  return {
    ok: true,
    building: split.building,
    dorm: split.dorm,
    name: named.name,
    auto: named.auto
  };
}

module.exports = {
  splitCustomerLine,
  nextCustomerName,
  buildCustomerInput,
  suffixOf // 导出给自测直接钉住序号→后缀的映射（A/Z/AA 边界）
};
