// handlers/partner/_customer-list.js · 兼职客户「列表链」（分页/关键词/D67 筛选/排序/游标；从 _customer.js 拆出）
// 口径：CONTRACT §13 D67（客户页筛选器一期）、DATA_MODEL §7.4 listBindings、UX_PARTNER §3.5；
//       §4.5 dormKey 自然序、§5.2/§5.3 扫描上限。
// 纪律：本文件是纯函数（零 DB 访问、零 ctx）：关键词/D67 筛选/排序/游标全部在内存完成——
//       不新增索引、不新增查询；listBindings 只负责取数与回填（activeOrderCount/头像）。
'use strict';

const zones = require('../../shared/zones');
const { errors } = require('../../lib/errors');

// 分页：limit 缺省 20、最大 50（DATA_MODEL §7.4）；客户列表一次扫描 ≤100 条（§5.2）。
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const KEYWORD_MAX_CHARS = 40;
const KEYWORD_SEPARATOR = /[\s-]/g;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseLimit(payload) {
  const raw = Number(payload && payload.limit);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(raw), MAX_PAGE_SIZE);
}

// 搜索词：空=不过滤；超长/非串拒绝（静默忽略会让「搜了但没筛」变成全量返回）。
function readKeyword(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('keyword', '搜索词不正确，请重新输入');
  }
  const text = value.trim();
  if (text.length > KEYWORD_MAX_CHARS) {
    throw errors.validation('keyword', '搜索词过长，请缩短后重试');
  }
  return text;
}

// ── D67 筛选入参：非法值一律「静默归一为不筛」（与 parseLimit 同风格）─────────────────────
// 客户端只发 chips 值（苑枚举/1~10/布尔），手改或旧客户端传入的脏值不应让整个列表报错；
// 真正的「筛选后无结果」由 list:[] + nextCursor:null 如实表达，不会伪装成全量兜底。
function readZoneFilter(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  // D8 五苑 D/X/N/B/C；与 shared/zones 同源（大小写/空白归一，非法苑 → 不筛）
  return zones.normalizeZone(value);
}

function readBuildingNoFilter(value) {
  let numeric = NaN;
  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    numeric = Number(value);
  }
  // 仅 1~10 的整数楼栋有效；其余（0/11/小数/非数字/布尔）→ 不筛
  return zones.isBuildingNo(numeric) ? numeric : 0;
}

// 布尔筛选只认显式 true（false/缺省/脏值 = 不筛，避免旧客户端 false 被当成「只看完善」反筛）。
function readBoolFilter(value) {
  return value === true;
}

function readFilters(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    zone: readZoneFilter(source.zone),
    buildingNo: readBuildingNoFilter(source.buildingNo),
    profileIncomplete: readBoolFilter(source.profileIncomplete),
    hasNote: readBoolFilter(source.hasNote)
  };
}

// 苑/楼栋按「绑定快照 dormKey」判定（与行 DTO/排序同源；空 dormKey=资料未完善，不进苑/栋筛选）。
function matchDormFilters(row, filters) {
  const zone = filters.zone;
  const buildingNo = filters.buildingNo;
  if (!zone && !buildingNo) {
    return true;
  }
  const dormKey = textOf(row && row.dormKey);
  const parsed = zones.parseDormKey(dormKey);
  if (!parsed.ok) {
    return false;
  }
  if (zone && parsed.zone !== zone) {
    return false;
  }
  return !buildingNo || parsed.buildingNo === buildingNo;
}

// 行筛选：四个维度 AND 组合（在 keyword 之后、游标判定之前执行；过滤后再判定 nextCursor）。
function matchFilters(row, filters) {
  const f = filters || {};
  if (f.profileIncomplete === true && textOf(row && row.dormKey) !== '') {
    return false;
  }
  if (f.hasNote === true && textOf(row && row.partnerNote) === '') {
    return false;
  }
  return matchDormFilters(row, f);
}

