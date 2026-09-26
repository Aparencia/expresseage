// utils/parcel-drafts.js · 一图多码：识别结果 → 待确认草稿（纯函数；契约见 docs/registry/APIS.md §2）
//
// 为什么单独成文件（而不是写进 pages/recognize/index.js）：
//   ① 该页已 423 行，宪法 §11 上限 500 —— 列表 + 候选 + 队列的改动写进去必然超线；
//   ② TD-041 的教训：**纯逻辑住在页面里 = 没有机械判据**（`tools/selftest.js` 够不着页面）。
// 本模块只做"多条识别结果 → 可编辑草稿"的推导：不碰 wx、不读写存储、不产文案（人话由页面层拼）。
//
// 用户 2026-09-19 的口径（决定了这里的形状）：
//   · 交互 = **预填可改 + 一键全存**（不是逐条确认）；
//   · 落库站点名 = **只用 6 个正式名**（`utils/stations.js` 的 `listStationPoints()`）——
//     写法一分裂，取件清单就会按字符串裂成多组、人要多跑一趟（本项目最贵的一类错）。
'use strict';

const stations = require('./stations.js');

/**
 * 一行"没判出取件点"吗（落库站点名为空串）—— R2-C06：这条等价式**只在这里写一遍**
 * @param {{stationName?:string}} draft
 * @returns {boolean}
 */
function isStationUnknown(draft) {
  const one = draft || {};
  return !one.stationName;
}

/**
 * 一行"存不进去"吗（有码却没选取件点）—— 页面行内 ⚠ 与写盘前拦空**共用这一个判据**
 * @param {{pickupCode?:string,stationName?:string}} draft
 * @returns {boolean}
 */
function needsStation(draft) {
  const one = draft || {};
  return !!one.pickupCode && isStationUnknown(one);
}

/**
 * 写盘前拦空：哪些行还缺取件点（报告 R-01 的判据；R2-C05 从页面下沉到这里 = 让自测够得着）
 *
 * 为什么必须由本文件算：判据留在页面里，`tools/selftest.js` 就够不到它（TD-041 的同族），
 * 于是"删掉这段拦空循环"自测仍然全绿 —— 那正是 R-01 能活到 r1 审查的机制。
 * @param {Array} drafts
 * @returns {number[]} 缺点行的**下标**（0 基，含没码的行不算）；页面自己 +1 换成"第 N 件"
 */
function findRowsWithoutStation(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const hit = [];
  for (let order = 0; order < list.length; order++) {
    if (needsStation(list[order])) hit.push(order);
  }
  return hit;
}

// 行状态标记的唯一计算处：就地写入 `unknown` / `needStation` 并返回同一对象。
// 只在 buildDrafts 末尾与 updateDraft 改动之后调用 —— 别在页面里补算。
function withFlags(row) {
  row.unknown = isStationUnknown(row);
  row.needStation = needsStation(row);
  return row;
}

/**
 * 一批识别结果 → 待确认草稿（每条 = 页面上的一行）
 * @param {Array<{pickupCode:string,stationName:string,segment:string}>} items `parse.parseParcelTextMulti` 的 items
 * @param {{customerId?:string, source?:'ocr'|'manual'}} [options] 归属与来源（页面已选定的值，原样带进草稿）
 * @returns {Array<{key:string,pickupCode:string,stationName:string,stationRaw:string,matched:string,unknown:boolean,needStation:boolean,customerId:string,source:string}>}
 *   `stationName`：**落库值** —— 6 个正式名之一，或空串（推断不出来时**绝不猜点**：猜错 = 跑错驿站）
 *   `stationRaw`：识别到的站点原文（只给人看，不落库 —— 页面显示"识别到 …"帮人判断）
 *   `unknown`：true = 没判出取件点（页面加"❓需问客户"标记，**但不阻断保存**：码还在，人到了点也能问）
 *   `needStation`：true = 有码又没点 ⇒ **这一件存不进去**（页面行内 ⚠ 用它）。⚠️ 界面判据只从这两个字段读，
 *     WXML 里不许再写 `item.pickupCode && !item.stationName`（R2-C06：同一规则两处实现 = 必分叉）
 */
