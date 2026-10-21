# V4_DATA_MODEL · v4 数据模型与安全隔离细节设计
> 版本：v0.9-draft（2026-10-21）｜依据：`docs/V4_CONTRACT.md` **v0.9**（唯一口径）+ v3 只读调研报告｜状态：待 lead 审阅；用户裁决项见 §13.3（D1~D21）
> v0.9 变更（用户四次修订五条 + 审计补丁）：⑥**绑定方向固化**——`bind.create` 仅 CUSTOMER 可调、**自绑拒绝**、代客单不写 `bindings`（§0.5/§2.4/§4.8C/§7.4/§12#33）；⑦**账号切换**——真实账号只读（`READONLY`）+ **测试账号可写**（`TEST_WRITE`；`users.isTestAccount`、**合成 openid `TEST-<random>`（`users._id`/`customers._id`/`partners.openid` 同值，非空串、不来自微信）**、仅测试账号互通、不计统计），后台「切换账号」+ 测试账号管理四动作（§0.5/§2.1/§2.13/§4.10/§7.6/§7.7）；⑧**roomTag 恒大写**——`A…Z/AA…`、展示 `D4-522A`、按大写字母序排序（§2.4/§4.1/§4.6/§9）；⑨**头像与微信昵称**——顾客/兼职均采集（`displayName` 必填 + `avatarFileId`，`upload.prepare({purpose:'AVATAR'})`、**路径 `avatars/{role}/{random}.jpg`（不含 openid）**、≤200KB、替换删旧/注销删文件），仅当前 ACTIVE 绑定双方可见、**绑定前 `partner.getPublic` 只回昵称不回头像**、后台不展示头像、卡片/通知不含（§0.5/§2.2/§2.3/§2.12/§7.3/§7.4/§10）；⑩**测试数据隔离**——`orders.isTest`（服务端按参与账号派生、禁客户端传）/`impersonatedBy`、`order_events.impersonatedBy`、统计/红点/邀请码/报表排除测试数据、30 天清理与 `purgeTestData` 安全闸（§0.5/§2.5/§2.6/§7.8/§10）。
> v0.9 身份传播铁律：`actorOpenid`（真实开发者：白名单/会话/审计）与 `effectiveOpenid`（测试账号：业务身份/业务限流/`upload_tickets.openid`/`message.fromId`/`event.actorId`）**分离**；写动作交叉校验 `targetIsTest && viewTicket.targetId===effectiveOpenid`；删除测试账号须使其相关会话 `endedAt`（§0.5/§4.10/§6.1/§6.2）。
> v0.9 另按 CONTRACT §14 第 9 条清扫旧口径（小写 roomTag、不收集头像、第二微信号验收、单账号等表述一律不保留），并吸收 CONTRACT §15 O1~O18 优化项（§13.1c 逐项落点）。
> v0.8 变更（用户三次修订两条）：④**OCR 识别失败兜底**——新增 **`recognition_failures`（第 14 个集合）** + `ai.parseParcel`（云函数侧调 DeepSeek、只发去敏文本、唯一格式化 DTO、失败静默降级入队、**不新增错误码**）+ `config.aiFallback{...}`/`recognitionFailureRetentionDays`（§0.4/§2.10/§2.14/§4.9/§7.9）；⑤**识别失败含原图反馈开发者**——复核页原图鉴权临时 URL 5 分钟 + 每次审计 + 不批量/不下载，补录只回填识别字段、不改订单状态（**§7.7 默认脱敏的唯一例外**，§2.14/§7.9）。
> v0.7 变更（用户二次修订三条）：①**零金额**——本程序只做下单/履约/信息整理，删除全部金额类字段、动作与文案，`orders.service` 只留 `{code,name}`（§0.3）；②**双角色唯一编号**——`customers.customerNo`（`C-XXXX-XXXX`）/`partners.partnerNo`（`P-XXX-XXX`）全面替换旧 `partnerCode`，`orders` 存编号快照，`developerNo=DEV-01` 由环境映射给出（§4.2）；③**开发者账号与只读视角**——`invitation_codes` 替换 `activation_codes`、开发者后台动作全表与默认脱敏、`admin_view_sessions` 票据/读白名单/写拒绝（§2.8/§2.13/§6/§7.7）。
> 写作纪律：只写设计与契约（表结构/索引/接口/伪代码），不写实现代码；引用口径用 CONTRACT 的 §/D 编号，引用 v3 用"文件路径 + 函数名"（不写会漂移的行号）。
> 图例：`†` = 本文建议新增、CONTRACT 未列的字段（§13.2 报备）；`[D#]` = CONTRACT §13 用户裁决项；`[P1]` = 非 MVP；`[门禁词表]` = 零金额扫描声明行（CONTRACT §12 白名单）。
## 0. 目标、口径与取舍
### 0.1 本文范围与硬口径
本文给出 **14 集合**的逐字段定义、快照规则、编号算法（`customerNo`/`partnerNo`/`developerNo`/`failureNo`）、索引与分页、安全模型（含**切换账号**——真实账号只读、测试账号可写——识别失败复核与**头像/昵称可见范围**）、**严格按 CONTRACT v0.9 §5.3 命名**的 action 契约（含 `ai.parseParcel` + v0.9 测试账号四动作）、OCR 兜底 DTO 与失败队列、状态机矩阵、roomTag 算法（**恒大写**）、留存/cleanup/注销/测试数据清理、v3→v4 映射与越权测试清单。

硬口径：身份只从 `cloud.getWXContext().OPENID` 推导；客户端传的 id/编号只当查询条件（CONTRACT §4 铁律 2）；集合名/字段名/状态名/服务码/角色名/动作名逐字使用 CONTRACT v0.9；错误码只认 CONTRACT §5.3 的 **13 个**（AI 兜底失败不新增错误码，一律降级）；响应包络 `{ok, code?, message?, data?, serverTime, requestId?}`；v4 不读写 v1/v2/v3 本机键（D2/D11）；L3（取件码/手机尾号/宿舍门牌/截图）最小化，列表 DTO 分级（本人数据完整、admin/日志/通知脱敏），日志不落明文；开发者身份由云函数环境变量白名单判定、不进业务表；**切换会话票据分 `READONLY`（真实账号，只读）与 `TEST_WRITE`（仅测试账号，可写）**，票据只在客户端内存、每次请求服务端校验，`TEST_WRITE` 写动作以目标测试账号身份（`effectiveOpenid`）执行并落 `impersonatedBy=developerNo`，审计/白名单用 `actorOpenid`；**测试数据与真实数据严格隔离**（`isTest` 标记、真实×测试互操作 `FORBIDDEN`、统计/红点/邀请码/报表排除）；**绑定只能由顾客发起**（`bind.create` 仅 CUSTOMER、**自绑拒绝**、代客单不写 `bindings`）；**头像/昵称仅当前 ACTIVE 绑定双方可见**（**绑定前只回昵称不回头像**；后台不展示头像、昵称脱敏，卡片/通知/日志不含）；`roomTag` **恒大写**；**AI 外呼只在云函数层、Key 只在环境变量、只发去敏文本、失败静默降级并入复核队列**。

v0.7 关闭全部非 D 级缺口：零金额（§0.3）、双角色唯一编号（§4.2）、邀请码术语与集合（§2.8）、开发者后台动作表（§7.6）、只读视角票据（§2.13/§6.2/§7.7）；§13.1 逐项给出回填落点。v0.8 关闭识别兜底与复核口径：`recognition_failures` 集合（§2.14）、写入口径（§4.9）、外呼/复核契约（§7.9）、cleanup 与留存（§10）、测试（§12#27~#32）；§13.1b 逐项给出回填落点。v0.9 关闭绑定方向/账号切换/测试账号/头像昵称/roomTag 大写五组口径：§0.5 硬约束、`users.isTestAccount`（§2.1）、`displayName/avatarFileId`（§2.2/§2.3）、`orders.isTest/impersonatedBy`（§2.5/§2.6）、`admin_view_sessions.viewMode`（§2.13）、测试账号四动作与清理（§7.6/§7.8/§10.4）、身份传播 `actorOpenid/effectiveOpenid`（§4.10/§6）、绑定方向（§4.8C/§7.4）、roomTag 大写（§9）、审计名统一 `ACCOUNT_SWITCH_*`；§13.1c 逐项给出回填落点。
### 0.2 v3 调研结论 → v4 设计取舍

| # | v3 事实 | v3 代价 | v4 规则（被否方案） |
| :-- | :-- | :-- | :-- |
| 1 | 单键 `ex_college_v3.store` 整库覆盖写（`utils/storage-core.js` `loadStore`/`saveStore`），无事务、读写全库校验 | O(n) 校验、写放大、无跨集合原子性、单 key 1MB | 云数据库按集合拆分+索引；写动作事务内改单文档+流水+计数（§4.8）；否：纯本地无后端/本地分键（跨设备丢、可改包绕过，D1） |
| 2 | 无唯一键；abc 由 `nextCustomerName` 补进称呼；站点只存字符串 | 身份靠会话+人眼；改名/换宿舍失配（TD-022）；站点裂组 | `openid`+`activeKey`+**双角色唯一编号**（§4.2）；`roomTag` 独立字段绑定事务分配（§9）；订单存 `stationId+stationName` 快照；否：沿用会话摘要/拼名/只存字符串 |
| 3 | 软删+回收站；数据只存本机、零网络无账号 | 无留存期限/匿名化；无法双角色跨设备 | 订单不可硬删；终态 180 天匿名化、+30 天物理删、截图 7 天删、编号注销作废（§10）；云开发+openid+角色隔离（D1/D2）；否：照搬回收站或继续本机 |
### 0.3 零金额硬约束（用户二次修订①，字段级）
**口径**：本程序只负责顾客下单、兼职接单履约、信息整理；**不存在金钱交易**——不做在线支付、收款/记账/结算、运费计算、价格表/报价/费用分摊；服务类型只表达"做什么"，不表达"多少钱"（CONTRACT §0/§6）。
**字段级（全集合无金额字段）**：`orders` 无 `fee/addons/priceFen/totalFen/payStatus`，`service` 只 `{code,name}`，无金额快照与子状态｜`partners.stats` 只含单量（`todayOrders/totalOrders/completedOrders/cancelledOrders/activeOrders/updatedAt`）、无收入/流水字段，`serviceConfig.services` 只 `{code,enabled}`｜`config.serviceCatalog` 只 `{code,name,desc}`、`config` 无价格/费率项｜`order_messages` 模板只含状态/地址/时间话术，`order_events.payload`/`admin_audit.detail`/通知/日志均无金额键｜接口入参/出参/DTO 无金额字段，未知字段（含金额键）被 schema 白名单拒绝。
**动作级（不存在）**：`order.markPaid`/`order.unmarkPaid`、任何收款/结算/记账动作、`order_events` 的 `PAYMENT_*`、取消原因 `PRICE_ISSUE`/`PAYMENT_TIMEOUT`、支付类错误码；`order.undo` 只覆盖 `markPicked`/`markDelivered`。
**扫描门禁**：`[门禁词表]` `Fen|price|fee|pay|amount|金额|价格|运费|收款|结算|费用|支付`；源码/页面文案/文档命中即失败（门禁见 `docs/V4_ENGINEERING.md`）。`[门禁词表]` 白名单=本小节声明行、标题/正文中的「零金额」概念引用、以及带「已删除/已废弃/不存在」标注的旧口径对照行；其余语境出现即缺陷（CONTRACT §14 第 7 条）。
### 0.4 识别兜底与失败复核硬约束（用户三次修订④⑤，v0.8）
**口径**：端侧 OCR + 规则解析后**站点或取件码任一缺失/不可信**（`codeStatus=NEED_CODE`、`stationId=''`、或解析结果与 OCR 文本冲突）→ 客户端调 `ai.parseParcel`（**唯一外呼出口**，DeepSeek 只在云函数侧调用）；AI 只做**预填建议**，不覆盖用户手填、不替代 `order.correct`；仍失败/低置信 → 写 `recognition_failures`（含原图引用；**记录粒度=订单 × 截图**：同图多单各一条、`failureId` 按单独立、未建单也保留 `orderId=''`）供开发者后台复核（CONTRACT §4.2/§4.3）。
**不做什么**：不给第三方发原图/openid/订单归属；不做客户端直连第三方 AI（Key 泄露即事故）；不因 AI 失败新增业务错误码（仍 13 个）；不提供批量查看/下载/导出原图；AI 结果不得直接改订单状态、不代确认、不创建订单。
**字段级（全部为非敏感、无金额语义）**：`config.aiFallback{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}`（布尔/字符串/整数次数/毫秒，**无金额字段、无 Key**）与 `config.recognitionFailureRetentionDays`（7~30，默认 30）；`orders.parcel.recognitionSource∈{RULE,DEEPSEEK,MANUAL}`、`orders.parcel.confidence?`、`orders.image.failureId?`（**均为可选字段**，缺失的旧单按 `RULE`/`MANUAL` 展示，不阻断任何动作）。
**动作级**：新增 `ai.parseParcel` + `admin.listRecognitionFailures/getRecognitionFailure/fixRecognitionFailure/ignoreRecognitionFailure`；新增审计 `FAILURE_IMAGE_VIEW/FAILURE_FIX/FAILURE_IGNORE`；**无任何金额/收费类动作或事件**（§0.3 零金额词表与门禁继续生效）。
**扫描门禁**：`[门禁词表]` 本小节声明行豁免；AI 相关正文只允许出现次数/毫秒/布尔/枚举，不得引入金额语义；`DEEPSEEK_API_KEY`/`api.deepseek.com` 出现在客户端目录即门禁失败（CONTRACT §12）。
### 0.5 账号切换、测试数据隔离、绑定方向与头像昵称硬约束（用户四次修订⑥⑦⑧⑨ + 审计补丁，v0.9）
**平台限制（先写清楚）**：微信小程序**不能切换登录的微信账号**；本文的“切换账号”= 应用内**账号代理切换**（开发者以某个账号身份进入小程序：真实账号只读、测试账号可读写），不是换微信登录（CONTRACT §1.3）。
**两类目标账号**：①**真实账号**（ACTIVE 顾客/兼职）→ **只读**（`viewMode='READONLY'`，即原只读视角：黄条 + 服务端拒写 + 审计）；②**测试账号**（开发者后台创建的合成账号：`users.isTestAccount=true`、`users._id=customers._id=partners.openid='TEST-<random>'`、**无真实微信 openid**）→ **可写**（`viewMode='TEST_WRITE'`：蓝条 + `TEST` 角标；所有写动作以目标测试账号身份执行，`orders.isTest=true`、`orders/order_events.impersonatedBy=developerNo`），用于**一个微信号单机验收两端**（下单→接单→取件→送达→确认）。
**测试账号规则**：由 `admin.createTestAccount` 创建（选角色、填昵称，生成 `customerNo`/`partnerNo` 与**合成 openid `TEST-<random>`**，同值写入 `users._id`/`customers._id`/`partners.openid`）；**不消耗邀请码、不走激活、不进真实用户可见列表**；每位开发者每角色 ≤3、合计 ≤6（`config.testAccountMaxPerRole`）；测试兼职默认服务配置全开、范围=全部苑、`acceptingOrders=true`；测试账号用**默认头像**（无真实微信资料，不采集头像）；`testLastUsedAt` 记最近使用，cleanup 清理超 30 天未使用的测试业务数据（账号保留）。
**隔离铁律**：测试账号**只能与测试账号**建立绑定/下单/留言；真实账号不能绑定测试兼职、不能把订单下给测试兼职；测试账号也不能绑定真实兼职——违反一律 `FORBIDDEN`（文案“测试账号与真实账号不能互相绑定”）；**`orders.isTest` 由服务端按参与账号 `isTestAccount` 派生，客户端传入一律忽略/拒绝**；`stats`/单量统计/后台红点/邀请码/报表**排除测试账号与 `isTest` 订单**；后台订单/用户列表默认过滤测试数据（可切换查看并带 `TEST` 标签）；`partner.getPublic` 对测试账号返回 `NOT_FOUND`（不把测试 `partnerNo` 分享给真实顾客）。
**绑定方向铁律**：**只能顾客绑定兼职**——`bind.create` 仅业务角色为 CUSTOMER 的调用者可调（PARTNER 调用一律 `FORBIDDEN`）；**自绑拒绝**（目标 `partner.openid == caller 的 effectiveOpenid` → `FORBIDDEN`）；兼职端无“添加/绑定/导入顾客”入口、不得批量建绑定；**代客下单（D12）不产生绑定**，`bindings` 不得由订单创建流程隐式写入；兼职只能 `unbindCustomer`（填原因并通知顾客）；解绑/停用/注销后双方**不再能看到对方头像/昵称**（DTO 按 ACTIVE 绑定关系返回，O2 解绑即失联）。
**身份传播（审计补丁）**：`TEST_WRITE` 会话内 `actorOpenid`=真实开发者 openid（白名单/会话/审计用）、`effectiveOpenid`=目标测试账号合成 openid（**业务身份/业务限流/`upload_tickets.openid`/`message.fromId`/`order_events.actorId` 用它**）；写动作交叉校验 `targetIsTest && viewTicket.targetId===effectiveOpenid`，不匹配 `FORBIDDEN`（防票据挪用）；删除测试账号必须使相关会话 `endedAt`。
**头像与微信昵称（D19）**：`customers/partners.displayName` **必填**（≤20 字；首次从微信昵称一键填入，可改、可手填；保存过 `security.msgSecCheck` v2）；`avatarFileId` 可空→**默认头像**（客户端本地绘制昵称首字色块，不占存储、不裂图）；采集用 `chooseAvatar`（**可拒绝、不阻断**）；上传复用 `upload.prepare({purpose:'AVATAR'})`（路径 **`avatars/{role}/{random}.jpg`（不含 openid，不可枚举）**、≤200KB、jpg/png），**替换头像即删旧文件**（旧 fileId 失效→客户端回默认头像）、注销/删除测试账号删文件；仅**当前 ACTIVE 绑定双方**可见：**绑定前 `partner.getPublic` 只回昵称、不回头像**，绑定后才下发头像；**后台列表/详情不展示头像、昵称脱敏**，分享卡片/通知/日志不含头像 fileId 与完整昵称；客户端 `onShow` 重取资料（换头像/解绑后立即失效）。
**roomTag 恒大写（D7/D21）**：服务端按（兼职, dormKey）绑定顺序分配 **`A…Z`、`AA…`（Excel 列名式大写）**，展示 `D4-522A`；**旧小写口径（`a..z/aa..`、`D4-522a`）全部作废**；列表排序按大写字母序（=绑定先后，A<B<…<Z<AA<AB）。
**不做什么**：不做真实账号可写视角（隐私/审计/数据污染风险，D18 备选 B 被否）；不支持小程序内切换微信登录账号本身（平台限制）；**不新建 `test_accounts` 集合**（测试账号仍落 14 集合，靠 `isTestAccount` 标记）；不把测试账号加入真实用户搜索结果；**订单/绑定不复制头像与昵称快照**（CONTRACT §11.1：解绑即失联）；不提供头像自由上传（`chooseAvatar` 由微信平台审核；自定义上传需 `mediaCheckAsync`，[P1]）。
**扫描门禁**：`[门禁词表]` 本小节声明行豁免；测试/头像相关字段只允许 `isTest` 布尔、`impersonatedBy` 编号、次数/天数/B 数，**不得引入任何金额语义**（§0.3 继续生效）。

## 1. 集合总览

| 集合 | 主键 | 用途 | 写入方（动作） | 客户端直读 | 留存 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `users` | `_id=openid`（测试账号 `_id='TEST-<random>'`，合成 openid、**非空串**、不来自微信） | 账号、角色、隐私同意、已读水位、注销排期、**测试账号标记**（`isTestAccount/createdByDeveloperNo/testLastUsedAt`） | `user.bootstrap`/`admin.createTestAccount`/切换会话写 `testLastUsedAt`/注销内部 | ❌ | 账号存续+注销 30 天；测试账号数据 30 天清理（账号保留） |
| `customers` | `_id=openid`（测试顾客 `_id='TEST-<random>'`） | 顾客资料（宿舍身份）+**`customerNo`**+**`displayName` 昵称（必填）/`avatarFileId`（可空→默认头像）**（v0.9） | `customer.saveProfile`/注销内部 | ❌ | 账号存续+注销 30 天（头像文件随注销即删） |
| `partners` | 自增 | 兼职资料、**`partnerNo`**、**`displayName` 昵称（必填）/`avatarFileId`（可空→默认头像）**（v0.9）、服务配置、单量统计缓存 | `partner.activate`/`saveProfile`/`saveServiceConfig`/`admin.setPartnerStatus`/`admin.createTestAccount`/cleanup | ❌ | ACTIVE/SUSPENDED 存续；CLOSED 保留审计；测试兼职随测试数据清理 |
| `bindings` | 自增 | 绑定+`roomTag`（**恒大写**）+宿舍快照+兼职备注；**只能由顾客 `bind.create` 创建**（v0.9） | `bind.create`/`bind.release`/`partner.unbindCustomer`/换宿舍/注销 | ❌ | 历史行保留 |
| `orders` | 自增 | 订单主表（快照/状态/版本/编号快照/留存）+**`isTest` 测试标记 / `impersonatedBy?`（v0.9）** | `order.create`/`createBatch`/状态动作/cleanup | ❌ | 终态 180 天→匿名化→30 天→物理删；测试数据 30 天清理 |
| `order_events` | 自增 | 全量状态流水（审计/进度数据源） | 所有订单写动作 | ❌ | 随订单删除 |
| `order_messages` | 自增 | 订单留言 | `message.send` | ❌ | 随订单删除/匿名化 |
| `invitation_codes` | 自增 | 开发者发邀请码（发码/作废/审计）；旧 `activation_codes` 更名 | `admin.createInvites`/`admin.revokeInvite`/`partner.activate`/cleanup | ❌ | 长期脱敏保留 |
| `admin_view_sessions` | `_id=viewTicket` | 开发者**切换会话票据**：真实账号只读 `READONLY` / 测试账号可写 `TEST_WRITE`（`viewMode/targetIsTest/targetAvatarFileId`；§2.13） | `admin.viewAsStart`/`admin.viewAsEnd`/cleanup | ❌ | 结束/过期 7 天后清理 |
| `counters` | 自增 | 原子计数（订单号/roomTag/限流） | 事务内写/cleanup | ❌ | 长期；`rl:` 过期清理 |
| `config` | `_id='global'` | 全局配置（无金额项；`aiFallback` MVP 只读；**v0.9 增头像/测试账号配置**） | `admin.updateConfig`（`aiFallback` 除外：部署配置脚本/控制台） | ❌ | 长期 |
| `admin_audit` | 自增 | 管理操作审计 | admin 写动作/cleanup | ❌ | ≥180 天 |
| `upload_tickets` | 自增 | 上传票据（5 分钟；**`purpose='TICKET'\|'AVATAR'`**、`openid`=effectiveOpenid，v0.9） | `upload.prepare`/下单或资料保存消费/cleanup | ❌ | 过期/使用后清理 |
| `recognition_failures` | 自增 | **识别失败复核队列**（v0.8 第 14 个集合；含原图引用，仅开发者复核页可见） | `ai.parseParcel`（唯一入队）/`admin.fixRecognitionFailure`/`admin.ignoreRecognitionFailure`/cleanup | ❌ | `retentionDays`（默认 30，7~30 可配）→ 到期删原图引用并置 `IGNORED` |

不新增 `notifications` 集合：消息中心 = 服务端聚合视图（状态类 `order_events` + `order_messages` + 公告），已读水位 = `users.messageReadAt`。开发者身份不落任何集合（环境变量白名单判定），`developerNo` 只出现在 `admin_audit` 与 `admin_view_sessions`（审计/后台抬头用）。**v0.8 新增第 14 个集合 `recognition_failures`**：只由 `ai.parseParcel` 入队、只被 admin 复核动作/cleanup 改状态，**客户端零直读**；AI 外呼本身不建集合、不直接写 `orders`（订单侧只由下单/补码动作写三个可选字段，§4.9）。**v0.9 不新增集合**：测试账号与真实账号共用同一批集合（**不建 `test_accounts`**），隔离靠 `users.isTestAccount` + 切换会话 `viewMode` + 订单 `isTest` 快照（不靠分库/分集合）；头像走 `upload_tickets(purpose='AVATAR')` + 云存储 `avatars/…`，不建头像表；`admin_view_sessions` 一份票据覆盖只读/测试可写两种模式。
关系：`users 1─1 customers`；`users 1─0..1 partners`；`customers 1─0..1 bindings(ACTIVE) N─1 partners`；`orders.customerId=openid 引用键、customerOpenid=同值快照（guest 单均空）、customerNo=编号快照`；`orders.partnerId=partners._id、partnerOpenid=快照、partnerNo=编号快照`；`orders 1─N order_events / order_messages`；`orders.image.fileId N─1 云存储文件（一图多码拆单共用，引用计数清理）`；`admin_view_sessions.targetId→customers._id|partners._id`（只读票据，不写业务集合）；`recognition_failures.fileId N─1 云存储文件（可与 `orders.image.fileId` 是同一文件，保留期取较长者）`、`recognition_failures.orderId?→orders._id`（可空，仅关联展示，不反向写订单）。**v0.9 关系补充**：测试账号是 `users(_id='TEST-<random>')` 合成账号（`customers._id`/`partners.openid` 同值、非空串、不来自微信），`orders/bindings` 的身份键照常存该 openid；`bindings` 只由 `bind.create`（CUSTOMER）写入、`orders` 创建流程不写 `bindings`（绑定方向铁律）；`customers/partners.avatarFileId → 云存储 avatars/… 文件（1─0..1，替换即删旧、注销即删）；订单表**不复制**头像/昵称（按当前 ACTIVE 绑定关系现查）。
隐私级别（CONTRACT §4.2）：`L1 公开/角色内非敏感`｜`L2 个人（本人/绑定关系/工单可见）`｜`L3 敏感（取件码/手机尾号/宿舍门牌/截图/识别失败原图；最小化+限时+不上通知/日志）`。**L3 字段只在本人数据 DTO 中出现完整值**；admin 后台默认脱敏，完整 L3 只经只读视角（审计）查看；**唯一例外** = 识别失败复核页可按单查看该失败记录的原图（鉴权临时 URL 5 分钟 + 每次审计 `FAILURE_IMAGE_VIEW`，不提供批量/下载/导出，CONTRACT §1.1/§4.3）。**v0.9 补充**：`displayName`/`avatarFileId` 属 L2（仅本人与当前 ACTIVE 绑定对方可见；**绑定前只回昵称、不回头像**；解绑/停用/注销后不再返回）；后台列表/详情**不展示头像**、昵称按 `maskDisplayName` 脱敏（后台仍可按真实昵称/编号精确搜索）；切换会话内按目标本人可见范围展示（等同目标本人视角）。
## 2. 逐集合字段表
> 列：字段/类型/必填/值域·约束/写入方/读权限/隐私级别。写入方只列生产写入口；控制台人工改数据仅限故障处置且必须记 `admin_audit`。`†`=建议新增，§13.2 报备。
### 2.1 `users`（一个 openid 一条）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | =openid；**测试账号=合成 openid `TEST-<random>`（非空串、不来自微信、与 `customers._id`/`partners.openid` 同值）**；永不返回客户端 | 平台/云函数/`admin.createTestAccount` | 本人 | L2 |
| `roles` | string[] | 是 | 子集 `['CUSTOMER','PARTNER']`；**`DEVELOPER` 不落库**（`ADMIN_OPENIDS` 环境变量判定，防改库提权）；开发者 openid 可建账号行但 `roles=[]` | `user.bootstrap`/`partner.activate` | 本人 | L1 |
| `status` | string | 是 | `ACTIVE`/`DEACTIVATED`；DEACTIVATED 只读注销提示 | 注销流程/admin 封禁 | 本人 | L1 |
| `createdAt`/`lastLoginAt` | Date | 是 | 首次登录/每次启动刷新 | `user.bootstrap` | 本人 | L1 |
| `messageReadAt` | Date | 否 | 消息中心已读水位；只进不退；null=未读 | `message.markRead` | 本人 | L1 |
| `privacyConsent` | object | 是 | `{version,at}`；version 必须=`config.privacyVersion` | `user.bootstrap` | 本人 | L1 |
| `deletionRequestedAt` | Date | 否 | 注销申请；cleanup 依此 30 天内物理删 | 注销流程 | 内部 | L2 |
| `isTestAccount` | boolean | 是 | **v0.9**：默认 `false`；`true`=开发者后台创建的**合成账号**（`_id='TEST-<random>'`、无真实微信 openid、只能与测试账号互通、不计任何统计、不进真实用户搜索）；**只由 `admin.createTestAccount` 写，客户端传入忽略** | `admin.createTestAccount` | admin（脱敏列表）/内部 | L1 |
| `createdByDeveloperNo` | string | 否 | 仅测试账号：创建者 `developerNo`（如 `DEV-01`），用于配额与审计 | `admin.createTestAccount` | admin | L1 |
| `testLastUsedAt` | Date | 否 | 仅测试账号：最近一次 `TEST_WRITE` 会话使用时间（cleanup 30 天清理依据，§10.2） | 切换会话开启/测试写动作 | admin/内部 | L1 |
| `updatedAt`†/`purgeAt`† | Date | 是/否 | 最近变更/注销+30 天（索引化清理） | 同上 | 本人/内部 | L1/L2 |

读屏蔽：不直读客户端；`user.bootstrap` 返回 `{roles,status,privacyConsent,messageReadAt,customerProfileCompleted,customerNo?,partnerStatus,partnerNo?,displayName?,avatarFileId?,isDeveloper,viewContext,configPublic,serverTime}`，永不返回 `_id`/`deletionRequestedAt`/`isTestAccount`。`isDeveloper` 只由环境映射决定（不看 `users.roles`）；`viewContext` 见 §2.13（无则 `null`）：`{viewMode:'READONLY'|'TEST_WRITE',role,targetNo,targetDisplayName,targetAvatarFileId?,expiresAt}`；**测试身份只经 `viewContext.viewMode='TEST_WRITE'` 体现**（客户端据此渲染蓝条/`TEST` 角标）。
### 2.2 `customers`（顾客资料；**不含 note**）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | =openid；不返回客户端 | 云函数 | 本人/绑定兼职（裁剪）/admin 脱敏/只读视角 | L2 |
| `customerNo` | string | 是 | **唯一索引**；`C`+8 位 32 字母表（展示 `C-XXXX-XXXX`，§4.2）；**首次资料创建时生成、不可改、注销后作废不复用** | `customer.saveProfile`/`user.bootstrap`（首次建资料，幂等） | 本人/绑定兼职/开发者（后台显示编号）/只读视角 | L1 |
| `displayName` | string | 是 | **昵称，必填**（v0.9）；≤20 字（超长截断）；**首次从微信昵称一键填入、可改/手填**；落库前过 `security.msgSecCheck` v2（未过→`VALIDATION_FAILED`，`data.field='displayName'`）；列表锚展示 `D4-522A · 尾号6678 · 小王`（roomTag 大写） | `customer.saveProfile` | 本人/当前 ACTIVE 绑定兼职（解绑后不返回） | L2 |
| `avatarFileId` | string | 否 | 云存储 fileID（**`avatars/{role}/{random}.jpg`，role=`customer`**，≤200KB、jpg/png、建议 200×200）；空串=默认头像（客户端昵称首字色块，不占存储）；**仅本人与当前 ACTIVE 绑定兼职可见**；替换即删旧文件（旧 fileId 失效回默认头像）、注销删文件；后台/分享卡片/通知/日志不出现 | `customer.saveProfile`（消费 `purpose='AVATAR'` 上传票据）/注销流程 | 本人/当前 ACTIVE 绑定兼职；后台不下发 | L2 |
| `zone` | string | 是 | `D\|X\|N\|B\|C` 大写 | `customer.saveProfile` | 本人/绑定兼职 | L2 |
| `buildingNo` | number | 是 | 整数 1~10 | `customer.saveProfile` | 本人/绑定兼职 | L2 |
| `room` | string | 是 | 规范数字串 ≥100、无前导零、≤20 字符（v3 `buildings.canonicalDorm`） | `customer.saveProfile` | 本人/绑定兼职 | L3 |
| `dormKey` | string | 是 | `buildingText+'-'+room`，如 `D4-522`；服务端 derive，客户端值忽略 | `customer.saveProfile` | 本人/绑定兼职 | L3 |
| `phoneTail` | string | 否 | `''` 或恰好 4 位 ASCII 数字；永不存完整号 | `customer.saveProfile` | 本人/绑定兼职（本人数据完整值） | L3 |
| `profileCompleted` | boolean | 是 | =四字段合法；**资料完整是绑定前提** | `customer.saveProfile` | 本人/绑定兼职 | L1 |
| `createdAt`/`updatedAt`/`profileUpdatedAt` | Date | 是 | 首次完成资料/最近变更/昵称头像最近变更（排序与排障）；注销时写 `deletedAt/anonymizedAt/purgeAt†`（受理/立即匿名化/物理删） | `customer.saveProfile`/注销流程 | 本人/admin/内部 | L1/L2 |

读屏蔽（DTO 分级）：顾客读自己全字段（含 `customerNo/displayName/avatarFileId`）；**当前 ACTIVE 绑定兼职查自己绑定的顾客返回完整值**（`partner.listBindings` 返回 `{bindingId,customerNo,dormKey,buildingText,roomTag,displayName,avatarFileId?,phoneTail,partnerNote,boundAt,activeOrderCount}`；**解绑/停用/注销后不再返回头像/昵称**）；**admin/日志/通知/导出一律脱敏**（`phoneTail` 仅后 2 位、宿舍只到苑+楼栋、不显示 openid、**不展示头像，昵称按 `maskDisplayName`**）；**切换会话按目标本人 DTO 返回**（`READONLY` 完整值 + 审计；`TEST_WRITE` 为目标测试账号自身数据）。任何 DTO 不返回顾客 openid；头像只经 `avatarFileId`（云存储私有，展示用 `cloud://`/临时 URL），**分享卡片/通知/日志不含**。**测试顾客**（`_id='TEST-<random>'`）：资料默认完整（苑/楼栋/宿舍号已填，可改宿舍演示 roomTag）、不采集微信头像/昵称（昵称手填）、不计统计、不进真实用户列表。
### 2.3 `partners`（兼职资料与服务配置）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`openid` | string | 是 | 自增/唯一索引 `uk_openid(openid,unique)`；**测试兼职 `openid='TEST-<random>'`（合成、非空串、与 `users._id` 同值）**，真实账号为微信 openid；openid 仅内部用、永不返回 | `partner.activate`/`admin.createTestAccount` | 内部 | L2 |
| `partnerNo` | string | 是 | **唯一索引**；`P`+6 位 32 字母表（展示 `P-XXX-XXX`，§4.2）；**激活创建 partners 时生成、不可改、注销后作废不复用** | `partner.activate` | 本人/绑定顾客/凭完整编号的公开预览/admin/只读视角 | L1（可分享） |
| `displayName` | string | 是 | **昵称，必填**（v0.9）；≤20 字（超长截断）；激活时从微信昵称一键填入、可改/手填；过 `security.msgSecCheck` v2；**仅本人与当前 ACTIVE 绑定顾客可见**（解绑/停用/注销后不再返回） | `partner.activate`/`partner.saveProfile` | 本人/当前 ACTIVE 绑定顾客；`partner.getPublic` 真实账号公开预览（**绑定前只回昵称**）/后台脱敏 | L2 |
| `avatarFileId` | string | 否 | 云存储 fileID（**`avatars/{role}/{random}.jpg`，role=`partner`**，≤200KB、jpg/png、建议 200×200）；空串=默认头像；**仅当前 ACTIVE 绑定顾客可见，绑定前 `partner.getPublic` 不下发**；替换即删旧文件（旧 fileId 失效回默认）、注销/删除测试账号删文件；后台/分享卡片/通知/日志不出现 | `partner.saveProfile`（消费 `purpose='AVATAR'` 上传票据）/注销流程 | 本人/当前 ACTIVE 绑定顾客（ACTIVE 绑定后才下发）；后台不下发 | L2 |
| `status` | string | 是 | `ACTIVE`/`SUSPENDED`/`CLOSED`；CLOSED=注销（不可恢复、不可接单/被绑定） | `partner.activate`/`admin.setPartnerStatus` | 公开预览/绑定顾客（仅能否接单）/admin | L1 |
| `serviceConfig` | object | 是 | §2.3.1；MVP 只实现 `services/zones/acceptingOrders`；**无价格字段** | `partner.saveServiceConfig` | 公开预览（仅启用的服务码/范围/接单开关）/本人 | L1 |
| `stats` | object | 是 | 可重算缓存 `{totalOrders,activeOrders,completedOrders,cancelledOrders,todayOrders,updatedAt}`；真值=orders 查询；**无收入字段** | cleanup 重算+状态增量 | 本人/admin | L1 |
| `activatedAt`/`createdAt`†/`updatedAt`† | Date | 是 | 激活/创建/最近变更 | `partner.activate`/配置 | 本人/admin | L1 |
| `suspendedAt`†/`suspendedReason`†/`deletedAt`/`closedReason`† | Date/string | 否 | 停用时间/原因（≤100）/CLOSED 时间（必填）/关闭原因（≤100） | `admin.setPartnerStatus` | admin | L2 |

