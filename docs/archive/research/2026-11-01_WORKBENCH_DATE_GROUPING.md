# 工作台「按日期分类」设计研究（#5 · 批 16 研究 / 批 17 实施）

> **性质**：研究快照（只读调研，**未改代码、未改口径、未动门禁**）。按归档规则登记于 `docs/archive/README.md`（索引登记由 Lead 回写，本文件不动其它文件）；不作为验收证据，现行口径以 `docs/contract/V4_CONTRACT.md` §13 **D45** 与 `docs/ux/V4_UX_PARTNER.md` §4.10 为准。
> **输入**：任务卡 F + `docs/archive/reviews/2026-11-01_USER_FEEDBACK_PROPOSAL.md` §1.4/§7.2 + `docs/archive/research/PERFORMANCE_2026-11-01.md` P0-5 与 §4.3/§4.6。
> **证据纪律**：`[静态]`=源码结构（给文件:行）、`[实测]`=本次只读命令真实输出、`[推导]`=算术推导、`[未取证]`=需真机/控制台；数字一律给取数命令，不写死。

---

## 0. 结论先行（≤10 行）

1. **推荐 M1**：只改**已完结区**的分区锚（完成时间 → `createdAt`，UTC+8 自然日）+ **进行中行加「顺延 N 天」标签**；进行中仍按站点分组、四档动线不变。理由：D45 的用户痛点是「跨日没送完的单看不出来」，M1 用纯客户端改动解决，不动服务端排序/分页（D45 明确不改），也不需要新索引。
2. **M2（进行中按日期分节）不做**：把「站点分组 + 四档动线」改成日期维度等于重写 UX §4.3/§4.10，组结构变化更频繁 → 直接放大 P0-5 整表替换风险。
3. **M3（独立日期页）不做**：页数 31→32 已被批 17 的 D46 楼层清单页占用，再做一页 = 33 页，`app.json`/CONTRACT §7/ARCHITECTURE/UX/QA/工具注册表全联动。
4. **M4（工作台日期筛选器）不做**：`from/to` 现有实现锚在完成时间（`listPartner.js:197`），对进行中单等于锚在 `statusUpdatedAt`；客户端只筛已加载 30 行会与翻页语义打架。
5. **`createdAt` 索引结论**：M1 **不需要新索引**；`(partnerId,*,createdAt)` 现无（`docs/data/V4_DATA_MODEL.md:540`），只有「服务端按 `createdAt` 排序/筛选」才需要，且必须锚与排序同源。
6. **需用户拍板 5 项**：形态、已完结分区标签取下单日还是完成日、折叠文案口径、顺延标签阈值、是否允许动服务端排序/索引（§5 U1~U5）。
7. **批 17 落点**：`#5 日期分类实施` 与性能 P0-5 同批（proposal §7.2 第 11 项）；实施顺序 = 口径 → UX → 纯件 → 页面 → 断言。

---

## 1. 现状证据（可复核行号）