function buildDrafts(items, options) {
  const source = (options && options.source) === 'manual' ? 'manual' : 'ocr';
  const customerId = typeof (options && options.customerId) === 'string' ? options.customerId : '';
  const list = Array.isArray(items) ? items : [];
  return list.map((item, order) => {
    const one = item || {};
    const pickupCode = normalizeCode(one.pickupCode);
    const hit = stations.inferStation(one.segment, pickupCode);
    return withFlags({
      // key 用**序号**而不是码：码是可编辑字段（改了码若 key 跟着变，WXML 会重建节点、输入框失焦）
      key: 'd' + order,
      pickupCode: pickupCode,
      stationName: hit.stationName,
      // 柜号（v3，2026-09-19）：识别结果原样带过来（空串 = 未知）；人在页面上可改
      lockerNo: normalizeLocker(one.lockerNo),
      stationRaw: rawStationName(one.stationName, pickupCode),
      matched: hit.matched,
      customerId: customerId,
      source: source
    });
  });
}

/**
 * 就地改一行（**不可变**：返回新数组，不改入参 —— 与 `utils/pickqueue.js` 同口径）
 * @param {Array} drafts
 * @param {string} drafts[].lockerNo 柜号（v3，2026-09-19；空串 = 未知，待存数组会带上它）
 * @param {string} key 行的 key
 * @param {{pickupCode?:string, stationName?:string, lockerNo?:string}} patch
 * @returns {Array} 新草稿数组（key 不存在时原样返回一份拷贝）
 */
function updateDraft(drafts, key, patch) {
  const list = Array.isArray(drafts) ? drafts : [];
  const source = patch || {};
  return list.map((draft) => {
    if (!draft || draft.key !== key) return draft;
    const next = Object.assign({}, draft);
    if (source.pickupCode !== undefined) next.pickupCode = normalizeCode(source.pickupCode);
    if (source.stationName !== undefined) next.stationName = officialStationName(source.stationName);
    // 报告 R-36（修复批新发现，非 v1 行为变更）+ R2-C06（r2 收口）：`unknown` / `needStation`
    // 是**行状态**，由 `stationName` 与 `pickupCode` 派生 ⇒ 任何一次改动之后都要重算，
    // 且只在这里算（改一处即覆盖两行 × 两个字段：码改了、站点改了，标记都跟着变）。
    // 页面或 WXML 再判一次就是"规则与样例分叉"（AGENTS §2.3 单一事实源）。
    withFlags(next);

    // 柜号：**允许任意短文本**（用户裁决：不强制 `N号柜` 形态，你可能想写"3号柜左边"）；长度由 UI 的
    // maxlength 与 `migrate.validate`（≤10）两级兜底，这里只做 trim
    if (source.lockerNo !== undefined) next.lockerNo = normalizeLocker(source.lockerNo);
    return next;
  });
}

/**
 * 草稿计数（页面用它拼"这图里 N 件"与按钮状态；人话由页面层拼）
 * @returns {{total:number,ready:number,unknown:number,noCode:number}}
 *   `ready` = 有码、存得下的行数；`unknown` = 有码但没判出取件点；`noCode` = 码为空（人没填/没认出来）
 */
function summarizeDrafts(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  let ready = 0;
  let unknown = 0;
  let noCode = 0;
  for (const draft of list) {
    const one = draft || {};
    if (!one.pickupCode) { noCode++; continue; }
    ready++;
    if (isStationUnknown(one)) unknown++;
  }
  return { total: list.length, ready: ready, unknown: unknown, noCode: noCode };
}

/**
 * 待存数组（**只带有码的行**；站点名可以是空串 —— 用户选的 (a)：留空 + 问客户，不猜点）
 * @returns {Array<{customerId:string,stationName:string,pickupCode:string,source:'ocr'|'manual'}>}
 *   直接喂给 `storage.addParcels`（一次整键写）
 */
function saveableDrafts(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  return list.filter((draft) => draft && draft.pickupCode).map((draft) => ({
    customerId: draft.customerId,
    stationName: draft.stationName, // 已是 6 个正式名之一或 ''
    pickupCode: draft.pickupCode,
    lockerNo: draft.lockerNo || '', // 空串 = 未知（migrate.validate 认它是合法值）
    source: draft.source
  }));
}

