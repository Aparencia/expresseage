# V4_CONTRACT · v4 设计统一口径卡（写作与实现的唯一事实源）

> 版本：v0.9 草案（2026-10-21，按用户二次 + 三次 + 四次修订：①本程序只负责顾客下单/兼职接单/信息整理，**不涉及任何金钱交易：不做支付、收款、记账、结算、运费计算、价格表**；②顾客与兼职都有**不同样式的唯一编号**；③新增**开发者账号**：邀请码生效控制、后台数据查看、可**只读切换**顾客/兼职视角；④**OCR 识别失败兜底**：云函数调 **DeepSeek API** 对去敏文本做结构化兜底并**格式化返回**站点/取件码，仍失败则把**含原图的识别失败记录**反馈到开发者后台复核；⑤（v0.9）**绑定方向固化**：只能顾客绑定兼职，兼职**不能绑定顾客**；⑥（v0.9）开发者账号可**切换账号**：真实账号只读、**测试账号可写**（单机验收两端）；⑦（v0.9）同寝室标识 `roomTag` **恒大写**（`D4-522A`）；⑧（v0.9）顾客与兼职**均采集微信头像与微信昵称**，绑定双方档案可见）｜维护：lead｜状态：**D1~D22 已按用户 2026-10-22 回复全部裁决/确认**（D2 沿用 v3 appid `wxcb7e5b41b89bc806`；D8=东/西/南/北/翠苑；D13=个人主体+工具类目；D22=A；其余按推荐；见 §13 与 `docs/V4_DECISIONS.md` §0.1）
> D1 同日修订（2026-10-22）：用户追加约束「云开发只能开通一个环境」⇒ **单环境部署**（develop/trial/release 三档同 envId，测试数据靠测试账号/`isTest` 隔离并在上线前清零）；见 §2 D1 与 `docs/V4_DECISIONS.md` D1 修订留痕。
> 用法：v4 全部设计文档与后续代码都引用本文口径。文档之间冲突时**以本文为准**；要改本文口径必须先改本文、再同步所有引用它的文档（禁止各写一份会漂移的事实）。
> 依据：v3 只读研究四份报告 + `D:\Code\expresseage_college_v3\`（只读参照）+ 用户 2026-10-21 四条需求与二次修订三条（零金钱 / 双角色唯一编号 / 开发者账号）+ 三次修订两条（OCR 失败 DeepSeek 兜底 / 失败截图含原图反馈开发者）+ 四次修订五条（绑定单向 / 账号切换 / roomTag 大写 / 头像昵称 / 其他优化审查）。

---

## 0. 一句话与范围

**v4 = 校园快递代取「顾客下单 + 兼职接单履约 + 开发者治理」小程序**：顾客用微信登录，采集**微信头像与微信昵称**、完善宿舍身份（DXNBC 五苑 + 楼栋 + 宿舍号 + 可选手机尾号，后台分配同寝室区分标识），绑定一位兼职后上传取件码截图下单、选择服务类型、跟踪订单进度；兼职人员凭开发者发放的**邀请码**开通，同样采集**微信头像与微信昵称**，沿用 v3 取件清单（按驿站站点聚合、四档动线、批量取件、送达闭环），只能看到绑定自己的顾客与订单；**开发者账号**负责邀请码生效控制、后台数据查看与全局配置，可**只读切换**真实顾客/兼职视角，并可**切换测试账号（可写）**做单机两端验收；**绑定只能由顾客发起**，兼职不能绑定顾客。

**本程序只做三件事（用户硬口径）**：
1. **顾客下单**：截图/手工录入取件码、站点、柜号、宿舍地址、预约与备注，提交订单。
2. **兼职接单与履约**：接单、取件、送达、异常上报/解除、改码、代客下单；不得接单超范围。
3. **信息整理**：取件码、站点、楼栋/宿舍、roomTag、四档动线、进度与留言。

**本程序不涉及任何金钱交易（用户硬口径，工程禁用词）**：不做在线支付，不做收款/记账/结算，不做运费计算，不做价格表/报价/费用分摊，**不出现任何金额字段、金额计算或金额文案**。服务只保留"服务类型"（做什么），不表达"多少钱"。费用与支付不在本程序内发生、记录、计算或展示。

**修订需求（对应用户 2026-10-21 二次 + 三次修订，必须落）**：
1. **零金钱**：见上；UI/数据库/接口/隐私文本全部清掉金额语义。
2. **双角色唯一编号**：顾客 `customerNo`（`C-XXXX-XXXX`）与兼职 `partnerNo`（`P-XXX-XXX`）**两种不同样式**、服务端生成、全局唯一、不可修改；开发者 `developerNo`（`DEV-01`）。详见 §3.1。
3. **开发者账号**：白名单 openid（非顾客/兼职业务身份）；邀请码生成/作废/有效期控制；后台数据查看（默认脱敏）；全局配置；兼职停启用；异常介入；**只读视角切换**（顾客/兼职）。详见 §1.1/§1.2。
4. **识别兜底与失败复核（三次修订）**：端侧 OCR + 规则解析不出**站点或取件码**时，云函数调 **DeepSeek API** 做结构化兜底（**只发去敏 OCR 文本，不发原图、不发 openid**），返回**统一格式 DTO**；仍失败/低置信时，把本次识别（**含原图 fileId**）写入 `recognition_failures` 队列，开发者后台「识别失败复核」可查看原图、补录站点/取件码、通知上传者；全程审计。详见 §4.3。
5. **绑定方向固化（四次修订）**：**只能顾客绑定兼职**（顾客凭完整 `partnerNo` 或卡片落地发起）；兼职不能发起绑定、不能代绑/导入顾客、不能替顾客点绑定；兼职只能解绑（填原因）。代客下单（D12）不产生绑定。详见 §1/§2 D4/§4.2/§10。
6. **开发者账号切换账号（四次修订）**：小程序**不能切换登录微信账号**（平台限制）；应用内提供**账号切换**——真实账号=只读（原只读视角），**测试账号=可写**（供一个微信号单机验收顾客/兼职两端；测试账号与真实账号严格隔离）。详见 §1.2/§1.3/§2 D18。
7. **同寝室标识恒大写（四次修订）**：`roomTag` 用大写字母 `A…Z`、`AA…`（Excel 列名式；恒大写即始终大写）；展示 `D4-522A`。详见 §3 D7。
8. **微信头像与微信昵称（四次修订）**：顾客与兼职**均采集微信头像（`chooseAvatar`）与微信昵称（`nickname` 输入）**；昵称必填、可改、可手填；头像可拒绝→默认头像、不阻断；**绑定双方可见对方头像/昵称**；后台默认脱敏（不展示头像）、分享卡片不含头像昵称。详见 §3/§4/§10/§11 D19。

**明确不做（本期）**：任何金钱/支付/收费/运费/价格相关；地图路线规划；自动派单/多兼职抢单市场；多校区；评分评价（P2）；快递公司接口/电子面单；原生客服 IM（用订单留言 + 订阅消息/红点）；**真实账号的可写视角**（禁止；只有测试账号可写，见 §1.3）；**小程序内切换登录微信账号本身**（平台不支持，只能换微信登录）；**测试账号与真实账号互绑/互下单**（严格隔离）；**客户端直连任何第三方 AI/外部网关**（API Key 只允许存在云函数环境变量）；**把原图直传第三方**（DeepSeek 当前无视觉能力，原图只留私有云存储供内部复核）；用 AI 结果替换用户手填（AI 只做预填建议，手填优先）。

---

## 1. 角色与账号

| 角色 | 定义 | 准入 | 数据范围 |
| :-- | :-- | :-- | :-- |
| **顾客 customer** | 需要代取/代寄的在校学生 | 微信登录即获得顾客身份；**资料完整（苑/楼栋/宿舍号 + 昵称）后**才能下单 | 自己的资料与订单；所绑定兼职的公开资料（**头像/昵称**/服务类型/接单状态/服务范围/兼职编号）；自己的 roomTag |
| **兼职人员 partner** | 实际跑站点取件、送达的学生兼职 | **必须凭开发者发放的邀请码激活**；无自助注册入口 | 绑定自己的顾客资料（**头像/昵称**+宿舍身份+尾号+roomTag+顾客编号）、自己的订单（含代客下单）、自己的服务类型/范围配置与单量统计 |
| **开发者 developer（admin）** | 项目开发者本人（MVP 1 个；白名单可配多个） | openid 进云函数环境变量 `ADMIN_OPENIDS` 白名单映射（不进代码/前端/数据库）；无自助注册与提权入口 | 邀请码全量、后台用户/订单/绑定/审计总览（**默认脱敏**）、全局配置、兼职状态、异常工单；**只读视角**下可查看任一 ACTIVE 顾客/兼职看到的页面与数据（审计）；**账号切换**（真实账号只读 / 测试账号可写，§1.3） |

- **同一 openid 可同时是顾客与兼职**：身份可切换，但两套数据严格按角色/归属隔离。
- 兼职身份被停用/撤销后：登录只看到"已停用"提示与联系方式，看不到任何业务数据；名下未完成订单转异常由开发者处理。
- **开发者账号不是顾客/兼职业务身份**：开发者 openid 默认不创建顾客资料、不激活兼职（避免测试数据污染统计与真实订单）。要看两端真实数据用**只读视角**（§1.2）；要**真实操作**两端用**测试账号可写切换**（§1.3，单机即可）；如需真实微信号双机验收，用第二/第三微信号走普通流程。
- 顾客注销：见 §11.4。

### 1.1 开发者账号（admin）定义与能力

1. **身份**：`ADMIN_OPENIDS` 为 JSON 映射（环境变量，值形如 `{"<openid>":"DEV-01"}`），启动/每次请求校验；`developerNo` 由映射给出（MVP 建议 1 个 `DEV-01`，可配多个 `DEV-02…`，一个 openid 对应一个编号）。开发者编号只用于后台抬头与审计，**不是登录凭据**。**不同开发者各自微信登录、各自独立会话与审计（`admin_view_sessions` 按 `adminOpenid` 隔离）；应用内不支持切换开发者微信账号本身（平台限制，换人需换微信登录）。**
2. **邀请码生效控制（核心职责）**：
   - 生成：单个/批量（单批 ≤50）；有效期可选 24 小时 / 72 小时 / 7 天 / 30 天（默认 7 天）；备注 ≤50 字；生成后整批可复制。
   - 失效控制：仅 `UNUSED` 可作废（`REVOKED`）；已使用/已过期不可作废；过期由 `cleanup` 置 `EXPIRED`；**不存在"重新生效"**（需重新发码）。
   - 查看：状态（`UNUSED/USED/REVOKED/EXPIRED`）、批次、创建时间/人、有效期、使用人（兼职编号+昵称）与使用时间。
   - 全部操作写 `admin_audit`（`INVITE_CREATE/INVITE_REVOKE`）。
3. **后台数据查看（只读为主）**：
   - 顾客列表/详情（按顾客编号/宿舍/昵称搜索）；兼职列表/详情（按兼职编号搜索）；订单总览/详情/异常工单；绑定关系；单量统计；审计日志。
   - **默认脱敏**：列表与后台详情中取件码打码、手机尾号仅显示后 2 位、宿舍只显示苑+楼栋（房间号打码）、不显示 openid；后台不提供完整手机号（系统本就不收集）。
   - **完整 L3 数据（取件码/尾号/门牌/截图）只能通过只读视角查看**（§1.2，带审计）；后台不提供"显示完整"按钮。
   - **例外（v0.8，用户三次修订）**：**识别失败复核页**（`pkg-admin/pages/recognition-review/index`）可按单查看**该失败记录的原图**（临时 URL 5 分钟 + 每次审计 `FAILURE_IMAGE_VIEW`），仅用于排查识别问题；**不提供批量查看/下载/导出**，非失败单原图仍只能走只读视角。
4. **治理动作**：兼职停用/恢复（`admin.setPartnerStatus`；**`CLOSED` 注销为运维兜底能力、后台页面不提供入口，级联语义见 DATA_MODEL §8**）；异常订单介入取消（`order.cancel` 由 ADMIN 执行：原因必填+审计；**不代顾客确认送达、不创建订单、不修改订单归属**）；全局配置（服务类型模板/苑名/公告/超时/留存期限/切换会话时长/头像大小）；维护模式。
5. **不可做**：删除订单；改状态（除异常介入取消）；作为顾客下单/作为兼职接单；导出完整个人信息；查看/写入 openid；把邀请码给别人长期复用。
6. **审计**：`admin_audit` 记录 `adminOpenid + developerNo + action + target + detail + at`；后台总览内嵌审计区块（MVP 不单独建页，P1 可拆）。
7. **账号切换（v0.9，用户四次修订）**：统一入口「切换账号」；**真实账号只读**（=§1.2 只读视角）、**测试账号可写**（=§1.3）。账号切换页同时提供测试账号管理（新建/查看/删除/清理数据）；全部动作审计。

### 1.2 开发者只读视角切换（真实账号，核心职责；账号切换见 §1.3）

**一句话**：开发者可在后台选择任一 ACTIVE 顾客/兼职，**以该用户的视角只读进入**其页面与数据；顶部常驻黄条、所有写操作被前端禁用且服务端拒绝，全程审计。

- **入口**：后台总览 →「切换账号」→ 真实账号（只读）→ 选择角色（顾客/兼职）→ 按完整编号搜索或从列表选人 → 开启。
- **票据**：`admin.viewAsStart({role, targetNo, mode='READONLY'})` 校验白名单 → 生成随机 `viewTicket`（32 位，不可猜）落 `admin_view_sessions`（`_id=ticket`，`adminOpenid/developerNo/role/targetId/targetNo/targetDisplayName/targetAvatarFileId/targetIsTest/viewMode/createdAt/expiresAt/endedAt`）→ 客户端**仅存内存**（`app.globalData.viewContext`，不写本地存储）→ `reLaunch` 到目标角色首页。**真实账号只允许 `READONLY`；`TEST_WRITE` 仅用于测试账号（§1.3），对真实账号传 `TEST_WRITE` 返回 `FORBIDDEN`。**
- **有效期**：默认 30 分钟（`config.viewTicketTtlMinutes` 可配 5~60）；同一开发者同时只有一个有效票据（新开覆盖旧的，旧票据立即失效）；`cleanup` 每日清理过期/结束超过 7 天的会话。
- **页面表现**：目标角色三 tab（顾客：首页/订单/我的；兼职：工作台/客户/我的）+ 所有页面顶部常驻黄条：`开发者只读视角 · 顾客 C-XXXX-XXXX 小王 · 退出`；黄条不可关闭、不遮挡状态栏；`custom-tab-bar` 按 `viewContext.role` 渲染。**只读视角下隐藏所有页面的分享/转发/长按保存入口**（防止把他人资料或页面转出去）；截图仍按目标本人权限展示。
- **读范围**：与目标本人一致（顾客=本人资料/订单/绑定兼职公开资料；兼职=绑定自己的顾客/订单/配置/统计），**头像/昵称按目标可见范围返回**。**服务端按 `viewTicket` 将身份解析为目标**，返回同 DTO。只读视角下 `user.bootstrap` 返回目标上下文（`isDeveloper=false`、携带 `viewContext`），避免客户端再次分流到后台。
- **写限制**：真实账号只读会话（`viewMode=READONLY`）下，顾客/兼职的一切写动作（下单、取消、确认、接单、取件、送达、留言、绑定、配置、注销……）：前端按钮置灰/隐藏并提示"开发者只读视角不能操作"；服务端见只读票据即返回 `FORBIDDEN`（**双保险**）。开发者后台自己的写动作（邀请码/停启用/配置/切换开启结束）不受影响。
- **只读视角允许的读接口**（服务端登记白名单）：`user.bootstrap`（返回目标上下文）、`customer.getProfile`、`partner.listBindings`、`bind.getCurrent`、`order.get`、`order.listCustomer`、`order.listPartner`、`message.list`、`order.imageUrl`、`config.getPublic`；其他一概拒绝。
- **结束**：黄条「退出」→ `admin.viewAsEnd`（票据置 `endedAt`）→ 清内存 → `reLaunch` 回「切换账号」页（可从该页再切到其他账号）。冷启动/杀进程会丢失票据（需重新开启）；本地不落盘。
- **限制**：不能查看开发者自己/其他开发者；只能选 ACTIVE 顾客与 ACTIVE 兼职（停用/注销不可选）；目标不存在返回 `NOT_FOUND`（不区分"编号存在但非 ACTIVE"到可枚举程度，统一"该用户当前不可查看"）。**真实账号会话只读、不可升级为可写**。
- **审计**：**所有切换会话统一用 `ACCOUNT_SWITCH_START / ACCOUNT_SWITCH_END / ACCOUNT_SWITCH_EXPIRED`**（`detail={viewMode,targetNo,targetIsTest}`，只读/测试可写靠 `viewMode` 区分）；票据过期自动记 `ACCOUNT_SWITCH_EXPIRED`（cleanup 或下次请求时落一条）。**旧名 `VIEW_AS_*` 作废，不再写入新日志**（历史日志读取时兼容映射）。
- **裁决点 D14**：**真实账号**默认**只读**（推荐）；可写切换**只适用于测试账号**（D18）；"真实账号可写视角/测试沙箱化真实数据"不做。

### 1.3 开发者账号切换（v0.9 新增，用户四次修订）

**平台限制（先写清楚）**：微信小程序**无法切换登录的微信账号**，也没有"切换账号"平台能力。这里的"切换账号"= 应用内**账号代理切换**：开发者以某个账号的身份进入小程序（读或读写），不是换微信登录。

**目标账号两类**：
1. **真实账号（ACTIVE 顾客/兼职）**：**只读**（=§1.2 只读视角）。用于排查真实用户问题；不可写、不可代操作。
2. **测试账号**：开发者后台创建的**合成账号**（`users.isTestAccount=true`，`_id='TEST-…'`，**无真实微信 openid**），可**可写切换**（`viewMode=TEST_WRITE`），用于**一个微信号单机验收顾客/兼职两端**的真实操作（下单→接单→取件→送达→确认）。

**测试账号规则**：
- 创建：后台「切换账号」页 → 测试账号 tab → 新建（选角色、填昵称；系统生成 `customerNo`/`partnerNo` 与 **合成 `openid='TEST-<random>'`**，同一合成值写入 `users._id`、`customers._id`/`partners.openid`，保证唯一索引与 1:1 关系成立；**永不写入真实微信 openid**）；不消耗邀请码、不走激活流程、不进入真实用户可见列表；每位开发者每角色 **≤3 个、合计 ≤6 个**；昵称建议以"测试-"开头（不强制）。
- 默认数据：默认头像（不采集微信头像，因为无真实微信资料）；测试兼职默认服务配置全开、范围=全部苑、`acceptingOrders=true`（便于直接验收）；测试顾客默认资料完整（可改宿舍号用于演示 roomTag）。
- **隔离铁律**：测试账号**只能与测试账号**建立绑定/下单/留言；真实账号**不能**绑定测试兼职、**不能**把订单下给测试兼职；测试账号也不能绑定真实兼职。**测试数据 `orders.isTest=true` 由服务端按参与账号派生（禁止客户端传）**。违反返回 `FORBIDDEN`（文案"测试账号与真实账号不能互相绑定"）。
- **身份传播（关键）**：`TEST_WRITE` 下云函数同时持有 `actorOpenid`（真实开发者 openid，用于白名单/会话/审计）+ `effectiveOpenid`（测试账号合成 openid，用于业务身份）；`upload_tickets.openid`、`order_messages.fromId`、`order_events.actorId`、业务限流键 `rl:{scope}` 均用 **effectiveOpenid**；`admin_audit.adminOpenid`、切换开启限流、白名单校验用 **actorOpenid**；任何写动作必须 `targetIsTest=true` 且 `viewTicket.targetId === effectiveOpenid` 交叉校验，不一致 `FORBIDDEN`（防票据挪用）。
- **TEST_WRITE 写白名单**：允许 `customer.saveProfile`、`partner.saveProfile/saveServiceConfig`、`bind.create/release`（仅测试×测试）、`order.*`（创建/接单/取件/送达/取消/确认/改码/撤销）、`message.send`、`upload.prepare`（TICKET/AVATAR）；**禁止** `admin.*`（后台治理不受会话影响）、`partner.activate`、`user.deleteAccount`、`ai.parseParcel`（测试走手填，避免消耗 AI 配额）；白名单外一律 `FORBIDDEN`。**读动作**：默认同 §1.2 只读白名单，`TEST_WRITE` **额外放行 `partner.getPublic`**（TEST_WRITE 内预览兼职：目标为测试账号时仅该会话可见，真实顾客仍 `NOT_FOUND`；READONLY 不放开）。
- **写行为**：以目标测试账号身份执行；`orders.isTest=true`、`orders/order_events` 记 `impersonatedBy=developerNo`；后台订单列表默认**过滤测试数据**（可切换查看）；`stats`/单量统计**排除测试账号与 `isTest` 订单**；后台红点不计测试数据。
- **后台列表口径**：顾客/兼职列表默认**排除测试账号**（可切换"含测试账号"查看并带「测试」标签）；测试账号**不可执行真实治理动作**（停用/解绑/通知等仅测试内部生效）。**行标签用中文「测试」；`TEST` 字面量/角标只允许在客户端 `test-badge` 组件（ARCHITECTURE §3.5、门禁 #31），后台页面零 `TEST` 引用。**
- **页面表现**：目标角色三 tab 正常可用；顶部常驻**蓝色测试条**：`测试账号 · 顾客 C-…（测试） · 由 DEV-01 切换 · 退出`；页面右上角常驻 `TEST` 角标；所有页面隐藏分享/转发入口。
- **入口/结束**：后台总览 →「切换账号」→ 测试账号 tab → 选择账号 → 确认（说明"将写入测试数据，不影响真实用户"）→ 进入；蓝条「退出」→ 回「切换账号」页。**切换会话默认 30 分钟**（`viewTicketTtlMinutes`，5~60 可配）；同一开发者同时只有一个切换会话（新开覆盖旧的）。
- **测试账号管理**：新建/查看（编号、昵称、角色、最近使用）/删除（连同测试数据与头像）；`deleteTestAccount`/`purgeTestData` 必须**双条件**（`isTestAccount` + 关联数据 `isTest`）+ **dry-run 计数** + 二次确认 + 审计前后条数，**发现任何真实数据引用即拒绝**；**删除测试账号时必须把该账号相关活跃会话置 `endedAt` 并记 `ACCOUNT_SWITCH_END`**。
- **清理**：cleanup 每日清理**超过 30 天未使用**的测试账号数据（账号保留、数据清空并记审计）；测试账号不计入任何统计、邀请码、隐私主体清单。
- **审计**：`ACCOUNT_SWITCH_START`（`detail={viewMode,targetNo,targetIsTest}`）/`ACCOUNT_SWITCH_END`/`ACCOUNT_SWITCH_EXPIRED`；测试账号管理 `TEST_ACCOUNT_CREATE/TEST_ACCOUNT_DELETE/TEST_DATA_PURGE`；测试写动作的订单/事件记 `impersonatedBy`，后台可按 `developerNo` 追溯。
- **安全边界**：测试账号只能由白名单开发者创建/切换；`TEST_WRITE` 会话写接口必须校验"目标 `isTestAccount=true`"；不允许把测试账号的 `partnerNo` 分享给真实顾客（`partner.getPublic` 对测试账号返回 `NOT_FOUND`）；不允许把测试账号加入真实用户搜索结果。
- **裁决点 D18**：推荐"真实账号只读 + 测试账号可写"（A）；备选 B"真实账号也可写"（**不做**，隐私与审计风险高）、C"仅真实账号只读、不提供测试账号"（无法单机验收两端）。

---

## 2. 核心架构（D1~D22 见 §13）

- **D1 后端 = 微信云开发（云函数 + 云数据库 + 云存储）**。跨设备数据（订单、绑定、roomTag、邀请码、只读视角票据）必须有服务端；云开发零自建运维、openid 天然身份、与小程序同生态。**不接受"纯本地无后端"**。**用户 2026-10-22 追加约束：账号只能开通 1 个云环境 ⇒ v4 采用单环境部署**——develop/trial/release 三档共用同一 envId；测试数据靠测试账号/`isTest` 标记隔离，并在上线前 `admin.purgeTestData` 清零；`config/env.js` 保留 envVersion→envId 映射形状，将来可开第二环境时只改该文件拆回 dev/prod（详见 `docs/V4_DECISIONS.md` D1 修订留痕）。
- **D2 appid = `wxcb7e5b41b89bc806`**（**用户 2026-10-22 裁决：沿用 v3 appid**，与推荐的新 appid `wxf98c87a293092ef5` 不同）。因此：v4 与 v1/v2/v3 **同一 storage 命名空间**，v4 只读写自己的 `ex_college_v4.store`，**不读写** v1/v2/v3 任何本机键；云开发环境按 D1 修订采用**单环境**（见 D1）；**发布 v4 即替代 v3（同一个小程序）**，v3 仅作历史只读参照；隐私声明/类目/审核在同一 appid 上重新提交（不再享有"独立审核"）。
- **D3 兼职准入 = 邀请码**（开发者后台生成：一次性、可设有效期、可作废、可审计）。激活成功即把 openid 绑定为 partner 并分配 `partnerNo`；换微信号需开发者重新发码。**测试账号不走邀请码**（由后台直接创建，§1.3）。
- **D4 绑定关系 = 一个顾客同时只绑定一个兼职（1:1 active）**；**绑定只能由顾客发起**（凭完整 `partnerNo` 或卡片落地）：顾客可换绑（无进行中订单时）；兼职可解绑顾客（填原因并通知），但**兼职不能发起/代绑/导入顾客**；历史订单保留。详见 §4.2 铁律。
- **D5 服务 = 只定义"服务类型"（标准代取/送寝上门/加急代取/代寄/其他代办），不含价格、不做定价权、不做运费**。开发者给默认类型模板，兼职在服务配置里启用/停用并设接单范围。**用户已定，无定价口径（v0.7 关闭原"兼职定价"方案）**。
- **D6 金钱 = 零交易**：不做在线支付、收款、记账、结算、运费计算、价格表与任何金额字段。**用户已定（v0.7 关闭）**。原 v0.6 的"线下收款记账/payStatus/结算文本"全部删除。
- **D7 roomTag 区分标识 = 服务端分配、独立字段 `roomTag`**，作用域 = **（兼职, 宿舍）**：同一兼职名下同一 `dormKey` 的顾客按绑定顺序得 **A、B、C…（恒大写，Excel 列名式）**；展示 `D4-522A`；换宿舍重新分配，旧标签不复用。**v0.9：恒用大写字母（用户四次修订）。**
- **D8 "五个苑" = v3 的 D/X/N/B/C 五个楼区字母**（固定顺序）。**用户 2026-10-22 裁决展示名：D=东苑、X=西苑、N=南苑、B=北苑、C=翠苑**（C 的含义=翠苑）；默认值已写进 `shared/zones.js`，`config.zoneLabels` 可覆盖（后台 `admin.updateConfig`）。
- **D9 截图 = 压缩后上传云存储私有目录**，仅订单双方经云函数鉴权后的临时 URL 可见；完成/取消后 **7 天**删除；截图不出现在通知、日志、分享卡片。
- **D10 通知 = 站内实时（轮询 + 红点 + 下拉刷新）必做**；微信订阅消息 P1（模板 ID 进 `config`，不硬编码）。
- **D11 v3 数据 = 不迁移**，v4 空库起；v3 旧小程序留作只读参照。确需手工导入另立卡。
- **D12 兼职"代客下单"保留**（覆盖没有用 app 的顾客）：兼职可用 v3 录入能力给未绑定顾客建单；**代客下单不产生绑定**，分享绑定卡片只是"邀请顾客来绑"，绑定动作必须顾客本人完成。详见 §4.2。
- **D13 主体与类目**：**用户 2026-10-22 裁决：个人主体 + 工具类目**。提审批次需在微信后台确认该主体可选类目与本产品匹配（"校园快递代取的信息与履约工具"表述，不做快递业务经营表述）；若类目不可选或被驳回，按"换子类目→调整描述→企业主体→仅体验版"顺序处理（**提审风险项**，不影响已完成的工程实现；详见 `docs/V4_DECISIONS.md` D13 留痕）。
- **D14 开发者只读视角（真实账号）**：只读代理 + 审计 + 黄条 + 服务端拒写；**可写切换只给测试账号**（D18）。
- **D15 唯一编号样式**：顾客 `C`+8 位（`C-XXXX-XXXX`）、兼职 `P`+6 位（`P-XXX-XXX`）、开发者 `DEV-01`（白名单可配 `DEV-02…`，各自微信登录）；服务端随机生成、全局唯一、不可修改。
- **D18 账号切换（v0.9）**：真实账号只读、**测试账号可写**（后台创建合成账号，单机验收两端；测试数据隔离/标记/清理）。见 §1.3。
- **D19 微信头像与昵称（v0.9）**：顾客/兼职均采集微信头像（`chooseAvatar`）与微信昵称（`nickname` 输入）；昵称必填可改、头像可拒绝→默认头像；**仅绑定对方可见**；后台不展示头像、卡片不含。见 §3/§4/§11。

---

## 3. 术语与字段口径（唯一拼写，文档/代码同字典）

| 术语 | 代码名 | 口径 |
| :-- | :-- | :-- |
| 五苑/楼区 | `zone` | 枚举 `'D'|'X'|'N'|'B'|'C'`；固定顺序 D→X→N→B→C；**恒大写落库**（输入容错后统一转大写） |
| 楼栋号 | `buildingNo` | 整数 1~10（v3 裁决）；展示 `D4` 里的 `4` |
| 楼栋文本 | `buildingText` | `zone+buildingNo`，如 `D4` |
| 宿舍号 | `room` | 规范数字串，≥100（v3 `DORM_MIN`）；如 `522` |
| 宿舍键 | `dormKey` | `zone+buildingNo+'-'+room`，如 `D4-522`；分组/唯一性用它 |
| 同寝室标识 | `roomTag` | **大写字母 A…Z、AA…**（Excel 列名式，**恒大写**=始终大写）；由服务端按（兼职, dormKey）分配；展示 `D4-522A` |
| 手机尾号 | `phoneTail` | `''` 或恰好 4 位数字；**可选**；永不收集完整手机号 |
| 昵称/展示名 | `displayName` | ≤20 字，**必填**（顾客/兼职均有；首次从微信昵称一键填入，可改、可手填）；用于列表锚与订单双方展示 |
| 头像 | `avatarFileId` | 云存储 fileID（`avatars/{role}/{random}.jpg`，≤200KB）；可空→默认头像；**仅本人与绑定对方可见**；后台不展示 |
| **顾客编号** | `customerNo` | `C` + 8 位 32 字母表；展示 `C-XXXX-XXXX`（如 `C-7K2M-9QX4`）；唯一、不可改；见 §3.1 |
| **兼职编号** | `partnerNo` | `P` + 6 位 32 字母表；展示 `P-XXX-XXX`（如 `P-7K2-M9X`）；唯一、不可改；顾客凭完整编号绑定；见 §3.1 |
| **开发者编号** | `developerNo` | `DEV-01`（白名单可配多个：`DEV-02`…，一个 openid 一个编号）；仅后台/审计显示 |
| **测试账号** | `users.isTestAccount` | 布尔，`true`=开发者后台创建的合成账号（`_id='TEST-…'`、无真实 openid）；只能与测试账号互通；不计统计；见 §1.3 |
| 驿站/取件点 | `stationId` + `stationName` | v3 内置 P1~P8 正式名 + 别名归一；订单**同时存 id 与名称快照** |
| 取件码 | `pickupCode` | ≤40；形态闸沿用 v3 规则 |
| 柜号 | `lockerNo` | ≤10，可空 |
| 运单尾号 | `trackingTail` | 恰好 5 位数字，可空 |
| 需查明 | `codeStatus` | `'OK'` / `'NEED_CODE'`；`NEED_CODE` 时订单可建但兼职要补齐 |
| 邀请码 | `invitationCode` | 12 位 32 字母表，展示分 3 组 `XXXX-XXXX-XXXX`；落库去横杠大写；一次性；旧称"激活码"即本词 |
| 订单号 | `orderNo` | `YYYYMMDD-XXXX`（当日全局序号，服务端生成）；双方可见 |
| 服务类型 | `serviceCode` / `serviceName` | 默认：`PICKUP_STD` / `PICKUP_DOOR` / `PICKUP_URGENT` / `DROP_OFF` / `CUSTOM`；**只有类型名称与说明，无价格** |
| 幂等键 | `clientRequestId` | 客户端生成 16~32 位；所有写动作必传；服务端去重 |
| 账号切换票据 | `viewTicket` | 32 位随机；仅开发者切换会话（`viewMode='READONLY'|'TEST_WRITE'`）；内存保存；默认 30 分钟；兼容旧称"只读视角票据" |
| 站点正式名 | — | 直接复用 v3 `utils/stations.js` 的 P1~P8 与别名归一 |

**金额**：本程序**不存在**金额字段、金额计算与金额文案；任何文档/代码出现 `*Fen`、`price`、`fee`、`pay`、`金额`、`价格`、`运费`、`收款`、`结算` 均为缺陷（工程门禁扫描项，见 `docs/V4_ENGINEERING.md`）。
**时间**：服务端 `Date`（云函数 `new Date()`）；客户端只做格式化；所有"今天/昨天"以服务器返回的 `serverTime` 为准。

### 3.1 唯一编号规格（v0.7 新增，双角色不同样式）

| 角色 | 字段 | 组成 | 展示样式 | 示例 | 校验（去空白/连字符、转大写后） |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 顾客 | `customers.customerNo` | `C` + 8 位 | `C-XXXX-XXXX`（4+4 分组） | `C-7K2M-9QX4` | `^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$` |
| 兼职 | `partners.partnerNo` | `P` + 6 位 | `P-XXX-XXX`（3+3 分组） | `P-7K2-M9X` | `^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$` |
| 开发者 | `developerNo` | 固定可读 | `DEV-01` | `DEV-01` | 由白名单映射给出，不参与用户输入 |

**规则（硬）**：
1. **服务端生成**：加密安全随机（不取自 openid、不自增、不按注册顺序）；唯一索引兜底；碰撞重试 ≤5 次，仍失败返回 `DEPENDENCY_FAILED`。
2. **不可修改、不复用**：生成后无任何动作可改；注销后编号作废，不再分配（随机空间足够大，不设回收）。
3. **两种样式必须一眼可分**：前缀不同（C/P）、长度不同（8/6 位）、分组不同（4+4 / 3+3）；输入容错（空格、连字符、全角）但**前缀必填**。
4. **错前缀提示**：顾客输入 `C…` 去绑定 → "这是顾客编号，请向兼职索取 P 开头的兼职编号"；输入 `DEV…` → "这是开发者编号，不能用于绑定"；格式不符 → 通用"兼职编号是 P 开头、共 6 位字母数字，请核对"。
5. **用途不同**：`customerNo` 只用于识别/客服/后台搜索，**不作为登录或绑定凭据**，仅本人、其绑定兼职、开发者可见；`partnerNo` 是顾客绑定的**唯一凭据**（完整编号），可分享卡片，但永不提供搜索/列表/枚举接口、限流 5 次/日/顾客。
6. **展示**：顾客"我的"显示自己的编号（可复制）；兼职"我的"显示自己的编号（可复制/分享绑定卡片）；订单详情小字显示对方编号（顾客看兼职编号、兼职看顾客编号）；后台列表/详情显示编号、**不显示 openid**；分享卡片只带 `partnerNo`，不带宿舍/尾号/称呼。
7. **生成时点**：`customerNo` 在顾客资料首次创建成功时生成（`user.bootstrap`/`customer.saveProfile` 内保证幂等）；`partnerNo` 在邀请码激活成功、创建 `partners` 文档时生成。

---

## 4. 数据模型（集合级摘要，字段级见 `docs/V4_DATA_MODEL.md`）

| 集合 | 主键 | 关键字段 | 说明 |
| :-- | :-- | :-- | :-- |
| `users` | `_id=openid`（测试账号 `_id='TEST-…'`） | `roles[]`（CUSTOMER/PARTNER）、`status('ACTIVE'|'DEACTIVATED')`、`isTestAccount`（默认 false）、`createdByDeveloperNo?`、`createdAt`、`lastLoginAt`、`messageReadAt`、`privacyConsent{version,at}`、`deletionRequestedAt` | 账号层：真实账号一个 openid 一条；测试账号=合成账号（无 openid、仅开发者可切换、不计统计）；角色标记（DEVELOPER 不落库） |
| `customers` | `_id=openid` | **`customerNo`(唯一)**、**`displayName`(昵称，必填)**、`avatarFileId`（可空→默认头像）、`zone/buildingNo/room/dormKey`、`phoneTail`、`profileCompleted`、`createdAt`、`updatedAt` | 顾客资料；宿舍身份；昵称/头像；唯一编号 |
| `partners` | 自增 | `openid`(唯一；测试账号为合成 `TEST-<random>`)、**`partnerNo`(唯一)**、**`displayName`(昵称，必填)**、`avatarFileId`（可空→默认头像）、`status('ACTIVE'|'SUSPENDED'|'CLOSED')`、`deletedAt`、`serviceConfig{...}`（字段以 §4.2/§6 为准）、`stats{...}`、`activatedAt` | 兼职资料、头像/昵称、服务类型/范围配置、单量统计 |
| `bindings` | 自增 | `activeKey`(唯一)、`customerId=openid`、`partnerId`、`status('ACTIVE'|'RELEASED')`、`roomTag`、`dormSnapshot{...}`、`partnerNote`、`releaseReason`、`releaseNote`(≤100)、`boundAt`、`releasedAt` | 绑定关系 + roomTag + 兼职私有备注；**只能由顾客发起创建**（§4.2） |
| `orders` | 自增 | `orderNo`(唯一)、`requestKey`(唯一)、`customerId`/`customerOpenid`/**`customerNo`快照**/`partnerId`/`partnerOpenid`/**`partnerNo`快照**、`source('CUSTOMER'|'PARTNER')`、`isTest`(bool，测试数据标记)、`impersonatedBy?`(测试写时的 `developerNo`)、`status`、`parcel{...}`、`dorm{...}`、`guest{...}`(代客单)、`service{code,name}`、`appoint{...}`、`note`、`image{fileId,...}`、`exception{...}`、`deliveryNote`、`cancelReason`、`cancelledBy`、`deletedByCustomerAt`、`anonymizedAt`、显式时间戳、`batchActionId`、`clientRequestId`、`version` | 订单主表；**无任何金额字段** |
| `order_events` | 自增 | `orderId`、`orderNo`、`type`、`fromStatus`、`toStatus`、`actorRole`、`actorId`、`impersonatedBy?`、`at`、`note`、`payload`、`requestKey`(唯一) | 全量状态流水（审计/进度条数据源） |
| `order_messages` | 自增 | `orderId`、`fromRole`、`fromId`、`text`(≤200)、`templateCode?`、`createdAt`、`readAt` | 订单留言（含快捷模板） |
| `invitation_codes` | 自增 | `code`(唯一)、`status('UNUSED'|'USED'|'REVOKED'|'EXPIRED')`、`batchId`、`expiresAt`、`usedBy`、`usedAt`、`note`、`createdBy`、`createdAt` | 开发者发邀请码（旧 `activation_codes` 更名；测试账号不消耗邀请码） |
| `admin_view_sessions` | `_id=viewTicket` | `adminOpenid`、`developerNo`、`viewMode('READONLY'|'TEST_WRITE')`、`role('CUSTOMER'|'PARTNER')`、`targetId`、`targetNo`、`targetDisplayName`、`targetAvatarFileId?`、`targetIsTest`、`createdAt`、`expiresAt`、`endedAt` | 开发者切换会话票据（真实账号只读 / 测试账号可写，§1.2/§1.3） |
| `counters` | 自增 | `key`(唯一)、`seq`、`updatedAt`；键族：`orderNo:YYYYMMDD`、`tag:{partnerId}:{dormKey}`、`rl:{scope}:{openid}:{window}`（限流，cleanup 清理过期） | 原子自增（事务） |
| `config` | `_id='global'` | `zoneLabels`、`serviceCatalog[{code,name,desc}]`（无价格）、`announcement`、`maintenance`、`orderTimeoutMinutes`、`autoCompleteHours`、`screenshotRetentionDays`、`recognitionFailureRetentionDays`（7~30，默认 30）、`aiFallback{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}`、`viewTicketTtlMinutes`、`avatarMaxBytes`（默认 200KB）、`testAccountMaxPerRole`（默认 3）、`testDataRetentionDays`（默认 30）、`privacyVersion`、`updatedAt` | 全局配置（admin 维护，无金额项；`aiFallback` v0.8 新增，值为次数/毫秒/布尔，**无费用字段**；v0.9 新增头像与测试账号配置） |
| `admin_audit` | 自增 | `adminOpenid`、`developerNo`、`action`、`target`、`detail`、`at` | 管理操作审计 |
| `upload_tickets` | 自增 | `ticket`(唯一随机)、`openid`（TEST_WRITE 下=effectiveOpenid）、`purpose('TICKET'|'AVATAR')`、`cloudPath`（不含 openid）、`expiresAt`、`usedAt`、`createdAt` | 截图/头像上传票据（§4.1） |
| `recognition_failures` | 自增 | `failureNo`(唯一)、`requestKey`(唯一：`{uploaderOpenid}:{clientRequestId}`，写动作幂等)、`failureCode`、`sourceRole('CUSTOMER'|'PARTNER')`、`uploaderOpenid`、`uploadTicketId`、`fileId`、`orderId?`、`ocrTextMasked`(≤2000)、`ruleResult`、`aiTried`、`aiModel`、`aiResult`、`aiErrorCode`、`status('PENDING'|'FIXED'|'IGNORED')`、`resolution{stationId,stationName,pickupCode,note,by,at}`、`createdAt`、`reviewedAt` | 识别失败复核队列（v0.8，含原图引用；仅开发者后台可见，审计；§4.3） |

**`orders` 补充字段**：`cancelReason`、`cancelledBy('CUSTOMER'|'PARTNER'|'SYSTEM'|'ADMIN')`、`deletedByCustomerAt`、`deliveryNote`(≤100)、`exception{code,text,fromStatus,by,at}`、`batchActionId`、`version`、`isTest`（测试数据标记，快照自参与账号）、`impersonatedBy`（测试写会话的 `developerNo`，真实流程为空）。**订单无 `fee`/`addons`/任何金额字段**。
**`users` 补充字段**：`messageReadAt`（消息中心红点已读水位）、`isTestAccount`（默认 `false`）、`createdByDeveloperNo`（测试账号创建者，真实账号为空）、`testLastUsedAt`（测试账号最近使用，供 30 天清理）。
**`customers`/`partners` 补充字段**：`displayName`（昵称，必填，≤20 字）、`avatarFileId`（可空→默认头像）、`profileUpdatedAt`。
**消息中心数据源**：MVP **不新增** `notifications` 集合；消息中心 = 服务端聚合视图（`order_events` 状态类事件 + `order_messages` + 公告），`users.messageReadAt` 记录已读水位。

**数据隔离铁律**
1. 客户端**不直接读写数据库集合**（安全规则全部拒绝客户端读写）；一切经云函数 `api`。截图上传走云存储签名路径 ticket（见 §4.1）。
2. 云函数从 `cloud.getWXContext().OPENID` 推导身份；**客户端传来的 customerId/partnerId/编号只当查询条件，绝不当身份**。
3. 任何返回顾客/订单数据的云函数，查询条件必须包含"当前身份可合法访问的范围"（顾客=自己；兼职=自己的 partnerId；开发者=白名单+后台脱敏；切换会话=票据解析出的目标身份，`READONLY` 只读、`TEST_WRITE` 仅测试账号），越权统一 `FORBIDDEN`。
4. 负向测试必须覆盖：兼职 A 查兼职 B 的订单/顾客/绑定；**兼职调 `bind.create` 绑定顾客（必须 `FORBIDDEN`）**；**自绑（同一 openid 的顾客身份绑自己的 partnerNo，必须 `FORBIDDEN`）**；顾客改 `partnerId` 查询他人订单；未激活 openid 调兼职接口；顾客枚举兼职；过期/已用/作废邀请码激活；非白名单 openid 调 admin 动作；用他人/过期 `viewTicket` 读数据；只读视角调写接口；**真实账号传 `mode=TEST_WRITE`（必须 `FORBIDDEN`）**；**真实账号与测试账号互绑/互下单（必须 `FORBIDDEN`）**；**`TEST_WRITE` 白名单外动作（如 `admin.*`/`partner.activate`，必须 `FORBIDDEN`）**；**票据 target 与 effectiveOpenid 不一致（必须 `FORBIDDEN`）**；测试数据进入统计/真实列表（必须 0）。
5. **绑定方向补充**：`bind.create` 必须拒绝自绑（`partner.openid == caller openid`）；测试账号与真实账号的绑定/下单/留言必须拒绝；`TEST_WRITE` 会话的身份必须同时满足 `targetIsTest=true` 且 `viewTicket.targetId===effectiveOpenid`。

### 4.1 截图上传（云存储私有）
1. `upload.prepare`（云函数，入参 `purpose:'TICKET'|'AVATAR'`）→ 校验身份与当日配额 → 返回 `uploadTicket`（5 分钟有效，落库 `upload_tickets`，含 `purpose`）+ `cloudPath`（含不可猜随机段，**不含 openid**）+ `draftId`。
2. 客户端 `wx.cloud.uploadFile` 到该路径。
3. 下单云函数校验 ticket 归属、路径一致、文件大小/类型（jpg/png，≤500KB），把 `fileId` 写入订单。
4. 查看：`order.imageUrl` 云函数鉴权后 `cloud.getTempFileURL`（5 分钟）。
5. 清理：`cleanup` 定时删除完成/取消超 7 天的文件；同一 fileId 被多张订单引用时（一图多码拆单）只在无引用后删。
6. **识别失败引用（v0.8）**：识别失败记录 `recognition_failures.fileId` 引用同一原图；复核期内保留 `recognitionFailureRetentionDays`（默认 30 天，长于订单截图 7 天）；到期删引用，若订单仍在截图留存期则继续按订单规则保留。
7. **头像上传（v0.9）**：`upload.prepare({purpose:'AVATAR'})` → 云存储路径 `avatars/{role}/{random}.jpg`（不可猜随机段）；客户端压缩到 **≤200KB、jpg/png、建议 200×200**；保存资料时校验 ticket 归属/路径/大小/类型后写 `avatarFileId`；**替换头像即删旧文件**；注销/删除测试账号时删头像文件；默认头像不占存储（客户端本地绘制首字色块）。**头像与截图同一套私有存储规则（客户端不可直接读，展示用 `cloud://` fileID 由 DTO 下发或临时 URL）**。

