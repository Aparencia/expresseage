# V4_UX_DEVELOPER · v4 开发者后台、账号切换与测试账号页面交互设计

> 版本：v0.9（2026-10-21，按用户第四次修订：开发者账号可**切换账号**——真实账号只读、**测试账号可写**（单机验收两端）；绑定只能顾客发起；roomTag 恒大写；顾客/兼职均采集微信头像与昵称；后台不展示头像）｜依据 **docs/V4_CONTRACT.md v0.9**（下称 CONTRACT）；本文 `§` = CONTRACT 章节，`D#` = CONTRACT §13 裁决项。
> 范围：`pkg-admin` 分包（**10 个后台功能页 + 后台消息，共 11 页**，v0.9 用「账号切换」替换原「视角切换」页），以及**切换会话**（真实账号只读 / 测试账号可写）在顾客端/兼职端页面上的表现与退出；顾客端细节见 `docs/V4_UX_CUSTOMER.md`，兼职端见 `docs/V4_UX_PARTNER.md`。
> 优先级：**CONTRACT > 本文 > 其他**；页面路径、字段、动作名、错误码、限额逐字引用 CONTRACT §1.1/§1.2/§1.3/§3/§4/§4.3/§5.3/§7/§8/§10/§11；API 字段级细节以 `docs/V4_DATA_MODEL.md` 定稿为准。
> **v0.9 新增（D18~D21）**：①**账号切换**页两 tab——真实账号（**只读**，黄条+拒写+审计）与测试账号（**可写**，蓝条+`TEST` 角标，单机验收两端；测试数据隔离/标记/排除统计/30 天清理）；②**多开发者账号**（`DEV-01`/`DEV-02…`，各自微信登录、会话与审计隔离；**小程序不能切换微信登录账号本身**）；③绑定只能顾客发起（后台无任何「绑定顾客」入口）；④`roomTag` 恒大写（`D4-522A`）；⑤头像/昵称仅绑定双方可见，**后台列表/详情不展示头像、昵称脱敏**。
> **v1.2 增补（D36 分享与朋友圈，2026-10-28 用户指令）**：后台 11 页**零分享入口**；切换会话统一隐藏右上角「转发/分享到朋友圈」菜单（`wx.hideShareMenu`，退出恢复；O3/M-33 关闭）；好友转发覆盖 19 个业务页、朋友圈仅 role/home/help 三页（落地=单页模式 scene=1154，静态降级）；卡片只有绑定卡/通用邀请卡两种、固定中性封面、**禁止页面截图、卡片零 L3**。后台侧约束与判据见本文 §6.11/§9。
> **v0.8 继续有效（D16/D17）**：识别失败时由云函数调 **DeepSeek API** 对去敏 OCR 文本做结构化兜底；后台只承接「失败入队 → 复核 → 补录/忽略/通知」，**不调用任何第三方 AI、不展示/下发 Key**；失败**原图**仅复核页**按单**临时查看（5 分钟 URL + 每次 `FAILURE_IMAGE_VIEW` 审计），**不批量/不下载/不导出**。
> 本文只写设计与验收，不写实现代码；正文不藏未决项，未决项集中本文 §10，跨文档回写项见本文 §10.4；本文自身章节一律用「本文 §x」引用。
> 关联：`docs/V4_DATA_MODEL.md`（API 契约/字段分级）、`docs/V4_ENGINEERING.md`（白名单/门禁/账号切换与头像昵称门禁/AI 兜底门禁）、`docs/QA_CHECKLIST.md`（真机点检，人执行）、`docs/privacy/`（第三方 AI、复核原图、头像昵称与账号切换披露）。
> **D6 零交易口径（CONTRACT §0/D6，v0.7 已关闭）**：本程序只做顾客下单、兼职接单履约与信息整理；开发者后台同样只做治理与信息查看，**不承载任何交易语义，不出现任何交易字段、计算、统计或文案**。本文交易类词仅作口径声明引用（见本文 §1.5）。

---

## 0. 通用约定
### 0.1 读者与写法
- 读者：实现后台与切换会话的前端/云函数作者、QA、设计评审；每页固定写目标/入口/线框/组件/数据来源/状态/交互校验/文案/跳转。
- 状态名、字段名、编号样式、错误码只认 CONTRACT v0.9；v0.6 旧字段（`activation_codes`/`activationCode` 与交易类字段）一律不采用；v0.8 字段（`recognition_failures`/`failureNo`/`failureCode`/`resolution`/`aiFallback`/`FAILURE_*` 审计）与 v0.9 字段（`isTestAccount`/`isTest`/`impersonatedBy`/`viewMode`/`targetIsTest`/`ACCOUNT_SWITCH_*`/`TEST_*` 审计、`avatarFileId`/`displayName`）只认 CONTRACT §4.2/§4.3。**roomTag 一律大写**（如 `D4-522A`），原文小写视为缺陷。

### 0.2 术语（逐字对齐 CONTRACT §3/§4）
| 术语 | 代码名 | 本文口径 |
| :-- | :-- | :-- |
| 开发者 | developer | 项目开发者本人；白名单准入；MVP 建议 1 个、**可配多个**（`DEV-01`/`DEV-02…`）；**不是**顾客/兼职业务身份（§1.1） |
| 开发者编号 | `developerNo` | `DEV-01`（多账号 `DEV-02…`）；由 `ADMIN_OPENIDS` JSON 映射给出（一个 openid 一个编号）；仅后台抬头与审计显示；不是登录凭据；各自微信登录、会话/审计按 openid 隔离 |
| 邀请码 | `invitationCode` | 12 位 32 字母表，展示 `XXXX-XXXX-XXXX`；一次性；可设有效期；可作废；落库去横杠大写 |
| 邀请码状态 | `invitation_codes.status` | `UNUSED`/`USED`/`REVOKED`/`EXPIRED`；中文：未使用/已使用/已作废/已过期 |
| 账号切换票据 | `viewTicket` | 32 位随机；仅内存保存；默认 30 分钟；单开发者单活；`viewMode ∈ {READONLY, TEST_WRITE}`（兼容旧称"只读视角票据"） |
| 切换上下文 | `viewContext` | 客户端内存对象（role/targetNo/targetDisplayName/targetIsTest/viewMode/expiresAt/ticket），不落本地存储 |
| 真实账号会话 | `viewMode='READONLY'` | 目标是真实 ACTIVE 顾客/兼职：黄条常驻、只读、服务端拒写、隐藏分享（§1.2，D14） |
| 测试账号 | `users.isTestAccount` | 开发者后台创建的合成账号（`_id='TEST-…'`、**合成 `openid='TEST-<random>'`**（非空串）、默认头像）；只能与测试账号互通、不计统计、后台列表默认排除（§1.3） |
| 测试可写会话 | `viewMode='TEST_WRITE'` | 目标是测试账号：蓝条 + `TEST` 角标、可写但只写测试数据；真实账号传 `TEST_WRITE` → `FORBIDDEN`（§1.3，D18） |
| 测试数据标记 | `orders.isTest` / `impersonatedBy` | 测试写产生的订单/事件带 `isTest=true` 与 `impersonatedBy={developerNo}`；后台默认过滤、统计排除（§1.3） |
| 后台审计 | `admin_audit` | `adminOpenid`+`developerNo`+`action`+`target`+`detail`+`at`；后台只展示 developerNo |
| 敏感级别 | L1/L2/L3 | L1 公开（编号/状态）、L2 业务（昵称脱敏、苑+楼栋、绑定、统计、审计；**头像不展示**）、L3 取件码/尾号/门牌/截图；后台默认脱敏，完整 L3 仅真实账号只读会话 |
| 识别失败记录 | `recognition_failures` | 一次识别失败的复核记录（`failureNo` 唯一）：含原图引用 `fileId`、去敏 OCR 文本、规则/AI 尝试结果、补录结果；仅开发者后台可见并审计（§4.3） |
| 失败码 | `failureCode` | `NO_TEXT`/`PARSE_MISS`/`LOW_CONFIDENCE`/`LLM_ERROR`/`IMAGE_UNREADABLE` 五值；后台中文文案见本文 §11.8 |
| 识别兜底 | `ai.parseParcel` | 云函数唯一外呼出口（DeepSeek）；后台不调用、不展示 Key；失败静默降级并写入复核队列（§4.3） |
| 原图查看审计 | `FAILURE_IMAGE_VIEW` | 复核页按单取原图临时 URL（5 分钟）并每次落审计；不批量/下载/导出（D17） |
| 复核结果 | `resolution` | `{stationId,stationName,pickupCode,note,by,at}`；只回填订单识别字段，不改订单状态/归属 |
| 目标账号 | target | 真实账号（ACTIVE 顾客/兼职，**只读**）或测试账号（**可写**）；真实账号用完整编号定位，测试账号从后台列表选；两类都只能在「账号切换」页进入（§1.3） |

### 0.3 页面五态模板
| 状态 | 判定 | 呈现 | 行为 |
| :-- | :-- | :-- | :-- |
| 加载 | 首屏请求中（≥300ms 才显示） | 骨架/局部 loading | 禁操作、保留返回 |
| 空 | 成功但无数据 | 说明「为什么空 + 下一步」 | 可刷新/可去创建 |
| 错误 | 网络/云函数失败 | 错误条或整页错误 + 重试 + 上次成功时间 | 保留已加载数据并标「可能不是最新」 |
| 无权限 | `FORBIDDEN`/非白名单 | 整页说明 + 出口 | 不展示任何后台数据 |
| 会话失效 | `VIEW_TICKET_EXPIRED` | 清内存 + toast + 回「账号切换」页 | 不留在目标页面；真实/测试会话文案区分 |
> 补充：维护态=顶部状态条（后台可用，顾客/兼职写接口拒绝）；搜索空态与真空态文案必须区分；**切换会话常驻条**=真实账号黄条 / 测试账号蓝条 + `TEST` 角标（本文 §6.4）；测试账号被删除或会话被覆盖时提示「测试账号已删除或会话已结束，已返回账号切换」。

### 0.4 后台九条设计原则
1. **服务端是唯一门槛**：后台入口显示与否只是体验，白名单校验在云函数每次请求做（§1.1/§11.3）。
2. **默认脱敏（原图按单例外）**：后台任何列表/详情先按脱敏 DTO 返回；完整 L3 只在真实账号只读会话；唯一例外 = 识别失败复核页**按单**查看该失败记录原图（临时 URL 5 分钟 + 逐次审计），不批量/不下载/不导出（§1.1 第 3 条例外、§4.3、D17）。
3. **治理动作最小***：只做邀请码、停启用、异常介入取消、配置、维护、账号切换与测试账号管理（新建/删除/清空测试数据）；不代用户做业务操作，不创建/代绑关系（§1.1 第 4/5 条、§1.3）。
4. **危险动作「后果句 + 二次确认 + 审计」**：不可逆动作（作废、停用、介入取消、维护）必须说清后果。
5. **状态真相来自服务端**：状态、计数、审计、切换会话一律服务端口径；前端不推算、不乐观改。
6. **切换会话是审计代理**：真实账号会话=黄条常驻 + 写操作双拒 + 票据不落盘（D14）；测试账号会话=蓝条 + `TEST` 角标 + 可写但只写测试数据（D18）；两者都全程审计、隐藏分享/转发。
7. **测试与真实严格隔离（D18）**：测试账号只能与测试账号建立绑定/下单/留言；测试数据带 `isTest`/`impersonatedBy`，后台默认过滤、不计统计/红点/邀请码；删除测试账号级联删其数据与头像，`purgeTestData` 二次确认 + 审计。
8. **头像/昵称最小展示（D19）**：后台列表/详情**不下发 `avatarFileId`、不展示头像**，昵称脱敏（本文 §5.2）；头像/昵称只随 ACTIVE 绑定关系给绑定对方；真实账号只读会话按目标可见范围展示，测试会话只能看到测试账号的默认头像。
9. **原图例外最小化（D17）**：原图不驻留页面、不缓存、不进日志/剪贴板/审计 detail；一次查看 = 一次取 URL + 一条 `FAILURE_IMAGE_VIEW`；复核列表不给缩略图、不给「显示全部」。
> 设计 token（CONTRACT §8）：后台中性灰蓝 `#3A4A5C`、主按钮品牌绿 `#1F7A5C`、危险 `#E54D42`、警告 `#F5A623`、背景 `#F6F7F9`、卡片 `#FFFFFF`、分隔线 `#EEEEEE`；真实账号黄条 `#FFF4CE` 底 + `#8A6D00` 字；测试蓝条 `#E8F0FF` 底 + `#2B6DE5` 字，`TEST` 角标底色 `#2B6DE5` + 白字 + 圆角 8rpx；头像圆形（列表 64rpx、资料/详情 96rpx，无头像/加载失败走默认首字色块）；字号 40/34/30/26/24rpx、8rpx 网格、卡片圆角 16rpx、按钮 12rpx、可点 ≥88rpx；后台无 tabBar。

---

## 1. 目标、角色与能力边界
### 1.1 开发者账号定义
| 维度 | 口径 |
| :-- | :-- |
| 身份 | 项目开发者本人；MVP 建议 1 个（`DEV-01`），**白名单可配多个**（`DEV-02…`，一个 openid 一个编号）；不同开发者各自微信登录、各自独立会话与审计；**小程序内不支持切换开发者微信账号本身**（平台限制，换人需换微信登录） |
| 准入 | openid 命中云函数环境变量 `ADMIN_OPENIDS`（JSON 映射 `{"<openid>":"DEV-01"}`），启动与每次请求校验；无自助注册、无提权入口 |
| 编号 | `developerNo` 由映射给出；只用于后台抬头与审计，**不是登录凭据** |
| 落库 | `DEVELOPER` **不写入** `users.roles`；不新增开发者集合（避免改库提权） |
| 业务身份 | 不是顾客/兼职业务身份：不创建顾客资料、不激活兼职；要看真实数据用**真实账号只读会话**（§1.2）；要真实操作用**测试账号可写会话**（§1.3，单机即可）；如需真实微信号双机验收用第二/第三微信号走普通流程 |
| 数据范围 | 邀请码全量、后台用户/订单/绑定/审计总览（默认脱敏、**统计排除测试数据**）、**识别失败复核队列（按单临时看原图，审计）**、**测试账号管理与测试账号数据**、全局配置、兼职状态、异常工单；切换会话内按目标身份读（真实只读/测试可写） |
| 失败姿态 | 白名单缺失/解析失败 ⇒ 所有 `admin.*` 返回 `FORBIDDEN`（fail-closed），后台入口不渲染 |
> `ADMIN_OPENIDS` 只存在云函数环境变量，不进代码/前端/数据库（§1.1/§11.3）；前端隐藏不作为安全边界。
> **原图例外（v0.8，§1.1 第 3 条例外）**：只有识别失败复核页能**按单**取该失败记录原图临时 URL（5 分钟 + 每次 `FAILURE_IMAGE_VIEW` 审计）；**不进切换会话读白名单、不提供批量/下载/导出**，非失败单原图仍只能走真实账号只读会话（D17）。
> **多开发者（v0.9）**：`ADMIN_OPENIDS` 值可形如 `{"<openidA>":"DEV-01","<openidB>":"DEV-02"}`；后台抬头显示**当前** `developerNo`；切换会话票据与审计按 `adminOpenid` 隔离、**不共享**；不存在「切换开发者」入口（平台限制，见 §1.1 第 1 条）。

### 1.2 能力总览
| 能力 | 页面 | 主要动作（CONTRACT §5.3） | 写 | 审计 |
| :-- | :-- | :-- | :-- | :-- |
| 邀请码生效控制 | `invite-codes` | `admin.createInvites`/`admin.revokeInvite`/`admin.listInvites` | 写 | `INVITE_CREATE`/`INVITE_REVOKE` |
| 后台数据查看 | `customers`/`customer-detail`/`partners`/`orders`/`order-detail` | `admin.listCustomers`/`getCustomer`/`listPartners`/`listOrders`/`getOrder` | 只读 | 后台访问审计按 §11.1 审计口径；切换会话全程审计 |
| 治理 | `partners`/`order-detail` | `admin.setPartnerStatus`；异常单 `order.cancel` 由 ADMIN 执行 | 写 | `PARTNER_SUSPEND`/`PARTNER_RESTORE`/`ORDER_ANOMALY_CANCEL` |
| 全局配置/维护 | `config` | `admin.updateConfig` | 写 | `CONFIG_UPDATE` |
| 总览与审计 | `overview` | `admin.stats`/`admin.listAudit` | 只读 | — |
| 账号切换（真实只读） | `account-switch`（真实账号 tab）+ 目标端页面 | `admin.viewAsStart({role,targetNo,mode:'READONLY'})`/`admin.viewAsEnd` + 读白名单 | 写（会话，只读） | `ACCOUNT_SWITCH_START`/`END`/`EXPIRED`（detail 含 `viewMode`/`targetIsTest`；`VIEW_AS_*` 已作废） |
| 账号切换（测试可写） | `account-switch`（测试账号 tab）+ 目标端页面 | `admin.viewAsStart({role,targetNo,mode:'TEST_WRITE'})`/`admin.viewAsEnd` + 读写接口 | 写（仅测试数据） | `ACCOUNT_SWITCH_START`/`END`/`EXPIRED`；测试写事件带 `impersonatedBy` |
| 测试账号管理 | `account-switch`（测试账号 tab） | `admin.createTestAccount`/`listTestAccounts`/`deleteTestAccount`/`purgeTestData` | 写 | `TEST_ACCOUNT_CREATE`/`TEST_ACCOUNT_DELETE`/`TEST_DATA_PURGE` |
| 识别失败复核 | `recognition-review` | `admin.listRecognitionFailures`/`getRecognitionFailure`/`fixRecognitionFailure`/`ignoreRecognitionFailure` | 写（补录/忽略） | `FAILURE_IMAGE_VIEW`/`FAILURE_FIX`/`FAILURE_IGNORE` |
> v0.9 admin 动作表共 **23 个**（CONTRACT §5.3：含 `viewAsStart({role,targetNo,mode})`/`viewAsEnd` + `createTestAccount`/`listTestAccounts`/`deleteTestAccount`/`purgeTestData`）；本文动作名逐字引用，不自造。

