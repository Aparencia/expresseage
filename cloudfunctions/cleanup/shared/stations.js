// shared/stations.js · 校园取件点 P1~P8 与别名归一（纯函数，零 wx）
// 契约：docs/V4_CONTRACT.md v0.9 §3「站点正式名沿用 v3 P1~P8 与别名归一」、§4.2「站点值域（MVP）」；
//       docs/ENGINEERING §5.8（v3 utils/stations.js 规则移植：正式名 + 别名，禁自建站点）。
// 口径：MVP 只能落在 P1~P8 正式名；识别/手输先过 normalizeStation 归一，判不准就留空让用户手选
//       （宁可不猜，也不要把人指到错的驿站）。别名只用于归一，不进"给人选"的列表。
// 调用方：识别零件（utils/recognize/*）、下单/改码校验、云端 order.correct 校验、站点分组。
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

const STATION_BY_ID = {};
const STATION_BY_NAME = {};
STATIONS.forEach((item) => {
  STATION_BY_ID[item.id] = item.name;
  STATION_BY_NAME[item.name] = item.id;
});

const STATION_IDS = STATIONS.map((item) => item.id);
const STATION_COUNT = STATIONS.length;

function listStations() {
  return STATIONS.map((item) => ({ id: item.id, name: item.name }));
}

function isStationId(stationId) {
  return typeof stationId === 'string' && STATION_IDS.indexOf(stationId) !== -1;
}

function stationNameOf(stationId) {
  return STATION_BY_ID[stationId] || '';
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

// 归一：正式名（逐字/去标点）→ 别名 → 包含且仅包含一个正式名；多解或未命中一律 ok:false
// 返回 { ok, id, name, kind }；ok:false 时 id/name 均为 ''（调用方保留用户原文，不要覆盖输入）
function normalizeStation(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') {
    return { ok: false, id: '', name: '', kind: 'none' };
  }
  const rawId = STATION_BY_NAME[raw];
  if (rawId) {
    return { ok: true, id: rawId, name: STATION_BY_ID[rawId], kind: 'exact' };
  }
  const canonicalInput = canonicalStationText(raw);
  if (canonicalInput === '') {
    return { ok: false, id: '', name: '', kind: 'none' };
  }
  const canonicalHit = STATIONS.filter((item) => canonicalStationText(item.name) === canonicalInput)[0];
  if (canonicalHit) {
    return { ok: true, id: canonicalHit.id, name: canonicalHit.name, kind: 'canonical' };
  }

  // 别名命中（多个别名指向不同点 = 有歧义，不猜）
  const aliasIds = [];
  STATION_ALIASES.forEach((item) => {
    const key = canonicalStationText(item.alias);
    if (key !== '' && canonicalInput.indexOf(key) !== -1 && aliasIds.indexOf(item.id) === -1) {
      aliasIds.push(item.id);
    }
  });
  if (aliasIds.length > 1) {
    return { ok: false, id: '', name: '', kind: 'ambiguous' };
  }
  const contained = STATIONS.filter((item) => raw.indexOf(item.name) !== -1);
  if (aliasIds.length === 1) {
    if (contained.length > 0 && contained[0].id !== aliasIds[0]) {
      return { ok: false, id: '', name: '', kind: 'ambiguous' };
    }
    return { ok: true, id: aliasIds[0], name: STATION_BY_ID[aliasIds[0]], kind: 'alias' };
  }
  if (contained.length === 1) {
    return { ok: true, id: contained[0].id, name: contained[0].name, kind: 'contains' };
  }
  if (contained.length > 1) {
    return { ok: false, id: '', name: '', kind: 'ambiguous' };
  }
  return { ok: false, id: '', name: '', kind: 'none' };
}

// 站点值域校验（下单/改码）：只接受 P1~P8 的 id 或能归一到正式名的文本
function validateStation(stationId, stationName) {
  if (isStationId(stationId)) {
    return { ok: true, id: stationId, name: stationNameOf(stationId) };
  }
  const normalized = normalizeStation(stationName);
  if (normalized.ok) {
    return { ok: true, id: normalized.id, name: normalized.name };
  }
  return { ok: false, reason: 'FORMAT', field: 'stationId' };
}

module.exports = {
  STATIONS,
  STATION_ALIASES,
  STATION_IDS,
  STATION_COUNT,
  listStations,
  isStationId,
  stationNameOf,
  canonicalStationText,
  normalizeStation,
  validateStation
};