| # | 事实 | 行号锚点 / 取数命令 |
| :-: | :-- | :-- |
| E1 | 进行中区**无日期维度**：按站点分组、四档动线排序 | `parts/group-view.js:216-235`（buildGroupsFromList）、`:163-188`（sortForRoute/toRows） |
| E2 | 行内只显示状态更新时间，下单时间从不出现 | `parts/group-view.js:138`（`timeText: timeTextOf(item.statusUpdatedAt)`）、`index.wxml:131` |
| E3 | `createdAt` 客户端**零消费** | `grep -rn "createdAt" pages/partner/workbench/` → 0 命中 `[实测]` |
| E4 | 已完结区三桶（今天/昨天/更早）锚 = **完成时间**，不是下单日 | `parts/history-view.js:46-51`（finishedMsOf: `completedAt\|\|cancelledAt\|\|statusUpdatedAt\|\|updatedAt`）、`:53-62`（dayKeyOf）、`:65-82`、`:85-96` |
| E5 | 折叠入口文案「已完结 · 今天 N 单 >」，N = 完成时间窗条数 | `parts/filter-view.js:99-103`、`parts/history-view.js:25-28`（summaryQuery）、`:102-109`（collapsedState）、`index.wxml:275-277` |
| E6 | `createdAt` 已随行 DTO 下发（与 `statusUpdatedAt` 同批） | `cloudfunctions/api/handlers/order/_dto.js:362-363` |
| E7 | `orders` 索引清单：有 `idx_partner_inprogress(partnerId,status,statusUpdatedAt desc)`、`idx_partner_completed`、`idx_customer_merge(customerId,status,createdAt desc)`；**无 `(partnerId,*,createdAt)`** | `docs/data/V4_DATA_MODEL.md:540` |
| E8 | 服务端排序固定 `statusUpdatedAt`，`from/to` 窗锚也不是 `createdAt` | `listPartner.js:106-116`、`:154-166`（orderBy）、`:193-205`（from/to）、`:207-213`（游标同序） |
| E9 | 扫描窗：每状态最多扫 90 行（`limit=30` → `min(max(90,60),300)`）后在内存过滤/切片 | `listPartner.js:282-284`、`parts/load-view.js:13`；`node -e "console.log(Math.min(Math.max(30*3,60),300))"` → 90 `[实测]` |
| E10 | 工作台 `index.js` 497 行（闸 500/50）→ 新逻辑只能进 `parts/` | `wc -l pages/partner/workbench/index.js` → 497 `[实测]` |
| E11 | D23 合并追加**不改 `createdAt`**（只写 parcels/images/manualEntry/version/updatedAt）→ 合并单归属首单下单日 | `cloudfunctions/api/handlers/order/_merge.js:203-213`；`V4_DATA_MODEL.md:53`、`V4_CONTRACT.md:609`（D23） |
| E12 | 「今日完成」计数走 `completedAt`（完成口径），与「按下单日分节」是两套日 | `listPartner.js:248-258` |
| E13 | 结构签名一变即整表替换；分片追加 `concat` 会重发已渲染组 | `parts/group-view.js:326-331`/`:333-357`、`parts/load-view.js:248-256`、`index.js:298-314`；读数与取数方法见 `PERFORMANCE_2026-11-01.md` §4.3/P0-5 |
| E14 | 页数口径 31 与 `app.json` 双向联动，新增页要动 4 处 | `V4_CONTRACT.md:398-424`、`tools/check-docs.js` #2 汇总行、`V4_ARCHITECTURE.md:235` |

---

## 2. 候选方案对比（≥4 案 + 组合）

| 方案 | 用户可见形态 | 改动面（页面/纯件/服务端/索引/测试/文档） | 性能影响（P0-5 / setData） | 风险 | 工作量（相对档位，不含评审/真机等待） |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **M1 最小（推荐）** | 已完结区按下单日分节（今天/昨天/更早），折叠入口保留；进行中行加「顺延 N 天」标签；进行中仍站点分组 | 仅 S4：`parts/day-view.js`（新）+ `history-view.js` + `group-view.js` 行字段 + `index.wxml/wxss`；S2 断言；服务端/索引/`app.json` 零改 | **低**：`groups` 结构不变 → 结构签名不变（`group-view.js:326-331`）→ 仍走行级补丁；行字段 +1 个 | 两套日文案不清会误解（§6 R1）；日界公式需收成一处 | 小 |
| **M2 完整** | 进行中也按日期分节（今天/昨天顺延/更早），已送达归入其下单日节 | S4 大改：分组维度从站点改日期（`group-view`/`load-view`/`page-actions`/wxml 全动）；UX §4.3/§4.10/§4.16 重写；QA 重写；测试大改 | **高**：组数与结构签名频繁变化 → 整表替换概率与字节上升，与 P0-5 正面冲突 | 动线排序（按需查明/柜/码）与日期分组谁优先无解；多选「全选本站」语义失效 | 大 |
| **M3 独立日期页** | 新增分包页，按日期列已完结/历史单；工作台加入口 | S4 + S0（`app.json`）+ 文档四联动；页数 31→32（与 D46 抢同一格，两页都做 = 33）；`CONTRACT §7`/ARCHITECTURE/UX/QA/工具注册表 | 中：新页无 30s 轮询、分片 ≤20 行可控；但多一个页面实例与首屏调用 | 双入口分流、导航关系复杂；页数预算已被 D46 用掉 | 中高 |
| **M4 日期筛选器** | 工作台顶部加「今天/昨天/更早」日期 chip，不改分组 | S4：`filter-view.js` + wxml；若要正确必须服务端加锚参数（→ 变 M5） | 中：筛选触发重新拉取；客户端筛选只覆盖已加载 30 行 | **语义错**：现有 `from/to` 对进行中单锚在 `statusUpdatedAt`（E8）；客户端筛已加载页 → 「筛空 vs 真空」误判 | 小（但正确性未解决） |
| **M5 服务端排序/筛选**（提案 §1.4 旧 M3，仅对照） | 服务端按下单日排序/过滤，可跨页精确 | S8 `listPartner` 的 sortField/锚/游标全改 + 新索引 + CONTRACT/DATA_MODEL 改口径 + 控制台建索引（只能用户做） | 中高：索引到位则查询稳；未到位则 ≥90 行窗漏单 | 锚与排序不同源会**挖洞漏单**；`counts`/游标/`#10`/`P1-7` 全联动 | 大 |
| **组合 C1 = M1 + M4（仅已完结区）** | M1 的形态 + 已完结面板内日期跳转 chip | S4 略增（chip 复用 `olderQuery`） | 低 | 与现有「更早还有 N 单 >」重复；收益小 | 小 |
| **组合 C2 = M1 + M3** | M1 + 独立日期页入口 | = M1 + M3 | 中 | 页数冲突同上，且两处日期视图易口径漂移 | 中高 |