### 4.2 字段/枚举补充（字段级细节以 `docs/V4_DATA_MODEL.md` 定稿）

- `users`：`roles ∈ {CUSTOMER, PARTNER}`（**DEVELOPER 不落库**，由环境变量 `ADMIN_OPENIDS` 判定，避免改库提权）；`status ∈ {ACTIVE, DEACTIVATED}`；`messageReadAt`；`deletionRequestedAt`；`isTestAccount`（默认 false；true = 后台创建的合成账号，`_id='TEST-…'`、无真实 openid、不得与真实账号互操作、不计统计）；`createdByDeveloperNo/testLastUsedAt`（仅测试账号）。
- `customers`：`customerNo`（唯一、生成后不可改，§3.1）；`displayName`（**昵称，必填**，≤20 字，首次从微信昵称一键填入、可改/手填，保存过 `security.msgSecCheck` v2）；`avatarFileId`（可空→默认头像；`avatars/customer/{random}.jpg`，≤200KB）；`createdAt/updatedAt`；**不加** `note`（兼职私有备注放 `bindings.partnerNote`）。
- `partners`：`partnerNo`（唯一、生成后不可改）；`displayName`（**昵称，必填**，≤20 字，激活时从微信昵称一键填入、可改；`partner.saveProfile` 可改）；`avatarFileId`（可空→默认头像；`avatars/partner/{random}.jpg`，≤200KB）；`status ∈ {ACTIVE, SUSPENDED, CLOSED}`；`CLOSED`=注销（`deletedAt` + 资料匿名化、不可恢复、绑定释放、订单转异常/完成）；`serviceConfig` 见 §6；`stats` 只含单量（如 `{todayOrders,totalOrders,completedOrders}`，**无收入字段**）；`maxDailyOrders/businessHours/autoAccept` 为 P1 预留。**测试兼职**：`openid='TEST-<random>'`（合成，非真实微信 openid）、默认服务配置全开、范围=全部苑、`acceptingOrders=true`，不计统计。
- `bindings`：`activeKey`（唯一索引：ACTIVE 时 = `customerId`；RELEASED 时 = `customerId:RELEASED:bindingId`）；`partnerNote`（≤100，顾客不可见，随顾客注销删除）；`releaseReason ∈ {CUSTOMER_INITIATED, PARTNER_INITIATED, PARTNER_CLOSED, ADMIN_ACTION, CUSTOMER_ACCOUNT_CLOSED}`。
- **绑定方向铁律（v0.9，用户四次修订）**：①**只有顾客能发起绑定**：`bind.create` 仅允许业务角色为 CUSTOMER 的调用者；PARTNER 调用一律 `FORBIDDEN`；②兼职端**不得**出现"添加顾客/绑定顾客/导入顾客/扫码绑定顾客"任何入口，也不得批量建立绑定；③**代客下单不产生绑定**，`bindings` 不得由订单创建流程隐式写入；④兼职只能 `unbindCustomer`（填原因、通知顾客），解绑≠重新绑定；⑤绑定解除后，双方**不再能看到对方头像/昵称**（DTO 按 ACTIVE 绑定关系返回）；⑥测试账号只能与测试账号互相绑定，真实账号×测试账号的绑定请求一律 `FORBIDDEN`；⑦**不能自绑**：顾客的 openid 与其要绑定的兼职 openid 相同（同一 openid 兼顾客+兼职）时 `bind.create` 返回 `FORBIDDEN`（禁止自己下单给自己）；⑧`partner.getPublic` 在绑定前**只回昵称、不回头像**（头像在 ACTIVE 绑定后才下发）。
- `orders` 身份字段关系：`customerId` = openid 引用键，`customerOpenid` = 同值快照；`partnerId` = partners._id，`partnerOpenid` = 快照；`customerNo/partnerNo` = 建单/接单时编号快照（用于展示与后台搜索，不参与鉴权）；**代客单（guest）customerId/customerOpenid/customerNo 为空**；`isTest` = 参与账号 `isTestAccount` 的快照（测试数据永不计入统计）；`impersonatedBy` 仅测试写会话写入（真实流程为空）。显式时间戳：`statusUpdatedAt/acceptedAt/pickedAt/deliveredAt/completedAt/cancelledAt`。创建幂等：`requestKey` 唯一（`{customerId|partnerId}:{clientRequestId}`）；测试写会话以目标测试账号身份生成幂等键。写动作幂等：`order_events.requestKey` 唯一（`{orderId}:{action}:{clientRequestId}`）。留存幂等：`anonymizedAt`。
- **`roomTag` 触发点**：资料完整是绑定前提；`roomTag` 在**绑定成功时**分配（此时才有 partnerId）；同一（兼职, dormKey）按绑定先后得 **A、B、C…（恒大写）**；已绑定期间顾客改宿舍 → 在新 dormKey 下重新分配，旧 tag 不复用；未绑定前不分配；解绑后 tag 保留在历史绑定记录（`status=RELEASED`）不再复用。
- **代客单（D12）**：`source=PARTNER`、`customerId=''`、`customerOpenid=''`、`customerNo=''`、`guest{displayName,phoneTail,zone,buildingNo,room,dormKey}` 快照；**代客单不产生绑定**（顾客后续绑定必须本人发起）；guest 无真实微信资料 → 展示**默认头像** + "代客单"标签；MVP **不提供顾客认领**；P1 再做认领（`claimTokenHash/claimExpiresAt/claimedAt` 预留）。
- `counters`：键族 `orderNo:YYYYMMDD`、`tag:{partnerId}:{dormKey}`、`rl:{scope}:{openid}:{window}`；不设 `tagSeq`。
- **站点值域（MVP）**：只能选 v3 的 P1~P8 正式名；识别不到时顾客手动选；不做自建站点（P1）。订单存 `stationId + stationName` 快照。
- `order_events.type` 至少包含：`ORDER_CREATED / ACCEPTED / REJECTED / PICKED / PICKED_REVERTED / DELIVERED / DELIVERED_REVERTED / COMPLETED / AUTO_COMPLETED / CANCELLED / TIMEOUT_CANCELLED / EXCEPTION_REPORTED / EXCEPTION_RESOLVED / ORDER_CORRECTED / DELETED_BY_CUSTOMER / GUEST_ORDER_CLAIMED(P1)`；`actorRole ∈ {CUSTOMER, PARTNER, ADMIN, SYSTEM}`。**不含任何支付/收款类事件**。
- **留痕时间线**：订单终态 → 保留 180 天 → 匿名化（去 openid/昵称/尾号/宿舍/截图引用，写 `anonymizedAt`）→ 再 30 天物理删除；顾客对 `COMPLETED` 单条"删除记录"→ 7 天后物理删除；截图在终态/取消后 7 天删除；注销=立即匿名化+删截图+30 天内物理删除+删 `partnerNote`。
- **admin 审计**：`admin_audit.action` 至少含 `INVITE_CREATE / INVITE_REVOKE / PARTNER_SUSPEND / PARTNER_RESTORE / CONFIG_UPDATE / ORDER_ANOMALY_CANCEL / BOOTSTRAP`；**v0.8 增** `FAILURE_IMAGE_VIEW / FAILURE_FIX / FAILURE_IGNORE`（识别失败复核，§4.3）；**v0.9 增** `ACCOUNT_SWITCH_START / ACCOUNT_SWITCH_END / ACCOUNT_SWITCH_EXPIRED / TEST_ACCOUNT_CREATE / TEST_ACCOUNT_DELETE / TEST_DATA_PURGE`（`ACCOUNT_SWITCH_*` 的 `detail` 记 `viewMode/targetIsTest`；**旧 `VIEW_AS_*` 作废**）；MVP 不单独建 audit 页，审计区块并入 `pkg-admin/pages/overview/index`。
- **限流落点**：统一用 `counters.rl:{scope}:{openid}:{window}`；scope 至少 `bind/activate/order/message/viewAs/avatarUpload`；窗口按日/小时；超限返回 `RATE_LIMITED`。**账号切换（含测试账号）20 次/日/开发者；头像上传 5 次/日/人。**
- **账号切换会话**：`admin_view_sessions` 见 §1.2/§1.3；票据服务端生成、不落客户端存储；每次请求校验票据存在、未过期、`endedAt` 为空、发起人仍白名单；`viewMode=TEST_WRITE` 时额外校验目标 `isTestAccount=true`、`target.status=ACTIVE`；写请求必须同时匹配 `impersonatedBy` 与目标身份（防止票据被挪用到其他账号）。
- **邀请码字段**：`invitation_codes{code(唯一), status, batchId, expiresAt, usedBy(partnerId), usedAt, note, createdBy(developerNo), createdAt}`；`expiresAt=null` 不允许（必须设有效期）；过期判定以服务端时间。
- **只读视角/账号切换**：`admin_view_sessions` 见 §1.2/§1.3；票据服务端生成、不落客户端存储；每次请求校验票据存在、未过期、`endedAt` 为空、发起人仍白名单；`viewMode=TEST_WRITE` 时额外校验目标 `isTestAccount=true`、`target.status=ACTIVE`；写请求必须同时匹配 `impersonatedBy` 与目标身份（防止票据被挪用到其他账号）。
- **v0.6 一致性补充（继续有效）**：资料编辑规则（宿舍身份仅无进行中订单时可改，改宿舍=旧绑定释放+新绑定+新 roomTag，订单快照不变）；截图云存储路径 `orders/{ticket}/image.jpg`；接单开关语义（`serviceConfig.acceptingOrders=false` ⇒ `order.create/createBatch` 返回 `PARTNER_CLOSED`）；兼职公开预览（`partner.getPublic({partnerNo})`，未绑定可调、限流 5 次/日/顾客、**绑定前只回昵称（不回头像）**；测试账号返回 `NOT_FOUND`）；列表 DTO 分级（本人数据完整；admin 后台默认脱敏；完整值只在只读视角）；解绑原因必填；客户列表按 dormKey/roomTag 排序；工作台查询含 `SUBMITTED/ACCEPTED/PICKED/DELIVERED/EXCEPTION` 五类、`counts` 6 项；异常上报允许 `ACCEPTED/PICKED/DELIVERED`；动作登记（`bind.getCurrent`、`admin.bootstrap` 内部动作）；订阅消息模板放 `config`；邀请码错误映射（不存在/已作废→`NOT_FOUND`、已过期→`INVITE_EXPIRED`、已使用→`INVITE_USED`、格式错→`VALIDATION_FAILED`）；文本上限（`exception.text` ≤200、`lockerNo` ≤10）；隐私级别 L1/L2/L3；**收集微信头像/昵称（v0.9 变更，见 §11；原文"不收集头像"作废）**。
- **v0.8 识别兜底字段（字段名以 `docs/V4_DATA_MODEL.md` 定稿）**：`orders.parcel` 增识别来源与置信度（`recognitionSource ∈ {RULE, DEEPSEEK, MANUAL}`、`confidence?`）；`orders.image` 增 `failureId?` 关联复核队列；同一截图的多张订单**共享同一 `fileId`**；若多单都识别失败，则**每单各一条失败记录**（`failureId` 按单独立，便于逐单补录/逐单回填）。**均为可选字段，不加任何金额语义**。
- **v0.9 账号切换与测试账号字段（字段名以 `docs/V4_DATA_MODEL.md` 定稿）**：`users.isTestAccount/createdByDeveloperNo/testLastUsedAt`；`orders.isTest/impersonatedBy?`；`order_events.impersonatedBy?`；`admin_view_sessions.viewMode/targetIsTest/targetAvatarFileId`；`config.avatarMaxBytes/testAccountMaxPerRole/testDataRetentionDays`。**测试数据清理**：`cleanup` 每日清理超过 `testDataRetentionDays`（默认 30 天）未使用的测试账号业务数据（保留账号与审计摘要）；`admin.purgeTestData` 立即清空（二次确认 + 审计）；`admin.deleteTestAccount` 删账号 + 数据 + 头像。
- **v0.9 头像/昵称可见范围**：`customers/partners.displayName + avatarFileId` 只随"当前 ACTIVE 绑定关系"对对方返回（顾客看到绑定兼职的；兼职客户档案看到绑定顾客的）；**绑定前预览只回昵称、不回头像**，绑定成功后订单列表/详情、绑定确认页、客户档案展示头像+昵称；解绑/停用/注销后不再返回；通知/分享卡片/后台列表/日志**不含头像 fileId 与完整昵称**。

