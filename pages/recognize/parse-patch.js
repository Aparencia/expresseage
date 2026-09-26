// pages/recognize/parse-patch.js · 识别结果 → 页面补丁（**从 `form-parts.js` 搬出来**）
//
// 为什么搬：`form-parts.js` 非空行已 **500/500**（AGENTS §11.1 单文件 ≤500 硬上限），而下一批要改的
// 正是"识别结果怎么写进四格"这一簇 ⇒ 按项目既有做法**先搬迁再改**（同 `./intake-parts.js`、`./session-key-flow.js` 先例）。
// 搬出来的是内聚的一簇：单条预填（`fillFromParse`）+ 站点预填两道（`stationPrefill` / `stationPrefillFromTexts`）
// + 站点那句話（`stationMissedHint`）+ 多码补丁（`buildMultiPatch`）+ 总入口（`planParsePatch`）。
//
// ⛔ **搬迁纪律（本项目因反例付过代价）**：搬函数必须**连依赖一起搬** —— 本文件需要
//    `parse` / `reason` / `stations` / `parcelDrafts` 四件，一件都不能漏。漏了的表现是"只要识别出字就抛
//    `ReferenceError`"（BUG-04，2026-09-26；根因链见 `docs/specs/20260926_recognize_fix/RCA.md`），
//    而它当时躲过了 683 条断言。现在这条纪律有机器闸：`tools/selftest-wave7.js §18`（含"摘掉任一 require 必红"的变异）。
// ⚠️ 依赖单向：本文件**不** require `form-parts.js`（写反了会拿到"还没填完的 exports"，同 intake-parts 那次的坑）。
'use strict';

const parcelDrafts = require('../../utils/parcel-drafts.js');
const stations = require('../../utils/stations.js');
const parse = require('../../utils/parse.js');     // 识别文字行 → 站点/码/柜号/运单后五位
const reason = require('../../utils/reason.js');   // `reasonText`：认不全时那句人话（⛔ 页面不自己拼文案）

/**
 * 单条识别结果 → "只往空框里填"的补丁（M5/M6 的预填纪律）。
 * 为什么从页面里搬出来（r2 的 R2-C05 同族）：这条规则住在页面时 `tools/selftest.js` 够不到，
 * 把 `if (found.x && !draft.x)` 里的 `!draft.x` 删掉，自测仍然全绿 —— 而它的失效模式是
 * "把人改过的值覆盖回识别结果"，那是本页最贵的一类错。
 * ⚠️ 2026-09-25（③ 用户裁决 + 真机反馈）：站点那格**回填时就走内置库归一**，且解析器没给出站点时
 * 走**第二道**（`stationPrefillFromTexts` 拿原文再过一次）；两道都不中 ⇒ `stationMissed` 让页面明说。
 * @param {object} draft 当前三格 ｜ @param {object} found 识别到的字段 ｜ @param {string[]} [texts] 识别原文行
 * @returns {{patch:object, filled:boolean, stationNotice:string, stationMissed:boolean}}
 */