// ── 客户列表游标：只编码排序锚（dormKey 自然序 + allocSeq=绑定顺序），不含任何 openid ────
function parseBindingCursor(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  const raw = value.dormKey; const dormKey = typeof raw === 'string' ? raw.trim() : '';
  const allocSeq = Number(value.allocSeq);
  // 批20-C：允许空 dormKey 游标（「资料未完善」桶，空置底后尾页可达）；非空锚仍须字符串，脏游标照旧拒绝。
  if ((raw !== undefined && raw !== null && typeof raw !== 'string') || !Number.isFinite(allocSeq) || allocSeq < 0) {
    throw errors.validation('cursor', '分页游标不正确，请刷新页面后重试');
  }
  return { dormKey: dormKey, allocSeq: allocSeq };
}

function allocSeqOf(binding) {
  const seq = Number(binding && binding.allocSeq);
  return Number.isFinite(seq) && seq >= 0 ? seq : 0;
}

function entryKey(entry) {
  return { dormKey: entry.row.dormKey || '', allocSeq: entry.allocSeq };
}

// 批20-C：空 dormKey（资料未完善）恒置底；桶 = [非空 0, 空 1]，桶内 zones.compareDormKey，再按 allocSeq。
function compareBindingEntries(left, right) {
  const a = entryKey(left); const b = entryKey(right);
  const bucketA = a.dormKey ? 0 : 1; const bucketB = b.dormKey ? 0 : 1;
  if (bucketA !== bucketB) {
    return bucketA - bucketB;
  }
  if (bucketA === 0) {
    const delta = zones.compareDormKey(a.dormKey, b.dormKey);
    if (delta !== 0) {
      return delta;
    }
  }
  return left.allocSeq - right.allocSeq;
}

// 游标判定与 compareBindingEntries 同一全序（空桶后置）：空桶游标后只返回更晚空行，非空行视为已翻过
// → 空置底后分页不重不漏（旧实现空行不产游标，尾部页会丢）。
function isAfterBindingCursor(entry, cursor) {
  if (!cursor) {
    return true;
  }
  const key = entryKey(entry);
  const bucketA = key.dormKey ? 0 : 1; const bucketB = cursor.dormKey ? 0 : 1;
  if (bucketA !== bucketB) {
    return bucketA > bucketB;
  }
  if (bucketA === 0) {
    const delta = zones.compareDormKey(key.dormKey, cursor.dormKey);
    if (delta !== 0) {
      return delta > 0;
    }
  }
  return key.allocSeq > cursor.allocSeq;
}

// 行游标：空 dormKey 行同样产游标（{dormKey:'', allocSeq}），否则空置底后下一页不可达。
function bindingCursorOf(entry) {
  const key = entryKey(entry);
  return { dormKey: key.dormKey, allocSeq: key.allocSeq };
}

// ── 关键词匹配（DATA_MODEL §7.4：昵称/楼栋/宿舍/roomTag/尾号四位/customerNo）────────────────
function matchKeyword(row, keyword) {
  if (!keyword) {
    return true;
  }
  const word = keyword.toLowerCase();
  const compact = word.replace(KEYWORD_SEPARATOR, '');
  const fields = [row.displayName, row.dormKey, row.roomTag, row.buildingText, row.phoneTail];
  for (let i = 0; i < fields.length; i += 1) {
    if (textOf(fields[i]).toLowerCase().indexOf(word) >= 0) {
      return true;
    }
  }
  // 编号按「去空格/连字符」比较：页面展示 C-XXXX-XXXX，库内是 CXXXXXXXX。
  const customerNo = textOf(row.customerNo).toLowerCase();
  return customerNo !== '' && compact !== '' && customerNo.indexOf(compact) >= 0;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  textOf,
  parseLimit,
  readKeyword,
  readFilters,
  matchFilters,
  parseBindingCursor,
  allocSeqOf,
  compareBindingEntries,
  isAfterBindingCursor,
  bindingCursorOf,
  matchKeyword
};
