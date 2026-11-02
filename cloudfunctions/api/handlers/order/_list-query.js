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

module.exports = {
  KEYWORD_MAX_CHARS,
  BINDING_ID_MAX,
  parseTimeBound,
  readKeyword,
  readOptionalBindingId
};