**对比结论**：M1 是唯一「零服务端、零索引、零新页、不碰 P0-5 结构签名」的案；C1 只在用户明确要「已完结区主动按日期挑」时才值得加；M2/M3/M5 都要动口径或页数预算，须先拍板再评估。

---

## 3. 推荐案与批 17 实施步骤

### 3.1 推荐案（M1，含「顺延 N 天」标签）

- **已完结区**：分节锚改为 `createdAt`（UTC+8 自然日），保留今天/昨天/更早三桶与折叠入口；**折叠加载窗口不换**（仍按完成时间窗拉 `summaryQuery`/`expandQuery`/`olderQuery`，服务端零改）。
- **口径澄清（关键）**：折叠入口的 N 保持「今天完成」口径，分节标签改带日期（如「10-31 · 2 单」），并在面板头写明「按**下单日**分」。这样「今天完成 5 单」与「10-31 · 2 单 / 11-01 · 3 单」相加一致，不会出现两个「今天」。
- **进行中区**：站点分组 + 四档动线**不变**；行内新增「顺延 N 天」，N = 今天 0 点（UTC+8）− 下单日 0 点 的天数；只对未完成桶显示（`submitted/accepted/picked/exception`，桶集合 `shared/order-view.js:13-20`），`DELIVERED`（待确认，视同已送达）与 `history` 桶不标。
- **零改动面**：服务端、索引、`app.json`、`shared/**`、`api/**` 全不动；`groups` 结构不变 → 结构签名不变 → P0-5 的行级补丁路径完整保留；分页/游标/`counts`/`since` 无回归面（D45 明文不改服务端排序/分页）。
- **「未送达单不迁出原下单日」的落法**：进行中区不分节 → 不存在「迁日」动作；跨日只在行内以顺延标签体现，只有已完结单才按下单日归档。

### 3.2 `createdAt` 索引结论（结论：批 17 **不建索引**）

1. M1 不产生新查询：仍走 `(partnerId,status,statusUpdatedAt desc)` 既有索引（E7），分区完全在客户端对**已加载行**做。
2. **不把 `from/to` 锚改成 `createdAt`**：`pageOf` 是「按 `sortField` 扫描 → 内存按锚过滤 → 游标同字段」的单序结构（E8/E9）；只换锚不换排序 = 在按完成时间降序的 90 行窗口里按 `createdAt` 挖洞，会出现「已完结里明明有单却翻不到」。
3. 若将来确要做服务端日期筛选（M5）：必须**同批**改四件——① CONTRACT D45 追加/新 D 裁决；② `V4_DATA_MODEL.md` §5.1 索引行 + §5.2 查询路径；③ `listPartner` 的 `sortField`/锚/游标；④ 用户控制台建 `(partnerId,status,createdAt desc)`（agent 只给步骤与证据要求）。缺任一即不做。
4. 索引只能由用户建（AGENTS §7）；本方案不产生该动作。