// 码里不留空白：OCR 会把 `23 - 5 - 3009` 这类拆开（内部空白不是码的一部分）
function normalizeCode(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

// 柜号归一：**只 trim**（不截断、不改写形态）—— 用户裁决是"允许任意短文本，只限 ≤10 字"；
// 长度由 UI 的 `maxlength="10"` 与 `migrate.validate` 两级兜底。静默截断属于"替用户改数据"。
function normalizeLocker(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// "识别到…"要给人看的那份原值。**码行的原值一律不显示**（24 审查 R-16 / R2-08）：
// `pickStation` 在"柜号与码粘连"的行上会取到 `取件码 5号柜600000` 这种**码行**，
// 把它当"识别到的站点名"显示，等于在界面上复述一遍取件码（语义不符，还占位置）。
// ⚠️ 判据用"**带取件码标签**或整段就等于码"，**不用子串包含** —— R2-08 的实测反例：
// 站点名 `西苑3021号柜` 与码 `3021` 只是数字巧合，子串判定会把它误滤成空。
const CODE_LABEL_LIKE = /(取件码|取货码|提货码|取件编号|包裹码|取件号)/;

function rawStationName(value, pickupCode) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (pickupCode && (raw.replace(/\s+/g, '') === pickupCode || CODE_LABEL_LIKE.test(raw))) return '';
  return raw;
}

// 落库站点名**只认 6 个正式名**：人手输/粘贴进来的其它写法一律落成空串。
// 为什么不"就近归一"：并错 = 跑错驿站（SCOPE W4 已否），而空串只是让人多点一次。
function officialStationName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return stations.listStationPoints().indexOf(name) >= 0 ? name : '';
}

/**
 * **批次合并**（纯函数）：一次选了 N 张图、逐张识别之后，把每张的产出并成**一个**待存列表。
 *
 * 为什么必须有这一处（2026-09-26 用户诉求「一次性多选多录入」，SCOPE M3）：
 * 每张图的 `buildDrafts` 都**从 `d0` 开始编号** ⇒ 直接 `concat` 会让第 2 张的行把第 1 张的 key 撞掉
 * （屏上按 `data-key` 找行、保存按 key 定位 ⇒ 撞 key = 行错位/漏存）。所以这里**重新编号**。
 * 另加 `fromImage`（第几张图，0 起）：屏上要能说清"这一行来自第 2 张"，否则 N 张图的结果糊成一片（SCOPE M6）。
 * ⚠️ 三条口径：
 *   ① **一张图没产出不阻断其余**（SCOPE M7）：空/失败的批次只计入 `noItem`，其余照常进列表；
 *   ② **不改入参**（行对象与数组都原样不动）—— 调用方可能还要拿原来的批次结果展示"第 i 张的原文"；
 *   ③ 非对象/缺 `items` 一律当"这张没产出"，⛔ 不抛（页面拿它兜住任何意外形状）。
 * @param {Array<{items?:Array<object>}>} batches 每张图一支
 * @returns {{drafts:Array<object>, total:number, noItem:number}} `drafts` 的 key 已重编为 `d0..d{n-1}`
 */
function mergeBatchDrafts(batches) {
  const list = Array.isArray(batches) ? batches : [];
  const drafts = [];
  let noItem = 0;
  list.forEach((batch, index) => {
    const items = batch && Array.isArray(batch.items) ? batch.items : [];
    if (items.length === 0) noItem += 1;
    for (const row of items) {
      if (!row || typeof row !== 'object') continue;
      drafts.push(Object.assign({}, row, { key: 'd' + drafts.length, fromImage: index }));
    }
  });
  return { drafts: drafts, total: drafts.length, noItem: noItem };
}

module.exports = {
  buildDrafts,
  updateDraft,
  summarizeDrafts,
  saveableDrafts,
  mergeBatchDrafts,
  // R3-12：`isStationUnknown` / `needsStation` 刻意**不导出** —— 生产与自测都只经由
  // `findRowsWithoutStation` 和草稿行上的 `unknown`/`needStation` 两个字段消费它们；
  // 导出去只多一个"人人都能各自判一次"的口子（就是这条等价式原来分叉成五处的机制）。
  findRowsWithoutStation
};
