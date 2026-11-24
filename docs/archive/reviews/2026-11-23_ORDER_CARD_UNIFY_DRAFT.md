# 订单卡统一与排序统一（方案 C + 基准 A）· 口径与实现草案

> 日期：2026-11-23｜状态：**待用户确认**（确认后才改 CONTRACT、才动代码）｜撰写：lead
> 裁决候选编号：**D-100**（候选，待登记；最终编号以 CONTRACT §13 登记顺序为准）
> 排队说明：另有三个已定方向但未登记的裁决（送达图片 / 取件截图 / 已转出并入订单卡片），与本条一并按登记顺序取号。
> 本文只写设计与验收，不含实现代码（CONTRACT §14 第 1 条）。

---

## 1. 背景与已定方向

- 兼职端两个页面都在展示订单：`pages/partner/workbench/index`（工作台，站点分组 + 30s 轮询 + 状态筛选）与 `pages/partner/pick-list/index`（取件清单，待取件=站点分组、待送达=苑→栋→楼层，不轮询）。
- 用户 2026-11-23 裁决：**保留两页，只统一卡片视觉与顺序**（不合并页面、不改分组轴、不改刷新策略、不动写入口逻辑）。
- 卡片基准：**以取件清单为准 —— 取件码 40rpx、位于第二行右侧，宿舍锚在左**；工作台第二行的尾号/昵称降为第三行小字。

## 2. 定稿规格：一张卡，三个 variant

### 2.1 结构（三行 + 件行）

| 位置 | 内容 | workbench | pick | deliver |
| :-- | :-- | :-- | :-- | :-- |
| 行 1 | 状态 pill（复用 `components/status-pill`）+ `#0003` 序号徽章 + 时间（右） | ✅ | ✅ | ✅ |
| 行 2 | 宿舍锚（`D4-522A`，含 roomTag）大字（左）+ 取件码 40rpx（右） | ✅ | ✅ | 码位留给件数（已取件阶段不显示码） |
| 行 3 | `尾号6678 · 王同学` 小字（左）+ 标签行（右）：件数 / 站点 / 已取 n/m / 代客单 / 无截图手填 / 需查明 / 已转出 / 顺延 N 天 | ✅ | ✅ | ✅ |
| 件行 | 缩进 32rpx + 左侧从属竖线；码 / 柜号 / 需查明 / 已取状态 + 件级写按钮 | ✅ | ✅ | ✗（保持简洁） |
| 写入口 | 工作台行工具条 / 取件清单「已送达」单按钮 | 页面渲染 | 页面渲染 | 页面渲染 |

- 多件单：行 2 的码按 `码1 / 码2` 拼接；含空码件时该件显示「待补码」，空码不进入排序键。
- 标签集合与配色单源化：沿用 CONTRACT §8 状态色；标签文案收敛到卡片组件一处，两页不再各写一套。
- 组件**不含任何业务判据**：不出现状态字符串字面量、不判 tier、不生成编号、不调 `wx.cloud`。

### 2.2 组件接口（新，S10 域）

| 项 | 内容 |
| :-- | :-- |
| 路径 | `components/partner-order-card/{index.js,index.json,index.wxml,index.wxss}` |
| props | `row`（页面视图模型）、`variant`（`'workbench'｜'pick'｜'deliver'`）、`readonly`、`selecting`、`selected` |
| events | `tap`（`{orderNo}`）；件级/行工具写入口**不进组件**，由页面在组件下方渲染 |
| 注册 | `app.json` 全局 `usingComponents`（第 15 个组件）；同步 `ARCHITECTURE §3.5` 组件表与 `ENGINEERING §5.7`、门禁 #36 扫描范围 |

> 先例：`components/order-row`（顾客端）即「哑组件 + 视图模型 + 只抛事件」形态，本组件同款。

## 3. 排序单源

### 3.1 唯一比较器

`utils/order-sort.js`（新，纯件、零 wx）：

- `compareCodes(a, b)`：自然序——按 `\d+` / `\D+` 分段比较，数字段按数值、文本段按字典序；**空码恒排在有码之后**。
- `compareRoute(left, right)`：`routeTier`（1 需查明 → 2 快递柜 → 3 分段码 → 4 其他）→ `compareCodes(sortCode)` → `orderNo` 字典稳定序。

样本（判据必测）：`8-2-999` < `8-2-3021` < `8-10-1`；`M-668-2` 与纯数字码按段比较；空码最后。

### 3.2 两页取键口径

