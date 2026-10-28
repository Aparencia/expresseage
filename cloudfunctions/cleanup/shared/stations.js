// shared/stations.js · 校园取件点 P1~P8、名称可配与多说法命中归一（纯函数，零 wx）
// 契约：docs/V4_CONTRACT.md v1.1 §3/§4.2（D32：正式名可由 config.stations 修改，识别按「匹配命中」归一）；
//       docs/V4_DATA_MODEL.md §2.10（config.stations 字段）；docs/V4_ENGINEERING.md §3.6（全局配置）。
// 口径：站点 id 固定 P1~P8（禁自建站点）；名称默认内置、后台可改（1~20 字、非空、唯一，非法回退默认）；
//       识别/手输按「配置精确名 → 去标点规范名 → 静态别名 → 关键词命中」归一，**唯一最高分才采信**，
//       多解/无解一律不猜（宁可不猜，也不要把人指到错的驿站）。
// 调用方：识别零件（utils/recognize/*）、下单/改码校验（云+端）、后台配置页、AI 兜底与复核回填。
// 旧接口零破坏：STATIONS/STATION_ALIASES/listStations/normalizeStation/... 不带 options 时一律用内置表。
'use strict';

// 内置默认名（config.stations 缺省/非法时回退；改名不影响 id）
const STATIONS = [
  { id: 'P1', name: '西苑顺丰快递（西苑五食堂）' },
  { id: 'P2', name: '西苑京东快递（西苑五食堂）' },
  { id: 'P3', name: '西苑一栋南面快递中心' },
  { id: 'P4', name: '北部菜鸟驿站（北苑一食堂三楼）' },
  { id: 'P5', name: '西苑菜鸟驿站（西苑五食堂22栋）' },
  { id: 'P6', name: '南苑菜鸟驿站' },
  { id: 'P7', name: '西苑一栋邮政' },
  { id: 'P8', name: '东苑一栋邮政' }
];

// DEFAULT_STATIONS 与 STATIONS 同一份数据（历史调用方继续拿 STATIONS，不复制第二张表）
const DEFAULT_STATIONS = STATIONS;

// 别名只给识别/手输归一用（出处见 v3 STATION_MAP：真机卡片与用户澄清的既有写法）
const STATION_ALIASES = [
  { alias: '湖工大西苑一栋南面菜鸟驿站', id: 'P3' },
  { alias: '西苑一栋南面菜鸟驿站', id: 'P3' },
  { alias: '湖工大苑一栋南面菜鸟驿站', id: 'P3' },
  { alias: '湖工大西苑1栋南面菜鸟驿站', id: 'P3' },
  { alias: '西苑1栋南面菜鸟驿站', id: 'P3' },
  { alias: '五食堂21栋楼下', id: 'P3' },
  { alias: '西苑邮政', id: 'P7' },
  { alias: '西苑一栋南面', id: 'P3' },
  { alias: '北苑食堂三楼', id: 'P4' },
  { alias: '南苑食堂三楼', id: 'P6' }
];

const STATION_IDS = STATIONS.map((item) => item.id);
const STATION_COUNT = STATIONS.length;
const STATION_NAME_MIN = 1;
const STATION_NAME_MAX = 20;

// 关键词命中 token（名称/别名抽 token；长度越长权重越大；跨站点通用词只做微调，避免压过正式名）
const KEYWORD_TOKENS = [
  '菜鸟驿站', '快递中心', '五食堂', '一食堂', '西苑', '东苑', '南苑', '北苑', '翠苑',
  '顺丰', '京东', '菜鸟', '邮政', '快递', '驿站', '食堂', '三楼', '南面', '楼下',
  '一栋', '二栋', '三栋', '四栋', '五栋', '六栋', '七栋', '八栋', '九栋', '十栋',
  '21栋', '22栋', '苑', '楼', '楼栋'
];