**2.3.1 `serviceConfig`**：`services[]{code,enabled}`（5 服务码、至少 1 个 enabled、**无价格/金额字段**；名称由 `config.serviceCatalog` 下发）｜`zones[]`（`D|X|N|B|C` 子集，空=不接单）｜`acceptingOrders`（boolean，CLOSED/SUSPENDED 强制 false；**`false` ⇒ `order.create/createBatch` 一律 `PARTNER_CLOSED`，顾客端下单入口置灰**）｜`buildingNos?/maxDailyOrders?/businessHours?/autoAccept?`（[P1] 预留可空）。范围以 `serviceConfig.zones` 为唯一事实源（partners 无顶层 `zones[]`）。**测试兼职（v0.9）**：`openid='TEST-<random>'`（合成）、`serviceConfig` 默认全开（5 服务码全 `enabled`、`zones=['D','X','N','B','C']`、`acceptingOrders=true`）、`stats` 全 0、**不计任何统计**；不消耗邀请码、由 `admin.createTestAccount` 创建（§4.10）。
读屏蔽：`partner.getPublic` **允许未绑定/预备绑定的顾客按完整 `partnerNo` 预览**（限流 5 次/日/顾客；公开字段 `{partnerNo,displayName,status,services(仅 code+enabled),zones,acceptingOrders}`——**v0.9：绑定前只回昵称、不回 `avatarFileId`；`avatarFileId` 仅在与调用者存在 ACTIVE 绑定关系时下发**；绑定确认页与卡片落地都走它）；`openid/stats 明细/停用或关闭原因/serviceConfig 未公开字段` 永不返回；**无搜索/枚举兼职 API**（只能凭完整编号查；编号不存在→`NOT_FOUND`，超限→`RATE_LIMITED`）；**测试账号（`isTestAccount=true`）对真实顾客返回 `NOT_FOUND`**（仅同一 `TEST_WRITE` 会话内可预览）；admin 列表/详情默认脱敏并显示 `partnerNo`、**不展示头像**、昵称脱敏；解绑/停用/注销后 DTO 不再返回对方头像/昵称（客户端 `onShow` 重取）。
### 2.4 `bindings`（绑定 + roomTag + 宿舍快照 + 兼职备注）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | 自增；释放时拼入 `activeKey` | 云函数 | 内部 | L2 |
| `activeKey` | string | 是 | 唯一索引；ACTIVE=`customerId`；RELEASED=`customerId:RELEASED:<_id>`（释放时更新；保证一顾客仅一条 ACTIVE） | 绑定/释放事务 | 内部 | L2 |
| `customerId`/`partnerId` | string | 是 | openid/`partners._id`；历史行保留 | `bind.create` | 本人/该兼职/admin | L2 |
| `status` | string | 是 | `ACTIVE`/`RELEASED` | 绑定/释放 | 双方/admin | L1 |
| `roomTag` | string | 是 | **恒大写** `A..Z,AA..`（Excel 列名式：1→A、26→Z、27→AA、702→ZZ、703→AAA）；在（partnerId,dormKey）内唯一；展示 `D4-522A`（v0.9，**旧小写作废**） | `bind.create` 事务（§9） | 本人/该兼职/admin | L2 |
| `dormSnapshot` | object | 是 | `{zone,buildingNo,room,dormKey,buildingText}`；**绑定成功时快照一次写死，禁止原地改**；换宿舍=旧 binding RELEASED+新 binding（新 dormKey 重分配 roomTag） | `bind.create` | 本人/该兼职/admin | L3 |
| `partnerNote` | string | 否 | ≤100 字；兼职私有、顾客不可见；随顾客注销删 | `partner.saveCustomerNote` | 该兼职/admin | L2 |
| `boundAt`/`releasedAt` | Date | 是/否 | 绑定/释放时间；ACTIVE 时 releasedAt=null | 绑定/释放 | 双方/admin | L1 |
| `releaseReason`/`releaseNote` | string | 否 | `releaseReason∈{CUSTOMER_INITIATED,PARTNER_INITIATED,PARTNER_CLOSED,ADMIN_ACTION,CUSTOMER_ACCOUNT_CLOSED}`（RELEASED 必填）；`releaseNote`≤100 字（发起人填写的原因说明） | 释放/注销 | 双方/admin | L1 |
| `tagKey`†/`allocSeq`†/`releasedBy`† | string/number/string | 是/是/否 | 唯一索引 `partnerId:dormKey:roomTag`；序号（从 1 起、允许空洞）；释放者 `CUSTOMER\|PARTNER\|ADMIN\|SYSTEM` | `bind.create`/释放 | 内部/admin | L2/L1 |

读屏蔽：顾客 `bind.getCurrent` 返回 `{binding:{bindingId,dormKey,buildingText,roomTag,boundAt},partnerPublic}`（partner 公开资料内联：`partnerNo/displayName/avatarFileId?/services/zones/acceptingOrders`；**ACTIVE 绑定时才含 `avatarFileId`**）；兼职 `partner.listBindings` 返回 `{bindingId,customerNo,dormKey,buildingText,roomTag,displayName,avatarFileId?,phoneTail,partnerNote,boundAt,activeOrderCount}`（**本人绑定数据完整值**）；admin/日志/通知脱敏（不显示完整宿舍/尾号、不显示 openid、**不展示头像，昵称脱敏**）；历史 RELEASED 行只对 admin；**切换会话按目标本人 DTO**。**v0.9 绑定方向**：本集合**只由 `bind.create`（CUSTOMER）写入**，兼职端/后台/代客下单流程不得写（工程门禁 §12#33）；**自绑拒绝**（目标 `partners.openid == caller effectiveOpenid` → `FORBIDDEN`）；**测试×真实绑定拒绝**（双方 `isTestAccount` 必须一致）；`bindings` 无 `isTest` 字段——测试绑定由参与账号判定（`customerId`/`partnerId` 属测试账号），后台/统计按账号维度过滤；解绑/停用/注销后 `partnerPublic`/顾客昵称头像**不再返回**（历史单只留编号，O2 解绑即失联）。
### 2.5 `orders`（订单主表 + 快照；**无任何金额字段**）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | 自增；永不返回客户端 | 云函数 | 内部 | L2 |
| `orderNo` | string | 是 | 唯一索引；`YYYYMMDD-XXXX`（§4.4） | 下单 | 双方/admin/只读视角 | L1 |
| `requestKey` | string | 是 | 唯一索引；`{customerId\|partnerId}:{clientRequestId}`（guest 用 partnerId；createBatch 每条加 `:{itemIndex}`；见 §4.7） | 下单 | 内部 | L2 |
| `customerId`/`customerOpenid` | string | 是 | 顾客 openid/同值快照；guest 单均 `''`；匿名化清空 | 下单 | 内部 | L2 |
| `customerNo` | string | 是 | 顾客唯一编号**快照**（下单时取 `customers.customerNo`）；guest 单 `''`；只作展示/后台搜索，**不参与鉴权**；匿名化清空 | 下单 | 双方（顾客看自己的、兼职看顾客编号）/admin/只读视角 | L1 |
| `partnerId`/`partnerOpenid` | string | 是 | `partners._id`/openid 快照；匿名化清 partnerOpenid | 下单 | 双方（不返回 partnerId）/admin | L2 |
| `partnerNo` | string | 是 | 兼职唯一编号**快照**（接单/建单时取 `partners.partnerNo`）；只作展示/后台搜索，**不参与鉴权**；匿名化清空 | 下单 | 双方（顾客看兼职编号）/admin/只读视角 | L1 |
| `source` | string | 是 | `CUSTOMER`/`PARTNER` | 下单 | 双方 | L1 |
| `isTest` | boolean | 是 | **v0.9**：测试数据标记，**服务端按参与账号 `users.isTestAccount` 派生**（双方均为测试账号才 `true`；真实×测试单在创建前即 `FORBIDDEN`）；**客户端传入忽略**；统计/后台红点/邀请码/报表排除 `isTest=true`；测试数据 30 天清理（§10） | 下单/cleanup | admin/测试会话；真实用户永不返回 | L1 |
| `impersonatedBy` | string | 否 | **v0.9**：`TEST_WRITE` 会话写入时=发起 `developerNo`（如 `DEV-01`）；真实流程为空串；可按 `developerNo` 追溯；真实用户 DTO 不返回 | 下单（测试会话） | admin | L1 |
| `status` | string | 是 | 7 状态（§8） | 状态动作 | 双方/admin | L1 |
| `parcel.stationId`/`stationName` | string | 是 | P1~P8/≤40 正式名快照；未识别 `''`（兼职务必 `order.correct` 补；不自建站点） | 下单/纠正 | 双方 | L1 |
| `parcel.pickupCode` | string | 是 | ≤40；形态闸沿用 v3；`NEED_CODE` 时允许空 | 下单/纠正 | 双方（本人数据完整值；admin/日志脱敏） | L3 |
| `parcel.lockerNo`/`trackingTail` | string | 否 | ≤10/空或 5 位 ASCII 数字 | 下单/纠正 | 双方 | L2 |
| `parcel.codeStatus` | string | 是 | `OK`/`NEED_CODE` | 下单/纠正 | 双方 | L1 |
| `parcel.recognitionSource`/`parcel.confidence` | string/number | 否 | **v0.8 可选**：`RULE`/`DEEPSEEK`/`MANUAL`（缺省按 `RULE`；用户手填/修改过=`MANUAL`）+ `HIGH\|MEDIUM\|LOW`（规则或 AI 置信，可空）；**只表识别来源与置信，无金额语义**；AI 结果只预填、不覆盖手填（§4.9/§7.9） | 下单/`order.correct`（按已确认识别结果写） | 双方（来源）/admin | L1 |
| `dorm` | object | 否 | `{zone,buildingNo,room,dormKey,buildingText,roomTag}` 下单快照；**顾客单必填、guest 单可空**（代客地址在 `guest`） | 下单 | 双方 | L3 |
| `guest` | object | 否 | `{displayName,phoneTail,zone,buildingNo,room,dormKey}`；`source=PARTNER` 且无绑定顾客时必填（guest 单调） | `order.create`（兼职） | 该兼职/admin | L3 |
| `phoneTail` | string | 否 | 下单快照（`''`/4 位）；匿名化置空；admin/日志脱敏。**v0.9 起订单不存 `displayName` 昵称快照**（CONTRACT §11.1：订单快照不复制头像/昵称；对方昵称/头像按当前 ACTIVE 绑定关系实时解析，`counterpart`） | 下单 | 双方（本人数据完整值；admin/日志脱敏） | L3 |
| `service` | object | 是 | **只有** `{code,name}`；code∈5 服务码、name 为下单时服务名称快照；**无价格/金额字段** | 下单 | 双方 | L1 |
| `appoint` | object | 是 | `{type:'ASAP'\|'SLOT', startAt?, endAt?}`；SLOT 必填且 start<end、未来时间 | 下单 | 双方 | L2 |
| `note` | string | 否 | ≤200 字（顾客备注） | 下单 | 双方 | L2 |
| `image` | object | 否 | `{fileId,width,height,failureId?}`；一单一图、≤500KB、jpg/png；**云存储路径统一 `orders/{ticket}/image.jpg`**（ticket 服务端签发不可猜）；`failureId?`=识别失败时关联**本单自己**的 `recognition_failures._id`（**v0.8 可选**；一图多码拆单的各单**共享同一 `fileId`、但 `failureId` 按单独立**，§4.9）；清理/匿名化后 `fileId=''`、`failureId=''` | 下单/`order.correct`/cleanup | 双方（临时 URL）；`failureId` 仅 admin | L3 |
| `exception` | object | 否 | `{code,text,fromStatus,by,at}`；code 六值、text≤200、fromStatus∈ACCEPTED/PICKED/DELIVERED、by∈PARTNER\|ADMIN | `order.reportException`/`resolveException` | 双方/admin | L2 |
| `deliveryNote`/`cancelReason` | string | 否 | `deliveryNote`≤100；`cancelReason`≤100 且值域见 §8.3（顾客 5/兼职 4/系统 1） | `order.markDelivered`/`order.cancel`/`order.reject`/cleanup | 双方 | L2 |
| `cancelledBy` | string | 否 | `CUSTOMER\|PARTNER\|SYSTEM\|ADMIN`；CANCELLED 必填 | 取消/拒绝/超时 | 双方/admin | L1 |
| `statusUpdatedAt` | Date | 是 | 最近状态变更（排序/cleanup 锚） | 状态动作 | 双方 | L1 |
| `acceptedAt`/`pickedAt`/`deliveredAt`/`completedAt`/`cancelledAt` | Date | 否 | 对应动作写、撤销清空；已送达/完成/取消即终态时间 | 状态动作 | 双方 | L1 |
| `deletedByCustomerAt`/`anonymizedAt` | Date | 否 | 删除记录仅 COMPLETED、7 天后物理删 / 匿名化时间（**cleanup 幂等判据**，禁止重复匿名化） | `order.deleteRecord`/cleanup | 双方（前者）/admin（后者） | L1/L2 |
| `batchActionId`/`clientRequestId` | string | 否/是 | ≤32 随机批量分组/16~32 位幂等键 | 批量动作/下单 | 内部 | L2 |
| `version` | number | 是 | 从 1 起、每次写 +1；乐观锁 | 所有写动作 | 双方（响应） | L1 |
| `createdAt`†/`updatedAt`† | Date | 是 | 服务端时间 | 下单/写动作 | 双方 | L1 |
| `claimTokenHash`†/`claimExpiresAt`†/`claimedAt`† | — | 否 | `[P1]` 代客单认领预留（MVP 不实现认领） | — | 内部/admin | L2 |

读屏蔽（DTO 分级）：`order.listCustomer`/`order.listPartner` 对**本人数据返回完整值**（顾客看自己的、兼职看自己订单的 `pickupCode/phoneTail/dorm`）；`admin.listOrders`/`admin.getOrder`/日志/通知/导出**一律默认脱敏**（`pickupCode` 打码、`phoneTail` 仅后 2 位、宿舍只到苑+楼栋、不显示 openid）；**完整 L3 只在只读视角**（`order.get` + `viewTicket`，审计）；`imageUrl` 只经 `order.imageUrl` 的 5 分钟临时 URL；任何 DTO 不得含 `*Openid/partnerId/clientRequestId/requestKey/claimTokenHash/cloudPath`；`customerNo/partnerNo` 可展示（双方看对方编号、admin 搜索锚），但**编号不参与鉴权**。**v0.9 订单 DTO 补充**：`order.get/listCustomer/listPartner` 可内联 `counterpart{displayName,avatarFileId?}`——**仅当前 ACTIVE 绑定关系内**返回（解绑/停用/注销后不再返回，历史单只留编号；O2 解绑即失联）；头像/昵称**不落订单快照**、按现查解析；后台默认过滤 `isTest=true` 订单（可切换查看并带 `TEST` 标签）；真实用户 DTO 永不返回测试单与 `isTest/impersonatedBy`。
### 2.6 `order_events`（全量状态流水）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`orderId` | string | 是 | 自增/orders._id（均不返回客户端） | 所有订单写动作 | 内部 | L2 |
| `orderNo` | string | 是 | 冗余快照，便于对账 | 同上 | 双方/admin | L1 |
| `type` | string | 是 | **16 种**事件（§8.4；无任何支付/收款类） | 同上 | 双方（裁剪） | L1 |
| `fromStatus`/`toStatus` | string | 是 | 订单状态；创建事件 fromStatus=`''`；非状态事件两者=当前状态 | 同上 | 双方 | L1 |
| `actorRole`/`actorId` | string | 是 | `CUSTOMER\|PARTNER\|ADMIN\|SYSTEM`/openid 或 `SYSTEM`；**真实账号只读会话下写动作不存在**；`TEST_WRITE` 会话的写事件 `actorId` = **目标测试账号合成 openid（effectiveOpenid）**，同时记 `impersonatedBy=developerNo`（§0.5） | 同上 | admin/内部 | L1/L2 |
| `impersonatedBy` | string | 否 | **v0.9**：仅 `TEST_WRITE` 会话写入=发起 `developerNo`（如 `DEV-01`）；真实流程为空串；只对 admin/测试会话可见，真实用户 DTO 不返回 | 同上 | admin | L1 |
| `at` | Date | 是 | 服务端时间 | 同上 | 双方/admin | L1 |
| `note`/`payload` | string/object | 否 | ≤100 字/`{before,after,undoneAction,reason,code,...}`；不得含截图、完整手机号、金额键 | 同上 | 双方/仅 admin | L2 |
| `requestKey` | string | 否 | 唯一索引 `{orderId}:{action}:{clientRequestId}` | 状态动作 | 内部 | L2 |

读屏蔽：不直读；`order.get` 返回裁剪事件（`type/at/actorRole/note`，去 `actorId/payload`）；消息中心只聚合状态类事件；`payload.before/after` 只对 admin；只读视角同样只给裁剪事件。
### 2.7 `order_messages`（订单留言）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`orderId` | string | 是 | 自增/orders._id | 云函数 | 内部 | L2 |
| `fromRole` | string | 是 | `CUSTOMER`/`PARTNER`（admin 只读） | `message.send` | 双方 | L1 |
| `fromId` | string | 是 | openid（`TEST_WRITE` 会话写 **effectiveOpenid**=目标测试账号合成 openid）；不返回对方明文 | `message.send` | 内部 | L2 |
| `text` | string | 是 | ≤200 字；必须过 `security.msgSecCheck` v2 | `message.send` | 双方 | L2 |
| `templateCode` | string | 否 | 快捷模板码；**模板只含状态/地址/时间类话术，无金额模板**；无则 null | `message.send` | 双方 | L1 |
| `createdAt`/`readAt` | Date | 是/否 | 服务端时间/接收方已读（发送方自己视为已读） | `message.send`/`message.markRead` | 双方 | L1 |

读屏蔽：仅订单双方；`fromId` 不返回（前端用 `fromRole` 判断左右）；admin 只读异常工单留言且不下发 openid；只读视角可读目标订单留言。
### 2.8 `invitation_codes`（开发者发邀请码；旧 `activation_codes` 更名，术语统一“邀请码”）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`code` | string | 是 | 自增/唯一索引；12 位 32 字母表（§4.3），落库去横杠大写 | `admin.createInvites`/`partner.activate` | admin | L2 |
| `status` | string | 是 | `UNUSED`/`USED`/`REVOKED`/`EXPIRED`；**不存在“重新生效”** | 发码/激活/作废/cleanup | admin/激活内部 | L1 |
| `batchId`/`expiresAt` | string/Date | 是 | 发码批次 `B20261021-01`/过期时间（`expiresAt` 必填、不可 null） | `admin.createInvites` | admin | L1 |
| `usedBy`/`usedAt` | string/Date | 否 | 使用人=`partners._id`（激活创建；注销时置空并保留审计）/使用时间 | 激活/注销 | admin | L2 |
| `note`/`createdBy` | string | 否/是 | 备注 ≤50 字/发码人 `developerNo`（如 `DEV-01`） | `admin.createInvites` | admin | L2 |
| `createdAt`†/`revokedAt`†/`revokedBy`† | Date/string | 是/否/否 | 创建/作废/作废人 `developerNo` | 发码/作废 | admin | L1/L2 |

读屏蔽：只对 admin；`admin.createInvites` 当次响应返回完整码（整批可复制），`admin.listInvites` 对 admin 返回完整码（作废锚）+状态/批次/有效期/使用人（`partnerNo`+昵称）/时间；**顾客/兼职端永不返回完整码**；`admin_audit.detail` 与日志只记 `codeTail`（后 4 位）；激活时按完整码精确匹配，状态判定见 §4.3。
### 2.9 `counters`（原子计数；键族 v0.8）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`key`/`seq`/`updatedAt` | string/number/Date | 是 | 自增/唯一索引键/整数只增不减/最近自增（`rl:` 清理依据） | 事务内写 | 内部 | L2 |

键族（**不设 `tagSeq`、不设编号计数器**——`customerNo`/`partnerNo`/`failureNo` 用随机+唯一索引，**不用自增**）：`orderNo:YYYYMMDD`（当日订单序号，UTC+8，不清理）｜`tag:{partnerId}:{dormKey}`（roomTag 序号，不清理，旧标签永不复用）｜`rl:{scope}:{openid}:{window}`（限流，`scope`≥`bind/activate/order/message/viewAs/ai`，`window`=日/小时，cleanup 每日清过期；`ai` 为 v0.8 识别兜底 5 次/人/日）。
读屏蔽：不返回客户端；只以 `orderNo`/`roomTag`/`RATE_LIMITED` 形式出现。
### 2.10 `config`（单文档 `_id='global'`；**无金额项**）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `zoneLabels` | object | 是 | `{D:'D 区',X:'X 区',N:'N 区',B:'B 区',C:'C 区'}`；正式苑名待用户给（D8 只改配置） | `admin.updateConfig` | 登录用户（公开子集） | L1 |
| `serviceCatalog` | object[] | 是 | **只有** `{code,name,desc}`；5 默认服务模板；**无价格/金额字段** | `admin.updateConfig` | 顾客/兼职（公开子集） | L1 |
| `announcement`/`maintenance` | object | 是 | `{enabled,title,text,updatedAt}`/`{enabled,text}`；维护中除 admin 外写接口 `INVALID_STATE` | `admin.updateConfig` | 登录用户 | L1 |
| `orderTimeoutMinutes`/`autoCompleteHours`/`screenshotRetentionDays` | number | 是 | 默认 120/24/7，整数正数 | `admin.updateConfig` | 登录用户（公开子集）/内部 | L1 |
| `recognitionFailureRetentionDays` | number | 是 | **v0.8**：识别失败记录与原图引用保留天数，**7~30，默认 30**（§10.1；到期 cleanup 删原图引用并置 `IGNORED`）；**可后台配**（在 `admin.updateConfig` 白名单内）；**不下发客户端** | `admin.updateConfig` | 仅 admin/内部 | L1 |
| `aiFallback` | object | 是 | **v0.8**：`{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}`；默认 `{enabled:true,model:'deepseek-chat',timeoutMs:8000,maxPerUserPerDay:5,dailyQuota:200,cooldownMinutes:10}`；值只含布尔/字符串/整数次数与毫秒，**无金额字段、无 API Key**（`DEEPSEEK_API_KEY` 只在云函数环境变量，§7.9）；`enabled=false` 即整体关停（不调、直接入队）；**MVP 后台只读展示、不开放编辑**——`admin.updateConfig` 白名单**不含该键**（P1 再开），改值走部署配置脚本/控制台，且必须与隐私文本同步、落 `admin_audit`；**不下发客户端** | 部署配置脚本/控制台（MVP 不开放后台编辑） | 仅 admin（只读展示）/内部 | L1 |
| `viewTicketTtlMinutes` | number | 是 | **切换会话票据**有效期（真实账号只读/测试账号可写同一参数），默认 30，范围 5~60（§1.2/§1.3）；**不下发客户端**（治理参数） | `admin.updateConfig` | 仅 admin（`admin.stats`） | L1 |
| `avatarMaxBytes` | number | 是 | **v0.9**：头像文件大小上限，默认 **204800（200KB）**，范围 102400~512000；由 `upload.prepare(purpose='AVATAR')` 与资料保存校验引用；`config.getPublic` 下发（客户端压缩阈值） | `admin.updateConfig` | 登录用户（公开子集）/内部 | L1 |
| `testAccountMaxPerRole` | number | 是 | **v0.9**：每位开发者每角色测试账号上限，默认 **3**（合计 ≤6）；`admin.createTestAccount` 校验，超限 `VALIDATION_FAILED` | `admin.updateConfig` | 仅 admin/内部 | L1 |
| `testDataRetentionDays` | number | 是 | **v0.9**：测试业务数据保留天数，默认 **30**（7~90）；cleanup 清理超期未使用（`users.testLastUsedAt`/`createdAt`）的测试数据（账号保留） | `admin.updateConfig` | 仅 admin/内部 | L1 |
| `subscribeTemplates`† [P1] | object | 否 | `{enabled,newOrderTemplateId?,statusTemplateId?,exceptionTemplateId?}`；订阅消息**模板 ID/开关/文案统一存 config**（不放云函数环境变量、不硬编码）；未授权时降级站内轮询 | `admin.updateConfig` | 内部（`config.getPublic` 只下发 `subscribeEnabled`，不下发模板 ID） | L1 |
| `privacyVersion`/`updatedAt` | string/Date | 是 | 与《隐私保护指引》一致/最近修改 | `admin.updateConfig` | 登录用户（version）/内部 | L1/L1 |

