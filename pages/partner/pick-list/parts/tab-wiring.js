// pages/partner/pick-list/parts/tab-wiring.js · 取件清单「伪 tab」底栏接线（2026-11-08）
// 口径：兼职 4 格（工作台 0 / 取件清单 1 / 客户 2 / 我的 3）与顾客端「取件码」同款：
//   本页不在 app.json tabBar.list（list 仍 5 项），页面内自绘 components/tab-bar-view，
//   其余三格是真 tab → wx.switchTab；本页自身忽略。角标只读 store.badges，不自算。
// 从页面 index.js 拆出以守门禁 #18（单文件 ≤500 行）。
'use strict';

const store = require('../../../../store/index');
const tabsData = require('../../../../components/tab-bar-view/tabs');

const TAB_INDEX = 1;

module.exports = {
  // 键名不能叫 data：页面用 Object.assign 合并本件时会把整份页面 data 覆盖掉（2026-11-08 审查发现）
  TAB_DATA: {
    tabs: tabsData.PARTNER_TABS,
    tabSelected: TAB_INDEX,
    badges: {}
  },

  // 伪 tab 没有 custom-tab-bar 实例：onShow 自行同步选中格与角标
  syncTabState() {
    this.setData({ tabSelected: TAB_INDEX, badges: store.get('badges') || {} });
  },

  onTabTap(event) {
    const detail = (event && event.detail) || {};
    const tab = detail.tab || (this.data.tabs || [])[detail.index] || null;
    if (!tab || !tab.pagePath || tab.pagePath === 'pages/partner/pick-list/index') {
      return;
    }
    wx.switchTab({ url: '/' + tab.pagePath });
  }
};