function fillFromParse(draft, found, texts) {
  const row = draft || {};
  const hit = found || {};
  const patch = {};
  let filled = false;
  let stationNotice = '';
  if (!row.stationName) {
    // 站点格**只许写"取件点列表里的正式名"**（用户 2026-09-25 口径：「回填的内置站点是按钮从取件点里选一个里面的站点名称」）：
    // 第一道 = 解析器候选，第二道 = 整段原文；**两道都只认正式名，命不中一律留空**（⛔ 绝不写原文）。
    let station = { stationName: '', notice: '' };
    if (hit.stationName) station = stationPrefill(hit.stationName);
    if (!station.stationName) station = stationPrefillFromTexts(texts);   // ⚠️ 第一道没中必须继续走第二道
    if (station.stationName) {
      patch['draft.stationName'] = station.stationName;
      stationNotice = station.notice;
      filled = true;
    }
    // ⛔ 这里**不置** stationMissed：它由函数尾的"最终态"推出（见下）。旧写法在这个 else 分支里置 true，
    // 于是"第一道没中、第二道命中"时会把 true 带出去 ⇒ 屏上"既填好了又说没认出来"（真机 2026-09-25）。
  }
  if (hit.pickupCode && !row.pickupCode) { patch['draft.pickupCode'] = hit.pickupCode; filled = true; }
  if (hit.lockerNo && !row.lockerNo) { patch['draft.lockerNo'] = hit.lockerNo; filled = true; }
  // ⚠️ 2026-09-26（真机「取件出示快递单号后五位」形态）：运单后 5 位是**另一种取件凭据**，
  // 这张卡上**没有取件码** ⇒ 才回填尾号。两个条件缺一不可：
  //   ① 解析层真的认出了尾号（`hit.trackingTail`，只认"运单/快递单号 后五位"那句话所在的行）；
  //   ② 这张卡**没有**取件码（`!hit.pickupCode && !row.pickupCode`）。
  // 为什么 ② 必须写：`aggregate.pickupTier` 把"`trackingTail` 非空"直接判成「需查明」档 ⇒
  // 有码的卡若也填尾号，会**把一件正常快递错分到"需查明"**（那是本 App 分组口径的根，错不起）。
  if (hit.trackingTail && !hit.pickupCode && !row.pickupCode && !row.trackingTail) {
    patch['draft.trackingTail'] = hit.trackingTail;
    filled = true;
  }
  // stationMissed = "该说而没说"的**最终态**：进来时站点格为空、出去时仍为空、且识别确实给过线索（站点/码/柜号/尾号）。
  // 只要站点格最终有值（无论哪一道填的）⇒ 必须 false；这是本函数的契约，也是屏上两处不再互相打脸的依据。
  const stationMissed = !row.stationName && !patch['draft.stationName']
    && !!(hit.stationName || hit.pickupCode || hit.lockerNo || hit.trackingTail);
  return { patch: patch, filled: filled, stationNotice: stationNotice, stationMissed: stationMissed };
}

/**
 * "站点没认出来"那句的**唯一出处**（页面与断言都从这里取字面量，⛔ 别在页面里再写一遍）。
 * ⚠️ 2026-09-25 真机：这句原被**拼进 `banner`**，而站点格有四个写者（识别 / 失焦归一 / 从取件点选 / 手打）
 * ⇒ 会出现"格子已填好、banner 还在说过期的话"（用户报"站点提示自相矛盾"）。
 * 现在它单独占 `data.stationHint`，并由 wxml 用 `!draft.stationName` 守卫 ⇒ 格子有值就不上屏。
 * ⚠️ 2026-09-26 订正方向词（**TD-030** 的清偿条件 = "随下一次动 `form-parts.js` 的批一起做"，本批正是搬迁它的那次）：
 * 那颗 picker 在 `index.wxml:59` 的**中区滚动块**里，位于上区 `.banner` **之后** ⇒ 原文的"点**上面**"是反的。
 * @param {boolean} stationMissed `fillFromParse` 的最终态结论
 * @returns {string} 要上屏的整句（空串 = 不必说）
 */
function stationMissedHint(stationMissed) {
  return stationMissed
    ? '⚠ 站点没认出来 —— 点下面「从取件点里选一个」，或照着展开的识别原文手填。'
    : '';
}

/**
 * 一图多码（M8）：一批识别结果 → 待存草稿列表 + 屏上计数与文案。
 * @param {Array} items `parse.parseParcelTextMulti` 的 items
 * @param {string} customerId 当前选定客户（人后来换过客户也以此为准）
 * @param {boolean} partial 识别是否可能没读完
 * @returns {{drafts:Array, draftsReady:number, draftsNoCode:number, recognitionUsed:boolean, banner:string, showLines?:boolean}}
 */
function buildMultiPatch(items, customerId, partial) {
  const list = parcelDrafts.buildDrafts(items, { customerId: customerId, source: 'ocr' });
  const sum = parcelDrafts.summarizeDrafts(list);
  let banner = '这图里有 ' + sum.total + ' 件' + (partial ? '（识别可能没读完）' : '')
    + '：每件都可改，核对完点「全部保存」一次存完。';
  // "没判出去哪个点"必须逐件点名（标 ❓）而不是含糊带过：拦空保存时报的就是这几行（R-01）
  if (sum.unknown > 0) banner += ' 有 ' + sum.unknown + ' 件没判出去哪个点（标了 ❓），点一下就能选。';
  const patch = {
    drafts: list,
    draftsReady: sum.ready,
    draftsNoCode: sum.noCode,
    recognitionUsed: true,
    banner: banner
  };
  if (sum.noCode > 0) patch.showLines = true;
  return patch;
}