### 1.3 与顾客/兼职身份的关系
- 同一 openid 可同时是顾客与兼职（§1），但开发者 openid 默认**不**创建这两种业务身份；后台无「进入我的顾客/兼职身份」入口。
- **要看真实数据** → 真实账号只读会话（黄条 + 拒写 + 审计）；**要真实操作** → 测试账号可写会话（蓝条 + `TEST` 角标，单机验收两端，测试数据不碰真实用户）；如需真实微信号双机验收，用第二/第三微信号走普通流程。
- **平台限制**：小程序**不能切换登录的微信账号**，也没有"切换账号"平台能力；本页的「账号切换」= 应用内**账号代理切换**，不是换微信登录（§1.3）。
- 若开发者 openid 历史上已有业务资料，切换会话也不允许查看「开发者自己」（§1.2：不能查看开发者自己/其他开发者）。
- 真实账号目标只能是 **ACTIVE 顾客/兼职**；停用/注销/不存在统一「该用户当前不可查看」；测试账号只能从后台测试账号列表选，**不进真实用户搜索结果**。

### 1.4 明确不可做（CONTRACT §1.1 第 5 条/§10）
- 删除订单；修改订单状态（唯一例外：`EXCEPTION` 单的介入取消）。
- 作为顾客下单/取消/确认送达，或作为兼职接单/取件/送达/异常/改码/撤销。
- 导出完整个人信息；批量复制 L3；下载截图包；提供后台「显示完整」开关；**批量查看/下载/导出识别失败原图**（仅复核页按单临时查看，D17）。
- 查看或写入 openid；把 openid 下发到任何前端页面/日志/分享。
- 查看开发者自己或其他开发者；把邀请码长期复用/重新生效；**创建/代绑客户绑定**（绑定只能顾客发起，§4.2/§10；后台也没有"绑定顾客"入口）。
- **真实账号可写**：真实账号会话恒为 `READONLY`，对真实账号传 `mode='TEST_WRITE'` 必须 `FORBIDDEN`；也不存在"把真实账号临时变可写"的开关。
- 在小程序内切换开发者/顾客/兼职的**微信登录账号**（平台不支持；只能换微信登录或使用测试账号）。
- 让测试账号与真实账号互绑/互下单/互留言；把测试账号 `partnerNo` 给真实顾客、放进真实搜索结果或 `partner.getPublic`（测试账号一律 `NOT_FOUND`）。
- 对测试账号执行真实治理动作（停用/恢复/解绑/通知真实用户），或把测试数据当经营数据：测试账号只能在「账号切换」页删除/清空，测试会话内的解绑/取消/通知等只对测试内部生效，**不触发任何真实用户通知**。
- 展示/导出头像与完整昵称：后台列表/详情不展示头像、昵称脱敏，`avatarFileId` 不下发后台 DTO、不进日志/分享/通知。
- 把测试数据写进统计/红点/邀请码/审计报表，或让测试订单/测试账号出现在真实用户页面与真实列表（默认过滤，可显式切换"含测试数据"查看）。
- 后台直接改数据库（MVP 无此入口；控制台人工修数据不属本后台，须另立审计）。
- 在后台界面直接调用 DeepSeek/任何第三方 AI（外呼只在云函数层；后台不展示/下发 Key、端点与请求全文），也不把 AI 结果当作可覆盖用户手填的权威值（§4.3 合并策略）。
- 任何交易类动作（D6 已关闭，不存在）。

### 1.5 零金额口径（D6）
- 后台所有页面、接口、字段、统计卡、审计详情、配置项与文案**不出现**任何交易语义；不设交易入口，也不做交易统计。
- 总览只统计「今日订单/待处理异常/活跃兼职/顾客」等业务量，**统计排除测试账号与 `isTest` 订单**（D18/O9）；配置页只有服务类型名称/说明、苑名、公告、超时、留存、切换会话时长、头像大小上限、测试账号上限与维护模式。
- 验收按 CONTRACT §12 门禁词表扫描（AC-D-21）；本文交易类词仅为口径声明引用，按说明性文本登记白名单。

### 1.6 关键用户故事
- US-D1 发码：单个/批量（≤50）+有效期+备注+整批复制、可查状态与使用人；US-D2 作废与审计：仅未使用可作废、作废后激活失败、生成/作废各有审计。
- US-D3 脱敏排障：按编号/昵称查顾客/兼职/订单，无导出/完整显示/头像；US-D4 账号切换（真实只读）：目标三 tab+黄条+30 分钟+全程审计；US-D5 双保险：前端禁用+服务端拒写，到期/退出回「账号切换」页；US-D6 治理可追溯：后果句+二次确认+审计。
- US-D7 识别失败复核：失败入队 → 总览红点/后台消息 → 复核页按单看原图（逐次审计）→ 补录站点/取件码回填关联订单识别字段 → 站内通知上传者（`notifyUploader` 参数）；US-D8 原图边界：复核页无批量/下载/导出，非失败单原图仍只走真实账号只读会话，原图不驻留/不缓存。
- US-D9 测试账号单机验收：新建测试顾客 + 测试兼职 → 切换测试顾客下单 → 切测试兼职接单/取件/送达 → 切回测试顾客确认 → 全程蓝条 + `TEST` 角标、测试数据可清理；US-D10 隔离：真实账号永远只读、测试×真实互绑/互下单被拒、测试数据不进统计/红点/真实搜索；US-D11 多开发者：`DEV-01`/`DEV-02` 各自登录、抬头显示本人编号、会话与审计互不可见。

---

## 2. 信息架构与导航
### 2.1 launch 分流与准入
```
wx 启动 → pages/launch/index → user.bootstrap
  isDeveloper=true ──► wx.reLaunch('/pkg-admin/pages/overview/index')   ← 无 tabBar
  否则 ──► 按既有角色/资料/绑定分流（见 V4_UX_CUSTOMER / V4_UX_PARTNER）
  白名单缺失/解析失败 ──► isDeveloper=false（fail-closed，不显示后台入口）
```
- 不依赖 `?admin=1` 等前端参数（白名单是唯一门槛，§7）；后台页面全在 `pkg-admin` 分包内、无 tabBar，用页面内导航与返回栈；非白名单用户手动进入后台路径时首个请求即 `FORBIDDEN` → 整页说明「当前账号没有后台权限」→ `reLaunch` 回普通首页。

### 2.2 页面清单（路径逐字，CONTRACT §7）
| # | 路径 | 名称 | 入口 | 主要动作 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `pkg-admin/pages/overview/index` | 总览 | launch 分流 / 切换会话退出 | `admin.stats`、`admin.listAudit` |
| 2 | `pkg-admin/pages/invite-codes/index` | 邀请码 | 总览快捷入口 | `createInvites`/`revokeInvite`/`listInvites` |
| 3 | `pkg-admin/pages/customers/index` | 顾客列表 | 总览 | `admin.listCustomers` |
| 4 | `pkg-admin/pages/customer-detail/index` | 顾客详情 | 顾客列表行 | `admin.getCustomer` + `admin.listOrders` |
| 5 | `pkg-admin/pages/partners/index` | 兼职列表 | 总览 | `admin.listPartners`、`setPartnerStatus`、账号切换入口 |
| 6 | `pkg-admin/pages/orders/index` | 订单总览/异常工单 | 总览 | `admin.listOrders` |
| 7 | `pkg-admin/pages/order-detail/index` | 订单详情（只读） | 订单总览/异常工单 | `admin.getOrder`、异常单 `order.cancel`（ADMIN） |
| 8 | `pkg-admin/pages/config/index` | 全局配置 | 总览 | `admin.updateConfig`（读走 `admin.stats` 配置区块） |
| 9 | `pkg-admin/pages/account-switch/index` | 账号切换（真实只读 / 测试可写 + 测试账号管理） | 总览「切换账号」/顾客详情/兼职列表 | `viewAsStart`/`viewAsEnd` + `createTestAccount`/`listTestAccounts`/`deleteTestAccount`/`purgeTestData` + 目标搜索/列表 |
| 10 | `pkg-admin/pages/messages/index` | 后台消息 | 总览铃铛/红点 | `admin.listOrders(status=EXCEPTION)` + `admin.listRecognitionFailures(status=PENDING)` 摘要 + 配置状态（聚合视图） |
| 11 | `pkg-admin/pages/recognition-review/index` | 识别失败复核（v0.8） | 总览「识别失败待复核」卡/红点、后台消息摘要行 | `admin.listRecognitionFailures`/`getRecognitionFailure`/`fixRecognitionFailure`/`ignoreRecognitionFailure` |
> 后台页面共 **11 页 = 10 个功能页 + 后台消息**（与 CONTRACT §7 逐字一致）；v0.9 用 **`account-switch` 替换 v0.8 的 `view-as`**（页数不变，O11）；v0.8 新增 `recognition-review`；兼职详情仍用列表行展开半屏（本文 §3.5），审计「更多」在总览内分页（不单独建页，§1.1 第 6 条）。

### 2.3 后台导航与返回栈
- 根页 = `overview`；二级页 `navigateTo`、返回 `navigateBack`，不跨到顾客/兼职 tab 页（唯一例外是切换会话 `reLaunch`）；页间不传 openid，参数只用编号/ID/状态/模式（`?customerNo=`/`?partnerNo=`/`?orderNo=`/`?failureNo=`/`?status=`/`?tab=real|test`/`?mode=READONLY|TEST_WRITE`）。
- 任何页面 `onShow` 校验白名单态（服务端返回 `FORBIDDEN` 即退场），页面不缓存 L3；页面栈深度 ≤2，返回落点固定。
- 进切换会话用 `wx.reLaunch` 到目标角色首页；退出会话 `reLaunch` 回 **`account-switch` 页**（真实/测试会话一致，不用 `navigateBack`，防止栈里残留目标页；CONTRACT §1.2/§1.3/§7）。

### 2.4 账号切换导航（进入/退出，真实只读 / 测试可写）
- 入口统一：总览「切换账号」（或顾客详情/兼职列表快捷入口）→ `pkg-admin/pages/account-switch/index`；页面两个 tab：**真实账号（只读）** / **测试账号（可写）**（默认落上次使用 tab，首次落真实账号 tab；`?tab=real|test` 可直达）。
- 进入真实账号：选角色 → 完整编号搜索或列表选人（仅 ACTIVE）→ 确认卡（角色/编号/昵称/有效期/只读与审计）→ `viewAsStart({role,targetNo,mode:'READONLY'})` → `reLaunch` 目标角色首页（顾客 `pages/customer/home/index`，兼职 `pages/partner/workbench/index`）→ 黄条出现。
- 进入测试账号：测试账号 tab → 选择测试账号（或先新建）→ 确认卡（写明「将写入测试数据，不影响真实用户」）→ `viewAsStart({role,targetNo,mode:'TEST_WRITE'})` → `reLaunch` 目标角色首页 → 蓝条 + `TEST` 角标出现。
- 目标端按 `viewContext.role` 渲染三 tab（顾客=首页/订单/我的；兼职=工作台/客户/我的），`custom-tab-bar` 同一组件按角色渲染；真实会话顶部常驻黄条，测试会话顶部常驻蓝条且每页右上角常驻 `TEST` 角标；**两种会话都隐藏分享/转发/长按保存入口**（§1.2/§1.3/O3）。
- 退出：黄条/蓝条「退出」→ `viewAsEnd` → 清 `viewContext` → **`reLaunch` 回 `account-switch` 页**（可立刻切另一个账号）；冷启动/杀进程丢 `viewContext` 即无票据，若仍在过期前由 `cleanup` 收尾并记 `ACCOUNT_SWITCH_EXPIRED`（真实/测试统一审计名，`VIEW_AS_*` 已作废）。

### 2.5 通用状态与后台消息红点
- 加载/空/错误/无权限/维护/搜索空态按本文 §0.3；后台额外三条：**会话失效**（真实只读/测试可写，文案区分）、**限流**（`RATE_LIMITED`，如账号切换 20 次/日/开发者）、**测试数据过滤**（订单列表默认过滤 `isTest`，可显式切换「含测试数据」）必须给专属文案与出口。
- 后台消息是**服务端聚合视图**（与 §4 消息中心同原则）：不新增 `notifications` 集合、不加已读水位；MVP 组成 = 异常工单（`EXCEPTION` 订单）+ **识别失败待复核摘要行**（`PENDING`，取自 `recognition_failures`，跳复核页）+ 系统状态提示（维护中/公告开启）；**红点 = 待处理异常工单数 + `PENDING` 识别失败数，两者都只计真实数据（测试数据不计红点，D18/O9）**；不使用 `users.messageReadAt`；消息页只做「看与跳」，不提供批量处理（批量补录/忽略列 P1，本文 §10.3）。

---

## 3. 逐页规格
> 动作名逐字 CONTRACT §5.3，页面路径逐字 §7；线框元素即组件清单；未列细节按本文 §0.3 五态执行。

### 3.1 总览 `pkg-admin/pages/overview/index`
**目标/入口**：后台默认首页：一屏看清今日单量/异常/活跃用户（**统计排除测试账号与测试订单**），直达邀请码与账号切换，内嵌审计区块；由 launch 分流进入，账号切换页返回本页，二级页返回本页。
**线框**：
```
[开发者后台] {developerNo} · DEV-01   [公告/维护状态条] [消息铃铛·红点]
[今日订单][待处理异常][活跃兼职][顾客][识别失败待复核]   [生成邀请码][切换账号][订单总览][全局配置]
[最近审计] action · developerNo · target · at      [更多]
```
**组件/数据来源**：抬头（显示当前 `developerNo`，来源 `admin.stats.developerNo`）、状态条、统计卡（含 **识别失败待复核** 卡）、快捷入口、审计区块、铃铛；数据= `admin.stats`（含当前 `developerNo`；统计卡与红点计数，**排除测试账号与 `isTest` 订单**，含 `PENDING` 识别失败数）+ `admin.listAudit`（审计分页 20）+ 配置公开子集。
**状态/交互校验**：加载=骨架；空=计数显示 0 + 审计空态；错误=顶部错误条+保留上次数据并标时间；无权限=`FORBIDDEN`→整页说明+回普通首页。下拉刷新；统计卡点跳对应列表（异常→`orders?status=EXCEPTION`，活跃兼职→`partners`，顾客→`customers`，识别失败待复核→`recognition-review`）；红点 = 待处理异常 + `PENDING` 识别失败（现算，**只计真实数据**）；审计只读、不可编辑/导出，「更多」本页内分页。
**文案/跳转**：抬头`开发者后台`、副标题`{developerNo} · 仅用于治理与排障`、卡片`今日订单/待处理异常/活跃兼职/顾客/识别失败待复核`、审计空态`暂无审计记录。`、识别失败卡副文案`待复核 {n} 条 · 复核含原图查看（审计）`；跳 `invite-codes`/`account-switch`/`orders`/`config`/`messages`/`recognition-review`。

### 3.2 邀请码 `pkg-admin/pages/invite-codes/index`
**目标/入口**：邀请码生成、批量、复制、作废、状态查看的唯一入口；从总览「生成邀请码」进入，生成成功留在本页刷新列表。
**线框**：
```
[← 总览] 邀请码 [生成邀请码]   [全部 32][未使用 20][已使用 8][已作废 3][已过期 1]
行：****-****-{后4} · 未使用 · 批次 B{…} · 有效期至 {t} · 创建 {t} [作废]
已使用行：使用人 P-7K2-M9X 小王 · {usedAt}
```
**组件/数据来源**：状态筛选 tab（含计数）、邀请码行卡、生成弹层、生成结果弹层、作废确认框、空态；数据= `admin.listInvites({status?,cursor?,limit?})`/`admin.createInvites`/`admin.revokeInvite`。
**状态/交互校验**：加载=列表骨架；空=`还没有邀请码…`；筛选空=另一文案；错误=错误条+重试；无权限=回总览。生成数量 1~50、有效期四选一（默认 7 天）、备注 ≤50；提交防连点；作废仅 `UNUSED` 可点；分页 20、下拉刷新（细则本文 §4）。
**文案/跳转**：见本文 §11.3；行「作废」确认后原地刷新，使用人只读展示、不做跨页深链。

### 3.3 顾客列表 `pkg-admin/pages/customers/index`
**目标/入口**：按顾客编号/苑+楼栋/昵称检索顾客，默认脱敏（**不展示头像、昵称脱敏**），进入脱敏详情与真实账号只读切换入口；从总览「顾客」进入。
**线框**：
```
[← 总览] 顾客  [搜索：编号 / 苑+楼栋 / 昵称]  [显示测试账号 ▢]
行：C-7K2M-9QX4 · 小*** · D4 · 已绑定 P-7K2-M9X · 资料完整 · 进行中 1 / 累计 12 [详情]
```
**组件/数据来源**：搜索框、顾客行卡（脱敏字段，无头像位）、分页、空态、错误条；数据= `admin.listCustomers({keyword,cursor,limit})`（DTO 无 `avatarFileId`、昵称已脱敏）。
**状态/交互校验**：加载=骨架；空=`还没有顾客资料。`；搜空=单独文案；错误=错误条+重试；无权限=回总览。关键词 ≥2 字符、300ms 防抖；编号支持完整/前缀，宿舍只按苑+楼栋，**昵称模糊搜索由服务端匹配、列表只显示脱敏昵称**；不按取件码/尾号/房间号搜索（本文 §5.4）；**默认排除测试账号**（可切「含测试账号」查看并带「测试」标签，D18）。
**文案/跳转**：见本文 §11.5；行 → `customer-detail?customerNo=`；详情内「以该顾客身份查看（只读）」→ `account-switch?tab=real&role=CUSTOMER&targetNo=`。