const MATCH_KIND = {
  EXACT: 'exact',
  CANONICAL: 'canonical',
  ALIAS: 'alias',
  CONTAINS: 'contains',
  KEYWORD: 'keyword',
  NONE: 'none',
  AMBIGUOUS: 'ambiguous'
};

// 苑 token：文本只出现一个苑时，属于其他苑的候选直接排除（避免「南苑菜鸟驿站」被「西苑菜鸟驿站」的连续命中带偏）
const ZONE_TOKENS = ['西苑', '东苑', '南苑', '北苑', '翠苑'];

// 命中打分权重（正式名连续命中 > token；唯一最高分才采信）
const NAME_HIT_MIN = 3;
const NAME_WEIGHT = 10;
const TOKEN_WEIGHT = 1;
const TOKEN_MIN_SCORE = 8;

// 每次返回独立对象（hits 不共享引用，调用方改写不影响后续调用）
function emptyMatch() {
  return { id: '', name: '', conflict: false, hits: [], kind: MATCH_KIND.NONE };
}

// 去空白与标点后再比（OCR/手打最常见差异是空格与标点；不删汉字，不做模糊归一）
function canonicalStationText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .replace(/[\s·、,，.。;；:：/\\|()（）\[\]【】\-—_]+/g, '');
}

function cloneStations(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({ id: item.id, name: item.name }));
}

function cleanStationName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const name = value.trim();
  if (name.length < STATION_NAME_MIN || name.length > STATION_NAME_MAX) {
    return '';
  }
  return name;
}

// config.stations → 每个 id 的第一条合法名称（未知 id/空名/超长名一律忽略，留待回退默认）
function providedStationsOf(config) {
  const source = config && Array.isArray(config.stations) ? config.stations : [];
  const provided = {};
  source.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    if (STATION_IDS.indexOf(item.id) < 0 || provided[item.id]) {
      return;
    }
    const name = cleanStationName(item.name);
    if (name) {
      provided[item.id] = name;
    }
  });
  return provided;
}

// 旧配置缺 stations / 条目非法 / 重名 → 该条目回退内置默认名；输出固定 P1~P8 顺序、名称必唯一
function stationsFromConfig(config) {
  const provided = providedStationsOf(config);
  const used = {};
  return STATIONS.map((item) => {
    const custom = provided[item.id];
    const reservedByDefault = STATIONS.some((other) => other.id !== item.id && other.name === custom);
    if (custom && !reservedByDefault && !used[custom]) {
      used[custom] = true;
      return { id: item.id, name: custom };
    }
    used[item.name] = true;
    return { id: item.id, name: item.name };
  });
}

function buildTable(stations) {
  const byId = {};
  const byName = {};
  const byCanonical = {};
  const aliasesById = {};
  stations.forEach((item) => {
    byId[item.id] = item.name;
    byName[item.name] = item.id;
    const canonical = canonicalStationText(item.name);
    if (canonical) {
      byCanonical[canonical] = item.id;
    }
    aliasesById[item.id] = [];
  });
  STATION_ALIASES.forEach((item) => {
    if (!aliasesById[item.id]) {
      return;
    }
    const canonical = canonicalStationText(item.alias);
    if (canonical && aliasesById[item.id].indexOf(canonical) < 0) {
      aliasesById[item.id].push(canonical);
    }
  });
  return { stations: stations, byId: byId, byName: byName, byCanonical: byCanonical, aliasesById: aliasesById };
}

const DEFAULT_TABLE = buildTable(cloneStations(STATIONS));

// options 形状统一 { stations: [{id,name}] }；不传/非法 → 内置默认表（旧调用零破坏）
function resolveTable(options) {
  if (options && Array.isArray(options.stations)) {
    return buildTable(stationsFromConfig(options));
  }
  return DEFAULT_TABLE;
}

function nameOfTable(table, stationId) {
  return table.byId[stationId] || '';
}

function listStations(options) {
  return cloneStations(resolveTable(options).stations);
}