### 3.3 实施步骤（批 17，顺序不可调）

1. **Step 0 口径（Lead）**：在 D45 行内补「实施形态 = M1 + 归档锚 = `createdAt`（UTC+8）+ 顺延标签规则」的结论，**不新开 D 行**（可省 `tools/check-docs.js:294` 的 `D_MAX` 联动；若 Lead 决定新开 D 行，必须同步 `D_MAX`，属 S2 工具链域）。
2. **Step 1 UX/文案**：`docs/ux/V4_UX_PARTNER.md` §4.10（分区锚/标签/折叠文案）、§4.15（顺延文案）、§11（真机项）；`docs/delivery/V4_QA_CHECKLIST.md` 补真机点检条（人点检项，agent 不代勾）。
3. **Step 2 纯件（S4，`pages/partner/workbench/parts/**`）**：新增 `parts/day-view.js`（`dayStartMs/dayKeyOf/createdMsOf/delayDaysOf/sectionsOf`），把现在重复在 `history-view.js:11-22` 与 `index.js:22-35` 的 UTC+8 日界公式收成一处；`history-view.js` 与 `group-view.js:111-151` 改为消费它。新件 ≤500 行；`group-view.js` 现 426 行，加字段时用等量删除保持余量。
4. **Step 3 页面接线（S4）**：`index.js` 只接线，把 `index.js:22-35` 的日期小函数下沉到 `day-view`（净腾约 14 行，为 497/500 留余量）；`index.wxml:130-133` 加顺延标签、`:283-284` 分节标签带日期；`wxss` 复用现有 `tag` 类，不引新样式框架。
5. **Step 4 断言（S2，`tools/selftest-order-workbench.js`）**：先加断言在旧代码上跑**首红**，再改代码复绿；覆盖 §4.1 的 A1~A8。
6. **Step 5 P0-5 同批**：按 `PERFORMANCE_2026-11-01.md` P0-5 行做「只换变化组 / 分片不重发已渲染组」，真机 100+ 单取证（与 #5 同批，见 proposal §7.2 第 11 项）。
7. **Step 6 DoD**：`powershell -File check.ps1` 4 步退出码 0（Lead 执行）+ 相关 selftest 套件全绿 + 真机项交用户点检；`STATE.md`/`CHANGELOG.md` 由 Lead 回写。

### 3.4 谁在批 17 做什么

| 角色 | 域 | 批 17 产出 |
| :-- | :-- | :-- |
| Lead | 口径/回写/门禁 | D45 增补、UX/QA 回写、`check.ps1`、提交与 STATE/CHANGELOG |
| S4 兼职端 | `pages/partner/**` | `parts/day-view.js` 新增 + `history-view`/`group-view` 改造 + `index.wxml/wxss` |
| S2 工具链 | `tools/**` | `selftest-order-workbench` 断言（首红→复绿），必要时 `check.js` 页数/字面量判据复核 |
| 用户 | 真机/控制台 | 形态拍板、真机点检；仅当选 M5 才需建索引 |

---

## 4. 验收思路

### 4.1 可静态断言（纯件、零 `wx`）

| 编号 | 断言点 | 判据（有牙） |
| :-: | :-- | :-- |
| A1 | UTC+8 日界 | 固定 `nowMs` 入参（不读系统时间）：`2026-11-01T00:00+08` 前 1ms 归「昨天」、当刻归「今天」 |
| A2 | 跨日顺延 | `delayDaysOf`：`nowMs=00:00:01+08`、`createdMs=前一日 23:59:59+08` → 1（不是 0） |
| A3 | 合并单归属首单 | 跑一次合并追加后 `createdAt` 不变、`version+1`；配套源码级断言：`_merge.js:207-213` 更新字段集合不含 `createdAt` |
| A4 | 已完成/已送达不标顺延 | `bucket=delivered`/`history` 的行 `delayDaysText` 为空串 |
| A5 | 计数一致 | 同一批 rows + 同一 `nowMs`：各分节条数之和 === 折叠入口 N（防两个「今天」打架） |
| A6 | 结构签名稳定 | 新增行字段后 `signatureOf(groups)` 不变（P0-5 行级补丁不被打断） |
| A7 | 页面零判据 | `pages/partner/workbench/` 无状态字符串字面量、无 `wx.cloud.*`（沿用门禁 #21 既有判据，不新增白名单） |
| A8 | 文案单源 | 顺延文案只在 `parts/day-view.js` 出现一次，页面/wxml `grep -c` 为 0 |

