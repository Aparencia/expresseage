# `<view>` 上的 overflow-y:auto 在真机上滑不动（工具能滑 → 假绿）

现象（2026-09-19 修复批）：给候选面板加 `max-height:480rpx; overflow-y:auto`，**开发者工具里鼠标滚轮能滚**，
真机上手指怎么滑都滑不动 —— 超出的候选被**裁掉且够不着**（比不修更糟）。
根因：小程序的 `<view>` 不是滚动容器；可滚动区域必须用 `<scroll-view>`，且**竖向滚动必须给固定高度**（官方文档）。
修法：两页改用 `<scroll-view class="station-options-scroll" scroll-y style="height: {{stationPanelHeight}}">`；
　高度在 JS 里按条数算（`Math.min(count,5)*88 + 'rpx'`：少候选紧凑、多候选滚动）；`scroll-y` 写进
　`tools/check.js` 第 11 条特征行（13 条 × 2 页），任一处退回 `<view>` 即报红。
证据：官方 <https://developers.weixin.qq.com/miniprogram/dev/component/scroll-view.html>；
　踩坑 <https://juejin.cn/post/6937585134518403085>（原话"工具上滚轮 ok…真机无论怎么滑都滑不动"）。
下次定位：**"工具里能滑/能点/能滚，真机不行" → 先怀疑容器类型**（`view`/`scroll-view`/`swiper`），别去调 `max-height`。
　同族：模拟器冒充真机 · 工具静默改配置 · 假 exit 码 · 空集上的全绿。
来源：expresseage_college · 2026-09-19 · 修复批（发现方式：**麻烦人上真机之前先用官方文档核对平台能力**）
