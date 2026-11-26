// handlers/order/_list-query.js · order.listPartner 系列视图的入参读取（keyword / 时间窗 / bindingId）
// 从 listPartner.js 拆出（门禁 #18 单文件 ≤500 行）；口径不变：非法/超长一律拒绝，不静默降级（否则筛选口径被悄悄改掉）。
'use strict';

const time = require('../../lib/time');
const { errors } = require('../../lib/errors');

const KEYWORD_MAX_CHARS = 40;
const BINDING_ID_MAX = 64;

function parseTimeBound(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  return time.toMs(value);
}

// 搜索词：空=不过滤；超长/非串拒绝（静默忽略会让「搜了但没筛」变成全量返回）。
function readKeyword(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('keyword', '搜索词不正确，请重新输入');
  }
  const text = value.trim();
  if (text.length > KEYWORD_MAX_CHARS) {
    throw errors.validation('keyword', '搜索词过长，请缩短后重试');
  }
  return text;
}

// 绑定顾客筛选参数（view=customer 必传）：非串/超长拒绝；空串=未给（由调用处按视图裁决）。
function readOptionalBindingId(input) {
  const value = input && typeof input === 'object' ? input.bindingId : undefined;
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw errors.validation('bindingId', '绑定顾客参数不正确，请刷新页面后重试');
  }
  const text = value.trim();
  if (text === '') {
    return '';
  }
  if (text.length > BINDING_ID_MAX) {
    throw errors.validation('bindingId', '绑定顾客参数不正确，请刷新页面后重试');
  }
  return text;
}

// 游标下推（2026-11-26 审查修复）：把「排序锚之后」拆成两段可命中索引的查询条件，让 DB 过滤而不是每页
// 都在「最新一窗」里内存过滤——否则历史单超过扫描窗后 nextCursor=null，旧单在列表里不可达。
//   ① sortField < cursor.sortValue（严格更早）；② 同刻 orderNo < cursor.orderNo（按单号降序续读）。
// 无游标返回 []（首屏仍是「最新一窗」语义不变）。
function cursorWheresOf(ctx, sortField, cursor) {
  if (!cursor) {
    return [];
  }
  const at = new Date(cursor.sortValue);
  const wheres = [{ [sortField]: ctx.dao.command('lt', at) }];
  if (cursor.orderNo) {
    wheres.push({ [sortField]: at, orderNo: ctx.dao.command('lt', cursor.orderNo) });
  }
  return wheres;
}

module.exports = {
  KEYWORD_MAX_CHARS,
  BINDING_ID_MAX,
  parseTimeBound,
  readKeyword,
  readOptionalBindingId,
  cursorWheresOf
};
