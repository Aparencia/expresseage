// pages/recognize/save-parts.js · **单条件的落件决议**（2026-09-26 第 2 件批 3 从 `intake-parts.js` 搬来）
//
// 为什么再搬一次：`intake-parts.js` 当时 487/500 非空行，而"单条保存入口"（用户补充要求「但要有单条保存入口」）
// 必须再加两个纯函数 —— 不搬就顶破 AGENTS §11.1 的 500 行硬线。搬出来还顺带把这一族**收成一个单向叶子**：
// 本文件只 require `utils/stations.js` 与 `utils/parcel-drafts.js`（两个叶子），⛔ 不 require 任何页面件
// ⇒ `intake-parts.js` 与 `recognize-flow.js` 都能安全地 require 它，**没有循环边**。
// ⚠️ 搬迁纪律（本项目因反例付过代价）：**搬函数必须连依赖一起搬**，`intake-parts.js` 仍逐个 re-export 旧名字
// （`cleanTail`/`normalizeStation`/`planSingleSave`），所以 `form-parts.js` 的 re-export 链与断言一个字都不用改。
'use strict';

const stations = require('../../utils/stations.js');              // 站点名归一的单源（⛔ 不写第二份比对）
const parcelDrafts = require('../../utils/parcel-drafts.js');     // 汇总读数（`summarizeDrafts`）

// 运单后 5 位的清洗：只留数字、取最后 5 位。
// 为什么"取最后 5 位"而不是"必须正好 5 位才收"：人从聊天里复制常带运单号前缀（`SF1234567890123`），
// 逼他自己数是没必要的负担；而库里非空时必须是"恰好 5 位数字"由写盘校验兜死（DESIGN §1）。
function cleanTail(value) {
  const digits = String(value === undefined || value === null ? '' : value).replace(/\D/g, '');
  return digits.length > 5 ? digits.slice(-5) : digits;
}

/**
 * 站点名归一：**只收敛到官方 8 名**（2026-09-26 起是 8 个点），收敛不成就原样给人（自建点允许，见 `STATION_MAP`）。
 * R-01 的拦空判据与 `parcel-drafts.officialStationName` 同源不同用：那个决定**落库值**，这个决定**能不能落**。
 */
function normalizeStation(raw) {
  const text = String(raw || '').trim();
  const hit = stations.matchBuiltinStation(text);
  return hit.ok ? hit.stationName : text;
}

/**
 * 单条保存的**写盘前决议**（纯函数）：站点归一 → 尾号清洗 → 拼码 → 三种拦空各自的文案。
 * 为什么从页面搬进零件：这三条拦空是本页"存不进去"的**全部**理由，而页面层零断言（TD-016）——
 * 把 `if (!stationName)` 整行删掉，自测仍全绿，人却得到一条没有站点的记录。
 * @param {{stationName:string,pickupCode:string,lockerNo:string,trackingTail:string}} draft 单条四格
 * @param {boolean} recognitionUsed 这一屏到底采没采信识别结果（落库 `source` 必须如实）
 * @returns {{ok:boolean, errorText:string, parcel?:object}} `ok:true` 时 `parcel` 缺 `customerId`，由页面补
 */
function planSingleSave(draft, recognitionUsed) {
  const one = draft || {};
  const stationName = normalizeStation(one.stationName);
  if (!stationName) {
    return { ok: false, errorText: '「去哪取」要填 —— 清单是按站点分组的，空着这条进不了任何一站。' };
  }
  const tail = cleanTail(one.trackingTail);
  if (one.trackingTail && tail.length !== 5) {
    return { ok: false, errorText: '运单后 5 位要正好 5 位数字（现在是 ' + tail.length + ' 位）；不填就留空。' };
  }
  // 库里 `pickupCode` 强制非空 ⇒「只有运单号尾数、还没取件码」这种件按「尾号」+ 5 位记进码字段，
  // 与清单页的「需查明」档同源（`aggregate.pickupTier` 从 trackingTail 反推档位）
  const code = String(one.pickupCode || '').replace(/\s+/g, '') || (tail.length === 5 ? '尾号' + tail : '');
  if (!code) {
    return { ok: false, errorText: '还没有取件码 —— 有码就填码；只有运单后 5 位就填那 5 位（会记成「尾号12345」）。' };
  }
  return {
    ok: true,
    errorText: '',
    parcel: {
      stationName: stationName,
      pickupCode: code,
      lockerNo: String(one.lockerNo || '').trim(),
      trackingTail: tail.length === 5 ? tail : '',
      source: recognitionUsed ? 'ocr' : 'manual'
    }
  };
}

