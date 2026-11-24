// utils/order-sort.js · D100 兼职订单组内排序单源（工作台站点组与取件清单站点组共用）
// 口径：CONTRACT §5.2（D79/D100）——四档（需查明→快递柜→分段码→其他）→ 取件码自然序 → 订单号稳定序。
// 边界：纯函数（零 wx）；空码恒排在有码之后；不判订单状态（tier 由调用方用件字段算好传入）。
'use strict';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 取件码切片：数字段按数值、文本段按字典序（8-2-999 < 8-2-3021 < 8-10-1）
function codeTokensOf(code) {
  const tokens = [];
  const re = /(\d+|\D+)/g;
  const source = textOf(code);
  let match = re.exec(source);
  while (match) {
    const raw = match[1];
    tokens.push(/^\d+$/.test(raw) ? { num: Number(raw), text: raw } : { num: null, text: raw });
    match = re.exec(source);
  }
  return tokens;
}

function compareCodes(left, right) {
  const a = textOf(left);
  const b = textOf(right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const leftTokens = codeTokensOf(a);
  const rightTokens = codeTokensOf(b);
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const x = leftTokens[index];
    const y = rightTokens[index];
    if (!x) return -1;
    if (!y) return 1;
    if (x.num !== null && y.num !== null) {
      if (x.num !== y.num) return x.num < y.num ? -1 : 1;
    } else if (x.text !== y.text) {
      return x.text < y.text ? -1 : 1;
    }
  }
  return a < b ? -1 : (a > b ? 1 : 0);
}

// 行序：routeTier（1 需查明 → 2 快递柜 → 3 分段码 → 4 其他）→ sortCode → orderNo（防渲染抖动）
function compareRoute(left, right) {
  const a = left || {};
  const b = right || {};
  const tierA = typeof a.routeTier === 'number' ? a.routeTier : 9;
  const tierB = typeof b.routeTier === 'number' ? b.routeTier : 9;
  if (tierA !== tierB) {
    return tierA - tierB;
  }
  const byCode = compareCodes(a.sortCode, b.sortCode);
  if (byCode !== 0) {
    return byCode;
  }
  const noA = textOf(a.orderNo);
  const noB = textOf(b.orderNo);
  if (noA === noB) return 0;
  return noA < noB ? -1 : 1;
}

function sortRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort(compareRoute);
}

module.exports = { compareCodes, compareRoute, sortRows };
