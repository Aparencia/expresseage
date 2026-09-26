# CODE_20260925_pick_friend · 卡 24 代码审查（`20260925_pick_friend` 批 1~3 + Lead 收口）

> 审查者：**独立新鲜上下文的子代理**，未参与本批任何编码（V6 设计公理 4：实现者不复核自己）。
> 真实仓库**全程只读**；5 组变异与 3 组运行时复现全在 `%TEMP%\pf_review\` 的副本里做（含"注入后先断言内容确实变了"）。
> 本文件是本次审查的**唯一产物**。⛔ 未修改任何代码/文档；未提交。

---

## §0 审查范围（锚点、提交、文件清单）+ 方法（跑了什么）

### 0.1 锚点校验与批次钉住

| 项 | 值 | 证据 |
| :-- | :-- | :-- |
| 锚点 | `3192f02` | `STATE.md:30`「**起点锚点（本任务 diff 与回滚基准）= `3192f02`**」；`git log --oneline -1 3192f02` → `3192f02 docs(pick_friend): 22 卡设计 -- 动线状态机/本地摘要键格式/三张 diff/取代关系/测试计划；STATE 回写待批准`（提交真实存在 ✓） |
| 审查对象（**钉住**） | `3192f02..740bf7b`，9 个提交 | 见 0.2 |
| 全量 diff | 27 files, **+1046 −74**（净 1120 行） | `git diff --stat 3192f02..740bf7b` |
| 代码侧净量 | 11 files, +819 −41（860 行） | `git diff --shortstat 3192f02..740bf7b -- utils/ pages/ chatpick/ app.js tools/selftest.js tools/selftest-wave5.js` |

### 0.2 ⚠️ 时效边界：审查期间 HEAD 前移了三次（同一棵工作树被并行任务写）

- 我开工时 HEAD = `740bf7b`；审查过程中 HEAD 依次变成 `c35d202` → `1c3eec0` → `32d90bd`（**全部是并行任务 C `20260925_v6_align` 的提交**，含 25 卡 `VERIFY.md` 产物）。
- 影响面已实测隔离：`git diff --stat 740bf7b -- utils/ pages/ chatpick/ app.js tools/selftest.js tools/selftest-wave5.js gate.ps1` → **空**（本批代码在钉住点之后一个字节没动）⇒ 本报告所有代码读数对 `3192f02..740bf7b` 有效。
- 前后移的只有：`STATE.md`／`docs/README.md`／`docs/registry/{APIS,COMPONENTS,DATA_DICT}.md`／`tools/check.js`／`docs/lessons/*`／`docs/specs/20260925_v6_align/VERIFY.md`。
- **因此本报告把两个门禁项数都写明**：钉住批次 `740bf7b` 口径 = **33 项**；当前 HEAD `32d90bd`（任务 C 把 `gate.ps1` 纳入骨架/BOM 名单后）= **34 项**。两者都是 0 失败、退出码 0。

### 0.3 提交与文件清单（`git show --name-only` 逐条核过，未只看提交信息）

| 提交 | 归属 | 文件（逐条核过） |
| :-- | :-- | :-- |
| `96d8df8` | pick_friend 批 1 | `utils/chat-tool.js`（`readPairMembers`/`pairKeyOf`）· `chatpick/index.js`·`.wxml`（U-11 仪器）· `utils/reason.js`· `tools/selftest-wave5.js`·`selftest.js`· `docs/registry/{APIS,COMPONENTS}.md`· `app.js`· `STATE.md`· **`gate.ps1`** |
| `86732d3` | pick_friend 批 2 | `utils/chat-tool.js`（`startChatPick`）· `utils/storage.js`（`findCustomerByChatKey`）· `pages/archive-list/index.js/.wxml/.wxss`· `utils/reason.js`· `tools/selftest*.js`· `docs/registry/{APIS,COMPONENTS}.md` |
| `b61fe2d` | pick_friend 批 3 | `utils/storage.js`（`rebindCustomerChatKey`）· `utils/reason.js`· `pages/archive-list/index.js/.wxml/.wxss`（「换绑」）· `tools/selftest.js`· `docs/registry/{APIS,COMPONENTS}.md` |
| `1fc0edc` | Lead 收口 | `docs/specs/20260925_pick_friend/DESIGN.md`（§10 待裁②=已裁 A） |
| `6602d20` | Lead 收口 | `gate.ps1`· `pages/archive-list/index.js`· `STATE.md`· `docs/TECH_DEBT.md`· `DESIGN.md`· 教训卡（非 ASCII 路径） |
| `740bf7b` | Lead 收口 | `pages/archive-list/index.js`（恢复 `chatKey: ''` + 自纠注释）· `CHANGELOG.md`· `docs/TECH_DEBT.md`· `DESIGN.md`· 2 张教训卡 |
| `89c97db` | **并行任务 C** | `docs/{README,RUNBOOK,PRIVACY}.md`· `docs/archive/.gitkeep`· `docs/versions/.gitkeep` |
| `34c69be` | **并行任务 C** | `AGENTS.md` |
| `84686b8` | **并行任务 C（gate 判据）** | `gate.ps1`· 教训卡（同树并行） |

**未触碰（Won't 零代码的正面证据）**：`app.json`、`docs/specs/20260923_chat_pick/*`、`pages/recognize/*`、`pages/pickup-list/*` 在本批 diff 里**一个字节都没有**。

### 0.4 方法（全部实跑，输出见各节）

1. 三条门禁读数（§1 维度⑩/M10）。
2. **5 组副本变异**（§3），每组都先断言"注入点唯一 + 内容确实变了"（教训卡 `2026-09-20_变异脚本静默空跑.md`）。
3. **3 组 stub 运行时复现**（§2 的 R-01/R-02/R-03），办法同 r4：`global.Page/getApp/wx` 打桩后直接驱动 `pages/archive-list/index.js` 与 `chatpick/index.js`。
4. 静态读数：花括号闭合（`data` 的真实行区间）、常量全组合、D3 扫描（日志/URL/`note`/wxml）、函数行数、符号残留、装配链路（wxml handler ↔ JS ↔ 业务）、文档↔实码对帐（错误码/断言条数/class/字段语义）。
5. `gate.ps1 -Anchor 3192f02 -ScopeFiles <并集> -Estimate 600` ⇒ **退出码 2（黄）**：`范围检查：31 个变更文件全部在 ScopeFiles 内` ✓；2 条 WARN（`utils/storage.js = 606 行（锚点 522）`=TD-001 既有欠账；`体量超暂停线：1254 行 > 900`——**含并行任务 C 的文档列对齐与 VERIFY.md**）。
6. 旧报告 P0/P1 核销抽验（§0.5）。

### 0.5 引用报告清单与旧 P0/P1 核销

| 旧报告 | 旧 P0/P1 | 现状（本轮实测） |
| :-- | :-- | :-- |
| `CODE_20260923_chat_pick.md` | P1 1（R-01 一图多码整批存不进） | **已核销**：拦空判据 `parcel-drafts.findRowsWithoutStation` 在位（`grep` 3 处命中） |
| `CODE_20260923_chat_pick_r2.md` | P1 1（R2-D01 M13 零实现 + ✓ 过度声明） | **已核销**：`pages/pickup-list/index.js:103-104` 确有 `wx.navigateTo(... '/pages/recognize/index' + suffix)`；✓ 仍按裁决不恢复（属 25 卡验收） |
| `CODE_20260924_chat_pick.md` | P1 1（R3-01 M14 `nextTick` 无限自调度） | **已核销**：本轮只复核了"闸门/早退体在位"这一点（`pages/recognize/index.js:39,252`），其余采信 r4 报告 §2 的独立复核结论（"真修"）——**我本人未复跑 R3-01 的两组变异** |
| `CODE_20260924_chat_pick_r4.md` | P1 1（R4-01 `runRecognize` 吞掉早退体） | **已核销**：`pages/recognize/index.js:252` = `if (!hasFormContent(this.data.drafts, this.data.draft)) { this.startRecognize(filePath); return; }`（早退体在位） |

**⇒ 旧 P0/P1 未核销数 = 0。** 旧 P2/P3（四份报告合计 90+ 条）：按卡 24「审查范围声明＝仅限本次 diff 及其直接关联调用」**不做逐条复核**，唯一例外是落在本批 diff 内的 **R-17**（`computeSheetScrollHeight` 恒返常数）——本轮复核结论 = **未修，且被本批扩大**（见 R-08）。

### 0.6 范围声明

只审 `3192f02..740bf7b` 的 diff 与其直接关联调用点；diff 之外的代码不审。本卡**只输出报告与建议色，不修改任何代码**，放行由人裁决。

---

## §1 七维度 + 四条件维度逐条结论

### 覆盖地图（✓ 已审 ／ — N/A+原因 ／ ○ 未审+原因）

| 文件 | ①装配 | ②逻辑 | ③牵连 | ④性能 | ⑤冗余 | ⑥规范 | ⑦安全 | ⑧UI | ⑨外部 | ⑩预算 | ⑪隐私 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `utils/chat-tool.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `utils/storage.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `utils/reason.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `pages/archive-list/index.js/.wxml/.wxss` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `chatpick/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `app.js`（内存槽语义） | ✓ | — | ✓ | — | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `tools/selftest.js`·`selftest-wave5.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — |
| `gate.ps1` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — |
| `docs/registry/{APIS,COMPONENTS,DATA_DICT}.md`·`STATE`·`CHANGELOG`·`DESIGN`·教训卡 | ✓ | — | ✓ | — | — | ✓ | — | — | — | — | — |
| **阶段跳过声明** | 无阶段可跳过：阶段 1（数据/后端）＝`utils/*`，阶段 2（前端/接口集成）＝`pages/*`+`chatpick/*`，阶段 3（测试/配置/文档）＝`tools/*`+`gate.ps1`+docs，三段均有 diff 覆盖 |||||||||||

**N/A 理由（逐条）**：⑦对 `tools/*`、docs 无安全面（纯本地静态文件，无网络/无密钥）；⑨对 `utils/storage.js`、`chatpick` 之外的模块无新第三方调用（本项目零依赖、无后端）；⑩无预算文件（`ls docs/**/budget*` 无此物）⇒ 按维度④六类定性判断并标注"**无预算基线**"；⑧只对含 UI 的文件适用。

### 1.1 ① 接入性与装配 —— ✅ 通过（含 UI 三层链路逐层走查）

- **第①层（路由/挂载注册）**：无新页面；`app.json` 的 `pages`=3 页、`tabBar`=2 格、`subPackages[0]`=`chatpick`（`independent/renderer/componentFramework` 四项齐）、`chatTools[0]`=`{root:chatpick, entryPagePath:'index'}`（实读 `app.json`，本批未改）。
- **第②层（入口可达）**：`pages/archive-list/index.wxml:28` `<view class="fab" bindtap="onNewCustomer">＋ 新建</view>`（tab 页右格，点得到）；换绑入口在每行 `index.wxml:22`。
- **第③层（handler 绑定 → 业务链）**：脚本逐条核过 10 个 handler **全部已定义**：`onNewCustomer`(wxml:28)→`startPick`→`chatTool.startChatPick`(index.js:271)；`onRebindKey`(wxml:22)→`storage.rebindCustomerChatKey`(:181)；`onGoDup`/`onForceNew`/`onChatRetry`(wxml:48/49/50) 全在位。
- **新导出全部有生产调用点**（file:line）：`chatTool.readPairMembers` → `pages/archive-list/index.js:113`｜`pairKeyOf` → `:119`｜`startChatPick` → `:271`｜`storage.findCustomerByChatKey` → `:133`｜`rebindCustomerChatKey` → `:181`。
- **错误码闸**：6 个新码**逐个**有产生处 + `reason.js` 文案 + `APIS.md` 登记 + `selftest.js` 的 `CONTRACT_CODES`（§6 有表）。
- ⚠️ 本维度唯一扣分在**运行期**：R-01/R-02 都能让"入口可达"在特定条件下变成"点了没反应"，但那属维度②/⑤的缺陷，装配链本身是通的。

### 1.2 ② 逻辑性 —— ✗ 不通过（R-01、R-02）

逐函数过：`readPairMembers`（空/null/非数组/个数≠2/空串/去空白，六路全有出口）✓｜`pairKeyOf`（形态闸复用 + 分隔符 `\u0000` 防 `"ab"+"c"` 拼接歧义）✓｜`startChatPick`（无接口 / url 空 / 成功 / 取消 / 拒绝 / 抛错 / 超时，七路）✓｜`findCustomerByChatKey`（空键与非字符串不是错误、软删排除、只读不写盘）✓｜`rebindCustomerChatKey`（不存在含软删 `NOT_FOUND`、冲突两边不改、幂等早退不写盘、`''` 解绑、形态闸复用 `migrate.isChatRoomId`）✓，写盘是"整键覆盖"，`next` 是 `cloneStore` 的副本 ⇒ **没有半完成状态**（单键写、无跨表事务需求）。
**不通过点**：① 页面实例字段 `chatKey` 的生命周期没有收口（R-01）；② 新拉起链路在生产路径上没有看门狗 + `picking` 重入闸没有兜底复位（R-02）。另：多步写操作的幂等——`rebindCustomerChatKey` 自己重绑自己不写盘 ✓；`createCustomer` 重复提交由 `data.saving` 挡 ✓（`:431`）。

### 1.3 ③ 牵连性 —— ⚠️ 基本通过，一处文档回写缺失

- `grep` 全仓：新符号零冲突，`readPairKey`（SCOPE 里的旧命名）/`applyPickFlow`/`pick-flow` **零残留**（本批没建 `pages/archive-list/pick-flow.js`，DESIGN §1 把状态机留在页面内）。
- 被修改符号的既有调用方：`chat-tool.failureReasonOf` 抽了 `isCancel` 出来（行为等价，selftest 两条断言仍绿）；`consumePickup` 拆成 `applySessionKey`/`applyLegacyRoomId`（`onShow` 调用点未变）；`computeSheetScrollHeight` 加第 4 参（**调用方 3 处全跟上了**，但新参数无效，见 R-08）；`createCustomer` 契约未变（`chatRoomId` 仍走同一条落库路径）✓。
- 被删符号：无。`6602d20` 曾把 `chatKey: ''` 这条**实例字段声明**当"`data` 里的死字段"删掉（误判），`740bf7b` 已恢复并在原位写了自纠注释；我按花括号闭合独立复核：`data` 块 = `index.js:53~73`，`chatKey` 在第 **81** 行 ⇒ **不在 `data` 里** ✓，教训卡《grep 行号不等于代码结构》的结论成立。
- **四份文档同步核对**：`APIS.md` ✓（新增 4 行 + 错误码 3 行）、`COMPONENTS.md` ✓（新增/改写 6 行）、`CHANGELOG.md` ✓、**`DATA_DICT.md` ✗**（见 R-05）。

### 1.4 ④ 性能 —— ✅ 通过（无预算基线）

本批新增的都是**单键读 + 单键写**：`findCustomerByChatKey` 一次 `loadStore`（O(N) 过滤，N＝客户数，与既有 `listCustomers` 同量级）；`rebindCustomerChatKey` 一次读 + 一次整键写（**沿用既有唯一写盘口**，没造第二个）；`onRebindKey` 用 `this.data.customers` 过滤，**没有**额外读盘；`startPick` 每次点击只发一次平台调用（`picking` 挡连点）；无循环内 IO、无无界查询、无请求路径同步长任务。资源：`chatpick` 的两个 8 秒看门狗在两路回调里都 `clearTimeout` ✓；本批**没有**新增 `wx.on*` 订阅、定时器或全局监听（唯一"永不结算"的 Promise 属 R-02）。⚠️ **无预算基线**（项目无 P95/包体积文件）⇒ 只作定性判断。

### 1.5 ⑤ 冗余死代码 —— ✗ 不通过（R-03、R-08）

- `applyLegacyRoomId`（`index.js:214~248`，35 行）在**生产路径上不可达**：分包页 `writePickup` 构造的包**恒有 `members` 键**（`chatpick/index.js:211,218` 的 base 模板含 `members: null`），而 `consumePickup` 的分支条件是 `packet.members !== undefined`（`:102`）⇒ 永远走键路。运行时复现已确认（§2 R-03）。连带：`this.chatRoomId`（`:77`）在生产上恒为 `''`，`index.js:489` 的 `|| this.chatRoomId` 也是死分支。
- `computeSheetScrollHeight` 的第 4 参 `hasDup` 与常量 `SHEET_DUP_RPX = 210` 是**死代码**：`300 + 116×3 = 648 > 620` ⇒ 16 种参数组合实测**只有 `620rpx` 一个返回值**（§2 静态读数）。这是旧报告 **R-17** 的第二个实例（R-17 未修）。旁边 wxss 注释"不给高度就会被裁掉"因此是**误导性注释**。
- 永远为真/假的分支：`if (this.data.saving)` 在同步写盘下仍近似恒假（r1 的 R-18 同族，**不在本批 diff**，不重复计）。

### 1.6 ⑥ 开发规范 —— ⚠️ 基本通过（3 处 P3）

对照宪法 §11 六条：**结构**——`utils/chat-tool.js` 394 非空行 ✓、`pages/archive-list/index.js` 486 ✓、`chatpick/index.js` 249 ✓、`tools/selftest.js` 827（测试豁免 ≤1000）✓、`tools/selftest-wave5.js` 375 ✓；**`utils/storage.js` 606 非空行 > 500**（既有欠账 TD-001，本批 +84 行，gate.ps1 判黄而非红——判据本身口径正确）；函数 >50 行两处：**新增** `startChatPick` 53 行、**被本批加长的** `onSheetSave` 76 行（锚点版 69 行）→ R-11。**命名**——业务术语单源（`会话键`/`chatKey`/`pairKeyOf`/`rebindCustomerChatKey` 前后一致），无 `data/info/handle` 类空泛名（`info`/`payload` 是既有的平台原样返回字段名，属平台术语）；本项目是 JS 无类型系统，"入参出参类型契约"以 JSDoc 形式给出（新函数四条都有 `@param/@returns`）✓。**注释 Why**——本批注释质量高于项目均值（每条几乎都挂了官方口径/教训卡/TD 编号），但有两处注释与实码不符（R-08 的"88rpx 触摸盒口径"、R-08 的"不给高度就会被裁掉"）→ 计入 R-08/R-09。**防御**——外部调用全有分支，`startChatPick` 有 try/catch 且不留空 catch ✓；`chatpick.applyChrome` 的空 catch 是**上一批**的（注释写明"读不到只影响观感"，不在本批 diff）。**可测试**——纯函数（`readPairMembers`/`pairKeyOf`/`digest16`）与副作用分层清楚 ✓。**环境**——无硬编码路径/URL/端口/密钥 ✓（唯一的字面量 `CHAT_TOOL_ENTRY='index'` 有"必须与另两处同值"的注释与 TD-014 留痕）。提交信息格式 ✓（`feat(pick_friend): 批N -- …`）。

### 1.7 ⑦ 安全 —— ✅ 通过（本机应用，无网络面）

新"接口"全是本机模块函数，无鉴权概念（`APIS.md` 逐行标"无（本机）"）；无 SQL（无数据库）、无上传、无 CORS、无 CSRF 面（无网络写操作）、无新依赖（⇒ `npm audit` N/A：本项目零依赖、无 lockfile，`gate.ps1` 判"依赖无变化" ✓）；无密钥/路径穿越面。XSS 等价物 = **wxml 注入**：本批所有上屏字符串只由「人话锚（楼栋/宿舍/称呼）+ `chatTool.fingerprint()` 输出」拼成，**没有**把平台原文直接塞进 `setData`（`chatpick` 侧只出"取到几个"计数，`pages/archive-list` 侧只出 `reason=` 码名）✓。

### 1.8 ⑧ UI 可访问性 —— ⚠️ 一处 P3（R-09）

四态齐全 ✓（选择中：`picking` → toast；已绑定：`chatState` 状态行 + 指纹；未取到：`reasonText` 降级文案 +「重新选择聊天好友」；平台无此能力：`CHAT_OPEN_FAILED` 同一条降级路）。空态/错误态 ✓（`sheet-error`、`sheet-dup` 与 `.error` 分色，`#1a1a1a` on `#eef3ff` 对比度 ≈15:1）。触摸目标：**三个新按钮 `.sheet-chat-retry` 实测高 ≈62rpx（≈31px）< 88rpx 基线**，且代码注释声称"与站点头同一条 88rpx 触摸盒口径"（与实际不符）→ R-09。

