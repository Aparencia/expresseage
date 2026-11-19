// shared/order-no.js · 订单号规格纯件（D93：空间锚 + 当日序号；零 wx、零 IO）
// 口径：docs/contract/V4_CONTRACT.md §3.2；docs/data/V4_DATA_MODEL.md §4.4。
// 分工：序号由云端 lib/id-generator 在 counters 事务内取（当日全局 4 位），本文件只做拼装/校验。
// 兼容：旧单 `YYYYMMDD-XXXX` 永久可读（不迁移、不改写），读路径双格式、生成侧只出新格式。
// 同步：tools/sync-cloud-shared.js 逐字节复制为 cloudfunctions/api/shared/order-no.js。
'use strict';

const ZONES = 'DXNBC';
const BUILDING_TEN_CHAR = 'X';
const LEGACY_ORDER_NO_PATTERN = /^\d{8}-\d{4}$/;
const STRUCTURED_ORDER_NO_PATTERN = /^\d{8}-[DXNBC]-[1-9X]\d{3,4}-\d{4}$/;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 楼栋：1~9 原样，10 编为 X（段宽固定，D93）
function buildingCharOf(value) {
  const no = Number(value);
  if (!Number.isInteger(no)) {
    return '';
  }
  if (no === 10) {
    return BUILDING_TEN_CHAR;
  }
  return no >= 1 && no <= 9 ? String(no) : '';
}

// 宿舍快照 → {zone,buildingChar,room}；任一不合法返回 null（调用方按 VALIDATION_FAILED 处理，不降级）
function partsOf(dorm) {
  const source = dorm && typeof dorm === 'object' ? dorm : {};
  const zone = textOf(source.zone).toUpperCase();
  const buildingChar = buildingCharOf(source.buildingNo);
  const room = textOf(source.room);
  if (ZONES.indexOf(zone) < 0 || !buildingChar || !/^\d{3,4}$/.test(room)) {
    return null;
  }
  return { zone: zone, buildingChar: buildingChar, room: room };
}

// 拼装：dayKey(YYYYMMDD) + 宿舍快照 + 当日序号(1~9999)；快照不合法返回 ''
function compose(dayKey, dorm, seq) {
  const day = textOf(dayKey);
  const parts = partsOf(dorm);
  const no = Number(seq);
  if (!/^\d{8}$/.test(day) || !parts || !Number.isInteger(no) || no < 1 || no > 9999) {
    return '';
  }
  return day + '-' + parts.zone + '-' + parts.buildingChar + parts.room + '-' + String(no).padStart(4, '0');
}

function isLegacyOrderNo(value) {
  return typeof value === 'string' && LEGACY_ORDER_NO_PATTERN.test(value);
}

function isStructuredOrderNo(value) {
  return typeof value === 'string' && STRUCTURED_ORDER_NO_PATTERN.test(value);
}

// 读路径统一闸：新旧双格式（旧单永久可读）
function isOrderNo(value) {
  return typeof value === 'string' && (isLegacyOrderNo(value) || isStructuredOrderNo(value));
}

module.exports = {
  partsOf,
  compose,
  isOrderNo
};
