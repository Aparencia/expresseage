/**
 * utils/parse-text.js · 文本层：行清洗、噪声判定、码形长度闸（零内部依赖，可被其余三件单向引用）
 *
 * ⚠️ 本文件由 `utils/parse.js`（原 688 非空行）按 V6 卡 52（TD-001 偿还）机械切出：
 *   函数体与注释**逐行照搬**，只新增本头、require 与导出。切分前的等价性证据 = 金样本逐字节比对。
 * ⛔ 搬迁纪律（本项目已因反例付过代价）：**搬函数必须同时搬依赖**（常量与 require 一个都不能漏）。
 */
'use strict';

// 单行噪声过滤器：这些行里的数字（时刻/电话/日期/单号）绝不能被当成取件码
const NOISE_PATTERNS = [
  // 时间必须"两侧不是数字"：旧写法 `\d{1,2}:\d{2}` 会把**标签后的冒号**当时间分隔符——
  // "取件码: 079022" 里 `9:07` 命中 → 整行被跳过，真码漏掉（2026-09-17 批 2 从真实样本 D 发现）
  /(^|[^\d])\d{1,2}:\d{2}([^\d]|$)/, // 时间 20:00
  /(^|[^\d-])1\d{10}([^\d-]|$)/,     // 手机号（两侧不能是数字/连字符，否则会吃掉 "106-4-5011" 这类分段码）
  /\d{4}\s*[-/年]\s*\d{1,2}/,      // 日期 2026-09-17
  /(前|后)(领取|取件|送达|到店)/,   // "请于 20:00 前领取"
  /运费|金额|合计|已付款|待付款/,
  /快递单号|运单号|订单号|物流单号/ // 这是运单号，不是取件码；认错会让人拿着单号去驿站
];

// 时间线 / UI 噪声：出现在站点候选里就说明"取到的是别人家的文字"。
// 状态词用**正则**（`待取|已放|已签收`…，真机输出的是 `已放至代收点` 而不是"已放入"，整词表会漏），
// UI 按钮/提示词用字符串。⚠️ 两者混存 → 消费者必须经 `stationNoiseCut`/`hasStationNoise`，
// **禁止直接 indexOf/lastIndexOf 数组元素**（正则对象会被悄悄转成字符串而永不命中）
const STATION_NOISE_REGEX = [/待取[件货]/, /待收货/, /已[放签揽入到][至入到站中]?/, /派送中/, /运输中/, /(今|昨|明)天/];

const STATION_NOISE_WORDS = ['复制', '拨打电话', '物流服务', '展开', '收起', '订阅提醒', '查看更多', '联系代收点', '联系快递员'];

// 长度分档（2026-09-17 用户判据："取件码往往较短，编号、电话等较长"）：
// 把"靠一份标签词名单去堵单号/电话/运单号"换成一条可解释的规则——**数字位数**即可信度。
// 真实样本实测：取件码 6 位纯数字（`677426`/`079022`）或 7 位分段（`103-2-6021`）；
// 订单号 21 位、手机号 11 位、运单号 13 位 → 都远超上限。
// ⚠️ 带分段符的码数字位天然更多（货架-层-序号），所以"带结构"比"纯数字"放宽 2 位
const SHORT_CODE_DIGITS = 6;    // 短码：纯数字 6 位内 / 有分段符 8 位内 → 任何标签或独占短行即可认

const MEDIUM_CODE_DIGITS = 10;  // 中长：只有**明确取件码标签**才认（订单号 21 位在最外档 → 永不认）

const MAX_CODE_LETTERS = 3;     // 字母位上限：`Z1-0470`/`SF123456` 可以，`YT8899323632349`（2 字母 + 13 数字）不过

// 码值的形态白名单：只保留字母数字与 - _ #。
// ⚠️ 这里**不设长度上限**——长度由 `isCodeLength()` 一处裁决（用户判据"取件码短、编号/电话长"）。
// 曾经这里写 `{1,19}`，结果是"长度闸"被它挡在后面永远轮不到，改了长度闸也测不出来（2026-09-17 批 3 变异实验抓到）
const CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9\-_#]*$/;