### 1.9 ⑨ 外部调用 —— ✅ 通过（含 R-02 的边界说明）

本批新触达的外部接口只有一个：`wx.openChatTool`（`utils/chat-tool.js:150`，经 `startChatPick` 封装、依赖注入 `wxApi/url/setTimeout/clearTimeout/timeoutMs`）。适配层 ✓（只有 `utils/` 碰 `wx.*`，`check.js` 第 6 条守着）；显式超时——**代码写了，但生产路径没武装**（`typeof injected.setTimeout === 'function'` 不成立 ⇒ `timer = null`），这就是 R-02；降级 ✓（失败/取消/无接口一律回手填，M6 不阻断）；Webhook 验签/幂等 **N/A**（无 webhook）。分包页的 `wx.selectGroupMembers` 自己带真实 `setTimeout` 看门狗（`chatpick/index.js:179`）✓。

### 1.10 ⑩ 性能预算 —— — N/A + 原因

**项目无预算文件**（无 P95/包体积/查询耗时基线）⇒ 按维度④六类定性判断，结论见 1.4，并标注"**无预算基线**"。

### 1.11 ⑪ 数据隐私（D3）—— ✅ 通过（**逐条按花括号闭合复核**）

见 §2 的 D3 专项（5 条判据全绿），本节结论：**键与平台 id 都没有新的泄露通道**；但**登记侧漏了一个新 D3 载体**（R-04）。