### 3.4 顾客详情 `pkg-admin/pages/customer-detail/index`
**目标/入口**：单个顾客的脱敏资料（**无头像、昵称脱敏**）、绑定关系、订单摘要，提供真实账号只读切换入口，无写动作；从顾客列表行进入。
**线框**：
```
[← 顾客] C-7K2M-9QX4 小***
资料：D4（房间号隐藏）· 尾号 **78 · 资料完整 | 绑定：P-7K2-M9X 小*** · 正常 · {t}
订单：进行中 1 · 已完成 12 · 异常 0        [以该顾客身份查看（只读）]
最近订单（脱敏行）
```
**组件/数据来源**：资料卡（锚+键脱敏）、绑定卡、订单概览、订单行卡、切换按钮；数据= `admin.getCustomer({customerNo})` + `admin.listOrders({customerNo,cursor,limit})`；DTO **无 `avatarFileId`**、昵称脱敏。
**状态/交互校验**：加载=骨架；空=无订单空态；错误=错误条；无权限=回总览；目标不存在=`NOT_FOUND`「记录不存在或已注销」。房间号/roomTag（大写，如 `D4-522A`）/取件码/截图/头像不展示；不提供编辑/注销/停用（后台无顾客治理动作，§1.1 第 4 条）。
**文案/跳转**：脱敏说明`房间号与头像已隐藏、昵称已脱敏；完整资料仅在真实账号只读会话中按目标身份查看。`；订单行 → `order-detail?orderNo=`，切换 → `account-switch?tab=real&role=CUSTOMER&targetNo=`。

### 3.5 兼职列表 `pkg-admin/pages/partners/index`
**目标/入口**：检索兼职、看状态/绑定数/单量（**单量统计排除测试数据**）、停用/恢复、进入真实账号只读切换；详情用行内展开不新建页；从总览「活跃兼职」进入。
**线框**：
```
[← 总览] 兼职  [搜索完整兼职编号]  [显示测试账号 ▢]
行：P-7K2-M9X 小*** · 接单中 · 绑定 6 · 今日 8/累计 240  [展开][切换]
展开：服务类型 3 项 · 最近激活 {t} · [停用] / 已停用 [恢复]
```
**组件/数据来源**：搜索框、状态筛选、行卡（无头像位、昵称脱敏）、行内展开半屏、停用/恢复确认框、切换入口；数据= `admin.listPartners({keyword,status?,cursor,limit})`/`admin.setPartnerStatus`。
**状态/交互校验**：加载=骨架；空=`还没有兼职人员。`；搜空=单独文案；错误=错误条；无权限=回总览；已注销（CLOSED）行只读、无操作按钮。停用/恢复流程见本文 §7.2；不展示 openid/完整手机号/头像；**默认排除测试账号**（可切「含测试账号」查看并带「测试」标签；测试账号的真实治理动作不可用，只能删除/清空，D18）。
**文案/跳转**：标签`接单中`/`已停用`/`已注销`，确认文案见本文 §11.6；`[切换]` → `account-switch?tab=real&role=PARTNER&targetNo=`。

### 3.6 订单总览/异常工单 `pkg-admin/pages/orders/index`
**目标/入口**：订单总览与异常工单入口，筛选、搜索、进脱敏详情；**默认过滤测试数据**（D18/O4）；从总览「今日订单」/「待处理异常」进入。
**线框**：
```
[← 总览] 订单  [全部][进行中][异常 2][已完成][已取消]  [搜索 订单号/顾客编号/兼职编号]  [显示测试数据 ▢]
行：{orderNo} · {状态} · {服务类型} · D4 · {statusUpdatedAt} · {N 件（N>1 时）} · {无截图（manualEntry）}   [详情]
测试行（开启后出现）：[测试] {orderNo} · {状态} · {服务类型} · {statusUpdatedAt}
异常行（置顶）：{异常码文案} · 上报 {t} · P-7K2-M9X
```
**组件/数据来源**：状态筛选 tab（含计数，**只计真实数据**）、搜索框、订单行卡（脱敏、无头像）、测试数据开关（默认关）、分页、空态；数据= `admin.listOrders({status?,keyword?,cursor,limit,includeTest})`（默认 `includeTest=false`，仅测试数据时可切 `true`）；**v1.0/D23 行字段**：`parcelCount`（件数，仅 N>1 显示「N 件」chip）、`needCodeCount`（「N 件需查明」）、`manualEntry`（「无截图」chip）、`delivery{zone,buildingNo,buildingText}`（地址列只显苑/楼栋或下单人宿舍脱敏串）；**列表行不下发逐件取件码/柜号/尾号**（防泄漏，逐件只在详情打码后展示）。
**状态/交互校验**：加载=骨架；空=`当前筛选下没有订单。`；异常空=`没有待处理的异常工单。`；错误=错误条+重试；无权限=回总览。状态筛选/搜索只影响列表、不改计数；异常工单置顶；行只读；**测试数据开关只影响列表展示，不改统计与红点**；分页 20、下拉刷新。
**文案/跳转**：见本文 §11.5；行 → `order-detail?orderNo=`；异常行 → 详情并显示「介入取消」；测试行带 `测试` 标签（不可介入取消，测试单按测试流程处理）。

### 3.7 订单详情 `pkg-admin/pages/order-detail/index`
**目标/入口**：单订单只读全量视图（脱敏），异常单可介入取消；从订单总览/异常工单/后台消息进入；测试订单仅在「显示测试数据」开启时可进入。
**线框**：
```
[← 订单] {orderNo} · {状态}            [测试]（仅测试单）   [无截图·手填]（manualEntry）
顾客：C-7K2M-9QX4 小***     兼职：P-7K2-M9X 小***
配送：D4 · 2栋            （delivery 只到苑+楼栋；历史单回退脱敏 dorm）
包裹（1~10 件，逐件打码）：第 1 件 · P4 菜鸟驿站 · 取件码 7***9 · 柜号 *** · 尾号 ***78
                        第 2 件 · P6 快递柜 · 需查明（NEED_CODE）
服务：标准代取 · 预约 ASAP · 备注 {note} · 时间线只读   [介入取消（仅真实 EXCEPTION）]
测试单追溯行：由 DEV-01 以测试账号写入（isTest=true，仅显示 developerNo）
```
**组件/数据来源**：状态卡、双方编号卡（无头像、昵称脱敏）、**逐件包裹卡（`parcels[]`，顺序=itemIndex，单件单不显示件序号）**、配送地址行、服务/预约/备注、时间线、介入取消按钮与确认框、测试单标签与追溯行；数据= `admin.getOrder({orderNo})`（含时间线，字段以 DATA_MODEL 为准；`parcels[]` + `parcel`=首件兼容 + `images[]{hasImage,cleaned}` + `imageUploaded` + `manualEntry`；历史单 `parcels` 缺失时回退 `parcel{}` 单件）；**`delivery` 只下发 `zone/buildingNo/buildingText`**，页面不得展示/请求 `recipientName/phoneTail/room/dormKey`；介入取消走 `order.cancel`（ADMIN 执行）。
**状态/交互校验**：加载=骨架；错误=错误条；无权限=回订单列表；不存在=`NOT_FOUND`；非异常无「介入取消」；**测试订单不显示「介入取消」**（测试数据按测试流程处理/清空，不进真实治理动作）。截图无入口（仅真实账号只读会话可看），无「显示完整」；介入取消仅真实 `EXCEPTION`，原因必填 ≤200 + 二次确认（本文 §7.3）。
**文案/跳转**：见本文 §11.6，脱敏说明`敏感信息默认脱敏；完整值仅在真实账号只读会话中按目标身份查看。`；返回订单总览，取消成功原地刷新。

### 3.8 全局配置 `pkg-admin/pages/config/index`
**目标/入口**：维护全局配置与维护模式，所有配置项无交易语义；从总览「全局配置」进入。
**线框**：
```
[← 总览] 全局配置  [保存]
服务类型模板：PICKUP_STD 标准代取 / PICKUP_DOOR 送寝上门 / …（改名称/说明）
苑名：东苑 / 西苑 / 南苑 / 北苑 / 翠苑（D8 已裁决，可改）
站点名称：P1 西苑顺丰快递（西苑五食堂） / P2 …（固定 8 条，可改名称；保存前变更清单） | 公告：[开关] 标题（≤30）正文（≤500）
超时 120 分钟 · 自动完成 24 小时 · 截图留存 7 天（≤7）· 识别失败留存 30 天（7~30）
切换会话 30 分钟（5~60）· 头像大小上限 200KB（≤200KB）
测试账号上限 3/角色（合计 ≤6）· 测试数据保留 30 天（默认 30）
[维护模式：关闭] 维护说明 {text}
```
**组件/数据来源**：分组表单、开关、数字输入、文本域、**站点名称 8 行（固定 id + 名称输入；v1.1/D32）**、保存按钮、二次确认框、脏数据返回拦截；读= `admin.stats` 配置区块（公开子集可由 `config.getPublic` 校对），写= `admin.updateConfig`。
**状态/交互校验**：加载=表单骨架；错误=错误条+保留输入；保存中=按钮 loading+全表单禁用；无权限=回总览；维护态=顶部状态条。字段与值域见本文 §7.4；保存前展示变更清单并二次确认；未保存返回需确认；配置页不含隐私版本号、`aiFallback` 内部参数与任何交易项；**站点名称仅可改 8 条固定 id 的名称（1~20 字、唯一），不允许新增/删除站点**。
**文案/跳转**：见本文 §11.6；保存成功留在本页，返回总览。

### 3.9 账号切换 `pkg-admin/pages/account-switch/index`（v0.9，替代原「视角切换」页）
**目标/入口**：开发者唯一「以某个账号身份进入小程序」的入口，两个 tab：
- **真实账号（只读）**：以 ACTIVE 真实顾客/兼职身份**只读**查看其页面与数据（=§1.2 只读视角；黄条 + 拒写 + 审计）。
- **测试账号（可写）**：以后台创建的**测试账号**身份进入（=§1.3；蓝条 + `TEST` 角标 + 可写，仅写测试数据；单机验收顾客/兼职两端）。
入口 = 总览「切换账号」/ 顾客详情「以该顾客身份查看（只读）」/ 兼职列表「切换」；可带 `?tab=real|test&role=&targetNo=` 预填。**平台限制**：小程序不能切换登录微信账号，本页只做应用内**账号代理切换**（§1.3）；不存在「切换开发者」入口。
**线框**：
```
[← 总览] 账号切换
[真实账号（只读）] [测试账号（可写）]
── 真实账号 tab ──
[顾客] [兼职]   [输入完整编号，如 C-7K2M-9QX4] [搜索]
候选行：C-7K2M-9QX4 · 小*** · D4 · 资料完整          [选择]
确认卡：角色 顾客 / 编号 C-7K2M-9QX4 / 昵称 小*** / 有效期 30 分钟 / 只读并审计 / 隐藏分享
[进入只读视图]  提示：不能做任何写操作；真实操作请切「测试账号」；新开会覆盖旧会话；退出回本页
── 测试账号 tab ──
[新建测试账号]   已用：顾客 1/3 · 兼职 0/3 · 合计 1/6
行：TEST-… · 顾客 · 测试-小王 · C-7K2M-9QX4 · 最近使用 {t}   [切换][删除]
确认卡（切换）：角色 顾客 / 编号 C-… / 昵称 测试-小王 / 有效期 30 分钟 / 将写入测试数据，不影响真实用户
[进入测试视图]
[清空测试数据（危险区）]  二次确认 + 审计
```
**组件/数据来源**：
- 真实账号 tab：角色切换、编号输入、搜索、候选列表（`admin.listCustomers`/`admin.listPartners`，仅 ACTIVE、**不含测试账号**）、确认卡、进入按钮；开启 = `admin.viewAsStart({role,targetNo,mode:'READONLY'})`；限流 20 次/日/开发者。
- 测试账号 tab：新建按钮与表单（角色 + 昵称）、测试账号列表（`admin.listTestAccounts`）、切换、删除、清空测试数据；开启 = `admin.viewAsStart({role,targetNo,mode:'TEST_WRITE'})`；新建 = `admin.createTestAccount({role,displayName})`；删除 = `admin.deleteTestAccount`；清空 = `admin.purgeTestData`。
**测试账号规则（D18）**：每位开发者**每角色 ≤3 个、合计 ≤6 个**（`config.testAccountMaxPerRole` 默认 3）；昵称 ≤20 字、必填、建议以「测试-」开头（不强制）、过 `msgSecCheck`；系统生成 `customerNo`/`partnerNo`、合成 `_id='TEST-<random>'` 与**合成 `openid='TEST-<random>'`（非空串，三处同值）**；**不消耗邀请码、不走激活流程、真实用户端永不出现**（不进真实用户列表/搜索/`partner.getPublic`，对测试账号一律 `NOT_FOUND`），**后台顾客/兼职列表默认排除**、可切「含测试账号」查看并带「测试」标签；默认头像、测试兼职默认服务配置全开+全部苑+`acceptingOrders=true`、测试顾客默认资料完整；测试账号昵称可完整展示（合成数据、非真实个人信息），真实账号昵称一律脱敏、头像不展示。
**状态/交互校验**：idle/searching/submitting/success（`reLaunch` 目标首页）/error（格式、不可查看、额度已满、网络、限流）；真实账号编号去空格/连字符/全角后转大写、必须完整，错前缀/`DEV` 前缀/格式错分别提示，只列 ACTIVE；测试账号新建校验角色与昵称、额度满时「新建」禁用并提示；删除/清空测试数据必须二次确认（本文 §11.9）；同一开发者同时只有一个切换会话（真实/测试共用单活，新开覆盖旧的）。
**动作与副作用**：
- 进入真实账号：`READONLY`；不产生业务数据；隐藏分享/转发。
- **进入/退出即水合（批 10）**：进入会话后自动以目标身份拉 `user.bootstrap` 水合（测试顾客直接显示资料完整与绑定状态、测试兼职直接显示「接单中」与兼职编号；真实账号只读视图显示目标资料），无需用户手动刷新；退出会话自动复位为开发者身份。页面按目标身份渲染，不出现「待激活/资料未完善」的假状态。
- 进入测试账号：`TEST_WRITE`；写动作以目标测试账号身份执行（可写动作以 CONTRACT §1.3 为准），订单/事件带 `isTest=true` + `impersonatedBy={developerNo}`；**不改真实数据、不触发真实通知**；对测试账号**不可执行真实治理**（停用/恢复/解绑真实用户/通知真实用户等），测试会话内的解绑/取消/留言只对测试内部生效。
- 删除测试账号：级联删该账号的测试订单/留言/绑定与头像文件，并**使该账号相关活跃切换会话立即 `endedAt`**（相关端下次请求收到 `FORBIDDEN`/`ACCOUNT_SWITCH_EXPIRED`，退回「账号切换」页），全程审计。
- 清空测试数据 `purgeTestData`：**危险动作**——先 **dry-run 返回将清理条数**（测试订单/留言/绑定/识别失败记录分项），确认页需**双条件**（勾选「我已知晓清理不可恢复」+ 输入「清空」二字）后执行；执行后写入**审计前后条数**（detail 记 `before/after` 分项计数），账号保留。
**审计**：进入/退出/过期**统一**记 `ACCOUNT_SWITCH_START`/`ACCOUNT_SWITCH_END`/`ACCOUNT_SWITCH_EXPIRED`（真实与测试共用，`detail` 含 `viewMode/targetNo/targetIsTest`；**`VIEW_AS_*` 已作废**）；测试账号管理记 `TEST_ACCOUNT_CREATE`/`TEST_ACCOUNT_DELETE`/`TEST_DATA_PURGE`（清空类 detail 记清理前后条数）；删除测试账号时同时落一条 `ACCOUNT_SWITCH_END`（原因 `TEST_ACCOUNT_DELETED`），使活跃会话结束可追溯；detail **不含头像 fileId、完整昵称、openid、L3**。
**五态与空态**：加载=骨架；空（真实）=`按编号或列表选择要查看的真实用户。`；空（测试）=`还没有测试账号。新建一个测试顾客/测试兼职开始单机验收。`；错误=错误条+重试；无权限=`FORBIDDEN`→回总览；目标不可查看=统一文案；额度满=提示「每位开发者每角色最多 3 个、合计 6 个测试账号」。
**文案/跳转**：见本文 §11.7/§11.9；成功 `reLaunch` 目标角色首页；取消/返回总览；退出会话回本页。

### 3.10 后台消息 `pkg-admin/pages/messages/index`
**目标/入口**：后台消息聚合（异常工单 + 识别失败待复核摘要 + 系统状态提示），快速进入处理；从总览消息铃铛/红点进入。
**线框**：
```
[← 总览] 后台消息
异常工单（2）：{orderNo} · {异常码文案} · 上报 {t} · P-7K2-M9X [处理]
识别失败待复核（1）：{failureNo} · {失败码中文} · 顾客 · {t} [去复核]
系统提示：维护中 / 公告已启用
```
**组件/数据来源**：异常工单行卡、识别失败摘要行、系统提示条、空态、刷新；数据= `admin.listOrders({status:'EXCEPTION'})` + `admin.listRecognitionFailures({status:'PENDING',limit:5})` 摘要 + 配置状态（聚合视图，不新增 `notifications` 集合；复核详情走复核页）。
**状态/交互校验**：加载=骨架；空=`没有待处理的后台消息。`；错误=错误条+重试；无权限=回总览。点「处理」→ `order-detail`；点「去复核」→ `recognition-review?failureNo=`（首屏 `PENDING` 已定位）；处理完返回刷新；无逐条已读、无批量处理、无推送订阅（P1）。
**文案/跳转**：见本文 §11.5；异常工单 → `order-detail?orderNo=`，识别失败 → `recognition-review?failureNo=`。

