# FIX · 三条真机 UI 缺陷（卡 31 修复；作业单 = 同目录 `RCA.md`）

- 任务：`20260925_ui_defects`｜档位：S｜起点锚点（自取）：`0d5fa55c498a7f804368a33d5b47ae764cf0aac6`
- 本批只修 **① ③** 两条**根因已确认**的；**② 定性未完 ⇒ 一个字未改**（见 §3）。
- 写盘范围：`app.json`、`pages/archive-list/index.wxss`、本文件。⛔ 未加任何判据/断言（`tools/**` 不在本批范围）。

---

## 1. 缺陷①「档案页点整行无反应」——详情页未登记进 `app.json`

**根因（RCA 已确认，本批复核一致）**：`pages/archive-list/row-actions.js:74` 跳 `/pages/customer-detail/index?customerId=…`，而 `app.json.pages` 当时只有 3 条（`pickup-list` / `archive-list` / `recognize`）⇒ 平台找不到页 ⇒ `navigateTo:fail`，**界面毫无反馈**。旁证：`git show d30bb82 --name-only` 里没有 `app.json`（详情页批回执写"已登记"= 自述与 diff 不符）。

**修法**：在 `app.json.pages` 补一条 `pages/customer-detail/index`，位置放在 `pages/archive-list/index` 之后（语义相邻：列表 → 详情；⛔ `pickup-list` 必须留在首位——首条 = 启动页）。**跳转路径与登记值逐字一致**（含 query 键名 `customerId`）。
⛔ 未动 `row-actions.js` 的跳转（它是对的）；`bindtap="onOpenDetail"` 就绑在 `.card` 上（`index.wxml:20`），事件本身没问题。

**读数（反向登记对帐；探针在仓库外，用法 = `node ui31_probe2.js <仓库根>`）**：

| 用例 | 输出 |
| :--- | :--- |
| 修后·真实树 | `页面目录 4 个 ｜ 差集为空（全部已登记）` |
| **变异**：副本内删掉刚加的那行（盘上已核内容确变） | `页面目录 4 个 ｜ 未登记 1 个: pages/customer-detail/index` |
| 对照：同一副本把行加回 | `差集为空（全部已登记）` |

⇒ 这条对帐**有牙**，可作为将来判据的依据。**新判据（`pages/` 目录 → `app.json`/分包登记的反向对帐）按项目规矩须人批 ⇒ 本批未加，标"待批"。**
探针脚本（原样，供判据照写）：读 `pages/*/index.js` 存在者集合，与 `app.json.pages + subPackages(root+"/"+page)` 归一化后取差集，非空即报。

---

## 2. 缺陷③「左滑删除 UI 上下超出」——行间距落在包裹层内，红条比卡片高 20rpx

**根因（纯几何，RCA 已确认）**：`.card{margin-bottom:20rpx}`（`index.wxss:11`）的卡片是 `.row-wrap{position:relative;overflow:hidden}`（`:287`）的**正常流子节点**；`overflow:hidden` 让包裹层自成 BFC ⇒ 卡片的外边距**不外泄** ⇒ **包裹层高 = 卡片高 + 20rpx**；红条 `.row-del{top:0;right:0;bottom:0;…}`（`:290`）撑满包裹层 ⇒ **红条比卡片高 20rpx**，且卡片下沿之外那 20rpx 无人遮挡 ⇒ **不左滑也常驻露一条淡红窄条**。`overflow:hidden` 只裁到包裹层边界，裁不掉它。

**修法（只动一处：间距搬家）**：

```
改前（index.wxss:287-288）
.row-wrap { position: relative; overflow: hidden; border-radius: 16rpx; }
.row-wrap .card { position: relative; z-index: 1; transition: transform 0.18s ease; }

改后（index.wxss:290-293，含解释性注释）
/* 行间距必须挂在包裹层，⛔ 别搬回 .card —— …（外边距不外泄 ⇒ 包裹层高 = 卡片高 + 间距）… */
.row-wrap { position: relative; overflow: hidden; border-radius: 16rpx; margin-bottom: 20rpx; }
.row-wrap .card { position: relative; z-index: 1; transition: transform 0.18s ease; margin-bottom: 0; }
```