### 4.3 OCR 识别失败兜底与开发者复核（v0.8 新增，用户三次修订）

**触发口径**：端侧 OCR（沿用 v3 阶梯）+ 规则解析后，**站点或取件码任一缺失/不可信**（`parcel.codeStatus=NEED_CODE`、`stationId=''`、或解析结果与 OCR 文本冲突）→ 客户端调 `ai.parseParcel`（**唯一外呼出口**，云函数侧调 DeepSeek）；客户端不直连任何第三方。

**入参（最小化，客户端先过长/去敏闸）**：`{ocrTextMasked, hintTrackingTail?, uploadTicketId, role}`；`ocrTextMasked ≤2000` 字；服务端再做一次去敏（手机号/身份证/连续长数字掩码、姓名行可保留但不得带详细门牌），**只保留与站点/取件码/运单相关的短文本**。

**DeepSeek 调用口径（服务端）**：
- 端点 `https://api.deepseek.com/chat/completions`；`model=config.aiFallback.model`（默认 `deepseek-chat`，**禁止硬编码 Key**）；`temperature=0`；`response_format={type:'json_object'}`；system prompt 限定输出 JSON 字段集合。
- Key 只存云函数环境变量 `DEEPSEEK_API_KEY`（不进代码/前端/日志/数据库）；超时 8s、仅网络/5xx 重试 1 次；连续 5 次失败熔断 10 分钟；总开关 `config.aiFallback.enabled`。
- **只发去敏文本**：不发原图、不发 openid、不发订单归属；日志只记 `aiErrorCode/耗时/成功与否`，不落响应全文、不落 Key。
- 配额：`5 次/人/日` + `全局日配额`（`config.aiFallback`）；超限不调、直接进失败队列（对顾客**静默降级**，不返回 `RATE_LIMITED`）。
- 配置管理：`config.aiFallback` 在 **MVP 后台只读展示、不开放编辑**（`admin.updateConfig` 白名单不含该键；P1 再开）；改值走部署配置脚本/控制台，且必须与隐私文本同步。

