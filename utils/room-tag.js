// utils/room-tag.js · roomTag 零件（Excel 列名式大写字母；零 wx、零生成随机）
// 契约：docs/V4_CONTRACT.md v0.9 §3（roomTag 恒大写 A…Z/AA…，展示 D4-522A）；
//       docs/ENGINEERING §5.3b（本文件导出名单与 selftest 判据）。
// 分工：分配序号只在云端 lib/tag-allocator.js（事务 + counters）；本文件只做序号↔标签换算、
//       格式拼装、校验与排序。排序禁止字符串比较（'AA' 会排到 'Z' 前面），一律用 tagRank。
// 同步：tools/sync-cloud-shared.js 会逐字节复制为 cloudfunctions/*/shared/room-tag.js。
'use strict';

const LETTER_A = 65; // 'A'
const BASE = 26;

function isPositiveSeq(seq) {
  return typeof seq === 'number' && seq >= 1 && Math.floor(seq) === seq;
}

// 序号 → 标签：1→A、26→Z、27→AA、52→AZ、53→BA …（无上限，超出整数范围返回 ''）
function toTag(seq) {
  if (!isPositiveSeq(seq)) {
    return '';
  }
  let remain = seq;
  let out = '';
  while (remain > 0) {
    const offset = (remain - 1) % BASE;
    out = String.fromCharCode(LETTER_A + offset) + out;
    remain = Math.floor((remain - 1) / BASE);
  }
  return out;
}

// 标签 → 序号（非法返回 0；与 toTag 互逆）
function tagRank(tag) {
  if (typeof tag !== 'string' || !/^[A-Z]+$/.test(tag)) {
    return 0;
  }
  let rank = 0;
  for (let i = 0; i < tag.length; i += 1) {
    rank = rank * BASE + (tag.charCodeAt(i) - LETTER_A + 1);
  }
  return rank;
}

// 只允许大写字母 A…Z 组成的标签（小写/空串/带数字一律非法）
function isValidTag(tag) {
  return typeof tag === 'string' && /^[A-Z]+$/.test(tag);
}

// 展示：dormKey + tag（D4-522 + A = D4-522A）；标签非法时只回 dormKey
function formatDormTag(dormKey, tag) {
  if (typeof dormKey !== 'string' || dormKey === '') {
    return '';
  }
  if (!isValidTag(tag)) {
    return dormKey;
  }
  return dormKey + tag;
}

// 排序键：入参可传 {dormKey, tag} 对象或 'D4-522A' 字符串
function sortPartsOf(value) {
  if (value && typeof value === 'object') {
    return { dormKey: String(value.dormKey || ''), tag: String(value.tag || '') };
  }
  if (typeof value === 'string') {
    const match = value.match(/^([A-Z0-9-]*?)([A-Z]+)$/);
    if (match) {
      return { dormKey: match[1], tag: match[2] };
    }
    return { dormKey: value, tag: '' };
  }
  return { dormKey: '', tag: '' };
}

// 比较：先 dormKey（字典序兜底），同 dormKey 再按绑定先后（tagRank 升序）
function compareByDormTag(a, b) {
  const left = sortPartsOf(a);
  const right = sortPartsOf(b);
  if (left.dormKey !== right.dormKey) {
    return left.dormKey < right.dormKey ? -1 : 1;
  }
  const leftRank = tagRank(left.tag);
  const rightRank = tagRank(right.tag);
  if (leftRank === rightRank) {
    return 0;
  }
  return leftRank < rightRank ? -1 : 1;
}

module.exports = {
  toTag,
  tagRank,
  formatDormTag,
  isValidTag,
  compareByDormTag
};