### 3.11 识别失败复核 `pkg-admin/pages/recognition-review/index`（v0.8 新增，D16/D17）
**目标/入口**：承接 OCR + 规则 + AI 兜底后仍失败的识别记录（`recognition_failures`），让开发者**按单**看原图、补录站点/取件码、通知上传者，形成「失败入队 → 复核 → 回填 → 关闭」闭环；入口 = 总览「识别失败待复核」卡/红点、总览消息铃铛 → `messages` 摘要行；目标端（顾客/兼职）**完全无感**，无任何端侧入口。
**线框**：
```
[← 总览] 识别失败复核        [待复核 3][已修复 12][已忽略 4]
筛选：[全部失败码 ▾] [顾客][兼职] [近 7 天 ▾]      首屏默认 status=PENDING
行：{failureNo} · {失败码中文} · {来源角色} · {上传人编号} · {createdAt} · {status} [复核]
详情（MVP 用行展开半屏）：
  AI 状态：{已开启 · model / 未开启 / 凭据未配置}（只读；不显示 Key 值）
  原图：[查看原图（临时 5 分钟，记审计）]      ← 不自动加载、列表无缩略图；hasImage=false 时显示「无关联原图」并禁用
  OCR 文本（已去敏）：{ocrTextMasked ≤2000，超长折叠}
  规则结果：{ruleResult 摘要}     DeepSeek 尝试：{aiTried/aiModel/aiResult/aiErrorCode}
  关联订单：{orderNo 或 未关联订单}      上传时间 {createdAt}      复核时间 {reviewedAt}
  补录：站点 [P1~P8 选择器]  取件码 [输入 ≤40]     [保存补录]
  操作：[查看原图] [补录并通知上传者] [标记忽略（备注必填）] [仅通知上传者]
  时间线：入队 →（原图查看次数）→ 已修复/已忽略 · {developerNo} · {at}
```
**组件/数据来源**：状态筛选 tab（含计数）、失败码筛选、来源角色筛选、日期筛选、分页、行卡、详情展开区、原图查看按钮、补录表单（站点选择器 + 取件码输入）、忽略备注、通知按钮、时间线；数据= `admin.listRecognitionFailures({status?,failureCode?,sourceRole?,dateFrom?,dateTo?,cursor,limit})`、`admin.getRecognitionFailure({failureNo})`（字段 + 原图临时 URL，**每次调用落 `FAILURE_IMAGE_VIEW`**）、`admin.fixRecognitionFailure`、`admin.ignoreRecognitionFailure`；**「通知上传者」已定稿为 `fix/ignore` 的可选参数 `notifyUploader:true`，不单拆动作**（CONTRACT §4.3）。
**列表字段（全部脱敏）**：`failureNo`（等宽展示）、`failureCode`（中文文案见本文 §11.8）、`sourceRole`（顾客/兼职）、上传人（**只给编号 + 脱敏昵称**：顾客上传给顾客编号、兼职上传给兼职编号，**不显示 openid、不展示头像**）、`createdAt`（服务端时间格式化）、`status` 标签、关联 `orderNo`（若有，可跳 `order-detail`）；**原图不出现在列表**（无缩略图/无预览/无自动加载）。
**筛选/分页**：状态三档 `PENDING`/`FIXED`/`IGNORED`（默认 `PENDING`，首屏即待复核）；失败码五值；来源角色两值；日期默认「近 7 天」、可选「近 30 天/全部」；分页 20、按 `createdAt` 倒序、下拉刷新；筛选只影响列表，tab 计数由服务端返回、不前端推算。
**详情字段**：①原图入口（`fileId` 引用，按钮式，点开才取临时 URL，5 分钟有效，页面不留 URL、不写缓存/日志；**`hasImage=false` 显示「无关联原图」且不写审计**）；②`ocrTextMasked`（≤2000，已去敏，超长折叠，**不提供复制按钮**）；③`ruleResult` 摘要（规则识别的站点/取件码候选；空则 `规则未识别到站点或取件码`）；④AI 尝试：`aiTried`、`aiModel`、`aiResult`（只读摘要：识别到的站点/取件码/运单尾号/柜号/置信度）、`aiErrorCode`（有则映射文案，如 `智能识别超时`/`配额已用完`/`返回格式不可解析`）；**只读 AI 状态 `aiStatus{enabled,hasKey,model}`**（未开启/凭据未配置时页头标黄，便于区分「开关关/Key 未配/模型正常」；Key 只显示是否配置）；⑤关联订单（`orderId/orderNo`，有则深链 `order-detail`，无则 `未关联订单`，**不显示订单其它 L3**；失败记录以**订单 × 截图**为粒度：同一截图拆多单时**每张缺码/缺站点订单各一条**记录、共享同一 `fileId`，未建单保留 `orderId=''`，建单后回填对应 `orderId/failureId`）；⑥时间与状态（`createdAt`/`reviewedAt`/`status`）；⑦时间线（入队 + 每次原图查看 + 补录/忽略，均来自记录/审计，不含 openid）。
**动作与校验**：
- **查看原图**：仅白名单开发者、仅单条；点按 → `admin.getRecognitionFailure` → 临时 URL 5 分钟 → 全屏预览（可缩放，**无保存/分享/转发/长按菜单**）；每次查看都取新 URL 并落 `FAILURE_IMAGE_VIEW`；失败（`fileId` 过期或已被 `cleanup` 删除）→ `NOT_FOUND` 文案见本文 §11.8 并给「刷新」。
- **补录站点/取件码**：站点必须 ∈ P1~P8（选择器**显示 `config.stations` 当前名称、id 固定**，不允许自由文本；管理员改名后同步）；取件码走与端侧同一条码格式闸（去空格/连字符、长度与字符集上限 ≤40）；保存 → `admin.fixRecognitionFailure({failureNo,stationId,pickupCode,notifyUploader?})`；**只回填关联订单 `parcel.stationId/stationName/pickupCode` 三个识别字段**，不改订单状态/不代确认/不创建订单/不改归属，除这三个字段外不改订单其它字段；无关联订单（含未建单 `orderId=''`）时只更新复核记录并提示「已补录；该记录没有关联订单，未回填订单。」；成功 → `status=FIXED` + `reviewedAt` + `resolution`，审计 `FAILURE_FIX`（detail 只记 `failureNo`/字段名/是否关联订单，**不记原图/OCR 全文/openid**）。
- **标记忽略**：备注必填（≤100），写 `resolution.note`；调 `admin.ignoreRecognitionFailure({failureNo,note,notifyUploader?})`；记录置 `IGNORED`；审计 `FAILURE_IGNORE`；忽略 ≠ 删除，记录与原图引用仍保留至保留期；MVP 不可撤销（P1 再议恢复）。
- **通知上传者**：**不单拆动作**（CONTRACT §4.3 已定稿）——作为 `fixRecognitionFailure`/`ignoreRecognitionFailure` 的 `notifyUploader` 参数；补录/忽略确认弹层默认勾选「同时站内通知上传者」；站内消息必做（订阅消息 P1）；消息只含「你的截图识别失败，开发者已处理/请补充取件码」类下一步指引，**不含原图、失败码内部细节、AI 结果**；同一记录同日重复通知幂等（只发一条）。
**防误操作（硬）**：补录只回填识别字段，**不改订单状态、不代顾客/兼职确认、不创建订单、不改归属**；无批量选择/批量补录/批量忽略；无下载/导出（原图与其他记录都不行）；无「显示全部原图」；补录/忽略均二次确认（本文 §11.8）；已 `FIXED`/`IGNORED` 记录再操作 → `INVALID_STATE`「该记录已处理，不能重复操作。」；关联订单已终态时仍可补录识别字段（只影响展示与历史，不推进状态）。
**五态与空态**：加载=列表骨架（详情展开区局部 loading）；空=`还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。`；筛选空=`没有符合当前筛选的识别失败记录。`；错误=错误条 + 重试 + 上次成功时间（保留已加载列表）；无权限=`FORBIDDEN` → 整页说明 + 回 `overview`；记录不存在/已清理=`NOT_FOUND` → 「记录不存在或已过保留期。」+ 刷新列表。
**保留与清理**：`config.recognitionFailureRetentionDays`（7~30，默认 30）；到期 `cleanup` 删原图引用并把记录置 `IGNORED`（备注 `EXPIRED`，文案「已过保留期自动忽略」）；同一 `fileId` 仍被订单引用时按订单截图规则（§4.1）；超期记录只读。
**审计**：`FAILURE_IMAGE_VIEW`（每次原图查看）、`FAILURE_FIX`（补录）、`FAILURE_IGNORE`（忽略）；detail 只含 `failureNo`/动作/字段名/结果，**不含原图、不含 `ocrTextMasked` 全文、不含 openid**；审计在总览审计区块可查、只读、不可编辑/导出。
**文案/跳转**：见本文 §11.8；关联订单行 → `order-detail?orderNo=`；返回总览/后台消息；列表行不支持左滑/长按菜单。

---

## 4. 邀请码生效控制（核心职责）
### 4.1 状态机
```
              ┌─ 兼职激活成功 ─────► USED（usedBy=partnerId，usedAt）
UNUSED ───────┼─ 开发者作废 ───────► REVOKED（仅 UNUSED 可作废）
              └─ 过期（cleanup）───► EXPIRED
USED / REVOKED / EXPIRED = 终态；不存在「重新生效」，需要时重新生成
```
- 状态迁移由服务端原子条件更新保证：同一码只会被成功消费或成功作废一次（并发另一请求返回冲突/已完成）；客户端不自行推断状态，列表状态一律服务端返回。

### 4.2 生成规则
| 项 | 规则 |
| :-- | :-- |
| 数量 | 单个或批量，单批 1~50；超过 50 拒绝 |
| 有效期 | 24 小时 / 72 小时 / 7 天 / 30 天，默认 7 天；`expiresAt` 必须设置，不允许为空 |
| 备注 | ≤50 字，可空；随批次记录，不参与激活 |
| 码样式 | 12 位 32 字母表，展示 `XXXX-XXXX-XXXX`；落库去横杠大写；全局唯一 |
| 批次 | 每次生成一个批次号（服务端生成）；结果页展示批次、数量、有效期 |
| 复制/幂等 | 生成成功弹层内整批复制（剪贴板）；离开后列表只显示脱敏码，不再提供完整码复制；写动作带 `clientRequestId`，重复提交不重复生成 |

### 4.3 有效期、过期与作废
- 过期以服务端时间为准；`cleanup` 将 `UNUSED` 且已过期的码置 `EXPIRED`（§5.3）；列表显示有效期至与剩余时间；不提供续期/延期，过期后重新生成；已过期码激活 → `INVITE_EXPIRED`。
- 作废仅 `UNUSED` 可作；`USED`/`EXPIRED`/已 `REVOKED` 行按钮禁用并说明原因；作废弹层二次确认（本文 §11.3）后置 `REVOKED`，立即不可激活、不可撤销；审计 `INVITE_REVOKE`；MVP 逐条作废，不提供批量作废（P1 再议，防误伤）。

### 4.4 激活消费（与兼职端交界）
- 兼职在 `pkg-partner/pages/activate/index` 输入 12 位码；服务端原子消费：存在、未过期、未使用、未作废 → 写 `usedBy=partnerId`/`usedAt`/状态 `USED` → 创建 `partners` 文档并生成 `partnerNo`（§3.1）。
- 失败映射（§4.6）：不存在/已作废 → `NOT_FOUND`；已过期 → `INVITE_EXPIRED`；已使用 → `INVITE_USED`；格式错 → `VALIDATION_FAILED`；失败 5 次/日/openid → `RATE_LIMITED`；成功后后台列表该码显示 `USED`，使用人 = 兼职编号 + 昵称 + 使用时间；同一码再次激活必失败；换微信号需重新发码（D3）。
- **测试账号不走邀请码（v0.9，D3/§1.3）**：测试兼职由后台 `createTestAccount` 直接创建，**不消耗邀请码**、不写 `invitation_codes.usedBy`；邀请码列表不会出现测试账号使用记录；测试账号也不进入激活流程。

### 4.5 列表、筛选与审计
- 字段：接口可返回完整码作废锚、UI 仅展示后 4 位掩码（`****-****-{后4}`）；状态、批次、创建时间、创建人（developerNo）、有效期至、使用人（兼职编号+昵称）、使用时间、操作；筛选状态五档（全部/未使用/已使用/已作废/已过期），可按批次筛选；分页 20、按创建时间倒序；不提供导出、完整码复制、批量选择。
- 审计：生成 `INVITE_CREATE`（detail 记批次/数量/有效期/备注）；作废 `INVITE_REVOKE`（detail 记码后 4 位/批次/时间）；**均不记完整码**；审计区块只展示 `developerNo`、不展示 `adminOpenid`；筛选空与真空文案不同。

### 4.6 错误路径
| 场景 | 前端表现 | 服务端码 |
| :-- | :-- | :-- |
| 批量超过 50 | 数量输入红字、生成按钮禁用 | `VALIDATION_FAILED`（`data.field='count'`） |
| 有效期非法/未选 | 回退默认 7 天并提示 | `VALIDATION_FAILED`（`expiresIn`） |
| 备注超过 50 | 字数变红、禁止提交 | `VALIDATION_FAILED`（`note`） |
| 作废已使用/已过期 | 按钮禁用 + 说明 | `INVALID_STATE` |
| 重复提交 | 按钮 loading 防连点；重试复用 `clientRequestId` | 幂等，返回原批次 |
| 网络失败 | 错误条 + 重试；已生成结果不丢（幂等） | 客户端网络失败 |
| 非白名单 / 高频异常 | 退场回普通首页 / 文案稍后再试 | `FORBIDDEN` / `RATE_LIMITED` |

---

## 5. 后台数据查看与脱敏口径
### 5.1 分级口径
| 级别 | 内容 | 后台列表/详情 | 真实账号只读会话 |
| :-- | :-- | :-- | :-- |
| L1 | 订单号/状态/服务类型/站点名/时间/编号 | 展示 | 展示 |
| L2 | **昵称（脱敏）**/苑+楼栋/绑定关系/统计/审计；**头像不展示** | 展示（脱敏组合） | 按目标可见范围展示（头像/昵称仅随 ACTIVE 绑定关系给对方） |
| L3 | 取件码/手机尾号/门牌（房间号、roomTag）/截图；本文从宽把运单尾号、柜号明细也算 L3 | 打码、不返回完整值；无订单截图入口；**唯一例外**：识别失败复核页可按单取该失败记录原图临时 URL（5 分钟 + 逐次审计，D17） | 按目标本人身份完整展示（截图临时 URL 5 分钟） |
> **测试数据（v0.9）**：`isTest` 订单与测试账号默认在后台列表过滤（可切「含测试数据/含测试账号」查看并带「测试」标签）；测试数据不计统计、红点、邀请码与真实用户可见范围（D18/O4）。测试账号数据本身为合成数据，在 `TEST_WRITE` 会话内可完整查看，**不涉及真实用户 L3**。

### 5.2 默认脱敏规则
| 字段 | 后台显示 | 示例 | 可复制 |
| :-- | :-- | :-- | :-- |
| 顾客编号 / 兼职编号 | 完整 | `C-7K2M-9QX4` / `P-7K2-M9X` | 可（客服沟通） |
| 头像 | **不展示**：后台 DTO 不下发 `avatarFileId`，列表无头像位、详情无头像卡片 | — | 否 |
| 昵称 | 首字 + `***`（固定 3 个星，不随原文长度变化；与 `db/dto/mask.js` 单源一致） | `小****` | 否 |
| 取件码 | 保首尾各 1 位，中间 `*`；长度 ≤2 全 `**` | `7***9` | 否 |
| 手机尾号 | 仅后 2 位 | `**78` | 否 |
| 宿舍 | 仅苑+楼栋 | `D4` | 否 |
| 房间号 / roomTag | 不展示（roomTag **恒大写**且含房间号，如 `D4-522A`，后台不展示） | — | 否 |
| 运单尾号 / 柜号 | 运单尾号仅后 2 位、柜号仅末位（更严） | `***78` / `*号柜` | 否 |
| 截图 / openid / 完整手机号 / 头像 fileId | 不展示、无订单截图入口（识别失败原图例外见本文 §5.6）；openid 与 `avatarFileId` 接口不下发；完整手机号系统不收集 | — | 否 |
> 测试数据：后台订单/顾客/兼职列表**默认过滤** `isTest` 与测试账号，可切换「含测试数据/含测试账号」查看，行带「测试」标签；测试数据不计统计与红点（D18/O4）。

### 5.3 完整 L3 仅真实账号只读会话（原图例外见本文 §5.6）
- 后台接口在 DTO 层脱敏；不提供 `showFull` 参数/按钮/接口；前端不得缓存 L3。
- 完整 L3 只在**真实账号只读会话**（`viewMode=READONLY`）内按目标本人身份返回，带审计；订单截图走 `order.imageUrl` 临时 URL（5 分钟），不进日志/通知/分享；掩码长度固定、不随原文长度变化，避免通过掩码长度反推原文。
- **唯一例外（D17）**：识别失败复核页可按单查看该失败记录的**原图**（临时 URL 5 分钟 + 每次 `FAILURE_IMAGE_VIEW` 审计）；该例外**不进切换会话读白名单**、不提供批量/下载/导出，非失败单原图仍只能走真实账号只读会话（CONTRACT §1.1 第 3 条例外、§4.3）。
- 测试账号会话（`TEST_WRITE`）只能看到测试账号自身的合成数据，**不涉及真实用户 L3**；测试会话不改变后台默认脱敏口径。

### 5.4 搜索、分页与最小化
- 搜索只接受编号（完整或前缀）、苑+楼栋、**昵称**（服务端匹配、列表仍脱敏），禁止按取件码/尾号/房间号搜索（防拼图）；分页 20；后台允许枚举（§10 权限矩阵），但不提供全量导出/一键复制；输入 ≥2 字符 + 300ms 防抖。
- 列表 DTO 默认脱敏（无头像、昵称脱敏），不能通过排序/筛选差异反推隐藏字段；后台不把列表写入本地存储。
- **测试账号/测试数据不参与真实搜索**：默认过滤；只有显式打开「含测试账号/含测试数据」才出现，且带「测试」标签；测试账号不可被真实顾客/兼职枚举（`partner.getPublic` 对测试账号 `NOT_FOUND`）。

### 5.5 禁止动作与失败路径
- 禁止：导出 CSV/Excel/图片包、下载截图、批量复制 L3、长按复制敏感字段、后台「显示完整」开关/关闭脱敏参数、绕过 DTO 直出集合字段、把数据写入剪贴板/分享/打印、日志/审计 detail/通知写 L3、以 openid 为条件的搜索或展示；**批量查看/下载/导出识别失败原图**、把原图临时 URL 写入日志/本地存储/剪贴板、在列表预加载原图缩略图（复核页仅按单按钮取图，D17）；**展示/导出头像与完整昵称、把 `avatarFileId` 写进后台 DTO/日志/分享**；**把测试数据写进统计/红点/真实搜索/真实用户页面**；**对测试账号执行真实治理动作**。
- 失败：`NOT_FOUND` → 统一「记录不存在或已注销」，不区分「存在但不可见」；`FORBIDDEN` → 整页说明 + 回 `overview`；网络错误 → 保留数据 + 重试 + 上次成功时间；`RATE_LIMITED` → 提示稍后再试。

