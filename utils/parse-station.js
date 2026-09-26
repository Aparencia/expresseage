/**
 * utils/parse-station.js · 站点层：从脏行里抽站点候选并挑一个（只依赖 parse-text）
 *
 * ⚠️ 本文件由 `utils/parse.js`（原 688 非空行）按 V6 卡 52（TD-001 偿还）机械切出：
 *   函数体与注释**逐行照搬**，只新增本头、require 与导出。切分前的等价性证据 = 金样本逐字节比对。
 * ⛔ 搬迁纪律（本项目已因反例付过代价）：**搬函数必须同时搬依赖**（常量与 require 一个都不能漏）。
 */
'use strict';
const { stripDecoration, hasStationNoise, stationNoiseCut, truncate } = require('./parse-text.js');

const MAX_FIELD_LEN = 40; // 与 utils/migrate.js 的 isNonEmptyString(x, 40) 同口径，避免解析层产出落不了库的值

// 站点行的强特征：出现任一即视为"这行在说站点"
const STATION_KEYWORDS = ['驿站', '快递站', '快递超市', '代收点', '收发室', '快递服务点', '服务点', '自提柜', '快递柜', '菜鸟', '妈妈驿站', '网点'];

// 数字门牌式站点：真实样本里两种形态并存——`6号柜`（纯数字+柜）与 `南门面8号柜`（位置词+数字+柜）。
// ⚠️ 前置否定 `(?<!\d)` 必需：OCR 会把门牌与相邻数字粘成一串（真机原文 `…南面7号柜…7号柜079022取件码:`），
// 没有它会把粘字造成的破损门牌当成站点证据（2026-09-17 真机实测）
const STATION_PATTERNS = [/(?<!\d)\d{0,3}\s*号柜/, /(?<!\d)\d{0,3}\s*号架/];

// "具体位置"标记：站点名要**具体到门牌**才有分组价值（用户 2026-09-17 口径："要 湖工大西苑一栋南门面8号柜
// 这种具体的，而不是 妈妈驿站代收点 这种宽泛的"）。管道两侧都有内容时，靠它决定取哪一侧
const SPECIFIC_PLACE = /(栋|幢|单元|号|楼|柜|架|门面|侧|旁|对面|区|路|街|苑|村|组)/;

// 「××店」只认**地点词 + 店**结尾的组合（样本 E「工业大学西苑店」），单看"店"会把便利店/商店当驿站
const STATION_SHOP_PATTERN = /(大学|学院|校区|社区|小区|苑|栋|楼|广场|中心|工业|科技|产业园)[^\s]{0,6}店(?!主)/;

// 明确不是站点名的东西：快递公司名、无信息量的泛称
const STATION_DENY = ['中通', '圆通', '韵达', '申通', '顺丰', '京东', '极兔', '邮政', 'EMS', '德邦', '丰巢'];

// 促销/评价类水词：含这些词的行优先级最低（快递 App 截图里这类行最多）
const PROMO_HINTS = ['好评', '评价', '五星', '红包', '优惠', '扫码', '关注', '下载', '推荐', '客服', '售后服务', '领券', '积分'];

// 组合行切分（样本 F 真机形态：站点名与详细地址被 OCR 并成一行）：
// 分隔符 = 竖线/全角竖线/制表符/空白（样本 A 的"代收点"与站点名之间就是一个空格）
const LINE_SEPARATOR = /[|｜\t]|\s+/;

// 地址起头词：站点名到此为止（"湖南省株洲市天元区…"里的省市区）
const ADDRESS_START = /(省|市|区|县|镇|乡|街道|路|街|大道|村|组|工业大学|大学|学院)/;

// 站点名尾部常见的门牌/位置词：出现在关键词之后就仍属站点名，不能砍
// （前导空格必须先去：`快递服务点 12号楼架空层` 的 rest 是" 12号楼架空层"，带空格会被判成未知尾巴）
const STATION_TAIL_OK = /^(号|栋|幢|单元|门面|门|侧|旁|对面|-|\d)/;

// 站点名末尾修饰词（"妈妈驿站代收点"里的"代收点"承载驿站名，不能砍）
const STATION_TAIL_WORDS = ['代收点', '快递超市', '快递服务点', '服务点', '收发室', '自提柜', '快递柜'];

// 数字门牌（`6号柜`）单独成段时，把**上一段地点词**接回来（`湖工大西苑一栋南面` + `6号柜`）。
// 只接**不含数字、不含噪声词、≤12 字**的上一段——避免把"订单编号""联系站点"这类邻字段接进来
const PLACE_FRAGMENT_MAX = 12;

const REPEAT_MIN_LEN = 6;    // 重复段至少 6 字