**格式化返回（唯一 DTO，客户端只认这个）**：
```
{ recognized, stationId, stationName, pickupCode, trackingTail, lockerNo,
  confidence: 'HIGH'|'MEDIUM'|'LOW', source: 'RULE'|'DEEPSEEK'|'NONE',
  needsReview: boolean, failureId?: string }
```
- 字段白名单返回；`stationId` 必须 ∈ P1~P8 否则置 `''`；`pickupCode` 必须过码格式闸（去空格/连字符，4~12 位字母数字）否则置 `''`；`recognized=false` 或 `confidence=LOW` ⇒ `needsReview=true` 并写队列、返回 `failureId`。
- **合并策略**：AI 结果只做**预填建议**，用户已手填字段优先、不得覆盖；客户端仍允许手填提交（`NEED_CODE` 机制不变）。

**失败反馈（开发者账号内，含原图）**：
- **记录粒度**：失败记录以**订单 × 截图**为粒度——同一截图拆多单时，**每张缺码/缺站点的订单各一条记录**（共享同一 `fileId`，`failureId` 按单独立，便于逐单补录/逐单回填）；用户识别失败后**未建单**也保留 `orderId=''` 的记录，建单后回填对应 `orderId/failureId`。
- 入队即：后台总览红点 + `pkg-admin/pages/recognition-review/index` 首屏 `PENDING`；P1 可加订阅消息提醒（模板 ID 入 `config`）。
- 复核页：**原图**（鉴权临时 URL 5 分钟，每次查看审计 `FAILURE_IMAGE_VIEW`）、失败码、来源角色、上传人（编号/昵称脱敏，**不展示头像**）、`ocrTextMasked`、DeepSeek 尝试结果/错误码、关联订单（若有）、时间。
- 开发者动作：①查看原图（审计）②**补录站点/取件码**→ 回填关联订单 `parcel.stationId/stationName/pickupCode`（**不改订单状态、不代确认、不创建订单、不改归属**；审计 `FAILURE_FIX`）③标记忽略（备注必填；审计 `FAILURE_IGNORE`）④通知上传者：**不单拆动作**，作为 `fixRecognitionFailure`/`ignoreRecognitionFailure` 的可选参数 `notifyUploader:true`（站内消息必做，订阅消息 P1）。
- 原图可见性：仅白名单开发者在复核页、临时 URL、单次审计；不进顾客/兼职页面；**不提供批量/下载/导出**。
- 保留期：`config.recognitionFailureRetentionDays`（7~30，默认 30）；到期 `cleanup` 删原图引用并把记录置 `IGNORED`（备注 `EXPIRED`）；同一 fileId 若仍被订单引用，按订单截图规则（§4.1）处理。