- ⛔ **没改** `.row-del` 的固定高（把"卡片多高"复制成两处迟早分叉）；⛔ 没改圆角与位移（`:289` 的 `translateX(-160rpx)` 与 `:291` 的圆角保持原样）。
- 已核 `.card` 在本页 wxml 里**只出现一次**（`index.wxml:20`，正是 `.row-wrap` 的子节点）⇒ 这次覆盖不会波及其它块。

---

## 3. 缺陷②「预填格子互相叠」——**未定性，本批零改动**

- ⛔ `pages/recognize/**` 本批**只读**，一个字未改。
- **等什么证据**：**两张同屏对照图** —— ㈠软键盘弹起、输入框聚焦时；㈡键盘收起后。㈡正常而㈠叠 ⇒ 坐实"键盘期布局不缩"；㈡也叠 ⇒ 转"`measureMid` 实测高失准"那条。另请附机型与 iOS/Android。
- 两条候选各怎么修（**证据到手再选一条，别一次改三处**）：
  - **键盘期布局不缩** ⇒ ㈠监听键盘高度变化后**重测中段高**（或键盘期收起底部操作栏）；㈡把 `.page` 的 `height:100vh` 改成"最小高度 + 允许整页滚动"；㈢`<input>` 补 `cursor-spacing`。
  - **`measureMid` 失准** ⇒ 逐处追 `index.js` 那五处调用点与 `.top` 的每次改写**是否都走 `setDataMeasured` 三出口**（RCA §诚实边界 2 未逐处追，选这条修法前必须先追完）。

---

## 4. 本批读数（真实输出）

- `node tools/check.js` ⇒ `通过 41 项；失败 0 项；警告 0 项`
- `node tools/selftest.js` ⇒ `断言 486 条：通过 486，失败 0`
- `powershell -File check.ps1` ⇒ `全部通过（退出码 0）：完成声明成立。`（`CHECK_EXIT=0`）
- `powershell -File gate.ps1 -Anchor 0d5fa55… -ScopeFiles 'app.json,pages/archive-list/index.wxss,docs/specs/' -Estimate 60` ⇒ **绿 exit 0**：`变更文件 2 个` 全在范围内、`体量 8 行 ≤ 暂停线 90 行`

## 5. 诚实边界（⛔ 不许当已验）

1. **真机未验**：① 修好后"点整行能进详情页"必须由**用户点一次**才算通（本次只有静态对帐 + 变异证明"这条对帐有牙"，**没有真机读数**）；③ 的观感（红条与卡片是否齐平、圆角是否还缺角）同样要真机看一眼。
2. **② 完全没动**，其定性仍缺那两张对照图。
3. 本批**未加判据**：反向登记对帐、以及（RCA 建议的）"红条高 == 卡片高"结构不变量，都属**新增判据 ⇒ 须人批**；本批只在 §1 留下了可照写的探针与读数。
4. **仪器事故留痕（本批三次，都是"读数工具"翻车而非判据）**：① `node -e "<脚本>"` 被 PowerShell 剥掉双引号 ⇒ 语法错、**输出为空**（若把空输出当成"差集为空"就是假绿）；② 改临时脚本后仍用**相对路径**，`Set-Location <副本>` 后 node 的 cwd 落在原仓库 ⇒ 变异用例**假绿**（两次读的都是未变异的 `app.json`）；③ 最终改为"**脚本文件 + 显式传仓库根 + 盘上核内容确已变**"才拿到可用读数。⇒ 教训：**测判据之前先测仪器**（同族卡：`docs/lessons/2026-09-25_*`）。

---

## 6. 追补（卡 31 追加小批，用户已批「批：加"反向登记对帐"判据」）：判据落地

