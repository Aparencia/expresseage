/**
 * utils/parse.js · 门面与编排：柜号提取 + 两个公开入口（parseParcelText / parseParcelTextMulti）
 *
 * ⚠️ 本文件由 `utils/parse.js`（原 688 非空行）按 V6 卡 52（TD-001 偿还）机械切出：
 *   函数体与注释**逐行照搬**，只新增本头、require 与导出。切分前的等价性证据 = 金样本逐字节比对。
 * ⛔ 搬迁纪律（本项目已因反例付过代价）：**搬函数必须同时搬依赖**（常量与 require 一个都不能漏）。
 */
﻿// utils/parse.js · 识别文字行 → 站点名 + 取件码（纯函数；契约见 docs/registry/APIS.md §2）
// 为什么是纯函数：规则一定会改（各家驿站/快递 App 排版不同），把"判断"与"取像素/调 VisionKit"彻底分开，
// 才能在 Node 里零设备地测规则——识别层挂了也不影响规则层的可信度。
//
// ⚠️ 规则来源（2026-09-17 更新）：**6 条真实截图样本**（微信"快递服务"/菜鸟/申通/圆通/淘宝换货页/站点通知文本，
// 台账见 docs/specs/20260917_parse_sources/RESEARCH.md §1）。旧版规则只按想象形态（`菜鸟驿站-3号楼` + `取件码 8-2-3021`）
// 设计，真机实测 6 条里 4 条认不出——所以本批扩了"组合行切分/数字码型/分行标签"。纪律不变：
// **宁可不认也不猜**——猜错会让人把错的站点/取件码存进档案，比"没认出来"代价高得多。

'use strict';
// 柜号清单与「是不是分段码」只在 `utils/stations.js` 定义一处（与 6 个取件点放一起 —— 用户口径是
// 「用与站点一样的方式」）。这里 import 它，**不另写一份**：两份清单必然分叉（教训卡 2026-09-11）。
const stations = require('./stations.js');
const { insertVirtualBreaks, cleanLine } = require('./parse-text.js');
const { splitByCodeLabels, collectCodeCandidates, collectCodeHits, collectTrackingTail } = require('./parse-codes.js');
const { pickStation } = require('./parse-station.js');

// —— 柜号提取（2026-09-19 · v3 字段 `lockerNo`）——
// 口径（用户 2026-09-19 裁决，两轮）：**内置柜台 1-6、用与站点一样的方式、仅在非分段码进行**。
// 即：值域是**封闭集合** `1号柜`…`6号柜`（或空串），只认这 6 个字面串；分段码不取柜号。
//
// 为什么从"自由提取 `N号柜`"改成封闭集合（24 审查 **R-01** 的修法）：自由提取得靠
// "数字前不能是汉字"来排除门牌（`湖工大西苑一栋南门面8号柜` 的 `8号柜`），结果把
// `请到5号柜取件` / `货架3号柜` / `取6号柜` 这些**真柜号**一起拒了（实测 17 例全空）。
// **封闭集合 1~8 就是全部判据**：`请到5号柜取件` → 命中 ✓，`12号楼`/`9号柜` → 不在集合 → 不命中 ✓
/** 柜号清单（1~8）与「是不是分段码」都在 `utils/stations.js` —— 这里只读，不另写一份 */
const LOCKER_OPTIONS = stations.listLockerOptions();

