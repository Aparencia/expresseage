// utils/recognize/station.js · 站点归一（单源 = shared/stations.js；纯函数，零 wx）
// 口径（CONTRACT §3/§4.2）：只认 P1~P8 正式名与别名归一，不做自建站点、不做模糊并点；
// 判不准一律留空让用户手选（宁可不猜，也不要把人指到错的驿站）。
// 本文件不再持有 STATIONS/ALIASES 副本：表与归一规则只在 shared/stations.js 维护一份。
'use strict';

const shared = require('../../shared/stations');

// 只做只读引用（同一数组对象），不复制
const STATIONS = shared.STATIONS;
const ALIASES = shared.STATION_ALIASES;

function listStations() {
  return shared.listStations();
}

function stationName(id) {
  return shared.stationNameOf(id);
}

function stationIdOfName(name) {
  const normalized = shared.normalizeStation(name);
  return normalized.ok ? normalized.id : '';
}

function canonical(value) {
  return shared.canonicalStationText(typeof value === 'string' ? value : '');
}

/**
 * 在一段 OCR 文本里匹配唯一站点。
 * - 正常文本：直接委托 shared.normalizeStation（表与归一规则单源）。
 * - OCR 常见差异（半角括号/额外空格）：shared 的「包含正式名」分支按原文比对会漏判，
 *   这里用 shared 的 canonicalStationText 做包含探测，唯一命中才采纳；多义一律留空。
 * - 双正式名守卫：shared 的别名分支只比对第一个包含到的正式名，文本同时出现两个站点时
 *   单靠它会把两义判成一点，端侧必须判歧义返回 null（CONTRACT §3「宁可不猜」）。
 * @returns {{id:string,name:string,by:string,kind:string}|null} 多义/未命中返回 null
 */
function matchStation(text) {
  const raw = typeof text === 'string' ? text : '';
  if (raw === '') return null;
  const probe = canonical(raw);
  const nameHits = [];
  for (let i = 0; i < STATIONS.length; i += 1) {
    if (probe.indexOf(canonical(STATIONS[i].name)) >= 0) nameHits.push(STATIONS[i].id);
  }
  if (nameHits.length > 1) return null;
  const direct = shared.normalizeStation(raw);
  if (direct.ok) {
    if (nameHits.length === 1 && nameHits[0] !== direct.id) return null;
    return {
      id: direct.id,
      name: direct.name || stationName(direct.id),
      by: direct.kind === 'alias' ? 'alias' : 'name',
      kind: direct.kind
    };
  }
  const ids = nameHits.slice();
  for (let i = 0; i < ALIASES.length; i += 1) {
    const id = ALIASES[i].id;
    if (probe.indexOf(canonical(ALIASES[i].alias)) >= 0 && ids.indexOf(id) < 0) ids.push(id);
  }
  if (ids.length !== 1) return null;
  return {
    id: ids[0],
    name: stationName(ids[0]),
    by: nameHits.length === 1 ? 'name' : 'alias',
    kind: 'contains'
  };
}

module.exports = {
  STATIONS,
  ALIASES,
  canonical,
  listStations,
  stationName,
  stationIdOfName,
  matchStation,
  normalizeStation: shared.normalizeStation
};