const REPEAT_MIN_HAN = 3;    // 且至少 3 个汉字（纯数字/符号的重复不算，如 `0909`）

// —— 站点名提取 ——
// 打分而不是取第一个命中：截图顶部常有一行快递公司名（如"中通快递"），直接取第一个会取错
// 纯泛称：整段只有一个通用后缀（`代收点`/`驿站`/`服务点`），不含任何地名——它必定是时间线文字里
// 蹭到的片段（真机样本里的"…已放入代收点南路…"），不是站点名（2026-09-17 批 3 实测踩到）
const GENERIC_STATION_WORDS = ['驿站', '代收点', '快递站', '快递超市', '服务点', '收发室', '自提柜', '快递柜', '网点', '妈妈驿站'];

// 已知取舍（2026-09-17 审查 R-11）：噪声判定是**行级**的——若"取件码"与"20:00"出现在同一行，
// 这一行会被整行跳过、真码漏掉。选择保持现状的理由：行内做值级过滤无法区分"20:00 是时间"还是"是码的一部分"，
// 误报（认错码）的代价是让人拿着别人的码去驿站，高于漏报（认不出→手工填）。等真实样本出现再决定要不要细化。

// 这行像不像"在说站点"：命中词必须**有实义前缀**（"驿站"单独出现不算站点），
// 且命中词正好收尾时也算弱证据（"妈妈驿站代收点"里承载驿站名的是"代收点"，整行不该因"驿站"在尾部被裁）
function stationSignal(text, keyword) {
  const rest = text.split(keyword).join('').replace(/[\s\-—:：>|｜]/g, '');
  return { hasPrefix: rest.length >= 2, atTail: text.lastIndexOf(keyword) + keyword.length === text.length };
}

// 这行像不像"在说站点"，并给出命中的特征（词表优先，数字门牌与地点+"店"次之）
// 三者顺序即优先级：真关键词最可信 → 号柜/号架（需带数字）→ 地点+"店"
function matchStationFeature(text) {
  const keyword = STATION_KEYWORDS.filter((word) => text.indexOf(word) >= 0)[0];
  if (keyword) return { keyword: keyword, weak: false };
  const numbered = STATION_PATTERNS.filter((pattern) => pattern.test(text))[0];
  if (numbered) return { keyword: text.match(numbered)[0], weak: true };
  const shop = text.match(STATION_SHOP_PATTERN);
  if (shop) return { keyword: shop[0], weak: true };
  return null;
}

// —— 组合行切分（样本 F；M3）——
// 长行里站点名后面常紧跟省市区地址；整行取值再截断会产出"半截地址"当站点名（旧行为）。
// 返回**片段数组**（原行片段，标点原样）：分隔符优先，其次在地址起头词处切断。
function splitCompositeLine(line) {
  return line.split(LINE_SEPARATOR)
    .map((part) => {
      if (part.length <= MAX_FIELD_LEN) return part;
      const at = part.search(ADDRESS_START);
      return at > 0 ? part.slice(0, at) : part;
    })
    .map((part) => stripDecoration(part))
    .filter((part) => part.length > 0);
}

// 站点名 = 关键词右侧那一段：`菜鸟驿站-3号楼` 的 `-3号楼` 是站点名的一部分，必须保留；
// 但**不取关键词左侧**（真机整屏一行时左侧是"…已放入代收点南路湖南工业大学…"这类时间线文字，
// 左侧越长噪声越多，见 FIXTURES.md D1）；左侧只在"关键词是个后缀词"时向后回溯（"妈妈驿站代收点"的"妈妈"）
// 从**关键词结束位置之后**找第一个分隔符（真机里是 `…驿站代收点|湖工大西苑一栋南门面8号柜`：
// 关键词"驿站"与管道之间还夹着"代收点"，所以不能找"关键词+管道"连写）
function pipeAfterKeyword(rawLine, keyword) {
  const at = rawLine.lastIndexOf(keyword);
  if (at < 0) return -1;
  const pipe = rawLine.slice(at + keyword.length).indexOf('|');
  return pipe < 0 ? -1 : at + keyword.length + pipe;
}