- **位置**：`tools/check.js` 新增 **§3b**（紧跟第 3 条之后）。
  - **页面判别口径**：**".js + 同名 .wxml" 才算页面** —— 零件（`sheet-flow.js`/`row-actions.js`/`swipe.js`/`recycle.js`/`sheet-line.js`/`parts.js`/`form-parts.js`）没有 wxml ⇒ 天然不误报（实测 **4 个页面 / 7 个零件，区分零误差**）。
  - **报红点名路径**：`[FAIL] 页面未登记进 app.json：pages/customer-detail/index —— 文件在但没声明 ⇒ wx.navigateTo 静默失败（真机表现是"点了没反应"，不是报错）`。
  - **空集防线**：`pages/` 扫不到页面时报红（不静默通过）—— 同族教训卡"空集上的全绿"。
  - **边界（已写进注释）**：将来若把**自定义组件**放进 `pages/`（组件也有 wxml）会误报 ⇒ 组件移出 `pages/`，或给判据加白名单（属新增判据，须人批），⛔ 不许用"排除某个目录"糊过去。
- **项数变化**：`node tools/check.js` **41 项 → 42 项**（失败均 0）。
- **变异读数**（副本内；每次注入前端上核过内容确实变了）：

| 用例 | 输出 | 退出码 |
| :--- | :--- | :--- |
| 真实树 | `[OK] 反向登记对帐：pages/ 下 4 个页面全部已登记进 app.json`｜`通过 42 项；失败 0 项` | 0 |
| **变异**：副本删掉 `pages/customer-detail/index`（盘上核：pages 只剩 3 条） | `[FAIL] 页面未登记进 app.json：pages/customer-detail/index —— …`｜`通过 41 项；失败 1 项` | **1** |
| 对照：副本把该行加回（盘上核：4 条） | `[OK] 反向登记对帐：…4 个页面…`｜`通过 42 项；失败 0 项` | 0 |
| **空集分支**：副本把 `pages/` 改名为 `pages_hidden`（盘上核：`pages/` 不存在） | `[FAIL] 第 3b 条无法核验：pages/ 下没扫到任何"js + 同名 wxml"的页面 ⇒ 反向对帐在空集上全绿` | 1 |

- **本批读数**：`node tools/selftest.js` **486 条全绿**｜`check.ps1` **退出码 0**｜`gate.ps1 -Anchor ce85694… -ScopeFiles 'tools/,docs/specs/' -Estimate 60` ⇒ **绿 exit 0**（变更 1 文件全在范围内、体量 41 ≤ 90）。
- **未验（⛔ 不许当已验）**：真机仍为零 —— 判据只能拦"漏登记"，"**点整行能进详情页**"必须由用户点一次才算通。

---

## 7. 缺陷②「预填格子互相叠」——真机截图到手后的**定性修正 + 修复**（本批）

- 起点锚点（自取）：`460612057e2394d62b0c282612c5e8ddcc6b55b7`｜写盘范围：`pages/recognize/**`、本目录。
- 新证据：用户真机截图（1206×1437，**是裁剪过的局部图**——顶部那半截是裁切边，不是渲染缺陷，别误读）。

### 7.1 我独立读图得到的结论（与派单方读法一致的三条 + 一条修正）

1. **标签完好**：`取件码 *` / `柜号` / `运单后 5 位` 都是整字；
2. **灰底格子完好**：`从取件点里选一个`、`不知道就留空` 整字、无裁切；
3. **只有"下划线式"输入的值被垂直裁切**：`取件码` 的值、`运单后 5 位` 的值**与它的 placeholder**（同一盒子，同病）；底部提示段落与操作栏之间**有空隙、不重叠**；
4. ⚠️ **修正派单方的措辞**：不是"**行高**与字号不匹配"——`app.wxss:6-7` 在 `page` 上设了 `line-height: 1.6`，继承下来是**宽裕的** 51.2rpx。真正的机制见 7.2。

### 7.2 根因（外部出处 + 盒高算术，可复算）