**失败码（`failureCode`）**：`NO_TEXT`（OCR 无文本）/ `PARSE_MISS`（有文本但规则+AI 均缺站点或码）/ `LOW_CONFIDENCE`（AI 低置信）/ `LLM_ERROR`（AI 不可用/超限/解析失败）/ `IMAGE_UNREADABLE`（图片打不开/压缩失败）。

**审计与错误码**：`admin_audit.action` 增 `FAILURE_IMAGE_VIEW / FAILURE_FIX / FAILURE_IGNORE`；不新增业务错误码（错误码维持 §5.3 的 13 个），兜底失败一律以 `recognized=false` 降级返回。

---

## 5. 订单状态机（唯一口径）

```
                 顾客取消/兼职拒单/超时
   SUBMITTED ──────────────────────────────► CANCELLED
       │ 接单
       ▼
   ACCEPTED ──顾客取消──► CANCELLED
       │ 标记已取件                    ┌── 异常解除（恢复）
       ▼                               ▼
    PICKED ──标记送达──► DELIVERED ──► COMPLETED（顾客确认 / 24h 自动）
       │                    │
       └──────异常上报───────┴──► EXCEPTION ──► CANCELLED / 恢复
```

| 状态 | 中文（顾客可见） | 进入条件 | 可执行动作（角色） |
| :-- | :-- | :-- | :-- |
| `SUBMITTED` | 待接单 | 顾客下单成功（或兼职代客下单） | 兼职：接单/拒单/补码；顾客：取消；系统：超时取消 |
| `ACCEPTED` | 已接单 | 兼职接单 | 兼职：标记已取件/上报异常/补码；顾客：取消（未取件前） |
| `PICKED` | 已取件·配送中 | 兼职在驿站取到实物 | 兼职：标记送达/上报异常；顾客：不可直接取消（走留言/异常） |
| `DELIVERED` | 已送达·待确认 | 兼职送达约定地点 | 顾客：确认送达；系统：24h 自动完成 |
| `COMPLETED` | 已完成 | 顾客确认/自动完成 | 顾客：查看/删除记录/再次下单；双方：留言（只读归档） |
| `CANCELLED` | 已取消 | 顾客取消/兼职拒单/超时/异常取消 | 双方：查看原因；顾客：再次下单 |
| `EXCEPTION` | 异常·待处理 | 兼职上报（码失效/找不到件/柜门坏/联系不上/其他） | 兼职：解除异常恢复/取消；顾客：留言，**`exception.fromStatus ∈ {SUBMITTED, ACCEPTED}` 时可取消**；admin：介入 |

- **子状态**：`codeStatus='NEED_CODE'`（需查明，可与状态并存；补码后置 OK 并记 event）；`urgent`（加急服务类型携带）。**无任何支付/收款子状态**。
- **超时**：`SUBMITTED` 超过 `config.orderTimeoutMinutes`（默认 120）未接单 → 系统自动 `CANCELLED`（原因"超时未接单"）。
- **自动完成**：`DELIVERED` 后 `config.autoCompleteHours`（默认 24）顾客未操作 → `COMPLETED`（actor=SYSTEM）。**代客单（guest）无顾客确认路径**：同样由该自动完成任务转 `COMPLETED`。
- **非法流转**：云函数校验转移表，非法返回 `INVALID_TRANSITION`；所有写动作幂等（`clientRequestId`）。
- **顾客可见进度条**：下单 → 已接单 → 已取件 → 已送达 → 已完成；异常/取消分支单独展示。进度文案必须来自服务端状态，不许前端"假装推进"。
- **列表动线排序（四档）**：组内按 `需查明(codeStatus=NEED_CODE)` → `快递柜(lockerNo 非空)` → `分段码(取件码含分隔符/字母)` → `其他`；同档按码数字升序、id 兜底。

### 5.1 补偿与纠正动作

| 动作 | 允许状态 | 谁能做 | 语义与副作用 |
| :-- | :-- | :-- | :-- |
| `order.correct`（改码/改站点/改柜号/改运单尾号） | `SUBMITTED`/`ACCEPTED`/`EXCEPTION` 全字段；`PICKED` 仅柜号/运单尾号 | 该订单兼职 | **不改订单归属**（不可换顾客）：顾客归属错只能取消重下。记 `ORDER_CORRECTED`；批量改站点用同一 `batchActionId` 循环调用 |
| `order.unmarkPicked`（撤销已取件） | `PICKED` | 该订单兼职 | `PICKED → ACCEPTED`，清 `pickedAt`；记 `PICKED_REVERTED`；顾客进度回退并提示 |
| `order.unmarkDelivered`（撤销已送达） | `DELIVERED` | 该订单兼职 | `DELIVERED → PICKED`，记 `DELIVERED_REVERTED`；顾客进度回退提示 |
| `order.undo`（撤销条） | 由被撤销动作决定 | 该订单兼职 | 只在动作后 **5 秒**内、且订单无后续状态变化时允许；按 `batchActionId` 批量逐单校验，部分失败如实提示，成功部分回退 |
| `order.resolveException`（异常恢复） | `EXCEPTION` | 该订单兼职 | 上报时记录 `exception.fromStatus`；恢复回 `fromStatus`（仅允许 `ACCEPTED`/`PICKED`/`DELIVERED`，否则回 `ACCEPTED`）；记 `EXCEPTION_RESOLVED` |
| `order.cancel`（取消） | 见 §5 状态表 | 顾客/兼职/系统/admin | 记 `CANCELLED` 事件与原因；已取件后顾客不能单方取消（走异常/留言，兼职可取消并填原因）；admin 仅异常介入并审计 |

- **删除口径**：**订单不可硬删**。顾客可对 `COMPLETED` 订单做"删除记录"（`order.deleteRecord`：仅从自己列表隐藏 + 进入 7 天后物理删除队列，`orders.deletedByCustomerAt`）；兼职不可删除订单；admin 不可删除订单（只读+审计）。
- **接单撤销**：`order.undo` **不覆盖 `ACCEPTED → SUBMITTED`**。误接单走 `order.cancel`（选原因并通知顾客）；`order.undo` 只覆盖 `order.markPicked`/`order.markDelivered`（分别回 `order.unmarkPicked`/`order.unmarkDelivered`）；**无任何收款动作/撤销**。
- **批量动作**：**不设专用 batch 云函数**；客户端循环调用逐单动作，携带同一 `batchActionId`，服务端逐单返回，客户端汇总"成功 N / 失败 M"并如实上屏。
- **送达备注**：`DELIVERED` 时可填 `deliveryNote`（≤100 字），随事件保存；MVP 不做送达照片/签名（P1）。

### 5.2 枚举与取图口径

- `appoint.type`：`'ASAP'`（尽快）｜`'SLOT'`（预约时段）。`SLOT` 时 `startAt/endAt` 必填；MVP 时段 UI 为「今天/明天 × 上午(08:00-12:00)/下午(12:00-18:00)/晚上(18:00-22:00)」，服务端按 `serverTime` 校验未来时间。
- `exception.code`：`CODE_INVALID`（取件码/柜号无效或已被取走）｜`PARCEL_NOT_FOUND`（驿站找不到件）｜`CABINET_ERROR`（柜门/设备故障）｜`CUSTOMER_UNREACHABLE`（联系不上顾客）｜`ADDRESS_ISSUE`（宿舍地址问题）｜`OTHER`（必须填备注）。中文文案由服务端下发。
- **截图与订单关系**：MVP **一个订单 = 一张取件码截图**；一图多码拆单时各订单共用同一 `fileId`（清理按引用计数）；多张截图分别下单（逐张排队）。
- **图片来源**：相册、拍照、微信聊天文件（系统选择器）。隐私指引覆盖"相册/摄像头/文件选择"三类，上线前按微信后台隐私接口清单逐项核对（人执行）。
- **文本上限**：`orders.note` ≤200；`deliveryNote` ≤100；`bindings.partnerNote` ≤100；`order_messages.text` ≤200；超限 `VALIDATION_FAILED`。
- **取消原因枚举**：顾客侧 `CHANGED_MIND`（不需要了）｜`WRONG_INFO`（信息填错）｜`DUPLICATE`（重复下单）｜`PARTNER_UNREACHABLE`（联系不上兼职）｜`OTHER`（必填备注）；兼职侧 `TOO_BUSY`（忙不过来）｜`OUT_OF_RANGE`（不在服务范围）｜`SERVICE_OFF`（服务未开）｜`OTHER`（必填备注）；系统侧 `TIMEOUT_UNACCEPTED`（超时未接单）。中文文案由服务端下发。**已删除 `PRICE_ISSUE`（价格问题）与 `PAYMENT_TIMEOUT`（零金钱口径）**。
- **列表排序（服务端排序）**：顾客"进行中"按 `statusUpdatedAt desc`；顾客"已完成/已取消"按 `completedAt/cancelledAt desc`；兼职工作台服务端返回按"状态桶 + 站点"过滤的分页数据，客户端零件层只做**四档动线排序**；分页游标用 `(statusUpdatedAt, orderNo)` 或 `(completedAt, orderNo)`。
- **结果页**：下单结果**内嵌在 `order-create` 第 4 步**，不新增 `result` 子页；一图多码拆单在同一结果块列出 N 张订单号与入口。

### 5.3 云函数动作命名（`模块.动作` 驼峰；DATA_MODEL 按此定稿契约）