function stationValue(part, feature, rawLine) {
  const clean = trimStationNoise(part);
  const at = clean.lastIndexOf(feature.keyword);
  if (at < 0) return clean;
  // 分隔符两侧都有内容时，取"具体到门牌"的那一侧（用户口径：要 `湖工大西苑一栋南门面8号柜` 这种具体的，
  // 不要 `妈妈驿站代收点` 这种宽泛的）——品牌名一侧分组价值低，同一驿站会被拆成一堆组
  const pipeAt = rawLine ? pipeAfterKeyword(rawLine, feature.keyword) : -1;
  if (pipeAt >= 0) {
    const left = clean.slice(0, at + feature.keyword.length);
    const right = rawLine.slice(pipeAt + 1);
    if (SPECIFIC_PLACE.test(right) && !SPECIFIC_PLACE.test(left)) {
      return trimStationNoise(stripDecoration(right));
    }
    return trimStationNoise(left);
  }
  const end = at + feature.keyword.length;
  const rest = clean.slice(end);
  const tailWord = STATION_TAIL_WORDS.filter((word) => rest.indexOf(word) === 0)[0];
  const right = tailWord ? clean.slice(0, end + tailWord.length)
    : (rest === '' || STATION_TAIL_OK.test(rest.trim()) ? clean : clean.slice(0, end));
  return trimStationNoise(backScan(right, at));
}

// 向左回溯站点名本体：`…677426复制妈妈驿站代收点` 的"妈妈"要留下。
// 停止条件只有两个：**空白/标点**，或**长度上限**（左邻字段靠长度与噪声词拦，不靠"见数字就停"——
// 那样会把"湖工大西苑一栋南面""21栋顺丰"这类站点名本体切掉，2026-09-17 批 3 实测踩过）
function backScan(value, from) {
  const head = value.slice(0, from);
  const cut = Math.max(head.lastIndexOf(' '), head.lastIndexOf('|'), head.lastIndexOf('｜'));
  const start = cut >= 0 ? cut + 1 : Math.max(0, from - MAX_FIELD_LEN);
  return value.slice(start);
}

function stitchPlacePrefix(line, part) {
  if (line === part) return part;
  const at = line.lastIndexOf(part);
  if (at <= 0) return part;
  const previous = line.slice(0, at).split(/[|｜\s]+/).filter((item) => item.length > 0).pop() || '';
  if (previous === '' || previous.length > PLACE_FRAGMENT_MAX) return part;
  if (/\d/.test(previous)) return part;
  if (hasStationNoise(previous)) return part;
  return previous + ' ' + part;
}

// 切掉与站点名黏在一起的时间线/UI 文字（真机整屏一行时它们会跑进候选值）：
// 例 `16:5543待取件…已放入代收点…` → 保留末尾那段；`…8号柜拨打电话圆通快递…` → 保留前半段。
// ⚠️ 不动 PURE_DIGIT/CODE_SHAPE：这里只清洗**站点名**取值，码的取值边界由 CODE_SHAPE 与标签负责
// 切掉与站点名黏在一起的**时间线/UI 尾巴**（真机整屏一行时它们跑在站点名后面）：
// `…8号柜拨打电话圆通快递…` → `…8号柜`。
// ⚠️ 只切尾部、且**不切掉左侧的站点名本体**（"妈妈驿站代收点"的"妈妈"在上一批被切掉过，见 FIXTURES.md D1）
function trimStationNoise(value) {
  const cut = stationNoiseCut(value);
  const out = cut > 0 ? value.slice(cut) : value;
  return out.replace(/^[\s\-—:：>|｜]+|[\s\-—:：>|｜]+$/g, '').trim();
}

// 整行与它的每个片段都算候选：整行能保留"妈妈驿站代收点 湖工大西苑一栋南门面8号柜"这类完整站点名。
// 另外（2026-09-17 用户提出的判据）：真机把**同一处站名吐两遍**且粘在一起
// （`湖工大苑一栋南面7号柜湖工大西苑一栋南面7号柜079022`，两个写法后缀相同、差异在开头），
// 这时**在重复段的第二次出现处切开、只留后半段**——后半段没有开头丢字的毛病。
// 这条是"结构性锚点"，比调取值窗口可靠（窗口那条路试了 8 轮没收敛，见 station_extract/DESIGN.md §7）
function stationCandidates(line) {
  const repeated = splitByRepeatedSegment(line);
  const source = repeated || line;
  const parts = [source].concat(splitCompositeLine(source));
  const out = [];
  for (const part of parts) {
    const text = stripDecoration(part);
    const feature = matchStationFeature(text);
    if (!feature) continue;
    const signal = stationSignal(text, feature.keyword);
    if (!feature.weak && !signal.hasPrefix) continue;   // 整行就一个"驿站"→ 不是站点名
    const value = feature.weak
      ? stitchPlacePrefix(source, stationValue(part, feature, source))
      : stationValue(part, feature, source);
    if (value.length < 2) continue;
    // 弱证据（命中词在尾部 / 号柜式门牌）：名字容易被裁短，打分时降一档
    out.push({ value: value, weak: feature.weak || signal.atTail });
  }
  return out;
}