### 5.6 识别失败原图例外（D17）
| 约束 | 口径 |
| :-- | :-- |
| 可见范围 | 仅白名单开发者、仅 `recognition_failures` 中的失败记录、仅复核页；顾客/兼职/切换会话（只读与测试）均不可见 |
| 获取方式 | 按单调用 `admin.getRecognitionFailure` 取 `cloud.getTempFileURL`（5 分钟），**每次调用落 `FAILURE_IMAGE_VIEW`** |
| 展示 | 全屏预览、可缩放；无保存/分享/转发/长按菜单；无缩略图、无「显示全部」 |
| 禁止 | 批量查看、下载、导出、截图打包；URL 不写入日志/审计 detail/本地存储/剪贴板 |
| 与订单截图关系 | 原图属订单截图同一 `fileId`；失败记录保留期内（默认 30 天，7~30 可配）可复核；订单截图仍按完成/取消后 7 天删除（§4.1/§11.1） |
| 到期 | `cleanup` 删引用并置 `IGNORED`（`EXPIRED`）；同一 `fileId` 仍被订单引用则按订单规则，不提前删 |
| 披露 | 《隐私保护指引》必须写明「识别失败原图会进入开发者复核（临时查看 + 审计，默认 30 天删除）」（§11.1/§11.2，人执行） |

---

## 6. 账号切换与切换会话（核心职责）
### 6.1 定位与两类目标（D14/D18）
- **平台限制**：微信小程序**不能切换登录的微信账号**；本文「账号切换」= 应用内**账号代理切换**，不是换微信登录（§1.3）。
- **真实账号（只读）**：排障/核对「用户实际看到的页面与数据」；`viewMode=READONLY`；黄条 + 服务端拒写 + 全程审计（D14）。
- **测试账号（可写）**：后台创建的合成账号；`viewMode=TEST_WRITE`；蓝条 + `TEST` 角标 + 可写（只写测试数据）；用于一个微信号单机验收顾客/兼职两端（D18）。
- 三者共同硬约束：常驻条不可关闭、服务端逐请求校验票据、全程审计；**两种会话都隐藏分享/转发/长按保存入口**（O3）。

### 6.2 开启流程
```
总览 / 顾客详情 / 兼职列表 ─► account-switch
真实账号 tab：① 角色（顾客/兼职）→ ② 完整编号搜索 或 列表选人（仅 ACTIVE）→ ③ 确认卡（编号/脱敏昵称/有效期/只读与审计）
              → ④ viewAsStart({role,targetNo,mode:'READONLY'}) → ⑤ viewContext 写内存 → reLaunch 目标首页 → 黄条
测试账号 tab：① 选择测试账号（或先新建：角色+昵称）→ ② 确认卡（写明"将写入测试数据，不影响真实用户"）
              → ③ viewAsStart({role,targetNo,mode:'TEST_WRITE'}) → ④ reLaunch 目标首页 → 蓝条 + TEST 角标
```
- 真实账号只允许 ACTIVE 顾客/兼职；目标不存在/停用/注销统一「该用户当前不可查看」（防枚举，§1.2）；测试账号只能从 `listTestAccounts` 选（不进真实搜索）。
- 账号切换限流 **20 次/日/开发者**（真实/测试合计，CONTRACT §10）；开启本身写 `ACCOUNT_SWITCH_START`（detail 含 `viewMode/targetNo/targetIsTest`）。
- 真实账号传 `mode='TEST_WRITE'` → `FORBIDDEN`（不新增错误码）；`TEST_WRITE` 目标必须 `isTestAccount=true` 且 `status=ACTIVE`。

### 6.3 票据与内存
- `viewTicket` 32 位随机，服务端 `admin_view_sessions`（`_id=ticket`，含 `adminOpenid/developerNo/viewMode/role/targetId/targetNo/targetDisplayName/targetAvatarFileId?/targetIsTest/createdAt/expiresAt/endedAt`）；客户端只存 `app.globalData.viewContext`，**不写本地存储、不进 URL/日志/分享**。
- 默认 30 分钟（`config.viewTicketTtlMinutes` 5~60）；**同一开发者同时只有一个切换会话**（真实/测试共用单活，新开覆盖旧的）；`cleanup` 清理过期/结束超 7 天会话。
- 每次请求校验：票据存在、未过期、`endedAt` 为空、发起人仍在白名单；`TEST_WRITE` 额外校验目标 `isTestAccount=true` + ACTIVE；**写请求必须同时匹配 `impersonatedBy` 与目标身份**（票据不能被挪用到其他账号，§4.2/§11.3）。
- 冷启动/杀进程丢 `viewContext` 即无票据，再次进入需重新开启。

### 6.4 页面表现
- 真实账号黄条文案逐字：`开发者只读视角 · 顾客 C-7K2M-9QX4 小王 · 退出` / `开发者只读视角 · 兼职 P-7K2-M9X 小王 · 退出`（昵称/边界见本文 §11.2）。
- 测试账号蓝条文案逐字：`测试账号 · 顾客 C-7K2M-9QX4（测试） · 由 DEV-01 切换 · 退出` / `测试账号 · 兼职 P-7K2-M9X（测试） · 由 DEV-01 切换 · 退出`；**每页右上角常驻 `TEST` 角标**（`#2B6DE5` 底白字，CONTRACT §8）。
- `custom-tab-bar` 按 `viewContext.role` 渲染目标角色三 tab；tab 红点/角标按目标数据（测试会话只反映测试数据）。
- 目标端不出现任何后台入口；「我的」隐藏编辑/换绑/注销/切换身份；**两种会话都隐藏分享/转发/长按保存**。
- 头像/昵称：真实账号会话按目标可见范围展示（顾客看到绑定兼职的头像/昵称）；测试账号会话展示测试账号默认头像与测试昵称；**后台页面本身不展示头像、昵称脱敏**。

### 6.5 真实账号读接口白名单（READONLY）
| 动作 | 用途 | 涉及页面 |
| :-- | :-- | :-- |
| `user.bootstrap` | 返回目标上下文（角色/资料完成度/绑定摘要/切换上下文（含 `viewMode`）） | 全部目标端页面 |
| `customer.getProfile` / `bind.getCurrent` | 顾客资料（本人 L3+头像昵称）/ 当前绑定摘要 + 兼职公开资料（头像/昵称）+ roomTag | 顾客首页/我的 |
| `order.listCustomer` | 顾客订单列表 | 顾客订单 |
| `order.listPartner` | 兼职工作台/订单列表 + counts | 兼职工作台 |
| `partner.listBindings` | 兼职客户列表（含绑定顾客头像/昵称） | 兼职客户 |
| `order.get` / `message.list` | 订单详情 / 消息中心与订单留言 | 双方订单详情/消息 |
| `order.imageUrl` / `config.getPublic` | 截图临时 URL（5 分钟）/ 公告、维护、服务类型、苑名 | 订单详情/全部页面 |
> 白名单之外任何读接口一律 `FORBIDDEN`；`admin.*` 后台动作不属于切换代理范围（目标角色页面内不可达）；兼职服务配置等只读展示由 `user.bootstrap` 目标上下文承载（若 DATA_MODEL 未下发，以 DATA_MODEL 定稿为准，见本文 §10.4）。**识别失败复核（`admin.listRecognitionFailures`/`getRecognitionFailure`）与失败原图不在白名单内**（D17）。

### 6.6 写操作：真实拒写 + 测试可写
- **真实账号（READONLY）**：前端所有写控件置灰/隐藏，点置灰控件 toast `开发者只读视角不能操作`；服务端见只读票据即对目标角色写动作返回 `FORBIDDEN`（双保险）。
- **测试账号（TEST_WRITE）**：前端正常可用；服务端以 `viewContext` 解析目标测试账号身份执行写动作（可写动作以 CONTRACT §1.3 为准），写请求校验目标 `isTestAccount=true`；订单/事件写 `isTest=true` + `impersonatedBy={developerNo}`；**不得写真实账号数据、不得触发真实用户通知**；对测试账号不可执行真实治理动作。
- 覆盖清单（真实账号一律拒绝；测试账号可写但仅测试内部）：`order.create/createBatch/accept/reject/markPicked/unmarkPicked/markDelivered/unmarkDelivered/reportException/resolveException/cancel/confirmDelivery/correct/undo/deleteRecord`；`message.send/markRead`；`bind.create/release`；`customer.saveProfile`；`partner.saveProfile/saveServiceConfig/unbindCustomer/saveCustomerNote`；`upload.prepare/cancel`（含 `purpose='AVATAR'`）；`user.acceptPrivacy/deleteAccount`；`partner.activate`；其他未列写动作默认拒绝。
- 后台治理写动作（邀请码/停启用/配置/切换会话开始结束/测试账号管理）不受切换票据影响，但在目标端页面内不可达，需先退出；双保险验收=前端提示 + 服务端错误码各验一次（AC-D-13）。
- **绑定方向（D20）**：切换会话内也不能"造绑定"——真实顾客只读会话发起 `bind.create` 被拒；测试顾客只能绑测试兼职；**后台永无「绑定顾客」入口**，开发者不创建/代绑关系（§4.2/§10）。

### 6.7 测试数据隔离（D18/O4/O9）
- 标记：`orders.isTest=true`、`order_events.impersonatedBy={developerNo}`；测试账号 `users.isTestAccount=true`，**合成 `openid='TEST-<random>'`（非空串）**。
- 过滤：后台订单列表默认 `includeTest=false`；顾客/兼职列表默认排除测试账号（可切「含测试账号/含测试数据」查看并带「测试」标签）；红点与统计（`admin.stats`、兼职单量统计）**排除测试账号与 `isTest` 订单**；邀请码与隐私主体清单不含测试账号。
- 互操作：测试账号只能与测试账号建立绑定/下单/留言；真实×测试任何绑定/下单/留言 → `FORBIDDEN`（文案「测试账号与真实账号不能互相绑定」）；测试兼职 `partnerNo` 不进真实搜索，`partner.getPublic` 对测试账号返回 `NOT_FOUND`。
- 清理：`admin.deleteTestAccount` 删账号+数据+头像，并**使该账号相关活跃会话立即 `endedAt`**；`admin.purgeTestData` = dry-run 计数 + 双条件 + 审计前后条数；`cleanup` 每日清理超过 `testDataRetentionDays`（默认 30 天）未使用的测试账号**数据**（账号保留、记审计）。

### 6.8 退出
- 黄条/蓝条「退出」→ `admin.viewAsEnd({viewTicket})` → 清内存 → `reLaunch('/pkg-admin/pages/account-switch/index')` → toast `已退出只读视图`（测试会话 `已退出测试视图`）；退出不二次确认（退出是安全方向）；`viewAsEnd` 网络失败给「重试/本地退出」，本地退出后票据到期由 `cleanup` 记 `ACCOUNT_SWITCH_EXPIRED` 兜底。
- 过期/被覆盖/测试账号被删：任一请求返回 `VIEW_TICKET_EXPIRED`（过期）或 `FORBIDDEN`（已结束/被覆盖/不存在/测试账号已删）→ 立即清内存 + toast 原因 + `reLaunch` 回 `account-switch`；会话结束写 `ACCOUNT_SWITCH_END`（`MANUAL`/`REPLACED`/`TEST_ACCOUNT_DELETED`）或 `ACCOUNT_SWITCH_EXPIRED`。

### 6.9 失败路径
| 场景 | 触发 | 端上表现 | 审计/服务端 |
| :-- | :-- | :-- | :-- |
| 会话过期 | 到期 / TTL 缩短 | toast `只读视角已结束（30 分钟到期），已返回账号切换。`（测试：`测试会话已结束，已返回账号切换。`） | `VIEW_TICKET_EXPIRED`；`ACCOUNT_SWITCH_EXPIRED` |
| 被新会话覆盖 | 同开发者再次开启（真实/测试共用单活） | toast `切换会话已在别处重新开启，本页已退出。` | 旧会话 `endedAt`+`ACCOUNT_SWITCH_END`（`REPLACED`）；新 `ACCOUNT_SWITCH_START`；旧端请求 `FORBIDDEN` |
| 真实目标停用/注销（会话中） | 治理动作 | toast `该用户当前不可查看，已返回账号切换。` | 读请求 `FORBIDDEN`/`NOT_FOUND`；会话结束 |
| 测试账号被删除（会话中） | `deleteTestAccount` | toast `测试账号已删除或会话已结束，已返回账号切换。` | 会话 `endedAt`；`ACCOUNT_SWITCH_END(TEST_ACCOUNT_DELETED)`；旧端 `FORBIDDEN`/`VIEW_TICKET_EXPIRED` |
| 目标非 ACTIVE/不存在（开启时） | 搜索/选择 | 统一「该用户当前不可查看」 | `NOT_FOUND`（统一文案） |
| 真实账号传 `TEST_WRITE` | 伪造请求 | 错误页/toast「真实账号只能只读查看」 | `FORBIDDEN`（不新增错误码） |
| 测试账号额度已满 | 新建测试账号 | 提示 `每位开发者每角色最多 3 个、合计 6 个测试账号。` | `INVALID_STATE`/`VALIDATION_FAILED`（以 DATA_MODEL 为准） |
| 网络失败 | 断网/超时 | 错误条 + 重试；不自动退出（避免误判） | 无 |
| 误入写操作（真实） | 点置灰按钮/直调接口 | toast / 错误页 | 服务端 `FORBIDDEN` |
| 冷启动 / 白名单移除 | 杀进程 / 运维改 env | 无黄条回账号切换 / 请求 `FORBIDDEN` 回普通首页 | 无票据/已结束票据 `FORBIDDEN` / 会话失效 |

### 6.10 审计与 D14/D18
- `ACCOUNT_SWITCH_START` 记 `viewMode/role/targetNo/targetIsTest/developerNo/at`（不记 L3、不记 target openid、不记头像 fileId）；`ACCOUNT_SWITCH_END` 记原因 `MANUAL`/`REPLACED`/`TEST_ACCOUNT_DELETED`；`ACCOUNT_SWITCH_EXPIRED` 在票据过期/清理时落一条；测试账号管理三类审计见本文 §3.9；审计保留 ≥180 天、只读、不可编辑/导出。
- **`VIEW_AS_*` 审计名已作废**（CONTRACT v0.9 统一为 `ACCOUNT_SWITCH_*`）；历史文档/代码若仍出现 `VIEW_AS_*` 视为缺陷（回写清单见本文 §10.4 第 2 条）。
- 本文按「真实账号只读 + 测试账号可写（隔离）」设计（D14/D18 推荐项）；若用户改口径，必须同步修改 CONTRACT §1.2/§1.3、本文 §6/§10 与 DATA_MODEL 写权限口径，不可只改前端。

### 6.11 分享与朋友圈的开发者侧约束（v1.2/D36）
- **后台零分享**：`pkg-admin/**` 的 11 个后台页**不挂** `onShareAppMessage`/`onShareTimeline`、无 `open-type="share"` 入口——治理数据不外传（ENGINEERING §8.2 #33③；`selftest-admin-pages` 同口径）。
- **切换会话禁分享（O3/M-33 关闭）**：`components/switch-bar` 统一调 `utils/share/platform.syncSession(inSession)`——进入 `READONLY`/`TEST_WRITE` 调 `wx.hideShareMenu()` 隐藏右上角「转发/分享到朋友圈」菜单，退出 `showShareMenu({withShareTicket:false})` 恢复（仅状态变化时调 API）；首页/我的/帮助页内分享按钮在 `viewSession` 时不渲染。
- **卡片中性**：好友转发卡片只有两种、构造单源 `utils/share/index.js`（页面零自拼）——①兼职绑定卡（兼职身份 + 非切换会话 + 有 `partnerNo`，`path=/pages/role/index?bind={partnerNo}`，只带编号）；②通用邀请卡（`path=/pages/role/index`，零 query）。朋友圈卡片 `query` 恒空。一律显式固定中性封面 `/assets/share/cover.png`（5:4）与 `/assets/share/cover-timeline.png`（1:1），**禁止页面截图**——平台默认截图会把取件码/宿舍/尾号等 L3 带进卡片；卡片不含订单号/取件码/站点/宿舍/尾号/头像/昵称/截图/票据/识别原文。
- **范围与平台事实**：好友转发覆盖顾客/兼职 19 个业务页；朋友圈仅 `pages/role`、`pages/customer/home`、`pkg-customer/pages/help` 三页——朋友圈落地=当前页**单页模式**（scene=1154：无登录态、不能跳页、tabBar 不渲染、云资源不可用），故 `app.js` 启动识别后跳过云初始化与 `user.bootstrap`，三页只做静态预览与「前往小程序」提示；朋友圈为平台 Beta（基础库 ≥2.11.3，支持范围以官方文档为准）、只能经右上角菜单触发、不得诱导分享。
- **判据与取数**：`node tools/check.js` #33（19 页转发/3 页朋友圈/后台 11 页零分享/固定封面/会话收口/单页模式）+ `node tools/selftest-share.js`（断言数以命令真实输出为准；2026-10-28 实测 **182/182 PASS**）；页面清单单源 `tools/lib/share-pages.js`；真机分享/朋友圈效果属人项（`docs/QA_CHECKLIST.md` §X），agent 不代勾。开发者后台不提供任何分享/转发入口，也不因治理动作产生外发卡片。

---