| 模块 | 动作 |
| :-- | :-- |
| `user` | `bootstrap`（返回角色/资料完成度/绑定摘要/`isDeveloper`/当前切换会话上下文 `viewContext`（含 `viewMode/role/target`），**不返回 openid**）、`acceptPrivacy`、`deleteAccount` |
| `customer` | `saveProfile`（首次保存时生成 `customerNo`，幂等；含 `displayName` 昵称与 `avatarFileId`）、`getProfile` |
| `partner` | `activate`（入参 `invitationCode` + 昵称，激活时可一键取微信昵称/头像）、`saveProfile`（昵称/头像可改）、`saveServiceConfig`、`getPublic`（凭完整 `partnerNo`，未绑定可、限流；**绑定前只回昵称，绑定后回头像/昵称**；测试账号返回 `NOT_FOUND`）、`listBindings`（客户档案，服务端搜索 + 游标分页）、`getCustomer`（`bindingId` 反查自己绑定顾客：档案 + 解绑资格；**不含订单分页**，该顾客历史订单统一走 `order.listPartner({view:'customer'})` 单一来源，批 8 TD-049 收敛）、`unbindCustomer`、`saveCustomerNote`、`stats`（**只含单量**：今日/本周/本月完成量、进行中/异常/取消、完成率、近 7 日单量、日报摘要源；**排除测试账号与 `isTest` 订单**；无任何收入类字段） |
| `bind` | `create`（**仅顾客可调**；凭完整 `partnerNo`；测试账号只能绑测试账号）、`release`（reason 必填枚举 + note≤100）、`getCurrent`（当前 ACTIVE 绑定摘要 + partner 公开资料（头像/昵称）+ roomTag）、`claimGuestOrder`（P1，顾客认领） |
| `order` | `create`、`createBatch`（一图多码拆单，**≤5 单、单事务原子创建**；每条 `requestKey` 后缀 `:{itemIndex}`）、`get`、`listCustomer`、`listPartner`（返回列表 + `counts` 6 项）、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、`confirmDelivery`、`correct`、`undo`、`deleteRecord`、`imageUrl` |
| `message` | `send`、`list`（消息中心聚合）、`markRead` |
| `upload` | `prepare`（`purpose:'TICKET'|'AVATAR'`；头像路径 `avatars/{role}/{random}.jpg`、≤200KB、jpg/png）、`cancel` |
| `config` | `getPublic`（返回 `zoneLabels/serviceCatalog(无价格)/announcement/maintenance/screenshotRetentionDays/orderTimeoutMinutes/autoCompleteHours/privacyVersion` 等公开配置） |
| `admin` | `createInvites`（批量 ≤50、有效期/备注）、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`listOrders`（默认过滤测试数据，可切换）、`getOrder`、`listAudit`、`updateConfig`、`stats`（**排除测试账号与测试订单**；可附 `test` 计数供测试账号管理页展示）、`bootstrap`（内部幂等种子/集合索引校验）、`viewAsStart`（`{role,targetNo,mode:'READONLY'|'TEST_WRITE'}`；真实账号只允许 `READONLY`）、`viewAsEnd`、`createTestAccount`（`{role,displayName}`）、`listTestAccounts`、`deleteTestAccount`（删账号+数据+头像）、`purgeTestData`（清空全部测试数据）、`listRecognitionFailures`、`getRecognitionFailure`（返回原图临时 URL，审计 `FAILURE_IMAGE_VIEW`）、`fixRecognitionFailure`（`{stationId?,stationName?,pickupCode?,note?,notifyUploader?}`）、`ignoreRecognitionFailure`（`{note,notifyUploader?}`） |
| `ai` | `parseParcel`（**内部受控兜底**：入参/出参见 §4.3；服务端调 DeepSeek；限流 5 次/人/日 + 全局日配额；Key 只在环境变量；失败静默降级 `recognized=false` 并写 `recognition_failures`；未登录/无业务角色 → `FORBIDDEN`；**不新增错误码**） |
| `health` | `check`（部署自检，仅内部/部署者可用） |
| `cleanup` | 定时任务（内部）：超时取消、自动完成（含 guest 单）、截图/票据清理、软删物理删、注销删除、过期邀请码置 EXPIRED、限流计数清理、过期切换会话票据清理（`READONLY`/`TEST_WRITE`）、**过期识别失败记录与原图引用清理（v0.8）**、**超期测试账号数据清理（v0.9）** |

> 命名纪律：动作名只表达业务语义；响应统一 **`{ok, code?, message?, data?, serverTime, requestId?}`**。错误码统一大写_下划线，**只认这一套**：`VALIDATION_FAILED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`INVALID_TRANSITION`、`INVALID_STATE`、`RATE_LIMITED`、`INVITE_EXPIRED`、`INVITE_USED`、`VIEW_TICKET_EXPIRED`、`PARTNER_CLOSED`、`DEPENDENCY_FAILED`、`INTERNAL_ERROR`。字段级校验失败时 `data.field` 指向字段名。**不含任何支付类错误码**。`ai.parseParcel` 的外呼失败/超限一律降级为成功响应（`recognized=false`），**不占用错误码**（v0.8）。**账号切换/测试账号不新增错误码**（v0.9）：真实账号传 `TEST_WRITE`、真实×测试互绑/互下单一律 `FORBIDDEN`；票据问题沿用 `VIEW_TICKET_EXPIRED`。

---

## 6. 服务类型（只有类型，无价格，用户硬口径）

| code | 名称 | 说明（只描述做什么） |
| :-- | :-- | :-- |
| `PICKUP_STD` | 标准代取 | 驿站取件送到宿舍楼下/约定地点 |
| `PICKUP_DOOR` | 送寝上门 | 送到寝室门口（上楼） |
| `PICKUP_URGENT` | 加急代取 | 优先处理，承诺更快时效 |
| `DROP_OFF` | 代寄快递 | 顾客把件交给兼职，兼职送驿站寄出 |
| `CUSTOM` | 其他代办 | 需备注说明；兼职可拒单 |

- **没有价格、没有运费、没有报价、没有金额快照**；订单只快照 `service{code,name}`。
- 兼职可启用/停用服务类型、设置服务范围（哪些苑/楼栋接单）、接单开关、每日接单上限、营业时间段。
- **服务配置字段（shape）**：`partner.serviceConfig{ services[{code,enabled}], zones[], buildingNos[], acceptingOrders, maxDailyOrders?, businessHours?, autoAccept? }`。**MVP 实现**：`services/zones/acceptingOrders`（范围先做到苑级）；`buildingNos/maxDailyOrders/businessHours/autoAccept` 为 P1 预留可空字段。
- **接单开关**：`serviceConfig.acceptingOrders=false` ⇒ `order.create/createBatch` 返回 `PARTNER_CLOSED`；顾客端下单入口置灰；恢复后可下单。
- 顾客端只展示兼职已启用的服务类型名称；**不展示任何价格/费用信息**。

---

## 7. 页面地图（app.json 口径，详见三份 UX 文档）

主包（**tabBar 上限 5 项**；`custom: true`；自定义 tabBar 组件必须在**项目根目录 `custom-tab-bar/`**；按角色只渲染 3 个，开发者使用分包页面无 tabBar）：
```
pages/launch/index            启动分流（读角色/资料/绑定/是否开发者 → reLaunch；不在 tabBar）
pages/role/index              身份选择 + 邀请码入口 + 绑定卡片落地（?bind=CODE；不在 tabBar）
pages/customer/home/index     顾客首页（tab 1：首页）
pages/customer/orders/index   顾客订单列表（tab 2：订单）
pages/partner/workbench/index 兼职工作台=取件清单（tab 3：工作台）
pages/partner/customers/index 兼职客户档案（tab 4：客户）
pages/profile/index           我的（tab 5：**顾客/兼职共用**，页内按角色渲染；显示头像/昵称与对应唯一编号）
```
- 顾客可见 tab：1 首页 / 2 订单 / 5 我的；兼职可见 tab：3 工作台 / 4 客户 / 5 我的。
- 兼职"我的"里的编号/分享绑定卡片/服务配置入口/统计/切换身份，都在共用 `pages/profile/index` 内按角色渲染。
- 角色不匹配的 tab 页在 `onShow` 里 `reLaunch` 回本角色首页；`tabBar` 切格用 `wx.switchTab`，跨角色切换用 `wx.reLaunch`。
- **开发者分流**：`user.bootstrap` 返回 `isDeveloper=true` ⇒ `wx.reLaunch('/pkg-admin/pages/overview/index')`；不需要 `?admin=1`（服务端白名单是唯一门槛）。

分包：
```
pkg-customer/pages/bind/index          绑定兼职（输入完整兼职编号 / 卡片落地确认；展示兼职昵称，**头像绑定成功后才可见**）
pkg-customer/pages/order-create/index  下单（截图→识别→确认→选服务类型→提交）
pkg-customer/pages/order-detail/index  订单详情/进度/留言/取消/确认送达
pkg-customer/pages/messages/index      消息中心（订单通知）
pkg-customer/pages/help/index          帮助/隐私/关于（含"本程序不涉及费用收付"口径说明）
pkg-partner/pages/activate/index       邀请码激活 + 资料初始化
pkg-partner/pages/order-detail/index   兼职订单详情/状态操作/改码/留言
pkg-partner/pages/create-on-behalf/index 代客下单（v3 录入页移植）
pkg-partner/pages/customer-detail/index  兼职侧顾客详情（历史订单/备注/顾客编号/头像昵称）
pkg-partner/pages/service-settings/index 服务配置（启用服务类型/范围/接单开关，无价格）
pkg-partner/pages/stats/index          单量统计（今日/本周完成量、状态分布，无金额）
pkg-partner/pages/messages/index       消息中心
pkg-admin/pages/overview/index         开发者总览（统计卡/审计区块/账号切换入口）
pkg-admin/pages/invite-codes/index     邀请码生成/批量/作废/状态
pkg-admin/pages/customers/index        顾客列表/搜索（按顾客编号/宿舍/昵称，脱敏；不展示头像）
pkg-admin/pages/customer-detail/index  顾客详情（资料脱敏/绑定/订单）
pkg-admin/pages/partners/index         兼职列表/搜索/停启用
pkg-admin/pages/orders/index           订单总览/异常工单（脱敏；默认过滤测试数据）
pkg-admin/pages/order-detail/index     订单详情（脱敏，只读）
pkg-admin/pages/config/index           全局配置（服务类型模板/苑名/公告/超时/留存/切换时长/头像大小）
pkg-admin/pages/account-switch/index   账号切换（真实账号只读 / 测试账号可写；含测试账号管理 tab；v0.9）
pkg-admin/pages/messages/index         后台消息（异常工单/系统提示）
pkg-admin/pages/recognition-review/index 识别失败复核（原图+OCR 文本+AI 结果；补录站点/取件码、忽略、通知上传者；v0.8）
```
- **导航规则**：`launch` 是唯一启动页；`role` 不属任何 tab；角色不匹配的 tab 页在 `onShow` 里 `reLaunch` 回本角色首页；绑定卡片 `?bind=` 可落在 `role` 或 `bind`（由登录态决定；**落地卡按目标角色渲染：顾客身份显示绑定入口，兼职身份不显示顾客绑定入口**）；`?orderNo=` 落地订单详情（校验归属，失败回列表）。
- **自定义 tabBar**：组件位于项目根目录 `custom-tab-bar/`（平台硬要求），读全局角色，渲染顾客三格（首页/订单/我的）或兼职三格（工作台/客户/我的）；**切换会话下渲染目标角色三格**且每页顶部常驻黄条（真实账号只读）或蓝条（测试账号可写）；兼职"工作台"显示待处理红点；切换角色后 `reLaunch` 到对应首页。
- **开发者页面无 tabBar**：全部在 `pkg-admin` 分包内，用页面内导航/返回栈；从切换会话退出回「切换账号」页（`pkg-admin/pages/account-switch/index`）。
- **切换会话（v0.9）**：所有业务页面（顾客/兼职）在 `viewContext` 存在时：`READONLY` = 顶部黄条 + 写控件置灰 + 读接口注入 `viewTicket`；`TEST_WRITE` = 顶部蓝条 + `TEST` 角标 + 读写接口注入 `viewTicket`（服务端仅允许测试账号写）；两种会话都隐藏分享/转发入口；退出回「切换账号」页。

---

## 8. 设计语言（三份 UX 文档共同遵守）

- 配色：品牌主色 `#1F7A5C`（绿）；顾客强调色 `#F2994A`（暖橙）；兼职强调色 `#2B6DE5`（蓝）；开发者后台中性灰蓝 `#3A4A5C`；只读视角黄条 `#FFF4CE` 底 + `#8A6D00` 字；**测试账号蓝条 `#E8F0FF` 底 + `#2B6DE5` 字 + `TEST` 角标**；危险 `#E54D42`；警告 `#F5A623`；文字 `#1A1A1A`/`#666666`/`#999999`；背景 `#F6F7F9`；卡片 `#FFFFFF`；分隔线 `#EEEEEE`。
- 字号（rpx）：大标题 40、区块标题 34、正文 30、辅助 26、说明 24；行高 ≥1.4。
- 间距：8rpx 网格（8/16/24/32/48）；卡片圆角 16rpx；按钮圆角 12rpx；**可点区域 ≥88rpx**。
- 状态色：待接单灰蓝 `#5B7B9A`、已接单蓝、已取件橙、已送达绿、已完成绿底白字、已取消灰、异常红。
- 图标：自制 PNG（tabbar 81×81）或内联 SVG data URI；不引第三方图标库。
- **唯一编号展示**：等宽感、独立行、可复制按钮；顾客编号用 `C-XXXX-XXXX`、兼职编号用 `P-XXX-XXX`；不缩写成裸数字；不把编号放进分享卡片以外的敏感位置。
- **头像与昵称（v0.9）**：头像**圆形**（列表 64rpx、资料/详情 96rpx），**无头像/加载失败一律显示默认头像**（昵称首字色块 + 浅底），不得出现空白/裂图；头像与昵称**成对展示**（头像左、昵称/编号右）；**绑定前预览只显示昵称（头像位显示默认占位）**；绑定成功后订单详情、绑定卡、兼职客户档案展示**绑定对方**的头像+昵称；**分享卡片、通知、后台列表、日志不展示头像**；后台昵称按 DTO 脱敏。
- 可读性：状态不只靠颜色（颜色+文字/形状双编码）；行内展示 L3 敏感字段时"锚 + 键"配对，如 `D4-522A · 尾号6678 · 小王`。
- **测试数据视觉（v0.9）**：`TEST_WRITE` 会话每页右上角常驻 `TEST` 角标（底色 `#2B6DE5`、白字、圆角 8rpx）；顶部蓝条文案固定 `测试账号 · {角色} {编号}（测试） · 由 {developerNo} 切换 · 退出`；测试订单在后台列表以 `测试` 标签标识；测试数据不得出现在任何真实用户页面。
- **零金额**：界面不出现任何金额、价格、运费、费用、收款、结算字样（英文 `price/fee/pay/amount` 同样禁止）；失败文案说真话并给下一步；禁止"请稍后重试"式空话。

---

## 9. 通知口径

- **必做**：顾客订单详情页 10s 轮询（可见时）；兼职工作台 `onShow` 刷新 + 30s 轮询 + 下拉刷新 + 新订单红点/角标；消息中心列表；订单留言。
- **P1**：微信订阅消息（模板：新订单提醒（兼职）、订单状态提醒（顾客）、异常提醒（双方））。授权按钮在关键动作后引导；用户拒绝不阻断主流程；`config` 存模板 ID，代码不硬编码。
- 通知文案不带敏感信息；不带完整手机号、不带链接参数里的 openid；**不涉及任何金额/费用文案**。

---

## 10. 权限矩阵（资源 × 角色）

