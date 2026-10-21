// utils/recognize/station.js · 站点正式名与别名归一（单源；纯函数，零 wx）
// 口径（CONTRACT §3/§4.2）：只允许 P1~P8 正式名，不做自建站点、不做模糊并点。
'use strict';

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

// 识别/手输归一用别名（只指向一个点；不参与选择器展示）
const ALIASES = [
  { alias: '西苑顺丰', id: 'P1' },
  { alias: '顺丰五食堂', id: 'P1' },
  { alias: '西苑京东', id: 'P2' },
  { alias: '京东五食堂', id: 'P2' },
  { alias: '西苑一栋南面', id: 'P3' },
  { alias: '南面快递中心', id: 'P3' },
  { alias: '湖工大西苑一栋南面菜鸟驿站', id: 'P3' },
  { alias: '西苑一栋南面菜鸟驿站', id: 'P3' },
  { alias: '西苑1栋南面菜鸟驿站', id: 'P3' },
  { alias: '五食堂21栋', id: 'P3' },
  { alias: '北部菜鸟', id: 'P4' },
  { alias: '北苑食堂三楼', id: 'P4' },
  { alias: '北苑一食堂三楼', id: 'P4' },
  { alias: '西苑菜鸟', id: 'P5' },
  { alias: '五食堂22栋', id: 'P5' },
  { alias: '南苑菜鸟', id: 'P6' },
  { alias: '南苑食堂三楼', id: 'P6' },
  { alias: '西苑一栋邮政', id: 'P7' },
  { alias: '西苑邮政', id: 'P7' },
  { alias: '东苑一栋邮政', id: 'P8' },
  { alias: '东苑邮政', id: 'P8' }
];

function canonical(value) {
  let out = '';
  const str = String(value === undefined || value === null ? '' : value);
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += str.charAt(i);
  }
  return out.replace(/\s+/g, '').toUpperCase().replace(/[：:，,。.、|]/g, '');
}

function listStations() {
  return STATIONS.map(function clone(station) {
    return { id: station.id, name: station.name };
  });
}

function stationName(id) {
  for (let i = 0; i < STATIONS.length; i += 1) {
    if (STATIONS[i].id === id) return STATIONS[i].name;
  }
  return '';
}

function stationIdOfName(name) {
  const target = canonical(name);
  for (let i = 0; i < STATIONS.length; i += 1) {
    if (canonical(STATIONS[i].name) === target) return STATIONS[i].id;
  }
  return '';
}

/**
 * 在一段 OCR 文本里匹配唯一站点。
 * @returns {{id:string,name:string,by:string}|null} 多义（同时命中两个点）返回 null
 */
function matchStation(text) {
  const target = canonical(text);
  if (!target) return null;
  const hits = Object.create(null);
  for (let i = 0; i < STATIONS.length; i += 1) {
    if (target.indexOf(canonical(STATIONS[i].name)) >= 0) {
      hits[STATIONS[i].id] = { id: STATIONS[i].id, name: STATIONS[i].name, by: 'name' };
    }
  }
  for (let i = 0; i < ALIASES.length; i += 1) {
    if (target.indexOf(canonical(ALIASES[i].alias)) >= 0) {
      const id = ALIASES[i].id;
      if (!hits[id]) hits[id] = { id: id, name: stationName(id), by: 'alias' };
    }
  }
  const ids = Object.keys(hits);
  if (ids.length !== 1) return null;
  return hits[ids[0]];
}

module.exports = {
  STATIONS,
  ALIASES,
  canonical,
  listStations,
  stationName,
  stationIdOfName,
  matchStation
};
