// utils/recognize/station.js · 站点归一/文本命中（单源 = shared/stations.js；纯函数，零 wx）
// 口径（CONTRACT §3/§4.2 D32）：id 固定 P1~P8、正式名可由 config.stations 修改；识别按
// 「配置精确名 → 去标点规范名 → 静态别名 → 关键词命中」归一，**唯一最高分才采信**，
// 多解/无解一律留空让用户手选（宁可不猜，也不要把人指到错的驿站）。
// options.stations 可注入当前配置站点表（来自 config.getPublic.stations），缺省=内置默认；旧调用零破坏。
'use strict';

const shared = require('../../shared/stations');

// 只做只读引用（同一数组对象），不复制
const STATIONS = shared.STATIONS;
const ALIASES = shared.STATION_ALIASES;

function listStations(options) {
  return shared.listStations(options);
}

function stationName(id, options) {
  return shared.stationNameOf(id, options);
}

function stationIdOfName(name, options) {
  const normalized = shared.normalizeStation(name, options);
  return normalized.ok ? normalized.id : '';
}

function canonical(value) {
  return shared.canonicalStationText(typeof value === 'string' ? value : '');
}

function byOfKind(kind) {
  if (kind === shared.MATCH_KIND.ALIAS) {
    return 'alias';
  }
  return kind === shared.MATCH_KIND.KEYWORD ? 'keyword' : 'name';
}

/**
 * 在一段 OCR/非结构化文本里匹配唯一站点（多说法命中，单源 shared/stations）。
 * 精确名/规范名/静态别名优先，其余走关键词命中；多解/未命中返回 null（不猜）。
 * @param {string} text OCR 文本
 * @param {{stations?: Array<{id:string,name:string}>}} [options] 当前配置站点表
 * @returns {{id:string,name:string,by:string,kind:string}|null} 多义/未命中返回 null
 */
function matchStation(text, options) {
  const hit = shared.matchStationInText(text, options);
  if (!hit.id) {
    return null;
  }
  return { id: hit.id, name: hit.name, by: byOfKind(hit.kind), kind: hit.kind };
}

// D70：双判据开关（缺省均开）与「取件码 → 站点」推断（唯一命中才采信）
function inferOptionsOf(options) {
  return shared.stationInferOf(options);
}

function inferFromCode(code, options) {
  const hit = shared.inferStationFromCode(code, options);
  if (!hit) {
    return null;
  }
  return { id: hit.id, name: hit.name, by: 'code', pattern: hit.pattern, kind: 'code' };
}

// D80：识图站点 vs 码反推站点的双判据归一（冲突不猜，返回 conflict=true 且 id=''）
function resolveStation(textStation, code, options) {
  const codeStation = code ? inferFromCode(code, options) : null;
  return shared.resolveStationOf(textStation, codeStation, options);
}

// D80：冲突落到件上（统一文案 + 双方候选快照，供页面提示与复核排障）；返回 true=确有冲突
const STATION_CONFLICT_TEXT = '截图站点与取件码格式不一致，请手动选站点核对';
function markConflict(parcel, resolved) {
  if (!parcel || !resolved || resolved.conflict !== true) {
    return false;
  }
  parcel.stationConflict = true;
  parcel.stationConflictText = STATION_CONFLICT_TEXT;
  parcel.stationConflictStations = {
    text: resolved.textStation || null,
    code: resolved.codeStation || null
  };
  return true;
}

module.exports = {
  STATIONS,
  ALIASES,
  STATION_CONFLICT_TEXT,
  canonical,
  listStations,
  stationName,
  stationIdOfName,
  matchStation,
  inferOptionsOf,
  inferFromCode,
  resolveStation,
  markConflict,
  normalizeStation: shared.normalizeStation
};