| 视图 | 分组轴 | 排序键 | 变化 |
| :-- | :-- | :-- | :-- |
| 工作台 workbench | 站点组（P1~P8） | 四档 → 码自然序 → 订单号 | 现在中间键是 `routeNumber`（码内数字拼接成整数），**改为 `sortCode` + 自然序** |
| 取件清单 待取件 | 站点组（件站点） | 四档 → 码自然序 → 订单号 | 比较器改为 require 单源（行为等价，删本地重复实现） |
| 取件清单 待送达 | 苑→栋→楼层 | 楼层 → 房间（地理序，不套四档） | 不变 |
| 工作台「今日流水」 | 平铺 | `statusUpdatedAt desc` | 不变（另一种视图，不算不一致） |
| 工作台 history / customer | 时间序 | 不变 | 不变 |

- `sortCode` 定义：= 该单**最差档代表件**的取件码（与 `routeTier` 同源，取 `parcelView.worstOfPieces`）。多件单不再出现"档位取一件、码取另一件"的错位；空码返回空串。
- 由此带来的可感知变化：部分多件单、含字母码的单在工作台站点组内位置会变动（属预期，QA 真机对比）。

## 4. 实现拆分（三批，各自独立提交与门禁）

| 批 | 内容 | 文件 | 验收 |
| :-- | :-- | :-- | :-- |
| **V1 排序** | 新增排序纯件；工作台改用自然序；取件清单改 require 单源 | S4 `utils/order-sort.js`（新）、`pages/partner/workbench/parts/{order-row,group-view,parcel-view}.js`、`pages/partner/pick-list/parts/pick-view.js`；S2 `tools/lib/order-sort-cases.js`（新） | 两套 selftest 通过；同一输入两页序一致断言 |
| **V2 卡片** | 新增组件 + 两页替换卡头（三行）；写入口/件行保留页面 | S10 `components/partner-order-card/**`（新）、S0 `app.json`；S4 `pages/partner/workbench/index.wxml`、`pages/partner/pick-list/index.wxml`；S2 两套 selftest 静态断言改写 | 组件四件套/注册一致；两页不再内联行 1 结构 |
| **V3 收口** | 标签与件的样式合并到组件，删两页重复样式 | S4 `pages/partner/{workbench,pick-list}/index.wxss`、`parts/*.wxss`；S10 组件 wxss | 两页标签集合一致断言 |

> 工作台页面 441 行、wxml 424 行受 TD-076 约束；V2 组件化后两页行数下降，正好腾出后续批次（送达照片、取件截图）所需空间。

## 5. 契约与文档回写（V1 前先改，再动代码）

| 文档 | 位置 | 改什么 |
| :-- | :-- | :-- |
| CONTRACT | §5.2「列表排序」 | 「客户端零件层只做四档动线排序」→「四档 → 取件码自然序 → 订单号」（D79 升为两页共同口径） |
| CONTRACT | §13 | 登记 D100（含本文 §2/§3 摘要） |
| UX_PARTNER | §3.11（D96 段）、§4.2（行结构）、§16（D79 段） | 码 40rpx 口径适用于工作台卡；尾号/昵称降至第三行；D79 自然序全局化 |
| ARCHITECTURE | §2 作用域、§3.5 组件表 | 新增 S10 组件、注册与用途 |
| ENGINEERING | §5.7 组件清单、门禁 #36 范围 | 第 15 个全局组件 |
| QA | 真机项 | 两页同一单顺序一致；码在跑站时可读；尾号/昵称仍可见；多件单排序变化可接受 |
| CHANGELOG / STATE | 批次记录 | V1/V2/V3 完成后按 §8.6 回写 |

DATA_MODEL、shared/**、api/**、云函数：**零改动**。

## 6. 判据

1. `tools/lib/order-sort-cases.js`：自然序样本、空码、同档不同码、稳定序；两页 selftest 均 require 同一用例，防止再次分叉。
2. 交叉断言：构造同一批 DTO，`group-view.sortRowsForRoute` 与 `pick-view.compareRows` 输出序列逐项相等。
3. 页面静态断言：`pages/partner/workbench/index.wxml` 与 `pages/partner/pick-list/index.wxml` 均使用 `<partner-order-card`，且不再内联状态 pill / 宿舍锚行结构；组件 `index.js` 零 `ORDER_STATUS` 字面量。
4. 变异电池（ENGINEERING §7.5）：
   - **M43**：`compareCodes` 退化为字典序 → 两套 selftest 同时首红；还原后 SHA256 复绿。
   - **M44**：删 `variant='deliver'` 分支（已取件阶段显示取件码）→ 静态断言首红。

## 7. 风险与不做

- 风险：工作台行序变化可被用户感知（多件/字母码单）→ 真机对比；两页断言须**改不删**（437/227 条基线）；`app.json` 改动走门禁 #3/#36。
- 不做：不合并页面、不改分组轴与刷新策略、不动写入口逻辑、不做「投递单元 / 聚焦任务 / 站内批次」（上一轮方向，本轮显式搁置）、不改服务端任何接口与字段。