/**
 * 站点**预填**（③ 裁决「回填规范名 + 命中才回填」；2026-09-25 真机口径：「回填的内置站点是按钮从取件点里选一个里面的站点名称」）。
 * 与 `normalizeStation` 分工：那个决定"写盘值"，这个决定"识别回填什么"；单源 = `stations.matchBuiltinStation`。
 * ⛔ **命不中一律留空，绝不返回原文**：真机实测解析器会把整行（含 `15:14`）当候选，旧写法于是把
 *    `15:14湖工大西苑一栋南面菜鸟驿站` 写进站点格 —— 不在正式名里、banner 还说"已自动填好"（**错值比空更危险**）。
 * ⚠️ 手输路（`stationBlurPatch`）不受此限：人自己打的字允许自建（2026-09-21 裁决）。
 * @param {string} raw 识别出来的站点文本 ｜ @returns {{stationName:string, notice:string}} 命不中 ⇒ 都空串
 */
function stationPrefill(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return { stationName: '', notice: '' };
  const hit = stations.matchBuiltinStation(text);
  if (hit && hit.ok) return { stationName: hit.stationName, notice: '已命中内置站点：' + hit.stationName };
  return { stationName: '', notice: '' };
}

/**
 * 站点回填的**第二道**（2026-09-25 真机反馈「站点回填失效」）：拿整段识别原文再过一次内置站点库。
 * 为什么需要：解析器靠线索词+码型规则表，而那张表长在**转录样本**上（教训卡《样本是转录的 ≠ 真机输出》）；
 * 真机常见形态是"整行**包含**一个正式名"，`matchBuiltinStation` 第 ③ 步正是为它写的（从严：多义不猜）。
 * ⛔ 与 `stationPrefill` 的区别：这里命不中**不返回原文** —— 一整行 OCR 写进站点格是污染不是回填。
 * @param {string[]} texts 识别原文行 ｜ @returns {{stationName:string, notice:string}} 命不中 ⇒ 都空串
 */
function stationPrefillFromTexts(texts) {
  const lines = (Array.isArray(texts) ? texts : []).filter((line) => typeof line === 'string' && line.trim());
  if (lines.length === 0) return { stationName: '', notice: '' };
  const hit = stations.matchBuiltinStation(lines.join(' '));
  if (hit && hit.ok) return { stationName: hit.stationName, notice: '已命中内置站点：' + hit.stationName };
  return { stationName: '', notice: '' };
}

/**
 * 识别结果 → 数据补丁（**纯函数**，2026-09-25 交互改判时从页面搬进零件，2026-09-26 再搬进本文件）。
 * 为什么必须搬：这一簇决定用户**看到什么** —— banner 说"已填好"还是"没认全"、站点提示上不上屏、
 * 多码要不要展开原文、这一屏到底算不算"采信了识别"（落库 `source`）。页面层零断言（TD-016）⇒
 * 把它留在页面里时，把 `parsed.ok` 那支删掉自测仍全绿，而屏上会开始说谎("已自动填好"却没填)。
 * ⚠️ 站点那句**不拼进 banner**（2026-09-25 真机缺陷：banner 说没认出来、格子却有值 —— 那句话的去留
 *    只该由"格子现在有没有值"决定，走独立字段 `stationHint` + wxml 守卫）。
 * @param {{texts:Array<string>, partial?:boolean, draft?:object, customerId?:string}} state
 * @returns {{patch:object}} 直接交给 `setDataMeasured` 的补丁（含 banner / stationHint / lines / recognitionUsed）
 */