### 4.2 真机项（只能用户点检，agent 不代勾）

- B1 滚动观感：进行中 30 行 + 已完结展开 30 行时滚动是否顺滑、粘性站头是否仍生效（UX §4.9）。
- B2 标签可读性：顺延标签在窄屏长行内不挤掉取件码/柜号/档位文字。
- B3 跨零点：23:59 停留到 00:01，30s 轮询后分区与顺延自动更新且不整表闪动。
- B4 100+ 单：F12 看一次结构变化（新单/跨站）的 setData 字节与次数，对照 P0-5 目标。
- B5（可选）设备时区非 UTC+8：分区仍按 UTC+8 自然日，不随手机时区漂移。

---

## 5. 待用户拍板项

| 编号 | 事项 | 选项与影响 |
| :-: | :-- | :-- |
| U1 | 形态 | M1（推荐）/ M2 / M3 独立页 / M4 / 组合 C1·C2；选 M2 或 M3 需追加一轮 UX 与页数联动评估 |
| U2 | 已完结分节标签 | 按「下单日」（D45 字面，推荐，标签带日期如「10-31 · 2 单」）/ 按「完成日」（=现状，只加顺延标签） |
| U3 | 折叠文案 | 是否改为「已完结 · 今天完成 N 单 >」；不改会与下单日分节混淆（N 现为完成口径，E12） |
| U4 | 顺延阈值 | N≥1 全标（推荐）/ 仅 N≥2 标 / 加颜色分级（颜色不单独承载语义） |
| U5 | 是否允许动服务端排序/索引 | 即 M5；需新 D 裁决 + 用户控制台建索引，本轮默认不做 |

---

## 6. 风险与未决

- **R1 两套日混用**：折叠计数是完成口径（E12）、分节是下单口径（E4）→ 必须同批改文案，否则用户看到「3 单」但分节只数到 2（A5 断言兜底）。
- **R2 日界三处漂移**：`history-view.js:11-22`、`index.js:22-35`、`cloudfunctions/api/lib/time.js:5-23` → M1 收成一处纯件；云侧不动（本轮不改服务端）。
- **R3 与 P0-5 耦合**：M1 不改 `groups` 结构，风险低；一旦改 M2，组数变化会提高整表替换频率（`PERFORMANCE_2026-11-01.md` §4.3）。
- **R4 分页窗口边界**：90 行扫描窗 + 完成序扫描（E9）→ 「更早」翻页本就有窗口边界；M1 不放大也不修，需与 #10/#7 同批评估。
- **R5 与 #7 楼层清单页（D46，31→32 页）导航关系**：日期维度不进楼层页（那页是苑→栋→楼层）；两页同批时建议先做 #5（无新页、无 `app.json` 改动）再做 D46；工作台入口并列，不复用分组逻辑。
- **R6 `DELIVERED` 归属**：D45 未单独裁决；UX §4.10 现状明确「属活动区待确认、不提前归档」→ 本方案沿用（不顺延、不归档）；要改需另立裁决。
- **R7 需 Lead 回写的两处**：`docs/archive/README.md` 登记本文件（归档规则第 5 条；本次不动，按任务卡由 Lead 统一回写）；批 17 完成后 `STATE.md`/`CHANGELOG.md` 回写。

---

## 7. 附：本次只读复核命令（2026-11-01 快照，读数以当次输出为准）

```bash
wc -l pages/partner/workbench/index.js                  # 497（闸 500）
node -e "console.log(Math.min(Math.max(30*3,60),300))"  # 90（listPartner.js:282-284 扫描窗）
grep -rn "createdAt" pages/partner/workbench/ | wc -l   # 0（客户端零消费）
node tools/check-docs.js                                # 应全绿（当次：通过 12 项、失败 0 项）
```

> 本文件只做设计研究与方案对比，不写实现代码（CONTRACT §14 第 1 条）；实施与门禁真实读数由批 17 负责。