---

## §2 发现清单（编号／级别／现状／证据／建议修法）

> P0/P1 均**可复现**：R-01/R-02 的复现脚本是 `%TEMP%\pf_review\pf_harness.js`（stub `Page/getApp/wx` 直接驱动页面，真实树只读），输出见下。

### 🔴 R-01 ｜ **P1** ｜ 换绑（成功后或冲突后）残留的 `this.chatKey` 会被下一次"降级建档"写进**第二条**档案 ⇒ 库里两条同键档案

- **位置**：`pages/archive-list/index.js:125`（`this.chatKey = folded.key`）＋ `:178~210`（`applyRebind` 三个出口都不清 `chatKey`）＋ `:286~295`（`onNewCustomer` 降级回调只 setData 就开浮层）＋ `:489`（`chatRoomId: this.chatKey || this.chatRoomId || ''`）。
- **现状**：`chatKey` 只在 `clearChatBinding()`（保存成功）与 `onForceNew()` 里被清。**"换绑"这条写路径的三种结局（成功 / 冲突 / 其他失败）都不清键**；而"点＋新建 → 平台不可用或用户取消"这条降级路会原样打开建档浮层，保存时把残留键写进新档案。
- **影响（触发条件）**：换绑一次（成功或冲突）→ 再点「＋ 新建」→ 会话选择被取消/不可用 → 手填保存。后果：①**"一个键最多一条档案"这条不变量被打破**（`DESIGN §10` 明确把它当 M5 的判据基座："否则 `findCustomerByChatKey` 会多命中、归类当场二义"）；②屏上文案同时写着"这次不带会话键"，**用户被误导**；③`CHANGELOG.md` 的 pick_friend 条目把这句当事实写着（"新建那条**不带键**"）。
- **可复现证据（运行时，真实树只读）**：
  ```
  ★残留 chatKey = 9f0cf41a9d61023e   （REBIND_CONFLICT 之后）
  ③ 降级：sheetOpen = true ｜ 屏上文案 = "你取消了选择好友 —— 手填一样能建档，只是这次不带会话键。（下面手填一样能建）"
  ④ 保存后：库里持有同一把会话键的档案数 = 2 → 甲 / 小王
     findCustomerByChatKey(keyA) 命中 = 甲
  ```
  （与 `chatTool.pairKeyOf(['midA1','midA2']).key` 同源；甲先持键、乙无键，给乙换绑到甲那条会话 ⇒ 冲突 ⇒ 再降级建档。）
