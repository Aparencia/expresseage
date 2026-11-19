// components/tab-bar-view/index.js · 底部栏视觉共用组件（D64：custom-tab-bar 与取件码伪 tab 页同源）
// 职责三件：按 tabs/selected/badges 渲染 3~4 格；按 dark 属性切换图标；点击上报 tabtap（{index, tab}）。
// 边界：本组件零 store、零平台调用（深浅色由调用方探测后传入）、零跳转判据。
'use strict';

const DARK_SUFFIX = '-dark.png';

// 浅色图标 → 深色变体（同目录同尺寸，仅改 RGB、alpha 不变；静态资源由 assets/tabbar/*-dark.png 提供）
function darkIconOf(icon) {
  if (typeof icon !== 'string' || icon.indexOf(DARK_SUFFIX) !== -1) {
    return icon;
  }
  return icon.replace(/\.png$/, DARK_SUFFIX);
}

function viewTabsOf(tabs, dark) {
  const list = Array.isArray(tabs) ? tabs : [];
  if (!dark) {
    return list;
  }
  return list.map(function darken(tab) {
    return Object.assign({}, tab, {
      icon: darkIconOf(tab.icon),
      activeIcon: darkIconOf(tab.activeIcon)
    });
  });
}

Component({
  properties: {
    // 数据单源：components/tab-bar-view/tabs.js（CUSTOMER_TABS / PARTNER_TABS）
    tabs: { type: Array, value: [] },
    selected: { type: Number, value: 0 },
    badges: { type: Object, value: {} },
    // 系统深浅色（调用方探测：custom-tab-bar / 伪 tab 页）；浅色模式零额外拷贝
    dark: { type: Boolean, value: false }
  },

  data: {
    // 渲染用副本：dark=true 时换成 *-dark.png
    viewTabs: []
  },

  observers: {
    'tabs, dark': function refresh(tabs, dark) {
      this.setData({ viewTabs: viewTabsOf(tabs, dark) });
    }
  },

  methods: {
    onTap(event) {
      const index = Number((event && event.currentTarget && event.currentTarget.dataset
        && event.currentTarget.dataset.index) || 0);
      const tab = (this.data.tabs || [])[index] || null;
      if (!tab) {
        return;
      }
      this.triggerEvent('tabtap', { index: index, tab: tab });
    }
  }
});