## 7. 治理动作
### 7.1 治理动作总表
| 动作 | 动作名 | 对象/前置状态 | 确认级别 | 副作用 | 审计 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 停用兼职 | `admin.setPartnerStatus`（SUSPENDED + 原因） | ACTIVE 兼职 | 危险二次确认 | 登录仅停用提示；未完成订单转异常；顾客不能新下单 | `PARTNER_SUSPEND` |
| 恢复兼职 | `admin.setPartnerStatus`（ACTIVE） | SUSPENDED 兼职 | 二次确认 | 恢复登录/接单；历史与异常单需逐单处理 | `PARTNER_RESTORE` |
| 异常介入取消 | `order.cancel`（ADMIN 执行） | `EXCEPTION` 订单 | 危险二次确认 + 原因必填 | 订单 `CANCELLED`；双方可见原因 | `ORDER_ANOMALY_CANCEL` |
| 配置更新 / 维护模式 | `admin.updateConfig` | 白名单字段 | 二次确认（列变更项） | 下一次请求生效；维护时端侧公告、写接口拒绝 | `CONFIG_UPDATE` |
| 识别失败补录 | `admin.fixRecognitionFailure` | `PENDING` 复核记录（可关联订单） | 二次确认 | 仅回填 `parcel.stationId/stationName/pickupCode`；不改状态/不代确认/不创建/不改归属；可通知上传者 | `FAILURE_FIX` |
| 识别失败忽略 | `admin.ignoreRecognitionFailure` | `PENDING` 复核记录 | 二次确认 + 备注必填 | 记录置 `IGNORED`；不删除原图引用（到期 `cleanup` 处理） | `FAILURE_IGNORE` |
| 查看失败原图 | `admin.getRecognitionFailure` | 任一条复核记录（按单） | 每次点按即审计 | 仅返回 5 分钟临时 URL；不驻留/不缓存/不批量 | `FAILURE_IMAGE_VIEW` |
| 进入真实账号（只读） | `admin.viewAsStart({role,targetNo,mode:'READONLY'})` | ACTIVE 真实顾客/兼职 | 进入确认（只读+审计提示） | 黄条+拒写+隐藏分享；会话默认 30 分钟 | `ACCOUNT_SWITCH_START` |
| 进入测试账号（可写） | `admin.viewAsStart({role,targetNo,mode:'TEST_WRITE'})` | 测试账号（`isTestAccount=true`、ACTIVE） | 进入确认（写明「将写入测试数据，不影响真实用户」） | 蓝条+`TEST` 角标+可写；订单/事件 `isTest`+`impersonatedBy` | `ACCOUNT_SWITCH_START` |
| 新建测试账号 | `admin.createTestAccount({role,displayName})` | 每角色 <3、合计 <6 | 额度内直接创建 | 生成编号+合成 `_id='TEST-<random>'`+合成 `openid`；默认头像/默认资料/服务全开 | `TEST_ACCOUNT_CREATE` |
| 删除测试账号 | `admin.deleteTestAccount` | 该开发者的测试账号 | **危险二次确认** | 级联删测试数据+头像文件；**使相关活跃会话 `endedAt`** | `TEST_ACCOUNT_DELETE` + `ACCOUNT_SWITCH_END(TEST_ACCOUNT_DELETED)` |
| 清空测试数据 | `admin.purgeTestData` | 有测试数据 | **危险二次确认**（dry-run 计数 + 双条件） | 只清数据、保留账号；审计记前后条数 | `TEST_DATA_PURGE` |
> **测试账号不可执行真实治理**：停用/恢复/解绑真实顾客/通知真实用户等动作对测试账号无效（入口不出现、服务端拒绝）；测试账号只能删除或清空其测试数据（D18）。

### 7.2 兼职停用与恢复
- 入口：`partners` 行内「停用/恢复」；二次确认后果句见本文 §11.6；停用原因必填（≤100，写入 `partners.suspendedReason` 与审计 detail）。
- 停用后：兼职登录只见「已停用」提示与联系方式，看不到任何业务数据（§1）；名下未完成订单转 `EXCEPTION`（`by='ADMIN'`、`code='OTHER'`、说明「兼职账号已停用」），`DELIVERED` 单不转、由自动完成收尾（以 DATA_MODEL 定稿为准）；绑定保留但顾客端显示「已停用」、不能新下单（`order.create` 返回 `PARTNER_CLOSED`）。
- 恢复：`SUSPENDED → ACTIVE`，恢复登录/接单，历史订单与绑定不受影响；停用期间转异常的单仍需逐单处理，恢复不会自动回滚订单状态；审计 `PARTNER_SUSPEND`/`PARTNER_RESTORE`；**后台页面不提供「注销兼职」入口**（`admin.setPartnerStatus(CLOSED)` 为运维兜底能力：级联释放绑定/订单转异常或完成/匿名化见 DATA_MODEL §8，需控制台或脚本调用；兼职侧无自助注销 action），停用 ≠ 注销。

### 7.3 异常订单介入取消
- 仅 `EXCEPTION` 状态显示「介入取消」，其他状态不显示（服务端非法状态返回 `INVALID_TRANSITION`）。
- 原因必填（≤200）+ 二次确认后果句；取消后写 `CANCELLED` 事件，`cancelledBy='ADMIN'`，双方订单详情可见原因。
- **不代顾客确认送达、不创建订单、不修改订单归属**（§1.1 第 4 条）；不提供「重新打开/恢复订单」；审计 `ORDER_ANOMALY_CANCEL`（detail：orderNo、原状态、原因）。

### 7.4 全局配置变更
| 配置区块 | 字段 | 默认/约束 | 生效 |
| :-- | :-- | :-- | :-- |
| 服务类型模板 | `serviceCatalog[{code,name,desc}]` | 固定 5 个 code（§6），可改名称/说明；**不含启用开关**（结构只有 code/name/desc，不新增 code、不设交易字段） | 下一请求 |
| 苑名 | `zoneLabels` | D/X/N/B/C 五个；默认东苑/西苑/南苑/北苑/翠苑（D8 已裁决，可改） | 下一请求 |
| 站点名称（v1.1/D32） | `stations[{id,name}]` | 固定 8 个 id（P1~P8）；名称非空、1~20 字、唯一；默认取 `shared/stations.js`；保存整表校验（缺/多/重复 id 拒绝） | 下一请求（识别/选择器/AI prompt 用新名） |
| 公告 | `announcement{enabled,title,text}` | 标题 ≤30、正文 ≤500（设计上限，DATA_MODEL 定稿） | 端侧 `onShow`/60 秒内 |
| 超时 / 自动完成 | `orderTimeoutMinutes`/`autoCompleteHours` | 默认 120 分钟 / 24 小时；整数正数（建议 10~1440 / 1~168） | 新判定 |
| 截图留存 | `screenshotRetentionDays` | 默认 7；**上限 7**（不高于隐私承诺 §11.1/D9） | cleanup 下一轮 |
| 切换会话时长 | `viewTicketTtlMinutes` | 默认 30；5~60（真实/测试共用，§1.2/§1.3） | 新开会话 |
| 头像大小上限 | `avatarMaxBytes` | 默认 200KB；**≤200KB**（客户/兼职头像上传；后台不展示头像） | 新上传 |
| 测试账号上限 | `testAccountMaxPerRole` | 默认 3（每角色）；合计 ≤6/开发者（§1.3） | 新建议值 |
| 测试数据保留 | `testDataRetentionDays` | 默认 30 天；`cleanup` 清理超期未使用测试账号**数据**（账号保留） | `cleanup` 下一轮 |
| 识别失败保留 | `recognitionFailureRetentionDays` | 默认 30 天；**7~30**（长于订单截图 7 天，§4.1/§11.1） | `cleanup` 下一轮 |
| 维护模式 | `maintenance{enabled,text}` | 关闭/开启；开启需二次确认 | 下一请求 |
> 配置页不含隐私版本号（由隐私定稿流程单独更新），不含任何交易项；保存前展示变更清单并二次确认；失败保留输入；服务端每次读 config 为准；`config.aiFallback`（enabled/model/timeoutMs/maxPerUserPerDay/dailyQuota/cooldownMinutes）属云函数侧兜底参数，**MVP 不在后台开放编辑**（防误关兜底/误改配额），配置页只读展示总开关状态；**v0.9 新增可编辑项以 CONTRACT §1.1 白名单为准（切换会话时长/头像大小/留存期限）**，`testAccountMaxPerRole`/`testDataRetentionDays` 本期只读展示；若要开放编辑须先改 CONTRACT §1.1 并单独立项（本文 §10.4 第 5 条）。**v1.1/D32 新增「站点名称」可编辑（8 条固定 id、名称 1~20 字唯一；改名校验/审计 `CONFIG_UPDATE` 前后值）**。

### 7.5 维护模式与二次确认纪律
- 维护开启：二次确认；顾客/兼职端全屏公告 `系统维护中，预计 {time} 恢复；急单请留言或联系开发者。`；写接口拒绝（`INVALID_STATE`，admin 与 cleanup 除外）；读与切换会话不受影响、后台可用；关闭后立即恢复写。开启/关闭均记 `CONFIG_UPDATE`。
- 二次确认覆盖：停用/恢复、作废邀请码、介入取消、配置保存、维护开启/关闭、**识别失败补录/标记忽略**、**删除测试账号**、**清空测试数据**（dry-run 计数 + 勾选确认 + 输入「清空」）；确认框含「后果句 + 目标标识（编号+昵称/failureNo）+ 取消/确认」，危险按钮文案如 `确认停用`，非危险统一 `取消`；**查看失败原图不弹二次确认**（点即取图即审计，避免误导为「查看需授权」），但每次查看必落 `FAILURE_IMAGE_VIEW`；进入测试账号会话给**说明型确认**（写明「将写入测试数据，不影响真实用户」），不属危险确认；所有治理动作写 `admin_audit`（detail 不含 L3/openid/头像 fileId/完整昵称），审计不可编辑/删除，操作成功/失败逐条上屏、不静默刷新掩盖。

---

## 8. 安全与隐私
### 8.1 白名单安全
- `ADMIN_OPENIDS` JSON 映射只存云函数环境变量；不进代码/前端/数据库/仓库/日志；变更走环境变量发布并留记录。
- 每次请求校验；缺失/非法 ⇒ fail-closed（`admin.*` 全部 `FORBIDDEN`，后台入口不渲染）。
- `DEVELOPER` 不落 `users.roles`；无自助注册、无提权、无「邀请开发者」入口；`developerNo` 仅用于抬头与审计、不参与鉴权判断；前端隐藏入口不作为安全边界（§11.3）；非白名单误入后台：首个请求 `FORBIDDEN` → 清页面数据 → 回普通首页（不显示后台空壳）。
- **多开发者（v0.9，O10）**：白名单支持 `DEV-01…DEV-0N`，一个 openid 一个编号；各自微信登录、各自 `admin_view_sessions` 与审计，**不共享票据/不共享切换会话**；后台抬头显示当前 `developerNo`；**不存在应用内「切换开发者」入口**（平台限制，换人需换微信登录）。

### 8.2 票据与审计安全
- 票据 32 位随机、服务端存储、仅内存传递；不落本地存储/URL/日志/分享/剪贴板；30 分钟（可配 5~60）、**真实/测试共用单活**、每次请求校验票据 + 白名单；`READONLY` 不携带写权限；`TEST_WRITE` 额外校验目标 `isTestAccount=true` + ACTIVE，且**写请求同时匹配 `impersonatedBy` 与目标身份**（票据不能挪用到其他账号）；过期/结束/覆盖/测试账号被删即失效。
- 审计保留 ≥180 天；DB 层含 `adminOpenid`，后台 UI 只显示 `developerNo`；审计详情不含 L3/完整 openid/头像 fileId/完整昵称；邀请码审计不记完整码；切换会话审计只记 `viewMode/targetNo/targetIsTest`；审计只读，不提供删除/编辑/导出。后台访问与切换会话均按 §11.1 审计口径记录（最小必要），审计字段以 `admin_audit` 定稿为准。
- **审计名统一（v0.9）**：`ACCOUNT_SWITCH_START/END/EXPIRED`（真实与测试共用；`VIEW_AS_*` 已作废）；测试账号 `TEST_ACCOUNT_CREATE/TEST_ACCOUNT_DELETE/TEST_DATA_PURGE`；测试写事件在 `order_events`/`orders` 带 `impersonatedBy={developerNo}`，可按开发者追溯。

### 8.3 数据最小化
- 后台 DTO 默认脱敏；完整 L3 仅真实账号只读会话；**唯一例外 = 识别失败复核页按单看原图**（5 分钟临时 URL + 逐次审计，不驻留/不缓存，D17）；**不展示头像、昵称脱敏**（头像 v0.9 起采集，但后台 DTO 不含 `avatarFileId`，昵称只显示首字 + `**`）；不展示 openid/完整手机号；不把敏感数据写入本地存储，切页/退出清页面态；本后台不存在任何交易数据（D6）。
- **测试数据最小化**：测试账号为合成账号（无真实微信资料、默认头像、合成 `openid='TEST-<random>'`），后台只在「账号切换」页管理与使用；删除测试账号级联删头像与测试数据；`purgeTestData` 与 `cleanup`（默认 30 天）按最小化原则清理测试数据（D18/O16）。

