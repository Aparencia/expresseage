# RCA · 三条真机 UI 缺陷（卡 30 根因分析）

- 任务：`20260925_ui_defects`｜档位：S（只分析，不改码）｜锚点（自取）：`b8d1e418f1fda577b1749a6c1bb1b709e813fae0`
- 症状来源：用户真机原话 + 追问确认（①"点整行想进详情页没反应"｜②"预填格子互相叠"＋原话"在继续快递码录入时"｜③"左滑删除的 ui 与档案 ui 不匹配，视觉上超出了"＋追问答"上下ui"）
- ⛔ 本文**只给根因与修法方向，不含任何代码改动**；每条候选都带证据、复现步骤、判别证据与修法方向。

---

## ① 档案页"点整行无响应"——**根因确认：详情页没登记进 `app.json`**

**先报证伪**：我原始的嫌疑是"方法混合件 `Page(Object.assign({...}, rowActions))` 合成后某个 handler 名对不上"。**已实测证伪**——stub `Page` 真跑 `pages/archive-list/index.js`：

- `MIXIN_EXPORT_KEYS` = 14 个方法名，`MIXIN_IS_METHOD_BAG true`（标准方法袋，不是嵌套对象）
- `COMPOSED_KEY_COUNT 48`；wxml 里 **21 个** `bind*/catch*` 绑定名与合成实例取差集 ⇒ **`MISSING_COUNT 0 MISSING []`**
- ⇒ **① 的根因不在 handler 名上**（这条必须写出来，否则下一个人会去改混合件）

| 项 | 内容 |
| :--- | :--- |
| **证据** | `app.json` 全文：`pages` 只有 `pages/pickup-list/index`、`pages/archive-list/index`、`pages/recognize/index`；`tabBar` 与 `subPackages` 里也没有详情页 ⇒ **`pages/customer-detail/index` 在任何地方都没登记**。而 `pages/archive-list/row-actions.js:74`：`wx.navigateTo({ url: '/pages/customer-detail/index?customerId=' + encodeURIComponent(id) });`。四件套文件确实在（`Test-Path` 全 True）⇒ **文件在、登记不在**。另：`git show d30bb82 --name-only` 里**没有 `app.json`** ⇒ 详情页批**根本没改过它**，而回执原文写的是"已登记 `app.json`" ⇒ **自述与 diff 不符** |
| **机制** | 小程序只能跳到 `app.json`（或分包）里声明过的页面；跳未声明页 ⇒ `navigateTo:fail page "..." is not found`，**只在 console 报错、界面上毫无反馈** ⇒ 用户看到的就是"点了没反应"。这也解释了为什么**每一行**都点不动（不是个别行） |
| **最小复现** | 真机档案页点任意一行 → 无反应；开发者工具 console 里应有 `navigateTo:fail page "pages/customer-detail/index" is not found` |
| **需要什么证据确认/排除** | ① 开发者工具 console 的那行 `navigateTo:fail ...`（一行即可**坐实**）；② 或一张"点行前后完全同屏"的截图（排除"跳了但白屏"这一支：若跳转成功而详情页读不到数据，会显示"找不到这位客户"文案，与"无反应"不同） |
| **修法方向（不写码）** | `app.json.pages` 里补一行 `pages/customer-detail/index`。**另需补判据**：`tools/check.js:88` 现有判据是**单向**的（"`app.json` 声明的页面三件套必须齐"），**缺反向那条**——"`pages/` 下每个页面目录必须在 `app.json`（或分包）里登记"。这正是"可机器拦而没拦"的一类（TD-014 同族）；新增判据按项目规矩**须人批** |
| **为什么门禁全绿** | `check.js` 41 项、`selftest` 486 条都不查"目录 → 登记"这个方向；详情页批的装配核销只查了 wxml handler 与导出 `typeof`，**没有查登记** |

---

## ② 录入页"预填格子互相叠"——**定性修正（真机截图后）：原生 `<input>` 的默认最小高被 `box-sizing:border-box` + 上下 padding 吃掉 ⇒ 值被垂直裁切**