读屏蔽：客户端不直读；`config.getPublic` 返回 `{zoneLabels,serviceCatalog,announcement,maintenance,privacyVersion,orderTimeoutMinutes,autoCompleteHours,screenshotRetentionDays,avatarMaxBytes,viewTicketTtlMinutes,subscribeEnabled}`（`serviceCatalog` 不含费用字段；**不含 `recognitionFailureRetentionDays`/`aiFallback`/`testAccountMaxPerRole`/`testDataRetentionDays`/`subscribeTemplates`**）；`user.bootstrap` 内联同一 `configPublic`；admin 读配置由 `admin.stats` 复合返回（§7.6，`aiFallback` 只读展示）。`recognitionFailureRetentionDays`/`avatarMaxBytes`/`testAccountMaxPerRole`/`testDataRetentionDays`/`viewTicketTtlMinutes` 由 `admin.updateConfig` 白名单维护（逐项范围校验，改动落 `admin_audit{CONFIG_UPDATE}`）；**`aiFallback` 的写入不在 `admin.updateConfig` 白名单内**（MVP 只读；改值走部署配置脚本/控制台并同步隐私文本）。
### 2.11 `admin_audit`（管理操作审计）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | 自增 | 云函数 | 内部 | L2 |
| `adminOpenid` | string | 是 | 白名单 openid；系统任务=`SYSTEM`（不返回客户端明文） | admin 动作/cleanup | admin | L2 |
| `developerNo` | string | 是 | 环境映射给出（`DEV-01`）；系统任务=`SYSTEM`；**只用于审计/后台抬头，不是鉴权凭据** | 同上 | admin | L1 |
| `action` | string | 是 | `INVITE_CREATE`/`INVITE_REVOKE`/`PARTNER_SUSPEND`/`PARTNER_RESTORE`/`CONFIG_UPDATE`/`ORDER_ANOMALY_CANCEL`/`BOOTSTRAP`（CONTRACT 要求的最小集，`MANUAL_DB_FIX`† 为控制台人工处置）、`CLEANUP`（系统任务）、**v0.8 增 `FAILURE_IMAGE_VIEW`/`FAILURE_FIX`/`FAILURE_IGNORE`**（识别失败复核三审计）、**v0.9 增切换会话 `ACCOUNT_SWITCH_START`/`ACCOUNT_SWITCH_END`/`ACCOUNT_SWITCH_EXPIRED`（统管真实账号只读与测试账号可写两种模式；`detail` 含 `viewMode/targetNo/targetIsTest`）与测试账号管理 `TEST_ACCOUNT_CREATE`/`TEST_ACCOUNT_DELETE`/`TEST_DATA_PURGE`（清理审计含前后条数）**；**旧名 `VIEW_AS_START/VIEW_AS_END/VIEW_AS_EXPIRED` 作废**（v0.9 审计补丁，统一为 `ACCOUNT_SWITCH_*`） | 同上 | admin | L1 |
| `target` | object | 是 | `{type:'partner'\|'customer'\|'order'\|'invitation_code'\|'view_session'\|'config'\|'recognition_failure'\|'test_account',id}`（`recognition_failure` 的 `id`=`failureNo`，v0.8；`test_account` 的 `id`=`TEST-<random>` 或 `customerNo/partnerNo`，v0.9） | 同上 | admin | L2 |
| `detail` | object | 是 | 变更前后关键字段；**禁止完整取件码/手机尾号/截图路径/完整 openid/完整邀请码/头像 fileId/完整昵称**（只记 `codeTail`；昵称按 `maskDisplayName`）；编号 `customerNo/partnerNo` 可记；**v0.9**：切换会话记 `{viewMode,role,targetNo,targetIsTest}`，测试数据清理记 `{before,after}` 条数 | 同上 | admin | L2 |
| `at`/`requestKey`† | Date/string | 是/否 | 服务端时间/幂等键 `{adminOpenid}:{clientRequestId}`（唯一索引） | 同上 | admin/内部 | L1/L2 |

读屏蔽：仅 admin；MVP 不建独立 audit 页，日志区块并入 `pkg-admin/pages/overview/index`（`admin.stats.recentAudit` / `admin.listAudit`）。
### 2.12 `upload_tickets`（截图上传票据）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id`/`ticket` | string | 是 | 自增/唯一索引；32 位随机 `[A-Za-z0-9]` 不可猜 | `upload.prepare` | 仅签发响应一次 | L3 |
| `openid`/`cloudPath` | string | 是 | **effectiveOpenid**（真实身份，或 `TEST_WRITE` 会话下的目标测试账号合成 openid）/服务端生成路径：`purpose='TICKET'`→`orders/{ticket}/image.jpg`、`purpose='AVATAR'`→`avatars/{role}/{random}.jpg`（ticket 不可猜、不嵌 openid/orderId）、客户端不得自拟 | `upload.prepare` | 内部 | L2/L3 |
| `purpose`† | string | 是 | **v0.9**：`'TICKET'`（订单截图）/`'AVATAR'`（头像）；**票据用途绑定**——TICKET 票据不能当 AVATAR 用、反之亦然（下单/资料保存时校验，不符 `VALIDATION_FAILED`）；AVATAR 票据 5 分钟有效、消费后写 `avatarFileId` | `upload.prepare` | 内部 | L2 |
| `draftId`† | string | 是 | 客户端生成 16~32 位；随票据带回、下单校验一致 | `upload.prepare` | 内部 | L2 |
| `expiresAt`/`createdAt` | Date | 是 | 签发+5 分钟/签发时间 | `upload.prepare` | 内部 | L1 |
| `usedAt` | Date | 否 | 下单/资料保存成功消费时间（`purpose` 各自消费一次）；null=未消费；**MVP 创建失败不消耗、可重用至过期** | 下单成功/头像保存 | 内部 | L1 |

票据校验（下单时）：ticket 存在且 `openid===ctx.effectiveOpenid`（`READONLY` 下等于当前 OPENID；`TEST_WRITE` 下为目标测试账号合成 openid）且 `usedAt===null` 且 `expiresAt>serverNow` 且 `cloudPath` 与 fileId 前缀一致且文件 ≤500KB、jpg/png。错误映射（只认 §7.2 的 13 码，**无 `CODE_EXPIRED`/`CODE_USED`**）：不存在/非本人→`NOT_FOUND`（不区分，避免枚举）；已过期/已使用→`INVALID_STATE`（message 提示“上传凭证已失效，请重新上传”）；路径/大小/类型不符→`VALIDATION_FAILED`（`data.field='image'`）。**v0.9 头像票据**：`upload.prepare({purpose:'AVATAR'})` → `cloudPath='avatars/{role}/{random}.jpg'`（**不含 openid**、随机不可枚举）；`customer.saveProfile`/`partner.saveProfile` 消费票据时校验 `purpose='AVATAR'`、归属=`effectiveOpenid`、`expiresAt>now`、`usedAt=null`、路径前缀/大小/类型（≤`config.avatarMaxBytes` 默认 200KB、jpg/png）；通过后写 `avatarFileId`、票据置 `usedAt`；**替换头像即删旧文件**；**头像票据不能用于订单截图，订单截图票据（TICKET）不能用于头像**；头像不占用订单截图路径 `orders/{ticket}/image.jpg`。**v0.8 识别失败引用**：`ai.parseParcel` 入参 `uploadTicketId` 即本集合 `ticket` 值，入队时写 `recognition_failures.uploadTicketId`（不复制 `cloudPath`）；同一 `fileId` 被 `orders.image` 与 `recognition_failures` 同时引用时保留期取较长者（订单 7 天 / 复核 30 天，§10.1）。读屏蔽：无客户端读接口。
### 2.13 `admin_view_sessions`（开发者切换会话票据：真实账号只读 / 测试账号可写，§1.2/§1.3）

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | **=viewTicket**；32 位随机 `[A-Za-z0-9]`（crypto，不可猜、不可枚举） | `admin.viewAsStart` | 仅持有票据的开发者（内存传递）/cleanup | L2 |
| `adminOpenid` | string | 是 | 白名单开发者 openid；每次请求校验仍在 `ADMIN_OPENIDS` | 同上 | 内部/admin | L2 |
| `developerNo` | string | 是 | 环境映射（`DEV-01`）；审计/后台抬头用；**测试写会话的 `impersonatedBy` 取此值** | 同上 | admin | L1 |
| `viewMode` | string | 是 | **v0.9**：`'READONLY'`（真实账号，只读，=原只读视角）/ `'TEST_WRITE'`（测试账号，可写）；**真实账号只允许 `READONLY`**，传 `TEST_WRITE` 在签发时 `FORBIDDEN`（§7.6） | 同上 | admin | L1 |
| `role` | string | 是 | `CUSTOMER`/`PARTNER`（两种模式均只覆盖这两类业务角色） | 同上 | admin | L1 |
| `targetId` | string | 是 | 目标主键：顾客 openid / `partners._id` | 同上 | 内部 | L2 |
| `targetNo` | string | 是 | 目标编号：`customerNo`/`partnerNo`（完整编号搜索入口） | 同上 | admin | L1 |
| `targetDisplayName` | string | 否 | 目标显示名快照（黄条/蓝条展示，≤20；`READONLY` 按目标本人视角展示，后台列表仍脱敏） | 同上 | admin | L2 |
| `targetIsTest` | boolean | 是 | **v0.9**：目标是否测试账号（=目标 `users.isTestAccount` 快照）；`viewMode='TEST_WRITE'` 时必须为 `true`（双保险，每次请求校验） | 同上 | admin | L1 |
| `targetAvatarFileId` | string | 否 | **v0.9**：目标头像快照（可空→默认头像）；**仅用于切换会话内页头/`viewContext` 一致展示**，后台列表/详情/导出/通知/分享均不含 | 同上 | admin | L2 |
| `createdAt`/`expiresAt` | Date | 是 | 创建时间/`createdAt+config.viewTicketTtlMinutes`（默认 30 分钟，5~60） | 同上 | admin | L1 |
| `endedAt` | Date | 否 | 主动结束/过期/目标失效时写入；null=有效 | `admin.viewAsEnd`/cleanup/过期检测 | admin | L1 |
| `requestKey`† | string | 是 | 唯一索引 `{adminOpenid}:{clientRequestId}`；**同 `clientRequestId` 重复开启幂等返回同一票据**（`data.duplicated=true`）；换 `mode` 视为新请求（新开覆盖旧的，§7.7） | `admin.viewAsStart` | 内部 | L2 |

不变量（v0.9）：①同一开发者**同时只有一个有效票据**（新开覆盖旧的：旧票据立即置 `endedAt` 并记 `ACCOUNT_SWITCH_END`，`detail.reason='REPLACED'`）；②票据只在客户端内存（`app.globalData.viewContext`），**不写本地存储**，冷启动丢失；③每次请求都校验票据存在、未过期、`endedAt` 为空、发起人仍在白名单、目标仍 `ACTIVE`（否则 `FORBIDDEN` 并置 `endedAt`）；④**`READONLY`**：写动作见票据一律 `FORBIDDEN`（双保险）；**`TEST_WRITE`**：仅当 `targetIsTest=true && viewTicket.targetId===effectiveOpenid` 时允许业务写动作（以目标测试账号身份执行，落 `impersonatedBy`），**后台动作一律不接受票据**；⑤票据过期→`VIEW_TICKET_EXPIRED`（`READONLY` 记 `ACCOUNT_SWITCH_EXPIRED`、`TEST_WRITE` 同）；`cleanup` 清理过期/结束超过 7 天的会话（§10.2）；⑥**删除测试账号时，其全部相关会话立即 `endedAt`**（`detail.reason='TARGET_DELETED'`，审计补丁）。读屏蔽：客户端无集合读接口；后台不展示他人票据。
### 2.14 `recognition_failures`（识别失败复核队列；v0.8 第 14 个集合，含原图引用）
> 写入方=`ai.parseParcel`（唯一入队入口：识别失败/低置信时插入）+ `admin.fixRecognitionFailure`/`admin.ignoreRecognitionFailure`/cleanup（只改 `status/resolution/reviewedAt`，fix 另回填 `orderId`）；**客户端零直读**（数据库规则全拒），仅白名单开发者经云函数；**记录粒度=订单 × 截图**（同图多单各一条、`failureId` 按单独立、未建单 `orderId=''`，§4.9）；字段逐字对齐 CONTRACT §4 行 + §4.3。

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `_id` | string | 是 | 自增；仅内部关联用，永不返回客户端 | 云函数 | 内部 | L2 |
| `failureNo` | string | 是 | **唯一索引**；`F-YYYYMMDD-XXXXXX`（`F`+日期+6 位 32 字母表随机，服务端生成、**不走 counters**、碰撞重试 ≤5 次→`DEPENDENCY_FAILED`）；仅后台/日志锚，**不作鉴权**（§4.9） | `ai.parseParcel` | admin | L1 |
| `requestKey`† | string | 是 | **唯一索引** `{uploaderOpenid}:{clientRequestId}`；同一次逐单调用的重试幂等返回同一 `failureId`（`duplicated:true`）；**同图多单逐单调用各自独立**（不按文本相似度合并）；仅内部 | `ai.parseParcel` | 内部 | L2 |
| `failureCode` | string | 是 | `NO_TEXT`（OCR 无文本）/`PARSE_MISS`（有文本但规则+AI 均缺站点或码）/`LOW_CONFIDENCE`（AI 低置信）/`LLM_ERROR`（AI 不可用/超限/解析失败）/`IMAGE_UNREADABLE`（图片打不开/压缩失败）——**5 值逐字对齐 CONTRACT §4.3** | `ai.parseParcel` | admin | L1 |
| `sourceRole` | string | 是 | `CUSTOMER`/`PARTNER`（上传者提交时的业务角色） | `ai.parseParcel` | admin | L1 |
| `uploaderOpenid` | string | 是 | 上传者 openid（测试会话上传时=目标测试账号**合成 openid `TEST-<random>`**）；**永不返回客户端明文**（后台显示脱敏编号/昵称，仅审计内部可追溯） | `ai.parseParcel` | 内部/admin（脱敏） | L2 |
| `uploadTicketId` | string | 是 | 上传票据标识=`upload_tickets.ticket` 值；入队时校验归属（非本人/过期仍入队供排查，记 `ruleResult.ticketInvalid=true`）；**不返回客户端** | `ai.parseParcel` | 内部/admin | L2 |
| `fileId` | string | 是 | 原图云存储 `fileId`（与 `orders.image.fileId` 可同源共享；**同图多单/多条记录共享时按文件引用计数清理**；只经云函数临时 URL 查看，不落任何列表 DTO） | `ai.parseParcel` | admin（复核页临时 URL） | L3 |
| `orderId` | string | 否 | 关联订单 `orders._id`；**未建单时 `''`**，建单/补码后回填**本记录自己**那条订单（不返回客户端，后台展示 `orderNo`） | `ai.parseParcel`/`fixRecognitionFailure`（回填） | admin（显 `orderNo`） | L2 |
| `ocrTextMasked` | string | 是 | 服务端二次去敏后的 OCR 文本，**≤2000 字**；掩码手机号/身份证/连续长数字，去掉详细门牌；不含原图 | `ai.parseParcel` | admin | L2 |
| `ruleResult` | object | 是 | 端侧规则解析快照 `{stationId,stationName,pickupCode,trackingTail,lockerNo,codeStatus,conflicts[],ticketInvalid}`；`conflicts` 记冲突原因码（如 `STATION_MISMATCH/CODE_CONFLICT`） | `ai.parseParcel` | admin | L2 |
| `aiTried`/`aiModel` | boolean/string | 是 | 是否已发起外呼 / 模型名快照（`config.aiFallback.model`；未外呼时 `aiModel=''`） | `ai.parseParcel` | admin | L1 |
| `aiResult` | object | 否 | AI 格式化返回快照 `{recognized,stationId,stationName,pickupCode,trackingTail,lockerNo,confidence}`；未外呼/失败=null | `ai.parseParcel` | admin | L2 |
| `aiErrorCode` | string | 否 | 内部排障码 `TIMEOUT`/`HTTP_5XX`/`QUOTA_EXCEEDED`/`CIRCUIT_OPEN`/`PARSE_ERROR`/`DISABLED`/`''`；**不映射业务错误码、不新增错误码**（§7.9） | `ai.parseParcel` | admin | L1 |
| `status` | string | 是 | `PENDING`→`FIXED`（补录）/`PENDING`→`IGNORED`（忽略或到期）；`FIXED/IGNORED` 终态、**不可重开**（§7.9 状态机） | `admin.fixRecognitionFailure`/`ignoreRecognitionFailure`/cleanup | admin | L1 |
| `resolution` | object | 否 | `{stationId,stationName,pickupCode,note,by,at}`：fix 时识别字段 ≥1 个有效 + `note?`≤100；ignore 时 `note` **必填**≤100；到期 cleanup 置 `note='EXPIRED'`；`by=developerNo\|'SYSTEM'` | 同上 | admin | L2 |
| `retentionDays` | number | 是 | 入队时快照 `config.recognitionFailureRetentionDays`（7~30，默认 30；记录级固化，改配置不影响已入队记录；见 §10.1 与 `†` 报备 §13.2） | `ai.parseParcel` | admin | L1 |
| `createdAt`/`reviewedAt` | Date | 是/否 | 入队时间/复核完成时间（`PENDING` 时 `reviewedAt=null`） | 入队/复核/cleanup | admin | L1 |

读屏蔽：仅白名单开发者经 `admin.listRecognitionFailures`（列表**不含 `fileId`/`uploaderOpenid`**，上传人显示脱敏编号+昵称）与 `admin.getRecognitionFailure`（返回原图**临时 URL 5 分钟** + 上述字段；**每次查看审计 `FAILURE_IMAGE_VIEW`**）。**客户端零读接口**；`ocrTextMasked` 只在后台出现，不进顾客/兼职页面、不进通知/日志、不整段落日志。**不提供批量查看/下载/导出**（CONTRACT §1.1 例外条款）；无 `PENDING` 记录时后台红点为 0（`count()` 现算）。
## 3. 冗余快照与派生规则
允许冗余（写时快照、之后不可变）：`orders.dorm.*`（来源 customers+当前 binding.roomTag，下单写，匿名化置空）｜`orders.guest.*`（代客单填写，下单写，匿名化置空）｜`orders.phoneTail`（同源快照，匿名化置空；**v0.9 起订单不存昵称/头像快照**，对方昵称/头像按当前 ACTIVE 绑定关系现查）｜`orders.parcel.*`（截图识别/用户确认，仅 `order.correct` 可改，匿名化清码/尾号/柜号/站名、保留 stationId）｜`orders.service.{code,name}`（下单快照，服务改名不影响历史单，**无金额**）｜`bindings.dormSnapshot`（绑定成功写死，换宿舍走重绑，注销随绑定清理）｜`order_events.orderNo`（对账快照）｜`orders.customerOpenid/partnerOpenid`（身份快照，匿名化清空）｜**`orders.customerNo/partnerNo`（编号快照，下单/接单时写，仅展示与后台搜索，不参与鉴权，匿名化清空）**｜`orders.parcel.recognitionSource/confidence`（v0.8 识别写入时快照：手改过字段→`MANUAL`、AI 兜底被采纳→`DEEPSEEK`、规则直接可用→`RULE`；**AI 不覆盖用户手填**）｜`orders.image.failureId`（**本单自己**的 `recognition_failures._id`，一次关联；同图多单各自独立；不复制原图/OCR 文本，cleanup 清空）｜**`orders.isTest`（参与账号 `isTestAccount` 快照，服务端派生、写一次不改）与 `orders.impersonatedBy`（`TEST_WRITE` 会话 `developerNo`，真实流程空）**。
禁止冗余：待处理红点/角标（count 现算）｜订单进度/时间线（`order_events` 现查）｜未读数（`users.messageReadAt`+count）｜`urgent`（由 `service.code==='PICKUP_URGENT'` 派生）｜单量（查询或聚合现算，`partners.stats` 只是可重算缓存；**无收入类冗余**）｜`profileCompleted`（写入时重算一次以便索引）｜**编号（`customerNo`/`partnerNo`/`failureNo` 只存所属文档，orders 只存编号快照；不另建编号索引表/计数器）**｜**识别失败队列（独立集合，只引用 `fileId/orderId`，不复制订单 PII、不反向写 orders）**｜**头像/昵称冗余（不把 `avatarFileId/displayName` 复制进订单、绑定或对方文档；一律按当前 ACTIVE 绑定关系现查，CONTRACT §11.1）**｜**测试标记冗余（`isTest` 只按参与账号派生，不在邀请码/统计/红点里另存）**。
一致性：快照只写一次（除 CONTRACT §5.1 允许的 correct/状态字段），禁止“顺手同步”（v3 TD-022 自动补名前缀失配教训）；绑定变更不影响历史订单；统计缓存可重建；匿名化≠删除（`anonymizedAt` 幂等，物理删除才移除文档）；**编号一旦生成不可修改，历史订单快照也不随资料变更**；识别兜底与复核补录只改 `parcel` 识别字段（`version+1`、`status/statusUpdatedAt` 不变、**不写 `order_events`**，§7.9）；`isTest/impersonatedBy` 写一次不改；测试数据不计统计、不改真实数据；头像/昵称不冗余（解绑即失联）。
## 4. ID 与编号（双角色唯一编号 + 邀请码 + 切换会话票据 + 测试账号合成 openid）
### 4.1 总表

| 标识 | 所属 | 生成方 | 格式/唯一性 | 可变 | 对外 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `openid`/`_id` | 用户/各集合 | 微信平台/自增或 `openid` | 平台唯一/主键；均仅内部 | 否 | 否 |
| `customerNo` | customers（orders 存快照） | `customer.saveProfile`/`user.bootstrap`（首次建资料，幂等）/`admin.createTestAccount`（测试顾客同理生成） | `C-XXXX-XXXX`（C+8 位）、唯一索引 | 否 | 是（本人/绑定兼职/开发者/只读视角） |
| `partnerNo` | partners（orders/绑定 DTO 存快照） | `partner.activate` | `P-XXX-XXX`（P+6 位）、唯一索引 | 否 | 是（**绑定唯一凭据**，可分享） |
| `developerNo` | 环境映射 → `admin_audit`/`admin_view_sessions` | `ADMIN_OPENIDS` JSON（`{"<openid>":"DEV-01"}`） | `DEV-01`（可 `DEV-02`…）；**不落业务表** | 否 | 后台抬头/审计 |
| `invitationCode` | invitation_codes | `admin.createInvites` | 12 位 32 字母表、唯一索引 | 否 | admin（完整）/激活入参 |
| `orderNo` | orders | 下单事务 | `YYYYMMDD-XXXX`、唯一索引 | 否 | 是（双方） |
| `failureNo` | recognition_failures | `ai.parseParcel` | `F-YYYYMMDD-XXXXXX`（F+日期+6 位 32 字母表随机）、唯一索引；**不走 counters** | 否 | 仅 admin（后台/日志锚，不作鉴权） |
| `roomTag` | bindings/orders | `bind.create` 事务 | **大写字母** Excel 式（`A…Z/AA…`）、（兼职,dormKey）内唯一；展示 `D4-522A` | 否 | 是（展示） |
| `dormKey` | customers/bindings/orders | 服务端 derive | `D4-522`、逻辑唯一 | 否 | 是 |
| `viewTicket` | admin_view_sessions | `admin.viewAsStart` | 32 位随机、`_id` 主键；`viewMode='READONLY'\|'TEST_WRITE'` | 否 | 仅开发者内存持有 |
| 测试账号 `_id`/openid | users/customers/partners | `admin.createTestAccount` | **`TEST-<random>`**（随机、唯一、非空串、不来自微信；三处同值） | 否 | 仅切换会话/后台管理 |
| `avatarFileId` | customers/partners | `customer.saveProfile`/`partner.saveProfile`（消费 `upload.prepare({purpose:'AVATAR'})` 票据） | 云存储 fileID（`avatars/{role}/{random}.jpg`），**不含 openid**、随机不可枚举 | 替换即删旧 | 仅本人/ACTIVE 绑定对方 |
| `clientRequestId` | 写动作入参 | 客户端 | 16~32 位 | — | 否 |
| `requestKey` | orders/order_events/admin_audit/admin_view_sessions | 服务端 derive | §4.7、唯一索引 | 否 | 否 |
| `batchActionId` | orders | 客户端 | ≤32 随机、批次内 | 否 | 否 |
| `ticket`/`draftId` | upload_tickets | 服务端/客户端 | 32 位随机/16~32 位 | 否 | 仅响应一次 |

不走 `counters` 的编号：`customerNo`/`partnerNo`/`failureNo` 以及测试账号 `_id='TEST-<random>'` **不用自增、不按注册顺序**（防枚举与推算），由随机+唯一索引生成（§4.2/§4.9/§4.10）。
### 4.2 双角色唯一编号规格（CONTRACT §3.1，用户二次修订②）

| 角色 | 字段 | 组成 | 展示样式 | 示例 | 校验（去空白/连字符、转大写后） |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 顾客 | `customers.customerNo` | `C` + 8 位 | `C-XXXX-XXXX`（4+4 分组） | `C-7K2M-9QX4` | `^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$` |
| 兼职 | `partners.partnerNo` | `P` + 6 位 | `P-XXX-XXX`（3+3 分组） | `P-7K2-M9X` | `^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$` |
| 开发者 | `developerNo` | 固定可读 | `DEV-01` | `DEV-01` | 由白名单映射给出，不参与用户输入 |
| **测试账号** | `users._id=customers._id=partners.openid` | `TEST-` + 随机（生成规则同本节随机+唯一索引） | `TEST-<random>` | `TEST-a7k2m9qx` | 合成、非空串、不来自微信；`customerNo`/`partnerNo` 仍按真实格式生成；不参与登录，仅切换会话可达 |

字母表 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`（32 字符，去 `0/O/1/I` 等易混字符；CONTRACT §3.1）。**规则（硬）**：
1. **服务端生成**：加密安全随机（`crypto.randomBytes`+拒绝采样；不取自 openid、不自增、不按注册顺序）；唯一索引兜底；碰撞重试 ≤5 次，仍失败 `DEPENDENCY_FAILED`（后台告警）。
2. **生成时点**：`customerNo` 在顾客资料**首次创建成功**时生成（`user.bootstrap`/`customer.saveProfile` 内保证幂等：已有编号不重新生成）；`partnerNo` 在邀请码**激活成功、创建 `partners` 文档时**生成。
3. **不可修改、不复用**：生成后无任何动作可改；注销后编号作废、不再分配（随机空间：顾客 32^8≈1.1×10^12、兼职 32^6≈1.07×10^9，不设回收）。
4. **两种样式一眼可分**：前缀不同（C/P）、长度不同（8/6）、分组不同（4+4 / 3+3）；输入容错（空格、连字符、全角转半角、大小写归一）但**前缀必填**。
5. **错前缀提示**：顾客输入 `C…` 去绑定 → “这是顾客编号，请向兼职索取 P 开头的兼职编号”；输入 `DEV…` → “这是开发者编号，不能用于绑定”；格式不符 → 通用“兼职编号是 P 开头、共 6 位字母数字，请核对”。
6. **用途与可见性**：`customerNo` 只用于识别/客服/后台搜索，**不作为登录或绑定凭据**，仅本人、其绑定兼职、开发者可见；`partnerNo` 是顾客绑定的**唯一凭据**（完整编号），可分享卡片，但**永不提供搜索/列表/枚举接口**，限流 5 次/日/顾客（`partner.getPublic`/`bind.create` 共用）。
7. **展示**：顾客“我的”显示自己的编号（可复制）；兼职“我的”显示自己的编号（可复制/分享绑定卡片）；订单详情小字显示对方编号（顾客看 `partnerNo`、兼职看 `customerNo`）；后台列表/详情显示编号、**不显示 openid**；分享卡片只带 `partnerNo`，不带宿舍/尾号/称呼。
8. **索引**：`customers.uk_customer_no(customerNo,unique)`、`partners.uk_partner_no(partnerNo,unique)`；并发/碰撞靠唯一索引第二道闸（§5.1）。
9. **编号不是鉴权**：所有接口仍以 `OPENID` 推导身份；编号只作查询/展示/搜索条件，伪造编号不能越权（§6.2）。
10. **测试账号编号（v0.9）**：`admin.createTestAccount` 为测试账号生成**同格式** `customerNo`/`partnerNo` 与合成 openid `TEST-<random>`（`users._id`/`customers._id`/`partners.openid` 三处同值）；**全局唯一、不进入真实用户搜索结果**（`admin.listCustomers/listPartners` 默认排除测试账号；`partner.getPublic` 对测试账号返回 `NOT_FOUND`）；测试账号 `customerNo`/`partnerNo` 不得分享给真实用户。
11. **roomTag 恒大写**：编号规则不受影响；同寝室标识 `roomTag` 见 §9（`A…Z/AA…`，展示 `D4-522A`），旧小写口径作废。

```
genUniqueNo(tx, kind):            # customer→'C'+8位 / partner→'P'+6位；32 字母表、crypto+拒绝采样
  for i in 1..5:
    s = prefix(kind) + randomAlphabet(len(kind))
    if lookupUnique(tx,kind,s).empty: return s
  throw DEPENDENCY_FAILED          # 唯一索引兜底；5 次仍撞→DEPENDENCY_FAILED
```
### 4.3 `invitationCode` 生成与状态（旧“激活码”=邀请码）
- 生成 `admin.createInvites`：单次单个或批量 **≤50**（同批一个 `batchId`=`BYYYYMMDD-NN`）；有效期 **24h/72h/7d/30d**（`expiresInHours ∈ {24,72,168,720}`，默认 720 即 7 天；`expiresAt` 必填不可 null）；`note` ≤50 字；响应返回整批完整码（可整批复制）+ `batchId/expiresAt`。
- 字母表同 §4.2 生成 **12 位**（32^12），展示 `XXXX-XXXX-XXXX`、落库去横杠大写（CONTRACT §3）。一次性。
- 状态机（**不存在“重新生效”**）：`UNUSED→USED`（`partner.activate` 事务内）/ `UNUSED→REVOKED`（`admin.revokeInvite`，**仅 UNUSED 可作废**；已用/已过期不可作废）/ `UNUSED→EXPIRED`（cleanup 按 `expiresAt`，激活时也惰性判定）；`REVOKED/EXPIRED/USED` 终态。
- **错误映射（CONTRACT §5.3 的 13 码内）**：不存在/已作废→`NOT_FOUND`；已过期（或 `expiresAt≤serverNow`）→`INVITE_EXPIRED`；已使用→`INVITE_USED`；格式错误→`VALIDATION_FAILED`（`data.field='invitationCode'`）；该 openid 已有 partners→`CONFLICT`。
- 输出安全：`admin.createInvites` 当次响应与 `admin.listInvites` 对 admin 返回完整码；日志/审计只记 `codeTail`；顾客/兼职端永不出现完整码。

```
activatePartner(ctx, input):                 # partner.activate：邀请码激活 → 生成 partnerNo
  code=normalizeInvite(input.invitationCode)       # 去空白/连字符/全角、转大写；^[32字母表]{12}$ 否则 VALIDATION_FAILED
  if exists partners.openid==ctx.openid → CONFLICT；consumeRateLimit('activate') 5 次失败/日/openid
  return db.runTransaction(tx):
    row = tx.invitation_codes.where({code}).limit(1).get()
    if row.empty → NOT_FOUND；if USED → INVITE_USED；if REVOKED/EXPIRED/expiresAt<=now → NOT_FOUND/INVITE_EXPIRED
    partnerNo = genUniqueNo(tx,'partner')
    partner = tx.partners.add({openid,partnerNo,displayName,status:'ACTIVE',serviceConfig:default,stats:empty,activatedAt:now})
    tx.invitation_codes.doc(row._id).update({status:'USED',usedBy:partner._id,usedAt:now})
    tx.users.doc(ctx.openid).update({roles:add('PARTNER'),updatedAt:now}); return {partnerNo,partner}
