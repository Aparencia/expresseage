# CODE_20260925_pick_friend_r2 · 24 卡**重审**（r2｜对象 = 修复批 `b4a6831`）

> 审查者：**独立的新鲜上下文子代理**（未参与本批任何编码或修复；V6 公理 4：实现者不复核自己）。
> 真实仓库**全程只读**（唯一写盘 = 本文件）。全部变异与运行时复现都在 `%TEMP%\pf_review2\` 的**副本**里做。
> 重审依据：`playbook/24-代码审查.md`（母版卡）｜前次报告：`docs/reviews/CODE_20260925_pick_friend.md`（r1，建议色 🔴，P0 0 / P1 2 / P2 4 / P3 7）。
> ⛔ 本文件不改任何代码/文档，不提交；放行由人裁决。

---

## §0 范围与方法

### 0.1 锚点校验与"HEAD 在我脚下移动"（时效边界）

| 项 | 值 | 证据 |
| :-- | :-- | :-- |
| 锚点 | `3192f02` | `git log --oneline -1 3192f02` → `3192f02 docs(pick_friend): 22 卡设计 …`（提交真实存在 ✓）；`STATE.md:30` 记同一值 |
| 开工时 HEAD | `b4a6831`（= 修复批，**本次审查对象**） | `git rev-parse HEAD` → `b4a683153826ba880fc12bf32e2abd8acd08f21c` |
| 收工时 HEAD | **`44a9ec1`**（前移 4 个提交） | `git log --oneline b4a6831..HEAD` → `10cbb87` `87107f4` `bb77b90` `44a9ec1`（同一棵工作树被并行任务写：gate 修复 + v1 教训收卡 + TECH_DEBT/STATE 订正） |
| 前移影响面（实测隔离） | **代码侧零改动** | `git diff --stat b4a6831..HEAD -- utils/ pages/ chatpick/ tools/` → **空**；前移的只有 `gate.ps1`（4 行）、`STATE.md`、`docs/TECH_DEBT.md`、`docs/lessons/*`、`docs/specs/20260925_v1_lessons{,_migration}/`（17 文件 +59 −75） |
| 范围总量（收工时口径） | 45 files, **+2244 −195**，21 提交 | `git diff --shortstat 3192f02..HEAD`（代码侧 13 files, +1362 −114） |
| 修复批自身 | 11 files, **+649 −179**（代码侧 8 files, +644 −174） | `git diff --shortstat 63f9e50..b4a6831` |

⚠️ **两条对读数的影响已写清**：① 本报告所有**代码**结论对 `b4a6831` 成立、且对当前 HEAD 同样成立（代码零漂移）；
② `gate.ps1` 的范围判据口径是"锚点..**工作树**"，所以它现在会把 `b4a6831` 之后的 4 个提交的文件也算成"变更文件" ⇒ **我不能用 gate.ps1 单独复算修复批的越界读数**（§4 用 `git show --name-only` 逐条核，那才是权威）。

**⚠️ 时效边界之二：工作树在我审查期间**第二次**被写脏（未提交）**。收尾时 `git status --porcelain`：

```text
 M docs/specs/20260925_pick_friend/RESEARCH.md   (10+/0-)
 M pages/archive-list/index.js                   (14+/14-)
 M pages/archive-list/sheet-flow.js              (58+/0-)
 M tools/selftest-wave5.js                       (36+/0-)
 M tools/selftest.js                             (1+/1-)
 M docs/registry/COMPONENTS.md                   ← 写这份报告的过程中**又多了这一个**（集合还在长）
HEAD 仍是 44a9ec1（这批改动没有提交）
```
⇒ **本报告的一切"已修/未修"都是以"已提交的修订"（`b4a6831`＝`44a9ec1` 的代码侧）为基准**；上面这份未提交改动**不在我的审查范围内**（我没读全、没跑、不评价）。只记两条与我不冲突的事实，供下一轮参考：① 它新增的是 `redactIdLike`（**形状兜底**脱敏：`/[A-Za-z0-9_-]{16,}/`）与 `formatPickEvidence`（给"拉起好友列表"的五个失败出口做一行可判读证据），落点是 `startChatPick` 的结果 —— **不是** §2 R-14 点名的 `describeLegacyPickup` 的 `infoErr`/`bindErr` 那条路（我核过它的 diff 头 70 行，新函数没被接进老路）；② 它给 §11b 加了 36 行断言 ⇒ 今天再跑 `node tools/selftest.js` 的"断言 N 条"**不会再是 400**（我的 400 读数是干净树时的读数）。

### 0.2 审查对象：修复批 `b4a6831` 的文件清单（**逐条 `git show --name-only` 核过，不采信提交信息**）

```text
docs/registry/APIS.md            3+/3-      utils/chat-tool.js      63+/30-
docs/registry/COMPONENTS.md      1+/1-      utils/reason.js          3+/1-
docs/registry/DATA_DICT.md       1+/1-      utils/storage.js         5+/1-
pages/archive-list/index.js    147+/134-    tools/selftest.js       22+/4-
pages/archive-list/index.wxss    6+/3-      tools/selftest-wave5.js 185+/1-
pages/archive-list/sheet-flow.js 213+/0-   ← **新文件**（本批唯一新路径）
```
⇒ 11 个路径全部是 pick_friend 相关（registry 三件套 / 页面 2 件 / 页面零件 1 件 / utils 3 件 / 测试件 2 件）；**没有** `app.json`、`pages/recognize/*`、`pages/pickup-list/*`、`utils/migrate.js`、`check.ps1` 的一个字节。
提交信息自称的"页面抽件回线内、断言 337->400"两条我另行核过：`node tools/selftest.js` → `断言 400 条：通过 400，失败 0` ✓；页面函数行数见 §1 R-11 ✓。

### 0.3 引用检查清单原文（母版卡 24 §②，逐字）

**七个固定维度**：1 接入性与装配（含 UI 三层链路：①路由/挂载注册 ②入口可达 ③handler 绑定链 → 任一层断 = P1）｜2 逻辑性（空值/越界/并发重复提交/失败路径/入参校验/多步写事务边界/异步竞态与幂等/时区日期/金额精度）｜3 牵连性（调用方全找、被修改符号的既有调用方行为兼容、被删符号零残留、**四份文档同步**：`registry/APIS.md`·`CHANGELOG.md`·`registry/DATA_DICT.md`·`docs/TECH_DEBT.md`）｜4 性能（六类典型 + 资源泄漏）｜5 冗余死代码（含"永远为真/假的分支"、疑似保留必须写理由）｜6 开发规范（命名/注释 Why/类型安全/函数 >50 行·文件 >500 行/提交信息 + 宪法 §11 六条）｜7 安全（鉴权/越权/SQL/XSS/CSRF/上传/路径/口令哈希/密钥/脱敏/CORS/debug/依赖审计与 lockfile）。
**四个条件维度**：⑧ UI 可访问性｜⑨ 外部调用（适配层/显式超时/降级/验签幂等）｜⑩ 性能预算（无预算文件 ⇒ 按维度④定性 + 标"无预算基线"）｜⑪ 数据隐私（D3/D4：加密/脱敏/用途限定）。
**严重级判据（只用这四级）**：P0 崩溃/数据丢失/安全漏洞（必须清零）｜P1 核心功能不可用（含装配断链，必须清零）｜P2 边缘功能报错/体验不佳（登记 TECH_DEBT）｜P3 拼写/样式/非关键提示（同登记，可延后）；**不确定按 P2**。
**建议色矩阵（唯一判色依据）**：🔴 红 = P0≥1 或 P1≥1（**含旧报告未核销的 P0/P1**）｜🟡 黄 = P0=P1=0，但存在 P2/P3 或有待用户裁决的取舍｜🟢 绿 = P0=P1=0 且旧报告 P0/P1 全部核销。
**重审范围**：修复 diff 跑全部七个维度 + 旧问题清单逐条核销（已修/未修/新引入）——不是只看修复那几行。

### 0.4 方法（跑了什么、以及**没读什么**）

| # | 动作 | 结果落点 |
| :-- | :-- | :-- |
| 1 | `node tools/check.js \| Select-Object -Last 2` → `通过 35 项；失败 0 项；警告 0 项`；`node tools/selftest.js` → `断言 400 条：通过 400，失败 0`；`powershell -NoProfile -ExecutionPolicy Bypass -File .\check.ps1` → `全部通过（退出码 0）：完成声明成立。`（exit 0，连跑 3 次 + 并发 2 次全 0）——**三条都是"干净树"时的读数**（见 §0.1 时效边界之二） | §5.3 |
| 2 | **自建运行时 harness**（`%TEMP%\pf_review2\h_r2.js`，stub `Page/getApp/wx` + 内存存储驱动**真实页面源码**），**同时跑 pre（`git archive 63f9e50`）与 post 两棵树** —— 只有能测出旧 bug，才配说"已修" | §1 R-01/R-02/R-03、§2 R-08/R-14/R-16 |
| 3 | **7 组副本变异**（注入前逐组断言"注入点恰好 1 次 + 内容确实变了"；LF/CRLF 两种写法都试） | §3 |
| 4 | 静态读数：花括号闭合判 `data` 边界、8 组参数组合经**真实页面方法**求值、函数/文件行数（node 数，⛔ 不用 PS 5.1 裸 `Get-Content`）、符号残留、装配链路、文档↔实码对帐 | §1/§2/§4 |
| 5 | 台账对帐：`APIS/COMPONENTS/DATA_DICT` 三件套与实码逐行；`TECH_DEBT` TD-001/016/017/018 现状；`STATE.md` | §1 R-04/R-05/R-10/R-12/R-13、§2 R-15/R-19/R-21 |
| 6 | `gate.ps1` 锚点门禁两次（`-Anchor HEAD` 零变更用例；`-Anchor 63f9e50` 修复批范围用例） | §4、§2 R-21 |

**本轮未读/未验（不许冒充）**：① `3192f02..63f9e50` 的批 1~3 diff **未再逐行重读**（r1 报告 §0.2/§0.3 已逐提交核过文件清单，我抽验了"Won't 零代码"与关键行）；② `docs/lessons/*` 与 `docs/specs/20260925_v1_lessons*/` 的正文（并行任务文档，不在 pick_friend 范围）；③ **本批零真机读数**：U-2/U-5/U-6/U-7/U-9/U-11 与验收 V1~V6（真机）**一条都没点**——我没有开发者工具、没有真机、没有截图；④ 未跑 `npm audit`（N/A：零依赖、无 lockfile，`gate.ps1` 独立判"依赖无变化"）。

### 0.5 覆盖地图（文件 × 维度；✓ 已审 ／ — N/A+原因 ／ ○ 未审+原因）

| 文件（修复批内） | ①装配 | ②逻辑 | ③牵连 | ④性能 | ⑤冗余 | ⑥规范 | ⑦安全 | ⑧UI | ⑨外部 | ⑩预算 | ⑪隐私 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `pages/archive-list/sheet-flow.js`（新） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `pages/archive-list/index.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pages/archive-list/index.wxss` | ✓ | — | ✓ | — | — | ✓ | — | ✓ | — | — | — |
| `utils/chat-tool.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `utils/storage.js`（R-06 那 5 行） | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `utils/reason.js`（R-07 那一行） | ✓ | — | ✓ | — | — | ✓ | — | ✓ | — | — | — |
| `tools/selftest.js`·`selftest-wave5.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | ✓ |
| `docs/registry/{APIS,COMPONENTS,DATA_DICT}.md` | — | — | ✓ | — | — | ✓ | — | — | — | — | ✓ |

**N/A 与理由**：⑦对 `tools/*` 与 docs 无安全面（纯本地静态文件、无网络/无密钥/无鉴权概念——本项目零依赖零后端）；⑧只对含 UI 的文件适用（`sheet-flow.js` 的文案属"上屏内容"，按 ⑪ 审）；⑨本批**没有**新增第三方调用（只改了既有 `wx.openChatTool` 包装的定时器来源）；⑩项目无预算文件（无 P95/包体积基线）⇒ 按维度④六类定性判断并标"**无预算基线**"。
**阶段跳过声明**：无阶段可跳过——阶段 1（数据层）＝`utils/*`、阶段 2（前端/集成）＝`pages/*`、阶段 3（测试/配置/文档）＝`tools/*`+registry，三段在修复批 diff 里都有覆盖。

---

## §1 前次报告（r1）R-01~R-13 **逐条核销表**

> r1 的编号范围**实际是 R-01~R-13**（R-13 写在它 §2 补记/§6 第 3 条，任务书写的"R-01~R-12"漏了它；我按实际清单核）。下表的"已修/部分/未修"**每一行都有本轮实跑读数或 file:line 证据**。

| 旧号 | r1 级别 | 结论 | 本轮证据（可复算） |
| :-- | :-: | :-- | :-- |
| **R-01** | P1 | ✅ **已修（真关）** | 键收成一次性令牌（`sheet-flow.createKeyToken` `sheet-flow.js:20-30`）+ `fromChatFlow` 闸门（`:41-48` 的 `if (!fromChatFlow) return {key:'',…}`）+ 落库前复检 `planSave`（`:195-201`，调用 `index.js:470`）。**双树对照复现**：同一条 harness（换绑冲突→＋新建降级→保存）在 **pre `63f9e50`** 得 `库里持同一把会话键的档案数 = 2 → 甲 / 小王`；在 **post** 得 `= 1 → 甲`、`小王那条 chatRoomId = ""`。换绑**成功**变体同样 pre 2 / post 1。 |
| **R-02** | P1 | ✅ **已修（真关）** | ①`timersOf` 缺省回退全局定时器（`chat-tool.js:49-57`）+ `startPick` 显式注入（`index.js:273-274`）；②`picking` 三处复位（`index.js:107` `onShow`、`:115` `onHide`、`:283-285` 结算）＋卡死超窗重试（`shouldStartPick` `sheet-flow.js:180-186`）。**双树对照复现**（平台既不 success 也不 fail）：pre `注册定时器数 = 0 ｜ picking = true ｜ sheetOpen = false`（点两下只弹 toast，浮层永不打开）；post `注册定时器数 = 1 ｜ 超时阈值 = 8000`，手动触发该看门狗后 `picking = false ｜ sheetOpen = true ｜ 屏上文案 = "没能打开好友列表…（下面手填一样能建）"`；`onHide/onShow` 后 `picking = false`；超窗后再点 `本次新注册定时器 = 1`。 |
| **R-03** | P2 | ✅ **已修** | 判据改成 `Array.isArray(packet.members)`（`index.js:131`）。**双树对照**（两个平台接口都不存在、包内 `members:null`）：pre 走键路 `chatEvidence = "reason=CHAT_MEMBERS_FAILED"`（老路不可达）；post 走老路 `chatEvidence = "reason=CHAT_ID_UNAVAILABLE ｜ 原文=… ｜ isChatTool=true ｜ apiCategory=chatTool"`（取证读数行上屏）。registry 两行也已标注可达性（`APIS.md` 的 `readThreeStates` 行、`COMPONENTS.md:45`）✓。⚠️ 这条修复**新接通**了一条 D3 上屏通道 ⇒ 见 §2 **R-14**。 |
| **R-04** | P2 | ✅ **已修** | `APIS.md` K5 行现在写 `{at, info, infoErr, bindErr, members, membersErr}` 并注明 `members` 是"原样双方 id 数组"——与实码**逐字对得上**：`app.js:22` 声明同形状；实跑分包页写进桥的包 = `{"at":1790330893232,"info":null,"infoErr":"…","bindErr":"","members":null,"membersErr":"…"}`（6 键齐）。 |
| **R-05** | P2 | ✅ **已修** | `DATA_DICT.md` 的 `chatRoomId` 行补了"库里存**本地摘要键**（16 位小写 hex、不可逆）…平台原值只活在内存桥"＋待裁②=A 的双语义说明。实码侧：`pairKeyOf` 实测输出 `9f0cf41a9d61023e`（16 位小写 hex ✓）、`utils/migrate.js` 本批零改动（形态闸未动 ✓）。 |
| **R-06** | P2 | ✅ **已修** | `storage.js:612` `if (typeof key !== 'string') return failOf('VALIDATION_FAILED','CUSTOMER_INVALID:chatRoomId');`。变异 M3（改回"非字符串当解绑"）⇒ **红 3 条**（§3）。 |
| **R-07** | P3 | ✅ **已修** | `reason.js:102` → `chatRoomId: '会话键'`；`selftest.js` 的对应断言同步改成 `indexOf('会话键') >= 0` 并通过。 |
| **R-08** | P3 | ⚠️ **部分修复（残余仍在）** | 已做：删掉死参数 `hasDup` 与 `SHEET_DUP_RPX`、注释改成**如实**写明"16 种组合只有一个返回值 620rpx、三参数暂时不改变结果"（`index.js:46-51`）。残余：三个参数**仍然不改变结果**——本轮经**真实页面方法**跑 8 组组合（`syncSheetHeight` × `sheetNameAuto` × `chatState`）：`返回值集合 = {"620rpx":8}`（pre 版 16 组同结论）。⇒ `648 > 620` 的算式与三个入参一起构成"装饰性参数"（旧 R-17 的第二实例，未清偿）。详见 §2 **R-17**。 |
| **R-09** | P3 | ✅ **已修** | `index.wxss:241`（规则起始；改动是 `:243-245` 的 `display:inline-flex; align-items:center; min-height:88rpx` + `padding:0 24rpx`）⇒ 触摸盒不再由 `12rpx padding + 24rpx×1.4` 决定（≈62rpx）；注释也换成了实测口径与来源（"24 卡 R-09 实测：原 padding…≈62rpx，不到 88rpx"）。⚠️ 属**静态 CSS 读数**，真机触摸未验。 |
| **R-10** | P3 | ✅ **已修** | `TD-001` 的取数命令已换成与判据同一把尺子："**与判据同一把尺子 = 非空行**（报告 R-10 订正）"+ node 版命令；`gate.ps1:47` 实际用 `Get-Content -LiteralPath $f -Encoding UTF8 \| Measure-Object -Line`（= 非空行）⇒ 两者同尺 ✓。**顺带一条本轮实测**：PS 5.1 里 `Get-Content` **不带** `-Encoding UTF8` 会把行数**数少**（`sheet-flow.js` 174 vs 真值 213；`index.js` 435 vs 528）——`gate.ps1` 与 TD-001 都已带/已用对口径，所以这只是"手量时别用裸 `Get-Content`"的警语。 |
| **R-11** | P3 | ✅ **已修** | node 实测（>45 行全扫）：`startChatPick` 53 → **48**（`chat-tool.js:151-198`，超时出口抽成 `pickTimeoutResult`）、`onSheetSave` 76 → **40**（`index.js:443-482`，键决议/值域闸/文案抽件 + 拆出 `createFromSheet` 21 行、`afterCreated` 11 行）。文件行数：`index.js` 528 总 / **497 非空**（<500 ✓）、新件 `sheet-flow.js` 213 ✓、`storage.js` 662/610（既有欠账 TD-001）。仍在 50 线内但贴线的：`bind` = 50 行、`applySessionKey` = 47 行。 |
| **R-12** | P3 | ✅ **已修** | `STATE.md:37` 把分母与取数命令写死："暂停线判在**代码侧净改动**上，取数 `git diff --shortstat <锚点>..HEAD -- utils/ pages/ chatpick/ tools/ app.js`；全批净改动（再带 `docs/` 与 spec）另算，**两者不得混用**"，并记了用户"修复批超线放行"的裁决。⚠️ 行内的两个数字已过期 ⇒ 见 §2 **R-19**。 |
| **R-13** | P3 | ❌ **未修（同类又添新实例）** | `STATE.md:33` 仍写"…+ **12 条断言**…断言 300→**318**"，与紧邻的 `:22-24`"本文件不再抄读数 / 报告 R-14 犯了两次"自相矛盾；`DESIGN.md:108/119` 另有"300 → **318**""318 → **337**"。修复批自己也没动这两处 ⇒ 见 §2 **R-19**（新增 `STATE.md:37` 的 817/+187、`TD-001` 的 606、`DESIGN §10` 的"未拆零件"）。 |

**旧报告 P0/P1 核销汇总**：r1 的 P0 = 0（无）；P1 = 2（R-01、R-02）⇒ **两条都用双树对照复现证明"真关"，未核销数 = 0**。
更早四份报告（`CODE_20260923_chat_pick.md` / `_r2.md` / `CODE_20260924_chat_pick.md` / `_r4.md`）各自的 P1 已由 r1 §0.5 逐条核销；本轮按其"审查范围声明＝仅限本次 diff"**不重开**，只抽验了两条与本批相邻的事实：`pages/recognize/form-parts.js` 仍在位且被 `selftest` §11 覆盖 ✓；`pages/pickup-list/index.js` 本批零改动 ✓。

---

## §2 新发现（编号 / 级别 / 位置 / 描述 / 影响 / 建议）

> 编号从 **R-14** 起。R-14/R-16 来自"修复批自曝 + 我的独立判定"，R-15 起是我这轮新查出来的。**修复批自曝的两条我都独立判了级**，并给出能否构造出坏场景的实测。

### 🟡 R-14 ｜ **P2** ｜ N2 老路的脱敏闸在"拿不到 roomId"时**空转** ⇒ 平台 `errMsg`/`bindErr` 里的会话标识原样上屏（D3）；而这条通道正是 R-03 修复**新接通**的

- **位置**：`sheet-flow.js:139-167`（`describeLegacyPickup`），三处调用 `chatTool.maskRoomIds(text, [roomId])` 在 `:160-162`；空转的机制在 `chat-tool.js:327-335`：`if (typeof value !== 'string' || value.length < 4) continue;` ⇒ **`roomId === ''` 时待屏蔽列表等于空**，`maskRoomIds` 是恒等函数。
- **为什么"新接通"**：修复前 `applyLegacyRoomId` 在生产路径上不可达（r1 R-03 已实证），所以**没有任何 `errMsg` 能走到屏上**；R-03 改判据后它可达（我 §1 R-03 的 post 读数就是走这条路），这条上屏通道随之活了。
- **构造读数（纯函数直调真实源码，post 树）**：
  ```text
  describeLegacyPickup({infoErr:'getChatToolInfo:fail open_single_roomid=aB3xY9zK2mNq4rT7uV (something)'})
    → evidence = "reason=CHAT_ID_UNAVAILABLE ｜ 原文=getChatToolInfo:fail open_single_roomid=aB3xY9zK2mNq4rT7uV (something) ｜ isChatTool=true ｜ apiCategory=chatTool"
  bindErr 通道：evidence 里 "绑定原文=openChatTool:fail roomid=aB3xY9zK2mNq4rT7uV" 同样原样
  maskRoomIds 探针：maskRoomIds('x'+RAW, ['']) = 'xaB3xY9zK2mNq4rT7uV'（needle='' ⇒ 原样返回）
  ```
- **影响（触发条件）**：分包含 `getChatToolInfo` 失败 ⇒ 主包走老路 ⇒ 只要平台把那串 id 夹在 `errMsg` 里，它就**印在浮层取证行上**（可被截图转发；这正是 M11/K5 要避免的）。**唯一未取证的前提 = "平台 errMsg 会夹带 id 吗"**——本仓自己的注释就写了这条前提（`chat-tool.js:321-322`："平台失败原文（errMsg）**有时会带上参数值** ⇒ 直接贴 = 把 D3 会话标识印到屏幕上"）。
- **诚实标注**：这是**能构造出"上屏带 id"**的代码路径（上屏内容我实跑出来了），但**没有真机样本**证明平台真的会这么给。⇒ 判 **P2**。**若裁决认为"D3 上屏一律按安全漏洞处理"，本条应提到 P1**——我不替你升级，但也不同意把它降成 P3：它是"脱敏闸在整条路上失效"，不是个别字句没脱敏。
- **建议修法**：`roomId` 为空时**不放原文**（只出 `reason=` + 字段名，或改成"原文含会话标识，已隐去 N 处"）；或给 `maskRoomIds` 加一条"无已知 id 时按形态兜底"（如 `open_single_roomid=` 后跟的值整段替换成指纹）。⛔ 单纯留着不管等于把 K5 的"上屏前一律过 `maskRoomIds`"写成一句空话。

### 🟡 R-15 ｜ **P2** ｜ 新零件 `sheet-flow.js` 没登记进 `APIS.md §2.3b 页面内零件`（同一张卡的前例就登记在那里）

- **位置**：`docs/registry/APIS.md:73`（§2.3b 标题与表只列 `pages/recognize/form-parts.js`，5 行）；新件只有 `COMPONENTS.md:45` 的一句"修复批后本区文案的拼装搬进 `pages/archive-list/sheet-flow.js`（纯函数、有断言）"。
- **证据**：`git grep -n "sheet-flow" -- docs/` ⇒ 仅 1 处（`COMPONENTS.md:45`）；修复批对 `APIS.md` 的改动只有 3 行（`readThreeStates` 行、`rebindCustomerChatKey` 行、K5 行），**没有** §2.3b 行（`git show b4a6831 -- docs/registry/APIS.md`）。
- **影响**：§2.3b 存在的理由就是"**拆的收益就是可测**——这些规则住在页面里时 `selftest` 够不到"；这张卡刚把 9 个导出（8 个函数 `createKeyToken`/`resolveChatKeyForSave`/`planSave`/`gateSheetForm`/`describeSessionKey`/`describeRebindNotice`/`describeLegacyPickup`/`shouldStartPick` + 常量 `PICK_STALE_MS`，`sheet-flow.js:203-213`）搬出页面并配了断言，却没在这张表上留下"契约、调用方、失败码、断言落点"。下一个审 D3/审零件的人照 §2.3b 找，会以为档案页仍然零零件。
- **建议**：在 §2.3b 补一行（或把标题改成"页面内零件（多件）"并各列一行），把 9 个符号的调用方（`pages/archive-list/index.js` 的哪几个方法）与 `selftest` §11b 的落点写进去。⛔ 落点本身没违反 `ARCHITECTURE §3`（"页面专用零件放 `pages/<页名>/<件名>.js`，不放 `utils/`"——它做对了），**缺的是登记**（AGENTS §7）。

### 🟡 R-16 ｜ **P2** ｜ `this.chatRoomId`（平台原值）的生命周期**没有收口**：R-01 只收了会话键，残留仍会跨轮写进新档案

- **位置**：`index.js:89`（声明）、`:231`（`this.chatRoomId = view.roomId`）、`:236`（`if (view.roomId) this.fromChatFlow = true`）、`:468`（`resolveChatKeyForSave(this.keyToken, this.fromChatFlow, this.chatRoomId)`）、`:244`（只有 `clearChatBinding` 会清它）。与键不同：`abandonKey()`（`:139-142`）只清令牌与闸门，**不清 `chatRoomId`**。
- **构造读数（真实页面 + 内存存储，post 树）**：
  ```text
  ① 老路拿到明文：this.chatRoomId = "rawPlatformRoomId0123456789" ｜ fromChatFlow = true ｜ sheetOpen = true
     关浮层后：fromChatFlow = false ｜ this.chatRoomId 仍 = "rawPlatformRoomId0123456789"      ← 只作废了令牌
  ② 第二轮走键路：keyToken.peek() = "1b7dda0a89a2d740" ｜ fromChatFlow = true
  ③ 这一次保存撞上既有失败分支（读库失败 ⇒ planSave error，:471-474）⇒ 令牌被 drain、闸门仍在、没写盘
  ④ 再保存一次：小王那条 chatRoomId = "rawPlatformRoomId0123456789"   ★上一轮的平台原值被写进这一轮的新档案
  ```
- **影响（触发条件）**：① U-5 判为**明文**（`readThreeStates` 返回 ok ⇒ `this.chatRoomId` 非空）；② 中间有一次"drain 令牌但不写盘"的失败（读库失败，或 dup 挡板后再次保存被 `:446` 的 `sheetDupText` 守卫拦住的情形同理）。后果是把**上一轮那条会话的原值**静默挂到新客户身上（"按会话自动归类"会归错人）。⇒ **P2**；若 U-5 判明文，建议提级复核（那时的触发面会宽很多）。
- **建议修法**：让平台原值与会话键**同一条生命周期**——`abandonKey()` 里一并 `this.chatRoomId = ''`（或把原值也塞进一次性令牌、`onOpenSheet` 时快照"这一轮的原值"）。当前 `resolveChatKeyForSave` 的第三参语义是"**这一轮**可用的平台原值"，实码却给了"**这台设备上最后一次**拿到的原值"。

### 🟡 R-17 ｜ P3 ｜ R-08 残余：`computeSheetScrollHeight` 的三个参数仍不改变结果（旧 R-17 未清偿）

- **位置**：`index.js:46-62`（注释 + 常量 + 函数）、`:372-377`（唯一调用方）。
- **证据**：经**真实页面方法** `syncSheetHeight(hasError)` 跑 `sheetNameAuto`×`chatState` 全组合 ⇒ `返回值集合 = {"620rpx":8}`（8 组只有一个值；pre 版 16 组同样只有 `620rpx`）。算式的根因在注释里已如实写着：`300 + 116×3 = 648 > 620`。
- **影响**：无用户可见后果（就是"可滚区高度固定 = 上限"）；但它是一段"看起来会随条件变、其实恒等"的代码 + 三个装饰参数，下一个人重算常数时会以为已经生效。注释已改为事实陈述 ⇒ 只剩死算式。
- **建议**：要么把常数重算到真的会变（并补一条纯函数断言——这是它第一次可自测），要么把三个参数也删掉、把"可滚区高度固定"写成事实并挂 TD-001 类欠账。⛔ 不建议只留注释。

### 🟡 R-18 ｜ P3 ｜ 修复批自称的"`maskRoomIds` 一旦被漏掉，断言会当场判红"**不成立**（注释高估了机器闸的覆盖面）

- **位置**：`sheet-flow.js:9-10`（"这条 D3 纪律只能靠人看 ⇒ `describeLegacyPickup` 把它变成可断言的东西"）与 `:133-134`（"`maskRoomIds` 一旦被漏掉，断言会当场判红（D3）"）。
- **证据（变异对照，同一副本配方）**：**M5b**（把 `describeLegacyPickup` 的三处 `maskRoomIds` 调用整段摘掉，注入点 1 次、字符数 9099→9003）⇒ **`断言 400 条：通过 400，失败 0`，exit 0**；**M5a**（把 `maskRoomIds` 函数体掏空）⇒ 红 1 条（因为 §10 有它**自己**的单测）。⇒ 有牙的是函数的单测，**不是调用点**。
- **影响**：这是"自述/注释大于事实"的文档侧失真（与教训卡 `2026-09-25_自述范围大于diff.md` 同族），不是代码缺陷；但它会让人以为"这条 D3 纪律已经被机器守住了"⇒ 直接导致 R-14 这类洞没人找。
- **建议**：把注释改成事实（"函数本身有单测；调用点目前仍靠人核"），或补一条直接断言 `describeLegacyPickup` 输出的断言（含"unknown roomId + errMsg 带 id"这个用例——它今天会红，正好把 R-14 变成有牙的判据）。

### 🟡 R-19 ｜ P3 ｜ 台账/文档里的实测数字又漂了（R-13 同族复发，且新增三处）

- **证据（逐条实测）**：
  - `STATE.md:37` 写"修复批**自身 817** 行（>600 暂停线）"与"新增 `sheets-flow.js` **+187 行**"——按提交实测：修复批代码侧 8 文件 = **+644 −174 = 818**；`pages/archive-list/sheet-flow.js` = **213 行**（git `--numstat` 213/0）。两个数字都对不上（817/+187 只可能是提交前的中间读数）。
  - `TD-001` 行仍以"`storage.js` **606 行**"结尾，而修复批又给 `storage.js` +4（`git show b4a6831 -- utils/storage.js` = 5+/1−；实测非空行 **610**）⇒ 增量没随条挂账（该行的既有纪律是"增量随本条挂账"）。
  - `DESIGN.md:119` 仍写"页面 482 非空行 ⇒ **未拆零件**"——修复批**已经拆件**（`index.js` 现 497 非空行 + 新件 213 行、`sheet-flow.js`），且修复批没有在 spec 里留任何条目（`git show --name-only b4a6831` 里没有 `docs/specs/**`）。
- **影响**：数字进了散文就没人再读它（教训卡 `2026-09-24_散文里写实测数字.md` 的原话），而这三处恰好都在"下一轮审查者会照它复算"的位置。
- **建议**：按该卡规矩把数字换成取数命令（`git diff --shortstat 63f9e50..b4a6831 -- utils/ pages/ chatpick/ tools/ app.js` 等）；`DESIGN §10` 补一条修复批条目（拆件理由与 R-11 的关系）。

### 🟡 R-20 ｜ P3 ｜ 两个阈值的**序关系**是重入闸成立的前提，却既无注释也无断言

- **位置**：`sheet-flow.js:172`（`PICK_STALE_MS = 10000`）vs `chat-tool.js:28`（`DEFAULT_TIMEOUT_MS = 8000`）。
- **描述**：`shouldStartPick` 的"超窗即允许重试"之所以安全，是因为看门狗（8s）**先于**卡死窗口（10s）结算、把 `picking` 复位；一旦有人把 `DEFAULT_TIMEOUT_MS` 调大过 10s，重试就会与在飞调用叠成两次拉起会话选择（第二次顶掉第一次的选择）。今天成立，但没有任何东西把它钉住。
- **证据**：`selftest-wave5.js` §11b 的"重入③"直接喂 `1000 + PICK_STALE_MS + 1`，与 `DEFAULT_TIMEOUT_MS` 无关；`sheet-flow.js:170-172` 的注释只解释了"为什么要有窗口"，没写"窗口必须大于看门狗"。
- **建议**：注释写明这条不变量的来源，并加一条断言（`PICK_STALE_MS > chatTool.DEFAULT_TIMEOUT_MS`）；顺带与 TD-015 的"阈值多处双写"合流登记。

### 🟡 R-21 ｜ P3 ｜ 台账两条自相矛盾/出处指错（TD-017、TD-018）

- **TD-017**：状态列已写"✅ **已清偿**（2026-09-25 · `10cbb87` 应用）"，但同一行的处置列仍完整保留"**待应用（2 行，属新判据 ⇒ 须人批）**…复跑'零变更'用例应得黄 exit 2"。**我独立复跑**（`gate.ps1 -Anchor HEAD -ScopeFiles 'utils/,pages/' -Estimate 300`，工作树干净）⇒ 输出与它引用的新文案**逐字一致**（`[WARN] 变更文件 0 个 ⇒ 本批的判据没测任何东西（锚点或 -ScopeFiles 可能填错）；**这不是通过**`）＋ `门禁黄：1 项提示` ＋ **exit 2**；`10cbb87` 的 diff 也确实是"加 WARN + 绿行只在 `$changed.Count -gt 0` 时打印" ✓。⇒ **事实相符，只是中间列没改成过去式**（读者会以为还没应用）。
- **TD-018**：实体描述我复核为真（键=无序对摘要 ✓、`rebindCustomerChatKey` 人工重锚 ✓、查重挡板 ✓、自动合并仍无 ✓），但括注"（**DESIGN §10 明写只做人工重锚**）"**指错了文件**：`git grep -n "人工重锚" -- docs/` 只命中 `TECH_DEBT.md:34` 与 `docs/specs/20260925_pick_friend/RESEARCH.md:73`，`DESIGN.md` 里没有这四个字（§10 记的是"仍要新建不带键"与待裁②=A）。
- **建议**：TD-017 处置列改写成"（已应用，见状态列）"；TD-018 的出处改成 `RESEARCH §2.1/§3`。

### 🟡 R-22 ｜ P3 ｜ 新增的测试节函数 `runSheetFlowSection` = **139 行** > AGENTS §11.1 的"函数 ≤50 行"（测试豁免只写在**文件**那一侧）

- **位置**：`tools/selftest-wave5.js:441-579`（`runSheetFlowSection(kit)`；同一文件的 `runFormPartsSection` = 146 行同形，属既有惯例）。
- **证据**：node 机械扫描 >45 行的函数（本报告 §0.4 方法 4）：`tools/selftest-wave5.js:441 runSheetFlowSection = 139 行`、`:285 runFormPartsSection = 146 行`；文件侧 **不越线**（581 总行 ≤ 测试豁免 1000）✓。
- **影响**：无功能影响；它是 24 卡维度⑥ 点名的"函数 >50 行要提"的机械命中，且是**本批新增**的（r1 的 R-11 只点了源码侧两个函数）。
- **建议**：按 §11b 已有的分节习惯再切一刀（键令牌 / 值域闸 / 文案 / 老路各一个 helper），或在文件顶部写明"测试节函数不受 50 行约束"的口径（后者更省，但等于给 §11.1 加一条豁免，须人同意）。

---

## §3 变异复测读数表（副本内做，真实树零改动）

配方：`robocopy %TEMP%\pf_review2\base <mut\组名> /E`（`base` = 收工时代码树的副本）。**每组自动断言"注入点恰好命中 1 次"且"替换后内容确实变了"**；`LF`/`CRLF` 两种写法都试（第一轮 M3 用 LF 锚点撞上 CRLF 文件、命中 0 次 ⇒ 按教训卡 `2026-09-17_变异不红的两种含义.md` 判"注入点选错"，改口径后重注）。基线（未变异副本）：`断言 400 条：通过 400，失败 0`，exit 0。

| 组 | 注入 | 注入点/变更 | 期望 | 实际 | 结论 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **M1** | `sheet-flow.js`：`if (!fromChatFlow) return {key:'',source:'degraded'}` → `if (false) …`（R-01 闸门恒开） | 1 次；9099→9091 字符 | 红 | **红（exit 1）**：`[FAIL] R-01②：降级路径（fromChatFlow=false）⇒ **拿不到键**…实际 "aaaa1111bbbb2222"`、`来源标 degraded…实际 "token"`、`降级决议落库 ⇒ 库里 chatRoomId 是空串…实际 "aaaa1111bbbb2222"` | **判据有牙** |
| **M2** | `chat-tool.js`：`timersOf` 去掉全局 `setTimeout` 回退（只剩注入） | 1 次；15504→15448 | 红 | **红（exit 1）**：`[FAIL] R-02：startChatPick 不注入定时器时也武装看门狗…`、`缺省看门狗用的是默认超时阈值…实际 undefined`、`bind 同样有缺省回退…` | **判据有牙** |
| **M3** | `storage.js`：把 R-06 的判定改回 `typeof key === 'string' ? key.trim() : ''`（非字符串当解绑） | 1 次；25886→25818 | 红 | **红（exit 1）**：`[FAIL] R-06：key 传 undefined ⇒ VALIDATION_FAILED…实际 undefined`、`detail…实际 undefined`、`undefined **没有改库**…实际 ""` | **判据有牙** |
| **M4** | `index.js`：R-03 判据改回 `packet.members !== undefined`（键存在即走键路） | 1 次；19740→19739 | 红 | **绿（exit 0）**：`断言 400 条：通过 400，失败 0`；同一副本 `node tools/check.js` 也 `通过 35 项；失败 0 项` exit 0 | **判据没牙**（**不是注入点选错**）：`selftest` 不 `require` 页面 ⇒ 页面层分支无人看 = 已登记的 **TD-016**。⇒ R-03 的"行为"只能靠 r 轮 stub 复核（本报告 §1 R-03 就是这么证的） |
| **M5a** | `chat-tool.js`：把 `maskRoomIds` 函数体掏空（`if (true) continue;`） | 1 次；15504→15410 | 红 | **红（exit 1）**：`[FAIL] errMsg 里混进 id 原值时，上屏前被替换成指纹 —— 实际 "fail aB3-xY9_zK2mNq4rT7uV denied"` | **函数本身有牙** |
| **M5b** | `sheet-flow.js`：把 `describeLegacyPickup` 里三处 `maskRoomIds(...)` 调用**整段摘掉** | 1 次；9099→9003 | 红（修复批注释自称如此） | **绿（exit 0）**：`断言 400 条：通过 400，失败 0` | **判据没牙**（调用点零覆盖）⇒ §2 **R-18**（注释失真）+ **R-14**（无人守这条纪律） |
| **M6** | `sheet-flow.js`：`planSave` 的 dup 分支 → `if (false)`（拆掉 R-01 的第二道闸） | 1 次；9099→9090 | 红 | **红（exit 1）**：`[FAIL] 计划②：带键且库里已有人持有 ⇒ 走挡板…实际 "create"` | **判据有牙** |

**逐条如实交代**：7 组里 **5 红 2 绿**；两组绿都判"**判据没牙**"而非"注入点选错"（注入点各命中 1 次、内容确实变了、且 M4 那一组连 `check.js` 也照样全绿 ⇒ 两道门禁同时看不见）。
⛔ 我**没有**复跑 DESIGN §7 预写的全部变异（"改散列常数"仍未跑 = **未验**）；M1 覆盖了"闸门恒开"、M6 覆盖了"第二道闸"，但"散列常数"这一族本轮无读数。

---

## §4 越界与"顺手改"核查

1. **文件级**：`git show --name-only b4a6831` = 11 个路径（§0.2），**全部**是 pick_friend 的 Must 落点或其 registry 回写；`app.json`、`pages/recognize/*`、`pages/pickup-list/*`、`utils/migrate.js`、`check.ps1` **零字节**。⇒ **没有**"顺手优化无关代码"。
2. **SCOPE 从未讨论的文件**：唯一新路径 = `pages/archive-list/sheet-flow.js`。判定 = **合规**：`ARCHITECTURE.md:36` 明写"页面专用零件放 `pages/<页名>/<件名>.js`（如 `form-parts.js`），**不放 `utils/`**"，它就是照这条落的；`STATE.md:37` 也记了它与"修复批超线放行"的裁决关系。⚠️ 但它**没有**登记进 `APIS.md §2.3b`（§2 **R-15**），且 `DESIGN §10` 仍写"未拆零件"（§2 **R-19**）⇒ 这两条是"回写缺失"，不是"越界"。
3. **修复批内部的"行为等价重排"**（属修复本身的必要动作，不是顺手重构）：`onSheetSave` 的值域闸搬进 `gateSheetForm`（`index.js:456` ← 原文逐行等价：空值判据、`parseRoomLine` 产出一致性判据、"照 D4-522 写"文案都在）、换绑三态文案搬进 `describeRebindNotice`、老路读数行搬进 `describeLegacyPickup`、落库后三件事抽成 `afterCreated`（顺序 setData→clearChatBinding→refresh→ROOM_ID_DISCARDED 分支与 pre 版一致）。这些都在被审 diff 内、有 R-11 的硬理由，**不建议 revert**。
4. **`gate.ps1` 不在修复批里**：`b4a6831` 的 11 个路径**没有** `gate.ps1`（§0.2）；它是在 `b4a6831` **之后**由 `10cbb87` 改的（`git show --name-only 10cbb87` = `STATE.md` + `gate.ps1`）。⇒ r1 §4.3 那条"gate 的语义修复**随 pick_friend 的提交**进树"针对的是更早的 `96d8df8`/`6602d20`/`84686b8`（仍在 `3192f02..HEAD` 范围内、登记有效），**不适用于本修复批**；`STATE.md:46` 已把它记在并行任务 C 名下备查 ⇒ 保留、不必 revert。
5. **范围门禁读数（口径已写明）**：`gate.ps1 -Anchor 63f9e50 -ScopeFiles <我按 git show 拼的 11 项> -Estimate 400` ⇒ **18 项"越界" FAIL + exit 1**，但逐条看全部是 `b4a6831` **之后**那 4 个提交的文档文件（`docs/lessons/*`、`docs/specs/20260925_v1_lessons*/`、`STATE.md`、`TD-017`…）——因为 gate 的"变更文件"= **锚点..工作树**。⇒ 这条读数**不能**用来判修复批越界（我改用 `git show --name-only`）；顺带得到两条真读数：`[WARN] 行数超线（锚点前已超，本批只是碰了它）：utils/storage.js = 610 行（锚点 606）`（= TD-001 既有欠账，判黄口径正确 ✓）与 `[WARN] 体量超暂停线：972 行 > 预估 400 ×1.5 = 600 行`（含那 4 个提交）。这正是教训卡 `2026-09-25_并行写同一工作树会让范围门禁误报.md` 的现场重演。

---

## §5 建议色 + 诚实边界

### 5.1 计数与建议色

| 级别 | 条数 | 编号 |
| :-- | :-: | :-- |
| **P0** | **0** | — |
| **P1** | **0** | —（r1 的两条 P1 = R-01/R-02 **已用双树对照复现证明真关**） |
| P2（本轮新增） | **3** | R-14（老路脱敏闸空转 ⇒ D3 上屏，R-03 新接通）· R-15（新零件未登记 `APIS §2.3b`）· R-16（`this.chatRoomId` 残留跨轮写进新档案） |
| P3（本轮新增） | **6** | R-17（R-08 残余：三参数仍恒等 620rpx）· R-18（"maskRoomIds 漏掉即判红"的自述不成立）· R-19（台账数字漂移：STATE 817/+187、TD-001 606、DESIGN"未拆零件"）· R-20（`PICK_STALE_MS` > `DEFAULT_TIMEOUT_MS` 的序关系无注释无断言）· R-21（TD-017 处置列未改过去式、TD-018 出处指错）· R-22（新增测试节函数 139 行 > 50） |
| **旧问题核销（r1 R-01~R-13）** | — | **已修 11**（R-01 R-02 R-03 R-04 R-05 R-06 R-07 R-09 R-10 R-11 R-12）· **部分 1**（R-08）· **未修 1**（R-13）｜旧 P0/P1 未核销 = **0** |

**建议色：🟡 黄。** 依据卡 24 的建议色矩阵：P0 = P1 = 0 且旧报告 P0/P1 **全部核销**（🟢 的条件成立），但**存在新增 P2/P3**（🟡 的条件也成立）——两个条件同时命中时我取**更严**的一档，因为矩阵把"P2/P3 或待裁取舍"明确列进黄色，而 🟢 的用意是"这一批干净到可以放行"。⛔ 我**不宣布通过**：R-14/R-16 是需要人裁决的两条（D3 上屏的定性、以及 U-5 判明文时要不要提级），R-15 是一次很小的回写。修复批把两条 P1 真修掉了，这一点有 pre/post 双读数支撑，不是采信提交信息。

### 5.2 通过项（逐维度，覆盖范围 = 本批 diff）

- **① 接入性与装配** ✅ 通过：新件 9 个导出（`sheet-flow.js:203-213`）的**生产**消费方**只有** `pages/archive-list/index.js`（`require` 在 `:36`；调用点 `:94 :184 :219 :230 :259 :456 :468 :470 :476`；测试侧另有 `tools/selftest.js:895` 与 `selftest-wave5.js` §11b 各一处 require/注入 —— 这是刻意设计的"抽件换可测"）；`startPick` 注入点、`onHide` 首次出现均已挂到页面对象；UI 三层链路（`app.json`→tab 页→wxml handler）本批**未改**，等价于 r1 结论 + 零回退。
- **② 逻辑性** ✅ 通过（P1 已清零）：键决议六路出口（`fromChatFlow=false`/令牌空/平台值/令牌非字符串…）都有断言；`planSave` 的 error 分支不静默；`rebindCustomerChatKey` 非字符串 ⇒ 校验失败；`onSheetSave` 的 `saving` 闸与 `sheetDupText` 守卫形成双闸；单键写、无跨表事务需求（半完成状态不存在）。⚠️ R-16 是"残留值跨轮"这一类**新**逻辑洞，计在 §2 而不是"通过"。
- **③ 牵连性** ✅ 基本通过：`chatKey` 在**代码侧零残留**（`git grep -n "chatKey" -- pages/ utils/ tools/ app.js chatpick/` ⇒ 空；命中只在 docs 的历史叙述里）；被改符号的调用方全部跟上（`computeSheetScrollHeight` 4 参 → 3 参、唯一调用方 `:374` 同步）；`storage.findCustomerByChatKey`/`rebindCustomerChatKey` 签名未变；四份文档里 `APIS`/`DATA_DICT`✓、`TECH_DEBT`（TD-001/017 另有条目在动）、`CHANGELOG.md` 本批**未动**（r1 已判它的 pick_friend 条目无读数、且警示句已在 `e71d109` 订正 ⇒ 不重复计）。扣分项 = R-15。
- **④ 性能** ✅ 通过（无预算基线）：新代码全是内存里的纯函数与字符串拼接；`describeLegacyPickup` 每次上屏只做常数级字符串处理；`planSave` 至多多一次 `loadStore`（与既有查重同量级）；无循环内 IO、无无界查询、无新订阅/定时器泄漏（`startPick` 的看门狗在 `finish` 里 `clearTimeout`，且断言"结算时把定时器清掉"在位）。
- **⑤ 冗余死代码** ⚠️ 基本通过：本批**删掉**了一处死代码（`hasDup`/`SHEET_DUP_RPX`）；保留的三参数有书面理由（"将来重算常数时不必改调用方"）——但结果仍是恒等函数 ⇒ 计 R-17。永远为真/假的分支：`if (this.data.saving)`（历史项，不在本批 diff）。
- **⑥ 开发规范** ✅ 基本通过：新件 213 行/202 非空 ✓、`index.js` 497 非空 ✓、**被改/新增的非测试函数全部 ≤50**（贴线：`bind`=50、`startChatPick`=48、`applySessionKey`=47）；JSDoc 齐（每个导出都有 `@param/@returns`）；命名单源（`会话键`/`chatKey`→`keyToken`/`fromChatFlow` 前后一致，无 `data/info/handle` 空泛名）；注释 Why 密度高于项目均值。扣分：R-18（一处注释与断言覆盖面不符）、R-20（一处不变量只活在两个文件的常数里）、R-22（新增的**测试节**函数 139 行 > 50）。
- **⑦ 安全** ⚠️ 见 R-14：本机应用、零依赖、无网络/鉴权/SQL/CORS 面 ✓；XSS 等价物 = wxml 注入：本批所有上屏串只由"人话锚 + 指纹 + `reason.js` 文案"拼成 ✓（`describeSessionKey`/`describeRebindNotice` 都有"不含键原值"的断言且我复核为真）。唯一扣分是 R-14 的 D3 上屏通道。
- **⑧ UI 可访问性** ✅ 通过：R-09 的触摸盒已达标（`min-height:88rpx`）、四态与错误/空态未回退、对比度未动。
- **⑨ 外部调用** ✅ 通过：本批对外部调用的唯一改动 = 定时器来源（注入优先、缺省回退全局），显式超时**这次真的在生产路径上生效**（§1 R-02 的 post 读数：注册 1 个 8000ms 定时器、到点结算）；降级路径不变。
- **⑩ 性能预算** — N/A：**项目无预算文件** ⇒ 按维度④六类定性判断，标注"**无预算基线**"。
- **⑪ 数据隐私（D3）** ⚠️ 主体通过、一处扣分：键/原值仍只走实例字段与一次性令牌，**不进 `data`**（我按花括号闭合独立复核：`data` 块 = `index.js:65-85`，`chatRoomId` 在 `:89`、`keyToken` 在 `:94`、`fromChatFlow` 在 `:96`、`picking`/`pickStartedAt` 在 `:98-99`、`rebindTarget` 在 `:102` ⇒ **都在 `data` 之外** ✓，教训卡《grep 行号不等于代码结构》的结论在本批仍成立）；上屏只出指纹/锚 ✓；扣分 = R-14（`maskRoomIds` 空转）。

### 5.3 诚实边界（哪些是静态读码、哪些没验）

- **本批零真机读数**：`U-2`（主包直调 `wx.openChatTool`）·`U-5`（返回明文还是加密）·`U-6`（个人主体是否开放）·`U-7`（独立分包里 `getApp()`）·`U-9`（分包页 `switchTab`）·`U-11`（`selectGroupMembers` 单聊行为）**全部未验**；验收 `V1~V8` **一条都没点**。我没有开发者工具读数、没有真机、没有截图 ⇒ **本报告不能被引用为"pick_friend 通了"**。
- **运行时结论的载体**：R-01/R-02/R-03 与 R-08/R-14/R-16 的读数是 stub（内存存储 + 假 `wx`）驱动**真实页面/真实零件源码**得到的，且 R-01/R-02/R-03 有 **pre 树对照**（`git archive 63f9e50`）⇒ 证明的是"代码路径如此"，**不等于**平台一定这样发生（R-16 的触发前提尤其如此，已在条目里写明）。
- **纯静态/机械读出的**：`data` 边界（花括号闭合）、函数与文件行数、D3 归属、装配链路、文档↔实码对帐、越界清单、`gate.ps1` 行为。
- **本轮没做**：`npm audit`/lockfile 检查（**N/A**：零依赖、无 lockfile）；DESIGN §7 预写的"改散列常数"变异（**未验**）；批 1~3 的 diff 未再逐行重读（见 §0.4）；真机触摸盒实测（R-09 只做了 CSS 静态判定）。
- **一条环境毛刺（如实记）**：**第一次**跑 `check.ps1` 得 `收工仪式未通过：1 步失败`（exit 1），而我用 `Select-Object -Last 6` 取尾把 `[FAIL]` 那一行截掉了，**没能取证是哪一步失败**；随后**连跑 3 次 + 并发 2 次全部 exit 0**（5/5 绿）⇒ 判为环境偶发、**不计入发现**，但读数只到今天这个工作树。
- **时效**：代码读数对 `b4a6831` 与收工时的 `44a9ec1` **同时成立**（已提交修订的代码侧零漂移，实测）；台账类读数（STATE/TECH_DEBT/DESIGN 行号）以我读到的 `44a9ec1` 为准。⛔ **收尾时工作树里那份未提交改动（§0.1 之二）我没读全、没跑、不评价**——它的作者如需把新机制（`redactIdLike`/`formatPickEvidence`）纳入 R-14 的修复面，请自己出一份带读数的说明。

---

## §6 给下一轮的第一份工作（若我是下一个审查者，我希望先看到什么）

1. **R-14 的裁决 + 一条有牙的断言**：先定"D3 上屏算不算安全级"（我的判断是 P2，理由是触发前提缺真机样本）；无论定级，请补一条 `describeLegacyPickup({infoErr:'…open_single_roomid=<id>…'})` 的断言——它今天**会红**（我已实测），这正是把 R-18 那句失真注释变成事实的最短路径。
2. **R-16 的二选一**：要么让 `abandonKey()` 连 `this.chatRoomId` 一起清（最小改动），要么把平台原值也改成一次性令牌（与键同构）。⛔ 在此之前不要把 U-5 的"明文"读数当成"多了一条可用通道"——它同时会放大这条残留。
3. **R-15 的一行回写**：`APIS.md §2.3b` 补 `sheet-flow.js` 那 9 个导出（8 函数 + `PICK_STALE_MS`）的契约行（含断言落点 `selftest §11b`）。
4. **R-19 的数字清账**：`STATE.md:33/37`、`TD-001`、`DESIGN §10` 三处按教训卡换成取数命令；顺带把 R-13 结掉（它是 r1 留的唯一未修项）。
5. **把"页面层判据没牙"的场景写进下一轮的核对表**：M4（R-03 判据）与 M5b（脱敏调用点）两组绿说明 TD-016 的缺口还在扩大——R-01/R-03 的**行为**目前只有 r 轮 stub 复核能证；建议把本报告的 `h_r2.js`（stub 驱动真实页面 + pre/post 双树对照）作为**页面层回归钉**沉淀到 `docs/`（r1 §8 第 1 条要的就是这个，修复批用纯函数断言只覆盖了一半）。
6. **真机读数回来之前**：`STATE.md` 的"零真机"⛔ 标注继续保留；`U-9`（分包页 `switchTab`）与 `U-7`（内存桥）不通的话，本批的 R-01/R-02 修复在生产上**都不会被触发**（因为整条动线走不到保存那一步）——这层因果请在 25 卡里明写，别让"修好了"被读成"通了"。
7. **下一轮开工前先钉死一个修订**：我这轮撞上两次"树在动"（HEAD 前移 4 个提交 + 工作树又脏了 5 个文件，§0.1）。请把"审查对象 = 某个 commit"写进任务书，并要求**开工时与收工时各贴一次 `git status --porcelain` + `git rev-parse HEAD`**；否则"已修/未修"永远只能按某个时点说话（这也是 `docs/lessons/2026-09-25_并行写同一工作树会让范围门禁误报.md` 的同一族）。

---

**重审完成：P0 0 ｜ P1 0 ｜ 新 P2 3 ｜ 新 P3 6（旧报告 P0/P1 未核销 = 0；旧 R-01~R-13：已修 11 / 部分 1 / 未修 1）。建议色：🟡 黄。**
本卡只审不修；放行/回炉由人裁决（回复"继续"进 25 验证，或"修复"回 23）。