### 8.4 负向清单
- 非白名单 openid 调任一 `admin.*` → `FORBIDDEN`；顾客/兼职调 `admin.*` → `FORBIDDEN`。
- 用他人/过期/已结束 `viewTicket` 读数据 → `VIEW_TICKET_EXPIRED`/`FORBIDDEN`；真实账号会话调目标角色写接口 → `FORBIDDEN` 且无数据变更；**真实账号传 `mode='TEST_WRITE'` → `FORBIDDEN`**；`TEST_WRITE` 目标 `isTestAccount=false` → `FORBIDDEN`。
- 伪造 `developerNo`/前端参数无效（鉴权只看 openid + env 映射 + 票据），开发者查看自己/其他开发者不存在入口；后台接口返回 L3 完整值/截图/openid/**头像 fileId/完整昵称** → 缺陷（AC-D-07/AC-D-08/AC-D-28…），后台出现导出/批量复制/「显示完整」入口 → 缺陷。
- 邀请码重新生效/复用/再次查看完整旧码 → 不存在；票据写入本地存储/URL/日志 → 缺陷；非白名单用户看到后台空壳/菜单 → 缺陷；维护模式下 admin 被拦 → 缺陷；**`VIEW_AS_*` 审计名再次出现 → 缺陷**（应统一 `ACCOUNT_SWITCH_*`）。
- **测试数据负向（D18/O4）**：真实×测试互绑/互下单/互留言未拒 → 缺陷；测试订单/测试账号进入统计、红点、真实列表或真实用户页面 → 缺陷；测试会话写真实数据或触发真实通知 → 缺陷；测试账号进入真实搜索/`partner.getPublic` → 缺陷；删除测试账号后其活跃会话仍可读写 → 缺陷。
- 识别失败复核负向：列表/接口返回原图缩略图或原图 URL → 缺陷；原图查看未落 `FAILURE_IMAGE_VIEW`、或审计 detail 含原图/OCR 全文 → 缺陷；提供批量/下载/导出，或非白名单调 `getRecognitionFailure`/`fixRecognitionFailure`/`ignoreRecognitionFailure` → 缺陷；补录后订单状态/归属/确认被改 → 缺陷；忽略不填备注、已处理记录重复操作未拒 → 缺陷（AC-D-24…AC-D-27）。

### 8.5 隐私承诺
- 后台治理访问（脱敏 + 审计 + 只读）需在《用户隐私保护指引》中声明，与 §11.2 对外承诺一致；上线前由用户确认文本（人执行）；切换会话不是「共享账号」，票据/后台不得交给第三方使用，审计可追溯到 `developerNo`。
- **v0.8 必须披露两项（§11.2）**：①识别失败时**去敏 OCR 文本**会发给第三方 AI 服务（DeepSeek）做识别辅助（原图不出本程序云存储、不发 openid、不用于训练）；②识别失败**原图会进入开发者复核流程**（临时查看 + 审计，默认 30 天删除）；微信后台按官方模板（自开发小程序没有第三方服务/SDK 栏）把 DeepSeek 写进对应信息类型用途 /「信息对外提供」（如可编辑）/ 补充文档（人执行，`docs/privacy/`）。
- **v0.9 必须披露两项（§11.2）**：③采集**微信头像与微信昵称**，只向当前绑定的对方展示（头像可拒绝→默认头像，不影响使用）；④开发者账号可**切换账号**——真实账号只读查看（审计/拒写），测试账号为后台**合成账号**（不含真实用户数据，可写但仅测试数据与测试内部生效）。
- 头像/昵称可见范围（§11.1）：仅 ACTIVE 绑定关系内互见；解绑/停用/注销后立即不再返回；**后台列表/详情不展示头像、昵称脱敏**；分享卡片只带编号。原图例外不改变「后台默认脱敏」承诺：复核页只有失败记录、只有按单临时查看、只有白名单开发者、全程审计。

### 8.6 AI 兜底与复核安全（后台侧，D16/D17）
- 外呼只在云函数层（`ai.parseParcel`）；后台前端/页面代码**零出现** `DEEPSEEK_API_KEY`、`api.deepseek.com`、任何模型调用；后台不展示/下发 Key 与请求/响应全文（ENGINEERING AI 兜底门禁）。
- 后台可见的 AI 信息只有复核记录上的 `aiTried/aiModel/aiResult(摘要)/aiErrorCode`；不落响应全文、不落 Key、不落原图二进制。
- 失败必须入队（禁止静默丢弃）；复核页字段来自 `recognition_failures`，**不展示 `uploaderOpenid`**，上传人只给编号 + 昵称。
- 原图访问：单条、临时 URL 5 分钟、每次 `FAILURE_IMAGE_VIEW`；不批量/下载/导出；URL 不入日志/审计 detail/本地存储/剪贴板；页面退出即失效、不缓存。
- 复核写动作为最小写：`fixRecognitionFailure` 仅回填识别字段并可选通知，`ignoreRecognitionFailure` 仅置忽略；两者都不改订单状态/归属/确认。

---

## 9. 验收清单 AC-D-01…AC-D-35（机器 + 人）
| 编号 | 方式 | 验收点 | 通过判据 |
| :-- | :-- | :-- | :-- |
| AC-D-01 | 机器+人 | launch 分流：`user.bootstrap.isDeveloper=true` → `reLaunch('/pkg-admin/pages/overview/index')`；非开发者无后台页可达 | 不依赖 `?admin=1`；**11 个后台页（10 功能页 + 后台消息）** 路径与 CONTRACT §7 逐字一致（含 `account-switch`、**无 `view-as`**）、无 tabBar |
| AC-D-02 | 机器 | 白名单 fail-closed：`ADMIN_OPENIDS` 缺失/JSON 非法/空映射时 `admin.*` 全 `FORBIDDEN`，入口不渲染；**多开发者 `DEV-02…` 映射可用** | 仓库/前端/DB 无 openid 字面量，`users.roles` 无 DEVELOPER；`DEV-01`/`DEV-02` 会话与审计互不可见 |
| AC-D-03 | 机器 | 邀请码生成：1~50、有效期四档、默认 7 天、备注 ≤50、`XXXX-XXXX-XXXX` 展示、整批复制 | 超限/非法值 `VALIDATION_FAILED`（`data.field`） |
| AC-D-04 | 机器+人 | 邀请码状态机：`UNUSED→USED/REVOKED/EXPIRED`；仅 UNUSED 可作废；已用/过期不可作废；无「重新生效」 | 状态按钮可用性、文案与本文 §4 一致；作废有二次确认 |
| AC-D-05 | 人 | 邀请码端到端：生成→复制→兼职激活→`partnerNo` 生成→后台显示使用人（编号+昵称+时间）→状态 USED | 同码二次激活 `INVITE_USED`；过期 `INVITE_EXPIRED`；作废/不存在 `NOT_FOUND`；测试账号不走邀请码 |
| AC-D-06 | 机器+人 | 邀请码审计：`INVITE_CREATE`/`INVITE_REVOKE` 各一条，含批次/数量/有效期/备注/时间 | 审计 detail 不含完整码；总览可查、不可编辑 |
| AC-D-07 | 机器+人 | 默认脱敏：取件码打码、尾号仅后 2、宿舍仅苑+楼栋、无房间号/roomTag/openid、无截图入口；**无头像、昵称脱敏（首字 + `**`）、DTO 无 `avatarFileId`** | 后台接口响应不含 L3 完整值/头像 fileId/完整昵称（机器断言 DTO） |
| AC-D-08 | 人 | 完整 L3 仅真实账号只读会话：顾客视角可见本人完整取件码/尾号/宿舍/截图；后台同单仍脱敏 | 两处对照同一订单；退出后后台仍脱敏；真实账号会话不可写 |
| AC-D-09 | 机器+人 | 禁止导出/批量复制：无导出入口、无 CSV/图片打包接口、L3 不可复制；识别失败原图不可批量查看/下载/导出 | 代码扫描无导出实现；页面无导出/完整显示控件；复核页仅按单「查看原图」按钮 |
| AC-D-10 | 人 | 搜索/分页/空态：顾客按编号/苑+楼栋/昵称，兼职按编号，订单按号/编号；分页与游标 | 断网/`FORBIDDEN`/`NOT_FOUND` 各有文案与出口；测试账号默认不参与真实搜索 |
| AC-D-11 | 人 | 账号切换（真实只读）：总览/顾客详情/兼职列表 → `account-switch` 真实账号 tab → 选角色 → 完整编号/列表选人 → 确认 → 目标三 tab + 黄条 | 票据 32 位仅内存；`custom-tab-bar` 按目标角色渲染；退出回 `account-switch` |
| AC-D-12 | 机器+人 | 真实黄条：文案逐字、不可关闭、不遮挡状态栏；退出回「账号切换」页；分享/转发入口隐藏 | 顾客/兼职两种文案各验；昵称超长降级正确（本文 §11.2） |
| AC-D-13 | 机器+人 | 真实账号写拒绝双保险：前端写控件置灰/隐藏+提示；服务端白名单外动作与全部目标角色写动作 `FORBIDDEN` | 抽测下单/接单/取件/送达/取消/留言/绑定/配置/注销，均无数据变更 |
| AC-D-14 | 机器+人 | TTL 与过期：默认 30 分钟（5~60 可配，真实/测试共用）；到期请求 `VIEW_TICKET_EXPIRED`→toast+清内存+回账号切换 | 测试环境把 TTL 配 5 分钟实测；审计有 `ACCOUNT_SWITCH_EXPIRED` |
| AC-D-15 | 机器+人 | 单活票据：真实/测试**共用单活**——开第二个会话（含跨真实/测试模式），旧票据立即失效；旧端退回账号切换 | 两端同 openid 验证；旧端错误为 `FORBIDDEN`（已结束票据），过期票据才为 `VIEW_TICKET_EXPIRED` |
| AC-D-16 | 机器+人 | 切换会话审计：`ACCOUNT_SWITCH_START/END/EXPIRED` 落库，detail 含 `viewMode/targetNo/targetIsTest`；**`VIEW_AS_*` 零出现** | 审计详情不含 L3/openid/头像 fileId/完整昵称；保留 ≥180 天 |
| AC-D-17 | 机器+人 | 编号搜索校验：完整编号必填、32 字母表、去空格/连字符/全角；错前缀与 `DEV` 前缀文案正确；非 ACTIVE 统一不可查看；**测试账号不进真实搜索、`partner.getPublic`→`NOT_FOUND`** | 顾客/兼职角色互换测试；`DEV-01` 被拒 |
| AC-D-18 | 人 | 停用/恢复：停用后登录仅停用提示、未完成订单转异常、顾客不可新下单；恢复后可用；两者审计；**测试账号不可被真实停用/恢复** | 测试账号单机可验（真实只读会话 + 测试可写会话）；异常订单逐单处理 |
| AC-D-19 | 人 | 异常介入：仅真实 `EXCEPTION` 可介入取消；原因必填 ≤200；二次确认；双方可见原因；审计 `ORDER_ANOMALY_CANCEL` | 非异常单无按钮；非法状态 `INVALID_TRANSITION`；不代确认/不创建/不改归属；测试订单无「介入取消」 |
| AC-D-20 | 机器+人 | 配置与维护：字段校验与生效（服务类型/苑名/公告/超时/自动完成/截图留存 ≤7 天/切换会话时长 5~60/头像大小 ≤200KB/留存期限）；维护模式端侧公告+写拒绝；`CONFIG_UPDATE` 审计 | 保存后下一请求生效；配置无任何交易字段；`aiFallback`/测试上限仅只读展示 |
| AC-D-21 | 机器 | 零金额扫描：后台页面/接口/字段/文案/审计/配置按 CONTRACT §12 门禁词表零命中（本文声明性文本按白名单登记） | 扫描命令与真实输出留档；命中即缺陷 |
| AC-D-22 | 机器+人 | 隐私与票据：切换票据不落本地存储、不进 URL/日志/分享；冷启动丢失票据需重开；后台无 openid/完整手机号/**头像 fileId/完整昵称** | `wx.*Storage*` 扫描无票据；后台响应无 openid/`avatarFileId` |
| AC-D-23 | 机器+人 | 负向权限：非白名单/顾客/兼职调 `admin.*`→`FORBIDDEN`；他人/过期票据→`VIEW_TICKET_EXPIRED`/`FORBIDDEN`；真实会话调写→`FORBIDDEN`；**真实账号传 `TEST_WRITE`→`FORBIDDEN`** | 覆盖 CONTRACT §4 数据隔离铁律 4 的负向项 |
| AC-D-24 | 机器+人 | 复核队列与列表：识别失败即入队 `PENDING`；总览卡/红点与后台消息摘要行；列表字段（failureNo/failureCode/sourceRole/上传人编号/时间/status）、失败码五值、来源角色与日期筛选、分页（默认 `PENDING` 首屏） | 列表无原图/无缩略图/无上传者头像；筛选空与真空文案区分；计数由服务端返回 |
| AC-D-25 | 机器+人 | 原图可见性：仅白名单、单条按单取临时 URL（5 分钟）；每次查看落 `FAILURE_IMAGE_VIEW`；无批量/下载/导出；不进切换会话白名单 | 连续查看两次 → 两条审计；URL 过期后失效；非白名单 `FORBIDDEN`；审计 detail 无原图/OCR 全文/openid |
| AC-D-26 | 机器+人 | 补录与忽略：补录只回填 `parcel.stationId/stationName/pickupCode`；订单状态/归属/确认不变；无关联订单时提示且不回填；忽略备注必填；已处理记录重复操作 `INVALID_STATE`；`notifyUploader` 内联 | 补录前后订单快照 diff 仅识别三字段；审计 `FAILURE_FIX`/`FAILURE_IGNORE` 各一条 |
| AC-D-27 | 机器+人 | 通知与保留期：补录/忽略的 `notifyUploader` 默认站内通知上传者（订阅消息 P1）、同日幂等、文案不含原图/失败码细节；`recognitionFailureRetentionDays` 7~30 默认 30；到期 `cleanup` 置 `IGNORED(EXPIRED)` 并删引用 | 上传者消息中心可见；超期记录只读；同一 `fileId` 仍被订单引用时不提前删 |
| AC-D-28 | 机器+人 | 测试账号视觉：蓝条文案逐字（`测试账号 · {角色} {编号}（测试） · 由 {developerNo} 切换 · 退出`）、每页 `TEST` 角标、可写、禁分享 | 顾客/兼职各验；角标不遮挡状态栏；分享/转发入口隐藏 |
| AC-D-29 | 机器+人 | `TEST_WRITE` 越权边界：真实账号传 `TEST_WRITE`→`FORBIDDEN`；`TEST_WRITE` 目标非 `isTestAccount`→`FORBIDDEN`；测试会话写真实数据/触发真实通知→缺陷；写事件带 `impersonatedBy` | 机器断言写接口双重校验；订单/事件字段检查 |
| AC-D-30 | 机器+人 | 测试×真实隔离：互绑/互下单/互留言→`FORBIDDEN`；测试账号不进真实搜索与 `partner.getPublic`；测试账号只能绑测试账号 | 切换双端验证；错误文案「测试账号与真实账号不能互相绑定」 |
| AC-D-31 | 机器+人 | 统计与红点排除：`admin.stats`/兼职单量统计/红点不含测试账号与 `isTest`；订单列表默认过滤、可切换「含测试数据」并带「测试」标签 | 造 1 真实 + 1 测试单对照计数；开关只影响列表、不影响统计 |
| AC-D-32 | 机器+人 | 测试账号管理：新建额度（≤3/角色、≤6/开发者）；删除级联删数据+头像并使活跃会话 `endedAt`；`purgeTestData` dry-run 计数 + 双条件 + 审计前后条数；`cleanup` 30 天清理测试数据 | 超额 `INVALID_STATE`/`VALIDATION_FAILED`；审计 `TEST_ACCOUNT_CREATE/DELETE`、`TEST_DATA_PURGE` |
| AC-D-33 | 机器+人 | 头像/昵称最小展示：后台列表/详情无头像位、DTO 无 `avatarFileId`、昵称脱敏；复核页不展示上传者头像；解绑/停用/注销后绑定双方不再互见头像昵称；分享卡片不含头像昵称 | 机器断言 DTO；端侧在真实只读会话对照；隐私声明已勾选头像/昵称 |
| AC-D-34 | 机器+人 | 后台零分享与门禁 #33：11 个后台页无分享钩子/入口；19 个顾客/兼职业务页挂 `onShareAppMessage`、仅 role/home/help 三页挂 `onShareTimeline`；卡片构造单源、固定中性封面、页面零自绘 | `node tools/check.js` #33 与 `node tools/selftest-share.js` 全绿；清单外页面私挂分享判红（新增页面须同步 `tools/lib/share-pages.js`） |
| AC-D-35 | 机器+人 | 切换会话禁分享 + 单页模式降级：进入 `READONLY`/`TEST_WRITE` 后右上角「转发/分享到朋友圈」菜单隐藏、退出恢复；页内分享按钮隐藏；scene=1154 启动跳过云初始化与 `user.bootstrap`，三页静态预览 | 机器断言 `syncSession` 调用与单页模式分支；真机单页预览与卡片截图（QA §X） |
> 取数方法：机器=`node tools/check.js`/`check-docs.js`/`selftest*.js` 与 `check.ps1` 退出码 0+真实输出（ENGINEERING §8），页面路径与 CONTRACT §7 对账（含 `account-switch`、无 `view-as`）、动作名与 §5.3 双向对账；**v0.8 增**：客户端与后台页面目录扫描 `DEEPSEEK_API_KEY|api.deepseek.com` 零命中、外发键集合白名单断言、失败必入队断言、原图访问必落 `FAILURE_IMAGE_VIEW` 断言；**v0.9 增**：`ACCOUNT_SWITCH_*` 审计断言、`VIEW_AS_*` 零命中、`TEST_WRITE` 双校验断言、`isTest/impersonatedBy` 断言、统计排除断言、后台 DTO 无 `avatarFileId` 断言（CONTRACT §12 账号切换门禁/头像昵称门禁）；人=按 `docs/QA_CHECKLIST.md` 后台/只读视角/测试账号分区执行（真实只读会话 + 测试可写单机 + 双机第二微信号，agent 不代宣布通过），**识别失败复核执行 QA `R` 分区、账号切换与测试账号执行 QA `T` 分区**（以 QA 定稿为准，本文 §10.4 第 3 条）；证据=截图/录屏（脱敏界面、黄条/蓝条、`TEST` 角标、拒绝 toast、审计条目），审计以 `stats`/`listAudit` 真实查询为证；不写死测试条数与性能承诺。

---

## 10. 待裁决与 P1 / 不做清单
### 10.1 D14 / D18：真实账号只读 vs 测试账号可写
| 选项 | 做法 | 代价/风险 | 结论 |
| :-- | :-- | :-- | :-- |
| A 真实账号只读 + 测试账号可写（默认） | 真实会话 `READONLY`：黄条+拒写+审计；测试会话 `TEST_WRITE`：蓝条+`TEST` 角标+可写但仅测试数据（隔离/标记/排除统计/可清理） | 单机即可验收两端；需维护测试账号管理与清理链路；真实账号仍不能代操作 | ✅ 推荐（本文口径，D14/D18 推荐项） |
| B 真实账号也可写 | 真实会话可写 | 隐私/审计/数据污染风险高；真实用户会被代操作 | **不做**（D18 备选 B 已否） |
| C 只有只读、不做测试账号 | 仅真实账号只读 | 一个微信号无法验收两端真实操作（只能借第二/第三微信号） | 不推荐（D18 备选 C） |

### 10.2 D15 / D16 / D17 / D19 / D20 / D21：编号、识别复核、头像昵称、绑定方向、roomTag
| 裁决 | 当前口径 | 若用户改 |
| :-- | :-- | :-- |
| D15 编号 | `C-XXXX-XXXX` / `P-XXX-XXX` / `DEV-01`（白名单可配 `DEV-02…`） | 改生成/校验/展示与本文文案；页面结构不变 |
| D16 AI 兜底 | 云函数调 DeepSeek、只发去敏文本、失败静默降级并入复核队列；后台只读展示、不调用 | 若否决 AI，复核流程不变（`aiTried=false` 记录照常入队）；换服务商只改云函数适配层 |
| D17 原图复核 | 失败单原图仅复核页按单临时查看（5 分钟 URL + 每次 `FAILURE_IMAGE_VIEW`、不批量/下载/导出、默认 30 天；`notifyUploader` 内联） | 不允许看原图 → 复核效果差；允许批量导出 → 审计/滥用风险；延长保留期须同步改隐私承诺 |
| D19 头像昵称 | 顾客/兼职采集 `chooseAvatar` + 昵称（必填可改、头像可拒绝→默认头像）；仅绑定对方可见；后台不展示头像、昵称脱敏 | 改为强制头像/不可改昵称 → 违反"用户主动选择"；只采昵称 → 不满足需求 |
| D20 绑定方向 | **只能顾客发起**；兼职无绑定入口；代客单不产生绑定；解绑后互不可见头像昵称 | 已定（用户四次修订），无备选 |
| D21 roomTag | **恒大写** `A…Z/AA…`（展示 `D4-522A`） | 已定（用户四次修订），小写视为缺陷 |
| D36 分享与朋友圈 | 19 页好友转发；朋友圈仅 role/home/help 三页（单页模式静态降级）；两种中性卡片、固定封面、卡片零 L3；切换会话隐藏分享；后台 11 页零分享（§6.11） | 已实现（v1.2，2026-10-28）；若调整范围须先改 CONTRACT §8/§13-D36，再同步门禁 #33、`tools/lib/share-pages.js` 与 QA §X |
> 关联裁决（2026-10-22 全部闭环）：D8 苑名=东苑/西苑/南苑/北苑/翠苑（默认值进 `shared/zones.js`，后台仍可改）；D13 主体/类目=个人主体+工具类目（提审前确认类目可选，与后台功能无关）；**D22 已改判 B（见 D24：取件码截图自愿、允许无截图手填提交，每件仍需站点+取件码或运单尾号；旧 A 作废，留痕见 CONTRACT §13 与 `docs/V4_DECISIONS.md` D22）**；D6 零交易已定，后台无待决交易项；真实操作现可用**测试账号单机**完成，额外微信号仅作补充验收。

### 10.3 P1 / 不做清单
- **P1**：独立审计页（当前并入总览，§1.1 第 6 条）；邀请码批量作废/再次查看完整码（需二次确认+审计）；后台消息独立动作/集合（当前聚合视图）；统计图表/趋势（只统计单量与人数）；**识别失败订阅消息提醒**（模板 ID 入 `config`）、**复核批量处理**、复核记录撤销忽略（恢复 `PENDING`）、`config.aiFallback` 后台开放编辑（须先改 CONTRACT §1.1）；**测试账号模板/预置服务配置**、**测试数据按开发者/角色批量清理**、**应用内切换开发者账号**（平台不支持，不做）；真实微信号双机验收作为额外流程（仍可用第二/第三微信号）。
- **不做**：真实账号可写（`TEST_WRITE` 对真实账号永远 `FORBIDDEN`）；小程序内切换微信登录账号；真实×测试互绑/互下单/互留言；测试数据进统计/红点/真实列表/真实用户页面；对测试账号执行真实治理动作；导出完整个人信息、下载截图、批量复制 L3、批量查看/下载/导出识别失败原图；后台调用第三方 AI 或展示 Key/端点；查看非失败单原图（除真实只读会话）；原图转发/分享/写入本地存储；**后台展示头像/完整昵称或导出头像**；删除订单/改订单状态（除异常介入取消）/改订单归属；补录时改订单状态/代确认/创建订单；代下单、代接单、代留言；查看/写入 openid；查看开发者自己/其他开发者；邀请码「重新生效」、开发者用邀请码自激活；**后台创建/代绑客户绑定**（绑定只能顾客发起）；后台任何交易类动作/字段/统计（D6，不存在）；后台直接改数据库入口（控制台人工修数据不属本后台）。

### 10.4 回写清单（交 lead / DATA_MODEL / ENGINEERING / QA / privacy）
1. `docs/V4_DATA_MODEL.md`：v0.7/v0.8 项继续（邀请码/票据/读白名单/DTO 分级/识别失败复核；`notifyUploader` 已定稿内联、失败记录以「订单 × 截图」为粒度）；**v0.9 新增**：`users.isTestAccount/createdByDeveloperNo/testLastUsedAt`（**合成 `openid='TEST-<random>'`，非空串**）、`orders.isTest/impersonatedBy`、`order_events.impersonatedBy`、`admin_view_sessions.viewMode/targetIsTest/targetAvatarFileId`、`config.avatarMaxBytes/testAccountMaxPerRole/testDataRetentionDays`、`customers/partners.displayName(必填)/avatarFileId`、`roomTag` 大写规则；**admin 动作表 23 个**（`viewAsStart({role,targetNo,mode})`/`viewAsEnd` + `createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData` 等）；审计名统一 `ACCOUNT_SWITCH_START/END/EXPIRED` + `TEST_ACCOUNT_CREATE/TEST_ACCOUNT_DELETE/TEST_DATA_PURGE`（**`VIEW_AS_*` 作废**）；`purgeTestData` 的 dry-run 计数字段与审计 `before/after` 条数字段。仍需确认：后台消息聚合视图数据源、兼职切换会话配置读取承载、停用兼职名下订单转异常的具体处理（沿用 v0.7 待确认，不阻塞本文）。
2. `docs/V4_ENGINEERING.md`：v0.8 项继续（`ADMIN_OPENIDS` JSON 映射/只读视角云侧/AI 兜底门禁）；**v0.9 需补** 账号切换门禁（`TEST_WRITE` 仅测试账号、真实×测试 `FORBIDDEN`、统计/红点/邀请码排除测试、测试写带 `impersonatedBy`、票据内存态）、头像昵称门禁（后台 DTO 无 `avatarFileId`、昵称脱敏、`avatars/` 路径与 ≤200KB）、后台页面清单 11 页（`account-switch` 替代 `view-as`）、check-docs 页面/动作/审计名对账（**`VIEW_AS_*` 零命中**）。
3. `docs/QA_CHECKLIST.md`：后台/只读视角 G/V 与识别失败 R 分区继续；**v0.9 新增 `T`（账号切换与测试账号）分区**，与本文 AC-D-28…AC-D-33 对应（蓝条/角标、`TEST_WRITE` 越权、真实×测试隔离、统计排除、测试账号管理/级联删除、头像昵称不展示）；**v1.2 增补** QA §X（D36 分享与朋友圈人项，判据见本文 §6.11）。
4. `docs/V4_UX_CUSTOMER.md` / `docs/V4_UX_PARTNER.md`：目标端需实现「真实=黄条+拒写 / 测试=蓝条+`TEST` 角标+测试可写 / 隐藏分享 / `viewTicket` 注入」的统一组件契约（以本文 §6.4/§6.6 为源，两端不得各自另定）；端侧还须实现头像/昵称展示与默认头像兜底、解绑后互不可见；识别失败兜底文案（失败码五值）以 UX_CUSTOMER/UX_PARTNER 为准，后台复核文案（本文 §11.8）只做后台侧对齐。
5. `docs/privacy/`：v0.8 两项披露（第三方 AI 去敏文本、复核原图）+ **v0.9 两项披露（微信头像/昵称采集与可见范围、账号切换/测试账号）**；微信后台按官方模板声明「昵称、头像」（同一项）及「剪切板」「选中的照片或视频信息」等实际接口项，并把 DeepSeek 对外提供写进用途 /「信息对外提供」（如可编辑）/ 补充文档（人执行）；`config.aiFallback` 维持后台只读（CONTRACT §4.3）。
6. `docs/V4_DECISIONS.md`：记录 D14/D15/D16/D17/D18/D19/D20/D21 用户裁决结果；D18 若改为"真实账号可写"需回写 CONTRACT §1.2/§1.3 与本文 §6/§10；D19 若改采集方式需回写本文 §8.3/§8.5 与隐私文本。

---

## 11. 文案表
### 11.1 原则
- 状态/错误文案由服务端下发（`message`）或来自统一文案表；页面层不自造状态文案、不「假装成功」；错误文案 = 发生了什么 + 下一步，禁止「请稍后重试」式空话；不出现敏感数据（取件码/尾号/房间号/openid）与交易语义；编号原样展示、不缩写；时间用服务端 `serverTime` 格式化；业务错误只认 CONTRACT §5.3 的 13 个码。

### 11.2 真实账号黄条
| 场景 | 文案 |
| :-- | :-- |
| 顾客视角 | `开发者只读视角 · 顾客 C-7K2M-9QX4 小王 · 退出` |
| 兼职视角 | `开发者只读视角 · 兼职 P-7K2-M9X 小王 · 退出` |
| 历史昵称为空（兜底） | `开发者只读视角 · 顾客 C-7K2M-9QX4 （未设置昵称） · 退出`（v0.9 昵称必填，仅历史数据兜底） |
| 昵称超长 | 黄条单行截断：displayName 截断至 8 字 + `…`；完整昵称在目标页资料处可见；**黄条不展示头像** |
| 会话已结束 / 退出中 | toast `只读视角已结束：{原因}。已返回账号切换。` / `正在退出只读视角…` |
> 测试账号蓝条与 `TEST` 角标文案见本文 §6.4/§11.9；两种会话都隐藏分享/转发/长按保存入口。

### 11.3 邀请码
| 场景 | 文案 |
| :-- | :-- |
| 状态标签 | `未使用` / `已使用` / `已作废` / `已过期` |
| 生成成功 | `已生成 {n} 个邀请码（批次 {batchId}），有效期至 {expiresAt}。离开本页后将无法再次查看完整邀请码，请及时复制并线下发放。` |
| 复制成功 / 批量超限 / 有效期非法 / 备注超限 | `已复制 {n} 个邀请码` / `单批最多生成 50 个邀请码。` / `请选择有效期：24 小时 / 72 小时 / 7 天 / 30 天（默认 7 天）。` / `备注最多 50 字。` |
| 作废确认 / 成功 / 不可作废 | `作废后这个邀请码立即失效且无法恢复，兼职将无法用它激活。确定作废？` / `邀请码已作废` / `这个邀请码已被使用，不能作废。` / `这个邀请码已过期，无需作废。` |
| 列表空 / 筛选空 | `还没有邀请码。生成后可线下发给要开通兼职的同学。` / `没有符合当前状态的邀请码。` |
| 激活侧错误 | `邀请码不存在或已作废，请向开发者确认。` / `这个邀请码已过期，请让开发者重新发一个。` / `这个邀请码已经被使用，请让开发者补发一个。` / `邀请码是 12 位字母数字，形如 XXXX-XXXX-XXXX。` / `激活失败次数过多，请明天再试。` |

### 11.4 真实账号写拒绝 / 越权拒绝
| 场景 | 前端 | 服务端（`message` 单源） |
| :-- | :-- | :-- |
| 点置灰写按钮 / 写入口隐藏 | toast `开发者只读视角不能操作`；隐藏入口处灰条 `只读视角下不可用` | — |
| 服务端收到真实会话写请求 | — | `FORBIDDEN` + `开发者只读视角不能操作` |
| 票据过期 / 已结束（被覆盖等） | toast `只读视角已过期（30 分钟到期），已返回账号切换。` / `切换会话已在别处重新开启，本页已退出。` | `VIEW_TICKET_EXPIRED` + `只读视角已过期，请重新开启。` / `FORBIDDEN`（已结束/被覆盖，不泄露目标信息） |
| 真实账号被传 `TEST_WRITE` | — | `FORBIDDEN` + `真实账号只能只读查看。` |
| 真实×测试互绑/互下单/互留言 | 目标端入口隐藏 + 说明 | `FORBIDDEN` + `测试账号与真实账号不能互相绑定。` / `测试账号与真实账号不能互相下单。` |
| 测试账号被删除 / 会话失效 | toast `测试账号已删除或会话已结束，已返回账号切换。` | `FORBIDDEN`/`VIEW_TICKET_EXPIRED` |
| 目标已停用/注销 | toast `该用户当前不可查看，已返回账号切换。` | `FORBIDDEN`/`NOT_FOUND` + `该用户当前不可查看。` |

### 11.5 后台空态/错误态
| 场景 | 文案 |
| :-- | :-- |
| 空态组 | `暂无统计数据。` / `还没有顾客资料。` / `还没有兼职人员。` / `当前筛选下没有订单。` / `暂无审计记录。` / `没有待处理的后台消息。` / `还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。` / `还没有测试账号。新建一个测试顾客/测试兼职开始单机验收。` / `当前只显示真实数据，开启「含测试数据」可查看测试订单。` |
| 搜索空 | `没有找到匹配的顾客，换个编号、苑+楼栋或昵称试试。` / `没有找到这个兼职编号，请核对后重试。` / `没有符合当前状态的邀请码。` / `没有待处理的异常工单。` / `没有符合当前筛选的识别失败记录。` |
| 总览/列表错误 | `没连上服务器，先检查网络；刚才的数据是 {HH:mm} 的。` + `重试` |
| 无权限 / 目标不存在 / 限流 | `当前账号没有后台权限，已返回首页。` / `记录不存在或已注销。` / `操作太频繁，请稍后再试。` |
| 目标不可查看 | `该用户当前不可查看，请确认对方账号处于正常状态后再试。` |

### 11.6 治理确认与结果

**站点名称（v1.1/D32）**：「站点名称」/ 说明「固定 8 个取件站点；名称用于识别、选择器与 AI 提示，保存后下一请求生效；不允许新增或删除站点」/ 校验「名称需为 1~20 字且不能重复」/ 变更清单按「旧名称 → 新名称」逐行展示。
| 场景 | 文案 |
| :-- | :-- |
| 停用确认 | `停用后，{displayName}（{partnerNo}）将无法登录兼职端，名下未完成订单转异常待处理，绑定顾客暂时不能向他下单。历史订单与编号保留。确定停用？` |
| 停用成功 / 恢复确认 | `已停用 {displayName}（{partnerNo}）` / `恢复后，{displayName}（{partnerNo}）可重新登录兼职端；停用期间产生的异常订单仍需逐单处理。确定恢复？` |
| 介入取消确认 / 成功 | `将取消订单 {orderNo}（{status}）。取消后双方可见原因与状态，不可恢复。请填写介入原因（必填，≤200 字）。` / `订单 {orderNo} 已取消，已记入审计。` |
| 配置保存确认/成功 | `本次将修改：{字段列表}。保存后对顾客/兼职端下一次请求生效。确定保存？` / `配置已保存。` |
| 维护开启确认 / 端侧 / 公告条 | `开启维护模式后，顾客/兼职端将看到维护公告，写操作被拒绝；后台不受影响。确定开启？` / `系统维护中，预计 {time} 恢复；急单请留言或联系开发者。` / `公告：{title}` / `知道了` |
| 删除测试账号确认 / 成功 | `删除测试账号 {编号}（{昵称}）后，其全部测试订单、留言、绑定与头像将一并删除，并结束该账号的活跃切换会话，不可恢复。确定删除？` / `已删除测试账号 {编号} 及其测试数据。` |
| 清空测试数据确认 / 完成 | `将清空全部测试数据：测试订单 {n} 条、留言 {m} 条、绑定 {k} 条、识别失败 {j} 条；测试账号保留。此操作不可恢复。`（勾选 `我已知晓清理不可恢复` + 输入 `清空`）/ `已清空测试数据（订单 {before}→{after} 条…），已记审计。` |
| 危险按钮 | `确认停用` / `确认恢复` / `确认取消` / `确认保存` / `确认删除` / `确认清空`；非危险统一 `取消` |

### 11.7 账号切换（真实账号 / 测试账号）
| 场景 | 文案 |
| :-- | :-- |
| 页面说明 | `真实账号只读查看（不能操作、全程审计）；需要真实操作请切「测试账号」（只写测试数据，不影响真实用户）。小程序不能切换微信登录账号，这里只做应用内账号代理切换。` |
| 真实开启确认 | `将以{角色} {编号} {脱敏昵称} 的只读视角进入，有效期 {n} 分钟。期间不能做任何写操作，退出或到期后自动回到账号切换。确定进入？` |
| 搜索占位 / 格式错 | `输入完整顾客编号，如 C-7K2M-9QX4` / `输入完整兼职编号，如 P-7K2-M9X` / `编号格式不对：顾客编号是 C 开头 8 位（C-XXXX-XXXX），兼职编号是 P 开头 6 位（P-XXX-XXX）。` |
| 错角色 / 开发者编号 | `当前选择的是顾客，请勿输入 P 开头的兼职编号。` / `当前选择的是兼职，请勿输入 C 开头的顾客编号。` / `这是开发者编号，不能用于账号切换。` |
| 目标不可查看 / 额度 | `该用户当前不可查看，请确认对方账号处于正常状态后再试。` / `每位开发者每角色最多 3 个、合计 6 个测试账号。` |
| 开启成功 / 开启失败 | `已进入只读视图（{n} 分钟）` / `已进入测试视图（{n} 分钟）` / `没有连上服务器，账号切换未开启；请检查网络后重试。` |
| 日限流 / 冷启动丢失 | `今天开启账号切换的次数已用完（每天 20 次），请明天再试。` / `切换会话已结束（小程序重新打开后需重新开启）。` |
| 退出中/成功/失败 | `正在退出…` / `已退出只读视图` / `已退出测试视图` / `退出请求失败，可重试；票据将在 {expiresAt} 自动失效。` + `重试` / `本地退出` |

### 11.8 识别失败复核（v0.8，后台侧）
| 场景 | 文案 |
| :-- | :-- |
| 失败码标签 | `未识别到文字` / `有文字但没认出站点或取件码` / `识别结果可信度低` / `智能识别服务不可用` / `图片无法读取` |
| 页面说明 | `这里只处理识别失败的截图复核：可按单查看原图（每次查看都会记审计），补录站点/取件码只回填订单的识别字段，不会改变订单状态。` |
| 状态标签 | `待复核` / `已修复` / `已忽略`；过期自动忽略备注 `已过保留期自动忽略` |
| 上传人展示 | 编号 + 脱敏昵称；**不展示头像、不展示 openid** |
| 查看原图 / 原图过期 | `查看原图（临时 5 分钟，将记审计）` / `原图已过保留期或已被清理。` |
| 补录确认 / 成功 | `将把站点改为 {站点}、取件码改为 {取件码}，仅回填识别字段；不改订单状态、不代确认、不创建订单。确定保存？` / `已补录并回填关联订单 {orderNo}。` / `已补录；该记录没有关联订单，未回填订单。` |
| 补录校验 | `请选择 P1~P8 中的站点。` / `取件码是 4~12 位字母数字，请核对后重试。` |
| 忽略确认 / 成功 | `忽略后该记录不再出现在待复核列表，但不会删除记录与审计。请填写忽略原因（必填，≤100 字）。` / `已标记忽略。` |
| 通知 / 重复 | `已通知上传者。` / `该记录今天已通知过上传者，无需重复通知。` / `该记录已处理，不能重复操作。` |
| 原图打开失败 / 网络 | `原图加载失败，请刷新后重试；多次失败请联系运维。` / `没连上服务器，先检查网络；刚才的数据是 {HH:mm} 的。` + `重试` |

### 11.9 测试账号与测试会话（v0.9）
| 场景 | 文案 |
| :-- | :-- |
| 蓝条（逐字） | `测试账号 · 顾客 C-7K2M-9QX4（测试） · 由 DEV-01 切换 · 退出` / `测试账号 · 兼职 P-7K2-M9X（测试） · 由 DEV-01 切换 · 退出` |
| `TEST` 角标 / 列表标签 | 每页右上角 `TEST`；后台列表测试行 `测试` 标签 |
| 新建表单 | 标题 `新建测试账号`；角色 `顾客 / 兼职`；昵称占位 `测试-小王`（≤20 字）；按钮 `创建并切换` / `仅创建` |
| 新建成功 / 失败 | `已创建测试账号 {编号}（{角色}）。` / `昵称不能为空且最多 20 字。` / `每位开发者每角色最多 3 个、合计 6 个测试账号。` |
| 切换确认 | `将以测试账号 {编号}（{角色}）进入，有效期 {n} 分钟。期间可操作，但只写入测试数据，不影响真实用户；全程审计。确定进入？` |
| 删除确认 / 成功 | `删除测试账号 {编号}（{昵称}）后，其全部测试订单、留言、绑定与头像将一并删除，并结束该账号的活跃切换会话，不可恢复。确定删除？` / `已删除测试账号 {编号} 及其测试数据。` |
| 清空确认（dry-run）/ 完成 | `将清空全部测试数据：测试订单 {n} 条、留言 {m} 条、绑定 {k} 条、识别失败 {j} 条；测试账号保留。此操作不可恢复。` + 勾选 `我已知晓清理不可恢复` + 输入 `清空` → `确认清空` / `已清空测试数据（订单 {before}→{after} 条…），已记审计。` |
| 保护文案 | `真实账号只能只读查看，不能切换为可写。` / `测试账号与真实账号不能互相绑定。` / `测试数据不会进入统计、红点与真实用户页面。` / `该用户当前不可查看。` |

---

> 文档完毕。页面路径、动作名、错误码、限额逐字引用 CONTRACT v0.9（含 §1.2/§1.3 账号切换、§4.3 识别兜底、§13 D14~D21）；后台共 **11 页 = 10 个功能页 + 后台消息**（`account-switch` 已替代 `view-as`）；审计名统一 `ACCOUNT_SWITCH_*`（`VIEW_AS_*` 作废）；roomTag 一律大写（`D4-522A`）；v0.6 旧字段（如 `activation_codes` 与交易类字段）与 v0.8 旧口径（旧页名、单开发者假设、依赖多微信号验收、头像未纳入采集等）一律不采用；未决项 D14/D15/D16/D17/D18/D19/D20/D21 见本文 §10。
