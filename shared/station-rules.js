// shared/station-rules.js · 站点配置净化（顺序/别名/取件码格式）与取件码→站点推断（纯函数，零 wx）
// 契约：docs/contract/V4_CONTRACT.md §13 D70（站点双判据）/D71（站点顺序与别名）；
//       docs/data/V4_DATA_MODEL.md §2.10（config.stations 字段形状）。
// 口径：
//   1) 站点 id 固定 P1~P8（禁自建）；**数组顺序即展示顺序**（默认 P1~P8），后台可上下移动；
//   2) 每站点 0~5 个别名（1~20 字），仅用于识别/手输归一，**不展示、不产生新站点/新分组**；
//   3) 每站点 0~3 个取件码格式：`*` = 1 位以上字母/数字，其余字符按字面量（允许 `-`），
//      整串匹配（大小写不敏感）；唯一站点命中才采信，多站点命中=歧义不猜（宁可不猜，不指错驿站）。
// 调用方：shared/stations.js（表构建/归一）、config/defaults.js（默认值/公开子集净化）、
//         admin.updateConfig（整表校验）、pkg-admin 配置页（行模型/校验）、cloud handlers（AI 规则快照）。
'use strict';

const STATION_ALIAS_MAX = 5;
const STATION_ALIAS_LEN_MIN = 1;
const STATION_ALIAS_LEN_MAX = 20;
const STATION_PATTERN_MAX = 3;
const STATION_PATTERN_LEN_MAX = 40;
// 格式字面量：字母数字、`*` 通配、`-` 分隔符；其余字符一律不接受
const PATTERN_LITERAL_RE = /^[0-9A-Za-z*\-]+$/;
const PATTERN_MIN_LENGTH = 2;

const STATION_CONFIG_ERROR_TEXT = {
  COUNT: '站点需覆盖全部 8 个站点（P1~P8，可调整顺序）。',
  ID: '站点编码不正确（只允许 P1~P8，且不能重复）。',
  NAME: '站点名称需填 1~20 字。',
  DUP_NAME: '站点名称不能重复。',
  ALIAS_LEN: '站点别名需填 1~20 字。',
  ALIAS_COUNT: '每个站点最多 5 个别名。',
  ALIAS_DUP: '站点别名不能与其他名称或别名重复。',
  PATTERN_FORMAT: '取件码格式只能用字母/数字/-/*，且必须包含 *（例：*-*-****）。',
  PATTERN_COUNT: '每个站点最多 3 个取件码格式。',
  PATTERN_DUP: '取件码格式不能重复。'
};

function stationErrorText(code) {
  return STATION_CONFIG_ERROR_TEXT[code] || '站点配置格式不正确。';
}

function cleanStationName(value, max) {
  if (typeof value !== 'string') {
    return '';
  }
  const name = value.trim();
  const limit = typeof max === 'number' ? max : STATION_ALIAS_LEN_MAX;
  if (name.length < STATION_ALIAS_LEN_MIN || name.length > limit) {
    return '';
  }
  return name;
}

function cleanAliasList(list) {
  const source = Array.isArray(list) ? list : [];
  const out = [];
  source.forEach((item) => {
    const alias = cleanStationName(item, STATION_ALIAS_LEN_MAX);
    if (alias && out.indexOf(alias) < 0) {
      out.push(alias);
    }
  });
  return out.slice(0, STATION_ALIAS_MAX);
}

// 取件码格式归一：去空白、转大写；非法（空/超长/含非法字符/无 *）返回 ''。
function cleanCodePattern(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const pattern = value.trim().replace(/\s+/g, '').toUpperCase();
  if (pattern.length < PATTERN_MIN_LENGTH || pattern.length > STATION_PATTERN_LEN_MAX) {
    return '';
  }
  if (!PATTERN_LITERAL_RE.test(pattern) || pattern.indexOf('*') < 0) {
    return '';
  }
  return pattern;
}

function cleanPatternList(list) {
  const source = Array.isArray(list) ? list : [];
  const out = [];
  source.forEach((item) => {
    const pattern = cleanCodePattern(item);
    if (pattern && out.indexOf(pattern) < 0) {
      out.push(pattern);
    }
  });
  return out.slice(0, STATION_PATTERN_MAX);
}

function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `*` → 1 位以上字母/数字；其余字符字面量；整串锚定。
function patternSourceOf(pattern) {
  const parts = String(pattern || '').split('*').map(escapeLiteral);
  return '^' + parts.join('[0-9A-Za-z]+') + '$';
}

const REGEX_CACHE = Object.create(null);

function patternMatches(pattern, code) {
  const source = String(pattern || '');
  const value = String(code || '').trim().toUpperCase();
  if (!source || !value) {
    return false;
  }
  let regex = REGEX_CACHE[source];
  if (!regex) {
    regex = new RegExp(patternSourceOf(source));
    REGEX_CACHE[source] = regex;
  }
  return regex.test(value);
}