// 找"重复出现且像站点名"的**最长**片段；有则在它第二次出现处切开，返回后半段（没有返回 ''）
function splitByRepeatedSegment(line) {
  const text = stripDecoration(line);
  const station = findLongestRepeatedStation(text);
  if (!station) return '';
  const start = text.lastIndexOf(station);
  return start > 0 ? line.slice(line.indexOf(station, line.indexOf(station) + 1)) : '';
}

function findLongestRepeatedStation(text) {
  const n = text.length;
  let best = '';
  for (let len = n - 1; len >= REPEAT_MIN_LEN; len--) {
    for (let i = 0; i + len <= n; i++) {
      const sub = text.slice(i, i + len);
      if ((sub.match(/[\u4e00-\u9fa5]/g) || []).length < REPEAT_MIN_HAN) continue;
      if (!looksLikeStationName(sub)) continue;
      if (text.indexOf(sub, i + 1) < 0) continue;
      if (sub.length > best.length) best = sub;
    }
    if (best) break;   // 从长到短扫，第一轮命中即最长
  }
  return best;
}

// 这段文字"像不像站点名"：含驿站/菜鸟类关键词，或（≥4 汉字且带门牌号）——避免把通知正文的重复当站点名
function looksLikeStationName(text) {
  if (STATION_KEYWORDS.some((word) => text.indexOf(word) >= 0)) return true;
  const han = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return han >= 4 && /号[柜架]/.test(text);
}

function scoreStationLine(line, index, weak) {
  let score = weak ? 6 : 10;
  if (GENERIC_STATION_WORDS.indexOf(line) >= 0) score -= 6;               // 只有后缀、没有地名 → 不是站点名
  // 值里带**时间线/UI 噪声**（`09:23湖工大苑…` / `…已放至代收点…`）= 候选是拼接产物，不是站点的叫法。
  // 真机把两个站名与时间粘成一段时，会同时产出"干净的"与"带前缀的"两个值，靠这一档把它们分开
  if (hasStationNoise(line)) score -= 8;
  // 通知正文的套话前缀（`您的您的快件已存放至 湖工大西苑…`）同理：站点名不会这么叫
  if (/^您的/.test(line)) score -= 8;
  if (STATION_DENY.some((word) => line === word)) score -= 20;            // 整行就是个公司名 → 几乎肯定不是站点
  // 快递公司名出现在候选里 = 邻字段串进了站点名（样本 E 的"…21栋顺丰"）→ 扣分，让更干净的片段胜出
  else if (STATION_DENY.some((word) => line.indexOf(word) >= 0)) score -= 3;
  if (PROMO_HINTS.some((word) => line.indexOf(word) >= 0)) score -= 5;
  score += Math.max(0, 3 - index);                                        // 同分时靠前的行优先（站点名通常在截图上部）
  return score;
}

function pickStation(lines) {
  const candidates = [];
  // 片段候选与整行候选必须站在**同一起跑线**上：靠前行优先的加分只用于区分"不同行"，
  // 不能因为整行排在片段前面就白送 3 分（否则"快递服务点 12号楼架空层"会被自己裁成"快递服务点"）
  const commonIndex = lines.length > 0 ? 1 : 0;
  lines.forEach((line, index) => {
    const at = index === 0 ? 0 : commonIndex;
    for (const candidate of stationCandidates(line)) {
      candidates.push({
        value: candidate.value,
        // 同分先比**值长度**：名字更全的胜出（`妈妈驿站代收点` > `代收点`）
        span: candidate.value.length,
        // 打分只看**候选自身的值**：拿整行去打分会把候选外的噪声（`复制`/`圆通`）算到它头上，
        // 于是正确候选被自己的行拖下水（2026-09-17 批 3 真机样本实测踩到）
        score: scoreStationLine(candidate.value, at, candidate.weak)
      });
    }
  });
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => (b.score - a.score) || (b.span - a.span));
  return truncate(candidates[0].value, MAX_FIELD_LEN);
}

module.exports = { stationSignal, matchStationFeature, splitCompositeLine, pipeAfterKeyword, stationValue, backScan, stitchPlacePrefix, trimStationNoise, stationCandidates, splitByRepeatedSegment, findLongestRepeatedStation, looksLikeStationName, scoreStationLine, pickStation, MAX_FIELD_LEN, STATION_KEYWORDS, STATION_PATTERNS, SPECIFIC_PLACE, STATION_SHOP_PATTERN, STATION_DENY, PROMO_HINTS, LINE_SEPARATOR, ADDRESS_START, STATION_TAIL_OK, STATION_TAIL_WORDS, PLACE_FRAGMENT_MAX, REPEAT_MIN_LEN, REPEAT_MIN_HAN, GENERIC_STATION_WORDS };
