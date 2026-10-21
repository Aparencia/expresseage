// shared/zones.js · 五苑（楼区）标识、栋号/宿舍号值域与宿舍键拼装（纯函数，零 wx）
// 契约：docs/V4_CONTRACT.md v0.9 §3 术语表（zone/buildingNo/buildingText/room/dormKey）；
//       docs/V4_DATA_MODEL.md §4.5；docs/ENGINEERING §5.8（v3 utils/buildings.js 规则移植）。
// 口径：固定顺序 D→X→N→B→C（不是字母序）；入库一律大写；栋号整数 1~10；宿舍号数字且 ≥100。
// 调用方：shared/validate.js（宿舍身份校验）、页面资料表单、云端客户资料 handler、排序。
'use strict';

const ZONES = ['D', 'X', 'N', 'B', 'C']; // 顺序即权重，也是录入面板显示顺序
const ZONE_LABELS = { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' };
const BUILDING_MIN = 1;
const BUILDING_MAX = 10;
const DORM_MIN = 100;
const ROOM_MAX_DIGITS = 8;
const DORM_KEY_SEPARATOR = '-';

function normalizeZone(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const code = value.trim().toUpperCase();
  return ZONES.indexOf(code) === -1 ? '' : code;
}

function isZone(value) {
  return normalizeZone(value) !== '';
}

function zoneRank(value) {
  return ZONES.indexOf(normalizeZone(value));
}

function zoneLabel(value, labels) {
  const zone = normalizeZone(value);
  if (!zone) {
    return '';
  }
  const table = labels && typeof labels === 'object' ? labels : ZONE_LABELS;
  return table[zone] || ZONE_LABELS[zone] || '';
}

function isBuildingNo(value) {
  return typeof value === 'number' && Math.floor(value) === value && value >= BUILDING_MIN && value <= BUILDING_MAX;
}

// 宿舍号归一：去前导零，仍须 ≥100；返回 '' 表示非法（不截断，截断会变成另一间房）
function canonicalRoom(value) {
  let text = '';
  if (typeof value === 'number' && Math.floor(value) === value) {
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  }
  if (!/^[0-9]+$/.test(text)) {
    return '';
  }
  const digits = text.replace(/^0+(?=\d)/, '');
  if (digits.length > ROOM_MAX_DIGITS) {
    return '';
  }
  const numberValue = Number(digits);
  if (!(numberValue >= DORM_MIN)) {
    return '';
  }
  return digits;
}

function isRoom(value) {
  return canonicalRoom(value) !== '';
}

function buildingText(zone, buildingNo) {
  const code = normalizeZone(zone);
  if (!code || !isBuildingNo(buildingNo)) {
    return '';
  }
  return code + String(buildingNo);
}

function dormKey(zone, buildingNo, room) {
  const building = buildingText(zone, buildingNo);
  const roomText = canonicalRoom(room);
  if (!building || !roomText) {
    return '';
  }
  return building + DORM_KEY_SEPARATOR + roomText;
}

function parseDormKey(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'FORMAT', field: 'dormKey' };
  }
  const parts = value.trim().split(DORM_KEY_SEPARATOR);
  if (parts.length !== 2) {
    return { ok: false, reason: 'FORMAT', field: 'dormKey' };
  }
  const zone = normalizeZone(parts[0].charAt(0));
  const buildingNo = Number(parts[0].slice(1));
  const room = canonicalRoom(parts[1]);
  if (!zone || !isBuildingNo(buildingNo) || !room) {
    return { ok: false, reason: 'FORMAT', field: 'dormKey' };
  }
  return { ok: true, zone, buildingNo, room, dormKey: dormKey(zone, buildingNo, room) };
}

// 排序：苑固定序 → 栋号 → 宿舍号数值（禁止字符串排序，D10 会排到 D9 前面）
function compareDormKey(a, b) {
  const left = parseDormKey(a);
  const right = parseDormKey(b);
  if (!left.ok || !right.ok) {
    return String(a || '').localeCompare(String(b || ''));
  }
  const zoneDelta = zoneRank(left.zone) - zoneRank(right.zone);
  if (zoneDelta !== 0) {
    return zoneDelta;
  }
  if (left.buildingNo !== right.buildingNo) {
    return left.buildingNo - right.buildingNo;
  }
  return Number(left.room) - Number(right.room);
}

module.exports = {
  ZONES,
  ZONE_LABELS,
  BUILDING_MIN,
  BUILDING_MAX,
  DORM_MIN,
  normalizeZone,
  isZone,
  zoneRank,
  zoneLabel,
  isBuildingNo,
  canonicalRoom,
  isRoom,
  buildingText,
  dormKey,
  parseDormKey,
  compareDormKey
};