- **建议修法**（任选其一，推荐 ②）：
  ① 最省：在 `applyRebind` 的所有出口、`sessionKeyFailed` 的换绑分支、`onGoDup`、`onCloseSheet` 里一律 `this.chatKey = ''`（等于把"键的存活期 = 一次成功保存"写死）。
  ② 更稳（治根）：把键的**消费点**收成一个"一次性令牌"——`applySessionKey` 只写 `this.pendingKey`，`onSheetSave` 读后立刻清空；`onNewCustomer` 的降级回调显式 `this.pendingKey = ''`，让"降级建档"这条路**结构上拿不到键**。
  ③ 加钉：`onSheetSave` 落库前再查一次 `findCustomerByChatKey(key)`，命中就改走挡板（纵深防御，但会掩盖①的病根，只作补充）。

### 🔴 R-02 ｜ **P1** ｜ `startChatPick` 的看门狗在生产路径上没有武装 + `picking` 重入闸无兜底复位 ⇒ 平台一旦不回调，「＋ 新建」这条**唯一建档入口**永久失效

- **位置**：`utils/chat-tool.js:141~148`（`timer = typeof injected.setTimeout === 'function' ? … : null`）＋ `pages/archive-list/index.js:263~283`（`startPick`：只传 `{url}`，不注入 `setTimeout`；`this.picking` 只在 `task.then` 里复位）＋ `:264~267`（重入时只弹 toast 就 `return`）。
- **现状**：`bind`/`readRoomId`/`startChatPick` 三个函数**同一条写法**：只有调用方注入 `setTimeout` 才武装看门狗。生产调用点 `startPick` 没注入 ⇒ **运行时没有任何超时**。`picking` 又只在 Promise 结算时复位，而 tab 页实例常驻（`switchTab` 不销毁页面）⇒ 卡住就是"本会话内永久"。
- **影响（触发条件）**：`wx.openChatTool` 既不 success 也不 fail（**本仓自己的注释说这种挂死读数出现过**：`utils/chat-tool.js:26-27`「接口在个别版本上出现过"既不 success 也不 fail"的挂死读数（v1 冒烟件同口径的担心）。没有超时 = 页面永久停在"绑定中"，用户只能杀进程」）。后果：`fab` 与行内「换绑」**全部**变成"点一下弹一句 toast"，建档浮层永远打不开 ⇒ 手动建档这条唯一入口失效（`COMPONENTS.md` 明写 `fab` 是"手动建档的**唯一**入口"）；且**没有任何屏幕文案解释**为什么点了不动。
- **可复现证据（运行时，真实树只读）**：
  ```
  ① 点「＋ 新建」后：picking = true ｜ 本次调用期间注册的定时器数 = 0
     （0 = startChatPick 的看门狗在生产路径上根本没被武装起来）
  ② 再点两下：sheetOpen = false ｜ picking = true ｜ 新增 toast = 正在拉起好友列表… / 正在拉起好友列表…
  ```
- **诚实边界**：我复现的是**代码路径**（0 定时器、`picking` 永久 true），**不是**平台真的挂死（那需要真机）。若裁决认为"平台不回调"这一前提太弱，本条的降级级别 = **P2**；但**修法不变且很便宜**。
- **建议修法**：`startPick` 里显式注入 `setTimeout/clearTimeout`（`chatTool.startChatPick({ url: CHAT_TOOL_ENTRY, setTimeout, clearTimeout })`）；`onShow`/`onHide` 里把 `this.picking = false` 兜底；重入分支改成"提示 + 允许重试"（而不是静默 `return`）。

### 🟡 R-03 ｜ P2 ｜ N2 老路 `applyLegacyRoomId`（含 U-5 的屏上取证读数行）在生产路径上不可达

- **位置**：`pages/archive-list/index.js:102`（`if (packet.members !== undefined)`）＋ `chatpick/index.js:211,218`（`writePickup` 的 base 模板与构造**恒含** `members`）。
- **现状/影响**：分包页 `read()` 完成后必然调 `readPair()`，`readPair` 必然 `writePickup`，而 `writePickup` 产出的包**永远带 `members` 键**（最差是 `null`）⇒ 分支条件恒真 ⇒ 老路 35 行代码 + 它的 `chatEvidence`（`返回字段=`/`原文=`/`模式读数`）**在生产上永不出现**。两个后果：① 死代码；② `COMPONENTS.md`/`APIS.md` 把 `readThreeStates` 登记为"**生产入口**"、把 U-5 的判读押在这一行上，而这一行**永远不会上屏**——25 卡做 U-5 真机取证时，照登记表找那行会找不到。
- **可复现证据（运行时，真实树只读）**：
  ```
  ① 分包页写进内存桥的包 = {"at":…,"info":null,"infoErr":"…","bindErr":"","members":null,"membersErr":"…"}
     'members' in packet = true ｜ packet.members = null
  ② chatState = "这个会话没给到可用的成员标识…（不影响建档）" ｜ chatEvidence = "reason=CHAT_MEMBERS_FAILED"
  ```
- **建议修法**：把判据从"键存不存在"改成"值是不是数组"（`if (Array.isArray(packet.members))`）——这样"分包页没拿到成员标识、但拿到了 `getChatToolInfo` 的返回"时才回落到老路；或在 `writePickup` 里只在真有值时写 `members` 键。并在 `APIS`/`COMPONENTS` 的对应行标注"哪条路在什么条件下可达"。

### 🟡 R-04 ｜ P2 ｜ `APIS.md` 的 **K5 行**（D3 卫生登记行）没跟上新载体：内存槽形状仍是 4 个字段

- **位置**：`docs/registry/APIS.md` 的 K5 行（`grep -n '^| K5 '`）写的是 `` `app.globalData.chatToolPickup`（`{at, info, infoErr, bindErr}`…） `` ；实码 `app.js:20` 的注释写的是 `{ at, info, infoErr, bindErr, members, membersErr }`。
- **影响**：`members` 是**平台原样 id 数组**（D3，与 `info` 同级）。K5 行是"审计 D3 通道"的第一入口，它现在既漏了字段、也漏了"该槽还存在第二种 D3 载体"这条事实 ⇒ 下一个审 D3 的人照登记行看会漏。
- **建议修法**：K5 行补 `members`/`membersErr` 与"消费一次即清、上屏只出个数/指纹"的口径（`COMPONENTS.md` 与 `app.js` 已写对，照抄同一句即可）。