| 资源/动作 | 顾客 | 兼职 | 开发者 developer |
| :-- | :-- | :-- | :-- |
| 读自己的顾客资料 | ✅ | ✅（若兼顾客身份） | 后台仅脱敏列表/详情 |
| 读绑定兼职公开资料（**头像/昵称**/服务类型/接单状态/服务范围/兼职编号） | ✅ | — | ✅（后台；不展示头像） |
| 枚举/搜索兼职 | ❌（永不提供） | — | ✅（后台管理用途） |
| **发起绑定**（凭完整 partnerNo） | ✅（唯一入口，限流 5 次/日） | ❌（**禁止**；无任何入口，`bind.create` → `FORBIDDEN`） | —（开发者不创建绑定） |
| 解绑 | 自己的绑定 | 自己的客户（reason 必填 + 通知） | — |
| 读绑定对方头像/昵称 | ✅（绑定兼职） | ✅（绑定自己的顾客） | 后台默认脱敏（**不展示头像**、昵称脱敏）；只读视角同目标 |
| 修改自己的头像/昵称 | ✅ | ✅ | —（开发者无业务身份） |
| 读顾客完整资料（含宿舍/尾号/roomTag/顾客编号/头像/昵称） | 自己 | 仅绑定自己的顾客 | 后台默认脱敏；完整值仅只读视角（审计） |
| 订单创建/取消/确认 | 自己的 | 自己的（含代客单） | 仅异常介入取消（原因+审计）；不代确认、不创建 |
| 订单状态操作（接单/取件/送达/异常/改码/撤销） | — | 自己的 | 只读视角可看不可做；后台不可操作 |
| 邀请码生成/作废/查看 | ❌ | ❌ | ✅ |
| 兼职停启用 | ❌ | ❌ | ✅ |
| 全局配置 | ❌ | ❌ | ✅ |
| 后台数据查看（用户/订单/绑定/统计/审计） | ❌ | ❌ | ✅（默认脱敏；**统计不含测试数据**） |
| **切换账号：真实账号（只读）** | ❌ | ❌ | ✅（票据+审计+拒写；隐藏分享） |
| **切换账号：测试账号（可写）** | ❌ | ❌ | ✅（`TEST_WRITE`；仅测试账号；测试数据标记；审计） |
| **测试账号管理/清理测试数据** | ❌ | ❌ | ✅（≤3/角色、≤6/开发者；删除/清空二次确认 + 审计） |
| 订单留言 | 自己订单 | 自己订单 | 只读（工单）；测试会话可写（仅测试数据） |
| 识别失败队列/原图查看（仅复核页） | ❌ | ❌ | ✅（临时 URL 5 分钟 + 每次审计；不批量/不下载/不导出） |
| 补录识别结果（回填订单识别字段） | ❌ | 自己的（`order.correct` 改码） | ✅（仅识别字段，不改状态、不代确认；审计） |
| 任何金额/支付/收款/运费/价格操作 | — | — | **不存在（零金额）** |

**限流（服务端，落 `counters.rl:{scope}:{openid}:{window}`）**：绑定尝试 5 次/日/顾客；邀请码激活失败 5 次/日/openid；下单 20 单/日/顾客；留言 30 条/日/订单；账号切换（真实只读/测试可写）开启 20 次/日/开发者；**头像上传 5 次/日/人**；**AI 识别兜底 5 次/人/日 + 全局日配额（v0.8）**；admin 操作全审计；超限返回 `RATE_LIMITED`（AI 兜底超限不返回错误，静默降级）。

---

## 11. 隐私与数据留存（硬约束，对外承诺）

### 11.1 收集清单（最小化）
| 数据 | 是否必填 | 用途 | 保存期限 |
| :-- | :-- | :-- | :-- |
| openid | 必（平台提供） | 账号与数据隔离 | 账号存续期 |
| 顾客编号 / 兼职编号 | 系统生成 | 身份识别、绑定、客服沟通 | 账号存续期（注销作废） |
| 微信昵称（必填，可改/手填） | 必填 | 顾客/兼职展示（订单双方） | 账号存续期（注销删除） |
| 微信头像（`chooseAvatar`，可拒绝→默认头像） | 自愿 | 绑定双方展示（仅 ACTIVE 绑定关系内） | 账号存续期；换头像/注销即删旧文件 |
| 苑/楼栋/宿舍号 | 必填（才能下单） | 履约送达 | 账号存续期 |
| 手机尾号 4 位 | 可选 | 同寝室区分辅助 | 账号存续期 |
| 订单信息（站点/取件码/柜号/服务类型/预约/备注） | 必 | 履约与进度 | 完成/取消后 180 天，随后删除或匿名化 |
| 取件码截图 | 顾客上传 | 识别与兼职核对 | 完成/取消后 7 天删除 |
| 识别失败兜底外发（v0.8） | 自动（仅识别失败时） | 把**去敏 OCR 文本**发给 DeepSeek API 做结构化识别辅助 | 不落第三方存储、不用于训练；我方只保留脱敏副本（随失败记录） |
| 识别失败原图与复核记录（v0.8） | 自动 | 开发者排查识别问题（含原图临时查看，审计） | 默认 30 天（`recognitionFailureRetentionDays`，7~30 可配），到期删除 |
| 订单留言文本 | 可选 | 沟通 | 随订单 |
| 邀请码使用记录 | 兼职激活时 | 准入与审计 | 账号存续期/审计需要 |
| 开发者后台访问、只读视角与账号切换审计日志 | 自动 | 安全审计 | 按审计策略保留（≥180 天） |
| 云函数日志 | 自动 | 故障排查/安全审计 | 按云开发控制台设置，最短可用期限 |

**永不收集**：完整手机号、通讯录、定位、身份证、**支付/银行卡信息（本程序也不处理任何金钱）**、麦克风、微信好友关系；**不收集用户相册里的其他照片**（头像仅取微信头像或默认头像）。
**不外泄**：不向第三方共享/出售；截图/尾号/头像/昵称不出现在分享卡片、通知、日志明文；**后台默认脱敏（不展示头像、昵称脱敏），完整 L3 数据仅通过审计过的只读视角查看**。
**头像与昵称可见范围（v0.9，用户四次修订）**：顾客与兼职的微信头像/昵称**只向自己与该角色当前 ACTIVE 绑定的对方展示**（顾客看到绑定兼职；兼职在客户档案看到绑定顾客）；解绑/停用/注销后立即不再展示；订单快照不复制头像/昵称；**后台列表/详情不展示头像**，昵称按脱敏规则展示；分享卡片只有编号，不含头像/昵称。**客户端须 onShow 重新拉取；换头像后 fileId 变化（旧 fileId 失效即回默认头像）；解绑/停用/注销后服务端停发；对方设备已缓存/已截图的副本无法技术撤回（隐私文本写明）。**
**第三方 AI 例外（v0.8，用户三次修订，必须写进隐私指引）**：仅当 OCR 识别站点/取件码失败时，把**去敏后的 OCR 文本**（不含原图、不含 openid、不含联系方式、不含头像/昵称）发送给 DeepSeek API 做识别辅助；DeepSeek 不用于训练、不落我方日志全文；**原图不出本程序云存储**。识别失败原图仅在开发者复核页以临时 URL 查看并逐次审计。

### 11.2 公开承诺变化（相对 v3）
v3 是"数据只存本机、不上传、无账号"；v4 必须改为"**订单与资料存于微信云开发，按角色隔离；仅订单双方可见；开发者后台治理访问（脱敏+审计）；可注销删除**"。**v0.8 另加两项必须披露**：①识别失败时**去敏 OCR 文本**会发给第三方 AI 服务（DeepSeek）做识别辅助，原图不出本程序云存储；②识别失败原图会进入开发者复核流程（临时查看+审计，默认 30 天删除）。**v0.9 另加两项必须披露**：③采集**微信头像与微信昵称**，只向当前绑定的对方展示（头像可拒绝→默认头像，不影响使用）；④开发者账号可**切换账号**——真实账号只读查看（审计/拒写），测试账号为后台合成账号（不含真实用户数据）。这是**对外承诺的变更**：上线前先定稿《用户隐私保护指引》与《用户协议》文本（`docs/privacy/`），微信后台逐项声明后再提审（含"第三方服务"栏必须填 DeepSeek；**隐私声明须勾选"头像""昵称"采集项**）。