/**
 * **单条保存入口**的写盘前决议（纯函数，2026-09-26 第 2 件批 3；用户裁决「A 但要有单条保存入口」）。
 *
 * 三条纪律（前两条直接来自用户裁决 D1/D2，第三条是屏上定位的硬要求）：
 *   ① **不用第二套拦空**（D2）：一件能不能存，判据与「全部保存」**同一个函数**（`planSingleSave`）——
 *      两条路两套规则就会长出"整批存不进、单条却进去了"这种自相矛盾；
 *   ② **存掉的那行出列表**（D1）：`remaining` = 原列表去掉该行（人不会看到"已存行"这种要额外解释的状态）；
 *   ③ **重新编号** `d0..d{n-1}`：屏上按 `data-key` 找行、下一次保存按 key 定位 ⇒ 不重编就会出现
 *      两个 `d3`（与 `mergeBatchDrafts` 同一条纪律）。
 * ⚠️ 入参一律只读：本函数**不改** `row` 与 `drafts`（调用方还要用原列表展示与回滚）。
 * @param {object} row 列表里那一行（含 `key`；缺 key 时按**引用同一性**定位那一行）
 * @param {boolean} recognitionUsed 这一屏采没采信识别结果（落库 `source` 必须如实）
 * @param {Array<object>} drafts 当前整张列表
 * @returns {{ok:boolean, errorText:string, parcel?:object, remaining?:Array<object>}} `remaining` 仅 `ok:true` 时给
 */
function planRowSave(row, recognitionUsed, drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const one = row || {};
  const plan = planSingleSave(one, recognitionUsed === true);   // ① 与「全部保存」同一套拦空
  if (!plan.ok) return { ok: false, errorText: plan.errorText };
  const key = typeof one.key === 'string' && one.key ? one.key : '';
  const remaining = [];
  for (const item of list) {
    // ② 定位那一行：有 key 用 key，没 key 用引用同一性（⛔ 不许"随便删最后一行" —— 那会存 A 删 B）
    const hit = key ? (item && item.key === key) : (item === one);
    if (hit) continue;
    if (!item) continue;
    remaining.push(Object.assign({}, item, { key: 'd' + remaining.length }));   // ③ 重新编号
  }
  return { ok: true, errorText: '', parcel: plan.parcel, remaining: remaining };
}

/**
 * 单条存完之后的**屏上补丁**（纯函数）：列表读数 + `drafts.length === 1` 时同步单条卡。
 * 为什么必须有它：`index.wxml` 在 `drafts.length <= 1` 时渲染的是**单条那张卡**，它读 `draft.*`；
 * 存完剩 1 行却不同步，就会出现"列表里有 1 件、卡上却是空的"—— 行看不见，人会以为压根没认出来
 * （与 `parse-patch.planBatchPatch` 的第 ④ 条同一条纪律，两处都写进断言）。
 * @param {Array<object>} remaining 存完之后剩下的行
 * @returns {object} 可直接交给 `setDataMeasured` 的补丁
 */
function remainingPatch(remaining) {
  const list = Array.isArray(remaining) ? remaining : [];
  const sum = parcelDrafts.summarizeDrafts(list);
  const patch = {
    drafts: list,
    draftsReady: sum.ready,
    draftsNoCode: sum.noCode
  };
  if (list.length === 0) {
    // 列表空了 ⇒ 屏上回到**单条卡**：那几格必须清空（否则会留下刚存掉的那件，人再点一次就是重复记录）
    patch['draft.stationName'] = '';
    patch['draft.pickupCode'] = '';
    patch['draft.lockerNo'] = '';
    patch['draft.trackingTail'] = '';
  }
  if (list.length === 1) {
    patch['draft.stationName'] = list[0].stationName || '';
    patch['draft.pickupCode'] = list[0].pickupCode || '';
    patch['draft.lockerNo'] = list[0].lockerNo || '';
    patch['draft.trackingTail'] = list[0].trackingTail || '';
  }
  return patch;
}

/**
 * 按 `key` 找那一行（纯函数）：找不到就回 `null`，由调用方**如实说一句**（⛔ 不许默默什么都不做）。
 * 为什么要单独一个函数：`key` 来自 WXML 的 `data-key`（字符串），而列表行可能刚被别的动作换过 ——
 * "点了却没反应"是本项目反复出现的坏形态，所以"找不到"必须是一个**显式返回值**而不是 `undefined`。
 * @param {Array<object>} drafts 列表
 * @param {string} key 行 key
 * @returns {object|null} 命中的行（原对象，不是副本）
 */
function findRowByKey(drafts, key) {
  const list = Array.isArray(drafts) ? drafts : [];
  const target = typeof key === 'string' ? key : '';
  if (!target) return null;
  for (const item of list) {
    if (item && item.key === target) return item;
  }
  return null;
}

module.exports = {
  cleanTail,
  normalizeStation,
  planSingleSave,
  planRowSave,
  remainingPatch,
  findRowByKey
};