function isStationId(stationId) {
  return typeof stationId === 'string' && STATION_IDS.indexOf(stationId) !== -1;
}

function stationNameOf(stationId, options) {
  if (!isStationId(stationId)) {
    return '';
  }
  return nameOfTable(resolveTable(options), stationId);
}

function okResult(id, table, kind) {
  return { ok: true, id: id, name: nameOfTable(table, id), kind: kind };
}

function missResult(kind) {
  return { ok: false, id: '', name: '', kind: kind };
}

function containedStationIds(raw, table) {
  return table.stations
    .filter((item) => item.name && raw.indexOf(item.name) !== -1)
    .map((item) => item.id);
}

function containedCanonicalIds(canonicalInput, table) {
  return table.stations
    .filter((item) => {
      const canonical = canonicalStationText(item.name);
      return canonical !== '' && canonicalInput.indexOf(canonical) !== -1;
    })
    .map((item) => item.id);
}

function aliasIdsIn(canonicalInput, table) {
  const ids = [];
  STATION_ALIASES.forEach((item) => {
    if (!table.byId[item.id]) {
      return;
    }
    const key = canonicalStationText(item.alias);
    if (key !== '' && canonicalInput.indexOf(key) !== -1 && ids.indexOf(item.id) < 0) {
      ids.push(item.id);
    }
  });
  return ids;
}

// 命中「完整站点名」的候选（原文逐字 + 去标点两种形态取并集，兼容 OCR 空格/标点漂移）
function containedIdsOf(raw, canonicalInput, table) {
  const ids = containedStationIds(raw, table);
  containedCanonicalIds(canonicalInput, table).forEach((id) => {
    if (ids.indexOf(id) < 0) {
      ids.push(id);
    }
  });
  return ids;
}

// 归一：配置精确名（逐字/去标点）→ 静态别名 → 包含且仅包含一个配置名；多解或未命中一律 ok:false
// 返回 { ok, id, name, kind }；ok:false 时 id/name 均为 ''（调用方保留用户原文，不要覆盖输入）
function normalizeStation(input, options) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') {
    return missResult(MATCH_KIND.NONE);
  }
  const table = resolveTable(options);
  const exactId = table.byName[raw];
  if (exactId) {
    return okResult(exactId, table, MATCH_KIND.EXACT);
  }
  const canonicalInput = canonicalStationText(raw);
  if (canonicalInput === '') {
    return missResult(MATCH_KIND.NONE);
  }
  const canonicalId = table.byCanonical[canonicalInput];
  if (canonicalId) {
    return okResult(canonicalId, table, MATCH_KIND.CANONICAL);
  }
  const aliasIds = aliasIdsIn(canonicalInput, table);
  if (aliasIds.length > 1) {
    return missResult(MATCH_KIND.AMBIGUOUS);
  }
  const containedIds = containedIdsOf(raw, canonicalInput, table);
  if (aliasIds.length === 1) {
    if (containedIds.some((id) => id !== aliasIds[0])) {
      return missResult(MATCH_KIND.AMBIGUOUS);
    }
    return okResult(aliasIds[0], table, MATCH_KIND.ALIAS);
  }
  if (containedIds.length === 1) {
    return okResult(containedIds[0], table, MATCH_KIND.CONTAINS);
  }
  if (containedIds.length > 1) {
    return missResult(MATCH_KIND.AMBIGUOUS);
  }
  return missResult(MATCH_KIND.NONE);
}

// 最长连续公共子串长度（多说法命中主信号：连续命中越长越可信，不做逐字散点匹配）
function longestCommonLength(a, b) {
  if (!a || !b) {
    return 0;
  }
  const right = b.length + 1;
  const prev = new Array(right).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= right - 1; j += 1) {
      const keep = prev[j];
      prev[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? diagonal + 1 : 0;
      diagonal = keep;
      if (prev[j] > best) {
        best = prev[j];
      }
    }
  }
  return best;
}