// 展示顺序 = 配置数组顺序（合法 id 首次出现）+ 缺失 id 按默认顺序补齐；非法 id/重复 id 忽略。
function orderIdsOf(rawList, defaultIds) {
  const order = [];
  (Array.isArray(rawList) ? rawList : []).forEach((item) => {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if (defaultIds.indexOf(id) >= 0 && order.indexOf(id) < 0) {
      order.push(id);
    }
  });
  defaultIds.forEach((id) => {
    if (order.indexOf(id) < 0) {
      order.push(id);
    }
  });
  return order;
}

function defaultByIdOf(defaults) {
  const byId = {};
  (Array.isArray(defaults) ? defaults : []).forEach((item) => { byId[item.id] = item; });
  return byId;
}

// 名称解析：配置名合法且不与其他站点默认名/已用名冲突才采用，否则回退该站点内置默认名
function resolveNames(order, provided, byId, base) {
  const nameById = {};
  const nameOwner = {};
  order.forEach((id) => {
    const def = byId[id];
    const item = provided[id] || {};
    let name = cleanStationName(item.name, STATION_ALIAS_LEN_MAX) || def.name;
    const reservedByDefault = base.some((other) => other.id !== id && other.name === name);
    if (reservedByDefault || nameOwner[name]) {
      name = def.name;
    }
    nameById[id] = name;
    nameOwner[name] = id;
  });
  return nameById;
}

// 别名解析：未配置该键则继承默认；显式空数组=清空；与任何正式名/已用别名冲突即丢弃
function resolveAliases(order, provided, byId, nameById, defaultNames) {
  const aliasOwner = {};
  const aliasById = {};
  order.forEach((id) => {
    const def = byId[id];
    const item = provided[id] || {};
    const out = [];
    const source = item.aliases === undefined ? (def.aliases || []) : item.aliases;
    cleanAliasList(source).forEach((alias) => {
      if (alias === nameById[id] || defaultNames.indexOf(alias) >= 0 || aliasOwner[alias]) {
        return;
      }
      if (order.some((otherId) => otherId !== id && nameById[otherId] === alias)) {
        return;
      }
      aliasOwner[alias] = id;
      out.push(alias);
    });
    aliasById[id] = out;
  });
  return aliasById;
}

// 取件码格式解析：未配置继承默认；跨站点重复格式只留首个（避免歧义）
function resolvePatterns(order, provided, byId) {
  const patternOwner = {};
  const patternById = {};
  order.forEach((id) => {
    const def = byId[id];
    const item = provided[id] || {};
    const out = [];
    const source = item.codePatterns === undefined ? (def.codePatterns || []) : item.codePatterns;
    cleanPatternList(source).forEach((pattern) => {
      if (patternOwner[pattern]) {
        return;
      }
      patternOwner[pattern] = id;
      out.push(pattern);
    });
    patternById[id] = out;
  });
  return patternById;
}

/**
 * config.stations 整表净化：输出固定 8 条、按配置顺序；名称/别名/格式非法或冲突时**逐项回退/丢弃**
 * （读层宽容：脏配置不外泄）。写层（admin.updateConfig）另用 validateStationConfig 严格拒绝。
 * @param {Array|undefined} rawList config.stations
 * @param {Array<{id:string,name:string}>} defaults 内置默认站点（P1~P8）
 * @returns {Array<{id:string,name:string,aliases:string[],codePatterns:string[]}>}
 */
function normalizeStations(rawList, defaults) {
  const base = Array.isArray(defaults) ? defaults : [];
  const defaultIds = base.map((item) => item.id);
  const byId = defaultByIdOf(base);
  const defaultNames = base.map((item) => item.name);
  const provided = {};
  (Array.isArray(rawList) ? rawList : []).forEach((item) => {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if (byId[id] && !provided[id]) {
      provided[id] = item;
    }
  });
  const order = orderIdsOf(rawList, defaultIds);
  const nameById = resolveNames(order, provided, byId, base);
  const aliasById = resolveAliases(order, provided, byId, nameById, defaultNames);
  const patternById = resolvePatterns(order, provided, byId);
  return order.map((id) => ({
    id: id,
    name: nameById[id],
    aliases: aliasById[id] || [],
    codePatterns: patternById[id] || []
  }));
}

/**
 * 写层严格校验（admin.updateConfig / 后台配置页共用）：覆盖 8 个固定 id、名称唯一、别名唯一、
 * 取件码格式合法且全局唯一、数组顺序任意（即新展示顺序）。
 * @returns {string} '' = 通过；否则 STATION_CONFIG_ERROR_TEXT 的键
 */