```
### 4.4 `orderNo` 与计数事务
格式 `YYYYMMDD-XXXX`；日期=**服务器 UTC+8** 自然日；XXXX=当日全平台序号、4 位零填充。事务伪代码：

```
nextOrderNo(tx, now):
  day=formatDayUTC8(now); row=tx.counters.where({key:'orderNo:'+day}).limit(1).get()
  if row.empty: seq=1; tx.counters.add({key:'orderNo:'+day,seq:1,updatedAt:now})
  else: if row.seq>=9999 → ORDER_NO_EXHAUSTED(映射 INTERNAL_ERROR); seq=row.seq+1; tx.counters.doc(row._id).update({seq,updatedAt:now})
  return day+'-'+pad4(seq)
```

并发：事务内计数 + `orders.orderNo` 唯一索引第二道闸；`createBatch` 同事务连取 N 个序号（N≤5）；跨零点用服务器时间取日期；序号用尽属内部异常，统一返回 `INTERNAL_ERROR` 并告警 admin（分支名不暴露给客户端）。
### 4.5 `dormKey` / `buildingText`
`buildingText = zone + String(buildingNo)`（如 `D4`）；`dormKey = buildingText + '-' + room`（如 `D4-522`）。服务端 derive、客户端传值忽略；校验 `zone∈{D,X,N,B,C}`、`buildingNo` 整数 1~10、`room` 规范数字串（`/^[1-9][0-9]*$/` 且 ≥100、≤20 字符）。v3 旧写法（`3号楼`/`A302`）不进 v4 schema；v4 空库起（D11），手工导入须人工重填。
### 4.6 `roomTag` 分配（触发点）
**触发点=`bind.create` 成功时**：资料完整是绑定前提，未绑定不分配；绑定事务内按（兼职, 当前 dormKey）取号。**已绑定期间改宿舍（`customer.saveProfile`）**：仅当**无进行中订单**时才允许（否则 `INVALID_STATE`，提示先完成/取消）；变更走“旧 binding `RELEASED`（`CUSTOMER_INITIATED`，写 `releasedAt/releaseReason`）+ 同事务新建 binding（同兼职、新 dormKey）并重分配 roomTag”，**禁止原地改 `bindings.dormSnapshot`**；已存在订单保留创建时 `orders.dorm` 快照不受影响，旧 roomTag 不复用。算法/事务/边界见 §9。**v0.9：`roomTag` 恒大写**（1→A、26→Z、27→AA…），展示 `D4-522A`；旧小写算法作废（§9.1）；列表按 `dormKey + roomTag`（大写字母序）排序。
### 4.7 幂等账本
所有写 action 必传 `clientRequestId`（16~32 位 `[A-Za-z0-9_-]`，一次用户动作生成一次、重试复用）。去重键：`order.create`→`orders.requestKey={customerId|partnerId}:{clientRequestId}`（guest 用 partnerId）；`order.createBatch`→每条 `...:{itemIndex}`；订单后续动作→`order_events.requestKey={orderId}:{action}:{clientRequestId}`；绑定→`bindings.activeKey` 自然唯一；**激活→`invitation_codes.code` 状态机 + `partners.openid` 唯一**；**只读视角开启→`admin_view_sessions.requestKey={adminOpenid}:{clientRequestId}`（重复请求返回同一票据）**；admin 写→`admin_audit.requestKey†={adminOpenid}:{clientRequestId}`。重复请求返回当前对象+`data.duplicated=true`（不报错、不再写事件）。禁止把 `clientRequestId` 当操作时序依据。**v0.9 键**：`TEST_WRITE` 会话的写动作以目标测试账号身份生成幂等键（`{effectiveOpenid}:{clientRequestId}`，与真实身份不共用，防票据挪用）；`admin.createTestAccount/deleteTestAccount/purgeTestData` 用 `admin_audit.requestKey†={adminOpenid}:{clientRequestId}`；头像上传 `upload.prepare(purpose='AVATAR')` 票据一次性消费（`usedAt`）；`viewAsStart` 同 `clientRequestId` 幂等返回同一票据（换 `mode` 视为新请求）。
### 4.8 跨集合写事务（伪代码）
**A. 创建订单（`order.create`，顾客或兼职 guest）**

```
createOrder(ctx, input):
  if CUSTOMER: customer=loadCustomer(ctx.effectiveOpenid); assert profileCompleted; binding=loadActiveBinding
    partner=loadPartner(binding.partnerId); assert partner.status=='ACTIVE' && partner.serviceConfig.acceptingOrders  # 否则 PARTNER_CLOSED
    assert customer.isTestAccount==loadUser(partner.openid).isTestAccount   # v0.9 真实×测试互下单 → FORBIDDEN（partners 不存该标记，按 users 判定）
    dorm={customer dorm...,roomTag:binding.roomTag}
    identity={customerId:ctx.effectiveOpenid,customerOpenid:ctx.effectiveOpenid,customerNo:customer.customerNo,partnerNo:partner.partnerNo,source:'CUSTOMER'}
  else: partner=loadActivePartner(ctx.effectiveOpenid); assert partner.serviceConfig.acceptingOrders
    dorm=deriveGuestDorm(input.guest); identity={customerId:'',customerOpenid:'',customerNo:'',partnerNo:partner.partnerNo,source:'PARTNER',guest:input.guest,isTest:partner.isTestAccount}
  # v0.9：isTest 一律服务端派生（=参与账号 isTestAccount），客户端传入忽略
  svc=pickEnabledService(partner.serviceConfig,input.serviceCode); appoint=validateAppoint(input.appoint,now)   # svc={code,name}，无金额
  assertInRange(partner.serviceConfig,dorm.zone,dorm.buildingNo); requestKey=(identity.customerId||partner._id)+':'+clientRequestId
  if exists orders.requestKey(requestKey): return that order+{duplicated:true}
  ticket=validateUploadTicket(input.ticket,ctx.effectiveOpenid); assert ticket.cloudPath==input.image.cloudPath   # §2.12；路径统一 orders/{ticket}/image.jpg
  return db.runTransaction(tx):
    orderNo=nextOrderNo(tx,now)
    isTest=(identity.source=='CUSTOMER')?customer.isTestAccount:partner.isTestAccount
    order=tx.orders.add({orderNo,requestKey,...identity,isTest,impersonatedBy:ctx.viewMode=='TEST_WRITE'?ctx.developerNo:'',partnerId:partner._id,partnerOpenid:partner.openid,parcel:normalizeParcel(input.parcel),
      dorm,phoneTail,displayName,service:{code:svc.code,name:svc.name},appoint,note,image:normalizeImage(input.image,ticket),
      status:'SUBMITTED',statusUpdatedAt:now,createdAt:now,updatedAt:now,clientRequestId,version:1})
    tx.order_events.add({orderId:order._id,orderNo,type:'ORDER_CREATED',fromStatus:'',toStatus:'SUBMITTED',actorRole:ctx.role,
      actorId:ctx.effectiveOpenid,impersonatedBy:ctx.viewMode=='TEST_WRITE'?ctx.developerNo:'',at:now,payload:{source:identity.source,isTest}})
    tx.upload_tickets.doc(ticket._id).update({usedAt:now}); return order
```
**绑定方向**：本事务**不写 `bindings`**（代客单不产生绑定）；绑定只能由 `bind.create`（下方块 C）创建（工程门禁 §12#33）。

**B. 写状态动作（通用）**

```
applyOrderAction(ctx, orderNo, action, input):
  order=loadOrderByNo(orderNo); assertCanAccess(ctx,order)
  if input.expectedVersion != null && input.expectedVersion != order.version → CONFLICT
  eventKey=order._id+':'+action+':'+clientRequestId; if exists order_events.requestKey(eventKey): return view(order)+{duplicated:true}
  t=TRANSITIONS[action]; assert order.status in t.from and ctx.role in t.roles; guard(action,order,input)
  return db.runTransaction(tx):
    tx.orders.doc(order._id).update({...t.effects(order,input),version:order.version+1,statusUpdatedAt:now,updatedAt:now})
    tx.order_events.add({orderId:order._id,orderNo,type:t.eventType,fromStatus:order.status,toStatus:t.toStatus(order),
      actorRole:ctx.role,actorId:ctx.effectiveOpenid,impersonatedBy:ctx.impersonatedBy||'',at:now,note:input.reason||input.note||'',payload:t.payload(order,input),requestKey:eventKey})
```
**C. 创建绑定（`bind.create`，仅顾客发起，v0.9）**

```
createBinding(ctx, input):                 # 仅 CUSTOMER；PARTNER 调用在中间件直接 FORBIDDEN（绑定方向铁律）
  assert ctx.role=='CUSTOMER'
  customer=loadCustomer(ctx.effectiveOpenid); assert customer.profileCompleted
  partner=loadPartnerByNo(input.partnerNo);  assert partner.status=='ACTIVE'                  # 否则 PARTNER_CLOSED
  assert partner.openid != ctx.effectiveOpenid                                               # v0.9 自绑拒绝 → FORBIDDEN
  assert customer.isTestAccount==loadUser(partner.openid).isTestAccount                       # 真实×测试互绑 → FORBIDDEN（partners 不存标记，按 users 判定）
  assert noActiveBinding(customer)                                                           # 否则 CONFLICT
  assert noInProgressOrder(customer)                                                          # 否则 INVALID_STATE
  return db.runTransaction(tx):
    {roomTag,allocSeq,tagKey}=allocateRoomTag(tx,partner._id,customer.dormKey)               # §9，大写 A…Z/AA…
    binding=tx.bindings.add({customerId:ctx.effectiveOpenid,partnerId:partner._id,status:'ACTIVE',activeKey:ctx.effectiveOpenid,
      roomTag,dormSnapshot:customer.dorm...,tagKey,allocSeq,boundAt:serverNow})
    return {binding,partnerPublic}                                                            # partnerPublic 含 avatarFileId（ACTIVE 绑定时）
```

**D. 切换会话（`viewAsStart`/`viewAsEnd`，v0.9）**

```
startSwitch(ctx, {role,targetNo,mode}):    # 仅白名单开发者；actorOpenid=ctx.openid
  target=findByNo(role,targetNo); assert target.status=='ACTIVE'                            # 否则 NOT_FOUND
  if mode=='TEST_WRITE': assert target.isTestAccount==true                                  # 真实账号 → FORBIDDEN
  else: assert mode=='READONLY' && !target.isTestAccount                                    # 测试账号只允许 TEST_WRITE
  closeOtherActiveSessions(ctx.openid,'REPLACED')                                           # 同一开发者单票据
  viewTicket=random32(); view=tx.admin_view_sessions.add({_id:viewTicket,adminOpenid:ctx.openid,developerNo:devNo,
    viewMode:mode,role,targetId:target.id,targetNo,targetDisplayName,targetIsTest:target.isTestAccount,
    targetAvatarFileId:target.avatarFileId||'',createdAt:now,expiresAt:now+ttl,endedAt:null})
  audit('ACCOUNT_SWITCH_START',{viewMode:mode,role,targetNo,targetIsTest}); return view
```

### 4.9 识别兜底写入口径（v0.8）
**写点**：`ai.parseParcel` 只写 `recognition_failures`（失败/低置信时），**不直接写 `orders`**；订单的 `parcel.recognitionSource/confidence` 与 `image.failureId` 由下单/补码动作（`order.create`/`createBatch`、`order.correct`）**在用户确认后**写入。识别成功不落失败队列（不产生空记录）。**同图多单时按单调用**：每张缺码/缺站点的订单各调一次（同一 `uploadTicketId`、各自独立 `failureId`），"订单 × 截图一条记录"由调用粒度保证；未建单的调用 `orderId=''`，建单成功后由下单动作回填该单自己的 `orderId/image.failureId`。
**`recognitionSource` 判定优先级**：`MANUAL`（用户手填/修改过任一识别字段）＞`DEEPSEEK`（AI 兜底返回且被采纳）＞`RULE`（端侧规则解析直接可用）；缺该字段的旧单按 `RULE` 展示，不阻断任何动作；`confidence` 只在有识别时写（`HIGH/MEDIUM/LOW`），手录为 `''`。
**记录粒度（订单 × 截图，CONTRACT §4.2 末行/§4.3）**：同一截图拆多单时，**每张缺码/缺站点的订单各一条 `recognition_failures` 记录**——共享同一 `fileId`，`failureId` **按单独立**（便于逐单补录/逐单回填）；用户识别失败后**未建单也保留 `orderId=''` 的记录**（凭 `uploadTicketId` 校验归属后入队），建单/补码成功后回填对应订单的 `orderId` 与本单自己的 `image.failureId`。订单侧 `image.failureId` 只存**本单自己**的记录 `_id`，**不复制原图/OCR 文本**；`fileId` 被多单/多条记录共享时，cleanup 按**文件引用计数**删除（全部引用归零才删，§10.1）。
**去敏与幂等**：入队前服务端二次去敏（手机号/身份证/连续长数字掩码、详细门牌移除，`ocrTextMasked` ≤2000）。**幂等**：`ai.parseParcel` 视为写动作（会写队列）→ 必须携带 `clientRequestId`，`recognition_failures.requestKey†={uploaderOpenid}:{clientRequestId}`（唯一索引）：同一次逐单调用的网络重试返回同一 `failureId`、不重复入队（`duplicated:true`）；**同图多单的逐单调用使用不同 `clientRequestId`**（各自独立 `failureId`，与记录粒度一致），服务端**不做按文本相似度合并**（避免误合并同图多单）。
**不写订单事件**：识别兜底与复核补录**不写 `order_events`**（不改 `status`），只写 `recognition_failures` 与 `admin_audit`（`FAILURE_IMAGE_VIEW/FAILURE_FIX/FAILURE_IGNORE`）；`fix` 回填订单时 `orders.version+1`、`updatedAt` 更新、`statusUpdatedAt` 不变（并发写动作照常 `expectedVersion` 校验）。
### 4.10 测试账号与切换会话写入口径（v0.9）
**测试账号身份键（审计补丁）**：测试账号使用**合成 openid `TEST-<random>`**（非空串）：`users._id`=`customers._id`=`partners.openid`=`TEST-<random>`；**不来自微信**（`cloud.getWXContext().OPENID` 永远不会产出该值），只能由 `viewMode='TEST_WRITE'` 票据解析得到 → 所有业务集合里的 openid 字段（`orders.customerId/customerOpenid`、`orders.partnerOpenid`、`bindings.customerId`、`upload_tickets.openid`、`order_messages.fromId`、`order_events.actorId`、`recognition_failures.uploaderOpenid`）在该会话下写**effectiveOpenid**；`actorOpenid`（真实开发者）只用于白名单/票据/审计（`admin_audit.adminOpenid`、`ACCOUNT_SWITCH_*` 的 detail）。**测试兼职判定**：`partners` **不复制** `isTestAccount` 字段，按 `users.doc(partners.openid).isTestAccount` 判定（列表按页批量取 `users._id in`，≤50；测试顾客直接读其 `users._id` 对应行）；`orders.isTest` 由参与双方派生后**落快照**，后续不再查 `users`。
**创建**：`admin.createTestAccount({role,displayName})` → 事务内建 `users{_id:'TEST-<random>',isTestAccount:true,createdByDeveloperNo:devNo,roles:[role],status:'ACTIVE',testLastUsedAt:null}` + `customers{_id:同上,customerNo,displayName,avatarFileId:'',zone/buildingNo/room 默认完整,profileCompleted:true}` 或 `partners{openid:同上,partnerNo,displayName,avatarFileId:'',status:'ACTIVE',serviceConfig:默认全开,stats:全 0}`；编号生成同 §4.2（随机+唯一索引）；**不消耗邀请码、不走激活、不进真实用户列表**。
**配额**：每位开发者每角色 ≤3、合计 ≤6（`config.testAccountMaxPerRole`）；超限 `VALIDATION_FAILED`（不新增错误码）。
**测试写会话**：`admin.viewAsStart({role,targetNo,mode:'TEST_WRITE'})` 仅当目标 `isTestAccount=true` 且 `status=ACTIVE`；票据 `viewMode='TEST_WRITE'`、`targetIsTest=true`；写动作以目标测试账号身份执行，`orders.isTest=true`（服务端派生）、`orders/order_events.impersonatedBy=developerNo`、`users.testLastUsedAt=now`；**真实账号传 `TEST_WRITE` → `FORBIDDEN`**；读取时每次校验 `targetIsTest && viewTicket.targetId===effectiveOpenid`（防票据挪用）。
**清理与安全闸**：`admin.purgeTestData({dryRun?,confirmText})` **双条件**（`users.isTestAccount=true` 的账号 + 与之关联的 `isTest` 订单/事件/留言/绑定/失败记录）→ `dryRun` 先回各类条数、二次确认后执行、审计记**前后条数**、**存在任何真实账号引用（`orders.isTest=false` 或真实 openid 关联）即拒绝**；`admin.deleteTestAccount({targetNo,confirmText})` 删账号+其测试数据+头像文件，并使该账号相关会话立即 `endedAt`（审计 `TEST_ACCOUNT_DELETE`）；cleanup 每日清理 `testLastUsedAt`（无则 `createdAt`）超过 `config.testDataRetentionDays`（默认 30）的测试业务数据（账号保留、审计摘要保留）。
**统计与列表**：`admin.stats`/兼职单量统计/后台红点/邀请码/报表一律排除 `isTestAccount` 账号与 `isTest` 订单；`admin.listOrders` 默认 `isTest=false`（`includeTest?:true` 可切换并带 `TEST` 标签）；`admin.listCustomers/listPartners` 默认排除测试账号；测试账号**不可执行真实治理动作**（停启用/邀请码/工单/审计报表的目标必须是真实账号）。

## 5. 索引、查询路径与分页
### 5.1 索引（云开发控制台创建；`unique` 必建）
- `users`：`_id`（主键）、`idx_status(status)`、**`idx_test_owner(isTestAccount,createdByDeveloperNo)`**（测试账号列表/配额）、**`idx_test_used(isTestAccount,testLastUsedAt)`**（30 天测试数据清理）。
- `customers`：`_id`（主键）、**`uk_customer_no(customerNo,unique)`**、`idx_dorm_key(dormKey)`、`idx_display_name(displayName)`。
- `partners`：`uk_openid(openid,unique)`、**`uk_partner_no(partnerNo,unique)`**、`idx_status_updated(status,updatedAt)`。
- `bindings`：`uk_active_key(activeKey,unique)`、`uk_tag_key(tagKey,unique)`、`idx_partner_status(partnerId,status)`、`idx_customer_status(customerId,status)`。
- `orders`：`uk_order_no(orderNo,unique)`、`uk_request_key(requestKey,unique)`、`idx_customer_inprogress(customerId,status,statusUpdatedAt desc)`、`idx_customer_completed(customerId,completedAt desc)`、`idx_customer_cancelled(customerId,cancelledAt desc)`、`idx_partner_inprogress(partnerId,status,statusUpdatedAt desc)`、`idx_partner_completed(partnerId,completedAt desc)`、`idx_partner_cancelled(partnerId,cancelledAt desc)`、`idx_status_updated(status,statusUpdatedAt)`、`idx_anonymized(status,anonymizedAt)`、`idx_deleted_customer(deletedByCustomerAt)`、`idx_image_file(image.fileId)`、**`idx_failure(image.failureId)`**（v0.8 复核关联/引用计数）、**`idx_customer_no(customerNo)`**、**`idx_partner_no(partnerNo)`**、**`idx_is_test(isTest,status,statusUpdatedAt desc)`**（v0.9：后台默认过滤/统计排除/30 天清理）。
- `order_events`：`uk_request_key(requestKey,unique)`、`idx_order_at(orderId,at desc)`、`idx_orderNo_at(orderNo,at desc)`。
- `order_messages`：`idx_order_created(orderId,createdAt desc)`、`idx_order_read(orderId,readAt)`。
- `invitation_codes`：`uk_code(code,unique)`、`idx_status_expire(status,expiresAt)`、`idx_batch(batchId)`、`idx_createdAt(createdAt desc)`。
- `admin_view_sessions`：`_id`（主键，=`viewTicket`）、`uk_request_key(requestKey,unique)`、`idx_admin(adminOpenid,createdAt desc)`、`idx_expire(expiresAt)`、**`idx_target(targetId,targetNo)`**（v0.9：删除测试账号时结束其会话）。
- `counters`：`uk_key(key,unique)`、`idx_updatedAt(updatedAt)`（`rl:` 清理）。
- `upload_tickets`：`uk_ticket(ticket,unique)`、`idx_expire(expiresAt)`。
- `recognition_failures`（v0.8）：**`uk_failure_no(failureNo,unique)`**、**`uk_request_key(requestKey,unique)`**（入队幂等）、`idx_status_created(status,createdAt desc)`（后台首屏 `PENDING`）、`idx_uploader(uploaderOpenid,createdAt desc)`（注销清理/审计追溯；**不提供上传人搜索**）、`idx_order(orderId)`（订单一图多码逐单关联）、`idx_ticket(uploadTicketId,createdAt desc)`（排查同票多单调用）、`idx_status_created_retention(status,createdAt)`（到期清理）、`idx_file(fileId)`（原图引用计数清理）。
- `admin_audit`：`uk_request_key(requestKey,unique)`、`idx_action_at(action,at desc)`、`idx_admin_at(adminOpenid,at desc)`、`idx_developer_at(developerNo,at desc)`。
- `config`：`_id`（主键）。
说明：云开发索引对稀疏唯一支持以控制台为准；若不支持，`requestKey`/编号仍建唯一索引 + 先查后插，重复插入捕获错误，行为不变。
### 5.2 查询路径（每页一条主路径）

| 使用方 | 查询（命中索引→返回） |
| :-- | :-- |
| 顾客“进行中”订单 | `customerId=me + status in(SUBMITTED,ACCEPTED,PICKED,DELIVERED,EXCEPTION)` 按 `statusUpdatedAt desc`（`idx_customer_inprogress`），游标 `(statusUpdatedAt,orderNo)` → 20/页摘要 |
| 顾客“已完成/已取消” | `customerId=me + status=COMPLETED` 按 `completedAt desc`（`idx_customer_completed`）；`status=CANCELLED` 按 `cancelledAt desc`（`idx_customer_cancelled`）→ 20/页 |
| 顾客订单详情 | `orders.doc`/按 orderNo（`uk_order_no`）+ `order_events(orderId,at)`（`idx_order_at`）→ 单条+裁剪事件 |
| 兼职工作台 | `partnerId=me + status in(SUBMITTED,ACCEPTED,PICKED,DELIVERED,EXCEPTION)` 按 `statusUpdatedAt desc`（`idx_partner_inprogress`）→ ≤100 条服务端按站点分组+四档排序；`order.listPartner` 同时返回 `counts` **6 项**（submitted/accepted/picked/delivered/exception/todayCompleted）；`DELIVERED` 是“只读待确认”（可撤销送达/上报异常），不计入待取件 |
| 兼职客户列表 | `bindings.partnerId=me + status=ACTIVE` 按 `dormKey asc`、同 dormKey 再按 `allocSeq asc`（**=绑定先后**；展示 `roomTag` 大写；`>26` 时字符串序会退化，故排序锚用 `allocSeq`；`idx_partner_status` + 服务端排序）→ 批量取 `customers`（`_id in`，≤100）→ 顾客锚+编号+完整尾号+partnerNote+**displayName/avatarFileId（ACTIVE 绑定时）**；游标分页 |
| 绑定确认/当前绑定（顾客） | `bindings.activeKey=me`（`uk_active_key`）→ 绑定内联 `partners` 公开资料（含 `displayName`；`avatarFileId` 仅 ACTIVE 绑定时下发）；`partnerNo` 精确预览走 `uk_partner_no`（未绑定也可，`getPublic` 限流） |
| 测试账号列表（admin） | `users WHERE isTestAccount=true AND createdByDeveloperNo=me ORDER BY createdAt desc`（`idx_test_owner`）→ 编号/昵称/角色/`testLastUsedAt`（**不返回合成 openid**） |
| 切换会话校验 | `admin_view_sessions._id=viewTicket`（主键）→ 校验 `viewMode/targetIsTest/targetId` 与 `effectiveOpenid` 一致、`endedAt=null`、未过期、发起人仍白名单 |
| 头像票据/资料保存 | `upload_tickets.ticket`（`uk_ticket`）→ 校验 `purpose='AVATAR'`/归属=`effectiveOpenid`/未过期未用/路径前缀/大小 → 写 `customers/partners.avatarFileId`（替换删旧文件） |
| cleanup（测试数据，v0.9） | `users WHERE isTestAccount=true AND coalesce(testLastUsedAt,createdAt)<now-testDataRetentionDays`（`idx_test_used`）→ 逐个测试账号清其 `isTest` 订单（含事件/留言/绑定/失败记录引用）与头像文件（账号保留、批 ≤6/轮） |
| 兼职历史订单/单量统计 | `partnerId=me + status=COMPLETED` 按 `completedAt desc`（CANCELLED 按 `cancelledAt desc`）→ 20/页；`order.listPartner({view:'history',from,to})` 分页 + `counts` → 客户端按页累加**单量**（`stats` 只含单量，**不做金额/结算，不新增聚合云函数**） |
| 消息中心 | 本人订单的 `order_events(at>messageReadAt)` + 未读 `order_messages(readAt=null)` + `config.announcement`（`idx_order_at`/`idx_order_read`）→ 合并视图（`message.list`），`message.markRead` 前进水位 |
| admin 总览 | `orders` 状态计数（**排除 `isTest=true`**）+ `admin_audit` 最近 20 条 + `config` + 邀请码批次（`idx_status_updated`/`idx_is_test`/`idx_action_at`/`idx_createdAt`）→ `admin.stats`（另单列 `test` 计数供切换查看） |
| admin 订单列表 | **默认 `isTest=false`**（`idx_is_test`），`status in(…)` 按 `statusUpdatedAt desc`（`idx_status_updated`）；`customerNo`/`partnerNo` 精确搜索（`idx_customer_no`/`idx_partner_no`）→ 50/页；`includeTest=true` 可查看测试单（带 `TEST` 标签） |
| admin 顾客列表 | `customerNo` 精确（`uk_customer_no`）或 `dormKey` 精确（`idx_dorm_key`）或 `displayName` 前缀（`idx_display_name`）→ 50/页，**返回脱敏 DTO**；**默认排除测试账号**（按页批量取 `users._id in` 判 `isTestAccount`），`includeTest=true` 时带 `TEST` 标签 |
| admin 兼职列表 | `partnerNo` 精确（`uk_partner_no`）/`status` + `updatedAt desc`（`idx_status_updated`）→ 50/页，返回脱敏 DTO（**不展示头像**、昵称脱敏）；**默认排除测试账号**（批量取 `users._id in` 判 `isTestAccount`），`includeTest=true` 时带 `TEST` 标签 |
| admin 邀请码列表 | `status=?` 按 `createdAt desc`（`idx_status_expire`/`idx_createdAt`）；`batchId=?`（`idx_batch`）→ 50/页 |
| admin 审计 | `action=?` 按 `at desc`（`idx_action_at`）；`developerNo=?` 按 `at desc`（`idx_developer_at`）→ 20/页 |
| 切换会话（`READONLY`）读数据 | 服务端把身份解析为目标后，复用目标本人同一查询（如 `order.listCustomer` 用 `targetId` 作为 customerId；`partner.listBindings` 用 `targetId` 作为 partnerId）；**查询结果与目标本人完全一致**；`TEST_WRITE` 同法解析到测试账号（业务接口含写动作） |
| cleanup（订单） | 超时 `SUBMITTED AND statusUpdatedAt<now-timeout`／自动完成 `DELIVERED AND deliveredAt<now-autoCompleteHours`（`idx_status_updated`）｜留存 `终态 AND anonymizedAt=null AND statusUpdatedAt<now-180d`（`idx_anonymized`）｜软删 `deletedByCustomerAt<now-7d`（`idx_deleted_customer`）→ 各批 100 |
| cleanup（非订单） | 过期邀请码 `UNUSED AND expiresAt<now`（`idx_status_expire`）→ EXPIRED｜切换会话 `expiresAt<now`→`endedAt`+`ACCOUNT_SWITCH_EXPIRED`、`endedAt<now-7d`→删｜上传票据（`purpose` 不区分）`usedAt=null AND expiresAt<now-24h`（`idx_expire`）→ 删票据+无主文件（TICKET 无主截图；AVATAR 未消费无文件）｜**识别失败到期** `createdAt<now-retentionDays`（`idx_status_created_retention`）→ 删原图引用（引用计数 0 才删文件）+`status='IGNORED'`+`resolution.note='EXPIRED'`+`reviewedAt=now`（各批 100） |
| admin 识别失败队列（v0.8） | `status=?` 按 `createdAt desc`（`idx_status_created`，首屏 `PENDING`）；`failureNo` 精确（`uk_failure_no`）；**不提供上传人搜索/枚举**（仅按状态/编号）→ 20/页，**列表脱敏且不含 `fileId`/`uploaderOpenid`** |
| admin 复核详情与原图（v0.8） | 按 `failureNo` 取记录（`uk_failure_no`）→ 有 `orderId` 时 `orders.doc` 取 `orderNo` → 原图 `cloud.getTempFileURL(fileId)` 签发 **5 分钟** URL，**每次查看审计 `FAILURE_IMAGE_VIEW`**；`ruleResult/aiResult/ocrTextMasked` 一并返回 |
### 5.3 分页与性能守卫
游标分页、禁止 `skip`：游标用 `(statusUpdatedAt,orderNo)`（进行中）或 `(completedAt,orderNo)/(cancelledAt,orderNo)`（终态），下一页 `where(sortValue<cursor.sortValue)`，同值用 `orderNo` 打破平局；页大小：普通 20、工作台 100、admin 50、**消息 30**、审计 20；单次 `get()`≤100 条；`createBatch`≤5 条；红点/未读用 `count()+索引`，禁止全集合 count；只允许“加载更多”，超过 20 页提示用筛选缩小范围。**v0.9**：后台所有列表与统计查询**默认带测试过滤条件**（`isTest=false` 或排除 `isTestAccount`），命中 `idx_is_test`/`idx_test_owner`；测试数据清理按测试账号逐个处理（≤6/轮），不扫全表；切换会话校验只走主键/唯一索引。
守卫（v3 教训）：每个新增查询必须登记 §5.2 并命中索引，无索引查询评审拒绝；禁止 `where({})` 全表扫描与客户端过滤；列表 DTO 用字段投影（**后台投影必须走脱敏函数**）；批量单次≤20 单（客户端分批、共享 `batchActionId`）；云函数超时默认 10s、cleanup 批 100 可重入；取数方法=云开发控制台慢查询/监控 + 云函数日志耗时，不凭记忆写数字（CONTRACT §14 第 4 条）。
## 6. 安全模型
### 6.1 身份、角色、开发者语义与停用
身份=`cloud.getWXContext().OPENID`（无 OPENID→`FORBIDDEN`；云函数不配 HTTP 触发器）。**角色**：`users.roles` 仅 `CUSTOMER`/`PARTNER`；`ADMIN` 不落库、由云函数环境变量 `ADMIN_OPENIDS` 实时判定（防改库提权），该变量为 JSON 映射 `{"<openid>":"DEV-01"}`，值即 `developerNo`（MVP `DEV-01`，P1 可 `DEV-02`…）。`developerNo` 不是登录凭据，只用于后台抬头与审计。
**开发者 openid 不是顾客/兼职业务身份**：默认不建 `customers`、不激活 `partners`（避免污染统计与真实订单）；要看真实数据用**真实账号只读切换**（`READONLY`），要**真实写操作/单机验收两端**用**测试账号可写切换**（`TEST_WRITE`，后台合成账号 `TEST-<random>`、与真实数据严格隔离）；**小程序不能切换微信登录账号**（平台限制，CONTRACT §1.3）。角色切换是前端入口切换，不是身份切换；同 openid 兼顾客+兼职时两套数据互不可见（CONTRACT §1）。兼职 `SUSPENDED`/`CLOSED` 时所有 PARTNER 接口 `FORBIDDEN`/`PARTNER_CLOSED`（提示已停用/注销），客户/工作台返回空；`CLOSED` 时释放绑定、进行中订单转异常/完成（§8）。
**切换会话身份（v0.9）**：请求携带 `viewTicket` 时，服务端校验通过后把身份解析为目标：`viewMode='READONLY'` → 目标真实账号（顾客=`targetId` 作为 openid；兼职按 `targetId` 载入 partner 行），返回与目标本人一致的 DTO，**任何写动作直接 `FORBIDDEN`**；`viewMode='TEST_WRITE'` → 目标测试账号，读写均以**effectiveOpenid**（`TEST-<random>`）执行，写动作落 `impersonatedBy=developerNo` 且订单 `isTest=true`（服务端派生），**目标非测试账号或票据被挪用一律 `FORBIDDEN`**。审计用 `actorOpenid`（真实开发者），业务归属用 `effectiveOpenid`（§4.10/§6.2/§7.7）。
### 6.2 鉴权中间件（伪代码）

```
VIEW_READ_WHITELIST=['user.bootstrap','customer.getProfile','partner.listBindings','bind.getCurrent',
  'order.get','order.listCustomer','order.listPartner','message.list','order.imageUrl','config.getPublic']