### 🟡 R-05 ｜ P2 ｜ `DATA_DICT.md` 的 `Customer.chatRoomId` 行没有回写"本地摘要键"语义（SCOPE M9 未全履）

- **位置**：`docs/registry/DATA_DICT.md:27`。该行仍写"平台会话标识"口径（"不匹配 ⇒ 写入侧**丢弃该值 + `ROOM_ID_DISCARDED`**"），**没有** `摘要/会话键/16 位` 任何字样（脚本实测）。
- **影响**：`DESIGN §2` 明确把这行标为**"语义变更：平台原值 → 本地摘要键"**，`SCOPE M9` 明确要求回写 `DATA_DICT.md`（键字段语义）。更具体的是：`docs/PRIVACY.md` 第 3 行自称"事实源：`docs/registry/DATA_DICT.md`"，而**事实源那一行与实码相反**（现写的是"库里可能存平台原值"）。旁证：`docs/README.md:22` 与 `docs/PRIVACY.md:15` 都已经写对了摘要语义 ⇒ 这是**单源分裂**，不是无人知道。
- **建议修法**：改 `DATA_DICT.md:27` 的说明列为"库中存**本地摘要键**（16 位小写 hex，不可逆）；形态闸 `migrate.isChatRoomId` 未变；平台原值只在内存桥里、消费一次即清"，并在"备注"列保留 D3 标记。

### 🟡 R-06 ｜ P2 ｜ 写入口 `rebindCustomerChatKey(id, key)` 把**非字符串**（含 `undefined`）静默当成 `''` = **解绑**

- **位置**：`utils/storage.js` 的 `const nextKey = typeof key === 'string' ? key.trim() : '';`。
- **影响**：一个"写"入口把"调用方传错参数类型"解释成"**解绑**"（= 抹掉绑定），且返回值是 `ok:true` ⇒ 静默成功。`APIS.md` 只登记了"`''` = 解绑"，没登记 `undefined/null/数字` 也走解绑。当前**唯一调用方**（`index.js:181`）总是传 `pairKeyOf` 产出的非空 hex ⇒ 尚未触发；一旦将来有人写成 `rebindCustomerChatKey(id, result.key)` 而 `result.ok === false`，就会**静默解绑**。
- **建议修法**：非字符串 ⇒ `VALIDATION_FAILED`（或 `BAD_KEY`）；只有显式 `''` 才解绑。断言里补一条 `rebindCustomerChatKey(id, undefined).reason !== undefined` 的钉。

### 🟡 R-07 ｜ P3 ｜ `FIELD_LABELS.chatRoomId` 的文案回写未执行（DESIGN §3 点名项）

- **位置**：`utils/reason.js:100` 仍是 `chatRoomId: '聊天会话标识'`；`DESIGN §3` 末行明写："**文案回写**：`utils/reason.js:90` 的 `chatRoomId: '聊天会话标识'` 改为指'会话键（本地摘要）'口径。"三个批都没做。
- **触发时的表现**：`rebindCustomerChatKey` 报 `VALIDATION_FAILED` → `failureText` 走 `CODE_SHAPE` → 屏上出现"客户档案的「聊天会话标识」这一项没填对……**请改这一项后重试**"——而这一项**用户根本没法改**（键来自平台摘要）。
- **建议修法**：改成 `'会话键'`（或"会话标识"）；若要连带修"请改这一项"，就在 `dynamicReasonText` 里给 `chatRoomId` 一条专用句。

### 🟡 R-08 ｜ P3 ｜ `SHEET_DUP_RPX` 与新参数 `hasDup` 是死代码（旧报告 **R-17 未修且被本批扩大**）

- **位置**：`pages/archive-list/index.js:43`（`SHEET_DUP_RPX = 210`）、`:45~50`（`computeSheetScrollHeight(hasError, hasAutoHint, hasChat, hasDup)`）、`:360~365`（`syncSheetHeight` 传 4 个实参）。
- **证据**：`SHEET_BASE_RPX 300 + SHEET_FIELD_RPX 116×3 = 648 > SHEET_MAX_RPX 620` ⇒ 16 种参数组合实测**只有一个返回值 `620rpx`**（`pf_static.js` 输出：`16 种 … 组合的实际返回值集合 = 620rpx ⇒ ★恒为常数`）。⇒ 本批新增的第 4 参恒定无效、旁边"不给高度就会被裁掉"的注释与事实相反。
- **旧问题核销**：**R-17（r1 报告）状态 = 未修**（本轮复核），且本批**在同一函数上又加了一个死参数**（旧编号 R-17 沿用，不新开号；本条记为新实例）。
- **建议修法**：要么把 `SHEET_MAX_RPX` 与各项常数重算到"真的会随参数变"（并补一条纯函数断言，这是它第一次可自测的机会），要么删掉参数与常量、把"可滚区高度固定"写成事实 + 挂 TD-001 类欠账。⛔ 不建议只删注释。

### 🟡 R-09 ｜ P3 ｜ 三个新按钮 `.sheet-chat-retry` 的触摸目标 ≈62rpx < 88rpx，且注释声称达标

- **位置**：`pages/archive-list/index.wxss`（`.sheet-chat-retry`：`padding:12rpx 20rpx; font-size:24rpx; line-height:1.4`）＋ 紧邻注释"…内边距 ≥ 40rpx 的可点面积，手指点得准（与站点头同一条 **88rpx** 触摸盒口径的来源）"。
- **证据**：`12×2（padding）+ 2×2（border）+ 24×1.4 ≈ 62rpx ≈ 31px` < 88rpx（44px）基线。三个新按钮（「去这条档案」「仍要新建」「重新选择聊天好友」）**正是 M5 挡板的人机出口**，点不准会直接影响 V4 的现场体验。同族先例：r1 的 **R-20**（同样判 P3）。
- **建议修法**：`padding` 提到 `22rpx 24rpx`（≈ 88rpx）或给一个 `min-height: 88rpx; display:inline-flex; align-items:center`；顺手把注释改成实测数。

### 🟡 R-10 ｜ P3 ｜ 行数两把尺子：gate.ps1 数**非空行**，TD-001 登记的取数命令数**总行 +1**

- **证据**：探针文件（4 行、含 1 空行）：`Get-Content | Measure-Object -Line` = **3**；`node -e "…split('\n').length"` = **5**；`Where-Object { $_.Trim() -ne '' }` = 3（与前者一致）⇒ `gate.ps1` 第④条判据实际用的是**非空行**。对 `utils/storage.js`：非空 **606**（＝`DESIGN §10` 与 `TD-001` 写的数）／总行 **658**／登记命令 **659**。
- **影响**：`TD-001` 同一行里既写着 606、又给出会算出 659 的取数命令 ⇒ 下一个照命令复算的人会认为"账不对"。**结论不受影响**（两把尺子都 > 500）。
- **建议修法**：`TD-001` 的取数命令换成与判据同一把尺子（`(Get-Content -Encoding UTF8 | Where-Object { $_.Trim() -ne '' }).Count`），或在 `gate.ps1`/`AGENTS §11.1` 里写明"行数 = 非空行"。

### 🟡 R-11 ｜ P3 ｜ 两个函数 >50 行未挂账（其一为本批新增）

- **证据**（机械扫描）：`utils/chat-tool.js` `startChatPick` = **53 行**（116~168，**本批新增**）；`pages/archive-list/index.js` `onSheetSave` = **76 行**（430~505；锚点版 69 行 ⇒ 本批 +7）。对照 AGENTS §11.1「函数 ≤50 行」。同族先例：r1 的 **R-25**（同为 P3，且 TD-001 只记文件行数、不记函数行数）。
- **建议修法**：`startChatPick` 把"看门狗武装 + 三路 finish"抽成一个内部小函数（顺带把 R-02 的注入问题一起解决）；`onSheetSave` 的"会话键决议"抽成 `resolveChatKeyForSave()`（也正好是 R-01 的治根点）。