function tokenScoreOf(canonicalInput, nameCanonical, aliasCanons) {
  let score = 0;
  KEYWORD_TOKENS.forEach((token) => {
    if (canonicalInput.indexOf(token) < 0) {
      return;
    }
    if (nameCanonical.indexOf(token) >= 0) {
      score += token.length * token.length * TOKEN_WEIGHT;
    } else if (aliasCanons.some((alias) => alias.indexOf(token) >= 0)) {
      score += token.length * token.length * 0.5 * TOKEN_WEIGHT;
    }
  });
  return score;
}

// 单站点关键词得分：正式名连续命中(×10) + token 命中（正式名 token 权重 1、仅别名 token 权重 0.5，按长度平方加权）
function keywordScoreOf(item, table, canonicalInput) {
  const nameCanonical = canonicalStationText(item.name);
  let score = 0;
  const nameHit = longestCommonLength(canonicalInput, nameCanonical);
  if (nameHit >= NAME_HIT_MIN) {
    score += nameHit * NAME_WEIGHT;
  }
  return score + tokenScoreOf(canonicalInput, nameCanonical, table.aliasesById[item.id] || []);
}

function tokensOfZones(text) {
  return ZONE_TOKENS.filter((token) => text.indexOf(token) >= 0);
}

// 苑冲突：文本只点了一个苑，而候选名称/别名属于另一个苑 → 该候选不参与关键词打分（不猜别的苑）
function hasZoneConflict(item, table, textZones) {
  if (textZones.length !== 1) {
    return false;
  }
  const phrases = [canonicalStationText(item.name)].concat(table.aliasesById[item.id] || []).join(' ');
  const candidateZones = tokensOfZones(phrases);
  return candidateZones.length > 0 && candidateZones.indexOf(textZones[0]) < 0;
}