### 11.3 安全
- 数据库安全规则：客户端读写全部拒绝；云函数用 admin 权限并按 openid 过滤。
- 云存储：私有（客户端不可读）；临时 URL 5 分钟；上传 ticket 校验。**头像（v0.9）**：`avatars/{role}/{random}.jpg`、≤200KB、jpg/png、路径随机不可枚举；仅 DTO 返回给本人/绑定对方；后台与分享卡片不下发；旧头像替换即删。
- 输入校验：所有文本长度/字符集闸；留言/备注/**昵称**过 `security.msgSecCheck` v2；截图 P1 过 `security.mediaCheckAsync`；头像校验类型/大小/图片可解码，**微信头像来源由平台审核**，若后续允许自定义上传须补 `mediaCheckAsync`（P1）。
- 敏感操作审计：邀请码、停用、配置、admin 操作、切换会话、解绑、订单状态变更全部落 `order_events`/`admin_audit`。
- 切换会话票据（v0.9）：随机 32 位、服务端存储、内存传递、30 分钟过期；`READONLY` 仅读、`TEST_WRITE` 仅测试账号可写；发起人每次校验白名单；`targetId/targetIsTest/impersonatedBy` 三者在服务端交叉校验，票据不能挪用到其他账号。
- 开发者账号：白名单只存在云函数环境变量，不进代码/前端/数据库；前端隐藏不作为安全边界；**多开发者（DEV-02…）各自微信登录、各自会话/审计，不共享票据**。
- **AI 兜底安全（v0.8）**：`DEEPSEEK_API_KEY` 只存云函数环境变量，客户端包内零出现；外发 payload 白名单（`ocrTextMasked/hintTrackingTail/role`）+ 服务端二次去敏；原图与 openid 不外发；响应不整段落日志；失败入队可追溯；复核页原图临时 URL 5 分钟且每次审计。

### 11.4 注销与删除
- 顾客注销：检查无进行中订单 → 删除 `customers`/`users` 资料（含**头像文件**）、截图、留言；订单匿名化后 30 天内物理删除；解绑；`customerNo` 作废不再分配。**执行时点（批 9 澄清）**：注销事务只做「绑定释放 + `users` 置 DEACTIVATED」，PII 匿名化、截图与头像文件删除由**下一轮 cleanup（≤10 分钟）**执行（`user.deleteAccount` + `cleanup.accountDeletion` 两阶段链路，见 DATA_MODEL §10.4）。
- 兼职注销：由开发者后台 `admin.setPartnerStatus(CLOSED)` 执行（无自助入口；需先处理完未完成订单并解除全部绑定）：释放绑定并清 `partnerNote`、进行中订单转 `EXCEPTION` 待后台处置；`partners` PII 匿名化（**`displayName`/`avatarFileId`/停用与关闭原因清空**）并**删除头像文件**；`invitation_codes.usedBy` 置空（保留 `usedAt`/`batchId` 审计）；识别失败记录清 `uploaderOpenid`/`fileId` 并按引用计数删原图；**`partners` 文档保留审计不物理删**（`openid` 保留作「不可再激活」身份锚点，待 `docs/TECH_DEBT.md` TD-053 收敛）；已终态订单仍按终态留存口径（180 天后匿名化），不随 CLOSED 立即匿名化；`partnerNo` 作废不再分配。
- 顾客可删除单条已完成订单记录（软删，7 天后物理删除）。
- **测试账号（v0.9）**：`admin.deleteTestAccount` 删除账号 + 头像 + 全部测试数据（含测试订单、留言、绑定），并写审计；`admin.purgeTestData` 只清数据保留账号；cleanup 清理超 30 天未使用的测试数据；测试账号不涉及对真实用户的隐私披露（无真实微信资料）。
- **识别失败记录（v0.8）**：上传者注销 → 清 `uploaderOpenid`（匿名化）、原图按引用计数删除、`ocrTextMasked` 随记录保留至到期（默认 30 天）后物理删；兼职 CLOSED 同口径（记录保留至到期，供复核审计）；复核审计日志按审计策略保留。
- 微信合规：未成年人保护提示；《用户协议》《隐私政策》入口在"我的"。

---

## 12. 工程与文档规范（细节见 `docs/V4_ENGINEERING.md`）

- 技术栈：原生小程序（WXML/WXSS/JS）+ 微信云开发（Node.js 云函数，`wx-server-sdk`）；**零第三方前端依赖**；不引入 npm 前端包。
- 分层铁律：页面层（只做 setData/事件转发）/ 零件层（纯逻辑，零 `wx`，可单测）/ API 适配层（唯一云函数出口，统一注入 `viewTicket`）/ 云函数层（校验 + 业务 + 数据访问）。页面层零业务判据（v3 教训 TD-016）。
- **编号零件**：`utils/ids.js` 纯函数负责格式/校验/展示/错前缀提示；生成只在云端（随机源在服务端）。
- 文件/函数行数：源码文件 ≤500 行、测试文件 ≤1000 行、函数 ≤50 行（与 v3 AGENTS §11.1 同口径，全文行）。
- 命名：文档/代码/UI 同字典（本卡 §3）；禁止 `data/info/handle` 空泛名。
- 测试：纯模块用 v3 式 selftest harness（断言计数闸）；云函数 handler 用依赖注入 + 内存 fake DB 单测；真机/双机联调用 `docs/QA_CHECKLIST.md` 人工点检清单（agent 不代宣布通过）。
- **零金额门禁**：源码/页面文案/文档扫描 `Fen|price|fee|pay|amount|金额|价格|运费|收款|结算`，命中即失败（白名单：说明性文档中"本程序不涉及费用"的声明文本单独登记）。
- **AI 兜底门禁（v0.8）**：`ai` 外呼只允许存在于云函数层（客户端目录出现 `DEEPSEEK_API_KEY`/`api.deepseek.com` 即失败）；`ai.parseParcel` 外发字段必须等于 §4.3 白名单（单测断言 payload 键集合）；失败必须写 `recognition_failures`（禁止静默丢弃）；后台复核页原图访问必须落 `FAILURE_IMAGE_VIEW` 审计。
- **绑定方向门禁（v0.9）**：`bind.create` 仅 CUSTOMER 可调；兼职端/后台不得出现"绑定顾客/添加顾客/导入顾客"入口或接口；代客下单代码路径不得写 `bindings`；测试账号×真实账号绑定必须拒绝（selftest 断言）。
- **头像昵称门禁（v0.9）**：头像只允许 `upload.prepare({purpose:'AVATAR'})` → `avatars/…`，≤200KB、jpg/png；昵称落库前截断 ≤20 字且过 `msgSecCheck`；分享卡片/通知/日志/后台列表不出现头像 fileId；后台 DTO 无 `avatarFileId`；解绑后 DTO 不再返回对方头像/昵称。
- **账号切换门禁（v0.9）**：`viewMode=TEST_WRITE` 仅 `isTestAccount=true` 可签发；真实账号传 `TEST_WRITE` 必须 `FORBIDDEN`；真实账号×测试账号互绑/互下单必须 `FORBIDDEN`；统计/红点/邀请码/审计报表排除测试账号与 `isTest`；测试写事件必须带 `impersonatedBy`；切换会话票据内存态、不落本地存储。
- 完成定义（DoD）：`check.ps1` 退出码 0 + 真实输出 + 本批验收项逐条打勾；设计阶段 = 文档齐全 + 交叉一致性检查通过 + 用户裁决项列清。
- 文档地图（v4）：
  - `V4_REBUILD_SPEC.md`（主规格：产品/架构/权限/状态机/批次/验收/裁决）
  - `docs/V4_CONTRACT.md`（本文，口径卡）
  - `docs/V4_DATA_MODEL.md`（集合/字段/索引/API 契约/编号规则/roomTag/安全规则）
  - `docs/V4_UX_CUSTOMER.md`（顾客端页面与交互）
  - `docs/V4_UX_PARTNER.md`（兼职端页面与交互，含 v3 清单补齐清单）
  - `docs/V4_UX_DEVELOPER.md`（开发者后台、账号切换/只读视角：邀请码/数据查看/审计/测试账号）
  - `docs/V4_ENGINEERING.md`（工程结构/环境/测试/门禁/部署）
  - `docs/V4_DECISIONS.md`（裁决卡；D1~D22）
  - `docs/QA_CHECKLIST.md`（真机/双机人工点检清单，人执行）
  - `docs/V4_REVIEW_MATERIALS.md`（批 9：审核材料与提审体验路径，用户执行；agent 不代提审）
  - `docs/V4_V3_PARITY.md`（批 9：v3→v4 功能对照验收表，用户勾选底稿）
  - `docs/privacy/`（隐私指引草案 + 发布前填写清单，上线前人执行）
  - `docs/ARCHITECTURE.md`、`docs/RUNBOOK.md`（批 1 建立）
  - `docs/lessons/`（v4 新踩坑）
- 提交：v4 需 `git init` + 显式 `-c user.name=... -c user.email=...`；提交信息 `feat(v4): <批名> + 证据摘要`。

---

## 13. 用户裁决事项（D1~D22；2026-10-22 全部闭环）

> **裁决状态（2026-10-22 用户回复）**：全部闭环，原文留痕见 `docs/V4_DECISIONS.md` §0.1。D1/D3/D4/D7/D9/D10/D11/D12/D14/D15/D16/D17/D18/D19 = 按推荐确认；D2 = 沿用 v3 appid；D8 = 东/西/南/北/翠苑；D13 = 个人主体+工具类目；D22 = A；D5/D6/D20/D21 早前已定。

| # | 事项 | 推荐 | 代价/被否 |
| :-- | :-- | :-- | :-- |
| D1 | 后端用微信云开发 | ✅ 推荐 | 否：自建后端（域名/备案/运维）或纯本地（不满足跨设备）。**执行方式（2026-10-22 修订）**：账号只能开 1 个云环境 ⇒ 单环境部署，测试数据靠测试账号/`isTest` 标记隔离 + 上线前清零（见 DECISIONS D1 修订留痕） |
| D2 | appid：**沿用 v3 appid `wxcb7e5b41b89bc806`**（用户 2026-10-22 指定，非推荐 A） | ✅ 已定（B） | 代价：同一 storage 命名空间（v4 只碰自己的键）、发布 v4 即替代 v3、隐私/类目在同一 appid 重新提交 |
| D3 | 兼职准入用邀请码（一次性/有效期/可作废/可审计） | ✅ 推荐 | 否：openid 白名单（不可自助发放）；硬编码密钥（禁止） |
| D4 | 一顾客同时绑一个兼职；**绑定只能由顾客发起**（兼职不能绑定/代绑顾客） | ✅ 推荐 | 否：多兼职（隔离与履约归属复杂、顾客易困惑）；兼职可绑定顾客（越权与骚扰风险，用户已否） |
| D5 | 服务只分类型（标准/送寝/加急/代寄/其他），**不含价格** | ✅ 已按用户指示定（v0.7） | 原"兼职定价/金额快照"作废 |
| D6 | **零金钱交易**：不做支付/收款/记账/结算/运费计算/价格表/任何金额 | ✅ 已按用户指示定（v0.7） | 无金额相关验收；未来若做支付另立项目 |
| D7 | roomTag 按（兼职,宿舍）绑定顺序分配、独立字段，**恒大写 A…Z/AA…** | ✅ 推荐（v0.9 按用户指示恒大写） | 否：全局分配（跨兼职泄露他店顾客信息）；小写作废 |
| D8 | 五苑展示名：**D=东苑、X=西苑、N=南苑、B=北苑、C=翠苑**（用户 2026-10-22） | ✅ 已定 | 默认值进 `shared/zones.js`；`config.zoneLabels` 仍可覆盖 |
| D9 | 截图压缩上传私有云存储、7 天删除 | ✅ 推荐 | 否：不上传原图（兼职无法核对、体验差） |
| D10 | 提醒=站内轮询/红点；订阅消息 P1 | ✅ 推荐 | 订阅消息需模板审批与用户授权，可后补 |
| D11 | v3 数据不迁移、空库起 | ✅ 推荐 | 若需迁移另立项（同 appid 也需手工导入/不自动迁移） |
| D12 | 保留兼职"代客下单"；**代客下单不产生绑定** | ✅ 推荐 | 否：只服务绑定顾客（第一批用户可能没有 app） |
| D13 | 主体/类目：**个人主体 + 工具类目**（用户 2026-10-22） | ✅ 已定 | 提审时在后台确认类目可选；不可选/被驳回按 换子类目→调整描述→企业主体→仅体验版 处理（提审风险，不阻塞工程） |
| D14 | 开发者**真实账号**视角切换默认**只读**（黄条+审计+服务端拒写） | ✅ 推荐 | 可写切换只给测试账号（D18）；真实账号可写有数据污染与隐私/审计风险 |
| D15 | 双角色唯一编号样式：顾客 `C-XXXX-XXXX`、兼职 `P-XXX-XXX`、开发者 `DEV-01`（白名单可配 `DEV-02…`） | ✅ 推荐 | 若要换样式（如更短/含拼音前缀）此时说，改动只在生成与展示规则 |
| D16 | OCR 失败兜底用 **DeepSeek API**：服务端调用、只发去敏文本（不发原图/openid）、8s 超时、5 次/人/日 + 全局配额、失败静默降级并入复核队列 | ✅ 推荐 | 否：不用 AI（失败全靠手填/人工复核）；或客户端直连（Key 泄露，**禁止**）；换其他 AI 服务只改云函数适配层 |
| D17 | 识别失败**原图**在开发者后台复核页可见：仅白名单开发者、临时 URL 5 分钟、每次审计、**不批量/不下载**、保留 30 天（7~30 可配）；补录仅回填识别字段不改订单状态 | ✅ 推荐（用户已明确要求"含原图反馈"） | 若不允许看原图：只能看 OCR 文本，复核效果差；若延长保留期需同步改隐私承诺；若允许批量导出：审计与滥用风险上升 |
| D18 | **账号切换模式**（v0.9）：真实账号**只读**（=原只读视角）+ **测试账号可写**（后台创建合成账号 `isTestAccount`，`TEST_WRITE` 会话，单机验收顾客/兼职两端；测试数据隔离/标记/排除统计/30 天清理；真实账号不可写、平台也不支持切换微信账号本身） | ✅ 推荐（用户四次修订"要能切换账号"的落地方式） | B 真实账号也可写：隐私/审计/数据污染风险高，不推荐；C 只读不提供测试账号：一个微信号无法验收两端真实操作 |
| D19 | **头像/昵称采集方式**（v0.9）：`chooseAvatar` + `nickname` 输入（昵称必填、可改/手填；头像可拒绝→默认头像）；仅绑定双方可见；后台不展示头像、昵称脱敏；卡片/通知不含；注销删文件 | ✅ 推荐（用户已明确要求采集） | 若强制获取且不可改：违反微信"用户主动选择"原则、体验差；若只采昵称：不满足用户第 4 条 |
| D20 | **绑定方向**：只能顾客发起绑定，兼职不能绑定顾客（v0.9 按用户指示定） | ✅ 已定（用户四次修订） | 无；兼职端只保留解绑 |
| D21 | **roomTag 恒大写**（`A…Z/AA…`，展示 `D4-522A`；v0.9 按用户指示定） | ✅ 已定（用户四次修订） | 无 |
| D22 | **截图上传失败后是否允许「无截图手填提交」**：**用户 2026-10-22 裁决 A（保持必须先有截图）**；上传失败只能重试/换图，OCR/阅读失败仍可手填 `NEED_CODE` | ✅ 已定 A（现状不变） | 选 B 需放开页面校验+补断言；本次只回写口径（UX §4.5 限定句）并关闭 TD-039 |

**未决项一律在 `docs/V4_DECISIONS.md` 展开（背景/选项/推荐理由/被否方案/代价）。**

---

## 14. 写作纪律（给所有设计文档）

1. 只写设计与验收，**不写实现代码**；可以给伪代码/表结构/状态表/接口契约。
2. 引用口径用本文编号（§/D）；引用 v3 用"文件路径 + 函数名"（不写会漂移的行号）。
3. 所有"待定/需裁决"必须显式标 `[D#]`，不许藏在正文里。
4. 数字不写死测试条数/性能承诺；给"如何取数"的命令或方法。
5. 每份文档至少包含：目标 / 页面或模块清单 / 状态与边界 / 异常与失败路径 / 验收清单 / 待裁决项。
6. 不发明用户需求：超出 §0 范围的东西只能进 "P1/P2/不做" 清单并说明理由。
7. **零金额纪律**：任何设计文档不得新增金额/价格/运费/收款/结算/支付语义；引用旧口径必须显式标注"已废弃（v0.7）"。
8. **AI 兜底纪律（v0.8）**：写 DeepSeek/OCR 兜底必须同时写清 **发什么/不发什么/超时与重试/限额与降级/失败入队/是否审计/Key 放哪**；禁止只写"调用 AI 自动识别"一句话；AI 只做预填建议，不得覆盖用户手填；外呼不得在客户端发起。
9. **v0.9 纪律（绑定/账号切换/头像）**：写绑定必须写"**只能顾客发起**、兼职无入口、代客单不产生绑定、解绑后不再互见头像昵称"；写账号切换必须区分**真实账号（只读）**与**测试账号（可写/隔离/标记/排除统计/清理）**，禁止把真实账号写成可写，且必须写明"小程序不能切换微信登录账号"的平台限制；写头像/昵称必须写清**采集方式（chooseAvatar/nickname 输入）、必填/可拒绝、可见范围（仅绑定对方）、默认头像兜底、后台与卡片不展示、注销删除**；写 roomTag 一律**大写**（`D4-522A`），原文小写视为缺陷。

---

## 15. v0.9 审查优化清单（用户第 5 条"审查其他优化地方"）

> 本轮在落实 4 条硬修改之外，对全链路做了二次审查；以下优化均已并入 v0.9 口径并落到对应文档（编号仅本文使用，不参与裁决）。

| # | 优化项 | 落点 | 理由/收益 |
| :-- | :-- | :-- | :-- |
| O1 | **绑定方向双保险**：服务端拒绝 + 兼职端隐藏所有"添加/绑定顾客"入口；分享卡片只做"邀请顾客来绑" | §4.2/§10；UX_PARTNER | 彻底消除越权绑定与骚扰/抢客风险 |
| O2 | **解绑即失联**：绑定解除/停用/注销后不再返回对方头像与昵称 | §4.2/§10；DATA_MODEL/UX | 关系结束即收回个人信息展示，最小化 |
| O3 | **切换会话禁分享**：只读/测试会话隐藏所有分享、转发、长按保存入口 | §1.2/§1.3/§7；UX 三端 | 防止把他人页面/资料转发出去 |
| O4 | **测试数据永不混入真实**：`isTest` 标记 + 测试/真实互操作 `FORBIDDEN` + 统计/红点/邀请码排除 + `TEST` 角标 | §1.3/§4.2/§10；DATA_MODEL/ENGINEERING/UX_DEVELOPER | 单机验收不污染经营数据 |
| O5 | **头像兜底与统一组件**：默认头像（首字色块）、加载失败不裂图、列表 64rpx/资料 96rpx | §8；UX_CUSTOMER/UX_PARTNER | 头像缺失是常态（拒绝授权），统一降级避免页面破相 |
| O6 | **头像上传复用 upload ticket**：`purpose=AVATAR`、路径随机、≤200KB、替换删旧、注销删文件 | §4.1/§4.2；DATA_MODEL/ENGINEERING | 不新增第二套上传链路，减少攻击面与实现量 |
| O7 | **昵称安全与长度**：`msgSecCheck` v2 + ≤20 字截断 + 平台昵称输入可改 | §4.2/§11.3；DATA_MODEL/ENGINEERING | 昵称展示给他人，必须过内容安全 |
| O8 | **代客单视觉与边界**：guest 默认头像 + "代客单"标签、不产生绑定、不进入顾客列表 | §4.2；UX_PARTNER/UX_CUSTOMER | 代客单是最易混淆的数据形态，明确标识防误操作 |
| O9 | **统计口径分离**：后台总览/兼职单量统计排除测试账号与 `isTest` 订单 | §1.3/§4.2；DATA_MODEL/UX_DEVELOPER | 验收数据不能计入经营数字 |
| O10 | **多开发者账号**：白名单支持 `DEV-02…`、后台抬头显示当前 `developerNo`、会话/审计按 openid 隔离 | §1.1/§1.2；UX_DEVELOPER/ENGINEERING | 交接/协作时不共用账号，审计可区分 |
| O11 | **账号切换页合并**：`view-as` → `account-switch`（真实账号/测试账号两个 tab + 测试账号管理），后台仍 11 页 | §7；UX_DEVELOPER | 一个入口覆盖"看"与"验"，少一个页面 |
| O12 | **绑定/客户档案信息锚点**：绑定前预览"昵称+编号"（头像占位），绑定成功后"头像+昵称+编号"；订单详情/兼职客户档案展示绑定对方头像昵称 | §8/§10；UX_CUSTOMER/UX_PARTNER | 避免同名/无头像时无法确认对方，同时不在绑定前泄露头像 |
| O13 | **roomTag 排序与大写**：列表按 `dormKey + roomTag`（大写字母序=绑定顺序）；历史 tag 不复用 | §3/§4.2；DATA_MODEL/UX_PARTNER | 大写后排序稳定，展示 `D4-522A` 更醒目 |
| O14 | **QA 负向补齐**：兼职调 `bind.create`、真实账号 `TEST_WRITE`、真实×测试互绑/互下单、解绑后头像昵称消失、测试数据不进统计、头像/昵称隐私声明 | QA_CHECKLIST | 每条新口径都有可执行判据 |
| O15 | **隐私文本同步**：`docs/privacy` 两件新增头像/昵称/账号切换披露；微信后台声明头像/昵称 | §11.2；privacy 两件 | 提审前必须与真实收集一致 |
| O16 | **清理链路**：测试账号数据 30 天清理、`purgeTestData`、删除测试账号级联删头像 | §1.3/§4.2/§5.3；DATA_MODEL/ENGINEERING | 测试数据不长期堆积 |
| O17 | **旧口径清扫**：全文档清除"不收集头像 / roomTag 小写 / 第二个微信号验收 / MVP 单账号"等 v0.8 残句 | 全部文档 | 防止新旧口径并存导致实现漂移 |
| O18 | **文档一致**：D 编号 D1~D22、后台 11 页、14 集合、13 错误码不变；新增内容零金额 | 全部文档 | 保持既有索引与验收基线稳定 |
