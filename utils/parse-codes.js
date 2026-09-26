/**
 * utils/parse-codes.js · 取件码层：带标签/裸码/纯数字三条收集路 + 去重与多义判定（只依赖 parse-text）
 *
 * ⚠️ 本文件由 `utils/parse.js`（原 688 非空行）按 V6 卡 52（TD-001 偿还）机械切出：
 *   函数体与注释**逐行照搬**，只新增本头、require 与导出。切分前的等价性证据 = 金样本逐字节比对。
 * ⛔ 搬迁纪律（本项目已因反例付过代价）：**搬函数必须同时搬依赖**（常量与 require 一个都不能漏）。
 */
'use strict';
const { CODE_SHAPE, isCodeLength, isNoiseLine, pushUnique } = require('./parse-text.js');

// 取件码的"白名单码型"：本项目样本为 `8-2-3021`（多段短数字），另留两类常见形态。
// 单段纯数字**不认**——电话号码、金额、序号都会命中，误报代价高于漏报。
const BARE_CODE_PATTERNS = [
  // 首段 1~3 位：真实样本 B 的 `103-2-6021` 是**货架号 103**，旧规则只允许 1~2 位 → 当时认不出
  /^(\d{1,3}(?:-\d{1,4}){1,3})$/,        // 8-2-3021 / 1-16-8 / 103-2-6021
  /^([A-Za-z]{1,2}\d{1,2}-\d{1,4}(?:-\d{1,4})?)$/, // A2-3-1024（带字母前缀的分段码）
  /^(\d{1,3}-\d{1,4}[A-Za-z]{1,3})$/,     // 3-1024A（尾部字母）
  /^([A-Za-z]{1,3}\d{5,12})$/,            // SF1234567890 形态的短码
  /^([A-Za-z]{1,2}\d{1,2}-\d{4})$/        // Z1-0470（字母前缀 + 单段数字，样本 E）
];

// 取件码类标签（分行样本 A 靠它触发"向后看一行"）。**只有明确写了"取件码"这类词才算带标签**——
// "联系电话: 18274177731" 不算，所以那个 11 位号码不会被当成码
const CODE_LABEL = /(取件码|取货码|提货码|取件编号|包裹码|取件号)/;

// 单段纯数字码（样本 A `677426`、D `079022`）：4~6 位，**汉字/字母/分隔符一律不接受**
// （"12号楼""8号柜""查收3"都会因此被挡在外面——它们的误报代价高于漏报）。
// ⚠️ 这里的 `{4,6}` 与 `isCodeLength` 的短码档**是同一个约束的两道表述**（用户规则："取件码较短"）：
//    改动任一处都必须同步另一处，否则两者会打架（变异实验显示：单独放开这里不会漏，因为长度闸同档兜住）
const PURE_DIGIT_CODE = /^\d{4,6}$/;

// 标签后紧跟的柜号（`取件码 5号柜`）——只匹配**紧跟标签**的那一处，不动行首的 `5号柜 |`
const LABEL_THEN_LOCKER = /((?:取件码|取货码|提货码|取件编号|包裹码|取件号)\s*[:：]?\s*)\d{1,3}\s*号[柜架]/g;

const CODE_LABEL_G = /(取件码|取货码|提货码|取件编号|包裹码|取件号)/g;

