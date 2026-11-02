// pages/partner/customers/parts/filter-model.js · 客户页筛选器纯件（D67：零 wx、零请求、零全局状态）
// 口径：CONTRACT §13 D67（一期维度=全部/资料未完善/按苑/按楼栋/有备注；chips 不带计数、无新聚合查询）、
//       DATA_MODEL §7.4 partner.listBindings（只增 zone/buildingNo/profileIncomplete/hasNote）、
//       UX_PARTNER §3.5（横滚 chips + 苑/楼栋二级选择 + 筛选空态与真空态文案分离）。
// 与服务端的分工：选中态/查询参数/文案在本纯件决定；真正的过滤在服务端（客户端不本地筛、不二次排序）。
// 「有进行中订单」一期不做（D67 明确只保留五个维度），本文件不出现该维度与相关提示。
'use strict';

const zones = require('../../../../shared/zones');
const customerView = require('../../../../utils/customer-view');

const MODE_ALL = 'all';
const MODE_INCOMPLETE = 'incomplete';
const MODE_ZONE = 'zone';
const MODE_BUILDING = 'building';
const MODE_NOTE = 'note';

// 一行横滚 chips（顺序=设计稿：全部 / 资料未完善 / 按苑 / 按楼栋 / 有备注；均不带计数）
const CHIPS = [
  { key: MODE_ALL, label: '全部' },
  { key: MODE_INCOMPLETE, label: '资料未完善' },
  { key: MODE_ZONE, label: '按苑' },
  { key: MODE_BUILDING, label: '按楼栋' },
  { key: MODE_NOTE, label: '有备注' }
];

// 五苑固定顺序 D→X→N→B→C（D8）；楼栋 1~10（CONTRACT §3 术语表）。
const ZONE_OPTIONS = zones.ZONES.map((value) => ({ value, label: zones.zoneLabel(value) }));
const BUILDING_OPTIONS = [];
for (let no = zones.BUILDING_MIN; no <= zones.BUILDING_MAX; no += 1) {
  BUILDING_OPTIONS.push({ value: no, label: no + '栋' });
}

const EMPTY_TEXT = '没有符合筛选条件的顾客';
const EMPTY_ACTION = '清除筛选';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createFilters() {
  return { mode: MODE_ALL, zone: '', buildingNo: 0 };
}

function normalizeMode(value) {
  const mode = textOf(value);
  return CHIPS.some((chip) => chip.key === mode) ? mode : MODE_ALL;
}

// 纯件入参归一：页面 data 可能从旧版本/手改路径带回脏值——统一按「不筛」处理（不抛错、不清空列表）。
function normalizeFilters(filters) {
  const source = filters && typeof filters === 'object' ? filters : {};
  const mode = normalizeMode(source.mode);
  const zone = mode === MODE_ZONE || mode === MODE_BUILDING ? zones.normalizeZone(source.zone) : '';
  const buildingNo = mode === MODE_BUILDING && zones.isBuildingNo(Number(source.buildingNo))
    ? Number(source.buildingNo)
    : 0;
  return { mode, zone, buildingNo };
}

function sameFilters(left, right) {
  const a = normalizeFilters(left);
  const b = normalizeFilters(right);
  return a.mode === b.mode && a.zone === b.zone && a.buildingNo === b.buildingNo;
}

// 选中态 → partner.listBindings 入参（只发生效的键；服务端再按 AND 组合/静默归一脏值）。
function queryOf(filters) {
  const f = normalizeFilters(filters);
  const query = {};
  if (f.mode === MODE_INCOMPLETE) {
    query.profileIncomplete = true;
  }
  if (f.mode === MODE_NOTE) {
    query.hasNote = true;
  }
  if (f.mode === MODE_ZONE && f.zone) {
    query.zone = f.zone;
  }
  if (f.mode === MODE_BUILDING) {
    if (f.zone) {
      query.zone = f.zone;
    }
    if (f.buildingNo > 0) {
      query.buildingNo = f.buildingNo;
    }
  }
  return query;
}

// 是否已有真实生效的服务端筛选（「按苑」未选苑/「按楼栋」未选栋时不算）。
function hasActive(filters) {
  return Object.keys(queryOf(filters)).length > 0;
}

// 再点已选 chip / 已选苑/栋 = 取消（选中态可清除；全部=清空所有维度）。
function applyChip(filters, key) {
  const f = normalizeFilters(filters);
  const mode = normalizeMode(key);
  if (mode === MODE_ALL || mode === f.mode) {
    return createFilters();
  }
  if (mode === MODE_INCOMPLETE || mode === MODE_NOTE) {
    return { mode, zone: '', buildingNo: 0 };
  }
  // 按苑/按楼栋切换时保留已选苑（按楼栋可只按栋、跨苑看同一栋号），楼栋选择在切换时清空。
  return { mode, zone: f.zone, buildingNo: 0 };
}

