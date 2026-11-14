// pages/partner/workbench/parts/panel-host.js · 批 37 修复：页面级浮层与自定义 tabBar 的互斥
// 问题：工作台是 tab 页，自定义 tabBar（z-index 500）会盖在页面 fixed 浮层之上，导致送达面板的
//      「取消/保存」被 tabBar 挡住（用户截图）。修复：打开浮层时隐藏 tabBar、关闭时恢复。
// 单一入口：所有 panel 变更都走 setPanel()，避免逐个 setData 漏掉显隐。
'use strict';

module.exports = {
  setPanel(panel) {
    const next = panel || null;
    this.setData({ panel: next });
    this.setTabBarHidden(!!next);
  },

  // 自定义 tabBar 的显隐由 custom-tab-bar 的 hidden 标志控制（组件内 wx:if）
  setTabBarHidden(hidden) {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && typeof tabBar.setData === 'function') {
      tabBar.setData({ hidden: hidden === true });
    }
  }
};
