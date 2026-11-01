// utils/recognize/local-codes.js · 本机取件码清单的粘贴文本解析/合并纯件（D57；纯函数，零 wx）
// 口径：CONTRACT §13 D57（顾客本机取件码清单：不强制绑定/不开放/只存本机）+ DATA_MODEL §16。
// 输入 = 顾客手动粘贴或端侧 OCR 得到的文本；输出只给页面展示/入库用，不产生请求、不碰存储。
// 规则（与 storage 同一形态闸，见 utils/storage.js PICKCODES_KEY 注释）：
//   ① 码 = 去首尾空白与所有内部空白后 4~40 位 /^[0-9A-Za-z][0-9A-Za-z\-_#]{3,39}$/；
//   ② 站点只认 shared/stations 归一的 P1~P8（多解/未命中留空，宁可不猜），站点行可下传给后续码行；
//   ③ 拒绝：11 位手机号、日期形 YYYY-M-D、≥13 位纯数字长串、<4 位、地址行（都进 rejected 供页面说真话）；
//   ④ 支持一行多码与纯码行；显式「取件码/取货码/提货码/取件号」标签与站点原文先剥掉再抽 token；
//   ⑤ 按码去重（先到先得；后者带站点可补前者空站点），与 mergeEntries 同语义。
'use strict';

const text = require('./text');
const station = require('./station');