function validateStationConfig(rawList, defaults) {
  const base = Array.isArray(defaults) ? defaults : [];
  const defaultIds = base.map((item) => item.id);
  const list = Array.isArray(rawList) ? rawList : [];
  if (list.length !== defaultIds.length) {
    return 'COUNT';
  }
  const seen = {};
  const nameOwner = {};
  const nameError = validateNameRows(list, defaultIds, seen, nameOwner);
  if (nameError) {
    return nameError;
  }
  const aliasError = validateAliasRows(list, nameOwner);
  if (aliasError) {
    return aliasError;
  }
  const patternError = validatePatternRows(list);
  if (patternError) {
    return patternError;
  }
  for (let i = 0; i < defaultIds.length; i += 1) {
    if (!seen[defaultIds[i]]) {
      return 'COUNT';
    }
  }
  return '';
}

// 名称/id 行校验：id 只认 P1~P8 且不重复；名称非空且唯一
function validateNameRows(list, defaultIds, seen, nameOwner) {
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    const id = typeof item.id === 'string' ? item.id : '';
    if (defaultIds.indexOf(id) < 0 || seen[id]) {
      return 'ID';
    }
    seen[id] = true;
    const name = cleanStationName(item.name, STATION_ALIAS_LEN_MAX);
    if (!name) {
      return 'NAME';
    }
    if (nameOwner[name]) {
      return 'DUP_NAME';
    }
    nameOwner[name] = id;
  }
  return '';
}

// 别名行校验：每站 ≤5、1~20 字、与所有名称/别名全局唯一
function validateAliasRows(list, nameOwner) {
  const aliasOwner = {};
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    const id = typeof item.id === 'string' ? item.id : '';
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    if (aliases.length > STATION_ALIAS_MAX) {
      return 'ALIAS_COUNT';
    }
    for (let j = 0; j < aliases.length; j += 1) {
      const alias = cleanStationName(aliases[j], STATION_ALIAS_LEN_MAX);
      if (!alias) {
        return 'ALIAS_LEN';
      }
      if (aliasOwner[alias]) {
        return 'ALIAS_DUP';
      }
      aliasOwner[alias] = id;
    }
  }
  const keys = Object.keys(aliasOwner);
  for (let i = 0; i < keys.length; i += 1) {
    if (nameOwner[keys[i]]) {
      return 'ALIAS_DUP';
    }
  }
  return '';
}

// 取件码格式行校验：每站 ≤3、含 *、跨站点唯一
function validatePatternRows(list) {
  const patternOwner = {};
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    const id = typeof item.id === 'string' ? item.id : '';
    const patterns = Array.isArray(item.codePatterns) ? item.codePatterns : [];
    if (patterns.length > STATION_PATTERN_MAX) {
      return 'PATTERN_COUNT';
    }
    for (let k = 0; k < patterns.length; k += 1) {
      const pattern = cleanCodePattern(patterns[k]);
      if (!pattern) {
        return 'PATTERN_FORMAT';
      }
      if (patternOwner[pattern]) {
        return 'PATTERN_DUP';
      }
      patternOwner[pattern] = id;
    }
  }
  return '';
}

/**
 * 取件码 → 站点（D70）：整串匹配各站点格式；恰好一个站点命中才采信，零/多命中返回 null（不猜）。
 * @param {string} code 取件码原文（保留分隔符，如 64-4-4033 / T-0-2051）
 * @param {Array<{id:string,name:string,codePatterns:string[]}>} stations 净化后的站点表（顺序即优先级）
 * @returns {{id:string,name:string,pattern:string}|null}
 */
function matchCodeStation(code, stations) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) {
    return null;
  }
  const hits = [];
  (Array.isArray(stations) ? stations : []).forEach((station) => {
    const patterns = station && Array.isArray(station.codePatterns) ? station.codePatterns : [];
    for (let i = 0; i < patterns.length; i += 1) {
      if (patternMatches(patterns[i], value)) {
        if (!hits.some((row) => row.id === station.id)) {
          hits.push({ id: station.id, name: station.name, pattern: patterns[i] });
        }
        return;
      }
    }
  });
  return hits.length === 1 ? hits[0] : null;
}

module.exports = {
  STATION_ALIAS_MAX,
  STATION_ALIAS_LEN_MIN,
  STATION_ALIAS_LEN_MAX,
  STATION_PATTERN_MAX,
  STATION_PATTERN_LEN_MAX,
  PATTERN_LITERAL_RE,
  STATION_CONFIG_ERROR_TEXT,
  stationErrorText,
  cleanAliasList,
  cleanCodePattern,
  cleanPatternList,
  patternSourceOf,
  patternMatches,
  orderIdsOf,
  normalizeStations,
  validateStationConfig,
  matchCodeStation
};