> ⚠️ **本节于 2026-09-25 收到用户真机截图后修正**（截图：`C:\Users\Admin…\09da1f9e…`，1206×1437）。
> **旧结论"软键盘弹出时布局不缩"降级为「未证实 / 被这张截图弱化」**，依据：
> ① 截图里**底部提示段落与常驻操作栏之间有明确空隙、没有任何互相压**；
> ② 看得见的缺陷是**输入值被垂直裁掉一半**（标签、灰底 picker、提示段落全部完好）；
> ③ 该缺陷**不需要键盘就能复现**（截图里没有键盘态证据，且它是盒高问题、与视口无关）。
> 旧假设**未被排除**（键盘弹起时的同屏图仍未取，可能另有叠加），只是**它不再解释这张图上的症状**。
> 新根因与修法见 `FIX.md §7`；下面旧内容保留备查，**读它时按"未证实"对待**。

**先报证伪**：嫌疑"一图多码时三格横向挤压重叠"**不成立**——`pages/recognize/index.wxss:212/218/224` 三格分别有 `.draft-code{flex:2;min-width:0}`、`.draft-picker{flex:2;min-width:0}`、`.draft-locker{flex:1;min-width:0}`，`index.wxss:207 .draft-fields{display:flex;align-items:center}` ⇒ 有 `min-width:0` 兜着，横向重叠的机制不存在。

| 项 | 内容 |
| :--- | :--- |
| **证据** | `.page{display:flex;flex-direction:column;height:100vh}`（`index.wxss:9-15`）｜中段是**实测固定 px 高**：`index.wxml:45` `<scroll-view class="mid" scroll-y style="height: {{midHeight}}">`，写值处在 `index.js:128`，算式在 `form-parts.js:116-123` `computeMidHeight(total - top - actions)`，总高取 `windowInnerHeight` = `wx.getWindowInfo().windowHeight`（`form-parts.js:92-104`）｜底部操作栏常驻：`index.wxml:131-134`。**全仓没有任何键盘对策**：探针扫 `recognize/{index.js,index.wxml,index.wxss,form-parts.js}` 里 `keyboard / adjust-position / cursor-spacing / confirm-type / hold-keyboard` ⇒ **0 命中**（唯一的视口命中就是 `index.wxss:12` 的 `100vh` 与上面两个取高函数） |
| **机制** | `windowHeight` 是**窗口高度，不含软键盘**。键盘弹出后实际可视高度少掉约 40%，而 `.page` 仍是 `100vh`、`.mid` 仍是**键盘前**量出的固定 px ⇒ 布局不缩；平台为露出被聚焦的 `<input>` 会把整页上推（`adjust-position` 默认开），于是"预填格子"与"底部保存栏／相邻格子"在同一屏上**互相压**。⇒ 只在**输入时**出现，与你原话"**在继续快递码录入时**"吻合；键盘收起后应恢复 |
| **最小复现** | 真机进"录快件"→ 点任意预填格子（站点/取件码/柜号/尾号）唤起键盘 → 观察格子与底栏/相邻格子是否叠；再收起键盘看是否恢复 |
| **需要什么证据确认/排除** | **两张同屏对照**：㈠键盘弹起、输入框聚焦时；㈡键盘收起后。若㈡正常、㈠叠 ⇒ **坐实本条**。若㈡**也叠** ⇒ 转下面那条次候选。另请顺便说机型与 iOS/Android（键盘高度与上推行为两端不同） |
| **次候选（需上面两张图区分）** | `measureMid` 失准：实测值算错/没重测（如 `preselectNote` 变长后某次 setData 没走 `setDataMeasured` 出口，`index.js:136-144` 那三个出口的注释正是为它写的）⇒ 中段比真实槽位高/矮，内容溢出到下方与底栏叠。证据方向：`index.js:100/105/112/138/176` 五处调用点与 `.top` 的改写是否**都**走了 `setDataMeasured` |
| **修法方向（不写码）** | 键盘是**新变量**，别一次改三处：㈠给中段加键盘对策（监听键盘高度变化后重测中段高，或键盘期把底部操作栏收起/改为随内容走）；㈡或把 `.page` 的 `height:100vh` 改成"最小高度 + 允许页面整体滚动"；㈢`<input>` 补 `cursor-spacing`。**先按上面两张图定性，再选一条** |

---

## ③ 左滑删除 UI"上下超出"——**根因确认：行间距在包裹层里，红条比卡片高 20rpx**

