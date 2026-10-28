// shared/gender.js · 顾客性别纯件（枚举/标签由 shared/enums 单源；东苑楼栋推断 + 手动修改口径）
// 口径：用户 2026-10-27 裁决（task-1）——东苑(D) 楼栋 1/2/5/6/7/8 = 男、3/4/9/10 = 女；
//       其他苑（X/N/B/C）或非法苑/楼栋一律「未知」；未知/未填不阻塞资料保存（profileCompleted 判据仍=昵称+宿舍）。
// 契约落点：docs/V4_DATA_MODEL.md §2.2（customers.gender / genderManual）、docs/V4_CONTRACT.md §4.2。
// 纪律：零 wx、纯函数、零存储；性别枚举字面量只出现在 shared/enums.js（本文件只做引用与派生）。
'use strict';

const enums = require('./enums');
const zones = require('./zones');

const { GENDER, GENDER_LIST, GENDER_LABELS } = enums;

// 东苑 = 苑固定顺序（zones.ZONES：D→X→N→B→C）的第一个；不重复写苑字面量。
const EAST_ZONE = zones.ZONES[0];
// 东苑楼栋→性别映射（用户口径；10 个楼栋全覆盖且互斥）。
const EAST_MALE_BUILDINGS = [1, 2, 5, 6, 7, 8];
const EAST_FEMALE_BUILDINGS = [3, 4, 9, 10];

// 由「苑 + 楼栋」直接推断：仅东苑有映射；其他苑/非法输入 = 未知（不猜、不抛错）。
function deriveGender(zone, buildingNo) {
  if (zones.normalizeZone(zone) !== EAST_ZONE || !zones.isBuildingNo(buildingNo)) {
    return GENDER.UNKNOWN;
  }
  if (EAST_MALE_BUILDINGS.indexOf(buildingNo) !== -1) {
    return GENDER.MALE;
  }
  if (EAST_FEMALE_BUILDINGS.indexOf(buildingNo) !== -1) {
    return GENDER.FEMALE;
  }
  return GENDER.UNKNOWN;
}

// 服务端入参校验：只认 GENDER_LIST 里的规范字面量（不做大小写猜测，防止脏值落库）。
function isGender(value) {
  return GENDER_LIST.indexOf(value) !== -1;
}

// 读路径容错：非法/缺失一律归一为「未知」（未知不阻塞任何流程）。
function normalizeGender(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return GENDER_LIST.indexOf(text) !== -1 ? text : GENDER.UNKNOWN;
}

// 展示文案：非法/缺失按「未知」展示（性别未知也要如实显示，不隐藏该行）。
function genderLabel(value) {
  return GENDER_LABELS[normalizeGender(value)] || GENDER_LABELS[GENDER.UNKNOWN];
}

module.exports = {
  GENDER,
  GENDER_LIST,
  GENDER_LABELS,
  deriveGender,
  isGender,
  normalizeGender,
  genderLabel
};