// 码形态闸（与 storage 的 LOCAL_CODE_PATTERN 同一表达式；storage 未导出该常量，故此处单列口径）
const LOCAL_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z\-_#]{3,39}$/;
// 「像码」的字符集：只对这些 token 做拒绝判定，汉字/其它符号直接忽略（不是候选）
const CODE_CHARS_RE = /^[0-9A-Za-z\-_#]+$/;
const LABEL_RE = /(?:取件码|取货码|提货码|取件号)/;
// 标签 + 其后冒号/空白一起剥掉，只留码区
const LABEL_STRIP_RE = /(?:取件码|取货码|提货码|取件号)[:：\s]*/;
const PHONE_RE = /^1[3-9]\d{9}$/;
const DATE_RE = /^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/;
const LONG_DIGITS_RE = /^\d{13,}$/;
// 地址行：详细门牌（苑/栋+房号室/寝）或地址类字段（带码标签的行按码行处理，不误杀）
const ADDRESS_RE = /(?:地址|宿舍|寝室|门牌|房间)/;
const DORM_ROOM_RE = /(?:湖工大)?[\u4e00-\u9fa5]{1,6}(?:苑|栋)[\u4e00-\u9fa5\d]{0,8}\d{3,4}\s*(?:室|寝)/;
// 非码字段标签：码区在这些词前收口（取件时间/订单号/运单号/手机号/柜号等数字不是取件码）
const NOISE_LABEL_RE = /(?:取件时间|取件日期|订单编号|订单号|运单号|快递单号|物流单号|单号|手机号|联系电话|联系方式|取件人|收件人|尾号|柜号|货架|地址|电话|手机|日期|时间|编号|运单|物流|快递|柜)/;
// token 分隔符（码本身允许 - _ #，不做分隔）
const TOKEN_SPLIT_RE = /[\s,，;；、|:：()（）【】\[\]<>《》"'“”‘’·]+/;
const JOIN_SPLIT_RE = /[\s,，;；、|:：()（）【】\[\]<>《》"'“”‘’·]+/g;
const STATION_ID_RE = /^P[1-8]$/;
const STATION_NAME_MAX = 20;

function normalizeCode(value) {
  const code = String(value === undefined || value === null ? '' : value).trim().replace(/\s+/g, '');
  return LOCAL_CODE_RE.test(code) ? code : '';
}

/** 形态像码但仍要拒绝的候选（D57 拒绝清单：手机号 / 日期形 / ≥13 位纯数字长串） */
function isRejectedCode(code) {
  return PHONE_RE.test(code) || DATE_RE.test(code) || LONG_DIGITS_RE.test(code);
}

/** 站点短语表（配置名 + 静态别名，长的先剥，避免短名截断长名） */
function stationPhrasesOf(options) {
  const names = station.listStations(options).map(function nameOf(item) { return item.name; });
  const aliases = station.ALIASES.map(function aliasOf(item) { return item.alias; });
  return names.concat(aliases)
    .filter(function keep(item) { return !!item; })
    .sort(function longerFirst(a, b) { return b.length - a.length; });
}

function stripStationText(value, phrases) {
  let out = value;
  phrases.forEach(function cut(phrase) {
    out = out.split(phrase).join(' ');
  });
  return out;
}

/** 剥掉第一处码标签及其后冒号/空白；无标签返回 null（供纯码行分支） */
function codeAreaOf(line) {
  const match = line.match(LABEL_STRIP_RE);
  return match ? line.slice(match.index + match[0].length) : null;
}

/** 一行 → {codes, rejected}：码区收口 → 抽 token → 形态闸；标签行无 token 时按「逐字空格」拼回 */
function parseLine(line, phrases) {
  const hasLabel = LABEL_RE.test(line);
  const area = (hasLabel ? codeAreaOf(line) : line).split(NOISE_LABEL_RE)[0] || '';
  const work = stripStationText(area, phrases);
  const codes = [];
  const rejected = [];
  work.split(TOKEN_SPLIT_RE).forEach(function each(token) {
    if (!token || !CODE_CHARS_RE.test(token)) return;
    const code = normalizeCode(token);
    if (!code || isRejectedCode(code)) {
      rejected.push(token);
      return;
    }
    codes.push(code);
  });
  // OCR 逐字空格（「2 0 7 3 1 0 1 4」）：标签行一个可提交码都没有时，去空白后整串再试一次
  if (hasLabel && codes.length === 0 && rejected.length > 0) {
    const joined = normalizeCode(work.replace(JOIN_SPLIT_RE, ''));
    if (joined && !isRejectedCode(joined)) {
      codes.push(joined);
      rejected.length = 0;
    }
  }
  return { codes: codes, rejected: rejected };
}

function pushEntry(items, byCode, entry) {
  const prev = byCode[entry.code];
  if (prev) {
    if (!prev.stationId && entry.stationId) {
      prev.stationId = entry.stationId;
      prev.stationName = entry.stationName;
    }
    return;
  }
  byCode[entry.code] = entry;
  items.push(entry);
}

function addRejected(list, seen, value) {
  const token = String(value === undefined || value === null ? '' : value).trim();
  if (!token || seen[token]) return;
  seen[token] = true;
  list.push(token);
}

/**
 * 粘贴/OCR 文本 → 本机取件码条目。
 * @param {string} rawText 顾客粘贴或端侧识别得到的文本（多行）
 * @param {{stations?: Array<{id:string,name:string}>}} [options] 当前配置站点表（缺省=内置默认）
 * @returns {{items: Array<{code:string, stationId:string, stationName:string}>, rejected: string[]}}
 *   items 按出现顺序去重（同码只留第一条，后面的站点可补前排空站点）；rejected 为被规则拒绝的候选原文。
 */
function parseCodeText(rawText, options) {
  const opts = options || {};
  const phrases = stationPhrasesOf(opts);
  const items = [];
  const byCode = Object.create(null);
  const rejected = [];
  const seenRejected = Object.create(null);
  let activeStation = { stationId: '', stationName: '' };
  text.splitLines(rawText).forEach(function eachLine(line) {
    const hit = station.matchStation(line, opts);
    let lineStation = activeStation;
    if (hit) {
      // station.matchStation 回 {id,name,by,kind}；本件只留 id/name 两个展示字段
      lineStation = { stationId: hit.id, stationName: hit.name };
      activeStation = lineStation;
    }
    if (!LABEL_RE.test(line) && (ADDRESS_RE.test(line) || DORM_ROOM_RE.test(line))) {
      addRejected(rejected, seenRejected, line);
      return;
    }
    const parsed = parseLine(line, phrases);
    parsed.rejected.forEach(function push(token) { addRejected(rejected, seenRejected, token); });
    if (parsed.codes.length === 0) return;
    parsed.codes.forEach(function add(code) {
      pushEntry(items, byCode, {
        code: code,
        stationId: lineStation.stationId || '',
        stationName: lineStation.stationName || ''
      });
    });
  });
  return { items: items, rejected: rejected };
}

/**
 * 多个解析结果/手工条目合并去重（同 parse 语义：先到先得、后者带站点可补前者空站点、非法码丢弃）。
 * @param {Array<{code:string, stationId?:string, stationName?:string}>} list
 * @returns {Array<{code:string, stationId:string, stationName:string}>} 去重后的条目（保序）
 */
function mergeEntries(list) {
  const items = [];
  const byCode = Object.create(null);
  (Array.isArray(list) ? list : []).forEach(function each(entry) {
    if (!entry || typeof entry !== 'object') return;
    const code = normalizeCode(entry.code);
    if (!code || isRejectedCode(code)) return;
    const stationId = typeof entry.stationId === 'string' && STATION_ID_RE.test(entry.stationId)
      ? entry.stationId
      : '';
    const stationName = typeof entry.stationName === 'string'
      ? entry.stationName.trim().slice(0, STATION_NAME_MAX)
      : '';
    pushEntry(items, byCode, { code: code, stationId: stationId, stationName: stationName });
  });
  return items;
}

module.exports = {
  parseCodeText,
  mergeEntries
};