| 项 | 内容 |
| :--- | :--- |
| **证据（纯几何）** | `.card{...margin-bottom:20rpx}`（`index.wxss:11`）｜包裹层 `.row-wrap{position:relative;overflow:hidden;border-radius:16rpx}`（`index.wxss:287`）｜红条 `.row-del{position:absolute;top:0;right:0;bottom:0;width:160rpx;...}`（`index.wxss:290-291`）；卡片是包裹层的**正常流子节点**且 `position:relative;z-index:1`（`:288`），`wxml:14-20` 的结构是 `.row-wrap > (.row-del, .card)` |
| **机制** | 卡片那 20rpx `margin-bottom` **落在包裹层内部**（`.row-wrap` 因 `overflow:hidden` 形成 BFC，外边距不外泄）⇒ **包裹层高 = 卡片高 + 20rpx**；而红条用 `top:0;bottom:0` 撑满包裹层 ⇒ 红条比卡片**高 20rpx**。卡片虽在上面（z-index 1）且不透明，但只能盖住**卡片自己那块**；卡片下沿之外那 20rpx 的红条**没有任何东西遮它** ⇒ **不左滑也常驻露一条淡红窄条**（`.row-del` 的 `background:#fdecec`，`right:0`、宽 160rpx）。`overflow:hidden` 只裁到包裹层边界，**裁不掉**这 20rpx。⇒ 与你的"上下 ui…超出了"完全对应 |
| **同一处几何的第二种表现** | 左滑开启时 `.row-open .card{transform:translateX(-160rpx)}`（`:289`）把卡片整体左移；卡片四角是 `border-radius:16rpx`（`:9`），滑过后其右侧圆角压在红条上 ⇒ 红条左缘出现"缺角/不齐"的观感（与"不匹配"一致）。修好上面那条后应一并消失（红条与卡片等高、圆角同源） |
| **最小复现** | 真机档案页**不要左滑**，看每行卡片右下角是否有一条**淡红窄条**露出（截图放大即可看清）；左滑一行再看红条是否与卡片上下沿齐平 |
| **需要什么证据确认/排除** | 一张**未左滑**的档案列表截图（能看清行与行之间的缝）。若缝里右侧有淡红 ⇒ **坐实**；若没有 ⇒ 说明真机把 `margin-bottom` 折叠掉了（则该现象只在你看到的那种机型/时机出现，需左滑状态的截图） |
| **修法方向（不写码）** | 把行间距**从卡片挪到包裹层**：`.row-wrap` 拿 `margin-bottom:20rpx`，`.row-wrap .card` 的 `margin-bottom:0` ⇒ 包裹层高 = 卡片高，红条与卡片同高同圆角。（不建议改红条为固定高度：那会把"卡片多高"这件事实复制成两处，迟早分叉） |

---

## 诚实边界（只靠静态分析定不了的部分）

1. **三条都没有真机截图**：① 是"登记缺失"这种**确定性**根因（console 一行即可坐实，且不修就一定点不动）；② 是**概率最高**的机制，但"键盘不缩"与"实测高失准"要靠**两张对照图**分开；③ 的几何推导很确定，仍需一张"未左滑"的图确认那条淡红窄条在真机上确实可见（不同机型/基础库对 margin 与 BFC 的处理理论一致，但没看到就不算验过）。
2. **② 的次候选未排除**：`.top` 的每次改写是否都走了 `setDataMeasured` 三出口，我**没有逐处追**（只读了出口定义与五个调用点），留待修法选定前再查。
3. **本报告不含任何真机读数**：全部来自源码/配置/几何与一次 stub 复现（handler 差集）。**没有一条是"实测通过/失败"**。
4. **未检查**：`pages/customer-detail/**` 自身的取数失败路径、左滑在长列表下的性能、以及 WXSS 在真机的实际像素（`rpx` 换算与安全区）——这些都要真机。

## 给 31 修复卡的三条口径建议

1. **① 的修复要连判据一起补**（否则下一个人还会漏登记）：反向登记对帐属**新判据，须人批**——请把它和修复一起提给人。
2. **② 先定性再动手**：键盘对策与本条次候选的修法**完全不同**，拿不到那两张对照图就先别改。
3. **③ 只动一处**：间距搬家（`.row-wrap` 拿外边距）是唯一改动点，别顺手改红条高度或圆角。
4. **三条全在页面层**（`selftest` 不 require 页面，TD-016 已点名两次）：① 与 ③ 有"可机器化的结构不变量"（登记对帐、红条高 == 卡片高），② 只能靠真机——这条边界要写进 31 卡。