api(event):
  ctx={openid:getWXContext().OPENID, serverNow:new Date(), requestId:newRequestId()}; if !openid → FORBIDDEN
  action=event.action; data=event.data||{}; reqId=event.clientRequestId; spec=REGISTRY[action]
  if !spec → VALIDATION_FAILED(field:'action'); devNo=ADMIN_OPENIDS[ctx.openid]   # undefined=非开发者
  if event.viewTicket:                          # 切换会话：真实账号 READONLY / 测试账号 TEST_WRITE
    view=loadViewSession(event.viewTicket)
    if !view || view.adminOpenid!=ctx.openid || !devNo || view.endedAt → FORBIDDEN
    if view.expiresAt<=serverNow → auditOnce('ACCOUNT_SWITCH_EXPIRED',view); VIEW_TICKET_EXPIRED
    if view.viewMode=='TEST_WRITE':
      if !view.targetIsTest || spec.permission=='ADMIN' → FORBIDDEN       # 真实账号不可写；后台动作不接受票据
    else:                                          # READONLY
      if spec.write || action not in VIEW_READ_WHITELIST → FORBIDDEN
    ctx.identity={role:view.role,targetId:view.targetId,viewTicket:view._id,viewMode:view.viewMode,
      actorOpenid:ctx.openid,effectiveOpenid:(view.viewMode=='TEST_WRITE'?view.targetId:ctx.openid),
      impersonatedBy:(view.viewMode=='TEST_WRITE'?view.developerNo:'')}
  user=ensureUser(ctx.openid)                    # 首次登录建 users 行（开发者 roles=[]）
  if user.status!='ACTIVE' && action!='user.bootstrap' → FORBIDDEN
  if user.privacyConsent.version!=config.privacyVersion && spec.write → INVALID_STATE('未同意当前隐私版本')
  if config.maintenance.enabled && spec.permission!='ADMIN' → INVALID_STATE('维护中')
  if spec.write && !validClientRequestId(reqId) → VALIDATION_FAILED(field:'clientRequestId')
  if spec.rate && !consumeRateLimit(spec.rate,ctx,data) → RATE_LIMITED
  role=view ? view.role : resolveRole(spec,ctx,data)   # CUSTOMER/PARTNER(需 ACTIVE)/ADMIN(需 devNo)；TEST_WRITE 时目标必须 isTestAccount=true（已在上方校验）
  if !role → FORBIDDEN; req=validate(spec.schema,data)   # 未知字段拒绝（含金额键），失败带 data.field
  result=spec.handler(ctx,role,req)              # handler 必须做 ownership filter；切换会话归属键=effectiveOpenid；isTest/impersonatedBy 服务端派生
  if spec.write && spec.audit: audit(spec.audit,ctx,req,result)   # admin 写动作一律 admin_audit
  return {ok:true,data:result,serverTime,requestId}
