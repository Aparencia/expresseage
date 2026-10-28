// utils/recognize/codes.js · 取件码/柜号/尾号形态闸（单源；纯函数，零 wx）
// 口径（CONTRACT §3 + shared/validate.validatePickupCode 同源）：原始输入 ≤40；
// 去空格/连字符/下划线/# 后的「紧凑码」必须 4~12 位字母数字。识别层自动填只认紧凑码：
// 超长/带奇怪符号的候选标「认出但不像」，不自动填（提示文案沿用 FORM_ERROR.pickupCode）。
// 柜号 ≤10 字符串（值域不限）；运单尾号恰好 5 位数字。
// v1.1/D35（2026-10-27 真机取件码不回填修复）：
//   ① 真实截图「207-3-1014」被 OCR 读成连写 20731014 / 空格分组 2 0 7 3 1 0 1 4 / 标签粘连时也要能认出；
//   ② 日期启发式只认「带日期分隔符」或现实年份（19xx/20[0-2]x）的 8 位，8 位码不再被当日期误杀；
//   ③ 自动填/提交形态与服务端 validatePickupCode 对齐（紧凑 4~12 位字母数字且至少 1 位数字）。
'use strict';

// 原始输入上限（与服务端 validatePickupCode 的 PICKUP_CODE_MAX_RAW 同源）
const CODE_MAX = 40;
// 紧凑码上下限（与服务端 PICKUP_CODE_ALNUM_MIN/MAX 同源）
const CODE_COMPACT_MIN = 4;
const CODE_COMPACT_MAX = 12;
// 服务端 PICKUP_CODE_SEPARATOR：空格/连字符/下划线/井号在判紧凑码前整体去掉
const CODE_COMPACT_SEPARATOR = /[\s\-_#]/g;
const CODE_ALNUM = /^[0-9A-Za-z]+$/;
const LOCKER_MAX = 10;

// 码上下文：这些标签后的数字按「取件码语境」解析（OCR 常见「取件码：207-3-1014」）
const CODE_CONTEXT_RE = /(?:取件码|取货码|提货码|取件|提货)/;
// 去掉标签前缀（含全角/半角冒号与空白），只留码区
const CODE_CONTEXT_STRIP_RE = /^[\s\S]*?(?:取件码|取货码|提货码|取件|提货)[:：\s]*/;
// 码区数字/字母组（组间允许 OCR 引入的空格/连字符/破折号等分隔符）
const CODE_CONTEXT_RUN_RE = /[0-9A-Za-z]+(?:[\s\-—–_#·]+[0-9A-Za-z]+)*/g;
// 纯数字片段行（OCR 把码拆成多行时的形态：207 / 3 / 1014）
const FRAGMENT_LINE_RE = /^[\d\s\-—–_#·]+$/;
// 各种分隔符（归一用）
const SEPARATOR_CHARS_RE = /[\s\-—–_#·]/g;

function toHalfWidth(value) {
  let out = '';
  const str = String(value === undefined || value === null ? '' : value);
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += str.charAt(i);
  }
  return out;
}

function normalizeCode(raw) {
  return toHalfWidth(raw).trim().replace(/\s+/g, '');
}

// 紧凑形态：去掉服务端同款分隔符（空格/连字符/下划线/井号）后的字母数字串
function compactCode(raw) {
  return normalizeCode(raw).replace(CODE_COMPACT_SEPARATOR, '');
}

// 服务端闸：紧凑后 4~12 位字母数字（submit 前必须过；只做识别层复核，不改展示形态）
function isCompactCode(value) {
  const code = compactCode(value);
  if (code.length < CODE_COMPACT_MIN || code.length > CODE_COMPACT_MAX) return false;
  return CODE_ALNUM.test(code);
}

// 日期形态：只拦「像日期」的候选，不能误杀取件码（D35 真机 20731014）
function isDateLike(value) {
  const code = normalizeCode(value);
  // 带日期分隔符/年月日的日期：2026-10-27 / 2026/10/27 / 2026.10.27 / 2026年10月27日
  if (/^(19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(code)) return true;
  // 纯 8 位 yyyymmdd：只有现实年份区间（1900~2029）+ 合法月/日才算日期；
  // 20731014 拆成 2073-10-14 年份不在区间 → 不会被当成日期（真机取件码必须能自动填）
  return /^(19\d{2}|20[0-2]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(code);
}

function isPhoneLike(value) {
  return /^1[3-9]\d{9}$/.test(value);
}

/** 取件码展示形态闸：4~40 字符；必须含数字；不含竖排汉字；不像日期/手机号 */
function isPlausibleCode(value) {
  const code = normalizeCode(value);
  if (!code || code.length < 4 || code.length > CODE_MAX) return false;
  if (!/[0-9]/.test(code)) return false;
  if (!/^[0-9A-Za-z#*._-]+$/.test(code)) return false;
  if (/^[0-9A-Za-z]{1,3}$/.test(code)) return false;
  if (isDateLike(code) || isPhoneLike(code)) return false;
  if (/^\d{5}$/.test(code)) return false;
  return true;
}

/**
 * 可提交/可回填的取件码（与服务端 validatePickupCode 同判的正向版）：
 * 紧凑 4~12 位字母数字且至少 1 位数字。**不套**日期/手机号启发式——
 * 该启发式只用于「从任意 OCR 文本里猜候选」，不能用来否决 AI 已明确给出的码字段。
 */
function isFillableCode(value) {
  const code = compactCode(value);
  if (code.length < CODE_COMPACT_MIN || code.length > CODE_COMPACT_MAX) return false;
  if (!CODE_ALNUM.test(code)) return false;
  return /[0-9]/.test(code);
}

/** 可自动填的码：展示闸 + 服务端紧凑闸都过（识别层不自动填「认出但不像」的候选） */
function isAutoFillCode(value) {
  return isPlausibleCode(value) && isCompactCode(value);
}

/** 码上下文里的可回填候选：过服务端紧凑闸；纯 5 位仍当运单尾号不当码（与全局启发式一致） */
function isContextCode(value) {
  const code = normalizeCode(value);
  if (!code || code.length > CODE_MAX) return false;
  if (!isFillableCode(code)) return false;
  return !/^\d{5}$/.test(compactCode(code));
}

/** 候选打分：分段符/字母数字混合/常见长度更可信；用于同图多码排序 */
function scoreCode(value) {
  const code = normalizeCode(value);
  if (!isPlausibleCode(code)) return 0;
  let score = 10;
  if (/[-#*]/.test(code)) score += 6;
  if (/[A-Za-z]/.test(code) && /[0-9]/.test(code)) score += 4;
  if (code.length >= 6 && code.length <= 20) score += 4;
  if (/^\d+$/.test(code)) score -= 2;
  return score;
}

function isCodeContextLine(line) {
  return CODE_CONTEXT_RE.test(String(line || ''));
}

function stripContextLabel(line) {
  return String(line || '').replace(CODE_CONTEXT_STRIP_RE, '');
}

/** 码上下文行里「码区」的数字/字母组；短码要求整行就是码，避免把掩码运单前缀 JT22 当码 */
function contextCodeRuns(line) {
  const rest = stripContextLabel(line).trim();
  const runs = rest.match(CODE_CONTEXT_RUN_RE) || [];
  const out = [];
  runs.forEach(function each(run) {
    const raw = run.trim();
    // 组间有空格（OCR 把码拆开）才去分隔符合并；原本是连字符形态的码保留原样（展示/断言口径）
    const value = /\s/.test(raw) ? raw.replace(SEPARATOR_CHARS_RE, '') : normalizeCode(raw);
    if (!isContextCode(value)) return;
    // 4~5 位短码只有在「整行就是这串」时才采信（"JT22****25" 里的 JT22 不是码）
    if (value.length < 6 && rest !== raw) return;
    out.push(value);
  });
  return out;
}

/** 码上下文行末尾的连续数字（OCR 把「207」留在标签行、其余拆到下一行的形态） */
function trailingDigitsOf(line) {
  const after = stripContextLabel(line);
  const match = after.match(/(\d[\d\s\-—–_#·]*)$/);
  return match ? match[1].replace(SEPARATOR_CHARS_RE, '') : '';
}

/** 纯数字片段行（可跨行拼回取件码）：207 / 3 / 1014 / 207-3 */
function isFragmentLine(line) {
  const text = String(line || '').trim();
  return text.length > 0 && FRAGMENT_LINE_RE.test(text);
}

function candidateOf(value, line, context) {
  return {
    value: value,
    score: scoreCode(value),
    line: line,
    compact: isCompactCode(value),
    context: context
  };
}

/** ① 码上下文行整行解析 + ② 跨行片段拼码；被拼码消费的行记入 consumed，避免重复出件 */
function collectContextCandidates(list, clusters, consumed) {
  list.forEach(function eachContext(line, index) {
    if (!isCodeContextLine(line)) return;
    const runs = contextCodeRuns(line);
    if (runs.length > 0) {
      runs.forEach(function push(value) { clusters.push(candidateOf(value, line, true)); });
      return;
    }
    // 跨行拼接：标签行尾部数字 + 后续纯数字片段行（最多 4 行 / 12 位）
    let acc = trailingDigitsOf(line);
    let take = 0;
    for (let j = index + 1; j < list.length && j <= index + 4 && take < 4; j += 1) {
      if (!isFragmentLine(list[j])) break;
      acc += String(list[j]).replace(SEPARATOR_CHARS_RE, '');
      take += 1;
      if (acc.length > CODE_COMPACT_MAX) break;
      if (acc.length >= 6 && isContextCode(acc)) {
        for (let k = index; k <= j; k += 1) consumed[k] = true;
        clusters.push(candidateOf(acc, line, true));
        break;
      }
    }
  });
}

/** ③ 常规 token 候选（码上下文行放宽日期/手机号启发式，超长候选仍进池供「认出但不像」提示） */
function collectTokenCandidates(list, consumed) {
  const tokens = [];
  list.forEach(function eachLine(line, index) {
    if (consumed[index]) return;
    const text = String(line);
    const context = isCodeContextLine(text);
    text.split(/[\s,，;；、|:：()（）【】\[\]]+/).forEach(function add(part) {
      const token = normalizeCode(part);
      if (!token) return;
      // 码上下文行放宽日期/手机号启发式，但超长/带奇怪符号的候选仍进池（compact=false）
      const ok = context ? (isContextCode(token) || isPlausibleCode(token)) : isPlausibleCode(token);
      if (!ok) return;
      if (context && /^\d{5}$/.test(token)) return;
      tokens.push(candidateOf(token, line, context));
    });
  });
  return tokens;
}

/** 去重（同值保留最高分/context 标记）并按可信度降序 */
function rankCandidates(items) {
  const seen = Object.create(null);
  const unique = [];
  items.forEach(function keep(item) {
    const prev = seen[item.value];
    if (prev) {
      if (item.score > prev.score) prev.score = item.score;
      if (item.context) prev.context = true;
      return;
    }
    seen[item.value] = item;
    unique.push(item);
  });
  unique.sort(function sort(a, b) { return b.score - a.score; });
  return unique;
}

/**
 * 取件码候选（形态闸通过的全部候选，含 compact/context 标记）。
 * 解析顺序：① 码上下文整行（连写/空格分组/连字符/标签粘连）→ ② 跨行片段拼码 →
 * ③ 常规 token 候选（非码上下文行；码上下文行保留超长候选给「认出但不像」提示）。
 * @returns {Array<{value:string, score:number, line:string, compact:boolean, context:boolean}>}
 */
function pickCodeCandidates(lines) {
  const list = lines || [];
  const clusters = [];
  const consumed = Object.create(null);
  collectContextCandidates(list, clusters, consumed);
  const tokens = collectTokenCandidates(list, consumed);
  return rankCandidates(clusters.concat(tokens));
}

/** 自动填候选：只保留紧凑码可提交的（超长候选由调用方标"认出但不像"） */
function pickCodes(lines) {
  return pickCodeCandidates(lines)
    .filter(function compact(item) { return item.compact; })
    .map(function strip(item) {
      return { value: item.value, score: item.score, line: item.line };
    });
}

/** 柜号归一：只做全角/空白归一，不截断（长度由 isPlausibleLocker 先判原长，不静默改数据） */
function normalizeLocker(raw) {
  return toHalfWidth(raw).replace(/\s+/g, '');
}

/** 柜号形态闸：先判归一后原长 1~10，再谈使用（>10 必须报行内错误，不许截断后放行） */
function isPlausibleLocker(value) {
  const text = normalizeLocker(value);
  return text.length > 0 && text.length <= LOCKER_MAX;
}

function normalizeTail(raw) {
  const text = toHalfWidth(raw).replace(/\D/g, '');
  return text.length === 5 ? text : '';
}

function isPlausibleTail(value) {
  return normalizeTail(value) !== '';
}

/** 派生 codeStatus：码过服务端同款紧凑闸为 OK；无码有尾号 NEED_CODE；都无不可提交 */
function deriveCodeStatus(pickupCode, trackingTail) {
  if (isFillableCode(pickupCode)) return 'OK';
  if (isPlausibleTail(trackingTail)) return 'NEED_CODE';
  return 'NONE';
}

module.exports = {
  CODE_MAX,
  CODE_COMPACT_MIN,
  CODE_COMPACT_MAX,
  LOCKER_MAX,
  normalizeCode,
  compactCode,
  isCompactCode,
  isFillableCode,
  isAutoFillCode,
  normalizeLocker,
  normalizeTail,
  isPlausibleCode,
  isPlausibleLocker,
  isPlausibleTail,
  scoreCode,
  pickCodeCandidates,
  pickCodes,
  deriveCodeStatus
};