// 共用的清洗管线（单条路径与一图多码路径**必须同源**：规则只该有一份，否则两条路会给出不同答案）。
// `splitLabels` 只给一图多码用：整屏被吐成一整行时，靠"取件码"标签插换行才能切出每张卡片
function cleanLines(lines, splitLabels) {
  return (Array.isArray(lines) ? lines : [])
    .map(cleanLine)
    .filter((line) => line.length > 0)
    // 真机整屏一行的形态先还原成"一个字段一行"（2026-09-17 真机实测，见 FIXTURES.md D1）
    .reduce((acc, line) => {
      const broken = insertVirtualBreaks(line);
      return acc.concat((splitLabels ? splitByCodeLabels(broken) : broken).split('\n'));
    }, [])
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

/**
 * 从若干行文字里取柜号（**只看内置 1~8**；分段码不取）
 * @param {string[]} lines 候选文字行（顺序即阅读顺序）
 * @param {string} [pickupCode] 该条的取件码 —— 分段码时不取柜号（第一段已承担"货架/柜"语义）
 * @returns {string} `5号柜` 形态；取不到 → `''`
 *
 * ⚠️ **不再排除"站点行"**（2026-09-19 用户追问"南面8号柜本来就应该命中？"后改正）：
 *   真机样本里的站点名 `湖工大西苑一栋南门面8号柜` —— 那个 `8号柜` **本来就是柜号**，
 *   "南门面"只是它所在的位置；用户当初说"站点名要这种具体的"，我据此误判成"门牌不算柜号"。
 *   现在：站点行里的 `N号柜` 照样算柜号（它与站点名落在同一行正是真实形态）。
 */
function extractLockerFromLines(lines, pickupCode) {
  if (stations.isSegmentedCode(pickupCode)) return '';
  const list = (Array.isArray(lines) ? lines : []).filter((line) => typeof line === 'string');
  const normalizedCode = typeof pickupCode === 'string' ? pickupCode.replace(/\s+/g, '') : '';
  // ① 先看**与取件码同一行**的那行（真机形态 `5号柜 | 取件码 5号柜600000`：柜号与码同行）
  if (normalizedCode) {
    const codeLine = list.filter((line) => line.replace(/\s+/g, '').indexOf(normalizedCode) >= 0)[0] || '';
    const onCodeLine = firstLockerIn(codeLine);
    if (onCodeLine) return onCodeLine;
  }
  // ② 再看其余各行（**包括站点行**，见上面的 ⚠️），取最靠前的那个
  for (const line of list) {
    const found = firstLockerIn(line);
    if (found) return found;
  }
  return '';
}

/** 一段文字里**最靠前**的那个内置柜号（同一段可能有多个 → 与"从上到下读"一致）；没有返回 '' */
function firstLockerIn(text) {
  if (typeof text !== 'string' || text === '') return '';
  // 先去掉空白再找：OCR 会把 `5号柜` 吐成 `5 号柜`（与 CODE 值处理同一纪律）
  const body = text.replace(/\s+/g, '');
  let best = '';
  let bestAt = -1;
  for (const option of LOCKER_OPTIONS) {
    let at = body.indexOf(option);
    // ⚠️ **数字边界**（24 审查 r2 **R2-04**，实测：`12号柜`→`2号柜`、`15号柜`→`5号柜`、`17号柜台`→`7号柜`）：
    // 纯子串匹配会把"两位数柜号"当成个位数柜号、还会一路落库 —— 与"宁可不填也不填错"正相反。
    // 判据：柜号**前一位不能是数字**（允许行首 / 汉字 / 标点）。
    while (at >= 0) {
      const before = at > 0 ? body.charAt(at - 1) : '';
      if (!/[0-9]/.test(before)) break;
      at = body.indexOf(option, at + 1);
    }
    if (at < 0) continue;
    if (bestAt < 0 || at < bestAt) { best = option; bestAt = at; }
  }
  return best;
}

/**
 * 从识别出的文字行里抽出站点名与取件码（纯函数：同输入必同输出，不碰 wx、不读写存储）
 * @param {string[]} lines 识别层（utils/ocr.js）输出的文字行，顺序即识别顺序
 * @returns {{ok:boolean, stationName?:string, pickupCode?:string, lockerNo?:string, reason?:string, found:{stationName:string, pickupCode:string, lockerNo:string, trackingTail:string}}}
 *   ok=true  → 顶层带 stationName/pickupCode/lockerNo，且与 found 一致（页面两条路径同源）
 *   ok=false → reason ∈ NO_STATION | NO_CODE | AMBIGUOUS；**顶层字段不存在**
 *   **found 永远带上能认出来的部分**（含 `lockerNo`/`trackingTail`，取不到就是空串）——页面据此"认出一半就先预填一半"
 */
function parseParcelText(lines) {
  const cleaned = cleanLines(lines, false);

  const stationName = pickStation(cleaned);
  const candidates = collectCodeCandidates(cleaned);
  const pickupCode = candidates.length === 1 ? candidates[0] : '';
  // 柜号独立于"码是否唯一"：多义时也可能已经认出柜号（认一半也带一半）
  const lockerNo = extractLockerFromLines(cleaned, pickupCode);
  // 运单后 5 位（2026-09-26 真机「取件出示快递单号后五位」形态）：**只在没有取件码时**才认 ——
  // 有码的卡上它是多余信息，而 `aggregate.pickupTier` 把"trackingTail 非空"判成「需查明」档
  // ⇒ 有码也填会把正常件错分（口径与 `parse-patch.fillFromParse` 同一处，⛔ 两边不许分叉）。
  const trackingTail = pickupCode ? '' : collectTrackingTail(cleaned);

  const found = { stationName: stationName, pickupCode: pickupCode, lockerNo: lockerNo, trackingTail: trackingTail };
  if (!stationName) return { ok: false, reason: 'NO_STATION', found };
  if (!pickupCode) {
    // 有多个互不相同的候选码 → 不替用户挑（挑错 = 拿着别人的码去驿站）
    return { ok: false, reason: candidates.length > 1 ? 'AMBIGUOUS' : 'NO_CODE', found };
  }
  return { ok: true, stationName, pickupCode, lockerNo, found };
}

/**
 * 一图多码：把整屏切成"一张卡片一条"，逐条给码 + 该条附近的原文（纯函数）
 * @param {string[]} lines 识别层（utils/ocr.js）输出的文字行
 * @returns {{ok:boolean, items:Array<{pickupCode:string,stationName:string,segment:string,lineIndex:number}>, reason?:string}}
 *   ok=false → `reason='NO_CODE'`（一个码都没认出来；**宁可不认也不猜**），此时 `items` 为空数组
 *   `stationName`：该段里"像站点名"的原值，**可能为空串**（如 `五食堂21栋楼下` 不含站点关键词——
 *     本项目站点名形态远多于"驿站"这一类词）。页面**不要把空串当失败**：码还在，人去点一下即可。
 *   `lockerNo`：该条的柜号（v3，2026-09-19）—— **只认内置 1~8 号柜**、分段码不取；空串 = 未知
 *   `segment`：该条附近的清洗后原文（含标题行～下一张卡片标题之前）。"去哪取"由页面把它与 `pickupCode`
 *     一起交给 `stations.inferStation` —— 解析层不推导取件点。
 */
function parseParcelTextMulti(lines) {
  const cleaned = cleanLines(lines, true);
  const hits = collectCodeHits(cleaned);
  if (hits.length === 0) return { ok: false, reason: 'NO_CODE', items: [] };
  // 版面判定**整屏一次**（一屏只会是一种 OCR 吐字形态；按条判会让末条误判——末条没有"下一条"可算间距。
  // 24 审查 R2-01 的修复要求：**start 与 end 必须跟着同一套判断走**）。
  // 相邻码行间距 ≥3 = 版面 A（一字段一行：标题 / 码行 / 站点行…）；否则 = 版面 B（整屏一行被拆开）
  const layoutA = hits.some((hit, order) => order > 0 && hit.index - hits[order - 1].index >= 3);
  const items = hits.map((hit, order) => {
    const next = hits[order + 1];
    // 段边界（24 审查 **R-04** 修复 + **R2-01** 二次修复）
    //   · 版面 A：本条 = [自己的标题行, 下一张标题行之前)——标题行是**本条**的（`FIXTURES.md:35` 观察 2）
    //   · 版面 B：本条 = [自己的码行, 下一张的码行) —— **不取码行上一行**：整屏一行被拆时，
    //     那一行是**上一张的站点行**。R2-01 实测：取了它会用上一张的高优先线索覆盖本条 → **跑错点**；
    //     不取则本条仍拿得到自己码行之后那行（= 自己的站点文字），最坏退化成"没线索 → 留空 + ❓问客户"，
    //     即失效模式从"跑错驿站"降级为"多问一句"（用户口径：绝不猜点）。
    // ⚠️ 残留（已登记 `STATION_MAP.md` §5 ⚠️-6，各有断言钉住）：版面 B 下"上一条站点 + 下一条标题"
    //    共处一行时，**这一行只能归上一条**——若它其实只是下一条的标题（不含上一条的站点文字），
    //    上一条会被它带偏；下一条则退化为码形兜底（**不判错点**）。
    const start = order === 0 ? 0 : (layoutA ? hit.index - 1 : hit.index);
    const gap = next ? next.index - hit.index : 0;
    const end = next ? (layoutA ? next.index - 1 : next.index) : cleaned.length;
    const segmentLines = cleaned.slice(start, Math.max(end, hit.index + 1));
    const stationName = pickStation(segmentLines);
    return {
      pickupCode: hit.code,
      stationName: stationName,
      // 柜号（v3）：先看**本条码行**（真机里柜号常与码同行），再看整段；站点名里已用掉的门牌不算
      lockerNo: extractLockerFromLines(segmentLines, hit.code),
      segment: segmentLines.join(' '),
      lineIndex: hit.index
    };
  });
  return { ok: true, items: items };
}


module.exports = { parseParcelText, parseParcelTextMulti };