function selectZone(filters, value) {
  const f = normalizeFilters(filters);
  const zone = zones.normalizeZone(value);
  if (f.mode !== MODE_ZONE && f.mode !== MODE_BUILDING) {
    return f;
  }
  if (!zone) {
    return f;
  }
  if (f.zone === zone) {
    // 按苑：再点已选苑 → 取消回全部；按楼栋：取消苑但保留楼栋筛选（跨苑看某栋号）。
    return f.mode === MODE_ZONE ? createFilters() : { mode: MODE_BUILDING, zone: '', buildingNo: f.buildingNo };
  }
  return { mode: f.mode, zone, buildingNo: f.mode === MODE_BUILDING ? f.buildingNo : 0 };
}

function selectBuilding(filters, value) {
  const f = normalizeFilters(filters);
  if (f.mode !== MODE_BUILDING) {
    return f;
  }
  const buildingNo = zones.isBuildingNo(Number(value)) ? Number(value) : 0;
  if (!buildingNo) {
    return f;
  }
  // 再点已选楼栋 → 取消楼栋筛选（仍停留「按楼栋」态，可重选或点「全部」清空）。
  return { mode: MODE_BUILDING, zone: f.zone, buildingNo: f.buildingNo === buildingNo ? 0 : buildingNo };
}

// 筛选说明行（页面在 chips 下方展示；空串=无说明不占位）。未选完的中间态给引导语，不谎称已筛。
function describeOf(filters) {
  const f = normalizeFilters(filters);
  if (f.mode === MODE_INCOMPLETE) {
    return '只看资料未完善的顾客';
  }
  if (f.mode === MODE_NOTE) {
    return '只看有备注的顾客';
  }
  if (f.mode === MODE_ZONE) {
    return f.zone ? '只看' + zones.zoneLabel(f.zone) : '请选择苑';
  }
  if (f.mode === MODE_BUILDING) {
    const zoneText = f.zone ? zones.zoneLabel(f.zone) : '';
    if (f.buildingNo && zoneText) {
      return '只看' + zoneText + ' ' + f.buildingNo + ' 栋';
    }
    if (f.buildingNo) {
      return '只看各苑 ' + f.buildingNo + ' 栋';
    }
    return zoneText ? '只看' + zoneText + '，请选择楼栋' : '请选择苑或楼栋';
  }
  return '';
}

// 页面数据快照：chips/二级选择/说明行/空态文案一次算出（list-model.buildSnapshot 直接并入 setData）。
function uiOf(filters) {
  const f = normalizeFilters(filters);
  const showZonePicker = f.mode === MODE_ZONE || f.mode === MODE_BUILDING;
  const showBuildingPicker = f.mode === MODE_BUILDING;
  return {
    filterMode: f.mode,
    filterZone: f.zone,
    filterBuildingNo: f.buildingNo,
    filterActive: hasActive(f),
    filterDesc: describeOf(f),
    filterChips: CHIPS.map((chip) => ({ key: chip.key, label: chip.label, active: chip.key === f.mode })),
    showZonePicker,
    showBuildingPicker,
    zoneOptions: showZonePicker
      ? ZONE_OPTIONS.map((item) => ({ value: item.value, label: item.label, active: item.value === f.zone }))
      : [],
    buildingOptions: showBuildingPicker
      ? BUILDING_OPTIONS.map((item) => ({ value: item.value, label: item.label, active: item.value === f.buildingNo }))
      : []
  };
}

// 空态文案分离（UX_PARTNER §3.5）：筛选无结果 / 搜索无结果 / 真没绑定三套文案，动作各不相同。
// 真空态与搜索空态文案沿用 utils/customer-view 单源（不在此重复实现），只有「筛选无结果」是新文案。
function emptyStateOf(filters, keyword) {
  if (hasActive(filters)) {
    return { text: EMPTY_TEXT, actionText: EMPTY_ACTION, actionKind: 'clearFilter' };
  }
  const word = textOf(keyword);
  return {
    text: customerView.emptyTextOf(keyword),
    actionText: word ? '清空搜索' : '分享绑定卡片',
    actionKind: word ? 'clearSearch' : 'share'
  };
}

module.exports = {
  MODE_ALL,
  MODE_INCOMPLETE,
  MODE_ZONE,
  MODE_BUILDING,
  MODE_NOTE,
  createFilters,
  sameFilters,
  queryOf,
  hasActive,
  applyChip,
  selectZone,
  selectBuilding,
  describeOf,
  uiOf,
  emptyStateOf
};