```

所有权限过滤在 handler 内落实：顾客接口固定 `customerId=ctx.effectiveOpenid`；兼职接口固定 `partnerId=ctx.partner._id`；admin 接口白名单+审计；**切换会话把上述固定值替换为 `targetId`：`READONLY` 只允许读；`TEST_WRITE` 可读写但只能落在测试账号**（目标 `isTestAccount=true`，且写动作的归属键必须等于 `effectiveOpenid`——防票据挪用）。客户端传的 customerId/partnerId/编号/`isTest`/`impersonatedBy` 只当筛选条件或被忽略，与身份/派生值不一致→`FORBIDDEN`（不返回空集，避免枚举）。
**测试数据隔离中间件补充（v0.9）**：`bind.create`/`order.create/createBatch`/`message.send` 等涉及双方的动作必须校验参与双方 `isTestAccount` 一致（兼职侧经 `users.doc(partners.openid)` 判定，§4.10），不一致 `FORBIDDEN`；`orders.isTest` 与 `orders/order_events.impersonatedBy` **由服务端按参与账号与票据派生**（客户端传入忽略/拒绝）；`TEST_WRITE` 会话写动作 `impersonatedBy` 必须等于票据 `developerNo`；测试账号不可执行真实治理动作（邀请码/停启用/工单/审计报表的目标必须是真实账号）。
**AI 兜底与复核中间件补充（v0.8）**：`ai.parseParcel` 要求登录且有业务角色（`CUSTOMER` 资料完整 / `PARTNER` ACTIVE；否则 `FORBIDDEN`），限流键 `rl:ai:{openid}:{day}`=5 次/人/日 + 全局日配额 `config.aiFallback.dailyQuota`（**超限/超时/熔断一律不报错**：handler 返回 `ok:true,data:{recognized:false,...}` 并写 `recognition_failures`，§7.9）；`ai.parseParcel` 属**写/外呼动作**，只读视角下按 `spec.write` 直接 `FORBIDDEN`（§7.7 读白名单不含它）；admin 四复核动作 `spec.permission='ADMIN'`（`devNo` 必填）且 **`spec.audit`**——`getRecognitionFailure` 每次查看审计 `FAILURE_IMAGE_VIEW`、`fix`→`FAILURE_FIX`、`ignore`→`FAILURE_IGNORE`；后台动作不携带 `viewTicket`，不受只读视角写限制。
### 6.3 权限矩阵

| 资源/动作 | 顾客 | 兼职 | 开发者 developer |
| :-- | :-- | :-- | :-- |
| `customer.getProfile/saveProfile` | 本人 | 仅本人（兼顾客身份） | 后台脱敏详情/列表（不代写） |
| `partner.getPublic` | 凭**完整 `partnerNo`** 的公开预览（**未绑定也可**；限流 5 次/日/顾客；**只回昵称、头像仅 ACTIVE 绑定时下发**；测试账号→`NOT_FOUND`） | — | 后台可见（管理用途，不展示头像） |
| `partner.listBindings/unbindCustomer/saveCustomerNote` | — | 仅自己 ACTIVE 绑定 | — |
| `order.create` | 本人（资料完整+ACTIVE 绑定） | — | ❌（不代顾客下单） |
| `order.create`（guest）/`order.createBatch` | — | 自己（服务范围/接单开关） | ❌ |
| `order.get/listCustomer/listPartner` | 本人订单 | 本人订单（含 guest） | 后台脱敏版（列表/详情） |
| `order.*` 状态动作 | 仅 `cancel`/`confirmDelivery`（本人单） | 自己订单的接单/取件/送达/异常/改码/撤销 | 仅异常介入取消（`ORDER_ANOMALY_CANCEL`，原因+审计） |
| `order.deleteRecord` | 本人 COMPLETED 单 | — | ❌（不可删订单） |
| `bind.create/release` | 本人（**仅顾客可发起**；**自绑拒绝**；测试账号只能绑测试账号） | ❌（**禁止**；无任何入口，`bind.create`→`FORBIDDEN`） | ❌（不创建绑定） |
| `partner.unbindCustomer` | — | 自己名下（reason 必填 + 通知顾客） | — |
| `message.send/list` | 自己订单 | 自己订单 | 只读（异常工单） |
| `upload.prepare` | 本人（资料完整+绑定） | 自己（代客单） | — |
| `admin.*`（邀请码/停启用/配置/脱敏总览/审计/视角） | — | — | ✅（白名单+审计） |
| `ai.parseParcel`（OCR 兜底，v0.8） | 本人（资料完整+绑定）自动触发，5 次/人/日 | 本人（代客单）自动触发 | ❌（后台不触发外呼；Key 只在云函数环境变量） |
| 识别失败队列/原图查看（v0.8） | ❌ | ❌ | ✅（仅复核页；临时 URL 5 分钟 + 每次审计 `FAILURE_IMAGE_VIEW`；不批量/不下载/不导出） |
| 补录识别结果（v0.8） | ❌ | 仅自己订单 `order.correct` 改码 | ✅（仅回填识别字段，不改状态、不代确认、不创建订单、不改归属；审计 `FAILURE_FIX`） |
| 客户端直连第三方 AI（`api.deepseek.com`/Key 出现在客户端） | ❌ | ❌ | ❌（工程门禁失败；外呼只允许在云函数层，CONTRACT §12） |
| **读绑定对方头像/昵称** | ✅（当前 ACTIVE 绑定兼职） | ✅（当前 ACTIVE 绑定顾客） | 后台默认脱敏（**不展示头像**、昵称脱敏）；切换会话同目标可见范围 |
| **修改自己的头像/昵称** | ✅（`customer.saveProfile`） | ✅（`partner.saveProfile`） | —（开发者无业务身份） |
| **切换账号：真实账号（`READONLY`）** | ❌ | ❌ | ✅（票据+黄条+审计+服务端拒写；隐藏分享） |
| **切换账号：测试账号（`TEST_WRITE`）** | ❌ | ❌ | ✅（仅测试账号；`isTest`/`impersonatedBy` 标记；蓝条+`TEST` 角标；`ACCOUNT_SWITCH_*` 审计） |
| **测试账号管理 / 测试数据清理** | ❌ | ❌ | ✅（≤3/角色、≤6/开发者；`createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData`；dry-run+二次确认+审计前后条数） |
| **头像上传** | ✅（`upload.prepare({purpose:'AVATAR'})`，5 次/日/人） | ✅（同） | —（开发者无业务身份） |
| **测试数据进入统计/红点/邀请码/报表** | — | — | **不存在**（一律排除 `isTestAccount`/`isTest`，selftest 断言 0） |
| 枚举/搜索兼职 | **永不提供** | — | ✅（仅 admin 列表/编号搜索） |
| 修改订单归属/代确认送达/代创建订单/导出完整个人信息 | — | — | ❌（后台不显示 openid） |
| 任何金额/支付/收款/运费/价格操作 | — | — | **不存在（零金额）** |

**编号可见性**：`customerNo` 本人/其绑定兼职/开发者/只读视角可见；`partnerNo` 本人/其绑定顾客/开发者/只读视角可见（公开预览按完整编号）；任何列表/卡片不展示对方宿舍/尾号/称呼（分享卡片只带 `partnerNo`）。
### 6.4 数据库与云存储规则
数据库：所有集合客户端 `read=false`、`write=false`（含 `invitation_codes`/`admin_view_sessions`）；云函数用 admin 权限绕过规则但 handler 必须按 §6.2 过滤；禁止给任何集合开“按 `_openid` 可读”的客户端规则（否则整文档泄露）；控制台人工改数据须留 `admin_audit`（`MANUAL_DB_FIX`†，写原因与影响范围）。
云存储：客户端读全拒绝；只允许写两个前缀——`orders/{ticket}/image.jpg`（TICKET 票据）与 **`avatars/{role}/{random}.jpg`（AVATAR 票据，v0.9，**路径不含 openid**、随机不可枚举）**（ticket 服务端签发、不可猜），其他路径拒绝；只有云函数 `cloud.getTempFileURL` 生成 5 分钟 URL（`order.imageUrl` 先鉴权再签发；头像由 DTO 下发 `avatarFileId`，展示用 `cloud://`/临时 URL，**后台不签发**）；cleanup 按 `orders.image.fileId` 引用计数删除，多单共用时最后一张离开 7 天窗口才删；`cloudPath` 服务端生成，订单只存 `fileId` 不存路径。**v0.9 头像文件**：≤`config.avatarMaxBytes`（默认 200KB）、jpg/png；替换即删旧文件（旧 `fileId` 失效→客户端 `onShow` 重取回默认头像）、注销/删除测试账号即删；头像 fileId 只随 DTO 下发给本人/当前 ACTIVE 绑定对方。**v0.8 识别失败原图**：同一 `fileId` 可被 `recognition_failures` 引用（复核期 30 天 > 订单 7 天），**只有 `admin.getRecognitionFailure`** 鉴权后才签发 5 分钟临时 URL 并逐次审计 `FAILURE_IMAGE_VIEW`；不提供批量/下载/导出，不把 URL 写日志/通知；cleanup 合并两类引用计数（两者都无引用才删文件）。
**开发者敏感面**：`ADMIN_OPENIDS` 只存在云函数环境变量（不进代码/前端/数据库）；前端隐藏不作为安全边界；`viewTicket` 只在客户端内存（不落本地存储），后台不提供“显示完整”按钮（完整 L3 只经只读视角）。**v0.9 测试数据**：与真实数据同集合（**不建 `test_accounts`**），隔离靠 `users.isTestAccount` + `viewMode` + `isTest` 快照；测试账号的合成 openid `TEST-<random>` **不来自微信**，`cloud.getWXContext()` 永不产出，只能由 `TEST_WRITE` 票据解析；数据库规则对测试数据无例外（客户端仍全拒）。
### 6.5 输入校验、内容安全与限流
统一 schema 校验（长度/字符集/枚举/数字范围/时间格式），**未登记字段拒绝**并带 `data.field`（任何金额键因此天然被拒）；`pickupCode/trackingTail/lockerNo` 形态闸复用 v3 规则（`utils/parse.js`+`utils/migrate.js`，v4 纯函数移植+单测）；编号输入走 `utils/ids.js`（格式/前缀/容错提示，CONTRACT §12）；留言/`note`/`deliveryNote`/`cancelReason` 过 `security.msgSecCheck` v2（失败 `VALIDATION_FAILED` + `data.field='text'/'note'`）；**昵称 `displayName`（顾客/兼职）必过 `security.msgSecCheck` v2**（≤20 字截断后送检，失败 `data.field='displayName'`）；**头像**校验 `purpose='AVATAR'`/路径前缀/≤`config.avatarMaxBytes`（默认 200KB）/jpg\|png/可解码（`chooseAvatar` 来源由微信平台审核；允许自定义上传才需补 `security.mediaCheckAsync`，[P1]）；截图 [P1] 过 `security.mediaCheckAsync`，未过审兼职端标“待审”（CONTRACT §11.3）。
限流统一 `counters.rl:{scope}:{openid}:{window}`：`bind.create`/`partner.getPublic` 5 次/日/顾客；`partner.activate` 5 次失败/日/openid；`order.create/createBatch` 20 单/日/顾客；`message.send` 30 条/日/订单；切换账号开启（`READONLY`/`TEST_WRITE`）20 次/日/开发者；**头像上传 5 次/日/人**；**测试账号创建每位开发者每角色 ≤3、合计 ≤6**；`upload.prepare` 30 次/日（†，含 `purpose='AVATAR'`）；`order.correct` 20 次/日/订单（†）；**`ai.parseParcel` 5 次/人/日（`rl:ai:`）+ 全局日配额 `config.aiFallback.dailyQuota`**；admin 其余不限频但全审计；超限 `RATE_LIMITED`（CONTRACT §10）——**唯一例外：AI 兜底超限不返回 `RATE_LIMITED`，静默降级为 `recognized:false` 并入队**（§7.9）。
日志：只允许 `requestId/action/orderNo/customerNo/partnerNo/failureNo/错误码/耗时/openid 后 6 位指纹`；禁止打印 `pickupCode/phoneTail/displayName/dormKey/roomTag/cloudPath/截图内容/完整 openid（含测试账号合成 openid `TEST-<random>`）/claimTokenHash/guest.phoneTail/完整邀请码/viewTicket/ocrTextMasked 全文/fileId/AI 响应全文/DEEPSEEK_API_KEY/avatarFileId/targetAvatarFileId/完整昵称`；**AI 外呼只记 `aiErrorCode/耗时/成功与否`**；平台 `errMsg` 回显前过滤 id 与 L3 值（v3 `maskRoomIds` 教训的 v4 版）。
## 7. 云函数 API 契约（严格按 CONTRACT v0.9 §5.3 命名）
### 7.1 通用协议
请求 `{action, data, clientRequestId?, viewTicket?, expectedVersion?}`；响应 `{ok, code?, message?, data?, serverTime, requestId?}`（CONTRACT §5.3；`requestId` 服务端生成、只用于排障）。**写动作必传 `clientRequestId`**；读动作不要求。`viewTicket` 用于开发者**切换会话**（§7.7）：`viewMode='READONLY'`（真实账号）→ 服务端把身份解析为目标并**拒绝一切写动作**；`viewMode='TEST_WRITE'`（测试账号）→ 身份解析为目标测试账号（effectiveOpenid），允许业务写动作（`isTest`/`impersonatedBy` 服务端派生），**后台动作一律不接受票据**；真实账号传 `mode='TEST_WRITE'` 在签发时即 `FORBIDDEN`。重复写请求返回 `ok:true`+当前对象+`data.duplicated=true`。分页统一 `{cursor?:{sortValue,orderNo}, limit?}`→`{list,nextCursor|null}`。**列表 DTO 分级**：`order.listCustomer/listPartner/partner.listBindings` 只对**本人数据**返回完整 L3 值；admin 列表/日志/通知/导出默认脱敏；完整 L3 只在只读视角（**唯一例外=识别失败复核页原图**，§7.9）；**v0.9**：后台列表/详情**不展示头像**、昵称按脱敏函数展示，**默认排除测试账号与测试订单**（可切换查看并带 `TEST` 标签）；测试数据不进统计/红点/邀请码/报表。所有校验/权限/限流失败不写库；失败只回 code+人话 message（无内部堆栈）。客户端只经 API 适配层调用，页面不直接 `wx.cloud.callFunction`（CONTRACT §12）。**AI 兜底动作 `ai.parseParcel` 的失败不占用错误码**：除未登录/无业务角色回 `FORBIDDEN` 外，一律 `ok:true`+`recognized:false` 降级（§7.9）。
### 7.2 错误码（只认 CONTRACT v0.9 §5.3 的 **13 个**，统一 `大写_下划线`；v0.9 不新增错误码）
`VALIDATION_FAILED`（参数/形态/文件/内容安全/未知字段，带 `data.field`）｜`FORBIDDEN`（未登录/越权/账号停用/非本人/`READONLY` 写动作/无效或过期切换票据/无业务角色调 AI 兜底/**兼职调 `bind.create`/自绑/真实×测试互操作/真实账号传 `TEST_WRITE`/非白名单管理测试账号**）｜`NOT_FOUND`（对象不存在；含无效或已作废邀请码、无效票据、不可查看目标、复核记录不存在）｜`CONFLICT`（版本冲突、唯一键、已绑定、重复激活）｜`INVALID_TRANSITION`（状态机不允许）｜`INVALID_STATE`（资料未完整/无绑定/有进行中订单/维护中/未同意隐私/时点不允许/无可撤销/上传票据失效/复核记录已处理）｜`RATE_LIMITED`｜`INVITE_EXPIRED`（邀请码过期）｜`INVITE_USED`（邀请码已使用）｜`VIEW_TICKET_EXPIRED`（切换会话票据过期）｜`PARTNER_CLOSED`（兼职停用/注销）｜`DEPENDENCY_FAILED`（第三方/编号生成重试耗尽）｜`INTERNAL_ERROR`。
**无 `CODE_EXPIRED`/`CODE_USED`/支付类码**（已废弃 v0.6）。业务原因→码对照：邀请码不存在/作废→`NOT_FOUND`、过期→`INVITE_EXPIRED`、已用→`INVITE_USED`、格式错→`VALIDATION_FAILED`；上传票据不存在/非本人→`NOT_FOUND`、过期/已用→`INVALID_STATE`；切换会话票据过期→`VIEW_TICKET_EXPIRED`、不存在/已结束/非本人/非白名单/`READONLY` 写动作/真实账号传 `TEST_WRITE`→`FORBIDDEN`；编号格式/前缀错误→`VALIDATION_FAILED`（`data.field='partnerNo'`）；编号生成重试耗尽→`DEPENDENCY_FAILED`。**v0.8 AI 口径**：`ai.parseParcel` **不新增错误码**——外呼失败/超时/熔断/超配额/JSON 失败一律降级成功响应（`ok:true`+`recognized:false`+`needsReview:true`+`failureId?`）；复核四动作沿用上述 13 码（非白名单→`FORBIDDEN`、记录不存在→`NOT_FOUND`、已 `FIXED/IGNORED` 再处理→`INVALID_STATE`、补录站点/码不合法→`VALIDATION_FAILED`）。**v0.9 测试账号/切换口径（不新增错误码，仍 13 个）**：真实账号传 `mode='TEST_WRITE'`→`FORBIDDEN`；真实×测试互绑/互下单/互留言→`FORBIDDEN`；非白名单创建/删除测试账号或清空测试数据→`FORBIDDEN`；`TEST_WRITE` 目标非测试账号或票据被挪用→`FORBIDDEN`；测试账号被真实顾客查询（`partner.getPublic`）→`NOT_FOUND`；测试账号配额超限/`confirmText` 不符/`dryRun` 未确认→`VALIDATION_FAILED`；测试数据存在真实引用时清理→`INVALID_STATE`；票据问题沿用 `VIEW_TICKET_EXPIRED`（过期）与 `FORBIDDEN`（不存在/非本人/已结束）。
### 7.3 `user.*` / `customer.*`

| action | 入参 → 出参 | 权限 | 幂等 | 特有错误 |
| :-- | :-- | :-- | :-- | :-- |
| `user.bootstrap` | `{}` → `{roles,status,privacyConsent,messageReadAt,customerProfileCompleted,customerNo?,displayName?,avatarFileId?,partnerStatus,partnerNo?,isDeveloper,viewContext,configPublic,serverTime}`（`viewContext={viewMode,role,targetNo,targetDisplayName,targetAvatarFileId?,expiresAt}`，无则 `null`） | 登录即可（不存在则建 users 行） | 读 | — |
| `user.acceptPrivacy` | `{version}` → `{privacyConsent}` | 本人 | 同版本重复返回已同意（`duplicated:true`） | `VALIDATION_FAILED`（版本不符） |
| `user.deleteAccount` | `{confirmText:'注销'}` → `{deletionRequestedAt}` | 本人（顾客身份） | 自然幂等（DEACTIVATED 后重复返回） | `INVALID_STATE`（有进行中订单） |
| `customer.getProfile` | `{}` → `{customerNo,displayName,avatarFileId,zone,buildingNo,room,dormKey,phoneTail,profileCompleted}` | 本人/切换会话（按目标可见范围） | 读 | — |
| `customer.saveProfile` | `{displayName,zone,buildingNo,room,phoneTail?,avatarTicket?}` → `{profile,profileCompleted,customerNo,binding?,avatarFileId}` | 本人 | 字段级幂等（同值不写）；**`customerNo` 首次生成后永不变** | `INVALID_STATE`（改宿舍且有进行中订单）/`VALIDATION_FAILED`（含昵称未过内容安全/头像票据不符） |

`user.bootstrap` 的 `isDeveloper` 由 `ADMIN_OPENIDS` 映射决定；`viewContext` 为切换会话有效时的 `{viewMode,role,targetNo,targetDisplayName,targetAvatarFileId?,expiresAt}`（否则 `null`，见 §7.7）。**v0.9 头像/昵称保存**：先 `upload.prepare({purpose:'AVATAR'})` → `wx.cloud.uploadFile` 到 `avatars/{role}/{random}.jpg` → 保存资料时带 `avatarTicket`；服务端校验票据归属（`effectiveOpenid`）/用途/未过期未用/路径前缀/大小/类型后写 `avatarFileId`，**替换即删旧文件**；`avatarFileId=''` 显式清除回默认头像（默认头像客户端绘制、不占存储）；`displayName` 必填（≤20 字、过 `msgSecCheck` v2）；**解绑/停用/注销后对方 DTO 立即不再返回头像/昵称**（客户端 `onShow` 重取）。**切换会话下** `user.bootstrap` 返回**目标上下文**（`READONLY`/`TEST_WRITE` 均 `isDeveloper=false`，避免客户端再分流到后台）、`viewContext` 为当前票据摘要（含 `viewMode`），写动作不因该返回值恢复权限（`READONLY` 仍 `FORBIDDEN`）。`customer.saveProfile` 副作用：称呼/可选手机尾号可随时改；**宿舍身份仅在“无进行中订单”时可改**（否则 `INVALID_STATE`）；**首次资料创建成功时在事务内生成 `customerNo`**（已存在则复用，保证幂等）；资料完整前不分配 roomTag；**已绑定**且 dormKey 变化→事务内 RELEASED 旧 binding（`CUSTOMER_INITIATED`）+新 binding（同兼职）分配新 roomTag（旧号不复用，§9），**禁止原地改 `dormSnapshot`**；已存在订单保留创建时 `orders.dorm` 与编号快照，不受影响。`user.deleteAccount` 触发 §10.4 注销流程并写 `users.deletionRequestedAt`。
### 7.4 `partner.*` / `bind.*`

| action | 入参 → 出参 | 权限 | 幂等/限流 | 特有错误 |
| :-- | :-- | :-- | :-- | :-- |
| `partner.activate` | `{invitationCode,displayName,avatarTicket?}` → `{partnerNo,partner,roles}` | 登录 openid（非 partner；CLOSED openid 不可再激活；**测试账号不能走激活**） | 邀请码状态机；5 次失败/日/openid | `INVITE_USED`/`INVITE_EXPIRED`/`NOT_FOUND`/`CONFLICT`/`VALIDATION_FAILED` |
| `partner.getPublic` | `{partnerNo}`（完整编号）→ `{partnerNo,displayName,avatarFileId?,status,services[],zones[],acceptingOrders}`（**绑定前不返回 `avatarFileId`**；有 ACTIVE 绑定时才返回头像） | 登录顾客（**未绑定/预备绑定也可预览**；只回公开字段；**目标为测试账号时仅同一 `TEST_WRITE` 会话的测试顾客可预览，其余（含真实顾客）→`NOT_FOUND`**） | 读；5 次/日/顾客（`rl:partnerPublic`） | `NOT_FOUND`（不存在/测试账号）/`VALIDATION_FAILED`（格式/前缀错）/`RATE_LIMITED` |
| `partner.saveProfile` | `{displayName?,avatarTicket?}` → `{partner}`（含 `partnerNo/displayName/avatarFileId`） | 该兼职 ACTIVE（或 `TEST_WRITE` 测试兼职） | 字段级幂等；`avatarTicket` 一次性 | `PARTNER_CLOSED`/`VALIDATION_FAILED`（昵称内容安全/头像票据） |
| `partner.saveServiceConfig` | `{serviceConfig}`（§2.3.1 白名单，**无价格字段**）→ `{serviceConfig}` | 该兼职 ACTIVE | 字段级幂等 | `PARTNER_CLOSED`/`VALIDATION_FAILED` |
| `partner.listBindings` | `{cursor?,limit?,keyword?}` → `{list:[{bindingId,customerNo,dormKey,roomTag,displayName,avatarFileId?,phoneTail,buildingText,partnerNote,boundAt,activeOrderCount}],nextCursor}` | 该兼职（仅自己 ACTIVE 绑定；切换会话按目标） | 读 | `FORBIDDEN` |
| `partner.unbindCustomer` | `{bindingId,reason,note?}` → `{releasedAt,releaseReason}` | 该兼职（自己绑定；**有进行中订单时禁止**） | 自然幂等（已释放返回成功） | `INVALID_STATE`/`FORBIDDEN`/`VALIDATION_FAILED` |
| `partner.saveCustomerNote` | `{bindingId,partnerNote}` → `{partnerNote}` | 该兼职（自己绑定） | 字段级幂等（同值不写） | `FORBIDDEN`/`VALIDATION_FAILED`（≤100） |
| `bind.create` | `{partnerNo}`（完整编号）→ `{binding:{roomTag,dormKey,buildingText,boundAt},partnerPublic}`（`partnerPublic` 含 `displayName/avatarFileId`，**ACTIVE 绑定时才有头像**） | **仅顾客**（资料完整、无进行中订单、无 ACTIVE 绑定；**PARTNER 调用 `FORBIDDEN`**；**自绑拒绝**；**测试账号只能绑测试账号**） | `activeKey` 唯一；5 次/日/顾客 | `CONFLICT`/`PARTNER_CLOSED`/`NOT_FOUND`（含测试账号对真实顾客）/`INVALID_STATE`/`VALIDATION_FAILED`（前缀错/格式错）/`FORBIDDEN`（兼职调用/自绑/真实×测试） |
| `bind.release` | `{reason,note?}` → `{releasedAt,releaseReason}` | 顾客本人（有 ACTIVE 绑定；**有进行中订单时禁止**） | 自然幂等 | `NOT_FOUND`/`INVALID_STATE`/`VALIDATION_FAILED` |
| `bind.getCurrent` | `{}` → `{binding:{bindingId,dormKey,buildingText,roomTag,boundAt},partnerPublic,serverTime}`（`partnerPublic` 含 `displayName/avatarFileId`；**解绑后返回 `binding:null`，不再返回对方头像/昵称**） | 顾客本人（切换会话按目标） | 读；无 ACTIVE 绑定返回 `binding:null` | — |
| `bind.claimGuestOrder` | `{guestOrderNo,claimToken}` → `{binding,claimedOrderNo}` | 顾客（[P1]；绑定到该兼职后才可认领） | 一次性 token；5 次/日/顾客 | `NOT_FOUND`（**MVP 不实现**） |

`partner.unbindCustomer` 与 `bind.release` 共用同一释放事务（`releaseReason` 分别 `PARTNER_INITIATED`/`CUSTOMER_INITIATED`）；**`reason` 必填且必须命中 `releaseReason` 枚举**（否则 `VALIDATION_FAILED`），可选 `note` ≤100 字（落 `bindings.releaseNote`）；**有进行中订单（`customerId/partnerId` 名下非终态单）时禁止解绑/换绑，两侧都拦截并返回 `INVALID_STATE`**。`partnerNo` 错误提示（§4.2 规则 5）由 API 适配层统一转人话。MVP 代客单**不做认领**，`bind.claimGuestOrder` 返回 `NOT_FOUND`（不暴露内部状态）。**v0.9 绑定方向与隔离**：`bind.create` **仅 CUSTOMER 可调**（PARTNER 一律 `FORBIDDEN`，CONTRACT §4.2 ①）；**自绑拒绝**（`partners.openid == caller effectiveOpenid`）；**测试×真实绑定/下单拒绝**（双参与方 `isTestAccount` 必须一致）；**代客下单不写 `bindings`**（工程门禁 §12#33）；**解绑/停用/注销后** `bind.getCurrent`/`partner.listBindings`/订单 DTO **不再返回对方头像/昵称**（O2 解绑即失联；客户端 `onShow` 重取）。
### 7.5 `order.*`（**无任何金额入参/出参**）

| action | 入参 → 出参 | 权限 | 幂等/限流 | 特有错误 |
| :-- | :-- | :-- | :-- | :-- |
| `order.create` | 顾客：`{parcel,serviceCode,appoint,note?,ticket,image}`；兼职 guest：同上+`{guest}` → `{orderNo,order,duplicated?}` | 顾客（本人/资料完整/ACTIVE 绑定）或兼职（ACTIVE/服务范围/guest） | `orders.requestKey`；20 单/日 | `INVALID_STATE`/`VALIDATION_FAILED`/`PARTNER_CLOSED`/`NOT_FOUND`（票据） |
| `order.createBatch` | `{items:[{parcel,serviceCode,appoint,note?}],ticket,image}`（一图多码≤5） → `{orders[],duplicated?}` | 顾客/兼职（guest） | 每条 `requestKey={identity}:{clientRequestId}:{itemIndex}`；20 单/日（按条计）；**单事务原子创建 N 单** | 同 `order.create`；>5 条或任一非法→`VALIDATION_FAILED`（不建）；`acceptingOrders=false`→`PARTNER_CLOSED`（不建） |
| `order.get` | `{orderNo}` → `{order,events[]}`（裁剪事件；`order` 含 `customerNo/partnerNo` 快照） | 订单双方/admin/只读视角 | 读 | `FORBIDDEN`/`NOT_FOUND` |
| `order.listCustomer` | `{status?,keyword?,cursor?,limit?}` → `{list,nextCursor}` | 本人（customerId=me） | 读 | `FORBIDDEN` |
| `order.listPartner` | `{view:'workbench'\|'history',status?,from?,to?,keyword?,cursor?,limit?}` → `{list,nextCursor,counts:{submitted,accepted,picked,delivered,exception,todayCompleted}}` | 该兼职（partnerId=me） | 读 | `FORBIDDEN`/`VALIDATION_FAILED` |
| `order.imageUrl` | `{orderNo}` → `{url,expiresAt}` | 订单双方/只读视角 | 读（URL 不落库） | `FORBIDDEN`/`NOT_FOUND` |
| `order.accept` | `{orderNo,expectedVersion?}` → `{order}` | 该兼职（SUBMITTED；SUSPENDED/CLOSED 不可） | `order_events.requestKey` | `INVALID_TRANSITION`/`PARTNER_CLOSED` |
| `order.reject` | `{orderNo,reason}` → `{order}` | 该兼职（SUBMITTED；reason 必填） | 同上 | `INVALID_TRANSITION`/`VALIDATION_FAILED` |
| `order.markPicked` | `{orderNo,batchActionId?,expectedVersion?}` → `{order}` | 该兼职（ACCEPTED；码非空或 DROP_OFF） | 同上 | `INVALID_TRANSITION` |
| `order.unmarkPicked` | `{orderNo,expectedVersion?}` → `{order}` | 该兼职（PICKED） | 同上 | `INVALID_TRANSITION` |
| `order.markDelivered` | `{orderNo,deliveryNote?,batchActionId?,expectedVersion?}` → `{order}` | 该兼职（PICKED） | 同上 | `INVALID_TRANSITION`/`VALIDATION_FAILED` |
| `order.unmarkDelivered` | `{orderNo,expectedVersion?}` → `{order}` | 该兼职（DELIVERED） | 同上 | `INVALID_TRANSITION` |
| `order.reportException` | `{orderNo,code,text?}` → `{order}` | 该兼职（ACCEPTED/PICKED/DELIVERED；OTHER 必填 text） | 同上 | `INVALID_TRANSITION`/`VALIDATION_FAILED` |
| `order.resolveException` | `{orderNo,text?}` → `{order}` | 该兼职/admin（EXCEPTION） | 同上 | `INVALID_TRANSITION` |
| `order.cancel` | `{orderNo,reason,note?}` → `{order}` | 顾客（`SUBMITTED`/`ACCEPTED`/`EXCEPTION 且 exception.fromStatus∈{SUBMITTED,ACCEPTED}`）/该兼职（非终态）/admin（异常介入+审计） | 同上 | `INVALID_TRANSITION`/`VALIDATION_FAILED`（reason 枚举见 §8.3） |
| `order.confirmDelivery` | `{orderNo,expectedVersion?}` → `{order}` | 顾客（DELIVERED） | 同上 | `INVALID_TRANSITION` |
| `order.correct` | `{orderNo,patch:{stationId?,stationName?,pickupCode?,lockerNo?,trackingTail?},batchActionId?,expectedVersion?}` → `{order,correctedFields[]}` | 该兼职（SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅 lockerNo/trackingTail；不改归属） | 同上；20 次/日/订单 | `INVALID_TRANSITION`/`VALIDATION_FAILED` |
| `order.undo` | `{orderNo,batchActionId?}`（批量由客户端逐单调用、共享 batchActionId） → `{order,undoneAction}` | 该兼职（5 秒窗、无后续状态变化；**仅 markPicked/markDelivered**，接单不可撤销） | 同上（同一 undo 动作） | `INVALID_STATE`/`INVALID_TRANSITION` |
| `order.deleteRecord` | `{orderNo}` → `{deletedByCustomerAt}` | 顾客（仅 COMPLETED 本人单） | 自然幂等 | `INVALID_STATE`/`FORBIDDEN` |

`order.undo` 可撤销集合：`markPicked`→`PICKED_REVERTED`、`markDelivered`→`DELIVERED_REVERTED`；**接单不可撤销**（误接单走 `order.cancel`）；**不存在任何收款/标记已收/撤销收款动作**；批量动作不设 batch 云函数：客户端逐单调用、共享 `batchActionId`、逐单返回并汇总“成功 N/失败 M”（不得把部分成功显示为全部成功）。**v0.9 订单 DTO/隔离**：`order.get/listCustomer/listPartner` 可内联 `counterpart{displayName,avatarFileId?}`（**仅当前 ACTIVE 绑定关系内**；解绑/停用/注销后不再返回，历史单只留编号）；`orders.isTest`/`impersonatedBy` **服务端派生**、客户端传入忽略；真实用户永不返回测试单；测试单在后台以 `TEST` 标签标识；跨测试/真实的 `order.create/createBatch` 一律 `FORBIDDEN`。`order.create` 的 `order` 出参含 `customerNo/partnerNo` 快照（顾客看自己的 `customerNo`、兼职看 `customerNo`；双方看对方编号），但**编号不可用于越权查询**。
### 7.6 `message.*` / `upload.*` / `config.*` / `health.*` / `admin.*`

| action | 入参 → 出参 | 权限 | 幂等/限流 | 特有错误 |
| :-- | :-- | :-- | :-- | :-- |
| `message.send` | `{orderNo,text,templateCode?}` → `{message}` | 订单双方 | 同一 `clientRequestId` 不重复写；30 条/日/订单 | `VALIDATION_FAILED`（≤200/内容安全）/`FORBIDDEN` |
| `message.list` | 订单留言：`{orderNo,cursor?,limit?}`；消息中心：`{cursor?,limit?}` → `{list,nextCursor,messageReadAt}` | 订单双方/本人消息中心/只读视角 | 读 | `FORBIDDEN`/`NOT_FOUND` |
| `message.markRead` | `{scope:'ALL'\|'ORDER',orderNo?}` → `{messageReadAt}` | 本人 | 水位只前进（幂等） | `VALIDATION_FAILED` |
| `upload.prepare` | `{purpose:'TICKET'\|'AVATAR',draftId,contentType,size}` → `{ticket,cloudPath,expiresAt,draftId,purpose}`（TICKET→`orders/{ticket}/image.jpg`；AVATAR→`avatars/{role}/{random}.jpg`） | 顾客/兼职（资料完整+绑定；**头像上传对本人可用、无需绑定**；切换会话按目标测试账号） | 每次新 ticket；TICKET 30 次/日、**AVATAR 5 次/日/人** | `VALIDATION_FAILED`（类型/大小/用途不符）/`INVALID_STATE` |
| `upload.cancel` | `{ticket}` → `{cancelled:true}` | 票据申请者 | 自然幂等 | `NOT_FOUND`/`FORBIDDEN` |
| `config.getPublic` | `{}` → `{zoneLabels,serviceCatalog(不含费用字段),announcement,maintenance,privacyVersion,orderTimeoutMinutes,autoCompleteHours,screenshotRetentionDays,avatarMaxBytes,viewTicketTtlMinutes,subscribeEnabled}` | 任意登录用户 | 读 | — |
| `health.check` | `{}` → `{ok,version,time}` | **仅内部/部署者**（ADMIN 白名单或部署令牌；不返回业务数据） | 读 | `FORBIDDEN` |
| **`ai.parseParcel`**（v0.8） | `{ocrTextMasked≤2000, hintTrackingTail?, uploadTicketId, role}` → `{recognized,stationId,stationName,pickupCode,trackingTail,lockerNo,confidence:'HIGH'\|'MEDIUM'\|'LOW',source:'RULE'\|'DEEPSEEK'\|'NONE',needsReview,failureId?}`（**DTO 逐字段=CONTRACT §4.3 格式化块**，§7.9） | 登录顾客（资料完整+绑定）/兼职（ACTIVE） | **写队列→必传 `clientRequestId`**；同 `clientRequestId` 重试幂等返回同一 `failureId`；同图多单逐单调用各传不同 `clientRequestId`（各一条记录）；5 次/人/日+全局日配额；**降级 `ok:true+recognized:false` 不报错**；失败/低置信必写 `recognition_failures` | `FORBIDDEN`（未登录/无业务角色）；**不新增错误码** |
| `admin.createInvites` | `{count(1~50),expiresInHours(24\|72\|168\|720，默认168),note?}` → `{batchId,expiresAt,codes[]（完整，仅本次）}` | **仅 `ADMIN_OPENIDS`** | `admin_audit.requestKey†`；审计 `INVITE_CREATE` | `VALIDATION_FAILED` |
| `admin.revokeInvite` | `{invitationCode,reason}` → `{codeTail,status:'REVOKED'}` | 仅 admin | 自然幂等（已 REVOKED 返回成功）；审计 `INVITE_REVOKE` | `NOT_FOUND`/`INVALID_STATE`（已用/已过期不可作废） |
| `admin.listInvites` | `{status?,batchId?,cursor?,limit?}` → `{list:[{invitationCode,status,batchId,expiresAt,usedByPartnerNo?,usedByDisplayName?,usedAt,note,createdBy,createdAt}],nextCursor}` | 仅 admin | 读 | — |
| `admin.listCustomers`/`admin.getCustomer` | `{keyword?(customerNo/dormKey/displayName),includeTest?,cursor?,limit?}` → `{list（脱敏）,nextCursor}`；`{customerNo}` → `{customer（脱敏，无头像）,bindingSummary,recentOrders（脱敏）}` | 仅 admin | 读；**默认排除测试账号**（`includeTest=true` 时带 `TEST` 标签） | `NOT_FOUND`（详情） |
| `admin.listPartners` | `{status?,keyword?(partnerNo),includeTest?,cursor?,limit?}` → `{list（脱敏，无头像、昵称脱敏）,nextCursor}` | 仅 admin | 读；**默认排除测试账号**（`includeTest=true` 时带 `TEST` 标签） | — |
| `admin.setPartnerStatus` | `{partnerNo,status:'SUSPENDED'\|'CLOSED'\|'ACTIVE',reason}` → `{partner,affectedBindings,affectedOrders}` | 仅 admin | `admin_audit.requestKey†`；审计 `PARTNER_SUSPEND`/`PARTNER_RESTORE` | `INVALID_TRANSITION`/`VALIDATION_FAILED` |
| `admin.listOrders`/`admin.getOrder` | `{status?,customerNo?,partnerNo?,keyword?,includeTest?,cursor?,limit?}` → `{list（脱敏）,nextCursor}`；`{orderNo}` → `{order（脱敏）,events（裁剪）}` | 仅 admin | 读；**默认 `isTest=false`**（`includeTest=true` 查看测试单并带 `TEST` 标签） | `NOT_FOUND`（详情） |
| `admin.listAudit` | `{action?,developerNo?,cursor?,limit?}` → `{list,nextCursor}` | 仅 admin | 读 | — |
| `admin.updateConfig` | `{config}`（白名单字段：`viewTicketTtlMinutes`/`recognitionFailureRetentionDays(7~30)`/**`avatarMaxBytes`(102400~512000)**/**`testAccountMaxPerRole`(1~3)**/**`testDataRetentionDays`(7~90)**；**不含 `aiFallback`**（MVP 只读展示、P1 再开）；**无金额字段**）→ `{config}` | 仅 admin | `admin_audit.requestKey†`；审计 `CONFIG_UPDATE` | `VALIDATION_FAILED` |
| `admin.stats` | `{range?'today'\|'7d'\|'30d',includeTest?}` → `{counts:{users,customers,partners,activePartners,orders,pendingOrders,exceptions,activeSwitchSessions},today:{orders},test:{testAccounts,testOrders},recentAudit[20],config,inviteBatches[],recentCodes[]}`（**统计排除测试账号与 `isTest` 订单**；`test` 仅计数字段；**无收入字段**） | 仅 admin | 读 | — |
| `admin.bootstrap` | `{}` → `{collections:[],indexes:[],configSeeded:boolean}`（幂等建/校验集合与索引、写 config 种子） | **仅 `ADMIN_OPENIDS`** | 幂等（重复调用返回现状）；审计 `BOOTSTRAP` | `FORBIDDEN` |
| `admin.viewAsStart` | `{role:'CUSTOMER'\|'PARTNER',targetNo,mode:'READONLY'\|'TEST_WRITE'}` → `{viewTicket,viewMode,role,targetNo,targetDisplayName,targetAvatarFileId?,targetIsTest,expiresAt}` | 仅 admin（白名单） | `admin_view_sessions.requestKey†`；审计 `ACCOUNT_SWITCH_START`（`detail={viewMode,role,targetNo,targetIsTest}`）；20 次/日/开发者 | `NOT_FOUND`（目标不可查看）/`FORBIDDEN`（真实账号传 `TEST_WRITE`/目标不符）/`VALIDATION_FAILED`/`RATE_LIMITED` |
| `admin.viewAsEnd` | `{viewTicket}` → `{endedAt}` | 仅 admin（票据发起人） | 自然幂等；审计 `ACCOUNT_SWITCH_END` | `FORBIDDEN` |
| **`admin.createTestAccount`**（v0.9） | `{role:'CUSTOMER'\|'PARTNER',displayName}` → `{_id,role,customerNo?,partnerNo?,displayName,isTestAccount:true}` | 仅 admin | 幂等键 `admin_audit.requestKey†`；审计 `TEST_ACCOUNT_CREATE`；**每角色 ≤3/开发者、合计 ≤6**（`config.testAccountMaxPerRole`） | `VALIDATION_FAILED`（配额/昵称） |
| **`admin.listTestAccounts`**（v0.9） | `{role?,cursor?,limit?}` → `{list:[{_id,targetNo,role,displayName,createdByDeveloperNo,testLastUsedAt,createdAt}],nextCursor}`（**不返回合成 openid**） | 仅 admin | 读；仅列**自己创建**的测试账号（多开发者按 `createdByDeveloperNo` 隔离） | `FORBIDDEN` |
| **`admin.deleteTestAccount`**（v0.9） | `{targetNo,confirmText:'删除'}` → `{deleted:true,removedCounts:{orders,events,messages,bindings,failures,avatarFiles},sessionsEnded}` | 仅 admin | 二次确认；审计 `TEST_ACCOUNT_DELETE`（含删除条数）；**级联删账号+测试数据+头像文件，并使相关会话 `endedAt`**；**有真实引用即拒绝 `INVALID_STATE`** | `VALIDATION_FAILED`（confirmText）/`NOT_FOUND`/`INVALID_STATE` |
| **`admin.purgeTestData`**（v0.9） | `{dryRun?:boolean,confirmText?:'清空'}` → `{dryRun,counts:{orders,events,messages,bindings,failures},purged?}` | 仅 admin | **双条件**（`isTestAccount` + 关联 `isTest`）+ `dryRun` 先回条数 + 二次确认 + 审计 `TEST_DATA_PURGE`（记前后条数）；**存在真实引用即拒绝** | `VALIDATION_FAILED`（缺 confirmText）/`INVALID_STATE`（有真实引用） |
| **`admin.listRecognitionFailures`**（v0.8） | `{status?:'PENDING'\|'FIXED'\|'IGNORED',cursor?,limit?}` → `{list:[{failureNo,failureCode,sourceRole,uploaderNo,uploaderDisplayName（脱敏）,orderNo?,status,aiTried,aiErrorCode,createdAt,reviewedAt}],nextCursor}`（**列表不含 `fileId`/`uploaderOpenid`**） | 仅 admin | 读；默认 `PENDING` 优先、20/页 | `FORBIDDEN` |
| **`admin.getRecognitionFailure`**（v0.8） | `{failureNo,withImage?:boolean}` → `{failureNo,failureCode,sourceRole,uploaderNo,uploaderDisplayName,orderNo?,ocrTextMasked,ruleResult,aiTried,aiModel,aiResult,aiErrorCode,status,resolution?,imageUrl?,expiresAt?}` | 仅 admin | 读；**每次查看审计 `FAILURE_IMAGE_VIEW`**；原图临时 URL **5 分钟**、仅本单 | `NOT_FOUND`/`FORBIDDEN` |
| **`admin.fixRecognitionFailure`**（v0.8） | `{failureNo,stationId?,stationName?,pickupCode?,note?,notifyUploader?}` → `{failureNo,status:'FIXED',resolution,orderPatchedFields[],notified:boolean}` | 仅 admin | 补录**只回填本记录自己那条订单的识别字段**（`parcel.stationId/stationName/pickupCode/recognitionSource='MANUAL'`，`version+1`、不改状态、不写事件、不代确认、不创建、不改归属）；`notifyUploader:true` ⇒ 站内消息通知上传者（**订阅消息 P1**，通知失败不影响复核结果，**不单拆动作**）；审计 `FAILURE_FIX`；自然幂等（已 FIXED 返回现状） | `VALIDATION_FAILED`（站点非 P1~P8/码不过形态闸/字段全空）/`NOT_FOUND`/`INVALID_STATE`（已 IGNORED） |
| **`admin.ignoreRecognitionFailure`**（v0.8） | `{failureNo,note,notifyUploader?}`（**note 必填 ≤100**） → `{failureNo,status:'IGNORED',resolution,notified:boolean}` | 仅 admin | `notifyUploader:true` ⇒ 站内消息通知上传者（同上，不单拆动作）；审计 `FAILURE_IGNORE`；**终态不可重开** | `VALIDATION_FAILED`（缺 note）/`NOT_FOUND`/`INVALID_STATE`（已 FIXED） |

`admin.setPartnerStatus(CLOSED)` 语义：不可恢复；释放全部 ACTIVE 绑定（`PARTNER_CLOSED`）；`SUBMITTED/ACCEPTED/PICKED` 订单转 `EXCEPTION`（`by='ADMIN'`、`code='OTHER'`、text 说明兼职注销）或逐单取消；`DELIVERED` 交 auto-complete 转 `COMPLETED`；`partners.status='CLOSED'`+`deletedAt`，文档保留审计不物理删；该 openid 再激活 `CONFLICT`；`partnerNo` 作废不复用。审计枚举无 `PARTNER_CLOSE`：SUSPENDED→`PARTNER_SUSPEND`、恢复→`PARTNER_RESTORE`、CLOSED→`PARTNER_SUSPEND` 且 `detail.to='CLOSED'`。admin 读配置/邀请码/审计分别走 `updateConfig`/`listInvites`/`listAudit`，总览仍由 `admin.stats` 复合返回。
### 7.7 开发者后台、切换账号与只读视角契约（CONTRACT §1.1~§1.3）
**默认脱敏函数（admin DTO 强制走）**：`maskDisplayName(name)`：空→`''`，保留首 1 字 + `***`（如 `小***`；后台搜索仍按真实值匹配）｜`maskPickupCode(code)`：空→`''`，长度≥4 保留首 1 位+末 1 位、中间 `*`（`A***9`），长度≤3→`***`｜`maskPhoneTail(t)`：空→`''`，否则 `'**'+后2位`（`**78`）｜`maskDorm(dorm)`：只回 `{zone,buildingNumber}` 展示串 `D4`（房间号 `***`，`dormKey/roomTag` 不返回）｜后台列表/详情**不显示 openid**（任何形态）、不提供完整手机号（系统本就不收集）、不提供“显示完整”按钮；`admin_audit.detail`、日志、通知同样脱敏；**完整 L3（取件码/尾号/门牌/截图）只能通过只读视角查看**。
**后台动作边界**：邀请码生成/作废/查看、兼职停启用、全局配置、后台脱敏查看、异常工单取消（`order.cancel` by ADMIN，原因必填+`ORDER_ANOMALY_CANCEL`）、切换账号（真实只读/测试可写）、测试账号管理；**不可**删除订单、改状态（除异常介入取消）、作为顾客下单/作为兼职接单、导出完整个人信息、查看/写入 openid、把邀请码长期复用。**v0.9 测试账号不可执行真实治理动作**：停启用/邀请码/工单/审计报表的目标必须是真实账号（测试账号只能被测试账号管理与测试数据清理动作处理）。
**切换会话（viewTicket，v0.9：真实账号只读 / 测试账号可写）**：
- 开启：`admin.viewAsStart({role,targetNo,mode:'READONLY'|'TEST_WRITE'})` → 校验白名单 → 按**完整编号**查 ACTIVE 目标（顾客=`customerNo`、兼职=`partnerNo`；也可由后台列表选人）→ **`TEST_WRITE` 还须校验目标 `isTestAccount=true`**（真实账号传 `TEST_WRITE` → `FORBIDDEN`；真实账号只能 `READONLY`、测试账号只能 `TEST_WRITE`）→ 生成 32 位随机票据，落 `admin_view_sessions`（`_id=viewTicket`，含 `viewMode/targetIsTest/targetAvatarFileId`）→ **客户端只存内存** `app.globalData.viewContext`（不写本地存储）→ `reLaunch` 目标角色首页；审计 `ACCOUNT_SWITCH_START`（`detail={viewMode,role,targetNo,targetIsTest}`）。
- 约束：同一开发者**同时只有一个有效票据**（新开覆盖旧的，旧票据立即失效并记 `ACCOUNT_SWITCH_END`，`detail.reason='REPLACED'`）；默认 30 分钟（`config.viewTicketTtlMinutes` 5~60，admin 可配）；不能查看开发者自己/其他开发者；只能选 ACTIVE 顾客与 ACTIVE 兼职（停用/注销不可选）；目标不存在或非 ACTIVE 统一 `NOT_FOUND`（“该用户当前不可查看”，不提供可枚举区分）；**删除测试账号时其相关会话立即 `endedAt`**（`detail.reason='TARGET_DELETED'`）。
- 读范围（`READONLY`）：与目标本人完全一致（顾客=本人资料/订单/绑定兼职公开资料；兼职=绑定自己的顾客/订单/配置/统计）；**服务端按票据把身份解析为目标并返回同 DTO**；只读白名单：`user.bootstrap`（返回目标上下文且 `isDeveloper=false`+`viewContext`）、`customer.getProfile`、`partner.listBindings`、`bind.getCurrent`、`order.get`、`order.listCustomer`、`order.listPartner`、`message.list`、`order.imageUrl`、`config.getPublic`；其他读接口一概 `FORBIDDEN`；**头像/昵称按目标可见范围返回**（对方头像/昵称仅在目标 ACTIVE 绑定时可见）。
- 读范围（`TEST_WRITE`）：与目标测试账号本人完全一致（自身 `customers/partners`、测试订单/绑定/留言/配置），业务接口均可读写；`user.bootstrap` 返回目标测试上下文（`isDeveloper=false`、`viewContext.viewMode='TEST_WRITE'`）；**后台动作（`admin.*`）不接受票据**。
- 写限制：`READONLY` 下顾客/兼职的一切写动作（下单、取消、确认、接单、取件、送达、留言、绑定、配置、注销……）**服务端见票据即 `FORBIDDEN`**（前端置灰/隐藏为第一层，服务端拒绝为第二层）；`TEST_WRITE` 下**允许业务写动作但只能落在目标测试账号**（`targetIsTest && viewTicket.targetId===effectiveOpenid`，写动作以目标身份执行并落 `isTest/impersonatedBy`，`users.testLastUsedAt=now`；跨测试/真实或票据挪用→`FORBIDDEN`）；开发者自己的后台写动作（邀请码/停启用/配置/测试账号管理/切换开启结束）不受影响。
- 页面表现：目标角色三 tab；`READONLY` 顶部常驻**黄条** `开发者只读视角 · 顾客 C-XXXX-XXXX 小王 · 退出`（不可关闭、不遮挡状态栏）；`TEST_WRITE` 顶部常驻**蓝条** `测试账号 · 顾客 C-…（测试） · 由 DEV-01 切换 · 退出` + 页面右上角 `TEST` 角标；`custom-tab-bar` 按 `viewContext.role` 渲染；**两种切换会话都隐藏分享/转发/长按保存入口**（O3）。
- 结束/过期：黄条/蓝条「退出」→ `admin.viewAsEnd({viewTicket})` 置 `endedAt` → 清内存 → `reLaunch` 回「切换账号」页（`pkg-admin/pages/account-switch/index`）；冷启动/杀进程丢失票据（重新开启）；票据过期后下次请求返回 `VIEW_TICKET_EXPIRED`，并**一次性**写 `admin_audit{action:'ACCOUNT_SWITCH_EXPIRED', target:{type:'view_session',id:viewTicket}, detail:{viewMode,targetIsTest}}`（cleanup 对过期未结束票据同样处理，`endedAt=expiresAt` 幂等）。
- 审计：**v0.9 统一为 `ACCOUNT_SWITCH_START`/`ACCOUNT_SWITCH_END`/`ACCOUNT_SWITCH_EXPIRED`**（`detail` 含 `viewMode/role/targetNo/targetIsTest`；**旧 `VIEW_AS_*` 作废**）；测试账号管理 `TEST_ACCOUNT_CREATE`/`TEST_ACCOUNT_DELETE`/`TEST_DATA_PURGE`（清理记前后条数）；`admin_audit.adminOpenid` = 真实开发者（`actorOpenid`），测试写动作的业务归属记 `effectiveOpenid`/`impersonatedBy`；票据本身**不写本地存储、不进日志**。
- **v0.8 边界**：只读视角读白名单（上列 10 个）**不含** `ai.parseParcel` 与四个识别复核动作——`ai.parseParcel` 属写/外呼动作，`READONLY` 下见票据即 `FORBIDDEN`（`TEST_WRITE` 下允许，以目标测试账号触发）；复核动作只存在于开发者后台（页面不携带 `viewTicket`），**看原图不改订单状态**，与切换会话是两条独立通道（原图例外见 §7.9）。
- **v0.9 测试账号管理（后台「切换账号」页，第 2 个 tab）**：新建（选角色、填昵称，系统生成编号与合成 openid；不消耗邀请码、不进真实列表；每角色 ≤3/开发者）、查看（编号/昵称/角色/最近使用/是否被真实数据引用（恒为否））、删除（二次确认，级联删账号+测试数据+头像，相关会话立即 `endedAt`）、清空测试数据（`purgeTestData`，`dryRun` 先回条数+二次确认）；**全部动作审计**（`TEST_ACCOUNT_CREATE/TEST_ACCOUNT_DELETE/TEST_DATA_PURGE`）。
### 7.8 内部分定时任务 `cleanup`（单个触发器，建议每 10 分钟；到期判断幂等执行全部任务）
`orderTimeout`：`SUBMITTED` 超 `config.orderTimeoutMinutes`→CANCELLED（`cancelledBy='SYSTEM'`、`cancelReason='TIMEOUT_UNACCEPTED'`、事件 TIMEOUT_CANCELLED）｜`autoComplete`：`DELIVERED` 超 `config.autoCompleteHours`→COMPLETED（actorRole=SYSTEM，事件 AUTO_COMPLETED；**guest 单同样由它完成**，不等顾客）｜`files`：终态/取消超 `screenshotRetentionDays` 的截图按引用计数删除｜`tickets`：过期票据+无主文件｜`retention`：终态 180 天匿名化写 `anonymizedAt`（幂等）、匿名化+30 天物理删、`order.deleteRecord` 软删后 7 天物理删｜`accountDeletion`：`users.deletionRequestedAt+30d`→物理删关联数据｜`invitationCodes`：`UNUSED` 且 `expiresAt<now`→`EXPIRED`（**不自动重新生效**）｜`switchSessions`：过期未结束票据→`endedAt=expiresAt`+记 `ACCOUNT_SWITCH_EXPIRED`（`detail` 含 `viewMode/targetIsTest`）；结束/过期超 7 天→物理删（`READONLY`/`TEST_WRITE` 同一处理）｜**`recognitionFailures`（v0.8）**：`createdAt < now-retentionDays`（记录级 `retentionDays`）→ 删原图引用（与订单引用合并计数，为 0 才 `deleteFile`）、`status='IGNORED'`、`resolution.note='EXPIRED'`、`reviewedAt=now`（幂等、批 100）｜`rateLimits`：清过期 `rl:` counters（含 `rl:ai:`）｜`recomputeStats`：重算 `partners.stats`（只含单量）｜**`testData`（v0.9）**：`users.isTestAccount=true && coalesce(testLastUsedAt,createdAt) < now-testDataRetentionDays`（默认 30）→ 逐个测试账号清其 `isTest` 订单/事件/留言/绑定/失败记录/头像文件（账号保留、审计摘要保留、批 ≤6/轮，幂等）｜`testAccountsDeletion`：被 `admin.deleteTestAccount` 标记的测试账号 → 级联删除并结束其会话（同步审计）。
### 7.9 `ai.parseParcel` 与识别失败复核契约（v0.8，CONTRACT §4.3）
**唯一外呼出口**：客户端**不得**直连 `api.deepseek.com`、不得持有 `DEEPSEEK_API_KEY`（工程门禁见 CONTRACT §12）；外呼只在云函数 `api` 内。入参白名单**逐字**：`{ocrTextMasked≤2000, hintTrackingTail?, uploadTicketId, role}`；服务端**二次去敏**后仅转发 `ocrTextMasked/hintTrackingTail?/role`（**不发原图、不发 openid、不发订单归属**）；`system prompt` 限定输出 JSON 字段集合、`temperature=0`、`response_format={type:'json_object'}`、超时 **8s**、仅网络/5xx 重试 1 次、连续 5 次失败熔断 **10 分钟**、总开关 `config.aiFallback.enabled`；Key 只存云函数环境变量（不进代码/前端/日志/数据库）。
**返回 DTO（唯一格式，客户端只认这个，逐字段=CONTRACT §4.3）**：

| 字段 | 类型 | 必返 | 口径 |
| :-- | :-- | :-- | :-- |
| `recognized` | boolean | 是 | 站点与取件码**均**可信才 true；false 时识别字段可为 `''` |
| `stationId`/`stationName` | string | 是 | `stationId` 必须 ∈ P1~P8，否则置 `''`（名称同步置 `''`，不臆造；不做自建站点） |
| `pickupCode` | string | 是 | 去空格/连字符后过码格式闸（4~12 位字母数字）否则 `''` |
| `trackingTail`/`lockerNo` | string | 是 | 尾号恰好 5 位数字否则 `''`；柜号 ≤10 否则 `''` |
| `confidence` | string | 是 | `HIGH`/`MEDIUM`/`LOW`（规则或 AI 置信；AI 未调用按规则给） |
| `source` | string | 是 | `RULE`/`DEEPSEEK`/`NONE`（`NONE`=均不可用，纯手填） |
| `needsReview` | boolean | 是 | `recognized=false` 或 `confidence=LOW` ⇒ true，同时写队列并回 `failureId` |
| `failureId` | string | 否 | 写队列成功时回**本单**的 `recognition_failures.failureNo`（同图多单**各自独立**，§4.9；仅本次响应，不落客户端存储） |

**降级语义（不新增错误码）**：未登录/无业务角色→`FORBIDDEN`；其余失败（无文本、规则缺站点/码、AI 超时/5xx/熔断/超配额/JSON 解析失败、图片不可读）**一律** `ok:true`+`recognized:false`+`needsReview:true`+`failureId`，客户端走手填并**不阻断下单**；`failureCode` 按 §2.14 五值映射，`aiErrorCode` 只做后台排障；**AI 超限不返回 `RATE_LIMITED`**；`uploadTicketId` 归属校验失败不拒绝（记 `ruleResult.ticketInvalid=true`）。**失败后未建单也入队**（`orderId=''`），建单/补码后回填对应 `orderId` 与本单 `failureId`。
**合并策略**：AI 结果只作**预填建议**，用户已手填字段优先、**不得覆盖**；客户端仍允许手填提交（`NEED_CODE` 机制不变）；回填订单时 `parcel.recognitionSource` 记 `DEEPSEEK/MANUAL/RULE`（§4.9）。
**复核四动作边界**：`list` 只读+脱敏（无 `fileId/uploaderOpenid`，默认 `PENDING`）；`get` 才签发原图临时 URL（**5 分钟**）并**每次审计 `FAILURE_IMAGE_VIEW`**；`fix` **只回填本记录自己那条订单的识别字段**（逐单回填，不批量改同图其他单；订单 `version+1`、`status/statusUpdatedAt` 不变、**不写 `order_events`**、不代确认、不创建订单、不改归属）并审计 `FAILURE_FIX`；`ignore` 备注必填并审计 `FAILURE_IGNORE`；**"通知上传者"不单拆动作**——它是 `fix`/`ignore` 的可选参数 `notifyUploader:true`（站内消息必做、订阅消息 P1，通知失败不影响复核结果）；**不提供批量/下载/导出**；到期由 cleanup 置 `IGNORED`（`note='EXPIRED'`）并删原图引用（§10.1）。
**配置管理**：`config.aiFallback` 在 **MVP 后台只读展示、不开放编辑**（`admin.updateConfig` 白名单不含该键，P1 再开）；改值走部署配置脚本/控制台，与隐私文本同步并落审计；`recognitionFailureRetentionDays` 可在后台配（7~30）。
**安全与口径**：`recognition_failures` 与 `admin_audit` 可追溯本次外呼与复核；响应不整段落日志（只记 `aiErrorCode/耗时/成功与否`）；外发 payload 键集合单测断言（§12#30）；**零金额口径继续有效**（`aiFallback` 只含次数/毫秒/布尔，无任何计价语义）。
## 8. 订单状态机
### 8.1 状态与进入条件

| 状态 | 中文（顾客可见） | 终态 | 进入条件 |
| :-- | :-- | :-- | :-- |
| `SUBMITTED` | 待接单 | 否 | 顾客下单/兼职代客下单成功 |
| `ACCEPTED` | 已接单 | 否 | 兼职接单、撤销已取件、异常恢复 |
| `PICKED` | 已取件·配送中 | 否 | 兼职标记已取件、撤销已送达、异常恢复 |
| `DELIVERED` | 已送达·待确认 | 否 | 兼职标记送达、异常恢复 |
| `COMPLETED` | 已完成 | 是 | 顾客确认送达、系统自动完成 |
| `CANCELLED` | 已取消 | 是 | 顾客/兼职/超时/admin/异常取消 |
| `EXCEPTION` | 异常·待处理 | 否 | 兼职上报、admin 介入（含兼职 CLOSED） |
### 8.2 转移矩阵

| 动作 | 角色 | 起始→目标 | 守卫/关键副作用 | 事件 |
| :-- | :-- | :-- | :-- | :-- |
| `order.create/createBatch` | 顾客/兼职 | —→SUBMITTED | 资料完整/绑定/范围/票据/幂等；写 `createdAt/statusUpdatedAt`；写 `customerNo/partnerNo` 快照；**v0.9 服务端派生 `isTest`（参与账号一致才允许）、`TEST_WRITE` 记 `impersonatedBy`、真实×测试拒绝** | ORDER_CREATED |
| `order.accept` | 兼职 | SUBMITTED→ACCEPTED | 自己的单；SUSPENDED/CLOSED 不可；写 `acceptedAt` | ACCEPTED |
| `order.reject` | 兼职 | SUBMITTED→CANCELLED | reason 必填；写 `cancelReason/cancelledBy` | REJECTED |
| `order.cancel`（顾客） | 顾客 | SUBMITTED/ACCEPTED→CANCELLED；**EXCEPTION 且 `exception.fromStatus∈{SUBMITTED,ACCEPTED}`→CANCELLED** | 自己的单；写 `cancelledAt`；`PICKED/DELIVERED` 上报的异常**顾客不可单方取消**（只能留言/等恢复） | CANCELLED |
| `order.cancel`（兼职/admin） | 兼职/admin | 非终态→CANCELLED | reason 必填；admin 需审计 `ORDER_ANOMALY_CANCEL` | CANCELLED |
| `cleanup.orderTimeout` | SYSTEM | SUBMITTED→CANCELLED | 超时；`cancelledBy='SYSTEM'` | TIMEOUT_CANCELLED |
| `order.markPicked` | 兼职 | ACCEPTED→PICKED | 码非空或 DROP_OFF；写 `pickedAt` | PICKED |
| `order.unmarkPicked` | 兼职 | PICKED→ACCEPTED | 撤销窗/无后续变化；清 `pickedAt` | PICKED_REVERTED |
| `order.markDelivered` | 兼职 | PICKED→DELIVERED | `deliveryNote`≤100；写 `deliveredAt` | DELIVERED |
| `order.unmarkDelivered` | 兼职 | DELIVERED→PICKED | 撤销窗/无后续变化；清 `deliveredAt` | DELIVERED_REVERTED |
| `order.confirmDelivery` | 顾客 | DELIVERED→COMPLETED | 自己的单；写 `completedAt` | COMPLETED |
| `cleanup.autoComplete` | SYSTEM | DELIVERED→COMPLETED | 超 `autoCompleteHours`；**guest 单无顾客确认路径，同样由它自动完成** | AUTO_COMPLETED |
| `order.reportException` | 兼职 | ACCEPTED/PICKED/DELIVERED→EXCEPTION | code 六值；OTHER 必填 text；写 `exception{...,fromStatus}` | EXCEPTION_REPORTED |
| `order.resolveException` | 兼职/admin | EXCEPTION→`exception.fromStatus`（仅 ACCEPTED/PICKED/DELIVERED，否则 ACCEPTED） | exception 存在 | EXCEPTION_RESOLVED |
| `order.correct` | 兼职 | SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅 lockerNo/trackingTail | 当前状态不变；不改归属 | ORDER_CORRECTED |
| `order.undo` | 兼职 | 由被撤销动作决定（**仅 markPicked/markDelivered**） | 5 秒窗+无后续变化；回退一步（接单不可撤销） | 对应 REVERTED 事件 |
| `order.deleteRecord` | 顾客 | COMPLETED | 写 `deletedByCustomerAt`；7 天后物理删 | DELETED_BY_CUSTOMER |
| `admin.setPartnerStatus(CLOSED)` | admin | 进行中逐单 | SUBMITTED/ACCEPTED/PICKED→EXCEPTION（`by=ADMIN`、code=OTHER）；DELIVERED→COMPLETED | EXCEPTION_REPORTED/COMPLETED |
### 8.3 子状态
`parcel.codeStatus`：下单空码→`NEED_CODE`，`order.correct` 补码→`OK`（payload 标 `codeStatusChanged`）；`NEED_CODE` 不阻断建单但 `markPicked` 需码。**无任何支付/收款子状态**（`fee.payStatus` 已删除）。`appoint.type`：ASAP/SLOT，下单后不可改（改时间取消重下）；SLOT 校验未来+start<end。`urgent`：由 `service.code==='PICKUP_URGENT'` 派生。`exception.fromStatus`：上报写、恢复消费（仅 ACCEPTED/PICKED/DELIVERED，否则 ACCEPTED）；**EXCEPTION 下顾客取消条件 = `exception.fromStatus∈{SUBMITTED,ACCEPTED}`（CONTRACT §5；`fromStatus=PICKED/DELIVERED` 时顾客不能单方取消，须兼职恢复或取消）**。`cancelReason`（CONTRACT §5.2）：顾客侧 `CHANGED_MIND/WRONG_INFO/DUPLICATE/PARTNER_UNREACHABLE/OTHER`（5）；兼职侧 `TOO_BUSY/OUT_OF_RANGE/SERVICE_OFF/OTHER`（4）；系统侧 `TIMEOUT_UNACCEPTED`（1）；`OTHER` 必填备注，中文文案由服务端下发；**`PRICE_ISSUE`/`PAYMENT_TIMEOUT` 已删除（零金额口径）**。**v0.9**：`orders.isTest` 为订单级测试标记（服务端按参与账号派生、不可改、不参与流转判断）；测试单状态机与真实一致，但**不计统计/不进真实用户列表/后台默认过滤**；`impersonatedBy` 只对 admin/测试会话可见。
### 8.4 事件类型（`order_events.type`，16 种）
`ORDER_CREATED`/`ACCEPTED`/`REJECTED`/`PICKED`/`PICKED_REVERTED`/`DELIVERED`/`DELIVERED_REVERTED`/`COMPLETED`/`AUTO_COMPLETED`/`CANCELLED`/`TIMEOUT_CANCELLED`/`EXCEPTION_REPORTED`/`EXCEPTION_RESOLVED`/`ORDER_CORRECTED`/`DELETED_BY_CUSTOMER`/`GUEST_ORDER_CLAIMED`(P1 预留)。**无任何支付/收款类事件**（`PAYMENT_MARKED`/`PAYMENT_MARK_REVERTED` 已删除）。
payload 约定：`ORDER_CREATED{source,serviceCode,itemIndex?,isTest}`｜`ACCEPTED/REJECTED{reason?}`｜`PICKED/DELIVERED{deliveryNote?}`｜`PICKED_REVERTED/DELIVERED_REVERTED{undoneAction,previousAt}`｜`AUTO_COMPLETED/TIMEOUT_CANCELLED{scheduledBy}`｜`CANCELLED{cancelReason}`｜`EXCEPTION_REPORTED{code,text,fromStatus}`｜`EXCEPTION_RESOLVED{restoredTo,text?}`｜`ORDER_CORRECTED{before,after,codeStatusChanged?,mode?:'UNDO'}`。
### 8.5 非法流转、乐观锁与四档排序
非法流转（状态不在矩阵/角色不允许/终态再动）→`INVALID_TRANSITION` 或 `FORBIDDEN`；`EXCEPTION` 必须带 `exception`；`resolveException` 无 exception→`INVALID_TRANSITION`；CLOSED 兼职名下订单只能 admin 处置，兼职本人写动作 `FORBIDDEN`。
乐观锁：`orders.version` 每次成功写 +1；`expectedVersion` 不匹配→`CONFLICT`（客户端重拉后重试，不自动合并）；不带版本时服务端事务内读最新校验状态，真并发冲突仍返回 `CONFLICT`/`INVALID_TRANSITION`；批量逐单独立校验、逐单返回。
四档排序：同 `stationId` 内按 ①需查明（`codeStatus=NEED_CODE`）→②快递柜（`lockerNo` 非空）→③分段码（`pickupCode` 含非数字字符）→④其他；同档按码中数字升序→`orderNo` 兜底。排序口径以 CONTRACT §5.2 为准：`order.listPartner({view:'workbench'})` 服务端只做状态桶+站点过滤并返回 list+counts（不保证档内顺序），**四档动线排序在客户端零件层用 `shared/order-view.sortByPickupRoute` 执行**（排序规则只存 shared 纯件一份）；列表时间序由服务端排序（§5.2）。
## 9. roomTag（同寝室大写标识 A…Z/AA…）算法与边界
### 9.1 后缀映射与分配事务

```
excelUpperSuffix(seq):                # v0.9 恒大写：1→A,26→Z,27→AA,28→AB,702→ZZ,703→AAA（Excel 列名式）
  out=''; n=seq; while n>0: out=chr(ord('A')+(n-1)%26)+out; n=(n-1)//26; return out
allocateRoomTag(tx, partnerId, dormKey):        # 在 bind.create 事务内（仅顾客发起，§4.8C）
  key='tag:'+partnerId+':'+dormKey; row=tx.counters.where({key}).limit(1).get(); seq = row.empty ? 1 : row.seq+1
  row.empty ? tx.counters.add({key,seq:1,updatedAt:serverNow}) : tx.counters.doc(row._id).update({seq,updatedAt:serverNow})
  return {roomTag:excelUpperSuffix(seq), allocSeq:seq, tagKey:partnerId+':'+dormKey+':'+excelUpperSuffix(seq)}
```

同一事务内：分配 roomTag→插入 `bindings`（`activeKey=customerId`、`tagKey`、`dormSnapshot`）；任一步失败整事务回滚、序号不消耗；`bindings.uk_tag_key` 唯一索引兜底并发。**资料保存不分配 tag**；绑定成功后才上屏 `D4-522A`。**v0.9 恒大写**：仅 `bind.create`（顾客发起）分配；`orders.dorm.roomTag` 同为大写快照；列表按**绑定先后**排序（展示大写字母序 A<…<Z<AA<AB；因字符串序在 `>26` 时会退化，**排序锚用 `allocSeq`（number）**，展示用 `roomTag`）；**旧小写算法与展示全部作废**。
### 9.2 边界表

| 场景 | 口径 | 复用旧标签 |
| :-- | :-- | :-- |
| 首次绑定（`bind.create`，**仅顾客发起**） | 按（兼职,当前 dormKey）取号 **A/B/C…**（恒大写） | — |
| 换宿舍（已绑定，`customer.saveProfile`） | **无进行中订单才允许（否则 `INVALID_STATE`）**→事务：旧 binding RELEASED（`CUSTOMER_INITIATED`，禁止原地改 `dormSnapshot`）+新 binding（同兼职）在新 dormKey 取新号 | ❌（旧号保留历史、永不回收） |
| 换绑到另一兼职 | `bind.release`（`CUSTOMER_INITIATED`）+`bind.create`；新兼职按自己作用域取号 | ❌（跨兼职作用域独立，可出现同字母） |
| 兼职解绑（`partner.unbindCustomer`） | RELEASED（`PARTNER_INITIATED`）；重绑同一兼职同宿舍→新号 | ❌（允许空洞 A,C） |
| 兼职停用（SUSPENDED） | 不释放绑定、不可接单/被新绑定；恢复后绑定与 roomTag 不变 | ✅（同一绑定） |
| 兼职注销（CLOSED） | 全部 ACTIVE 绑定 RELEASED（`PARTNER_CLOSED`）；roomTag 留历史行 | ❌ |
| 并发绑定 | `activeKey`+`tagKey` 唯一索引+事务重试；重复 `CONFLICT` | — |
| 空洞 | 解绑/换宿舍/CLOSED 留下的号不复用；序号只增不减 | ❌ |
| 超过 26 人 | 27→**AA**、28→AB…；展示 `D4-522AA`；702→ZZ、703→AAA，无硬上限（seq 整数上限+运维告警） | — |
| CLOSED 后再激活 | 不允许（`CONFLICT`），需 admin 处理 | ❌ |
| 注销 | 顾客注销 binding RELEASED（`CUSTOMER_ACCOUNT_CLOSED`）；兼职 CLOSED 见上 | ❌ |
### 9.3 不变量
任一时刻每个顾客至多 1 条 ACTIVE binding（`activeKey` 唯一）；任一（partnerId,dormKey）内 roomTag 不重复（`tagKey` 唯一+计数单调）；已用过的（partnerId,dormKey,roomTag）永不再分配（计数不回退）；`orders.dorm.roomTag` 是下单快照、之后不随绑定变化；换宿舍必须“RELEASED+新绑定”，禁止原地改 `dormSnapshot`，roomTag 只由 `bind.create`（及换宿舍重绑）写；**v0.9**：roomTag 恒大写、排序=大写字母序（绑定先后）；`bindings` **只能由 `bind.create`（顾客）写入**，兼职端/后台/代客下单流程不得写（工程门禁）。
## 10. 数据留存、cleanup 与注销
### 10.1 留存时间线
订单：终态（`completedAt`/`cancelledAt`）→180 天→匿名化（写 `anonymizedAt`）→再 30 天物理删｜顾客“删除记录”的订单：`deletedByCustomerAt`→7 天物理删（不再等 180 天）｜截图：终态/取消→7 天删（引用计数归零才删文件）｜未用 `upload_tickets`：`expiresAt`+24h 宽限后清（票据+无主文件）｜`invitation_codes` UNUSED：`expiresAt`→`EXPIRED`（保留审计，不重新生效）｜`admin_view_sessions`：结束后 7 天清理；过期票据记 `ACCOUNT_SWITCH_EXPIRED`｜**识别失败记录与原图引用（v0.8）**：入队→`retentionDays`（入队时快照 `config.recognitionFailureRetentionDays`，7~30、默认 30）→cleanup 删原图引用并置 `IGNORED`（`resolution.note='EXPIRED'`）；同一 `fileId` 被多单/多条失败记录共享时按**文件引用计数**（全部引用离开各自窗口才删），若仍被订单引用则按订单截图 7 天规则处理（**取两者较长**）｜账号注销：`deletionRequestedAt`→立即匿名化+删截图/`partnerNote`，30 天内物理删｜`rl:` 计数：窗口过期每日清（含 `rl:ai:`）｜**头像（v0.9）**：换头像即删旧文件、账号注销/删除测试账号即删头像文件；头像不进订单留存（订单不存头像）｜**测试数据（v0.9）**：测试订单/事件/留言/绑定/失败记录随测试账号 30 天清理（`config.testDataRetentionDays`，账号保留、审计摘要保留）；`purgeTestData` 可立即清空（dry-run + 二次确认 + 审计前后条数）；测试数据不进统计/报表/隐私主体清单（无真实微信资料）。
### 10.2 `cleanup` 伪代码（单个定时触发器，建议每 10 分钟；按到期判断幂等执行、批 100）

```
cleanup(serverNow):
  1 invitation_codes: status='UNUSED' && expiresAt<now → 条件更新 EXPIRED
  2 admin_view_sessions: expiresAt<now && endedAt=null → endedAt=expiresAt + audit ACCOUNT_SWITCH_EXPIRED(幂等,detail{viewMode,targetIsTest})；(endedAt||expiresAt)<now-7d → delete
  3 upload_tickets: usedAt=null && expiresAt<now-24h → delete；cloudPath 无订单引用→deleteFile
  3b recognition_failures(v0.8): createdAt<now-retentionDays → status='IGNORED'+resolution{note:'EXPIRED',by:'SYSTEM',at:now}+reviewedAt=now（幂等）；fileId 与订单引用合并计数为 0 → deleteFile（已删重复执行不报错）
  4 截图: orders 终态 && statusUpdatedAt<now-7d && image.fileId!='' → 引用计数 0 则 deleteFile+清 fileId
  5 匿名化: 终态 && anonymizedAt=null && statusUpdatedAt<now-180d → anonymizeOrder（§10.3）; anonymizedAt=now
  6 物理删: anonymizedAt<now-30d 或 deletedByCustomerAt<now-7d → deleteOrderCascade
  7 注销: users deletionRequestedAt<now-30d → deleteAccountCascade（含其有效 viewTicket 立即 endedAt）
  8 限流: counters 'rl:' && updatedAt<now-2d → delete；9 重算 partners.stats（单量）
  10 测试数据(v0.9): users.isTestAccount && coalesce(testLastUsedAt,createdAt)<now-testDataRetentionDays → 逐账号清 isTest 订单/事件/留言/绑定/失败记录/头像文件（账号保留，批≤6，幂等）；被 deleteTestAccount 标记的账号→级联删+相关会话 endedAt
  11 审计: admin_audit{adminOpenid:'SYSTEM',developerNo:'SYSTEM',action:'CLEANUP',detail:{counts}}
```
### 10.3 匿名化字段表（`anonymizeOrder`）
`orders`：`customerId/customerOpenid/partnerOpenid` 清 `''`（partnerId 留统计；测试单的合成 openid 同样清空）｜**`customerNo/partnerNo` 编号快照清空**（编号本身在注销后作废）｜`phoneTail/note/deliveryNote/cancelReason/exception.text` 清 `''`（**v0.9 起订单无 `displayName` 快照**）｜`dorm/guest` 置空｜`parcel.pickupCode/trackingTail/lockerNo/stationName` 清 `''`、`stationId` 保留｜`image.fileId` 清 `''`｜`claimTokenHash/claimExpiresAt/claimedAt` 清空（P1 预留）。
`order_messages`：`text='[已删除]'`、`fromId=''`，保留 `fromRole/createdAt`。`order_events`：`actorId=''`、`payload` 只留 `{reasonCode}` 等非 PII。`customers`：注销时清 PII（含 **`displayName/avatarFileId`**、`phoneTail`、宿舍）并写 `deletedAt/anonymizedAt/purgeAt`，**头像文件同步删除**。`partners`：CLOSED 时匿名化（openid/**displayName/avatarFileId**/停用或关闭原因），**头像文件同步删除**，文档保留审计；**测试账号删除/清理**同口径（清合成 openid 与测试数据，账号保留时只清数据）。`bindings`：顾客注销删 `partnerNote`；CLOSED 随释放保留历史但清空 `partnerNote`。`invitation_codes.usedBy` 置空（保留 usedAt/batchId 审计）。`recognition_failures`（v0.8）：上传者注销/兼职 CLOSED 时清 `uploaderOpenid=''`（保留 `sourceRole`/时间供审计），原图引用按引用计数规则删除（订单侧规则先行），`ocrTextMasked` 已去敏、随记录保留至到期（`†` §13.2 报备）。
### 10.4 注销流程
顾客注销：校验无进行中订单（有则 `INVALID_STATE`）→事务：bindings ACTIVE→RELEASED（`CUSTOMER_ACCOUNT_CLOSED`、清 partnerNote）；customers 匿名化（`deletedAt/anonymizedAt/purgeAt=+30d`，**`customerNo` 作废不再分配**，**`displayName/avatarFileId` 清空且头像文件立即删除**）；users `status='DEACTIVATED'`、`deletionRequestedAt=now`；对目标的有效 `admin_view_sessions` 立即 `endedAt`（记 `ACCOUNT_SWITCH_END`，detail.reason='TARGET_DELETED'）→cleanup 删截图、订单匿名化（+30d 物理删）、users/customers +30d 物理删；注销后登录只回 `status:'DEACTIVATED'`+提示、无业务数据。
兼职注销=`admin.setPartnerStatus(CLOSED)`：释放绑定、订单转异常/完成、文档保留审计、openid 不可再激活、**`partnerNo` 作废不再分配**、`invitation_codes.usedBy` 置空保留审计。**测试账号（v0.9）**：`admin.deleteTestAccount` 删除账号+头像文件+全部测试数据（订单/事件/留言/绑定/失败记录）并使相关会话立即 `endedAt`；`admin.purgeTestData` 只清数据保留账号；cleanup 清超 30 天未使用的测试数据；测试账号不涉及对真实用户的隐私披露（无真实微信资料）。
## 11. v3 → v4 字段映射（不迁移，D11；仅文档对照）
`Customer.id`（`c_*`）→ 无（v4 身份=openid；另发 `customerNo`）｜`Customer.name`→`customers.displayName`（≤20）｜`Customer.building`（`D4`/`3号楼`）→`zone+buildingNo`（规范形态可拆，旧写法人工重填）｜`Customer.dorm`（`522`/`A302`）→`room`（纯数字≥100 可迁，字母/旧格式拒绝）｜`Customer.phoneTail`→`customers.phoneTail`（原值）｜`Customer.note`→`bindings.partnerNote`（语义映射，≤100）｜`Customer.chatRoomId`（16 hex 摘要）→ 无（v4 绑定走**完整 `partnerNo`**）｜`Customer.placeholder`（未归类）→ 无（v4 每单必须有顾客；代客单走 guest、无认领）｜`Customer.deletedAt/deleteBatch`→ 无（v4 用 deletedByCustomerAt/注销，无回收站）。
`Parcel.stationName`→`orders.parcel.stationId+stationName`（先 P1~P8 归一、别名收敛、未识别留空）｜`Parcel.pickupCode/lockerNo/trackingTail`→`orders.parcel.*`（形态闸后原值）｜`Parcel.status(todo/done)`→`orders.status`（done→COMPLETED 人工确认、todo→SUBMITTED）｜`Parcel.pickedAt`→`orders.pickedAt`+PICKED 事件｜`Parcel.doneAt/archivedAt`→`orders.completedAt`｜`Parcel.source(ocr/manual)`（v3 端侧 OCR 来源）→ **v0.8 映射为** `orders.parcel.recognitionSource`：`ocr`→`RULE`、`manual`→`MANUAL`、AI 兜底被采纳→`DEEPSEEK`（来源仍由 `orders.source` 表"谁下单"，两者不同维度）｜`Parcel.customerId`→`orders.customerId`（需先人工认领 openid）。
本机键 `ex_college_v3.store`→ 禁止读写（新 appid，D2）；v3 站点规则 `utils/stations.js` P1~P8+别名→v4 stationId 字典（规则移植）；v3 楼区规则 `utils/buildings.js`（ZONES/栋号/宿舍号）→v4 服务端校验（规则移植）；v3 `phoneTail` 4 位/锚+键展示→v4 同口径。**v3 无编号概念：`customerNo`/`partnerNo` 为 v4 新生成，不迁移（D11 空库起）；v3 无 AI 兜底/失败复核概念，`recognition_failures` 空库起（v0.8）；v3 无微信头像/昵称采集概念 → v4 新增 `displayName`（微信昵称，必填）与 `avatarFileId`（`chooseAvatar`/默认头像），**不迁移任何 v3 头像**；v3 无账号切换/测试账号/roomTag 大小写概念 → v4 `users.isTestAccount`/`admin_view_sessions.viewMode` 空库起、`roomTag` 恒大写（v0.9）。**
## 12. 越权负向测试清单