// 关键词候选：排除跨苑候选后按分降序；同分并列（调用方判歧义）
function keywordCandidatesOf(canonicalInput, table) {
  const textZones = tokensOfZones(canonicalInput);
  return table.stations
    .filter((item) => !hasZoneConflict(item, table, textZones))
    .map((item) => ({ id: item.id, score: keywordScoreOf(item, table, canonicalInput) }))
    .filter((row) => row.score >= TOKEN_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

function uniqueTopOf(ranked) {
  if (ranked.length === 0 || ranked[0].score < TOKEN_MIN_SCORE) {
    return null;
  }
  if (ranked.length > 1 && ranked[1].score === ranked[0].score) {
    return null;
  }
  return ranked[0];
}

function ambiguousMatch(ids, table) {
  const hits = [];
  (ids || []).forEach((id) => {
    if (id && table.byId[id] && hits.indexOf(id) < 0) {
      hits.push(id);
    }
  });
  return { id: '', name: '', conflict: true, hits: hits, kind: MATCH_KIND.AMBIGUOUS };
}

// 严格匹配层（优先于关键词）：配置精确名 → 去标点规范名 → 静态别名 → 包含（全部去标点后比）
function tierHitOf(raw, canonicalInput, table) {
  const exactId = table.byName[raw];
  if (exactId) {
    return { id: exactId, kind: MATCH_KIND.EXACT, ambiguous: [] };
  }
  const canonicalId = table.byCanonical[canonicalInput];
  if (canonicalId) {
    return { id: canonicalId, kind: MATCH_KIND.CANONICAL, ambiguous: [] };
  }
  const aliasIds = aliasIdsIn(canonicalInput, table);
  const containedIds = containedIdsOf(raw, canonicalInput, table);
  if (aliasIds.length > 1) {
    return { id: '', kind: MATCH_KIND.AMBIGUOUS, ambiguous: aliasIds.concat(containedIds) };
  }
  if (aliasIds.length === 1) {
    if (containedIds.some((id) => id !== aliasIds[0])) {
      return { id: '', kind: MATCH_KIND.AMBIGUOUS, ambiguous: aliasIds.concat(containedIds) };
    }
    return { id: aliasIds[0], kind: MATCH_KIND.ALIAS, ambiguous: [] };
  }
  if (containedIds.length > 1) {
    return { id: '', kind: MATCH_KIND.AMBIGUOUS, ambiguous: containedIds };
  }
  if (containedIds.length === 1) {
    return { id: containedIds[0], kind: MATCH_KIND.CONTAINS, ambiguous: [] };
  }
  return { id: '', kind: MATCH_KIND.NONE, ambiguous: [] };
}

function hitResult(id, kind, ranked, table) {
  const hits = [id];
  ranked.forEach((row) => {
    if (hits.indexOf(row.id) < 0) {
      hits.push(row.id);
    }
  });
  return { id: id, name: nameOfTable(table, id), conflict: false, hits: hits.slice(0, 3), kind: kind };
}

/**
 * 一段 OCR/手输文本 → 站点匹配命中（多说法归一，契约 D32）。
 * 顺序：配置精确名 → 去标点规范名 → 静态别名 → 包含 → 关键词命中（正式名连续命中 + token 加权，
 * 只出现一个苑时排除其他苑的候选）；严格层命中即采信，关键词层只有唯一最高分才采信；
 * 多解 conflict=true 且 id=''（不猜）；未命中 conflict=false 且 id=''。
 * @param {string} text 识别文本（可含噪声）
 * @param {{stations?: Array<{id:string,name:string}>}} [options] 当前配置站点表（缺省=内置默认）
 * @returns {{id:string,name:string,conflict:boolean,hits:string[],kind:string}}
 */
function matchStationInText(text, options) {
  const raw = typeof text === 'string' ? text : '';
  const canonicalInput = canonicalStationText(raw);
  if (canonicalInput === '') {
    return emptyMatch();
  }
  const table = resolveTable(options);
  const tier = tierHitOf(raw, canonicalInput, table);
  const ranked = keywordCandidatesOf(canonicalInput, table);
  if (tier.kind === MATCH_KIND.AMBIGUOUS) {
    return ambiguousMatch(tier.ambiguous.concat(ranked.map((row) => row.id)), table);
  }
  if (tier.id) {
    // 严格层命中即采信（契约 D32 的匹配顺序：精确名→规范名→别名→关键词；关键词只在前面都未命中时兜底）
    return hitResult(tier.id, tier.kind, ranked, table);
  }
  if (ranked.length === 0) {
    return emptyMatch();
  }
  const top = uniqueTopOf(ranked);
  if (!top) {
    const tied = ranked.filter((row) => row.score === ranked[0].score).map((row) => row.id);
    return ambiguousMatch(tied.concat(ranked.map((row) => row.id)), table);
  }
  return hitResult(top.id, MATCH_KIND.KEYWORD, ranked, table);
}

// 站点值域校验（下单/改码）：只接受 P1~P8 的 id 或能归一到配置名的文本
function validateStation(stationId, stationName, options) {
  if (isStationId(stationId)) {
    return { ok: true, id: stationId, name: stationNameOf(stationId, options) };
  }
  const normalized = normalizeStation(stationName, options);
  if (normalized.ok) {
    return { ok: true, id: normalized.id, name: normalized.name };
  }
  return { ok: false, reason: 'FORMAT', field: 'stationId' };
}

module.exports = {
  STATIONS,
  DEFAULT_STATIONS,
  STATION_ALIASES,
  STATION_IDS,
  STATION_COUNT,
  STATION_NAME_MIN,
  STATION_NAME_MAX,
  KEYWORD_TOKENS,
  MATCH_KIND,
  stationsFromConfig,
  listStations,
  isStationId,
  stationNameOf,
  canonicalStationText,
  normalizeStation,
  matchStationInText,
  validateStation
};