function planParsePatch(state) {
  const s = state || {};
  const texts = Array.isArray(s.texts) ? s.texts : [];
  const partial = s.partial === true;
  const multi = parse.parseParcelTextMulti(texts);
  if (multi.ok && multi.items.length > 1) {
    // patch 里有 banner ⇒ 上区高度会变，调用方必须走"先写后量"的出口（R4-02）
    return { patch: Object.assign({ lines: texts, recognizing: false },
      buildMultiPatch(multi.items, s.customerId, partial)) };
  }
  const parsed = parse.parseParcelText(texts);
  // 第三参 = 识别原文：站点回填的第二道（解析器线索词未命中时，按"包含正式名"再认一次）
  const fill = fillFromParse(s.draft, parsed.found, texts);
  const tailNote = partial ? '（识别可能没读完）' : '';
  // ⚠️ 2026-09-26「运单后 5 位」形态（真机原文：`取件出示快递单号后五位…`）：这张卡**没有取件码**，
  //    而 `reasonText('NO_CODE')` 那句是"没认出取件码，请手工填写" ⇒ 屏上会说"没认出来"，
  //    可尾号明明已经填好了（真机用户就是这么反馈的："需要运单号后五位，但是没有识别成功"）。
  //    判据与 `fillFromParse` 同源（都看 `draft.trackingTail` 这一格**最终有没有值**）⇒ 不再自相矛盾。
  const tailOnly = !parsed.ok && parsed.reason === 'NO_CODE' && !!fill.patch['draft.trackingTail'];
  const patch = Object.assign({ lines: texts, recognizing: false }, fill.patch, {
    stationNotice: fill.stationNotice,
    // ⚠️ 缺陷 C（2026-09-26 用户裁决 A）：判据由 `parsed.ok`（解析层找没找到**站名**，`五食堂21栋楼下` 也算找到）换成 `fill.stationMissed`（**站点格的最终态**）—— 两者不同源时屏上会自相矛盾（格子空着却说"已自动填好"）。理由与反方向旧缺陷见 `docs/specs/20260926_recognize_fix/FIX.md §5`；"站点没认出来"那句仍**只在 `stationHint`**（wxml 守卫 ⇒ 人一选点就消失，不会变成过期的话）。
    banner: parsed.ok
      ? (fill.stationMissed ? '取件码认出来了，站点没认出来。' : '已自动填好，请核对后保存（每一格都能改）。') + tailNote
      : (tailOnly
        ? '这张卡用「运单后 5 位」取件 —— 已经填好了，取件码那格留空就行。' + tailNote
        : reason.reasonText(parsed.reason) + tailNote + ' —— 没填的格子照旧手填即可。')
  });
  if (fill.filled) patch.recognitionUsed = true;
  patch.stationHint = stationMissedHint(fill.stationMissed);
  if (fill.stationMissed) patch.showLines = true;
  if (!parsed.ok) patch.showLines = true;   // 没认全时默认展开原文，让人照着抄
  return { patch: patch };
}

// ── 批次（第 2 件「一次性多选多录入」，2026-09-26）：N 张图的产出 → 一屏 ─────────────────────

/**
 * 页面补丁 → **草稿行**（纯函数）：批次要把 N 张图的结果并进同一个列表，
 * 而 `planParsePatch` 的产出是"给单张图用的一屏补丁"（要么多码 `drafts`、要么单条那几格）⇒ 这里做适配。
 * 三条口径：
 *   ① 多码支：`patch.drafts` 原样给出（那些行已经是 `parcel-drafts` 的形状）；
 *   ② 单条支：**只认真的认出了东西的格**（站点/码/柜号/尾号任一非空）⇒ 合成一行；四格全空 ⇒ 空数组
 *      （这张图什么都没认出来 = 计入批次的 `noItem`，⛔ 不硬造一行空的）；
 *   ③ ⛔ **不读 `draft.*` 之外的键**（banner / stationHint / showLines 是屏上的话，不是行数据）。
 * @param {object} patch `planParsePatch` 的产出
 * @returns {Array<object>} 该图贡献的行（可能为空）
 */
function rowsFromPatch(patch) {
  const one = patch || {};
  if (Array.isArray(one.drafts)) return one.drafts.slice();
  const stationName = one['draft.stationName'] || '';
  const pickupCode = one['draft.pickupCode'] || '';
  const lockerNo = one['draft.lockerNo'] || '';
  const trackingTail = one['draft.trackingTail'] || '';
  if (!stationName && !pickupCode && !lockerNo && !trackingTail) return [];
  return [{
    key: 'd0',   // 单张图的临时编号；批次合并时由 `mergeBatchDrafts` 重编
    stationName: stationName,
    pickupCode: pickupCode,
    lockerNo: lockerNo,
    trackingTail: trackingTail,
    unknown: !stationName,
    needStation: !stationName,
    source: 'ocr'
  }];
}