### 🟡 R-12 ｜ P3 ｜ 体量黄没有记账：暂停线判在哪个分母上不唯一，STATE/CHANGELOG 都没写这条黄

- **证据**：`gate.ps1 -Anchor 3192f02 -Estimate 600` ⇒ `[WARN] 体量超暂停线：1254 行 > 900`（**含并行任务 C 的 registry 补列与 VERIFY.md**）。按钉住批次拆开算：净 diff `3192f02..740bf7b` = **1120 行**（27 文件，含任务 C 的 179 行）；**代码侧净 860 行**（<900）；逐提交累加 = 1202 行（含 `6602d20` 删 `chatKey` / `740bf7b` 加回的 churn = 71 行）。
- **影响**：SCOPE §9 写的是"≈600 行 ⇒ ×1.5 = 900 行，**碰到即停**"。按"含文档的净 diff"读 = 已碰线；按"代码侧净"读 = 没碰。**两个读法都在场，文档里一个都没记** ⇒ 下一个审查者无法判断这条黄算不算已知。
- **建议修法**：在 `STATE.md` 的 pick_friend 进度行补一句"体量：代码侧净 860 / 全批净 1120（取数命令给出），暂停线口径 = 代码侧"，把分母写死。

---

## §3 变异复测读数表（副本内做，真实树零改动）

副本配方：`robocopy <真实树> <副本> /E /XD .git`（含未提交状态；`.gitignore` 等点文件一并复制 —— r4 教训卡点名的坑已避开）。每组都先打印**注入点命中次数**与**注入前后字节数**（教训卡 `2026-09-20_变异脚本静默空跑.md`）。基线的 `selftest` = **337 条 / 0 失败 / exit 0**。

| 注入 | 注入点 | 是否生效 | 期望 | 实际 | 结论 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **M1** `utils/chat-tool.js`：去掉无序对的排序（`read.members.slice().sort()` → `slice()`） | 唯一（1 次） | ✓ 14533→14526 字节 | 红 | **红**：`[FAIL] 无序对：交换顺序 ⇒ 同一个键 … 期望 "78de35a10e586ed5"，实际 "64e6dc95575078d5"`；337/336/1，exit 1 | **判据有牙**（DESIGN §7 说这条性质"必须钉住"，钉住了） |
| **M2** `utils/storage.js`：重锚冲突判定 `if (holder)` → `if (false)` | 唯一（1 次） | ✓ 25641→25640 字节 | 红 | **红**：4 条直接失败（`REBIND_CONFLICT` 实得 `undefined`、holder 摘要、**两边都没被改** 实测被改成 `KEY_R1|KEY_R1`、软删档案也占键）＋第 5 条 `TypeError: Cannot read properties of undefined (reading 'deleted')` ⇒ **崩在中段**，`只跑到 195 条，预期 337 条`，exit 1 | **判据有牙且带"跑不满即红"的计数闸**（这条闸是 r2 的 R2-C04 留下的，本轮实测它真的兜住了崩溃） |
| **M3** `pages/archive-list/index.js`：查重挡板 `if (this.data.sheetDupText)` → `if (false)` | 唯一（1 次） | ✓ 18746→18729 字节 | 红（设计期望） | **仍绿**：`断言 337 条：通过 337，失败 0`，exit 0；同一副本 `node tools/check.js` = `通过 34 项；失败 0`，exit 0 | **判据没牙（不是注入点选错）**：`selftest` 根本不 `require` 页面 ⇒ 页面方法里的分支无人看。这正是 **TD-016** 已登记的缺口（= TD-014 ① 的第二个实例），**按任务书要求不作为新发现**，只作为"页面层为什么必须靠 r 轮复核"的实证 |
| **M4** `utils/storage.js`：查重去掉软删过滤（`&& !item.deletedAt` → 去掉） | 唯一（1 次） | ✓ 25641→25622 字节 | 红 | **红**：`[FAIL] 软删档案不参与查重（删掉的人还建得回来） 期望 null，实际 {"id":…,"chatRoomId":"78de35a10e586ed5"…}`；337/336/1，exit 1 | **判据有牙** |
| **M5** `utils/chat-tool.js`：`startChatPick` 的取消分类（`isCancel(errMsg) ? 'CHAT_OPEN_CANCELLED' : …` → 恒 `CHAT_OPEN_FAILED`） | 唯一（1 次） | ✓ 14533→14490 字节 | 红 | **红**：`[FAIL] 用户在会话列表里取消 ⇒ CHAT_OPEN_CANCELLED … 期望 "CHAT_OPEN_CANCELLED"，实际 "CHAT_OPEN_FAILED"`；337/336/1，exit 1 | **判据有牙** |

**逐条如实交代**：5 组里 **4 组判红、1 组仍绿**；仍绿的那组已判定为"**判据没牙**"（页面层零断言，已由 TD-016 立卡），**不是**"注入点选错"（注入点唯一、字节数确实变了、且同一副本的 `check.js` 也照样全绿 ⇒ 两道门禁同时看不见）。⚠️ 另需交代：我**没有**复跑 DESIGN §7 预写的三条变异（M2"改散列常数"、M3"关掉查重"），M3 用 M2/M4 从两侧覆盖了同一族，M1 覆盖了 M1（方向相反但性质同一）；"改散列常数"未跑 = **未验**。

---

## §4 越界与"顺手改"核查

### 4.1 范围门禁读数

`powershell -File gate.ps1 -Anchor 3192f02 -ScopeFiles <并集 21 项> -Estimate 600` ⇒ **`[OK] 范围检查：31 个变更文件全部在 ScopeFiles 内`，退出码 2（黄）**，两条黄 = `storage.js = 606 行（锚点 522）`（TD-001 既有欠账，判据按 84686b8 的新口径只对本批越线判红 ⇒ 行为正确）+ `体量超暂停线 1254 行`（见 R-12）。

### 4.2 逐文件核 SCOPE（Must/Won't）

- **Must 落点 vs 实际触碰**：M1~M7 的落点文件全部被触碰（`pages/archive-list/*`、`utils/chat-tool.js`、`chatpick/*`、`app.js`、`utils/storage.js`、`utils/reason.js`、`tools/selftest*.js`、`APIS/COMPONENTS`）✓；M9 要求的三份 registry 里 **`DATA_DICT.md` 没动**（R-05）。
- **SCOPE 从未讨论的文件**：本批 9 个提交里，pick_friend 自身提交**没有**触碰 SCOPE 外的业务文件；**唯一例外 = `gate.ps1`**（`96d8df8`/`6602d20`/`84686b8` 三处）。它是**并行任务 C** 的产物（v6_align 批 1 新建），改动内容 = 门禁自身的读数缺陷修复：体量漏未提交改动、`core.quotepath=false`（两处）、行数判据只对本批越线判红。
- **Won't 七条零代码的正面证据**：W1 群语义——`readPairMembers` 对 `length !== 2` 直接出 `CHAT_NOT_SINGLE_CHAT`，没有任何群分支 ✓；W2 加密通道——本批没有解密尝试（老路只读三态）✓；W3 无自动合并（冲突一律拒绝 + `holder` 指人）✓；**W4 `chatTools` 四项渲染栈配置——`app.json` 在本批 diff 里零改动** ✓；W5 `chat_pick` 的验收清单零改动（本批 diff 无 `docs/specs/20260923_chat_pick/*`）✓；W6 旧入口保留（`chatpick` 页与老路都留着）✓；W7 不动三页布局（wxss 只追加）✓。