- 事实：**小程序 `<input>` 是原生组件、自带默认最小高 `1.4rem`**（≈44.8rpx，375pt 宽机型 1rem=32rpx）；**字号大于它也不会把盒子撑高**，Android 端不复现 —— 出处：[小程序 input 设置字号大于其默认高度，无法撑起字号设定的高度](https://www.cnblogs.com/iuniko/p/17544732.html)（官方组件文档属性表**未列**默认高度，故这条靠社区实测 + 本页现象印证）。
- 本页 `.input`（`pages/recognize/index.wxss`，修前）：`box-sizing: border-box` + `padding: 16rpx 0` + `border-bottom: 2rpx` + **无显式高度** ⇒
  **内容盒 = 44.8 − 32(上下 padding) − 2(边框) ≈ 10.8rpx**，而字号是 **32rpx** ⇒ **字被垂直裁掉约 2/3**（与截图观感一致）。
- **为什么同屏只有它被裁**：`.pick-value` / `.label` / `.hint` 都是 `<view>`/`<text>`，**没有**那个默认最小高、按 padding 自然撑开 ⇒ 完好。⇒ 这条分化线本身就是根因的判据。

### 7.3 修法（最小改动：一个规则块，两行新增）

```
改前（pages/recognize/index.wxss）
.input {
  border-bottom: 2rpx solid #e5e5e5;
  font-size: 32rpx;
  padding: 16rpx 0;
  width: 100%;
  box-sizing: border-box;
}

改后（同文件；+line-height +min-height，其余一字未动）
.input {
  border-bottom: 2rpx solid #e5e5e5;
  font-size: 32rpx;
  line-height: 44rpx;   /* 显式行高：不写就继承 page 的 1.6（=51.2rpx），盒高算不清 */
  min-height: 88rpx;    /* 原生 input 默认最小高 1.4rem 被 border-box+padding 吃掉 ⇒ 必须给显式高度 */
  padding: 16rpx 0;
  width: 100%;
  box-sizing: border-box;
}
```

- ⛔ **没动** M14 三段布局、`computeMidHeight` 与任何 JS；⛔ 没动 `.pick-value`/`.label`/`.hint`；⛔ 没新增判据/断言（`tools/**` 不在本批范围）。
- **为什么是 88rpx**：与本页其它控件**同一口径**（`.btn` 的 `line-height:88rpx`、`.pick-value` 的 `22+40+22≈88`、`.lines-head` 的 `min-height:88rpx`、`.target-value` 的 `padding:22rpx`）—— `.input` 原本是全页**唯一**没有对齐到 88rpx 的控件，也正是唯一出事的。
- **理论盒高推算（修后）**：`min-height 88` − `padding 32` − `border 2` = **内容盒 54rpx** ≥ 显式行高 **44rpx** ⇒ **余量 10rpx**，文字不再触边；`line-height:44rpx / font-size:32rpx = 1.375` 行高比，可读性正常。

### 7.4 还差什么真机证据（⛔ 不许当已验）

1. **修复后同屏再截一张**（老的"取件码 / 运单后 5 位"那两块）：值应完整显示、下边框仍在、行高与标签间距自然。
2. **机型 + iOS/Android**：默认最小高这条**只在 iOS 侧复现**（Android 不复现），所以这张图大概率来自 iOS 机 —— 需要用户确认，且修后**两端都要看一眼**（88rpx 显式高度两端都吃得下）。
3. **键盘弹起时的同屏图**（仍未取）：用于把 RCA §2 那条旧假设**彻底结案或转正**（若键盘期另有一层互压，那是一条独立缺陷，另立卡）。

### 7.5 本批读数（真实输出）

- `node tools/check.js` ⇒ `通过 42 项；失败 0 项；警告 0 项`
- `node tools/selftest.js` ⇒ `断言 486 条：通过 486，失败 0`
- `powershell -File check.ps1` ⇒ `全部通过（退出码 0）：完成声明成立。`（`CHECK_EXIT=0`）
- `powershell -File gate.ps1 -Anchor 4606120… -ScopeFiles 'pages/recognize/,docs/specs/' -Estimate 80` ⇒ 见回执（本批只改一个 wxss 块 + 两份文档）。