// 结构标记：真机 VisionKit 会把**整屏吐成一整行**（2026-09-17 真机实测），字段之间只剩 UI 按钮文字与
// 字段标签当分隔。把它们还原成换行，后面的规则才能像"分行"一样工作（否则站点名会吃到时间线文字）。
const STRUCTURE_MARKERS = [
  /(取件码|取货码|提货码|取件编号|包裹码|取件号)\d/,   // 标签与码连写（`取件码677426`）
  /(取件码|取货码|提货码|取件编号|包裹码|取件号)[:：]/, // 标签后跟冒号（真机会输出 `取件码:`）
  // ⚠️ 2026-09-26（真机原文 §20）：`(?<![\d-])` 是**必需的左边界** —— 否则**分段码的尾段**会被当成
  //    "标签前的纯数字码"在这里切开：真机实测 `…111-1-1111取件码…` 曾被切成 `304-2-` + `5001取件码`
  //    （而后半段还能被"值在标签前"那条路认成 `5001` ⇒ **认了一个错码**，比漏认更贵）。
  //    v1 那条 `…7号柜079022取件码:` 不受影响（`079022` 前面是汉字"柜"）。
  /(?<![\d-])\d{4,6}(?=(?:取件码|取货码|提货码|取件编号|包裹码|取件号))/, // **码在标签前面**（真机实测 `…7号柜079022取件码:`）
  // 通知正文的套话：真机把整段通知并进同一行，`您的您的快件已存放至[站点名]` 里站点名之前全是套话
  /您的(您的)?快件已存放至/,
  /(圆通|中通|申通|韵达|顺丰|京东|极兔|邮政|EMS|德邦|菜鸟)快递[:：]?/,
  /快递员[:：]/, /订单编号[:：]/, /收货地址[:：]/,
  /复制/, /拨打电话/, /物流服务/, /查看更多/, /订阅提醒/, /展开/, /收起/,
  // UI 按钮也是结构边界：真机把 `联系代收点` 当按钮印在站点名旁边，不切开它就会被当成站点候选（实测抢走站点名）
  /联系(代收点|快递员|驿站|站点|客服)/
];

// 全角数字/字母转半角：截图里两种都有，不归一化会漏掉一半样本
function toHalfWidth(text) {
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 结构标记前插换行：**保留标记本身**（标签要留给取件码提取用），只是让"一个字段一行"
function insertVirtualBreaks(line) {
  let out = line;
  for (const marker of STRUCTURE_MARKERS) {
    const flags = marker.flags.indexOf('g') >= 0 ? marker.flags : marker.flags + 'g';
    out = out.replace(new RegExp(marker.source, flags), '\n$&');
  }
  return out;
}

// 行级清洗：归一化宽度 → 去装饰符号 → 合并空白。
// ⚠️ `|` 必须留着：它在真实样本里是**字段分隔符**（`妈妈驿站代收点|湖工大西苑一栋南门面8号柜`），
//    删掉就等于把"品牌名 / 具体位置"两段焊死，选段规则再也看不到边界（2026-09-17 实测踩过）
function cleanLine(raw) {
  if (typeof raw !== 'string') return '';
  return toHalfWidth(raw)
    .replace(/[「」【】《》<>〔〕\[\]（）()*·•、,，。;；!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseLine(line) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

// 最靠右的噪声结束位置（没有噪声返回 -1）——用于裁掉站点名右侧的时间线/UI 残留
function stationNoiseCut(value) {
  let cut = -1;
  for (const word of STATION_NOISE_WORDS) {
    const at = value.lastIndexOf(word);
    if (at >= 0) cut = Math.max(cut, at + word.length);
  }
  for (const pattern of STATION_NOISE_REGEX) {
    const flags = pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g';
    const re = new RegExp(pattern.source, flags);
    let match = re.exec(value);
    while (match) {
      cut = Math.max(cut, match.index + match[0].length);
      match = re.exec(value);
    }
  }
  return cut;
}

// 这段文字里有没有噪声（"向左扫"与"接上一段"都要用它判断是否已经进了别人家的文字）
function hasStationNoise(text) {
  return stationNoiseCut(text) >= 0;
}

// 匹配用的副本：去掉装饰符号后只留一个空格——**只用于判断/计数**，
// 返回值一律取原行片段（`菜鸟驿站-3号楼` 的段号连字符是值的一部分，被清洗掉就落库成另一个站点了）
function stripDecoration(text) {
  return text
    .replace(/[「」【】《》<>〔〕\[\]（）()*·•、,，。;；!！?？|｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushUnique(found, value) {
  if (value && found.indexOf(value) < 0) found.push(value);
}

function truncate(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

// 这个值够短、可以当码吗？（带明确取件码标签时放宽到中长档）
function isCodeLength(value, hasPickupLabel) {
  const digits = (value.match(/\d/g) || []).length;
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  if (letters > MAX_CODE_LETTERS) return false;
  if (hasPickupLabel) return digits <= MEDIUM_CODE_DIGITS;
  const segmented = /[-_#]/.test(value);
  return digits <= (segmented ? SHORT_CODE_DIGITS + 2 : SHORT_CODE_DIGITS);
}

module.exports = { toHalfWidth, insertVirtualBreaks, cleanLine, isNoiseLine, stationNoiseCut, hasStationNoise, stripDecoration, pushUnique, truncate, isCodeLength, NOISE_PATTERNS, STATION_NOISE_REGEX, STATION_NOISE_WORDS, SHORT_CODE_DIGITS, MEDIUM_CODE_DIGITS, MAX_CODE_LETTERS, CODE_SHAPE, STRUCTURE_MARKERS };
