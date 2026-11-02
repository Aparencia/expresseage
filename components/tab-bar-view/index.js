// components/tab-bar-view/index.js · 底部栏视觉共用组件（D64：custom-tab-bar 与取件码伪 tab 页同源）
// 职责只有两件：按 tabs/selected/badges 渲染 3~4 格；点击上报 tabtap（{index, tab}）。
// 边界：本组件零 store、零跳转、零业务判据（跳转由 custom-tab-bar / 页面决定 switchTab 或 reLaunch）。
'use strict';

Component({
  properties: {
    // 数据单源：components/tab-bar-view/tabs.js（CUSTOMER_TABS / PARTNER_TABS）
    tabs: { type: Array, value: [] },
    selected: { type: Number, value: 0 },
    badges: { type: Object, value: {} }
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