### 4.3 处置建议

| 项 | 判定 | 建议 |
| :-- | :-- | :-- |
| `gate.ps1` 的三处语义改动随 pick_friend 提交进来 | **轻度越界（AGENTS §2.4「禁顺手重构」的字面命中）**，但属"修工具自身的读数缺陷"、且提交信息与 STATE 都已公示 | ⛔ **不建议 revert**（它们是判据正确性修复，revert 会让体量/范围读数退回"假绿/假红"）。建议：**登记到任务 C 的台账**（或下次拆独立提交），并在 `STATE.md` 的 v6_align 进度里点明"三处 gate 修复是由 pick_friend 的提交带进来的" |
| 其余 8 个提交 | 未越界 | — |

---

## §5 与 spec 的偏离（DESIGN §10 逐条是否被真实落实）

| DESIGN §10 的条目 | 落实判定 | 证据 |
| :-- | :-- | :-- |
| **实现期口径①**「点『仍要新建』时新档案不带键」 | ✅ **在这一条路上落实**（但 R-01 从别的路破了同一不变量） | `index.js:322~331` `onForceNew` 显式 `this.chatKey = ''`；selftest 无页面断言 ⇒ 靠读码 |
| **待裁② = A（`chatRoomId` 双语义共存）** | ✅ 落实 | `index.js:489` `chatRoomId: this.chatKey \|\| this.chatRoomId \|\| ''`；`STATE.md:36` 记用户原文；`docs/README.md:22`、`docs/PRIVACY.md:15` 同口径 |
| **批 3 口径 1**「软删档案也算键持有者」 | ✅ 落实 | `utils/storage.js` 冲突 filter 无 `deletedAt` 条件；M2 变异体里"软删档案也占着键"那条断言**判红**（说明该性质被钉住） |
| **批 3 口径 2**「幂等优先于冲突（自己持有 ⇒ `unchanged` 早退，不写盘）」 | ✅ 落实 | `if (current.chatRoomId === nextKey) return okOf({customer, unchanged:true})` 在冲突查询之前；selftest 断言 `updatedAt` 一个字没动 |
| **批 3 口径 3**「`APIS.md §2.3` 接回一张连续表（实测 12 行、唯一空行在表后）」 | ✅ 落实 | 实测：`§2.3` = 第 57~71 行，数据行 **12** 行，表内 **0** 空行，唯一空行在第 **72** 行（表后、下一节前） |
| **批 3 口径 4**「`storage.js` 不在批 4 拆（增量 541 → 606 记 TD-001）」 | ✅ 落实 | `TD-001` 行有 2026-09-25 增量段（522→541→606）；`gate.ps1` 判 `[WARN] storage.js = 606 行（锚点 522）` ⇒ 口径与判据一致（但见 R-10 的尺子问题） |
| **DESIGN §3 的「文案回写：`reason.js` 的 `chatRoomId` 改指会话键口径」** | ❌ **未落实** | `utils/reason.js:100` 仍是 `'聊天会话标识'` ⇒ **R-07** |
| **DESIGN §2 的「`Customer.chatRoomId` 语义变更」随批回写 `DATA_DICT`** | ❌ **未落实** | `docs/registry/DATA_DICT.md:27` 无摘要语义 ⇒ **R-05** |
| **M2 落点符号名 `readPairKey`** | ⚠️ 命名偏离（可接受） | 实码拆成 `readPairMembers`（形态闸）+ `pairKeyOf`（折键）；`DESIGN §3`/`APIS.md` 已按实码登记 ⇒ 属细化，但 `SCOPE.md` 未订正 |
| **「页面层零断言 = TD-016」类已知缺口** | ✅ 已立卡，**不重复报为新发现** | `docs/TECH_DEBT.md` 的 TD-016 行；本轮 M3 复测把它的读数从"318/318"更新为 **337/337**（同一条结论） |
| **V1~V8 验收** | ⛔ **全部未验**（见 §7 诚实边界） | 无真机读数 |

---

## §6 文档侧核对（APIS / COMPONENTS / STATE / CHANGELOG / DATA_DICT / 教训卡）

1. **`APIS.md` 新增行与实码一致**：`readPairMembers`/`pairKeyOf`/`startChatPick`/`findCustomerByChatKey`/`rebindCustomerChatKey` 五个签名、入参、出参、失败码逐条对过 `grep` 与实码 ✓。点名的断言条数可复算：`§5c：19 条` → 实测段内 `eq/check` = **19** ✓；`startChatPick` 的"七种出口" → 实测 7 路 ✓（`selftest-wave5.js` 那一段共 22 条 = 批 1 的 12 + 批 2 的 10，与提交信息"12 条/18 条/19 条"的三批增量对得上：`EXPECTED_ASSERTIONS` 逐提交实测 = `3192f02:288 → 96d8df8:300 → 86732d3:318 → b61fe2d:337`）。
   ⚠️ **唯二失真**：**K5 行**（R-04）与 **`DATA_DICT` 行**（R-05）。
2. **`COMPONENTS.md`**：新增/改写的 6 行（`fab` 行为变更、行内「换绑」、查重提示、会话区文字按钮、会话键读数行、建档浮层会话区）逐行与实码一致 ✓；三个新 class（`row-acts`/`sheet-dup`/`sheet-chat-retry`）**都在 registry 里**（脚本抽查：`row-acts=registry有 ｜ sheet-dup=registry有 ｜ sheet-chat-retry=registry有`）✓；任务 C 补的 `文件/搜索词/影响面` 三列里，本批 6 行的 `文件` 列**全部 `Test-Path` 为真** ✓。
3. **`STATE.md`**：进度已写到批 3（`b61fe2d`）与"待裁② 已裁 = A" ✓（我最初读到的"下一步 = 批 3"是被后续提交覆盖的旧值，已按当前内容核对）。
   ⚠️ 但 `STATE.md:33` **仍在写实测读数**（"12 条断言""断言 300→**318**"），而紧邻的 `:34` 自己写着"（断言条数取数：`node tools/selftest.js`，本文件不抄读数）"⇒ 这就是 r4 的 **R4-D03** 已立卡整改的同一类（当时被点名的实例正是"'补 8 条断言'"）⇒ **R-13**（见 §2 补记）。
4. **`CHANGELOG.md`**：pick_friend 条目**没有抄读数**（写的是取数命令），且**诚实标注了"⛔ 零真机读数"** ✓。但同一句里"新建的那条**不带键**"被 R-01 证伪（条件性失真，不是纯文档错）。
5. **`DATA_DICT.md`**：见 R-05。
6. **教训卡**（本批 diff 含 3 张）：`docs/lessons/2026-09-25_grep行号不等于代码结构.md`（pick_friend，`740bf7b`）的**核心事实我独立复核为真**（`data` 块确实闭合于 `index.js:73`，`chatKey` 在 `:81` 是实例字段）✓。该卡内"`data` 在第 50 行"是**当时**的读数（现在 `data: {` 在第 53 行，`740bf7b` 恢复了 2 行注释导致位移）——属历史读数，**不列为发现**。另两张是门禁自身的教训卡：`2026-09-25_非ASCII路径被git转义会让门禁误判越界.md`（`6602d20`）、`2026-09-25_并行写同一工作树会让范围门禁误报.md`（`84686b8`，属任务 C）。三张卡的行数实测（`Get-Content | Measure-Object -Line`，即非空行）= grep行号 **11** ／ 非ASCII **11** ／ 并行 **13**；对照 `AGENTS §7` 的"≤12 行"约定，**"并行写同一工作树"卡超 1 行**（产物属并行任务 C，不在本批范围，仅记录）。
7. **`docs/PRIVACY.md` / `docs/README.md`**（任务 C 产物）：已写对 `chatRoomId` 的摘要语义 ✓（这正是 R-05 说"单源分裂"的依据）。