// 标签后紧跟的值；`(?![\d])` 防的是"取件码 12号楼架空层"这类——标签后接数字开头的地址时不能截出 "12"。
// ⚠️ 这里**故意不写**结尾边界断言（如 `(?![\dA-Za-z\-_#])`）：2026-09-17 批 3 的变异实验显示，
//    去掉它行为完全不变——长串被截断后的值同样过不了 `isCodeLength`（长度/字母位），加它只是噪声
function firstCodeAfterLabel(line) {
  // `取件码 5号柜600000`（样本 S1 的 #2/#3）：标签后先来**柜号**，真码在它后面。
  // 旧实现在这一形态上**整条标签路径放弃**——实测机制：`[A-Za-z0-9]` 吃掉柜号的 `5` 后，`{1,23}` 要求
  // 至少再来一个同类字符，下一个却是"号" → 回溯失败 → `exec` 返回 null（5 条实测样本里只有这两条是 null）。
  // 单条路径当时靠"行尾纯数字"兜住了所以没暴露；**一图多码按行取码，兜不住** → 必须在这里剥掉柜号。
  // 2026-09-19 · 24 审查 R-11：原注释把机制写反了（写成"会把 5 当成码"），此处按实测订正。
  const prepared = line.replace(LABEL_THEN_LOCKER, '$1');
  // 必须有分隔符（码/：/空格）：没有的话"取件码查询"这类标题会被截成"查询"
  const match = prepared.match(/(?:取件码|取货码|提货码|取件编号|包裹码|取件号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_#]{1,23})(?![\d])/);
  if (match && CODE_SHAPE.test(match[1])) return { value: match[1], pickup: CODE_LABEL.test(line) };
  // ⚠️ 2026-09-26 **真机原文**（用户 09:24 截图「识别原文（1 行）」，样本已入 fixtures §20）：
  //    整屏被吐成**一整行**，而卡片上"码"是大字、"取件码"三个字排在它**后面** ⇒ 真机文本是
  //    `…湖南工业大学(河校区)111-1-1111取件码复制查看更多物流明细…` —— **值在标签前面**。
  //    旧实现只认"标签后跟值" ⇒ 这一形态整条标签路放弃（长度闸连发挥的机会都没有）⇒ 那一屏报 NO_CODE
  //    （真机 banner 原文：「没认出取件码，请手工填写。」）。这里补**值在标签前**的第二条路：
  //    `(?<![\w\-_#])` 是左边界（防从长号码中间截出一段），长度闸仍由调用方 `isCodeLength(v, true)` 兜
  //    （15 位运单号那类会被它挡掉）。
  const before = prepared.match(/(?<![\w\-_#])([A-Za-z0-9][A-Za-z0-9\-_#]{1,23})(?=(?:取件码|取货码|提货码|取件编号|包裹码|取件号))/);
  if (!before || !CODE_SHAPE.test(before[1])) return { value: '', pickup: false };
  return { value: before[1], pickup: true };
}

// —— 取件码提取 ——
// 带标签与不带标签两条路**产出同一种结构**（候选去重后的数组），"挑一个还是报多义"的裁决只在 parseParcelText 里做一次。
// 曾经写成"命中就 return 第一个"——自测当场抓出：两个带标签的码会被静默挑走第一个，等于替用户选码。
function collectLabeledCodes(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ⚠️ 2026-09-26（真机原文 §20）：**先剥时间再判噪声** —— 与 `collectPureDigitCodes` 同口径。
    //    真机把整屏吐成一行时，时间（`待取件09-25 12:00`）与取件码处在**同一行**，旧写法整行被判噪声
    //    ⇒ 真码连坐丢掉（这正是 `parse-text.js` 里记着的 R-11 已知盲区，两轮真机（09:01/09:24）把它撞实了）。
    //    只放宽"时间"这一种：单号/电话/金额所在行仍然整行跳过。
    if (isNoiseLine(stripTimeToken(line))) continue;
    const labeled = firstCodeAfterLabel(line);
    if (labeled.value && isCodeLength(labeled.value, labeled.pickup)) pushUnique(found, labeled.value);
    continueCollectNextLine(lines, i, found);
  }
  return found;
}

// 标签单独占一行时的兜底（真实样本 A：`取件码` 一行、`677426` 下一行）
// 只接受上下紧邻一行，且值必须过 CODE_SHAPE——避免把远处的无关数字牵进来
function continueCollectNextLine(lines, index, found) {
  const current = lines[index];
  if (CODE_LABEL.test(current) && current.replace(CODE_LABEL, '').replace(/[\s:：,，。.、]/g, '') !== '') return;
  if (!CODE_LABEL.test(current) || index + 1 >= lines.length) return;
  const next = lines[index + 1];
  if (isNoiseLine(next)) return;
  const value = next.replace(/\s+/g, '');
  if (CODE_SHAPE.test(value) && isCodeLength(value, true)) pushUnique(found, value);
}

// 单段纯数字码（样本 A `677426`、D `079022`）：**独占一行**、4~6 位、且该行没有任何汉字/字母
// （"12号楼""8号柜""查收3"都因此出局）；带标签的那种由 collectLabeledCodes 负责，这里只兜无标签的。
// 另外兜**行尾纯数字**：真机把码粘在长行末尾（`…湖工大西苑一栋南面7号柜079022`），其后才是"取件码:"标签
function collectPureDigitCodes(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ⚠️ 顺序要紧：**先剥时间再判噪声**。反之则"时间与码同行"会被整行 continue 掉，真码连坐丢失
    // （真机实测 `…待取件今天09:23…7号柜079022` 整行被判噪声；TD-024 记的就是这个取舍）
    const withoutTime = stripTimeToken(line);
    if (isNoiseLine(withoutTime)) continue;
    const value = withoutTime.replace(/\s+/g, '');
    if (PURE_DIGIT_CODE.test(value) && isCodeLength(value, false) && !isPureDigitCodeLine(lines, i)) {
      pushUnique(found, value);
      continue;
    }
    const tail = trailingDigitRun(withoutTime);
    if (tail && isCodeLength(tail, false)) pushUnique(found, tail);
  }
  return found;
}

// 行尾的纯数字段：`…7号柜079022` → `079022`。
// ⚠️ 否定条件 `(?<![\d\-_#])` 必需：前面若还是数字/分隔符，那是**被切开的长号码或分段码的尾巴**
// （`103-2-6021` 的 `6021`、`2-3-1024` 的 `1024` 都因此不再被误认；2026-09-17 实测抓到）
function trailingDigitRun(line) {
  const match = line.match(/(?<![\d\-_#])(\d{4,6})$/);
  return match ? match[1] : null;
}

// 就地剥掉"时间"片段：真机整屏一行时，时间与码同处一行，行级噪声判定会把整行连同真码一起丢掉。
// ⚠️ 只剥时间这一种：单号/电话所在行仍然整行跳过——它们的数字形状与码最像，误认代价最高
function stripTimeToken(line) {
  return line.replace(/(^|[^\d])\d{1,2}:\d{2}(?![:\d])/g, '$1');
}

// 这一行的纯数字是否已经由"标签"路径收走了（样本 A：上一行是"取件码"）→ 避免同一个码被算成两个候选
function isPureDigitCodeLine(lines, index) {
  if (index === 0) return false;
  const previous = lines[index - 1];
  return CODE_LABEL.test(previous)
    && previous.replace(CODE_LABEL, '').replace(/[\s:：,，。.、]/g, '') === '';
}

function collectBareCodes(lines) {
  const found = [];
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const normalized = line.replace(/\s+/g, '');
    if (normalized.length > 24) continue; // 长行是正文/地址，不是码
    for (const pattern of BARE_CODE_PATTERNS) {
      const match = normalized.match(pattern);
      // 码型命中还不够：**长度**是第二道闸（用户判据"编号/电话等较长"）——
      // 无标签的 11 位手机号、21 位订单号不会因为"长得像分段码"就过关
      if (match && isCodeLength(match[1], false)) { pushUnique(found, match[1]); break; }
    }
  }
  return found;
}

// —— 运单后 5 位（2026-09-26 **真机原文**形态，见 `tools/selftest-wave7.js §21`）——
// 卡片上写的是 `取件出示快递单号后五位 88888`：这一形态的**取件凭据不是取件码，而是运单号的后五位**。
// 本 App 早有专门的字段（`Parcel.trackingTail`，库里强制"**恰好 5 位数字**"或空串），保存路径
// （`pages/recognize/intake-parts.js` 的 `planSingleSave`）也早已支持它 —— 尾号会记成「尾号NNNNN」并进
// 「需查明」档。缺的只是**识别端从不回填它**（用户 2026-09-26 反馈：「需要运单号后五位，但是没有识别成功」）。
// 判定两步，从严：
//   ① 卡片上**必须有**「（快递单号|运单号|运单）后（五|5）位」这句话 —— 没有这句话就不是这种卡（⛔ 不猜）；
//   ② 取值优先用卡片上印的那 5 位；**印的那串不足 5 位时退回"运单号末五位"** —— 真机实测
//      `取件出示快递单号后五位1111分享取件9菜鸟驿站…` 里第 5 位被下一个锚点切断了（`5386` 只有 4 位，
//      直接拿它会过不了"恰好 5 位"的字段闸），而卡片上同一行的运单号 `100000000011119` 末五位 = `11119`
//      正是用户口径里的"运单号后五位" ⇒ 这条路既救回真值，也不需要猜。
const TAIL_PHRASE = /(快递单号|运单号|运单)\s*后\s*(?:五|5)\s*位/;
const TAIL_PRINTED = /(?:快递单号|运单号|运单)\s*后\s*(?:五|5)\s*位\s*[:：]?\s*(\d{5})(?!\d)/;
// 运单号形态：`韵达快递:100000000011119` / `圆通快递：YT0000000088888`。**必须有承运商词 + 冒号**，
// 否则 `快递员:吴洪涛`、正文里的裸数字都会被当成运单号（真机原文里这两者同处一行）。
const TRACKING_NO = /(?:圆通|中通|申通|韵达|顺丰|京东|极兔|邮政|EMS|德邦|天天|百世|菜鸟)快递\s*[:：]\s*([A-Za-z]{0,4}\d{8,20})/;

/**
 * 从识别文字行里取"运单后 5 位"（纯函数）
 *
 * ⚠️ 为什么要**带窗口**（2026-09-26 真机实测）：整屏一行会被 `insertVirtualBreaks` 在承运商词前切开
 * （`…后五位1111` | `韵达快递:100000000011119复制…`）⇒ **那句话与运单号常常不在同一行**。
 * 只认同一行时真机读数就是空串（本函数第一版正是这样，被 `§21` 探针当场抓到）。
 * 探测顺序：**那句话所在行 → 下一行 → 上一行 → 再外一层**（就近优先；⛔ 不做全屏模糊搜索，
 * 免得把别张卡片的运单号牵过来）。
 * @param {string[]} lines 识别原文行 ｜ @returns {string} 恰好 5 位数字；取不到 / 不成形 ⇒ 空串
 */
function collectTrackingTail(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter((one) => typeof one === 'string');
  let phraseAt = -1;
  for (let i = 0; i < list.length; i++) {
    if (TAIL_PHRASE.test(list[i])) { phraseAt = i; break; }
  }
  if (phraseAt < 0) return '';
  for (const at of [phraseAt, phraseAt + 1, phraseAt - 1, phraseAt + 2, phraseAt - 2]) {
    const line = list[at];
    if (typeof line !== 'string') continue;
    // 卡片上直接印的那 5 位：只认**那句话所在行**（它就贴在短语后面）
    if (at === phraseAt) {
      const printed = line.match(TAIL_PRINTED);
      if (printed) return printed[1];
    }
    const tracking = line.match(TRACKING_NO);
    if (tracking && tracking[1].length >= 5) return tracking[1].slice(-5);
  }
  return '';
}

// 三级候选池（**同级合并、跨级优先**，2026-09-17 批 2 定）：
// ① 带标签（强语义；含"标签单独一行"向后看一行）
// ② 无标签时：白名单码型（`103-2-6021`）× 独占短行的纯数字码（`677426`）**合池**——
//    少了这一步，"纯数字码 + 分段码同屏"会被逐级短路，多义就不再报，等于替用户挑码
// ③ 都没有 → 回落到白名单码型单独成池（保住"宁可不认也不猜"：无码可认时也不把统计数字当码）
function collectCodeCandidates(lines) {
  const labeled = collectLabeledCodes(lines);
  if (labeled.length > 0) return labeled;
  const bare = collectBareCodes(lines);
  const digits = collectPureDigitCodes(lines);
  const merged = bare.concat(digits.filter((code) => bare.indexOf(code) < 0));
  return merged.length > 0 ? merged : bare;
}

// —— 一图多码（2026-09-19 · M1）——
// 为什么单开一条路：单条版遇到同屏多个码时**故意报 AMBIGUOUS 不挑**（挑错 = 拿着别人的码去驿站）。
// 一图多码要的不是"挑一个"，而是"**全都列出来**" → 以"取件码"标签为锚把整屏切成一张卡片一段，
// 每段各取各的码，再把该段原文交给 `stations.inferStation` 判"去哪取"。
// ⚠️ 解析层**不碰"6 个取件点"的知识**（那是 `utils/stations.js` 的事）：这里只产出码 + 该段原文，
//    否则同一份站点规则会长出第二份，必然分叉（教训卡 2026-09-11：规则与样例分叉时样例会赢）。

// 每个"取件码"标签前插换行（整屏一行形态下的**卡片锚点**）
function splitByCodeLabels(line) {
  return line.replace(CODE_LABEL_G, '\n$&').replace(/^\n/, '');
}

// 逐行收集"码 + 行号"。**值提取复用单条路径那套白名单与长度闸**（BARE_CODE_PATTERNS / PURE_DIGIT_CODE /
// trailingDigitRun / isCodeLength），这里多出来的只是"位置"——单条版的收集器只返回值、丢掉位置，而切段必须要位置。
// 因此这里是**编排**的重复，不是规则的重复：规则表一处没加。
function collectCodeHits(lines) {
  const labeled = [];
  const loose = [];
  for (let i = 0; i < lines.length; i++) {
    const labeledHit = labeledCodeAt(lines, i);
    if (labeledHit) pushHit(labeled, labeledHit, i);
    const looseHit = looseCodeAt(lines, i);
    if (looseHit) pushHit(loose, looseHit, i);
  }
  // R-05（用户 2026-09-19 裁决"改成并集"）：**有标签的与无标签的都要**。
  // 旧口径"有标签就不看无标签的"抄自单条路径——那里是为了挡住统计数字，但在一图多码里它的代价是
  // **混排一屏只报 1 件**（用户根本不知道漏了）。改成并集：可能多出一行统计数字（用户一眼能删），
  // 但不会再静默漏件。按行号排序，保持"从上到下"的阅读顺序（段边界依赖行号单调）。
  const merged = labeled.slice();
  for (const hit of loose) pushHit(merged, hit.code, hit.index);
  return merged.sort((a, b) => a.index - b.index);
}

// 带标签的码：① 标签同行取值 ② 标签独占一行时看下一行（样本 A 形态）
function labeledCodeAt(lines, index) {
  const line = lines[index];
  // ⚠️ 2026-09-26（真机原文 §20）：与 `collectLabeledCodes` 同一处放宽 —— 先剥时间再判噪声
  if (isNoiseLine(stripTimeToken(line))) return '';
  const hit = firstCodeAfterLabel(line);
  if (hit.value && isCodeLength(hit.value, hit.pickup)) return hit.value;
  if (!CODE_LABEL.test(line) || index + 1 >= lines.length) return '';
  if (line.replace(CODE_LABEL, '').replace(/[\s:：,，。.、]/g, '') !== '') return '';
  const next = lines[index + 1];
  if (isNoiseLine(next)) return '';
  const value = next.replace(/\s+/g, '');
  return CODE_SHAPE.test(value) && isCodeLength(value, true) ? value : '';
}

// 无标签的码：独占短行的纯数字 / 行尾纯数字段 / 白名单码型（顺序即优先级，与单条版一致）
function looseCodeAt(lines, index) {
  const line = lines[index];
  // ⚠️ 先剥时间再判噪声（与 collectPureDigitCodes 同因：否则"时间与码同行"会连坐丢掉真码）
  const withoutTime = stripTimeToken(line);
  if (isNoiseLine(withoutTime)) return '';
  const normalized = withoutTime.replace(/\s+/g, '');
  if (PURE_DIGIT_CODE.test(normalized) && isCodeLength(normalized, false)
    && !isPureDigitCodeLine(lines, index)) return normalized;
  const tail = trailingDigitRun(withoutTime);
  if (tail && isCodeLength(tail, false)) return tail;
  if (normalized.length > 24) return ''; // 长行是正文/地址，不是码
  for (const pattern of BARE_CODE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && isCodeLength(match[1], false)) return match[1];
  }
  return '';
}

// 同一个码在屏上出现多次（OCR 重影 / 同一卡片被切两半）→ **只留第一次**（用户口径"同图同码去重"）
function pushHit(found, code, index) {
  if (found.some((one) => one.code === code)) return;
  found.push({ code: code, index: index });
}

module.exports = { firstCodeAfterLabel, collectLabeledCodes, continueCollectNextLine, collectPureDigitCodes, trailingDigitRun, stripTimeToken, isPureDigitCodeLine, collectBareCodes, collectCodeCandidates, splitByCodeLabels, collectCodeHits, labeledCodeAt, looseCodeAt, pushHit, collectTrackingTail, BARE_CODE_PATTERNS, CODE_LABEL, PURE_DIGIT_CODE, LABEL_THEN_LOCKER, CODE_LABEL_G };