/**
 * 批次识别原文（纯函数）：N 张图各自的原文 → 一段带标号的展示行（SCOPE M6：逐张并列、标清来自第几张）。
 * 为什么加标号：N 张的原文直接拼起来会糊成一片，人没法核对"这行字是哪张图里的"。
 * ⚠️ 只用于**本页显示**（`data.lines`），⛔ 不进解析、不落库、不写日志（D3）。
 * @param {Array<Array<string>>} textsPerImage 每张图的原文行
 * @returns {string[]} 可直接交给 `data.lines` 的数组
 */
function batchLines(textsPerImage) {
  const list = Array.isArray(textsPerImage) ? textsPerImage : [];
  const out = [];
  list.forEach((texts, index) => {
    out.push('— 第 ' + (index + 1) + ' 张 —');
    const lines = Array.isArray(texts) ? texts : [];
    for (const line of lines) out.push(line);
  });
  return out;
}

/**
 * 批次 → 一屏补丁（纯函数）：合并后的行 + 张数读数 → `setDataMeasured` 能直接吃的补丁。
 * 四条口径：
 *   ① `drafts` = 合并后的**全部**行（屏上走多码列表那条 UI；只有 1 行时由下面的 ④ 同步到 `draft.*`）；
 *   ② banner 说**真话**：几张图、几件、有几张没认出东西、有几件没判出去哪个点（⛔ 不把"没产出"含糊带过）；
 *   ③ `recognitionUsed` 只在**真的产出了行**时为 true（否则落库 `source` 会说谎 —— 选过图但一条没填进去 = manual）；
 *   ④ 只有 1 行时，屏上渲染的是**单条那张卡**（wxml 判 `drafts.length <= 1`，它读 `draft.*`）⇒ 必须把这行同步过去，
 *      否则"列表里有 1 件、卡上却是空的"—— 行看不见，人会以为压根没认出来。
 * @param {{merged:{drafts:Array,total:number,noItem:number}, imageCount:number, partialAny:boolean, failedAny:number}} state
 * @returns {object} 页面补丁
 */
function planBatchPatch(state) {
  const s = state || {};
  const merged = s.merged || { drafts: [], total: 0, noItem: 0 };
  const drafts = Array.isArray(merged.drafts) ? merged.drafts : [];
  const sum = parcelDrafts.summarizeDrafts(drafts);
  const imageCount = Number(s.imageCount) || 0;
  const blankImages = Number(merged.noItem) || 0;
  let banner = '这 ' + imageCount + ' 张图里有 ' + sum.total + ' 件'
    + (s.partialAny === true ? '（识别可能没读完）' : '')
    + '：每件都可改，核对完点「全部保存」一次存完。';
  if (blankImages > 0) banner += ' 有 ' + blankImages + ' 张没认出东西（可以手填，或换一张重试）。';
  if (sum.unknown > 0) banner += ' 有 ' + sum.unknown + ' 件没判出去哪个点（标了 ❓），点一下就能选。';
  const patch = {
    recognizing: false,
    drafts: drafts,
    draftsReady: sum.ready,
    draftsNoCode: sum.noCode,
    banner: banner
  };
  if (drafts.length > 0) patch.recognitionUsed = true;
  if (sum.noCode > 0 || blankImages > 0) patch.showLines = true;   // 认不全就默认展开原文，让人照着抄
  if (drafts.length === 1) {
    patch['draft.stationName'] = drafts[0].stationName || '';
    patch['draft.pickupCode'] = drafts[0].pickupCode || '';
    patch['draft.lockerNo'] = drafts[0].lockerNo || '';
    patch['draft.trackingTail'] = drafts[0].trackingTail || '';
  }
  return patch;
}

module.exports = {
  fillFromParse,
  stationMissedHint,
  buildMultiPatch,
  stationPrefill,
  stationPrefillFromTexts,
  planParsePatch,
  rowsFromPatch,
  batchLines,
  planBatchPatch
};