| # | 场景 | 调用 | 期望 |
| :-- | :-- | :-- | :-- |
| 1 | 越权读他人订单/客户 | 兼职 A 查 B 订单；顾客查他人单；冒充 `customerId/partnerId` | `FORBIDDEN`（不返回空集，避免枚举） |
| 2 | 顾客枚举兼职 | `partner.getPublic` 遍历 `partnerNo`/超限 | 不存在→`NOT_FOUND`；超限→`RATE_LIMITED`；无列表/搜索 API |
| 3 | 未激活/停用/CLOSED 调兼职接口 | `partner.saveProfile`/`order.listPartner`/`order.accept` | `PARTNER_CLOSED`/`FORBIDDEN` |
| 4 | CLOSED 兼职被新绑定 | `bind.create` 指向 CLOSED 兼职 | `PARTNER_CLOSED`；`partnerNo` 不可复用 |
| 5 | 非白名单 openid 调 admin | `admin.createInvites`/`admin.listCustomers`/`admin.viewAsStart` | `FORBIDDEN`（含伪造前端入口） |
| 6 | 邀请码状态机/格式 | `partner.activate` 用已用/过期/作废/格式错码；重复激活 | `INVITE_USED`/`INVITE_EXPIRED`/`NOT_FOUND`/`VALIDATION_FAILED`；已有 partner→`CONFLICT` |
| 7 | 已绑定再绑定 | 有 ACTIVE binding 再 `bind.create` | `CONFLICT`，不产生第二条 ACTIVE |
| 8 | 上传票据越权/失效 | A 用 B 的 ticket；过期/已用 ticket 下单 | `NOT_FOUND`（不区分归属）/`INVALID_STATE` |
| 9 | 重放写请求 | 同 `clientRequestId` 连发 `order.create`/`order.accept`/`viewAsStart` | 第二次 `duplicated:true`（视角为同一票据），只 1 次副作用 |
| 10 | 角色越界 | 顾客调 `order.markPicked`/`order.correct`；兼职调 `order.confirmDelivery` | `FORBIDDEN` |
| 11 | 非法状态流转 | PICKED/DELIVERED 单顾客 `order.cancel`；`fromStatus=PICKED/DELIVERED` 的 EXCEPTION 取消；对 accept 调 `order.undo` | `INVALID_TRANSITION`/`INVALID_STATE` |
| 12 | 零金额断言 | `order.create` 传 `fee/price/addons/payStatus` 等未知字段；调 `order.markPaid` | `VALIDATION_FAILED`（`data.field`/action 未登记），库中无金额字段 |
| 13 | 改归属/换顾客 | `order.correct({customerId})` | `VALIDATION_FAILED`（白名单拒绝） |
| 14 | 兼职读他人顾客/留言 | B 身份读 A 的 bindingId；`message.list` 他人单 | `FORBIDDEN` |
| 15 | 输入/文件/服务闸 | 非 jpg/png、>500KB；未启用服务/范围外宿舍；文本超限 | `VALIDATION_FAILED`（`data.field`） |
| 16 | 换宿舍时有进行中订单 | `customer.saveProfile` 改 dormKey | `INVALID_STATE`；无进行中单→旧 binding RELEASED+新绑定（禁原地改快照） |
| 17 | 注销/停用/匿名化后读取 | DEACTIVATED 调业务接口；CLOSED 兼职操作；admin 读已匿名化单 | `FORBIDDEN`；匿名化单 PII 与编号快照全空 |
| 18 | 代客单无认领（MVP） | 顾客调 `bind.claimGuestOrder` | `NOT_FOUND`（不暴露内部状态） |
| 19 | 编号前缀误用 | `C-…`/`DEV-…` 调 `bind.create`/`partner.getPublic` | `VALIDATION_FAILED` + 人话提示（顾客编号/开发者编号不能绑定） |
| 20 | 编号当鉴权 | 带他人 `customerNo`/`partnerNo` 调列表接口 | `FORBIDDEN`（编号仅筛选条件，与身份不符即拒） |
| 21 | 编号并发唯一 | 并发首次建资料/并发激活 | 两条不同编号；唯一索引无重复、无覆盖 |
| 22 | 票据越权/过期/已结束 | 用 A 的票据或 `endedAt` 非空的票据读；`expiresAt<now` 的票据读 | 前者 `FORBIDDEN`；过期→`VIEW_TICKET_EXPIRED` 且 `admin_audit` 只落一条 `ACCOUNT_SWITCH_EXPIRED` |
| 23 | **切换会话越界（v0.9）** | `READONLY` 调写接口或非白名单读（`admin.listCustomers`）；`TEST_WRITE` 写非 `viewTicket.targetId` 归属的数据/调后台动作 | `FORBIDDEN`（前端置灰+服务端双保险；真实账号不可写） |
| 24 | 重复/覆盖开启视角 | 同 `clientRequestId` 连发 `viewAsStart`；不同请求再开 | 前者同一票据（幂等）；后者旧票据立即失效（读→`FORBIDDEN`） |
| 25 | 邀请码作废状态机 | 对 USED/EXPIRED 邀请码调 `admin.revokeInvite` | `INVALID_STATE`/`NOT_FOUND`（仅 UNUSED 可作废） |
| 26 | 后台脱敏与审计断言 | `admin.listOrders`/`listCustomers`/`getCustomer`；admin 各写动作 | 取件码打码、尾号后 2 位、宿舍只到苑+楼栋、无 openid；均落 `admin_audit`（含 `developerNo`），detail 无 L3 明文 |
| 27 | **非白名单调识别复核（v0.8）** | 普通 openid 调 `admin.listRecognitionFailures/getRecognitionFailure/fixRecognitionFailure/ignoreRecognitionFailure`（含伪造前端入口） | `FORBIDDEN`（白名单是唯一门槛），不返回任何失败记录/原图 URL |
| 28 | **越权读失败记录/原图（v0.8）** | 用他人 `failureNo` 调 `getRecognitionFailure`；构造 `fileId` 直取云存储；走非复核页接口取原图 | `NOT_FOUND`/`FORBIDDEN`；云存储客户端读全拒，URL 只能由云函数签发（5 分钟） |
| 29 | **原图访问审计与限面（v0.8）** | 复核页同一/不同记录多次查看原图；尝试批量/下载/导出 | 每次落 `FAILURE_IMAGE_VIEW`（含 `developerNo/failureNo`）；**不存在批量/下载/导出接口** |
| 30 | **AI 外发 payload 白名单（v0.8）** | 断言 `ai.parseParcel` 外发 DeepSeek 的键集合；客户端目录搜 `DEEPSEEK_API_KEY`/`api.deepseek.com` | 键集合**完全等于** `{ocrTextMasked,hintTrackingTail?,role}`（单测断言）；客户端零命中（工程门禁失败） |
| 31 | **兜底失败静默降级+必入队（v0.8）** | AI 超时/5xx/熔断/超配额/JSON 失败；OCR 无文本；图片不可读；同 `clientRequestId` 重试；同图多单逐单调用 | `ok:true`+`recognized:false`+`needsReview:true`+`failureId`；**不返回 `RATE_LIMITED`/不新增错误码**；`recognition_failures` 必有记录且 `failureCode` ∈ 五值；重试只 1 条（幂等），**同图多单各 1 条**（粒度=订单×截图，各自 `fileId` 相同/`failureId` 不同） |
| 32 | **复核补录边界（v0.8）** | `fixRecognitionFailure` 对已 `IGNORED` 记录/非法站点/非法码/全空字段；补录后检查关联订单；`notifyUploader:true` 与缺 note 的 ignore | `INVALID_STATE`/`VALIDATION_FAILED`；**逐单回填本记录关联订单**（不批量改同图其他单）`status/statusUpdatedAt` 不变、无 `order_events`、不代确认、不改归属；`version+1`；缺 note→`VALIDATION_FAILED`；通知是**参数**不是动作（不产生新 action）；审计 `FAILURE_FIX`/`FAILURE_IGNORE` |
| 33 | **绑定方向（v0.9）** | 兼职身份调 `bind.create`；顾客绑自己（`partner.openid==caller effectiveOpenid`）；代客下单后断言 `bindings` 未新增 | `FORBIDDEN`（兼职调用/自绑）；**代客单不写 `bindings`**；兼职端/后台无任何“绑定顾客”接口或入口 |
| 34 | **真实账号传 `TEST_WRITE` / 票据挪用（v0.9）** | 真实顾客/兼职目标开 `mode='TEST_WRITE'`；用他人票据/过期票据；`TEST_WRITE` 票据写非 `viewTicket.targetId` 归属的订单/资料 | `FORBIDDEN`（签发时 + 每次请求 `targetIsTest && targetId===effectiveOpenid` 双校验）；过期→`VIEW_TICKET_EXPIRED`；不产生他人/真实数据 |
| 35 | **真实×测试互操作（v0.9）** | 真实顾客 `bind.create` 绑测试兼职；真实账号把订单下给测试兼职；测试顾客绑真实兼职；测试×真实留言/代客单 | 全部 `FORBIDDEN`；`bindings`/`orders`/`order_messages` 均无新增 |
| 36 | **头像/昵称可见性（v0.9）** | 未绑定顾客调 `partner.getPublic`；绑定后读对方；解绑/停用/注销后读对方 DTO；换头像后读旧 fileId；昵称未过 `msgSecCheck` 提交 | 绑定前**无 `avatarFileId`**（只有昵称）；绑定后有；解绑/停用/注销后**不再返回**；旧 fileId 失效→客户端回默认头像；未过检→`VALIDATION_FAILED` |
| 37 | **测试数据不入真实口径（v0.9）** | 造测试账号/测试订单后查 `admin.stats`、`order.listPartner counts`、后台红点、邀请码报表、`admin.listOrders` 默认列表 | 全部为 0 / 不出现测试数据；`includeTest=true` 才可见且带 `TEST` 标签；真实用户列表不含测试账号；真实×测试互操作已在上一条拒绝 |
| 38 | **测试账号权限与配额（v0.9）** | 非白名单 openid 调 `admin.createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData`；超每角色 3/合计 6；测试账号执行停启用/邀请码/工单 | `FORBIDDEN`；配额超限 `VALIDATION_FAILED`；**测试账号不可执行真实治理动作**（目标必须真实账号） |
| 39 | **头像上传与票据用途（v0.9）** | TICKET 票据当 AVATAR 用/反之；用他人 `avatarTicket`；>200KB / 非 jpg-png / 路径越界；替换头像后旧文件；第 6 次/日上传 | `VALIDATION_FAILED`/`NOT_FOUND`（票据不区分归属）/`RATE_LIMITED`；旧文件删除；`avatars/{role}/{random}.jpg` 不可枚举、不含 openid |
| 40 | **测试数据清理安全闸（v0.9）** | `purgeTestData` 缺 `dryRun`/`confirmText`；`deleteTestAccount` 无二次确认；测试数据被真实账号引用时清理；删除后检查会话与审计 | `VALIDATION_FAILED`；有真实引用→`INVALID_STATE` 拒绝；审计记**前后条数**；删除测试账号后相关会话立即 `endedAt`（`ACCOUNT_SWITCH_END`）；账号+数据+头像文件全删 |