**§2 补记 —— 🟡 R-13 ｜ P3 ｜ `STATE.md:33` 仍写实测读数（R4-D03 同类复发）**
- 证据：`STATE.md:33`「批 1 = `96d8df8`（… + **12 条断言**）｜批 2 = `86732d3`（… 断言 **300→318**）」，与 `:34`"本文件不抄读数"自相矛盾。
- 建议：换成"断言增量见提交信息 / 取数命令"，或把 300→318 这类**历史增量**明确写成"提交时的读数（历史）"。

---

## §7 建议色 + 诚实边界

### 7.1 计数

| 级别 | 条数 | 编号 |
| :-- | :-- | :-- |
| **P0** | **0** | — |
| **P1** | **2** | R-01（同键两条档案，运行时复现）· R-02（`fab` 永久失效，运行时复现） |
| P2 | 4 | R-03（老路不可达 + U-5 取证行不上屏）· R-04（K5 行漏 D3 载体）· R-05（DATA_DICT 未回写）· R-06（非字符串键静默解绑） |
| P3 | 7 | R-07（字段文案）· R-08（死常量/死参数，R-17 未修）· R-09（触摸目标）· R-10（行数两把尺子）· R-11（函数 >50 行）· R-12（体量黄未记账）· R-13（STATE 抄读数复发） |
| **合计** | **13** | 旧报告未核销 P0/P1 = **0** |

### 7.2 建议色：**🔴 红**

判据（卡 24「建议色矩阵」唯一依据）：**P1 ≥ 1** ⇒ 🔴。两条 P1 都已用 stub 运行时复现（不是纯静态推测），且 R-01 直接破坏 SCOPE **M5 的核心不变量**（"同一条会话不会建出第二条档案"）。**裁决权在人。**

### 7.3 诚实边界（哪些是静态读码、哪些没验）

- **本批零真机读数**：`U-2`（主包直调 `wx.openChatTool`）／`U-5`（返回是明文还是加密）／`U-6`（个人主体是否开放）／`U-7`（独立分包里 `getApp()`）／`U-9`（分包页 `switchTab`）／`U-11`（`selectGroupMembers` 单聊行为）**全部未验**；验收 `V1~V6`（真机）与 `V3/V5/V6/V8`（可静态或模拟器部分覆盖的几条）**一条都没点**。我没有微信开发者工具读数、没有真机、没有截图。⇒ 本报告**不能**被引用为"pick_friend 通了"。
- **运行时结论的载体**：R-01/R-02/R-03 是我用 stub（内存存储 + 假 `wx`）驱动**真实页面源码**得到的；它证明的是"代码路径如此"，**不等于**"平台上一定这样发生"（R-02 的触发前提尤其如此，已在条目里写明）。
- **静态读码得出的**：D3 归位（键/原值一律在实例字段与内存桥）、装配链路、死代码、函数行数、常量全组合、文档↔实码对帐、越界清单。
- **未做**：没有跑 `npm audit`/lockfile 检查（**N/A**：零依赖、无 lockfile，`gate.ps1` 判"依赖无变化"）；没有通读锚点以来的全部历史 diff（只读本批 + 旧报告结论抽验）；旧 P2/P3 未逐条复核（理由见 §0.5）；DESIGN §7 预写的"改散列常数"变异未复跑（**未验**）。
- 读数的时间戳与 HEAD：所有门禁读数的**钉住点 = `740bf7b`**；当前 HEAD 已前移（`32d90bd`，任务 C），本批代码在那之后未被改动（`git diff --stat 740bf7b -- <本批代码文件>` 为空）。

---

## §8 给下一轮的第一份工作（若我是下一个审查者，我希望先看到什么）

1. **R-01 的修复 diff + 一条页面级回归钉**：修复必须能让"残留 `chatKey` 不再进库"这件事**可证伪**。页面层零断言是已知缺口（TD-016），所以本轮**至少**要看到：① `git diff` 里 `chatKey` 的每个出口都被清；② 我给的 stub 复现脚本（`pf_harness.js` 的 H-A 段）在修复后**不再出现两条同键档案**——把"复现脚本"本身当回归钉留在 `tools/` 之外（例如 `docs/reviews/` 附录），是这类页面层缺陷目前唯一可用的防线。
2. **R-02 的修复 + 一次"注入式挂死"复跑**：注入 `openChatTool` 不回调，验证 8 秒后浮层**打开**且状态行说明原因。这条修完，`bind`/`readRoomId` 的同一写法要不要一起收（`DEFAULT_TIMEOUT_MS` 已是两处双写，见 TD-015 ①），请一并给结论。
3. **R-03 的取舍要人裁**：老路是"删掉"还是"修判据让它可达"。若 25 卡还打算靠那行读 U-5，就必须修判据；若已决定只用分包页的四态读 U-5，就把它删掉并同步 `APIS`/`COMPONENTS` 的"生产入口"措辞。
4. **R-04/R-05 两行文档的补齐 diff**（很小，但它们是 D3 审计与字段事实源的入口）。
5. **请把本批与并行任务 C 的提交分开**：本轮范围门禁的正常读数被任务 C 的文档列对齐与 `VERIFY.md` 干扰过（`gate.ps1` 一度读到 1254 行、且 `DATA_DICT.md` 因我漏列 scope 而误报越界一次）。下一批开工前，先把"本批 ScopeFiles"写成一个文件清单（而不是靠人拼通配符），否则"越界/体量"两条读数每次都要人工扣除。
6. **所有真机读数回来之前，`STATE.md` 请维持"零真机"的 ⛔ 标注**（现在写对了：未决 15），并且**不要把 `CHANGELOG` 的"新建那条不带键"当成已验证事实**（R-01）。

---

### 附：本次审查的原始命令与关键输出（可复算清单）

```text
git log --oneline -1 3192f02                       → 3192f02 docs(pick_friend): 22 卡设计 …
git diff --shortstat 3192f02..740bf7b              → 27 files changed, 1046 insertions(+), 74 deletions(-)
git diff --stat 740bf7b -- utils/ pages/ chatpick/ app.js tools/selftest*.js gate.ps1   → （空）
node tools/check.js | Select-Object -Last 2        → 通过 33 项；失败 0 项；警告 0 项（@740bf7b）／通过 34 项…（@32d90bd）
node tools/selftest.js                             → 断言 337 条：通过 337，失败 0（exit 0）
powershell -File .\check.ps1                       → 全部通过（退出码 0）：完成声明成立。（exit 0）
powershell -File .\gate.ps1 -Anchor 3192f02 -ScopeFiles <并集> -Estimate 600  → 范围检查 31 文件全在 scope 内；
                                                     [WARN] storage.js = 606 行（锚点 522）；[WARN] 体量 1254 > 900；exit 2
变异（副本）：M1 红1 / M2 红5+崩在195条 / M3 绿337 / M4 红1 / M5 红1（每组的"注入点唯一 + 字节数变了"见 §3）
运行时不变量复现（stub 驱动真实页面）：H-A 两条同键档案 / H-B 注册定时器数=0 且 picking 永久 true / H-C 老路不可达
静态：data 块 = index.js:53~73（chatKey 在 :81）｜16 种高度组合恒 = 620rpx ｜wxml 里 chatKey|chatRoomId|members|pairKey 命中 0 次
```

**审查完成：P0 0 ｜ P1 2 ｜ P2 4 ｜ P3 7（旧 P0/P1 未核销 0）。建议色：🔴 红。**
本卡只审不修；放行/回炉由人裁决（回复"继续"进 25 验证，或"修复"回 23）。
