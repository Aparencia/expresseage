// pkg-customer/parts/format.js · 时间/倒计时展示（纯函数，零 wx）
// 单源 = pages/customer/parts/format.js（主包）；本文件只补分包含专属的 clock()（HH:mm:ss）。
'use strict';

const base = require('../../pages/customer/parts/format');

/** 时刻（HH:mm:ss）：详情「最近更新 HH:mm:ss」用；解析失败返回空串 */
function clock(value) {
  const date = base.toDate(value);
  if (!date) return '';
  return base.pad(date.getHours()) + ':' + base.pad(date.getMinutes()) + ':' + base.pad(date.getSeconds());
}

module.exports = Object.assign({}, base, { clock });