断言归属：1~26 建议云函数单测（fake DB 注入不同 openid）；**27~32 建议云函数单测 + fake DeepSeek 适配层（超时/5xx/熔断/配额注入）**；30 的客户端零命中、12 的未知字段拒绝建议门禁/schema 自动化断言；8、15、19 建议真机/双机联调点检（`docs/QA_CHECKLIST.md`，agent 不代宣布通过）；9、12、26、29 建议审计与 DTO 投影断言。
## 13. 口径关闭情况与用户裁决项
### 13.1 v0.7 回填落点（逐项可核对）

| # | v0.7 回填项 | 本文落点 |
| :-- | :-- | :-- |
| 1 | 零金额字段删除（orders 金额字段、`service` 只 `{code,name}`；stats 去收入；config/serviceCatalog/serviceConfig/模板去金额） | §0.3/§2.3/§2.3.1/§2.5/§2.10/§3/§4.8 块 A/§7.5 |
| 2 | 零金额动作与事件删除（`markPaid/unmarkPaid`、`PAYMENT_*`、取消原因 `PRICE_ISSUE/PAYMENT_TIMEOUT`） | §7.5/§8.2/§8.3/§8.4/§12#12 |
| 3 | 零金额扫描门禁与白名单（删除/废弃/不存在标注行豁免） | §0.3/§6.5/§14 |
| 4 | `customerNo`（C+8、`C-XXXX-XXXX`、唯一索引、首次建资料生成、碰撞重试≤5、不可改不复用、不用 counters 自增） | §2.2/§2.9/§4.1/§4.2/§5.1/§7.3 |
| 5 | `partnerNo` 全面替换旧 `partnerCode`（字段/DTO/API 入参/绑定/公开预览/订单快照/索引/测试） | §2.3/§2.4/§4/§7.4/§12 |
| 6 | `orders.customerNo/partnerNo` 快照（不参与鉴权、匿名化清空） | §2.5/§3/§4.8 块 A/§10.3 |
| 7 | `developerNo=DEV-01` 由 `ADMIN_OPENIDS` JSON 映射，只进审计/后台，不落业务表 | §2.11/§2.13/§4.1/§6.1/§7.7 |
| 8 | 编号规则表（字母表/正则/展示分组/输入容错/前缀必填/错前缀提示/可见性/不作鉴权/不显示 openid） | §4.2/§6.3/§12#19/§12#20 |
| 9 | `invitation_codes` 替换 `activation_codes`（字段/状态机/索引/术语）；错误码收敛为 13 个、`INVITE_*` 替换 `CODE_*` | §1/§2.8/§4.3/§5.1/§7.2 |
| 10 | `admin.createInvites`（批量≤50/24h·72h·7d·30d 默认 7d/note≤50）、`revokeInvite`（仅 UNUSED）、`listInvites`；cleanup 置 EXPIRED | §7.6/§4.3/§7.8/§12#25 |
| 11 | `partner.activate` 入参 `invitationCode`；激活成功生成 `partnerNo` | §4.3/§7.4 |
| 12 | admin 动作全表（listCustomers/getCustomer/listPartners/setPartnerStatus/listOrders/getOrder/listAudit/updateConfig/stats/bootstrap）与后台默认脱敏 | §7.6/§7.7/§12#26 |
| 13 | `admin_audit` 动作枚举（v0.9 统一为 `ACCOUNT_SWITCH_START/END/EXPIRED`，旧 `VIEW_AS_*` 作废）与字段；`admin_view_sessions` 集合（`viewMode/targetIsTest/targetAvatarFileId`/索引/TTL 默认 30 分钟/同一开发者单票据）+ cleanup 清理 | §2.11/§2.13/§5.1/§5.2/§7.7/§7.8/§10.2 |
| 14 | `viewAsStart/viewAsEnd` 契约、读白名单（10 个）、写动作 `FORBIDDEN`、`VIEW_TICKET_EXPIRED`、目标须 ACTIVE | §7.6/§7.7/§6.1/§6.2/§12#22~#24 |
| 15 | `serviceConfig` 去价格（`services[{code,enabled}]`/`zones`/`acceptingOrders`）；`config.viewTicketTtlMinutes` | §2.3.1/§2.10/§6.3/§7.7 |
| 16 | 权限矩阵更新（开发者列/只读视角/编号可见性/零金额行）与负向测试更新（v0.7 26 条 + v0.8 6 条 = 32 条；v0.9 追加 8 条 → 40 条） | §6.3/§12 |
| 17 | 头部版本/依据改 CONTRACT v0.7；旧 v0.6 收款/激活码口径标注作废 | 文首/§13.2 |
### 13.1b v0.8 回填落点（逐项可核对）

| # | v0.8 回填项 | 本文落点 |
| :-- | :-- | :-- |
| 1 | **14 集合**：`recognition_failures` 逐字段表（含 `failureNo` 生成规则/`requestKey†` 入队幂等/`failureCode` 5 值/`status` 3 值/`resolution`/`retentionDays`）、读屏蔽、索引、查询路径、**粒度=订单×截图** | §0.4/§1/§2.14/§4.9/§5.1/§5.2 |
| 2 | `config` 增 `recognitionFailureRetentionDays`（7~30 默认 30，**可后台配**）与 `aiFallback{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}`（无金额、无 Key、不下发客户端；**MVP 后台只读展示、`admin.updateConfig` 白名单不含、改值走部署脚本/控制台**） | §2.10/§6.5/§7.6/§7.9 |
| 3 | `orders` 可选字段 `parcel.recognitionSource(RULE\|DEEPSEEK\|MANUAL)`、`parcel.confidence?`、`image.failureId?`（记录粒度=**订单 × 截图**：多单共享同一 `fileId`、`failureId` 按单独立，未建单保留 `orderId=''`） | §2.5/§3/§4.9/§7.9 |
| 4 | `ai.parseParcel`：入参白名单/二次去敏/8s 超时/重试/熔断/限流；返回 DTO 逐字段=CONTRACT §4.3；降级 `ok:true+recognized:false`、**不新增错误码** | §0.4/§4.9/§6.2/§6.5/§7.1/§7.2/§7.6/§7.9 |
| 5 | admin 四动作 `listRecognitionFailures/getRecognitionFailure/fixRecognitionFailure/ignoreRecognitionFailure`：权限/脱敏/审计/原图临时 URL 5 分钟/**逐单补录边界**/`notifyUploader?` 参数（通知不单拆动作） | §2.14/§6.2/§6.3/§7.6/§7.9/§12#27~#29/#32 |
| 6 | `admin_audit` 增 `FAILURE_IMAGE_VIEW/FAILURE_FIX/FAILURE_IGNORE` 与 `target.type='recognition_failure'` | §2.11/§2.14/§7.9 |
| 7 | cleanup 两项（识别失败到期清理、`rl:ai:` 计数）+ 留存时间线/匿名化口径（上传者注销） | §7.8/§10.1/§10.2/§10.3 |
| 8 | 权限矩阵/限流/日志脱敏/云存储例外/只读视角拒绝 `ai.parseParcel` | §6.2/§6.3/§6.4/§6.5/§7.7 |
| 9 | 负向测试 27~32、DoD 项、头部版本改 v0.8、v3 来源映射（ocr→RULE/manual→MANUAL/DEEPSEEK） | §12/§14/文首/§11 |
| 10 | 全文零金额词表不新增命中（AI 字段只有次数/毫秒/布尔/枚举） | §0.3/§0.4/§7.9/§14 |
### 13.1c v0.9 回填落点（逐项可核对）

| # | v0.9 回填项 | 本文落点 |
| :-- | :-- | :-- |
| 1 | `users` 增 `isTestAccount/createdByDeveloperNo/testLastUsedAt`；测试账号**合成 openid `TEST-<random>`**（`users._id`/`customers._id`/`partners.openid` 同值、非空串、不来自微信）、不计统计、仅测试账号互通 | §0.5/§2.1/§4.10/§5.1/§7.6 |
| 2 | `customers/partners` 增 `displayName`（必填、≤20、微信昵称一键填入可改、`msgSecCheck` v2）与 `avatarFileId`（`avatars/{role}/{random}.jpg` 不含 openid、≤200KB、jpg/png、替换删旧、注销删文件、默认头像兜底） | §2.2/§2.3/§2.12/§4.1/§6.4/§10 |
| 3 | `orders.isTest/impersonatedBy`、`order_events.impersonatedBy`；`isTest` 服务端派生禁客户端传；统计/红点/邀请码/报表排除测试数据；后台列表默认过滤（可切换带 `TEST` 标签） | §2.5/§2.6/§3/§4.10/§5.2/§7.6 |
| 4 | `admin_view_sessions` 增 `viewMode/targetIsTest/targetAvatarFileId`；`viewAsStart({role,targetNo,mode})`；**真实账号只允许 `READONLY`**、`TEST_WRITE` 仅测试账号 | §2.13/§4.8D/§7.6/§7.7 |
| 5 | 测试账号四动作 `createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData`（入参/出参/权限/审计/级联/dry-run+前后条数/有真实引用即拒绝）+ cleanup 超 30 天测试数据 | §7.6/§7.7/§7.8/§10.2/§10.4 |
| 6 | 绑定方向：`bind.create` 仅 CUSTOMER、**自绑拒绝**、代客单不写 `bindings`、真实×测试互绑/互下单拒绝、解绑后不返对方头像昵称、`bind.getCurrent`/`partner.getPublic` 头像昵称规则 | §0.5/§2.4/§4.8C/§7.4/§12#33~#35 |
| 7 | `upload.prepare({purpose:'TICKET'\|'AVATAR'})` + `upload_tickets.purpose`（`openid`=effectiveOpenid）；头像不占订单截图路径、票据用途不可混用 | §2.12/§4.1/§6.4/§7.6 |
| 8 | `roomTag` **恒大写** `A…Z/AA…`、展示 `D4-522A`、按大写字母序排序；旧小写算法/示例全部清除 | §2.4/§4.1/§4.6/§9/§12 |
| 9 | 负向测试扩展到 **40 条**（v0.9 增 #33~#40：绑定方向/真实传 TEST_WRITE 与票据挪用/真实×测试/头像昵称/测试数据零口径/测试账号权限配额/头像票据/清理安全闸） | §12/§14 |
| 10 | 全文清 v0.8 残句（小写 roomTag、不收集头像、第二微信号验收、单账号、`VIEW_AS_*` 旧审计名、“视角切换”旧称呼）+ 头部依据改 CONTRACT v0.9 + 身份传播 `actorOpenid/effectiveOpenid` | 文首/§0.5/§2.11/§4.10/§6.1/§6.2/§7.7/§13.2/§14 |

### 13.2 `†` 扩展字段报备（CONTRACT 未列，需 lead 确认）与旧口径关闭

**`†` 扩展字段报备（CONTRACT 未列，需 lead 确认）**：`users.updatedAt/purgeAt`（变更审计/注销清理）、`customers.deletedAt/anonymizedAt/purgeAt`（注销链路）、`partners.createdAt/updatedAt/suspendedAt/suspendedReason/closedReason`（生命周期/停用原因）、`bindings.tagKey/allocSeq/releasedBy`（roomTag 并发唯一/序号/释放者）、`orders.createdAt/updatedAt`（排序兜底/排障）、`orders.claimTokenHash/claimExpiresAt/claimedAt`（[P1] 认领预留）、`admin_audit.requestKey`（管理写幂等）、`admin_view_sessions.requestKey`（视角开启幂等）、`upload_tickets.draftId`（草稿校验，可只随票据存）、`config.subscribeTemplates`（[P1] 订阅消息模板 ID/开关）。**v0.8 新增报备**：`recognition_failures.retentionDays`（记录级固化保留天数，CONTRACT §4 行未列）、`recognition_failures.requestKey`（入队幂等键 `{uploaderOpenid}:{clientRequestId}`，唯一索引；CONTRACT §4 行未列）、`ruleResult`/`aiResult` 的字段形状与 `aiErrorCode` 六值枚举（CONTRACT 只列字段名）、`failureNo` 生成规则 `F-YYYYMMDD-XXXXXX`（CONTRACT 只列唯一）、`resolution.by='SYSTEM'`（到期清理）、`uploadTicketId` 归属校验失败仍入队（`ruleResult.ticketInvalid`）、识别失败记录在上传者注销后的匿名化口径（`uploaderOpenid=''`，§10.3）、`image.failureId` 由复核/下单写入的时序、`notifyUploader` 的站内消息落点（消息中心聚合视图，不新增集合）。**v0.9 新增报备**：`upload_tickets.purpose`（CONTRACT §4 集合行未列，§4.1/§5.3 已定义 `purpose` 入参）、测试账号 `_id` 格式 `TEST-<random>` 与三处同值口径（CONTRACT 只约定 `TEST-…` 前缀）、`admin_view_sessions.targetAvatarFileId` 仅切换会话内展示、`config.avatarMaxBytes` 经 `config.getPublic` 下发（CONTRACT 允许“等公开配置”）、`admin.stats` 增 `test` 计数字段、`users.testLastUsedAt` 写点（会话开启/测试写动作）、测试账号业务数据“账号保留、数据清空”的级联范围；如需改口径请 lead 裁决后回填 CONTRACT。

**旧口径关闭**：O-01~O-27 均已关闭（v0.4 独立 `upload_tickets`/删 `tagSeq`/三键族；v0.5 动作表全量、`deleteRecord`/`markRead`/`saveCustomerNote`/`cancel`/`getPublic`；v0.6 换宿舍重绑、DTO 分级、激活码错误映射、解绑 reason、客户列表排序、工作台 6 counts、截图路径、订阅模板入 config 等）。**v0.7 起明确作废**：v0.6“线下收款记账”口径（`payStatus`/`markPaid`/`PAYMENT_*`/统计收入，已删）、`activation_codes`/“激活码”术语（改 `invitation_codes`/“邀请码”）、旧 `partnerCode`（改 `partnerNo`）、`CODE_EXPIRED`/`CODE_USED`（改 `INVITE_*`）；v0.7 不重开任何 O 项。**v0.8 追加口径**（不删除历史结论）：OCR 兜底只做预填建议、失败静默降级入队、不新增错误码；识别失败原图是后台默认脱敏的**唯一例外**（临时 URL+审计+不批量）；`aiFallback` 值只有次数/毫秒/布尔/枚举，零金额口径继续有效。**v0.9 追加作废**：旧小写 roomTag/`D4-522a`、`VIEW_AS_*` 审计名、“不收集头像”“第二个微信号验收/MVP 单账号”“所有视角一律只读”等表述；`partner.getPublic` 绑定前回头像、头像路径含 openid、测试账号 `openid=''` 全部作废；`TEST_WRITE` 仅测试账号（真实账号不可写）；测试数据与真实数据同集合但严格隔离（**不建 `test_accounts`**）；绑定只能顾客发起（兼职可写视角不存在）。
### 13.3 需要用户裁决的事项（仅 D 级）

| # | 事项 | 本文默认 | 需用户确认 |
| :-- | :-- | :-- | :-- |
| D1+D2 | 后端=微信云开发 + 新 appid `wxf98c87a293092ef5`（数据层与隔离的前提） | 已按云开发/新 appid 设计；不读写 v1/v2/v3 本机键 | 架构前提是否维持 |
| D8 | 五个苑的正式中文名与 C 的含义 | `config.zoneLabels` 默认 `D 区`…`C 区`，只改配置即可 | 需用户给出苑名 |
| D13 | 主体与类目（个人主体能否上架快递/跑腿类目） | 阻塞提审，用户处理 | 需用户确认主体/类目 |
| D14+D15 | 真实账号只读（`READONLY`；可写切换只给测试账号，见 D18）；编号样式 `C-XXXX-XXXX`/`P-XXX-XXX`/`DEV-01`/测试账号 `TEST-<random>` | 已按用户二次+四次修订设计（真实账号只读+审计+服务端拒写；编号随机不可改） | 最终确认 |
| D16 | OCR 失败兜底用 **DeepSeek**：服务端调用、只发去敏文本（不发原图/openid）、8s 超时、5 次/人/日+全局配额、失败静默降级并入复核队列 | 已按云函数外呼+降级+入队设计；Key 只在环境变量、换服务只改适配层；`aiFallback.enabled` 可整体关停 | 方案是否确认（关停后回退为纯手填） |
| D17 | 识别失败**原图**在开发者复核页可见：仅白名单、临时 URL 5 分钟、每次审计、不批量/不下载、默认 30 天（7~30 可配）；补录只回填识别字段、不改订单状态 | 已按此设计；原图是本程序后台默认脱敏的**唯一例外**，写入 §11 隐私承诺与工程门禁 | 保留期与"是否允许看原图"需用户确认 |
| D18 | 账号切换模式：真实账号只读 + 测试账号可写（后台合成 `isTestAccount` 账号，单机验收两端；测试数据隔离/标记/排除统计/30 天清理） | 已按 v0.9 设计（`READONLY`/`TEST_WRITE`；合成 openid `TEST-<random>`；不建 `test_accounts`） | 方案是否确认 |
| D19 | 头像/昵称采集：`chooseAvatar` + `nickname` 输入（昵称必填可改/手填、头像可拒绝→默认头像）；仅绑定双方可见；后台不展示头像、卡片/通知不含 | 已按 v0.9 设计（`displayName`/`avatarFileId`；`msgSecCheck` v2；解绑即失联 O2） | 方案是否确认 |
| D20 | 绑定方向：只能顾客发起绑定，兼职不能绑定顾客 | 已按 v0.9 设计（`bind.create` 仅 CUSTOMER、自绑拒绝、代客单不产生绑定、兼职仅解绑） | 已定（用户四次修订） |
| D21 | roomTag 恒大写 `A…Z/AA…`、展示 `D4-522A` | 已按 v0.9 设计（大写字母序=绑定先后；旧小写作废） | 已定（用户四次修订） |
## 14. 验收清单（文档级 DoD）
- [ ] **14 集合**逐字段表齐全（含 v0.8 `recognition_failures`；**v0.9 不新增集合/不建 `test_accounts`**），字段名与 CONTRACT v0.9 §3/§4/§4.2/§4.3 及 v0.9 增补行逐字一致；`†` 扩展字段已在 §13.2 报备。
- [ ] 动作名与 CONTRACT §5.3 逐字一致（含 `admin.createInvites/revokeInvite/listInvites`、`admin.viewAsStart/viewAsEnd`、**v0.8 `ai.parseParcel` + 四复核动作**、**v0.9 `admin.createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData`**）；**无** `order.markPaid/unmarkPaid`、`admin.generateCodes/revokeCode` 等旧动作。
- [ ] 零金额：字段/动作/事件/取消原因/统计/配置/DTO 均无金额语义；v0.8 `aiFallback` 只含次数/毫秒/布尔/枚举、`recognition_failures`/DTO 无金额键；扫描词表仅 §0.3/§0.4 声明行与带“已删除/已废弃”标注的旧口径行命中，其余正文零命中。
- [ ] 双角色编号：`customerNo`/`partnerNo`/`developerNo` 规格表齐全（字母表/正则/展示/生成时点/唯一索引/不可改不复用/容错/错前缀提示/可见性/不作鉴权）；**`failureNo` 生成规则与"不作鉴权"写明**；全文无 `partnerCode` 残留。
- [ ] 开发者：admin 动作全表、后台默认脱敏函数（含 `maskDisplayName`，**不展示头像**）、`admin_audit` 枚举（含 **v0.9 `ACCOUNT_SWITCH_START/END/EXPIRED` + `TEST_ACCOUNT_CREATE/TEST_ACCOUNT_DELETE/TEST_DATA_PURGE`**，旧 `VIEW_AS_*` 不出现）与 **`FAILURE_IMAGE_VIEW/FAILURE_FIX/FAILURE_IGNORE`**；`admin_view_sessions` 索引/TTL/`viewMode/targetIsTest`/读白名单/双模态写拒绝/过期审计齐全；`invitation_codes` 状态机、`INVITE_EXPIRED/INVITE_USED`、cleanup 置 EXPIRED、仅 UNUSED 可作废。
- [ ] **v0.8 识别兜底**：`recognition_failures` 字段表逐字对齐 CONTRACT §4/§4.3（`failureCode` 5 值、`status` 3 值 `PENDING→FIXED|IGNORED`、`resolution{stationId,stationName,pickupCode,note,by,at}`、`retentionDays`）+ 索引 + 零直读 + 客户端零读接口已写明。
- [ ] **v0.8 `ai.parseParcel`**：入参白名单与二次去敏、8s 超时/重试/熔断、5 次/人/日+全局配额、返回 DTO 逐字段=CONTRACT §4.3、降级 `ok:true+recognized:false`、**不新增错误码（仍 13 个）**、失败必写队列、`READONLY` 拒绝（`TEST_WRITE` 以目标测试账号触发）、客户端零外呼均已写明。
- [ ] **v0.9 账号切换与测试数据隔离**：`users.isTestAccount/createdByDeveloperNo/testLastUsedAt`+合成 openid `TEST-<random>`；`admin_view_sessions.viewMode/targetIsTest/targetAvatarFileId`；`TEST_WRITE` 仅测试账号、真实账号传 `TEST_WRITE`→`FORBIDDEN`；`orders.isTest/impersonatedBy` 服务端派生；`actorOpenid`/`effectiveOpenid` 分离与票据交叉校验；测试数据排除统计/红点/邀请码/报表；四动作安全闸（dry-run/二次确认/前后条数/真实引用拒绝/会话 endedAt）。
- [ ] **v0.9 绑定方向/头像昵称/roomTag**：`bind.create` 仅 CUSTOMER、自绑拒绝、代客单不写 `bindings`、真实×测试 `FORBIDDEN`；`displayName` 必填≤20+`msgSecCheck`、`avatarFileId` 路径 `avatars/{role}/{random}.jpg`≤200KB/替换删旧/注销删文件/默认头像、绑定前只回昵称不回头像、解绑后不返回；`roomTag` 恒大写 `A…Z/AA…`、展示 `D4-522A`、全文无 `D4-522a`/`excelLower`。
- [ ] **v0.8 复核四动作**：`list/get` 脱敏且列表无 `fileId/uploaderOpenid`、`get` 原图临时 URL 5 分钟+每次 `FAILURE_IMAGE_VIEW`、`fix` 只回填本记录自己那条订单（逐单，不改状态/不代确认/不创建/不改归属/不写 `order_events`/审计 `FAILURE_FIX`）、`ignore` 备注必填（审计 `FAILURE_IGNORE`）、**"通知上传者"是 `notifyUploader` 参数而非独立动作**（站内必做、订阅 P1）、不批量/不下载/不导出；**记录粒度=订单 × 截图**（同图多单各一条、`failureId` 按单独立、未建单保留 `orderId=''`）。
- [ ] v0.7 回填 17 项逐项落点可核对（§13.1），v0.8 回填 10 项逐项落点可核对（§13.1b），**v0.9 回填 10 项逐项落点可核对（§13.1c）**；无 `activation_codes`/`CODE_EXPIRED`/`CODE_USED`/`PAYMENT_`/`payStatus`/`VIEW_AS_*`/`partnerCode`/`D4-522a`/`excelLower` 残留。
- [ ] 每个集合有读屏蔽口径；每个写动作有权限、幂等键、限流、错误码；重复请求返回 `duplicated:true`；错误码仅 13 个（AI 失败不占错误码）。
- [ ] 索引覆盖 §5.2 每个查询路径（含编号搜索/邀请码/切换会话/**识别失败队列与到期清理**/**测试账号与测试数据清理**），分页禁止 skip；负向测试 **40 条**（§12：v0.7 26 + v0.8 6 + v0.9 8）覆盖越权/票据/前缀/编号/零金额/脱敏/复核/AI 外发与降级/绑定方向/真实×测试/头像昵称/测试隔离。
- [ ] 留存/cleanup/注销/匿名化字段级可执行（§10，含邀请码/切换会话（`READONLY`/`TEST_WRITE`）/编号快照/**识别失败记录与原图引用到期、上传者注销匿名化**/**头像文件与测试数据 30 天清理、`purgeTestData`/`deleteTestAccount` 级联**）；v3→v4 映射与 D11 一致（§11，含 OCR 来源映射与头像/昵称/测试账号空库起）。
- [ ] 与 CONTRACT v0.9 无冲突（冲突已按 v0.9 回填并在 §13.1c 逐项登记；审计补丁：合成 openid `TEST-<random>`、头像路径不含 openid、绑定前只回昵称、`actorOpenid/effectiveOpenid`、`ACCOUNT_SWITCH_*` 统管两种模式已吸收）；用户裁决项仅 §13.3（**D1~D21**）；无实现代码、无「略/TODO」占位。

*本文与 `docs/V4_CONTRACT.md` 冲突时以 CONTRACT 为准；CONTRACT 更新后本文需同步并记录版本变更。*
