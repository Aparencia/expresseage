// pkg-admin/pages/customers/parts/view-model.js · 顾客列表视图模型（纯件，零 wx）
// 口径：V4_UX_DEVELOPER §3.3/§5.2——脱敏行（服务端已脱敏）、搜索门槛、空态文案、测试标签。
'use strict';

const F = require('../../../common/format');
const copy = require('../../../common/copy');

const SEARCH_MIN = 2;

function decorateRow(item) {
  const row = item || {};
  return {
    customerNo: row.customerNo || '—',
    displayName: F.textOrDash(row.displayName),
    dormText: row.dormText || row.dorm || '—',
    bindingText: row.bindingPartnerNo ? '已绑定 ' + row.bindingPartnerNo : '未绑定',
    profileText: row.profileCompleted ? '资料完整' : '资料未完整',
    progressText: '进行中 ' + F.numOrZero(row.inProgressCount) + ' / 累计 ' + F.numOrZero(row.totalCount),
    isTest: row.isTest === true
  };
}

function decorateList(list) {
  return (list || []).map(decorateRow);
}

// 需要发起搜索：≥2 字符；清空时回到列表首页
function shouldSearch(keyword) {
  const text = String(keyword || '').trim();
  return text.length === 0 || text.length >= SEARCH_MIN;
}

function emptyTextOf(keyword) {
  const searching = String(keyword || '').trim().length > 0;
  if (searching) {
    return copy.listEmptyText({
      keyword: keyword,
      searchEmpty: '没有找到匹配的顾客，换个编号、苑+楼栋或昵称试试。'
    });
  }
  return '还没有顾客资料。';
}

module.exports = {
  SEARCH_MIN,
  decorateRow,
  decorateList,
  shouldSearch,
  emptyTextOf
};
