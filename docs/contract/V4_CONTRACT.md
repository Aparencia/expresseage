# V4_CONTRACT · v4 设计统一口径卡（写作与实现的唯一事实源）

> 版本：v1.3（2026-10-21 首版 v0.9，后续 v1.0 增补 D23~D29、v1.1 增补 D30~D35、v1.2 增补 D36、v1.3 增补 D37~D42；按用户二次 + 三次 + 四次修订：①本程序只负责顾客下单/兼职接单/信息整理，**不涉及任何金钱交易：不做支付、收款、记账、结算、运费计算、价格表**；②顾客与兼职都有**不同样式的唯一编号**；③新增**开发者账号**：邀请码生效控制、后台数据查看、可**只读切换**顾客/兼职视角；④**OCR 识别失败兜底**：云函数调 **DeepSeek API** 对去敏文本做结构化兜底并**格式化返回**站点/取件码，仍失败则把**含原图的识别失败记录**反馈到开发者后台复核；⑤（v0.9）**绑定方向固化**：只能顾客绑定兼职，兼职**不能绑定顾客**；⑥（v0.9）开发者账号可**切换账号**：真实账号只读、**测试账号可写**（单机验收两端）；⑦（v0.9）同寝室标识 `roomTag` **恒大写**（`D4-522A`）；⑧（v0.9）顾客与兼职**均采集微信头像与微信昵称**，绑定双方档案可见）｜维护：lead｜状态：**D1~D42 已裁决/确认（D1~D22 于 2026-10-22 回复闭环；D23~D29 于 2026-10-22 晚、D30~D35 于 2026-10-27、D36~D42 于 2026-10-28 增补）**（D2 沿用 v3 appid `wxcb7e5b41b89bc806`；D8=东/西/南/北/翠苑；D13=个人主体+工具类目；D22=A→改判 B（见 D24）；其余按推荐；见 §13 与 `docs/contract/V4_DECISIONS.md` §0.1）
> **版本增补（2026-11-01）**：v1.4 增补 D43~D50（用户反馈裁决）；状态更新为 **D1~D50 已裁决/确认**，逐条见 §13 与 `docs/contract/V4_DECISIONS.md`（D43~D50 留痕）。
> **版本增补（2026-11-02）**：v1.9 增补 D58~D67（用户 2026-11-02 新 11 条需求逐条裁决：转派/子队员/件级取件/顾客邀请/筛选器/取件码一级入口/底部布局/文案/快递信息来源研究）；状态更新为 **D1~D67 已裁决/确认（D27 仍待裁决）**，逐条见 §13 与 `docs/contract/V4_DECISIONS.md`（D58~D67 留痕）。
> D1 同日修订（2026-10-22）：用户追加约束「云开发只能开通一个环境」⇒ **单环境部署**（develop/trial/release 三档同 envId，测试数据靠测试账号/`isTest` 隔离并在上线前清零）；见 §2 D1 与 `docs/contract/V4_DECISIONS.md` D1 修订留痕。
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
   - **码型（D59，v1.10）**：`kind='DEV'` 开发者主码（本节全能力）；`kind='SUB'` 主兼职子码——一次性、有效期 24h/72h/7d、可作废、每主兼职默认上限 `config.teamMaxMembers=5`；由 `partner.createSubInvites` 生成、`partner.revokeSubInvite` **按批次作废**（`{batchId}`：作废该主兼职该批全部未用 SUB 码，返回 `{batchId, revokedCount}`）；开发者后台对 SUB 码**只读**（不可作废）；旧记录无 `kind` 按 `DEV` 兼容（零迁移）。
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

## 2. 核心架构（D1~D50 见 §13）

- **D1 后端 = 微信云开发（云函数 + 云数据库 + 云存储）**。跨设备数据（订单、绑定、roomTag、邀请码、只读视角票据）必须有服务端；云开发零自建运维、openid 天然身份、与小程序同生态。**不接受"纯本地无后端"**。**用户 2026-10-22 追加约束：账号只能开通 1 个云环境 ⇒ v4 采用单环境部署**——develop/trial/release 三档共用同一 envId；测试数据靠测试账号/`isTest` 标记隔离，并在上线前 `admin.purgeTestData` 清零；`config/env.js` 保留 envVersion→envId 映射形状，将来可开第二环境时只改该文件拆回 dev/prod（详见 `docs/contract/V4_DECISIONS.md` D1 修订留痕）。
- **D2 appid = `wxcb7e5b41b89bc806`**（**用户 2026-10-22 裁决：沿用 v3 appid**，与推荐的新 appid `wxf98c87a293092ef5` 不同）。因此：v4 与 v1/v2/v3 **同一 storage 命名空间**，v4 只读写自己的 `ex_college_v4.store`，**不读写** v1/v2/v3 任何本机键；云开发环境按 D1 修订采用**单环境**（见 D1）；**发布 v4 即替代 v3（同一个小程序）**，v3 仅作历史只读参照；隐私声明/类目/审核在同一 appid 上重新提交（不再享有"独立审核"）。
- **D3 兼职准入 = 邀请码**（开发者后台生成：一次性、可设有效期、可作废、可审计）。激活成功即把 openid 绑定为 partner 并分配 `partnerNo`；换微信号需开发者重新发码。**测试账号不走邀请码**（由后台直接创建，§1.3）。
- **D4 绑定关系 = 一个顾客同时只绑定一个兼职（1:1 active）**；**绑定只能由顾客发起**（凭完整 `partnerNo` 或卡片落地）：顾客可换绑（无进行中订单时）；兼职可解绑顾客（填原因并通知），但**兼职不能发起/代绑/导入顾客**；历史订单保留。详见 §4.2 铁律。
- **D5 服务 = 只定义"服务类型"（标准代取/送至楼下/加急代取/代寄/其他代办；D41 修订），不含价格、不做定价权、不做运费**。开发者给默认类型模板，兼职在服务配置里启用/停用并设接单范围。**用户已定，无定价口径（v0.7 关闭原"兼职定价"方案）**。
- **D6 金钱 = 零交易**：不做在线支付、收款、记账、结算、运费计算、价格表与任何金额字段。**用户已定（v0.7 关闭）**。原 v0.6 的"线下收款记账/payStatus/结算文本"全部删除。
- **D7 roomTag 区分标识 = 服务端分配、独立字段 `roomTag`**，作用域 = **（兼职, 宿舍）**：同一兼职名下同一 `dormKey` 的顾客按绑定顺序得 **A、B、C…（恒大写，Excel 列名式）**；展示 `D4-522A`；换宿舍重新分配，旧标签不复用。**v0.9：恒用大写字母（用户四次修订）。**
- **D8 "五个苑" = v3 的 D/X/N/B/C 五个楼区字母**（固定顺序）。**用户 2026-10-22 裁决展示名：D=东苑、X=西苑、N=南苑、B=北苑、C=翠苑**（C 的含义=翠苑）；默认值已写进 `shared/zones.js`，`config.zoneLabels` 可覆盖（后台 `admin.updateConfig`）。
- **D9 截图 = 压缩后上传云存储私有目录**，仅订单双方经云函数鉴权后的临时 URL 可见；完成/取消后 **7 天**删除；截图不出现在通知、日志、分享卡片。
- **D10 通知 = 站内实时（轮询 + 红点 + 下拉刷新）必做**；微信订阅消息 P1（模板 ID 进 `config`，不硬编码）。
- **D11 v3 数据 = 不迁移**，v4 空库起；v3 旧小程序留作只读参照。确需手工导入另立卡。
- **D12 兼职"代客下单"保留**（覆盖没有用 app 的顾客）：兼职可用 v3 录入能力给未绑定顾客建单；**代客下单不产生绑定**，分享绑定卡片只是"邀请顾客来绑"，绑定动作必须顾客本人完成。详见 §4.2。
- **D13 主体与类目**：**用户 2026-10-22 裁决：个人主体 + 工具类目**。提审批次需在微信后台确认该主体可选类目与本产品匹配（"校园快递代取的信息与履约工具"表述，不做快递业务经营表述）；若类目不可选或被驳回，按"换子类目→调整描述→企业主体→仅体验版"顺序处理（**提审风险项**，不影响已完成的工程实现；详见 `docs/contract/V4_DECISIONS.md` D13 留痕）。
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
| 性别 | `gender` / `genderManual` | `MALE`/`FEMALE`/`UNKNOWN`；默认按「苑+楼栋」推断（仅东苑 D：1/2/5-8 男、3/4/9-10 女），可手动修改；未知不阻塞资料保存；**仅本人可见**（兼职端暂不配置/不展示，后台不展示；D31） |
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
| 服务类型 | `serviceCode` / `serviceName` | 默认：`PICKUP_STD`（送寝室门口）/ `PICKUP_LOW`（送至楼下）/ `PICKUP_URGENT` / `DROP_OFF` / `CUSTOM`（D41；原 `PICKUP_DOOR` 停用、仅历史订单展示）；**只有类型名称与说明，无价格** |
| 幂等键 | `clientRequestId` | 客户端生成 16~32 位；所有写动作必传；服务端去重 |
| 账号切换票据 | `viewTicket` | 32 位随机；仅开发者切换会话（`viewMode='READONLY'|'TEST_WRITE'`）；内存保存；默认 30 分钟；兼容旧称"只读视角票据" |
| 站点正式名 | `config.stations[{id,name}]` | **D32（v1.1）**：id 固定 v3 的 P1~P8（不自建站点）；**正式名由开发者在后台修改**（1~20 字、非空、唯一；旧配置缺省/非法回退 `shared/stations.js` 默认）；识别/手输按「精确名 → 去标点规范名 → 静态别名 → 关键词命中」唯一归一，多解/无解不猜；订单存 `stationId + stationName` 快照 |

**金额**：本程序**不存在**金额字段、金额计算与金额文案；任何文档/代码出现 `*Fen`、`price`、`fee`、`pay`、`金额`、`价格`、`运费`、`收款`、`结算` 均为缺陷（工程门禁扫描项，见 `docs/engineering/V4_ENGINEERING.md`）。
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
5. **用途不同**：`customerNo` 只用于识别/客服/后台搜索，**不作为登录或绑定凭据**，仅本人、其绑定兼职、开发者可见；`partnerNo` 是顾客绑定的**唯一凭据**（完整编号），可分享卡片，但永不提供搜索/列表/枚举接口、限流见 §10（D39：预览+提交合计滚动 60 秒/5 次）。
6. **展示**：顾客"我的"显示自己的编号（可复制）；兼职"我的"显示自己的编号（可复制/分享绑定卡片）；订单详情小字显示对方编号（顾客看兼职编号、兼职看顾客编号）；后台列表/详情显示编号、**不显示 openid**；分享卡片只带 `partnerNo`，不带宿舍/尾号/称呼。
7. **生成时点**：`customerNo` 在顾客资料首次创建成功时生成（`user.bootstrap`/`customer.saveProfile` 内保证幂等）；`partnerNo` 在邀请码激活成功、创建 `partners` 文档时生成。

---

## 4. 数据模型（集合级摘要，字段级见 `docs/data/V4_DATA_MODEL.md`）

| 集合 | 主键 | 关键字段 | 说明 |
| :-- | :-- | :-- | :-- |
| `users` | `_id=openid`（测试账号 `_id='TEST-…'`） | `roles[]`（CUSTOMER/PARTNER）、`status('ACTIVE'|'DEACTIVATED')`、`isTestAccount`（默认 false）、`createdByDeveloperNo?`、`createdAt`、`lastLoginAt`、`messageReadAt`、`privacyConsent{version,at}`、`deletionRequestedAt` | 账号层：真实账号一个 openid 一条；测试账号=合成账号（无 openid、仅开发者可切换、不计统计）；角色标记（DEVELOPER 不落库） |
| `customers` | `_id=openid` | **`customerNo`(唯一)**、**`displayName`(昵称，必填)**、`avatarFileId`（可空→默认头像）、`zone/buildingNo/room/dormKey`、`phoneTail`、**`gender`(MALE/FEMALE/UNKNOWN，D31：默认按苑+楼栋推断、可手动修改)**、**`genderManual`(bool：是否手动改过)**、`profileCompleted`、`createdAt`、`updatedAt` | 顾客资料；宿舍身份；昵称/头像/性别；唯一编号（性别仅本人可见，兼职端与后台不展示） |
| `partners` | 自增 | `openid`(唯一；测试账号为合成 `TEST-<random>`)、**`partnerNo`(唯一)**、**`displayName`(昵称，必填)**、`avatarFileId`（可空→默认头像）、`status('ACTIVE'|'SUSPENDED'|'CLOSED')`、`deletedAt`、`serviceConfig{...}`（字段以 §4.2/§6 为准）、`stats{...}`、`activatedAt`、**`parentPartnerId`（D59：`''`=主兼职/独立；否则=主兼职 `_id`，**层级仅一层**）、`teamJoinedAt`（加入队伍时刻，可空）** | 兼职资料、头像/昵称、服务类型/范围配置、单量统计；**D59 起子队员为独立兼职账号（独立编号/昵称/头像/服务配置），隶属仅一层、顾客不可绑子队员** |
| `bindings` | 自增 | `activeKey`(唯一)、`customerId=openid`、`partnerId`、`status('ACTIVE'|'RELEASED')`、`roomTag`、`dormSnapshot{...}`、`partnerNote`、`releaseReason`、`releaseNote`(≤100)、`boundAt`、`releasedAt` | 绑定关系 + roomTag + 兼职私有备注；**只能由顾客发起创建**（§4.2） |
| `orders` | 自增 | `orderNo`(唯一)、`requestKey`(唯一)、`customerId`/`customerOpenid`/**`customerNo`快照**/`partnerId`/`partnerOpenid`/**`partnerNo`快照**、`source('CUSTOMER'|'PARTNER')`、`isTest`(bool，测试数据标记)、`impersonatedBy?`(测试写时的 `developerNo`)、`status`、**`parcels[]{...}`（v1.0 一单多包裹，1~10 件）**、**`images[]{fileId,width,height,cleanedAt?}`（0~10 张，D23/D40；0=无截图手填，D24；识别失败关联只落 `parcels[].failureId`，`images[]` 不存 `failureId`）**、**`manualEntry`(bool，无截图手填标记)**、`dorm{...}`（下单人宿舍快照）、**`delivery{zone,buildingNo,room,dormKey,buildingText,recipientName?,phoneTail?}`（本单配送地址，默认=下单人宿舍，可改他人宿舍，D25）**、`guest{...}`(代客单)、`service{code,name}`、`appoint{...}`、`note`、`exception{...}`、**`transfer{...}`（D58 最近一次转派记录，见 §4.2；缺省=从未转派）**、`deliveryNote`、`cancelReason`、`cancelledBy`、`deletedByCustomerAt`、`anonymizedAt`、显式时间戳、`batchActionId`、`clientRequestId`、`version` | 订单主表（v1.0 批量下单/合并窗口见 D23，一单多包裹）；**无任何交易字段（零金额口径）** |
| `order_events` | 自增 | `orderId`、`orderNo`、`type`、`fromStatus`、`toStatus`、`actorRole`、`actorId`、`impersonatedBy?`、`at`、`note`、`payload`、`requestKey`(唯一) | 全量状态流水（审计/进度条数据源） |
| `order_messages` | 自增 | `orderId`、`fromRole`、`fromId`、`text`(≤200)、`templateCode?`、`createdAt`、`readAt` | 订单留言（含快捷模板） |
| `invitation_codes` | 自增 | `code`(唯一)、`status('UNUSED'|'USED'|'REVOKED'|'EXPIRED')`、**`kind('DEV'|'SUB')`（D59：DEV=开发者主码、SUB=主兼职子码；旧记录缺省按 DEV 兼容）**、**`issuerPartnerId`（SUB 码=发码主兼职 `_id`；DEV 恒 `''`）**、`batchId`、`expiresAt`、`usedBy`、`usedAt`、`note`、`createdBy`、`createdAt` | 邀请码：开发者发主码（§1.1）；**D59 起主兼职可发一次性子码**（旧 `activation_codes` 更名；测试账号不消耗邀请码） |
| `admin_view_sessions` | `_id=viewTicket` | `adminOpenid`、`developerNo`、`viewMode('READONLY'|'TEST_WRITE')`、`role('CUSTOMER'|'PARTNER')`、`targetId`、`targetNo`、`targetDisplayName`、`targetAvatarFileId?`、`targetIsTest`、`createdAt`、`expiresAt`、`endedAt` | 开发者切换会话票据（真实账号只读 / 测试账号可写，§1.2/§1.3） |
| `counters` | 自增 | `key`(唯一)、`seq`、`updatedAt`；键族：`orderNo:YYYYMMDD`、`tag:{partnerId}:{dormKey}`、`rl:{scope}:{openid}:{window}`（限流，cleanup 清理过期） | 原子自增（事务） |
| `config` | `_id='global'` | `zoneLabels`、`serviceCatalog[{code,name,desc}]`（仅类型与说明，无任何交易信息）、`announcement`、`maintenance`、`orderTimeoutMinutes`、**`autoCompleteAt`（D43/D51：UTC+8 的 `HH:MM` 时刻文本，默认 `22:00`；日结批 cutoff=该单送达日当天的该时刻，22:00–24:00 送达的下一轮 10 分钟批内完成；旧的「小时数」键作废）**、`screenshotRetentionDays`、`recognitionFailureRetentionDays`（7~30，默认 30）、`aiFallback{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}`、**`orderMergeWindowMinutes`（v1.0：短间隔自动合并窗口，默认 10，0=关闭，范围 0~60；D23）**、`viewTicketTtlMinutes`、`avatarMaxBytes`（默认 200KB）、`testAccountMaxPerRole`（默认 3）、`testDataRetentionDays`（默认 30）、**`stations[{id,name}]`（D32：固定 P1~P8、正式名可改、名称 1~20 字唯一；进公开子集）**、**`transferTtlMinutes`（D58：默认 10，范围 1~60）、`transferRate{perMinute:3,perDay:20}`、`teamMaxMembers`（D59：默认 5，范围 1~10）、`subInviteRate{perMinute:3,perDay:20}`（四项均不入公开子集、后台白名单不变）**、`privacyVersion`、`updatedAt` | 全局配置（admin 维护，无交易项；`aiFallback` v0.8 新增，值为次数/毫秒/布尔，**无交易字段**；v0.9 新增头像与测试账号配置；v1.0 新增合并窗口；v1.1 新增站点名称（D32）；v1.4 新增 `autoCompleteAt` 日结批时刻（D43）；**v1.10 新增转派时效/限流与队伍上限/发码限流（D58/D59）**） |
| `admin_audit` | 自增 | `adminOpenid`、`developerNo`、`action`、`target`、`detail`、`at` | 管理操作审计 |
| `upload_tickets` | 自增 | `ticket`(唯一随机)、`openid`（TEST_WRITE 下=effectiveOpenid）、`purpose('TICKET'|'AVATAR')`、`cloudPath`（不含 openid）、`expiresAt`、`usedAt`、`createdAt` | 截图/头像上传票据（§4.1） |
| `recognition_failures` | 自增 | `failureNo`(唯一)、`requestKey`(唯一：`{uploaderOpenid}:{clientRequestId}`，写动作幂等)、`failureCode`、`sourceRole('CUSTOMER'|'PARTNER')`、`uploaderOpenid`、`uploadTicketId`、`fileId`、`orderId?`、`ocrTextMasked`(≤2000)、`ruleResult`、`aiTried`、`aiModel`、`aiResult`、`aiErrorCode`、`status('PENDING'|'FIXED'|'IGNORED')`、`resolution{stationId,stationName,pickupCode,note,by,at}`、`createdAt`、`reviewedAt` | 识别失败复核队列（v0.8，含原图引用；仅开发者后台可见，审计；§4.3） |

**`orders` 补充字段**：`cancelReason`、`cancelledBy('CUSTOMER'|'PARTNER'|'SYSTEM'|'ADMIN')`、`deletedByCustomerAt`、`deliveryNote`(≤100)、`exception{code,text,fromStatus,by,at}`、`batchActionId`、`version`、`isTest`（测试数据标记，快照自参与账号）、`impersonatedBy`（测试写会话的 `developerNo`，真实流程为空）。**`orders.transfer`（D58，v1.10）**：`{status,fromPartnerId,fromPartnerNo,toPartnerId,toPartnerNo,requestedAt,expiresAt,resolvedAt,resolveReason}`；**单值覆盖**（连续转派只留最近一次，全量历史在 `order_events`）；不落 `toPartnerOpenid`；缺省=从未转派，DTO 恒返回 `transfer:null`（旧单零迁移）；`anonymizeOrder` 清 `fromPartnerNo/toPartnerNo` **与内部 id `fromPartnerId/toPartnerId` 一并清空**、保留 `status/resolveReason`；订单匿名化同时清内部 id `customerId/customerOpenid/partnerOpenid`（`partnerId` 留统计口径）。**`fulfillmentPartnerNo`** 为只读派生（=`orders.partnerNo` 快照，顾客据此看到"当前实际履约的是谁"，仅编号）。**订单无任何交易字段（`addons` 等均不存在；零金额口径，见 §12）**。
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
3. 下单云函数校验每张 ticket 归属、路径一致、文件大小/类型（jpg/png，≤500KB），把 `fileId` 写入订单 `images[]`（v1.0：一单可 0~10 张截图，一张截图一个 ticket；D23/D24，D40 上限 10）。
4. 查看：`order.imageUrl` 云函数鉴权后 `cloud.getTempFileURL`（5 分钟），入参含 `index` 取 `images[index]`。
5. 清理：`cleanup` 定时删除完成/取消超 7 天的文件；同一 fileId 被多张订单/多条复核记录引用时只在无引用后删（引用计数覆盖 `orders.images[]`）。
6. **识别失败引用（v0.8）**：识别失败记录 `recognition_failures.fileId` 引用同一原图；复核期内保留 `recognitionFailureRetentionDays`（默认 30 天，长于订单截图 7 天）；到期删引用，若订单仍在截图留存期则继续按订单规则保留。
7. **头像上传（v0.9）**：`upload.prepare({purpose:'AVATAR'})` → 云存储路径 `avatars/{role}/{random}.jpg`（不可猜随机段）；客户端压缩到 **≤200KB、jpg/png、建议 200×200**；保存资料时校验 ticket 归属/路径/大小/类型后写 `avatarFileId`；**替换头像即删旧文件**；注销/删除测试账号时删头像文件；默认头像不占存储（客户端本地绘制首字色块）。**头像与截图同一套私有存储规则（客户端不可直接读；D42：展示统一走临时 URL 通道——本人 `user.avatarUrl`、绑定对方随绑定 DTO（`bind.getCurrent`/`user.bootstrap.binding`）下发 `avatarUrl`，`avatarFileId` 保留为回退键，客户端不得把 `cloud://` 直接塞 `<image>`）**。

### 4.2 字段/枚举补充（字段级细节以 `docs/data/V4_DATA_MODEL.md` 定稿）

- `users`：`roles ∈ {CUSTOMER, PARTNER}`（**DEVELOPER 不落库**，由环境变量 `ADMIN_OPENIDS` 判定，避免改库提权）；`status ∈ {ACTIVE, DEACTIVATED}`；`messageReadAt`；`deletionRequestedAt`；`isTestAccount`（默认 false；true = 后台创建的合成账号，`_id='TEST-…'`、无真实 openid、不得与真实账号互操作、不计统计）；`createdByDeveloperNo/testLastUsedAt`（仅测试账号）。
- `customers`：`customerNo`（唯一、生成后不可改，§3.1）；`displayName`（**昵称，必填**，≤20 字，首次从微信昵称一键填入、可改/手填，保存过 `security.msgSecCheck` v2）；`avatarFileId`（可空→默认头像；`avatars/customer/{random}.jpg`，≤200KB）；**`gender ∈ {MALE,FEMALE,UNKNOWN}`**（D31：默认按「苑+楼栋」推断——仅东苑 D：楼栋 1/2/5/6/7/8 男、3/4/9/10 女，其余苑/非法楼栋=未知；可手动修改并置 `genderManual=true`，未手改时换宿舍跟随推断、手改值保留；未知不阻塞 `profileCompleted`；当前仅本人可见，兼职端不配置、后台不展示）；`createdAt/updatedAt`；**不加** `note`（兼职私有备注放 `bindings.partnerNote`）。
- `partners`：`partnerNo`（唯一、生成后不可改）；`displayName`（**昵称，必填**，≤20 字，激活时从微信昵称一键填入、可改；`partner.saveProfile` 可改）；`avatarFileId`（可空→默认头像；`avatars/partner/{random}.jpg`，≤200KB）；`status ∈ {ACTIVE, SUSPENDED, CLOSED}`；`CLOSED`=注销（`deletedAt` + 资料匿名化、不可恢复、绑定释放、订单转异常/完成）；`serviceConfig` 见 §6；`stats` 只含单量（如 `{todayOrders,totalOrders,completedOrders}`，**无收入字段**）；`maxDailyOrders/businessHours/autoAccept` 为 P1 预留。**测试兼职**：`openid='TEST-<random>'`（合成，非真实微信 openid）、默认服务配置全开、范围=全部苑、`acceptingOrders=true`，不计统计。**子队员（D59，v1.10）**：`parentPartnerId`（`''`=主兼职/独立；否则=主兼职 `_id`，**服务端强制仅一层**：发码者必须 `parentPartnerId===''`）、`teamJoinedAt`（SUB 码激活时写）；子队员为独立兼职账号（独立 `partnerNo`/昵称/头像/服务配置），**顾客不可绑子队员**（`partner.getPublic`/`bind.create` 均 `NOT_FOUND`，不暴露存在性）、**子队员禁代客下单**（`order.create` 的 `bindingId`/`guest` 两路 `FORBIDDEN`）；主兼职停用/注销时**级联**同 `parentPartnerId` 子队员（`SUSPENDED`/`CLOSED`）并把该队 `PENDING` 转派邀请落 `CANCELLED`（`reason=STATE_CHANGED`）；`removeSubMember`=解除隶属（`parentPartnerId=''`）+`status='SUSPENDED'`（`suspendedReason='TEAM_REMOVED'`，恢复需开发者）；子队员 CLOSED 走既有 PII 匿名化、`parentPartnerId` 保留（层级审计）。
- `bindings`：`activeKey`（唯一索引：ACTIVE 时 = `customerId`；RELEASED 时 = `customerId:RELEASED:bindingId`）；`partnerNote`（≤100，顾客不可见，随顾客注销删除）；`releaseReason ∈ {CUSTOMER_INITIATED, PARTNER_INITIATED, PARTNER_CLOSED, ADMIN_ACTION, CUSTOMER_ACCOUNT_CLOSED}`。
- **绑定方向铁律（v0.9，用户四次修订）**：①**只有顾客能发起绑定**：`bind.create` 仅允许业务角色为 CUSTOMER 的调用者；PARTNER 调用一律 `FORBIDDEN`；②兼职端**不得**出现"添加顾客/绑定顾客/导入顾客/扫码绑定顾客"任何入口，也不得批量建立绑定；③**代客下单不产生绑定**，`bindings` 不得由订单创建流程隐式写入；④兼职只能 `unbindCustomer`（填原因、通知顾客），解绑≠重新绑定；⑤绑定解除后，双方**不再能看到对方头像/昵称**（DTO 按 ACTIVE 绑定关系返回）；⑥测试账号只能与测试账号互相绑定，真实账号×测试账号的绑定请求一律 `FORBIDDEN`；⑦**不能自绑**：顾客的 openid 与其要绑定的兼职 openid 相同（同一 openid 兼顾客+兼职）时 `bind.create` 返回 `FORBIDDEN`（禁止自己下单给自己）；⑧`partner.getPublic` 在绑定前**只回昵称、不回头像**（头像在 ACTIVE 绑定后才下发）；⑨**自动绑定边界（D38，2026-10-28 用户拍板「隐私同意、用户信息均完成后直接绑定，不再要求顾客手动绑定」）**：邀请卡落地的新用户按「隐私同意 → 资料补齐」顺序完成后，客户端**保存成功后自动调 `bind.create`**（一次，不再要求顾客在绑定页点「确认绑定」）；已同意+资料完整的成熟用户从邀请卡点「绑定这位兼职」直接自动发起；**仍必须顾客本人 openid 发起，并满足隐私同意/资料完整/未自绑/测试隔离校验；不得后台静默绑定、不得替顾客点、不得跳过隐私或限流**；已绑定同号只提示「已绑定·去下单」，不重复 create；换绑仍按 D28 一次确认。
- `orders` 身份字段关系：`customerId` = openid 引用键，`customerOpenid` = 同值快照；`partnerId` = partners._id，`partnerOpenid` = 快照；`customerNo/partnerNo` = 建单/接单时编号快照（用于展示与后台搜索，不参与鉴权）；**代客单（guest）customerId/customerOpenid/customerNo 为空**；`isTest` = 参与账号 `isTestAccount` 的快照（测试数据永不计入统计）；`impersonatedBy` 仅测试写会话写入（真实流程为空）。显式时间戳：`statusUpdatedAt/acceptedAt/pickedAt/deliveredAt/completedAt/cancelledAt`。创建幂等：`requestKey` 唯一（`{customerId|partnerId}:{clientRequestId}`）；测试写会话以目标测试账号身份生成幂等键。写动作幂等：`order_events.requestKey` 唯一（`{orderId}:{action}:{clientRequestId}`）。留存幂等：`anonymizedAt`。**v1.0 订单聚合字段（D23/D25）**：`parcels[]`（每件：`stationId/stationName/pickupCode/lockerNo/trackingTail/codeStatus/recognitionSource?/confidence?/imageIndex?`，字段级以 DATA_MODEL §2.5 定稿；`imageIndex` 只在落库时记录来源截图下标、**不下发 DTO**）、`images[]`（`{fileId,width,height,cleanedAt?}`；`manualEntry=true` 时为空；失败关联只在 `parcels[].failureId`）、`manualEntry`（无截图手填标记）、`delivery`（本单配送地址快照，默认=下单人宿舍；**不写入 customers、不触发重绑/roomTag**）。订单级动作（接单/取件/送达/取消/超时）作用于全部包裹；`order.correct` 按包裹序号 `itemIndex` 纠正；不设包裹级状态。**D58 转派只改订单归属三键（`partnerId/partnerOpenid/partnerNo`），不改订单号/顾客/绑定/roomTag/包裹/配送/`status/statusUpdatedAt/acceptedAt`；`transfer` 为单值覆盖的最近一次记录；`fulfillmentPartnerNo` 恒为当前 `partnerNo` 快照（V1.10）。**
- **`roomTag` 触发点**：资料完整是绑定前提；`roomTag` 在**绑定成功时**分配（此时才有 partnerId）；同一（兼职, dormKey）按绑定先后得 **A、B、C…（恒大写）**；已绑定期间顾客改宿舍 → 在新 dormKey 下重新分配，旧 tag 不复用；未绑定前不分配；解绑后 tag 保留在历史绑定记录（`status=RELEASED`）不再复用。
- **代客单（D12）**：`source=PARTNER`、`customerId=''`、`customerOpenid=''`、`customerNo=''`、`guest{displayName,phoneTail,zone,buildingNo,room,dormKey}` 快照；**代客单不产生绑定**（顾客后续绑定必须本人发起）；guest 无真实微信资料 → 展示**默认头像** + "代客单"标签；MVP **不提供顾客认领**；P1 再做认领（`claimTokenHash/claimExpiresAt/claimedAt` 预留）。
- `counters`：键族 `orderNo:YYYYMMDD`、`tag:{partnerId}:{dormKey}`、`rl:{scope}:{openid}:{window}`；不设 `tagSeq`。
- **站点值域（MVP，D32 修订）**：站点 id 固定 v3 的 P1~P8（**不做自建站点**）；**正式名由开发者在后台 `config.stations` 修改**（名称 1~20 字、去重、缺省回退内置默认；进公开子集供选择器/识别/AI prompt 使用）；识别与手输按「精确名 → 去标点规范名 → 静态别名 → 关键词命中」归一，**唯一命中才采信，多解/无解不猜**（用户 2026-10-27：截图存在多种说法，用匹配命中方式）。订单存 `stationId + stationName` 快照。
- `order_events.type`（**v1.10 起 24 种**）：`ORDER_CREATED / ACCEPTED / REJECTED / PICKED / PICKED_REVERTED / DELIVERED / DELIVERED_REVERTED / COMPLETED / AUTO_COMPLETED / CANCELLED / TIMEOUT_CANCELLED / EXCEPTION_REPORTED / EXCEPTION_RESOLVED / ORDER_CORRECTED / PARCELS_APPENDED（v1.0 合并窗口追加包裹）/ PARCEL_PICKED / PARCEL_PICKED_REVERTED（D61 件级取件/撤销，payload `{itemIndex}`）/ DELETED_BY_CUSTOMER / GUEST_ORDER_CLAIMED(P1) / **TRANSFER_REQUESTED / TRANSFER_ACCEPTED / TRANSFER_DECLINED / TRANSFER_CANCELLED / TRANSFER_EXPIRED（D58，`ACCEPTED→ACCEPTED`，payload `{fromPartnerNo,toPartnerNo}`；`REQUESTED` 另带 `expiresAt`）**`；`actorRole ∈ {CUSTOMER, PARTNER, ADMIN, SYSTEM}`。**D58 五个 `TRANSFER_*` 中只有 `TRANSFER_ACCEPTED` 进顾客消息中心并计未读（`MESSAGE_HIDDEN_EVENT_TYPES` 拉黑其余 4 个私有事件，`message.list` 构造事件项时跳过）**。**事件表不含任何交易类语义（零金额口径）。** **事件上屏文案纪律（W3 收尾，兼职详情时间线）**：事件行只渲染已映射文案（状态类走 `shared/order-state` 状态文案，件级/转派等走事件映射表，`type` 只作映射键）；**未登记事件类型不渲染、不裸英文上屏**（宁可少一行，也不向用户暴露内部事件名/错误码）；新增事件类型必须同批补映射，映射缺失即不可见。
- **留痕时间线**：订单终态 → 保留 180 天 → 匿名化（去 openid/昵称/尾号/宿舍/截图引用，写 `anonymizedAt`）→ 再 30 天物理删除；顾客对 `COMPLETED` 单条"删除记录"→ 7 天后物理删除；截图在终态/取消后 7 天删除；注销=立即匿名化+删截图+30 天内物理删除+删 `partnerNote`。
- **admin 审计**：`admin_audit.action` 至少含 `INVITE_CREATE / INVITE_REVOKE / PARTNER_SUSPEND / PARTNER_RESTORE / CONFIG_UPDATE / ORDER_ANOMALY_CANCEL / BOOTSTRAP`；**v0.8 增** `FAILURE_IMAGE_VIEW / FAILURE_FIX / FAILURE_IGNORE`（识别失败复核，§4.3）；**v0.9 增** `ACCOUNT_SWITCH_START / ACCOUNT_SWITCH_END / ACCOUNT_SWITCH_EXPIRED / TEST_ACCOUNT_CREATE / TEST_ACCOUNT_DELETE / TEST_DATA_PURGE`（`ACCOUNT_SWITCH_*` 的 `detail` 记 `viewMode/targetIsTest`；**旧 `VIEW_AS_*` 作废**）；MVP 不单独建 audit 页，审计区块并入 `pkg-admin/pages/overview/index`。**`admin.setPartnerStatus` 的审计 `detail` 键（W3 收尾）**：`partnerNo/from/to/toState/reason/affectedBindings/affectedOrders/affectedMembers/cancelledTransfers/detachedFromParent`（`detachedFromParent=true` = 恢复子队员时上级不可用而解除隶属）。
- **限流落点（v1.10 统一一份，勿在别处另列）**：统一用 `counters.rl:{scope}:{openid}:{window}`；scope 至少 `bind/activate/order/message/viewAs/avatarUpload/upload/ai/transfer/subInvite`；窗口按滚动时间窗或自然日（D39：绑定相关=滚动 60 秒/5 次）；超限返回 `RATE_LIMITED`。**账号切换（含测试账号）20 次/日/开发者；头像上传 5 次/日/人。** **D58 转派**：`rl:transfer:{effectiveOpenid}:{wYYYYMMDDHHmm}` 与 `:d{YYYYMMDD}`，阈值读 `config.transferRate{perMinute,perDay}`（出厂默认 3 次/分钟、20 次/日）；**D59 子邀请码**：`rl:subInvite:{effectiveOpenid}:{wYYYYMMDDHHmm}` 与 `:d{YYYYMMDD}`，阈值读 `config.subInviteRate{perMinute,perDay}`（出厂默认 3 次/分钟、20 次/日）；**AI 兜底**不设每人每日次数（D40），保留全局日配额 `config.aiFallback.dailyQuota`，超限静默降级不返回错误码。
- **账号切换会话**：`admin_view_sessions` 见 §1.2/§1.3；票据服务端生成、不落客户端存储；每次请求校验票据存在、未过期、`endedAt` 为空、发起人仍白名单；`viewMode=TEST_WRITE` 时额外校验目标 `isTestAccount=true`、`target.status=ACTIVE`；写请求必须同时匹配 `impersonatedBy` 与目标身份（防止票据被挪用到其他账号）。
- **邀请码字段**：`invitation_codes{code(唯一), status, kind('DEV'|'SUB'), issuerPartnerId(SUB 码=发码主兼职 `_id`；DEV=''), batchId, expiresAt, usedBy(partnerId), usedAt, note, createdBy(DEV=`developerNo`；SUB=`'PARTNER:'+partnerNo`), createdAt}`；`expiresAt=null` 不允许（必须设有效期）；过期判定以服务端时间；`partner.activate` 读 `kind='SUB'` 码时同事务写 `partners.parentPartnerId=issuerPartnerId` 与 `teamJoinedAt`（`DEV`/缺省不改）。
- **v0.6 一致性补充（继续有效）**：资料编辑规则（宿舍身份仅无进行中订单时可改，改宿舍=旧绑定释放+新绑定+新 roomTag，订单快照不变）；截图云存储路径 `orders/{ticket}/image.jpg`；接单开关语义（`serviceConfig.acceptingOrders=false` ⇒ `order.create` 返回 `PARTNER_CLOSED`）；兼职公开预览（`partner.getPublic({partnerNo})`，未绑定可调、限流 5 次/日/顾客、**绑定前只回昵称（不回头像）**；测试账号返回 `NOT_FOUND`）；列表 DTO 分级（本人数据完整；admin 后台默认脱敏；完整值只在只读视角）；解绑原因必填；客户列表按 dormKey/roomTag 排序；工作台查询含 `SUBMITTED/ACCEPTED/PICKED/DELIVERED/EXCEPTION` 五类、`counts` 6 项；异常上报允许 `ACCEPTED/PICKED/DELIVERED`；动作登记（`bind.getCurrent`、`admin.bootstrap` 内部动作）；订阅消息模板放 `config`；邀请码错误映射（不存在/已作废→`NOT_FOUND`、已过期→`INVITE_EXPIRED`、已使用→`INVITE_USED`、格式错→`VALIDATION_FAILED`）；文本上限（`exception.text` ≤200、`lockerNo` ≤10）；隐私级别 L1/L2/L3；**收集微信头像/昵称（v0.9 变更，见 §11；原文"不收集头像"作废）**。
- **v0.8 识别兜底字段（字段名以 `docs/data/V4_DATA_MODEL.md` 定稿）**：`orders.parcel` 增识别来源与置信度（`recognitionSource ∈ {RULE, DEEPSEEK, MANUAL}`、`confidence?`）；`orders.image` 增 `failureId?` 关联复核队列（**v1.0 起失败关联只落 `parcels[].failureId`，`images[]` 不存 `failureId`**，见 §4.3）；同一截图的多张订单**共享同一 `fileId`**；若多单都识别失败，则**每单各一条失败记录**（`failureId` 按单独立，便于逐单补录/逐单回填）。**均为可选字段，不加任何金额语义**。
- **v0.9 账号切换与测试账号字段（字段名以 `docs/data/V4_DATA_MODEL.md` 定稿）**：`users.isTestAccount/createdByDeveloperNo/testLastUsedAt`；`orders.isTest/impersonatedBy?`；`order_events.impersonatedBy?`；`admin_view_sessions.viewMode/targetIsTest/targetAvatarFileId`；`config.avatarMaxBytes/testAccountMaxPerRole/testDataRetentionDays`。**测试数据清理**：`cleanup` 每日清理超过 `testDataRetentionDays`（默认 30 天）未使用的测试账号业务数据（保留账号与审计摘要）；`admin.purgeTestData` 立即清空（二次确认 + 审计）；`admin.deleteTestAccount` 删账号 + 数据 + 头像。
- **v0.9 头像/昵称可见范围**：`customers/partners.displayName + avatarFileId` 只随"当前 ACTIVE 绑定关系"对对方返回（顾客看到绑定兼职的；兼职客户档案看到绑定顾客的）；**绑定前预览只回昵称、不回头像**，绑定成功后订单列表/详情、绑定确认页、客户档案展示头像+昵称；解绑/停用/注销后不再返回；通知/分享卡片/后台列表/日志**不含头像 fileId 与完整昵称**。**D42**：头像展示统一走临时 URL（`user.avatarUrl` 本人 / 绑定关系 DTO `avatarUrl`），客户端不直读 `cloud://`；保存资料时头像票据失效**不得清空已有头像**（保留 `avatarFileId` 并提示重试）。

- **v1.10 转派与队伍字段（D58/D59，2026-11-03）**：`orders.transfer`（见 §4 补充字段）与只读派生 `fulfillmentPartnerNo`；`partners.parentPartnerId/teamJoinedAt`；`invitation_codes.kind/issuerPartnerId`；`config.transferTtlMinutes/transferRate/teamMaxMembers/subInviteRate`。**D58 可见性边界**：`transfer` 块按角色剪裁（顾客仅 `ACCEPTED` 后见 `status/toPartnerNo`；收发双方见白名单键 `status/fromPartnerNo/toPartnerNo/requestedAt/expiresAt/resolvedAt/resolveReason`；admin 只读投影无 openid；任何视图不出现 `_id/partnerId/toPartnerId/fromPartnerId/openid`）；**目标兼职视图不返回 `customerNo/displayName/avatarUrl`**，仅保留履约必需的 `roomTag/delivery/parcels/note`；`order.get` 放宽为「当前履约人 / 顾客 / `PENDING` 邀请目标」可读，转派完成后原履约人 `FORBIDDEN`；**counterpart 取人口径（W2 风险回写）**：顾客侧 `counterpart`（头像/昵称）恒按**当前 ACTIVE 绑定**（`binding.partnerId`）取人、不随转派变，当前实际履约人只以只读派生 `fulfillmentPartnerNo` 出现，未绑定/已解绑/停用/注销一律 `counterpart=null`——**头像/昵称可见面不因转派扩大**（D19/D42 不破）。**D59 团队可见性**：主兼职可见本队子队员 `partnerNo/displayName/status/teamJoinedAt`（**不含头像/fileId**）；子队员只见所属队伍摘要（`parentPartnerNo/memberCount`）；`listSubMembers` 的 `pendingInvites[].codeTail` 只给完整码后 4 位；**不新增 `admin_audit` 枚举**（业务留痕落 `order_events`/`invitation_codes`/`partners`）。
- **D63 无数据模型变更（v1.10）**：顾客在自己有 ACTIVE 绑定时可生成"该兼职的绑定卡"（复用现有 bind 卡，path 仍为 `/pages/launch/index?bind=`、只带 `partnerNo`），**不记录任何邀请关系**（无新集合/字段/索引/统计）；落地绑定复用 D37 隐私闸 + D38 自动绑定，服务端零改动。

### 4.3 OCR 识别失败兜底与开发者复核（v0.8 新增，用户三次修订）

**触发口径（v1.0 修订，D23/D24）**：端侧 OCR（沿用 v3 阶梯）+ 规则解析后，**任一包裹的站点或取件码缺失/不可信**（`codeStatus=NEED_CODE`、`stationId=''`、或解析结果与 OCR 文本冲突）→ 客户端调 `ai.parseParcel`（**唯一外呼出口**，云函数侧调 DeepSeek）；客户端不直连任何第三方。**触发不以「是否抽到文本」为前置**：只要存在可外发的去敏文本就调 AI 补识别；`NO_TEXT`（无任何文本）时不外呼（无输入），但**必须**入复核队列并给用户明确手填引导（修复旧实现「NO_TEXT 不入队、不提示」缺口）。**无截图手填单（D24）不进入识别链路**，`manualEntry=true`，不调 AI、不写失败队列。

**入参（最小化，客户端先过长/去敏闸）**：`{ocrTextMasked, hintTrackingTail?, uploadTicketId, role, fileId?}`；`ocrTextMasked ≤2000` 字；`fileId` **仅用于失败复核原图**（客户端传失败截图云文件 ID；服务端按 upload ticket 归属/`purpose=TICKET`/`cloudPath` 前缀校验后落 `recognition_failures.fileId`，校验失败不采信、不得写伪造值；D33）；服务端再做一次去敏（手机号/身份证/连续长数字掩码、姓名行可保留但不得带详细门牌），**只保留与站点/取件码/运单相关的短文本**。

**DeepSeek 调用口径（服务端）**：
- 端点 `https://api.deepseek.com/chat/completions`；`model=config.aiFallback.model`（默认 `deepseek-chat`，**禁止硬编码 Key**）；`temperature=0`；`response_format={type:'json_object'}`；system prompt 限定输出 JSON 字段集合。
- Key 只存云函数环境变量 `DEEPSEEK_API_KEY`（不进代码/前端/日志/数据库）；超时 8s、仅网络/5xx 重试 1 次；连续 5 次失败熔断 10 分钟；总开关 `config.aiFallback.enabled`。
- **只发去敏文本**：不发原图、不发 openid、不发订单归属；日志只记 `aiErrorCode/耗时/成功与否`，不落响应全文、不落 Key。
- 配额：**不设每人每日次数（D40，用户 2026-10-28 拍板「AI 不限额」；`config.aiFallback.maxPerUserPerDay=0` 表示不限）** + `全局日配额`（`config.aiFallback.dailyQuota`）；超限不调、直接进失败队列（对顾客**静默降级**，不返回 `RATE_LIMITED`）。
- 配置管理：`config.aiFallback` 在 **MVP 后台只读展示、不开放编辑**（`admin.updateConfig` 白名单不含该键；P1 再开）；改值走部署配置脚本/控制台，且必须与隐私文本同步。

**格式化返回（唯一 DTO，客户端只认这个）**：
```
{ recognized, stationId, stationName, pickupCode, trackingTail, lockerNo,
  confidence: 'HIGH'|'MEDIUM'|'LOW', source: 'RULE'|'DEEPSEEK'|'NONE',
  needsReview: boolean, failureId?: string }
```
- 字段白名单返回；`stationId` 必须 ∈ P1~P8 否则置 `''`；`pickupCode` 必须过码格式闸（去空格/连字符，4~12 位字母数字）否则置 `''`；`recognized=false` 或 `confidence=LOW` ⇒ `needsReview=true` 并写队列、返回 `failureId`。
- **合并策略（D29 修订）**：AI 结果只做**预填建议**，用户已手填字段优先、不得覆盖；**低置信且来自 AI（`confidence=LOW` 且 `source='DEEPSEEK'`）不写入任何字段**——返回建议条（站点/码 + 「采纳」按钮），用户点采纳后才写入并标 `recognitionSource=DEEPSEEK`；高/中置信自动预填空字段并标"智能识别建议，请核对"；**`source∈{RULE,NONE}`（含 AI 超时/关闭/配额等降级分支产出的规则字段）照旧自动预填**——它们是规则结果而非 AI 猜测，不能让用户白填；客户端仍允许手填提交（`NEED_CODE` 机制不变）。`recognition_failures` 入队口径不变（低置信照常入队）。

**失败反馈（开发者账号内，含原图）**：
- **记录粒度（v1.0：包裹 × 截图）**：同一截图拆多件时，**每件缺码/缺站点的包裹各一条 `recognition_failures` 记录**（共享同一 `fileId`，`failureId` 按件独立，便于逐件补录/逐件回填）；用户识别失败后**未建单也保留 `orderId=''` 的记录**（凭 `uploadTicketId` 校验归属后入队），建单/补码成功后回填对应订单的 `orderId` 与 `parcels[itemIndex].failureId`。**`fileId` 必须为真实失败截图**（客户端随 `ai.parseParcel` 传、服务端按票据校验；校验失败仍入队但 `fileId` 为空并留 `ticketInvalid` 痕迹）；复核页原图临时查看与逐次审计口径不变（D17/D33）。
- 入队即：后台总览红点 + `pkg-admin/pages/recognition-review/index` 首屏 `PENDING`；P1 可加订阅消息提醒（模板 ID 入 `config`）。
- 复核页：**原图**（鉴权临时 URL 5 分钟，每次查看审计 `FAILURE_IMAGE_VIEW`）、失败码、来源角色、上传人（编号/昵称脱敏，**不展示头像**）、`ocrTextMasked`、DeepSeek 尝试结果/错误码、关联订单（若有）、时间。
- 开发者动作：①查看原图（审计）②**补录站点/取件码**→ 回填关联订单 `parcel.stationId/stationName/pickupCode`（**不改订单状态、不代确认、不创建订单、不改归属**；审计 `FAILURE_FIX`）③标记忽略（备注必填；审计 `FAILURE_IGNORE`）④通知上传者：**不单拆动作**，作为 `fixRecognitionFailure`/`ignoreRecognitionFailure` 的可选参数 `notifyUploader:true`（站内消息必做，订阅消息 P1）。
- 原图可见性：仅白名单开发者在复核页、临时 URL、单次审计；不进顾客/兼职页面；**不提供批量/下载/导出**。
- 保留期：`config.recognitionFailureRetentionDays`（7~30，默认 30）；到期 `cleanup` 删原图引用并把记录置 `IGNORED`（备注 `EXPIRED`）；同一 fileId 若仍被订单引用，按订单截图规则（§4.1）处理。

**失败码（`failureCode`）**：`NO_TEXT`（OCR 无文本）/ `PARSE_MISS`（有文本但规则+AI（含 AI 未开启）均缺站点或码）/ `LOW_CONFIDENCE`（AI 低置信）/ `LLM_ERROR`（**AI 已尝试**但不可用/超限/解析失败）/ `IMAGE_UNREADABLE`（图片打不开/压缩失败）。**开关关闭/Key 缺失属「AI 未尝试」，按规则结果归 `PARSE_MISS`/`LOW_CONFIDENCE`，不记 `LLM_ERROR`**（2026-11-07 归因修正）。

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
    PICKED ──标记送达──► DELIVERED ──► COMPLETED（顾客确认 / 每日 22:00 日结批自动；22:00–24:00 送达的下一轮批内自动完成，D43/D51）
       │                    │
       └──────异常上报───────┴──► EXCEPTION ──► CANCELLED / 恢复
```

| 状态 | 中文（顾客可见） | 进入条件 | 可执行动作（角色） |
| :-- | :-- | :-- | :-- |
| `SUBMITTED` | 待接单 | 顾客下单成功（或兼职代客下单） | 兼职：接单/拒单/补码；顾客：取消；系统：超时取消 |
| `ACCEPTED` | 已接单 | 兼职接单 | 兼职：标记已取件（可逐件，D61）/上报异常/补码/**转派（未取件、凭完整 `partnerNo`，D58）**；顾客：取消（未取件前） |
| `PICKED` | 已取件·配送中 | 兼职在驿站取到实物（**全部件取完**自动进入，D61） | 兼职：标记送达/上报异常/撤销已取件（可逐件，D61）；顾客：不可直接取消（走留言/异常） |
| `DELIVERED` | 已送达·待确认 | 兼职送达约定地点 | 顾客：确认送达；系统：每日日结批自动完成（D43） |
| `COMPLETED` | 已完成 | 顾客确认/日结批自动完成 | 顾客：查看/删除记录/再次下单；双方：留言（只读归档） |
| `CANCELLED` | 已取消 | 顾客取消/兼职拒单/超时/异常取消 | 双方：查看原因；顾客：再次下单 |
| `EXCEPTION` | 异常·待处理 | 兼职上报（码失效/找不到件/柜门坏/联系不上/其他） | 兼职：解除异常恢复/取消；顾客：留言，**`exception.fromStatus ∈ {SUBMITTED, ACCEPTED}` 时可取消**；admin：介入 |

- **子状态**：`codeStatus='NEED_CODE'`（需查明，可与状态并存；补码后置 OK 并记 event）；`urgent`（加急服务类型携带）。**无任何支付/收款子状态**。
- **超时**：`SUBMITTED` 超过 `config.orderTimeoutMinutes`（默认 120）未接单 → 系统自动 `CANCELLED`（原因"超时未接单"）。
- **自动完成（D43，2026-11-01 用户拍板）**：`cleanup` 按 **UTC+8 日结批**完成送达单——cutoff =「该单 `deliveredAt` 所在 UTC+8 自然日的 `config.autoCompleteAt`（默认 `22:00`）」；`now ≥ cutoff` 的 `DELIVERED` 单即置 `COMPLETED`（actor=SYSTEM、逐单写 `AUTO_COMPLETED`、条件更新 + 唯一 requestKey 保幂等）。10 分钟触发器粒度 ⇒ 实际完成落该时刻~+10 分钟（默认 22:00~22:10）；**不额外保留顾客确认窗口，完成即只读归档**；22:00–24:00 送达的单在下一轮 10 分钟批内自动完成（不再下一轮 10 分钟批内自动完成）。**代客单（guest）无顾客确认路径**：同样由该日结批转 `COMPLETED`。旧的「小时数」自动完成键（逐单 24 小时）作废。
- **非法流转**：云函数校验转移表，非法返回 `INVALID_TRANSITION`；所有写动作幂等（`clientRequestId`）。
- **顾客可见进度条**：下单 → 已接单 → 已取件 → 已送达 → 已完成；**已取件以「全部件取完」为准（D61）**，部分取件时订单详情/列表显示「已取 N/M 件」；异常/取消分支单独展示。进度文案必须来自服务端状态，不许前端"假装推进"。
- **列表动线排序（四档）**：组内按 `需查明(codeStatus=NEED_CODE)` → `快递柜(lockerNo 非空)` → `分段码(取件码含分隔符/字母)` → `其他`；同档按码数字升序、id 兜底。

### 5.1 补偿与纠正动作

| 动作 | 允许状态 | 谁能做 | 语义与副作用 |
| :-- | :-- | :-- | :-- |
| `order.correct`（改码/改站点/改柜号/改运单尾号） | `SUBMITTED`/`ACCEPTED`/`EXCEPTION` 全字段；`PICKED` 仅柜号/运单尾号 | 该订单兼职 | **v1.0 按包裹序号 `itemIndex` 纠正单件**（缺省 0；越界 `VALIDATION_FAILED`）；**不改订单归属**（不可换顾客）：顾客归属错只能取消重下。记 `ORDER_CORRECTED`；批量改站点用同一 `batchActionId` 循环调用 |
| `order.unmarkPicked`（撤销已取件） | `ACCEPTED`（仅逐件，D61）/`PICKED` | 该订单兼职 | 逐件撤销（带 `itemIndex`）：清该件 `pickedAt`、记 `PARCEL_PICKED_REVERTED`；若订单原为 `PICKED` 则回 `ACCEPTED`（记 `PICKED_REVERTED`，清整单 `pickedAt`）；不带 `itemIndex`=整单回 `ACCEPTED`（兼容旧行为） |
| `order.unmarkDelivered`（撤销已送达） | `DELIVERED` | 该订单兼职 | `DELIVERED → PICKED`，记 `DELIVERED_REVERTED`；顾客进度回退提示 |
| `order.undo`（撤销条） | 由被撤销动作决定 | 该订单兼职 | 只在动作后 **5 秒**内、且订单无后续状态变化时允许；按 `batchActionId` 批量逐单校验，部分失败如实提示，成功部分回退 |
| `order.resolveException`（异常恢复） | `EXCEPTION` | 该订单兼职 | 上报时记录 `exception.fromStatus`；恢复回 `fromStatus`（仅允许 `ACCEPTED`/`PICKED`/`DELIVERED`，否则回 `ACCEPTED`）；记 `EXCEPTION_RESOLVED` |
| **转派（D58，v1.10）**：`order.requestTransfer`（发起）/`acceptTransfer`（确认）/`declineTransfer`（拒收）/`cancelTransfer`（撤回） | 发起/撤回：`ACCEPTED` 且 `pickedCount===0` 且无 `PENDING` 邀请；确认/拒收：`transfer.status='PENDING'` 且未过期且订单仍 `ACCEPTED` | 发起/撤回=该订单当前履约兼职；确认/拒收=`transfer.toPartnerId` 本人 | **归属改写只发生在 `acceptTransfer` 事务**：`partnerId/partnerOpenid/partnerNo` 改为目标；`transfer` 置结果态 + `resolveReason`；**`status/statusUpdatedAt/acceptedAt`/订单号/顾客/绑定/roomTag/包裹/配送全不变**；有效期 `config.transferTtlMinutes`（默认 10 分钟）、**惰性过期**（读到 `PENDING` 且超时先落 `EXPIRED`，不新增 sweep；**不读则记录停在 `PENDING`**——仅读路径触发落过期，见 RUNBOOK §18 / TD-091）；`pickedCount>0` → `INVALID_STATE`；`PENDING` 期间订单离开 `ACCEPTED` → 邀请落 `EXPIRED`（`reason=STATE_CHANGED`）、确认报 `INVALID_STATE`；四动作各记 1 条 `TRANSFER_*` 事件、幂等键 `order_events.requestKey={orderId}:{action}:{clientRequestId}`（重放返回 `duplicated:true`） |
| `order.cancel`（取消） | 见 §5 状态表 | 顾客/兼职/系统/admin | 记 `CANCELLED` 事件与原因；已取件后顾客不能单方取消（走异常/留言，兼职可取消并填原因）；admin 仅异常介入并审计 |

- **件级取件与撤销（D61，2026-11-02 用户裁决 Q4=B/Q5/Q6）**：`order.markPicked` / `order.unmarkPicked` 接受可选 `itemIndex`（包裹下标 0~9，越界 `VALIDATION_FAILED`；缺省=整单全部件，保持批量/旧客户端兼容）。带 `itemIndex` 时：该件写 `parcels[itemIndex].pickedAt`（可带 `pickedByNo`）+ 记 `PARCEL_PICKED`/`PARCEL_PICKED_REVERTED`（payload `{itemIndex}`）；**订单 `PICKED` 由「全部件已取」聚合派生**——最后一次取件同时写订单级 `PICKED` 事件并置状态，部分取件只写件级事件、订单仍 `ACCEPTED`（DTO 下发 `pickedCount/parcelCount/allPicked` 与每件 `picked/pickedAt`）；撤销使不全取时订单回 `ACCEPTED`。**逐件取件/撤销不提供 5 秒撤销条**（UI 用每件的「撤销已取」按钮，未送达前可用）；送达/异常/取消/自动完成仍整单（`markDelivered` 仍要求订单 `PICKED`）；旧单无件级字段时按订单状态派生（`PICKED/DELIVERED/COMPLETED`→全部件已取、`ACCEPTED`→未取），无数据迁移。
- **删除口径**：**订单不可硬删**。顾客可对 `COMPLETED` 订单做"删除记录"（`order.deleteRecord`：仅从自己列表隐藏 + 进入 7 天后物理删除队列，`orders.deletedByCustomerAt`）；兼职不可删除订单；admin 不可删除订单（只读+审计）。
- **接单撤销**：`order.undo` **不覆盖 `ACCEPTED → SUBMITTED`**。误接单走 `order.cancel`（选原因并通知顾客）；`order.undo` 只覆盖 `order.markPicked`/`order.markDelivered`（分别回 `order.unmarkPicked`/`order.unmarkDelivered`）；**无任何收款动作/撤销**。
- **转派（D58，v1.10）**：目标必须是 `ACTIVE` 兼职（**只校验 `status`**，不校验接单开关/服务范围）、不能是自己/原履约人；真实×测试禁止互转（`FORBIDDEN`）；**子队员发起的转派限本队**（主兼职或同队子队员），主兼职可转任意 `ACTIVE`；结果态 `DECLINED/CANCELLED/EXPIRED` 只改 `transfer` 不动归属；**不新增 `admin_audit` 枚举**（证据在 `order_events`）；**不提供 5 秒撤销条**——发起方用「撤回转派」按钮（仅 `PENDING` 且未过期）；待接收列表复用 `order.listPartner({view:'transfer'})`（按 `transfer.requestedAt desc` 游标，**服务端过滤、客户端零过滤**），顶层响应只增 `transferPending` 角标（`counts` 六项形状不变）；顾客侧只看到「由 P-XXX-XXX 接手履约」（`fulfillmentPartnerNo`，仅编号、无头像昵称）。
- **批量动作**：**不设专用 batch 云函数**；客户端循环调用逐单动作，携带同一 `batchActionId`，服务端逐单返回，客户端汇总"成功 N / 失败 M"并如实上屏。
- **送达备注**：`DELIVERED` 时可填 `deliveryNote`（≤100 字），随事件保存；MVP 不做送达照片/签名（P1）。

### 5.2 枚举与取图口径

- `appoint.type`（D47 修订）：`'ASAP'`（尽快）｜`'LATEST'`（最晚可接受时间，`{type:'LATEST', latestAt}`，UTC+8 毫秒）；**`'SLOT'`（预约时段）仅历史订单展示、新单不可选**（新单提交 `SLOT` → `VALIDATION_FAILED`）。`LATEST` 约束：**30 分钟粒度**（整点/半点）、**最小提前 30 分钟**、**最晚 ≤7 天**，非法值服务端 `VALIDATION_FAILED(field=appoint)`；客户端只做预选与行内提示，**服务端校验为唯一权威**。语义边界：最晚时间**只表达顾客期望**——**不改变 `config.orderTimeoutMinutes`（默认 120 分钟）接单超时**、**到点未送达不自动取消/不改状态**，仅在详情与订单页**标红提示**；门店/兼职侧筛选不按最晚时间排序（P1 若做再立 D 编号）。历史 `SLOT` 订单按 `startAt/endAt` 原样展示，不做数据迁移。文案：ASAP=「尽快」、LATEST=「最晚时间」、SLOT=「预约时段」（`shared/enums` 与 `shared/appoint` 单源）。
- `exception.code`：`CODE_INVALID`（取件码/柜号无效或已被取走）｜`PARCEL_NOT_FOUND`（驿站找不到件）｜`CABINET_ERROR`（柜门/设备故障）｜`CUSTOMER_UNREACHABLE`（联系不上顾客）｜`ADDRESS_ISSUE`（宿舍地址问题）｜`OTHER`（必须填备注）。中文文案由服务端下发。
- **截图与订单关系（v1.0 修订，D23/D24）**：**一个订单 = 1~10 件包裹**（`order.parcels[]`），可来自 0~10 张截图（`order.images[]`，一张截图一个 ticket、可一图多码拆成多件；也可多图合并为同一单）。**短间隔重复提交自动并入同一订单**：同一顾客 + 同一绑定兼职 + 已存在 `status=SUBMITTED` 且 `createdAt` 在 `config.orderMergeWindowMinutes`（默认 10 分钟，0=关闭，0~60）内且 `delivery` 相同的订单 → 新提交包裹**追加**到该订单（包裹/图片追加、`version+1`、写 `PARCELS_APPENDED` 事件、状态不变）；不满足任一条件则新建订单。合并仅限 `SUBMITTED`（兼职已接单后的新提交另建新单）；订单包裹上限 10、图片上限 10，超出另建新单；**兼职代客单不参与合并**。**无截图手填（D24）**：`images=[]` 且 `manualEntry=true` 允许提交，兼职端/订单详情/后台显示「无截图·手填」标识；截图仍为推荐路径（识别更快）。**多张截图超过上限时分多单**（按提交批次拆分，最多 10 张/单）。
- **图片来源**：相册、拍照、微信聊天文件（系统选择器）。隐私指引覆盖"相册/摄像头/文件选择"三类，上线前按微信后台隐私接口清单逐项核对（人执行）。
- **文本上限**：`orders.note` ≤200；`deliveryNote` ≤100；`bindings.partnerNote` ≤100；`order_messages.text` ≤200；超限 `VALIDATION_FAILED`。
- **取消原因枚举**：顾客侧 `CHANGED_MIND`（不需要了）｜`WRONG_INFO`（信息填错）｜`DUPLICATE`（重复下单）｜`PARTNER_UNREACHABLE`（联系不上兼职）｜`OTHER`（必填备注）；兼职侧 `TOO_BUSY`（忙不过来）｜`OUT_OF_RANGE`（不在服务范围）｜`SERVICE_OFF`（服务未开）｜`OTHER`（必填备注）；系统侧 `TIMEOUT_UNACCEPTED`（超时未接单）。中文文案由服务端下发。**已删除 `PRICE_ISSUE`（价格问题）与 `PAYMENT_TIMEOUT`（零金钱口径）**。
- **列表排序（服务端排序）**：顾客"进行中"按 `statusUpdatedAt desc`；顾客"已完成/已取消"按 `completedAt/cancelledAt desc`；兼职工作台服务端返回按"状态桶 + 站点"过滤的分页数据，客户端零件层只做**四档动线排序**；分页游标用 `(statusUpdatedAt, orderNo)` 或 `(completedAt, orderNo)`。
- **结果页**：下单结果**内嵌在 `order-create` 第 4 步**，不新增 `result` 子页；一图多码拆单在同一结果块列出 N 张订单号与入口。

### 5.3 云函数动作命名（`模块.动作` 驼峰；DATA_MODEL 按此定稿契约）

| 模块 | 动作 |
| :-- | :-- |
| `user` | `bootstrap`（返回角色/资料完成度/绑定摘要/`isDeveloper`/当前切换会话上下文 `viewContext`（含 `viewMode/role/target`），**不返回 openid**）、`avatarUrl`（**D42**：本人头像 5 分钟临时 URL；无头像返回空）、`acceptPrivacy`、`deleteAccount` |
| `customer` | `saveProfile`（首次保存时生成 `customerNo`，幂等；含 `displayName` 昵称与 `avatarFileId`）、`getProfile` |
| `partner` | `activate`（入参 `invitationCode` + 昵称，激活时可一键取微信昵称/头像；**D59：读到 `kind='SUB'` 的子码时同事务写 `partners.parentPartnerId=issuerPartnerId` 与 `teamJoinedAt`，`DEV`/缺省零变化；**D59 激活闸（W3 收尾）：SUB 码激活时须校验发码主兼职——`SUSPENDED`/非 `ACTIVE` → `PARTNER_CLOSED`（「邀请方已停用，请联系管理员」）；`CLOSED`/不存在/`deletedAt`/上级非主兼职（`parentPartnerId!==''`）脏数据 → `NOT_FOUND`（同码同文案防枚举）；`DEV`/无 `kind` 旧码零改动**）、`saveProfile`（昵称/头像可改）、`saveServiceConfig`、`getPublic`（凭完整 `partnerNo`，未绑定可、限流；**绑定前只回昵称，绑定后回头像/昵称**；测试账号返回 `NOT_FOUND`；**D59：子队员返回 `NOT_FOUND`（不暴露存在性，防枚举）**）、`listBindings`（客户档案，服务端搜索 + 游标分页）、`getCustomer`（`bindingId` 反查自己绑定顾客：档案 + 解绑资格；**不含订单分页**，该顾客历史订单统一走 `order.listPartner({view:'customer'})` 单一来源，批 8 TD-049 收敛）、`unbindCustomer`、`saveCustomerNote`、**`createSubInvites`（D59：主兼职发子码，`{count:1~5, validity:'24H'|'72H'|'7D', note?≤50, clientRequestId}`；发码者必须 `parentPartnerId===''`；**发码前按「成员数 + 待用未过期子码数 + 本批数量 > `config.teamMaxMembers` → `VALIDATION_FAILED`」校验（满员文案「队员+待用码已占用 {reserved}/{max}」；待用码也占名额，防「members 未满但已发出超额码」）**；`kind='SUB'`、`issuerPartnerId=me`、`batchId='TB'+yyyyMMdd+seq`、`createdBy='PARTNER:'+myNo`；**完整码只在本次响应返回**；**并发口径（W3 收尾）：日批次序号 CAS + 名额复核 + 幂等键全部在同一事务内（顺序：序号→名额→幂等→插码），并发抢号失败 → `CONFLICT`（「并发生成冲突，请刷新后重试」），同 `clientRequestId` 并发重放回同批且不重复插码**）**、**`revokeSubInvite`（D59 批 27 口径修订：**批次级作废**，`{batchId, clientRequestId}`；作废该主兼职该批**全部未用 SUB 码**，返回 `{batchId, revokedCount}`；该批无未用码 → `INVALID_STATE`，他人批次/不存在 → `NOT_FOUND`；并发写冲突 → `CONFLICT`（与发码同族文案））**、**`listSubMembers`（主兼职返回 `members[{partnerNo,displayName,status,teamJoinedAt}]`+`pendingInvites[{codeTail(后4位),expiresAt,batchId}]`+`quota{used,reserved,max}`（`used`=在队队员数、`reserved`=队员数+未过期待用子码数（与发码闸同口径）、`max`=`config.teamMaxMembers`；页面按 `reserved/{max}` 展示并据此判满员）；子队员只返回自己的队伍摘要 `parentPartnerNo+memberCount`）**、**`removeSubMember`（`{partnerNo}`；目标须 `parentPartnerId===me`；名下有进行中订单 → `INVALID_STATE`；写 `parentPartnerId=''`+`status='SUSPENDED'`+`suspendedReason='TEAM_REMOVED'`，并把该目标 `PENDING` 转派邀请落 `CANCELLED`（**同事务定向取消该队员 `transfer.toPartnerId` 的 `PENDING` 转派，单次上限 40 单；超出部分靠转派 TTL 惰性过期，不阻塞移除**）；`rl:subInvite` 限流（超限 `RATE_LIMITED`）；并发冲突 → `CONFLICT`）**、`stats`（**只含单量**：今日/本周/本月完成量、进行中/异常/取消、完成率、近 7 日单量、日报摘要源；**排除测试账号与 `isTest` 订单**；无任何收入类字段） |
| `bind` | `create`（**仅顾客可调**；凭完整 `partnerNo`；测试账号只能绑测试账号）、`release`（reason 必填枚举 + note≤100）、`getCurrent`（当前 ACTIVE 绑定摘要 + partner 公开资料（头像/昵称 + `avatarUrl` 临时 URL，D42）+ roomTag）、`claimGuestOrder`（P1，顾客认领） |
| `order` | `create`（**v1.0 单入口**：入参 `{parcels[1~10], images[0~10], tickets?[], serviceCode, appoint, note, ticket?/tickets?, recognition?, guest?, bindingId?, delivery?, mergeAppend?:boolean, clientRequestId}`；满足合并窗口时追加到同单，见 §5.2/D23）、`get`、`listCustomer`、`listPartner`（返回列表 + `counts` 6 项；**工作台视图另只增 `summary`**（D48：按苑/栋聚合 + 取件/送达/进行中计数 + 总件数，复用本次查询、零额外扫描），history/customer 视图不返回该键；**D58 增 `view='transfer'`**：目标兼职待接收列表（`transfer.toPartnerId=me` 且 `transfer.status='PENDING'` 且订单 `ACCEPTED`，按 `transfer.requestedAt desc` 游标），顶层响应 +`transferPending` 角标，`counts` 六项形状不变，其余 view 行为零变化）、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、**`requestTransfer`（`{orderNo, toPartnerNo, clientRequestId}`；`ACCEPTED` 且 `pickedCount===0`、无 `PENDING` 邀请；目标 `ACTIVE`；真实×测试隔离；子队员限本队）**、**`acceptTransfer`/`declineTransfer`/`cancelTransfer`（均 `{orderNo, clientRequestId}`；过期/非 `PENDING` → `INVALID_STATE`；幂等重放 `duplicated:true`）**、`confirmDelivery`（一次确认整单全部包裹）、`correct`（按 `itemIndex` 逐包裹纠正）、`undo`、`deleteRecord`、`imageUrl`（`{orderNo,index}` 取 `images[index]` 临时 URL）。**`order.createBatch` 已于 v1.0 移除**（一图多码能力并入 `create` 的 `parcels[]`/`images[]`；调用未登记动作 → `FORBIDDEN`「不支持的操作」，与全局未登记动作口径一致） |
| `message` | `send`、`list`（消息中心聚合）、`markRead` |
| `upload` | `prepare`（`purpose:'TICKET'|'AVATAR'`；头像路径 `avatars/{role}/{random}.jpg`、≤200KB、jpg/png）、`cancel` |
| `config` | `getPublic`（返回 `zoneLabels/serviceCatalog(仅类型名与说明，无任何交易字段)/announcement/maintenance/screenshotRetentionDays/orderTimeoutMinutes/autoCompleteAt/privacyVersion` 等公开配置；`autoCompleteAt` 为 UTC+8 日结批时刻，D43） |
| `admin` | `createInvites`（批量 ≤50、有效期/备注）、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`listOrders`（默认过滤测试数据，可切换）、`getOrder`、`listAudit`、`updateConfig`（白名单；**v1.1/D32 起含 `stations`**）、`stats`（**排除测试账号与测试订单**；可附 `test` 计数供测试账号管理页展示；**v1.1/D33 起附只读 `aiFallbackStatus{enabled,hasKey,model}`，绝不下发 Key**）、`bootstrap`（内部幂等种子/集合索引校验）、`viewAsStart`（`{role,targetNo,mode:'READONLY'|'TEST_WRITE'}`；真实账号只允许 `READONLY`）、`viewAsEnd`、`createTestAccount`（`{role,displayName}`）、`listTestAccounts`、`deleteTestAccount`（删账号+数据+头像）、`purgeTestData`（清空全部测试数据）、`listRecognitionFailures`、`getRecognitionFailure`（返回原图临时 URL + AI 排障字段 `aiTried/aiErrorCode/aiModel/aiResult/ocrTextMasked/hasImage`，审计 `FAILURE_IMAGE_VIEW`；D33）、`fixRecognitionFailure`（`{stationId?,stationName?,pickupCode?,note?,notifyUploader?}`）、`ignoreRecognitionFailure`（`{note,notifyUploader?}`） |
| `ai` | `parseParcel`（**内部受控兜底**：入参/出参见 §4.3；服务端调 DeepSeek；不设每人每日次数（D40）+ 全局日配额；Key 只在环境变量；失败静默降级 `recognized=false` 并写 `recognition_failures`（**记录必须落真实失败截图 `fileId`，后台复核页可临时查看原图；D33**）；未登录/无业务角色 → `FORBIDDEN`；**不新增错误码**） |
| `health` | `check`（部署自检，仅内部/部署者可用） |
| `cleanup` | 定时任务（内部）：超时取消、送达单**日结批**自动完成（含 guest 单，D43）、截图/票据清理、软删物理删、注销删除、过期邀请码置 EXPIRED、限流计数清理、过期切换会话票据清理（`READONLY`/`TEST_WRITE`）、**过期识别失败记录与原图引用清理（v0.8）**、**超期测试账号数据清理（v0.9）** |

> 命名纪律：动作名只表达业务语义；响应统一 **`{ok, code?, message?, data?, serverTime, requestId?}`**。错误码统一大写_下划线，**只认这一套**：`VALIDATION_FAILED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`INVALID_TRANSITION`、`INVALID_STATE`、`RATE_LIMITED`、`INVITE_EXPIRED`、`INVITE_USED`、`VIEW_TICKET_EXPIRED`、`PARTNER_CLOSED`、`DEPENDENCY_FAILED`、`INTERNAL_ERROR`。字段级校验失败时 `data.field` 指向字段名。**不含任何支付类错误码**。`ai.parseParcel` 的外呼失败/超限一律降级为成功响应（`recognized=false`），**不占用错误码**（v0.8）。**账号切换/测试账号不新增错误码**（v0.9）：真实账号传 `TEST_WRITE`、真实×测试互绑/互下单一律 `FORBIDDEN`；票据问题沿用 `VIEW_TICKET_EXPIRED`。

---

## 6. 服务类型（只有类型，无价格，用户硬口径）

| code | 名称 | 说明（只描述做什么） |
| :-- | :-- | :-- |
| `PICKUP_STD` | 标准代取 | 驿站取件送到**寝室门口（上楼）**（D41 重定义） |
| `PICKUP_LOW` | 送至楼下 | 驿站取件送到**宿舍楼下/约定地点（不上楼）**（D41 新增） |
| `PICKUP_URGENT` | 加急代取 | 优先处理，承诺更快时效 |
| `DROP_OFF` | 代寄快递 | 顾客把件交给兼职，兼职送驿站寄出 |
| `CUSTOM` | 其他代办 | 需备注说明；兼职可拒单 |

- **送达层级（D41，2026-10-28 用户拍板「重新定义标准配送 + 新增送至楼下」）**：`PICKUP_STD`（标准代取）＝送到**寝室门口（上楼）**；`PICKUP_LOW`（送至楼下）＝送到**宿舍楼下/约定地点（不上楼）**；原 `PICKUP_DOOR`（送寝上门）与标准代取语义重复 → **默认目录移除、兼职不可新启用**，仅保留枚举与历史订单展示（`shared/enums.js` 保留名称「送寝上门（已停用）」；存量订单 `service` 快照不受影响）。服务类型只表达「做什么 + 送到哪一档」，`orders.delivery` 只定位苑/楼栋/宿舍（D25），**不新增位置字段、不采集定位**。顾客端服务选择器必须能区分两档（展示「送到寝室门口 / 送到楼下」说明）；`CUSTOM` 仍为目录末项（TD-070 末项推导不变）。
- **没有价格、没有运费、没有报价、没有金额快照**；订单只快照 `service{code,name}`。
- 订单 DTO 另回只读派生 `service.deprecated`（历史停用类型如 `PICKUP_DOOR` 显示「送寝上门（已停用）」；现行 5 类恒 `false`，只增不减兼容；D41/D49）。
- 兼职可启用/停用服务类型、设置服务范围（哪些苑/楼栋接单）、接单开关、每日接单上限、营业时间段。
- **服务配置字段（shape）**：`partner.serviceConfig{ services[{code,enabled}], zones[], buildingNos[], acceptingOrders, maxDailyOrders?, businessHours?, autoAccept? }`。**MVP 实现**：`services/zones/acceptingOrders`（范围先做到苑级）；`buildingNos/maxDailyOrders/businessHours/autoAccept` 为 P1 预留可空字段。
- **接单开关**：`serviceConfig.acceptingOrders=false` ⇒ `order.create` 返回 `PARTNER_CLOSED`；顾客端下单入口置灰；恢复后可下单。
- 顾客端只展示兼职已启用的服务类型名称；**不展示任何价格/费用信息**。

---

## 7. 页面地图（app.json 口径，详见三份 UX 文档）

**页面总数（v1.10，D59）：33 页 = 主包 8 + 分包 25（顾客 5 / 兼职 9 / 开发者 11）**；与 `tools/lib/project.js` 的 `ALL_PAGES`、`app.json` 声明、`check-docs` §8.3 #2 联动（32→33 由批 27 新页 `pkg-partner/pages/team/index` 触发）。

主包（**tabBar.list 上限 5 项**；`custom: true`；自定义 tabBar 组件必须在**项目根目录 `custom-tab-bar/`**；真实 tabBar.list 5 条按角色渲染顾客 4 格/兼职 3 格，开发者使用分包页面无 tabBar；D64 起顾客第 4 格「取件码」为**伪 tab**：由页面内自绘共用底部栏显示、`app.json` 不新增条目）：
```
pages/launch/index            启动分流（读角色/资料/绑定/是否开发者 → reLaunch；**onLoad 读 `bind`/`orderNo` 白名单 + 隐私闸（D37）**；不在 tabBar）
pages/role/index              身份选择 + 邀请码入口 + 邀请卡（?bind=CODE，由 launch 分流进入；D37；不在 tabBar）
pages/customer/home/index     顾客首页（tab 1：首页）
pages/customer/orders/index   顾客订单列表（tab 2：订单）
pages/customer/pickcodes/index 顾客取件码（D64 一级入口「取件码」=伪 tab；**只显示顾客自建本机取件码**：写入/删除/复制/已取标记；不显示订单、不提供分享、READONLY 只读说明卡）
pages/partner/workbench/index 兼职工作台=取件清单（tab 3：工作台）
pages/partner/customers/index 兼职客户档案（tab 4：客户）
pages/profile/index           我的（tab 5：**顾客/兼职共用**，页内按角色渲染；显示头像/昵称与对应唯一编号）
```
- 顾客可见 tab：1 首页 / 2 订单 / 5 我的 + **「取件码」伪 tab（D64，视觉同级第 3 格）**；兼职可见 tab：3 工作台 / 4 客户 / 5 我的。
- 兼职"我的"里的编号/分享绑定卡片/服务配置入口/统计/切换身份，都在共用 `pages/profile/index` 内按角色渲染。
- 角色不匹配的 tab 页在 `onShow` 里 `reLaunch` 回本角色首页；`tabBar` 切格用 `wx.switchTab`，跨角色切换用 `wx.reLaunch`。
- **开发者分流**：`user.bootstrap` 返回 `isDeveloper=true` ⇒ `wx.reLaunch('/pkg-admin/pages/overview/index')`；不需要 `?admin=1`（服务端白名单是唯一门槛）。

分包：
```
pkg-customer/pages/bind/index          绑定兼职（输入完整兼职编号 / 卡片落地确认；展示兼职昵称，**头像绑定成功后才可见**）
pkg-customer/pages/order-create/index  下单（截图 0~10 张→识别→多包裹核对→服务类型→提交；支持批量/合并窗口/无截图手填，D23/D24/D40）
pkg-customer/pages/order-detail/index  订单详情/进度（多包裹列表）/留言/取消/确认送达/配送地址
pkg-customer/pages/messages/index      消息中心（订单通知）
pkg-customer/pages/help/index          帮助/隐私/关于（含"本程序不涉及费用收付"口径说明）
pkg-partner/pages/activate/index       邀请码激活 + 资料初始化
pkg-partner/pages/order-detail/index   兼职订单详情/状态操作/改码/留言
pkg-partner/pages/create-on-behalf/index 代客下单（v3 录入页移植）
pkg-partner/pages/customer-detail/index  兼职侧顾客详情（历史订单/备注/顾客编号/头像昵称）
pkg-partner/pages/service-settings/index 服务配置（启用服务类型/范围/接单开关，无价格）
pkg-partner/pages/stats/index          单量统计（今日/本周完成量、状态分布，无金额）
pkg-partner/pages/messages/index       消息中心
pkg-partner/pages/pick-list/index      取件清单（独立第 32 页，D46/D55：双阶段——「待取件」按站点 P1~P8 展示 ACCEPTED 单的码/尾号/柜号/宿舍锚（只读、可复制）；「待送达」按苑→栋→楼层展示 PICKED 待送达单、分页/分片 ≤20 行、不参与工作台轮询、可复用批量送达；默认待取件，两 chip 切换）
pkg-partner/pages/team/index           团队（第 33 页，D59：主兼职=成员列表（编号/昵称/状态/加入时间，**无头像**）+ 发子邀请码（1~5 个、24H/72H/7D、备注可选，完整码仅本次响应）+ 待用子码列表（**按 batchId 分组**，只显示尾 4 位/到期，「作废本批」二次确认）+ 移除成员（二次确认，说明移除后对方停用需联系管理员恢复）+ 名额 `quota{used,reserved,max}`（展示 `reserved/{max}`，含待用子码）；子队员=只看「所属队伍 P-XXX / 成员数 N」）
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
- **导航规则**：`launch` 是唯一启动页；`role` 不属任何 tab；角色不匹配的 tab 页在 `onShow` 里 `reLaunch` 回本角色首页；**分享卡统一落 `launch`（D37）**：`launch.onLoad(options)` 读参数白名单 `bind`/`orderNo`（`bind` 归一为合法 `partnerNo`，非法/越界参数丢弃），**先过隐私同意闸再分流**——带 `bind` → `role?bind=`（邀请卡，**落地卡按目标角色渲染：顾客身份显示绑定入口，兼职身份不显示顾客绑定入口**）；带 `orderNo` → 订单详情（校验归属，失败回列表）；否则按现有角色/资料/绑定分流。卡片与跳转不得携带 openid/订单内容/头像昵称等业务值。**非 launch 首启兜底（D37 补强，2026-10-30 用户侧复现）**：`role`/`customer/home` 等可能被「修复前已发出的旧分享卡」或朋友圈卡直达的页面，在未同意隐私/版本变更时先 `reLaunch` 回 `launch` 过闸并保留 `bind`/`orderNo`，不得在未同意状态下继续渲染写入口；切换会话按既有口径跳过（服务端按 `developerNo` 豁免，TD-046）。
- **自定义 tabBar**：组件位于项目根目录 `custom-tab-bar/`（平台硬要求），读全局角色，渲染顾客四格（首页/订单/取件码/我的；取件码为 D64 伪 tab，视觉由共用 `components/tab-bar-view` 提供、页面内自绘并 `reLaunch` 进入）或兼职三格（工作台/客户/我的）；**切换会话下渲染目标角色三格/四格**且每页顶部常驻黄条（真实账号只读）或蓝条（测试账号可写）；兼职"工作台"显示待处理红点；切换角色后 `reLaunch` 到对应首页。
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
- **分享与朋友圈（v1.2/D36，2026-10-28 用户指令）**：顾客/兼职业务页均支持「转发给朋友」（完整清单见 `tools/lib/share-pages.js`；**D64 起的取件码页含本机 L3 明文，不提供分享/转发**；**D59 的主兼职团队页（`pkg-partner/pages/team/index`）含子邀请码/成员信息，不提供分享/转发、且不进该清单**）；**仅 `pages/role`、`pages/customer/home`、`pkg-customer/pages/help` 三页支持「分享到朋友圈」**——朋友圈落地=当前页的**单页模式**（scene=1154：无登录态、不能跳页、云资源不可用），所以只让静态可自洽的页面挂朋友圈，三页均做静态预览降级（不调云、不做分流、提示点底部「前往小程序」）。分享卡片**只允许两种**：①**绑定卡**（**兼职本人或有 ACTIVE 绑定的顾客**均可生成；只带 `partnerNo`，path=`/pages/launch/index?bind=`，D37/D63；标题用中性常量 `TITLES.BIND_CUSTOMER`，**不记录邀请关系、卡片零邀请者信息**）；②通用邀请卡（path=`/pages/launch/index`，零 query）；朋友圈卡片 query 恒空、不自定义 path（平台限制）。**D63 补充**：分享入口只在「我的」（`pages/profile`）主入口，不进首页/订单详情；`launch` 参数白名单不变（只认 `bind`/`orderNo`，不新增 `?inviter=` 等参数）。**一律使用固定中性封面**（`/assets/share/cover.png` 5:4、`/assets/share/cover-timeline.png` 1:1），**禁止使用页面截图**（默认截图会把取件码/宿舍/尾号等 L3 带进卡片）；卡片不得含订单号/取件码/站点/宿舍/尾号/头像/昵称/截图/票据/识别原文。**切换会话（READONLY/TEST_WRITE）隐藏分享与朋友圈入口**（`wx.hideShareMenu`，O3 落地），退出恢复。朋友圈为平台 Beta 能力（基础库 ≥2.11.3，平台支持以官方文档为准）、只能经右上角菜单触发、不得诱导分享（运营规范）。

---

## 9. 通知口径

- **必做**：顾客订单详情页 10s 轮询（可见时）；兼职工作台 `onShow` 刷新 + 30s 轮询 + 下拉刷新 + 新订单红点/角标；消息中心列表；订单留言。
- **未读红点口径（D29）**：`message.list` 的 `unread` = 未读留言数 + 未读状态事件数（本人订单的 `order_events`，`at > users.messageReadAt`，状态类事件；不含公告与测试数据）；进入消息中心或对应订单详情后 `message.markRead` 前进水位（只进不退；`scope=ALL` 同时把合并视图内「对方发来的未读留言」置 `readAt`——进消息中心即真正清零；`scope=ORDER` 置读该单对方未读留言）；底部「订单」角标为**进行中数量**（数量角标，不清零，与红点语义区分）。**D58 转派事件可见性**：`TRANSFER_REQUESTED/TRANSFER_DECLINED/TRANSFER_CANCELLED/TRANSFER_EXPIRED` 为私有事件，**不进顾客消息中心、不计未读**（`shared/enums.js` 的 `MESSAGE_HIDDEN_EVENT_TYPES`，`message.list` 构造事件项时跳过）；`TRANSFER_ACCEPTED` **保留可见**（顾客消息中心/订单详情「由 P-XXX-XXX 接手履约」提示），事件中文文案由服务端下发。**D63 分享不产生任何通知。**
- **AI 低置信呈现（D29）**：低置信不自动写入字段，只给可采纳建议条；文案统一「智能识别建议，请核对」/「没把握，点『采纳建议』或手动填写」。
- **P1**：微信订阅消息（模板：新订单提醒（兼职）、订单状态提醒（顾客）、异常提醒（双方））。授权按钮在关键动作后引导；用户拒绝不阻断主流程；`config` 存模板 ID，代码不硬编码。
- 通知文案不带敏感信息；不带完整手机号、不带链接参数里的 openid；**不涉及任何金额/费用文案**。

---

## 10. 权限矩阵（资源 × 角色）

| 资源/动作 | 顾客 | 兼职 | 开发者 developer |
| :-- | :-- | :-- | :-- |
| 读自己的顾客资料 | ✅ | ✅（若兼顾客身份） | 后台仅脱敏列表/详情 |
| 读绑定兼职公开资料（**头像/昵称**/服务类型/接单状态/服务范围/兼职编号） | ✅ | — | ✅（后台；不展示头像） |
| 枚举/搜索兼职 | ❌（永不提供） | — | ✅（后台管理用途） |
| **发起绑定**（凭完整 partnerNo） | ✅（唯一入口，限流见 §10：预览+提交合计滚动 60 秒/5 次，D39） | ❌（**禁止**；无任何入口，`bind.create` → `FORBIDDEN`） | —（开发者不创建绑定） |
| 解绑 | 自己的绑定 | 自己的客户（reason 必填 + 通知） | — |
| 读绑定对方头像/昵称 | ✅（绑定兼职） | ✅（绑定自己的顾客） | 后台默认脱敏（**不展示头像**、昵称脱敏）；只读视角同目标；**D58 不随转派扩大**——顾客侧 `counterpart` 恒按当前 ACTIVE 绑定取人，转派后的当前履约人只以 `fulfillmentPartnerNo` 编号出现，未绑定履约人无头像/昵称 |
| 修改自己的头像/昵称 | ✅ | ✅ | —（开发者无业务身份） |
| 读顾客完整资料（含宿舍/尾号/roomTag/顾客编号/头像/昵称） | 自己 | 仅绑定自己的顾客 | 后台默认脱敏；完整值仅只读视角（审计） |
| 订单创建/取消/确认 | 自己的 | 自己的（含代客单） | 仅异常介入取消（原因+审计）；不代确认、不创建 |
| 订单状态操作（接单/取件/送达/异常/改码/撤销） | — | 自己的 | 只读视角可看不可做；后台不可操作 |
| **发起/撤回转派**（凭目标完整 `partnerNo`，D58） | — | ✅（自己的订单，`ACCEPTED` 且未取件） | — |
| **确认/拒收转派**（邀请目标，D58） | — | ✅（`transfer.toPartnerId` 本人） | — |
| **待接收转派列表/角标**（`order.listPartner({view:'transfer'})`，D58） | — | ✅（仅自己名下待接收） | 只读视角同目标 |
| **发子邀请码 / 按批次作废 / 团队列表 / 移除成员**（D59） | ❌ | ✅ 主兼职（`parentPartnerId===''`，上限 `config.teamMaxMembers`）；子队员仅见队伍摘要（不可发码/移除） | ✅（邀请码列表增 `kind/issuerPartnerNo`，SUB 码只读不可作废） |
| **绑定子队员** | ❌（顾客只能绑主兼职；`bind.create` 对子队员 `NOT_FOUND`） | ❌（子队员不可被顾客绑定） | — |
| 邀请码生成/作废/查看（`kind='DEV'` 主码） | ❌ | ❌（仅可发 `kind='SUB'` 子码并按批次作废本队码，无主码权限） | ✅ |
| 兼职停启用 | ❌ | ❌ | ✅（`admin.setPartnerStatus`；停用/注销级联本队子队员并取消该队 `PENDING` 转派；恢复子队员时上级不存在/非 `ACTIVE`/已注销则自动解除隶属，审计 `detail.detachedFromParent=true`） |
| 全局配置 | ❌ | ❌ | ✅ |
| 后台数据查看（用户/订单/绑定/统计/审计） | ❌ | ❌ | ✅（默认脱敏；**统计不含测试数据**） |
| **切换账号：真实账号（只读）** | ❌ | ❌ | ✅（票据+审计+拒写；隐藏分享） |
| **切换账号：测试账号（可写）** | ❌ | ❌ | ✅（`TEST_WRITE`；仅测试账号；测试数据标记；审计） |
| **测试账号管理/清理测试数据** | ❌ | ❌ | ✅（≤3/角色、≤6/开发者；删除/清空二次确认 + 审计） |
| 订单留言 | 自己订单 | 自己订单 | 只读（工单）；测试会话可写（仅测试数据） |
| 识别失败队列/原图查看（仅复核页） | ❌ | ❌ | ✅（临时 URL 5 分钟 + 每次审计；不批量/不下载/不导出） |
| 补录识别结果（回填订单识别字段） | ❌ | 自己的（`order.correct` 改码） | ✅（仅识别字段，不改状态、不代确认；审计） |
| 任何金额/支付/收款/运费/价格操作 | — | — | **不存在（零金额）** |

**限流（服务端，落 `counters.rl:{scope}:{openid}:{window}`）**：绑定相关（`partner.getPublic` 预览 + `bind.create` 提交，**合计同一计数桶**）**60 秒窗口内最多 5 次尝试**（D39，2026-10-28 用户拍板「不限总次数、限时间内次数」：按 UTC+8 **分钟分片**计数——窗口内 5 次，跨分片边界最坏约 2 秒内可再放 5 次，仍受「每人每日约 7200 次」上界与 `partnerNo` 32^6 空间约束，保留防枚举闸、提额不得取消；取消「每自然日 5 次」总量；失败尝试计入，格式错在 validate 前拦不计数）；邀请码激活失败 5 次/日/openid；下单 20 单/日/顾客；留言 30 条/日/订单；账号切换（真实只读/测试可写）开启 20 次/日/开发者；**头像上传 5 次/日/人**；**AI 识别兜底不设每人每日次数上限（D40，2026-10-28 用户拍板「AI 不限额」），保留全局日配额 `config.aiFallback.dailyQuota`（默认 200）、超时与冷却静默降级**；**`upload.prepare` 60 次/日/人**（D40：截图上限 10 张/单时 30/日会 3 单即锁）；**D58 转派 3 次/分钟、20 次/日/兼职（阈值读 `config.transferRate`）；D59 子邀请码 3 次/分钟、20 次/日/主兼职（阈值读 `config.subInviteRate`）**；admin 操作全审计；超限返回 `RATE_LIMITED`（AI 兜底超限不返回错误，静默降级）。

---

## 11. 隐私与数据留存（硬约束，对外承诺）

### 11.1 收集清单（最小化）
| 数据 | 是否必填 | 用途 | 保存期限 |
| :-- | :-- | :-- | :-- |
| openid | 必（平台提供） | 账号与数据隔离 | 账号存续期 |
| 顾客编号 / 兼职编号 | 系统生成 | 身份识别、绑定、客服沟通 | 账号存续期（注销作废） |
| 微信昵称（必填，可改/手填） | 必填 | 顾客/兼职展示（订单双方） | 账号存续期（注销删除） |
| 微信头像（`chooseAvatar`，可拒绝→默认头像） | 自愿 | 绑定双方展示（仅 ACTIVE 绑定关系内） | 账号存续期；换头像/注销即删旧文件 |
| 苑/楼栋/宿舍号 | 必填（才能下单） | 履约送达（下单人宿舍；D25 可另填本单配送地址） | 账号存续期 |
| 本单配送地址/收件人称呼（D25） | 可选（默认=本人宿舍） | 互送场景送达第三方地址；仅本单有效，不写回资料 | 随订单（完成/取消后 180 天匿名化） |
| 手机尾号 4 位 | 可选 | 同寝室区分辅助 | 账号存续期 |
| 性别（D31，2026-10-27 新增） | 默认按苑/楼栋自动推断，可手动修改 | 本人资料核对与后续按楼栋属性核对；**仅本人可见**，兼职端与后台不展示；未知不阻塞资料保存 | 账号存续期，注销时删除 |
| 订单信息（站点/取件码/柜号/服务类型/预约/备注；多包裹） | 必 | 履约与进度 | 完成/取消后 180 天，随后删除或匿名化 |
| 取件码截图（0~10 张/单，D40） | 自愿（D24 改判：可无截图手填） | 识别与兼职核对 | 完成/取消后 7 天删除 |
| **本机取件码清单（D57，2026-11-01 新增）** | 自愿（顾客自己添加） | 顾客自己在驿站取件时核对（含「我已取到」本机标记）；**不上传、不进服务端、不生成订单、与订单/绑定解耦** | **只存本机**（`ex_college_v4.pickcodes`）：不上传、不共享、不进日志/通知/分享卡片；顾客可随时一键清空；换设备或清缓存即丢失；上限 50 条 |
| 识别失败兜底外发（v0.8） | 自动（仅识别失败时） | 把**去敏 OCR 文本**发给 DeepSeek API 做结构化识别辅助 | 不落第三方存储、不用于训练；我方只保留脱敏副本（随失败记录） |
| 识别失败原图与复核记录（v0.8） | 自动 | 开发者排查识别问题（含原图临时查看，审计） | 默认 30 天（`recognitionFailureRetentionDays`，7~30 可配），到期删除 |
| 订单留言文本 | 可选 | 沟通 | 随订单 |
| 邀请码使用记录 | 兼职激活时 | 准入与审计 | 账号存续期/审计需要 |
| **订单转派记录（D58，v1.10）** | 转派动作（发起/确认/拒收/撤回/过期） | 记录发起/目标兼职**编号快照**与转派状态/原因/时间，供顾客看到当前履约人、双方与后台核对；**不含头像/昵称/customerNo** | 随订单（完成/取消后 180 天匿名化时清 `transfer` 编号快照、保留状态/原因） |
| **子队员隶属与队内展示（D59，v1.10）** | 主兼职发子码、子队员激活时 | 主兼职管理团队（成员编号/昵称/状态/加入时间，**无头像**）；子队员可见所属队伍编号与成员数 | 账号存续期（注销时随 `partners` 匿名化，`parentPartnerId` 保留供层级审计） |
| 开发者后台访问、只读视角与账号切换审计日志 | 自动 | 安全审计 | 按审计策略保留（≥180 天） |
| 云函数日志 | 自动 | 故障排查/安全审计 | 按云开发控制台设置，最短可用期限 |

**永不收集**：完整手机号、通讯录、定位、身份证、**支付/银行卡信息（本程序也不处理任何金钱）**、麦克风、微信好友关系；**不收集微信资料中的性别**（性别只来自你填写的苑/楼栋推断或本人手动修改，见 D31）；**不收集用户相册里的其他照片**（头像仅取微信头像或默认头像）。
**剪贴板（2026-10-22 口径澄清，D57 扩围）**：仅用于两个明确动作——①用户点击「复制」时把订单号/唯一编号/**取件码**写入系统剪贴板；②用户在绑定页点击「粘贴」时读取剪贴板中的兼职编号并填入输入框（D57 的本机清单手动添加由用户在输入框内自行粘贴，**不调用 `wx.getClipboardData`**）。**不后台读取、不保存、不上传**，剪贴板内容不进入服务端/日志。微信后台《用户隐私保护指引》须声明「剪切板」（`wx.setClipboardData`/`wx.getClipboardData` 未声明时会报 `api scope is not declared in the privacy agreement`）。
**不外泄**：不向第三方共享/出售；截图/尾号/头像/昵称不出现在分享卡片、通知、日志明文；**后台默认脱敏（不展示头像、昵称脱敏），完整 L3 数据仅通过审计过的只读视角查看**。**本机取件码清单（D57）不是服务端数据**：不上传、不下发、不进入任何服务端集合或日志，**只读视角与后台均不可见**（只存在于顾客本人设备）；顾客可随时清空，换设备/清缓存即丢失。
**头像与昵称可见范围（v0.9，用户四次修订）**：顾客与兼职的微信头像/昵称**只向自己与该角色当前 ACTIVE 绑定的对方展示**（顾客看到绑定兼职；兼职在客户档案看到绑定顾客）；解绑/停用/注销后立即不再展示；订单快照不复制头像/昵称；**后台列表/详情不展示头像**，昵称按脱敏规则展示；分享卡片只有编号，不含头像/昵称。**客户端须 onShow 重新拉取；换头像后 fileId 变化（旧 fileId 失效即回默认头像）；解绑/停用/注销后服务端停发；对方设备已缓存/已截图的副本无法技术撤回（隐私文本写明）。** **D59 队内例外（v1.10）**：主兼职可见**本队**子队员的 `partnerNo/displayName/status/teamJoinedAt`（**不含头像/fileId**、队内管理用途，`partner.listSubMembers`）；顾客不可绑/不可见子队员（`partner.getPublic`/`bind.create` 对子队员 `NOT_FOUND`）；子队员只见所属队伍摘要（`parentPartnerNo/memberCount`）——头像可见面不因此扩大，昵称可见面仅扩到本队主兼职。
**第三方 AI 例外（v0.8，用户三次修订，必须写进隐私指引）**：仅当 OCR 识别站点/取件码失败时，把**去敏后的 OCR 文本**（不含原图、不含 openid、不含联系方式、不含头像/昵称）发送给 DeepSeek API 做识别辅助；DeepSeek 不用于训练、不落我方日志全文；**原图不出本程序云存储**。识别失败原图仅在开发者复核页以临时 URL 查看并逐次审计。

### 11.2 公开承诺变化（相对 v3）
v3 是"数据只存本机、不上传、无账号"；v4 必须改为"**订单与资料存于微信云开发，按角色隔离；仅订单双方可见；开发者后台治理访问（脱敏+审计）；可注销删除**"。**v0.8 另加两项必须披露**：①识别失败时**去敏 OCR 文本**会发给第三方 AI 服务（DeepSeek）做识别辅助，原图不出本程序云存储；②识别失败原图会进入开发者复核流程（临时查看+审计，默认 30 天删除）。**v0.9 另加两项必须披露**：③采集**微信头像与微信昵称**，只向当前绑定的对方展示（头像可拒绝→默认头像，不影响使用）；④开发者账号可**切换账号**——真实账号只读查看（审计/拒写），测试账号为后台合成账号（不含真实用户数据）。这是**对外承诺的变更**：上线前先定稿《用户隐私保护指引》与《用户协议》文本（`docs/privacy/`），微信后台逐项声明后再提审。**后台填报口径（2026-10-22 按官方模板校正）**：按官方「处理的信息」清单声明 **昵称、头像（同一项）/ 选中的照片或视频信息 / 摄像头 / 选中的文件 / 剪切板**（「地址」如后台提供则如实勾选；「相册（仅写入）」不使用、不勾；手机号为个人主体不可用、不勾）；自开发小程序**没有**「第三方服务/SDK」栏，DeepSeek 的对外提供在对应信息类型「用途」、「信息对外提供」（如可编辑）、补充文档与端内政策中披露并取得同意；**不得按旧口径在不存在的位置硬填**。

**v1.1（2026-10-27）新增披露**：①**性别**（D31：默认按苑/楼栋推断、可手动修改；当前仅本人可见，兼职端与后台不展示；未知不影响使用；注销删除）；②**识别失败原图与 AI 排障信息**（D33：失败截图原图与去敏文本进开发者复核，临时查看+逐次审计，默认 30 天删除；AI 只发去敏文字、不发原图）；③**收费边界澄清（D30）**：「不需要花钱」指**交易不在小程序内发生**——本程序不参与交易、不处理资金；线下费用与小程序无关，页面不出现价目/账单/支付入口/交易字段。

**v1.8（2026-11-01，D57）新增披露**：顾客可在取件清单页自建「我的取件码」列表。**取件码属 L3，本机清单是本程序唯一允许的「L3 明文存本机」例外**——该清单**只存顾客本人设备**（键 `ex_college_v4.pickcodes`），**不上传、不共享、不进入服务端/日志/通知/分享卡片**，**兼职端与开发者后台（含只读视角）均不可见**；顾客可随时一键清空，换设备/清缓存即丢失；截图识别为**端侧能力**（不上传截图、不外呼第三方 AI）；手动添加由用户自行输入/粘贴。隐私指引必须写明上述边界。

**v1.10（2026-11-03，D58/D59/D63）新增披露**：①**订单转派与协作履约**——已接单未取件的订单可能被转派给其他 ACTIVE 兼职（含你绑定兼职的协作队员），即**订单可能由你绑定兼职的协作队员协助履约**；转派只改写订单履约人（`partnerNo` 编号快照），不改订单号/顾客/绑定/宿舍标识；顾客可看到当前实际履约兼职的**编号**（不含头像/昵称），转派记录保留在订单与事件流水；D19/D42 不破——非绑定履约人**不取得**顾客头像/昵称/客户档案，仅获本单履约必需的站点/取件码/配送地址/备注。顾客侧 `counterpart`（头像/昵称）**仍按当前 ACTIVE 绑定关系取人、不随转派变**，当前实际履约人仅以编号 `fulfillmentPartnerNo` 呈现——**头像/昵称可见面不因转派扩大**（D19/D42 不破）。②**队内昵称可见范围**：主兼职可见本队子队员的编号与昵称（**不含头像**），用于队内管理；子队员可见所属队伍编号与成员数。③**零新增采集、零新增第三方服务、不新增信息类型/保存期限**：D58/D59/D63 均不新增采集项、不新增第三方、不改变保存期限；**转派仅向承接兼职提供本单履约必需的最小信息（站点/取件码/配送地址/备注，已在①披露），承接方不取得头像/昵称/客户档案**；D63（顾客分享绑定卡）**零新增披露**（卡片只带兼职编号，不记录邀请关系、不含邀请者信息）。**文本版本 = 定稿 v1.10（2026-11-03 用户确认）**；`config.privacyVersion` 保持 `v4.0.0` 不升版（用户 2026-11-03 确认），端内全文/补充文档/发布前清单已同源同步。

### 11.3 安全
- 数据库安全规则：客户端读写全部拒绝；云函数用 admin 权限并按 openid 过滤。
- 云存储：私有（客户端不可读）；临时 URL 5 分钟；上传 ticket 校验。**头像（v0.9）**：`avatars/{role}/{random}.jpg`、≤200KB、jpg/png、路径随机不可枚举；仅 DTO 返回给本人/绑定对方；后台与分享卡片不下发；旧头像替换即删。
- 输入校验：所有文本长度/字符集闸；留言/备注/**昵称**过 `security.msgSecCheck` v2；截图 P1 过 `security.mediaCheckAsync`；头像校验类型/大小/图片可解码，**微信头像来源由平台审核**，若后续允许自定义上传须补 `mediaCheckAsync`（P1）。
- **剪贴板边界**：仅用户主动复制/粘贴时读写；不后台读取、不保存、不上传；隐私文本与微信后台声明两端一致（见 §11.2）。
- **本机取件码清单（D57）**：属「L3 明文存本机」的唯一例外——仅 `utils/storage.js` 单一写口写 `ex_college_v4.pickcodes`（独立于 `ex_college_v4.store`）；客户端零上传、零外呼、零 `wx.cloud`；不进日志/通知/分享卡片/URL；只读视角与后台不可见；顾客可一键清空；`READONLY` 会话仅渲染说明卡（不渲染本机数据/入口）且拒绝写入；换机/清缓存丢失（页面固定说明）。上游约束见 ENGINEERING §5.6/§8.2 #15。
- 敏感操作审计：邀请码、停用、配置、admin 操作、切换会话、解绑、订单状态变更全部落 `order_events`/`admin_audit`。
- 切换会话票据（v0.9）：随机 32 位、服务端存储、内存传递、30 分钟过期；`READONLY` 仅读、`TEST_WRITE` 仅测试账号可写；发起人每次校验白名单；`targetId/targetIsTest/impersonatedBy` 三者在服务端交叉校验，票据不能挪用到其他账号。
- 开发者账号：白名单只存在云函数环境变量，不进代码/前端/数据库；前端隐藏不作为安全边界；**多开发者（DEV-02…）各自微信登录、各自会话/审计，不共享票据**。
- **AI 兜底安全（v0.8）**：`DEEPSEEK_API_KEY` 只存云函数环境变量，客户端包内零出现；外发 payload 白名单（`ocrTextMasked/hintTrackingTail/role`）+ 服务端二次去敏；原图与 openid 不外发；响应不整段落日志；失败入队可追溯；复核页原图临时 URL 5 分钟且每次审计。

- **入参体积闸（v1.1/D34 安全基线）**：云函数入口对 `event.data` 序列化字节数、键数与单字段长度设上限（超限 `VALIDATION_FAILED`；internal 动作豁免但记录）。
- **限流覆盖（v1.1/D34）**：写动作（绑定/激活/下单/留言/改码/资料保存/头像上传/账号切换/AI 兜底/复核补录）与临时 URL 签发动作都有日/窗口配额；超限 `RATE_LIMITED` 或静默降级（AI）。
- **越权回归（v1.1/D34）**：伪造 openid/编号/票据、过期票据复用、跨账号读、admin 无白名单、imageUrl 跨单等负向用例进 `selftest-security`；云控制台安全配置清单见 RUNBOOK（数据库/存储规则、环境变量、日志留存）。

### 11.4 注销与删除
- 顾客注销：检查无进行中订单 → 删除 `customers`/`users` 资料（含**头像文件**）、截图、留言；订单匿名化后 30 天内物理删除；解绑；`customerNo` 作废不再分配。**执行时点（批 9 澄清）**：注销事务只做「绑定释放 + `users` 置 DEACTIVATED」，PII 匿名化、截图与头像文件删除由**下一轮 cleanup（≤10 分钟）**执行（`user.deleteAccount` + `cleanup.accountDeletion` 两阶段链路，见 DATA_MODEL §10.4）。
- 兼职注销：由开发者后台 `admin.setPartnerStatus(CLOSED)` 执行（无自助入口；需先处理完未完成订单并解除全部绑定）：释放绑定并清 `partnerNote`、进行中订单转 `EXCEPTION` 待后台处置；`partners` PII 匿名化（**`displayName`/`avatarFileId`/停用与关闭原因清空、`openid` 换为不可回收的注销占位串**）并**删除头像文件**；`invitation_codes.usedBy` 置空（保留 `usedAt`/`batchId` 审计）；识别失败记录清 `uploaderOpenid`/`fileId` 并按引用计数删原图；**`partners` 文档保留审计不物理删**；`users` 增写 `closedPartnerNo`/`partnerClosedAt` 标记，`partner.activate`/`user.bootstrap` 按标记判定「已注销不可再激活」（不再依赖 `partners.openid` 留存）；已终态订单仍按终态留存口径（180 天后匿名化），不随 CLOSED 立即匿名化；`partnerNo` 作废不再分配。**D59 级联（v1.10）**：主兼职 CLOSED 时同 `parentPartnerId` 的子队员一并 CLOSED（子队员 CLOSED 仍走既有 PII 匿名化、`parentPartnerId` 保留供层级审计），并结束该队全部 `PENDING` 转派邀请（`CANCELLED`/`reason=STATE_CHANGED`）；`removeSubMember` 的恢复只能由开发者执行。**执行语义（2026-10-31 TD-053/055/056/057 收口）**：DB 写按「有界分批事务（绑定/进行中单/识别失败/会话每页一事务，单事务 ≤100 操作＝CloudBase 平台上限）+ 最终关键段（`users` 标记与 `partners` 状态/占位同一小事务原子）」提交；中途失败时 `partners` 仍为原状态（`CLOSED` 只在最终段生效）、**同一请求可幂等重试续跑至收敛**（已提交页零重写）；CLOSED 生效即结束该 target 的全部有效 `admin_view_sessions`（`ACCOUNT_SWITCH_END`，reason=`TARGET_DELETED`）；云存储文件删除在事务外，失败仅告警并由 cleanup/TD-051 兜底。
- 顾客可删除单条已完成订单记录（软删，7 天后物理删除）。
- **测试账号（v0.9）**：`admin.deleteTestAccount` 删除账号 + 头像 + 全部测试数据（含测试订单、留言、绑定），并写审计；`admin.purgeTestData` 只清数据保留账号；cleanup 清理超 30 天未使用的测试数据；测试账号不涉及对真实用户的隐私披露（无真实微信资料）。
- **识别失败记录（v0.8）**：上传者注销 → 清 `uploaderOpenid`（匿名化）、原图按引用计数删除、`ocrTextMasked` 随记录保留至到期（默认 30 天）后物理删；兼职 CLOSED 同口径（记录保留至到期，供复核审计）；复核审计日志按审计策略保留。
- 微信合规：未成年人保护提示；《用户协议》《隐私政策》入口在"我的"。

---

## 12. 工程与文档规范（细节见 `docs/engineering/V4_ENGINEERING.md`）

- 技术栈：原生小程序（WXML/WXSS/JS）+ 微信云开发（Node.js 云函数，`wx-server-sdk`）；**零第三方前端依赖**；不引入 npm 前端包。
- 分层铁律：页面层（只做 setData/事件转发）/ 零件层（纯逻辑，零 `wx`，可单测）/ API 适配层（唯一云函数出口，统一注入 `viewTicket`）/ 云函数层（校验 + 业务 + 数据访问）。页面层零业务判据（v3 教训 TD-016）。
- **编号零件**：`utils/ids.js` 纯函数负责格式/校验/展示/错前缀提示；生成只在云端（随机源在服务端）。
- 文件/函数行数：源码文件 ≤500 行、测试文件 ≤1000 行、函数 ≤50 行（与 v3 AGENTS §11.1 同口径，全文行）。
- 命名：文档/代码/UI 同字典（本卡 §3）；禁止 `data/info/handle` 空泛名。
- 测试：纯模块用 v3 式 selftest harness（断言计数闸）；云函数 handler 用依赖注入 + 内存 fake DB 单测；真机/双机联调用 `docs/delivery/V4_QA_CHECKLIST.md` 人工点检清单（agent 不代宣布通过）。
- **零金额门禁**：源码/页面文案/文档扫描 `Fen|price|fee|pay|amount|金额|价格|运费|收款|结算`，命中即失败（白名单：说明性文档中"本程序不涉及费用"的声明文本单独登记）。
- **D30 收费边界澄清不破零金额**：允许声明「交易在小程序外完成」，仍禁止价目/账单/公式/支付入口/交易字段，扫描口径不变。
- **AI 兜底门禁（v0.8）**：`ai` 外呼只允许存在于云函数层（客户端目录出现 `DEEPSEEK_API_KEY`/`api.deepseek.com` 即失败）；`ai.parseParcel` 外发字段必须等于 §4.3 白名单（单测断言 payload 键集合）；失败必须写 `recognition_failures`（禁止静默丢弃）；后台复核页原图访问必须落 `FAILURE_IMAGE_VIEW` 审计。**D33 增补（v1.1）**：失败记录 `fileId` 必须是真实失败截图（服务端按票据校验，拒绝伪造）；复核接口/页面必须返回 AI 排障字段与只读 AI 状态（`hasKey` 布尔，禁止下发 Key）；客户端在无文本/规则未命中等失败路径必须调 `ai.parseParcel` 入队。
- **绑定方向门禁（v0.9）**：`bind.create` 仅 CUSTOMER 可调；兼职端/后台不得出现"绑定顾客/添加顾客/导入顾客"入口或接口；代客下单代码路径不得写 `bindings`；测试账号×真实账号绑定必须拒绝（selftest 断言）。
- **头像昵称门禁（v0.9）**：头像只允许 `upload.prepare({purpose:'AVATAR'})` → `avatars/…`，≤200KB、jpg/png；昵称落库前截断 ≤20 字且过 `msgSecCheck`；分享卡片/通知/日志/后台列表不出现头像 fileId；后台 DTO 无 `avatarFileId`；解绑后 DTO 不再返回对方头像/昵称。
- **账号切换门禁（v0.9）**：`viewMode=TEST_WRITE` 仅 `isTestAccount=true` 可签发；真实账号传 `TEST_WRITE` 必须 `FORBIDDEN`；真实账号×测试账号互绑/互下单必须 `FORBIDDEN`；统计/红点/邀请码/审计报表排除测试账号与 `isTest`；测试写事件必须带 `impersonatedBy`；切换会话票据内存态、不落本地存储。
- 完成定义（DoD）：`check.ps1` 退出码 0 + 真实输出 + 本批验收项逐条打勾；设计阶段 = 文档齐全 + 交叉一致性检查通过 + 用户裁决项列清。
- 文档地图（v4；2026-10-31 结构重整后目录见 `docs/README.md`）：
  - `docs/README.md`（文档总览与索引：权威顺序/目录地图/阅读路径/逐份摘要/归档索引）
  - `docs/contract/V4_REBUILD_SPEC.md`（历史主规格快照：产品/架构/权限/状态机/批次/验收/裁决；冲突以本文为准）
  - `docs/contract/V4_CONTRACT.md`（本文，口径卡）
  - `docs/data/V4_DATA_MODEL.md`（集合/字段/索引/API 契约/编号规则/roomTag/安全规则）
  - `docs/ux/V4_UX_CUSTOMER.md`（顾客端页面与交互）
  - `docs/ux/V4_UX_PARTNER.md`（兼职端页面与交互，含 v3 清单补齐清单）
  - `docs/ux/V4_UX_DEVELOPER.md`（开发者后台、账号切换/只读视角：邀请码/数据查看/审计/测试账号）
  - `docs/engineering/V4_ENGINEERING.md`（工程结构/环境/测试/门禁/部署）
  - `docs/contract/V4_DECISIONS.md`（裁决卡；D1~D50）
  - `docs/delivery/V4_QA_CHECKLIST.md`（真机/双机人工点检清单，人执行）
  - `docs/delivery/V4_REVIEW_MATERIALS.md`（批 9：审核材料与提审体验路径，用户执行；agent 不代提审）
  - `docs/delivery/V4_V3_PARITY.md`（批 9：v3→v4 功能对照验收表，用户勾选底稿）
  - `docs/privacy/`（隐私指引草案 + 发布前填写清单，上线前人执行）
  - `docs/engineering/V4_ARCHITECTURE.md`、`docs/delivery/V4_RUNBOOK.md`（批 1 建立）
  - `docs/governance/lessons/`（v4 新踩坑）
  - `docs/archive/`（历史归档：临时总览/研究/审查；只追溯，不作为现行口径或验收证据）
- 提交：v4 需 `git init` + 显式 `-c user.name=... -c user.email=...`；提交信息 `feat(v4): <批名> + 证据摘要`。

---

## 13. 用户裁决事项（D1~D67；2026-10-22 全部闭环，v1.0 增补 D23~D29，v1.1 增补 D30~D35，v1.2 增补 D36，v1.3 增补 D37~D42，v1.4 增补 D43~D50，v1.7（批 20）增补 D51~D57，v1.8（批 21）D57 定稿，v1.9（2026-11-02）增补 D58~D67，**v1.10（2026-11-03 批 26/27）冻结 D58/D59/D63 实现细节**）

> **裁决状态（滚动更新）**：D1~D42 已闭环（2026-10-28），**D43~D50 于 2026-11-01 增补**——D1~D22 于 2026-10-22 用户回复闭环，原文留痕见 `docs/contract/V4_DECISIONS.md` §0.1；D23~D29 于 2026-10-22 晚、D30~D35 于 2026-10-27、D36~D42 于 2026-10-28 分批裁决，逐条留痕见 `docs/contract/V4_DECISIONS.md` §0 与各 D 段。D1/D3/D4/D7/D9/D10/D11/D12/D14/D15/D16/D17/D18/D19 = 按推荐确认；D2 = 沿用 v3 appid；D8 = 东/西/南/北/翠苑；D13 = 个人主体+工具类目；D22 = A（**同日改判为 B，见 D24**）；D5/D6/D20/D21 早前已定。**v1.0 增补（2026-10-22 晚用户指令 "先决定 C 再 B 最后 A"）**：D23~D26 为 C 批五项功能的裁决落地；**D28/D29 为 B 批按推荐采纳**（换绑一体化 / 状态事件计入未读红点 + AI 低置信不写入）；A 批 P1 十项按推荐采纳、排在 C→B 之后实现（清单见 `docs/contract/V4_DECISIONS.md`「批 10 方案采纳记录」）。**2026-11-01 增补 D43~D50（用户反馈 Q1~Q10）**：送达日结「次日 22:00」自动完成（D43）、代客下单补全（D44）、工作台日期分类（D45，形态待设计研究后拍板）、独立楼层清单页（D46）、预约「最晚可接受时间」（D47）、订单汇总复制（D48）、存量「送至楼下」一次性回填（D49）、**不新增「已支付」状态**（D50）；原始方案与逐条证据见 `docs/archive/reviews/2026-11-01_USER_FEEDBACK_PROPOSAL.md`。**v1.8（2026-11-01 晚，批 21）D57 定稿**：用户对方案理解稿三条边界逐条拍板——「①当这个清单面向顾客自己时，**不强制绑定**；②**不开放**（兼职端与后台均不可见）；③**本地**（只存本机、不走服务端）」，据此按「本机清单」实现（详见本表 D57 行与 `docs/contract/V4_DECISIONS.md` D57 段）。**v1.9（2026-11-02）增补 D58~D67**：用户对《用户新需求理解、扩展与补全（2026-11-02）》Q1~Q11 逐条裁决——转派目标确认接收且可转任意 ACTIVE 兼职（D58）、主兼职发子邀请码开子账号且顾客不绑子队员（D59）、快递信息来源研究接受「不可行」维持现状（D60）、件级取件+订单状态聚合+多站点按件分组（D61/D62）、顾客可发绑定卡但不记录邀请关系（D63）、取件码升一级入口用「伪 tab」且删 D26 订单区（D64）、全局底部安全区系统性修复（D65）、首页下单文案统一（D66）、兼职客户页筛选器一期维度（D67）；原始方案与现状证据见 `docs/archive/reviews/2026-11-02_USER_FEEDBACK_PROPOSAL.md`。

| # | 事项 | 推荐 | 代价/被否 |
| :-- | :-- | :-- | :-- |
| D1 | 后端用微信云开发 | ✅ 推荐 | 否：自建后端（域名/备案/运维）或纯本地（不满足跨设备）。**执行方式（2026-10-22 修订）**：账号只能开 1 个云环境 ⇒ 单环境部署，测试数据靠测试账号/`isTest` 标记隔离 + 上线前清零（见 DECISIONS D1 修订留痕） |
| D2 | appid：**沿用 v3 appid `wxcb7e5b41b89bc806`**（用户 2026-10-22 指定，非推荐 A） | ✅ 已定（B） | 代价：同一 storage 命名空间（v4 只碰自己的键）、发布 v4 即替代 v3、隐私/类目在同一 appid 重新提交 |
| D3 | 兼职准入用邀请码（一次性/有效期/可作废/可审计） | ✅ 推荐 | 否：openid 白名单（不可自助发放）；硬编码密钥（禁止） |
| D4 | 一顾客同时绑一个兼职；**绑定只能由顾客发起**（兼职不能绑定/代绑顾客） | ✅ 推荐 | 否：多兼职（隔离与履约归属复杂、顾客易困惑）；兼职可绑定顾客（越权与骚扰风险，用户已否） |
| D5 | 服务只分类型（标准代取/送至楼下/加急/代寄/其他；D41 修订），**不含价格** | ✅ 已按用户指示定（v0.7） | 原"兼职定价/金额快照"作废 |
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
| D16 | OCR 失败兜底用 **DeepSeek API**：服务端调用、只发去敏文本（不发原图/openid）、8s 超时、5 次/人/日 + 全局配额（**每人每日次数已由 D40 取消**）、失败静默降级并入复核队列 | ✅ 推荐 | 否：不用 AI（失败全靠手填/人工复核）；或客户端直连（Key 泄露，**禁止**）；换其他 AI 服务只改云函数适配层 |
| D17 | 识别失败**原图**在开发者后台复核页可见：仅白名单开发者、临时 URL 5 分钟、每次审计、**不批量/不下载**、保留 30 天（7~30 可配）；补录仅回填识别字段不改订单状态 | ✅ 推荐（用户已明确要求"含原图反馈"） | 若不允许看原图：只能看 OCR 文本，复核效果差；若延长保留期需同步改隐私承诺；若允许批量导出：审计与滥用风险上升 |
| D18 | **账号切换模式**（v0.9）：真实账号**只读**（=原只读视角）+ **测试账号可写**（后台创建合成账号 `isTestAccount`，`TEST_WRITE` 会话，单机验收顾客/兼职两端；测试数据隔离/标记/排除统计/30 天清理；真实账号不可写、平台也不支持切换微信账号本身） | ✅ 推荐（用户四次修订"要能切换账号"的落地方式） | B 真实账号也可写：隐私/审计/数据污染风险高，不推荐；C 只读不提供测试账号：一个微信号无法验收两端真实操作 |
| D19 | **头像/昵称采集方式**（v0.9）：`chooseAvatar` + `nickname` 输入（昵称必填、可改/手填；头像可拒绝→默认头像）；仅绑定双方可见；后台不展示头像、昵称脱敏；卡片/通知不含；注销删文件 | ✅ 推荐（用户已明确要求采集） | 若强制获取且不可改：违反微信"用户主动选择"原则、体验差；若只采昵称：不满足用户第 4 条 |
| D20 | **绑定方向**：只能顾客发起绑定，兼职不能绑定顾客（v0.9 按用户指示定） | ✅ 已定（用户四次修订） | 无；兼职端只保留解绑 |
| D21 | **roomTag 恒大写**（`A…Z/AA…`，展示 `D4-522A`；v0.9 按用户指示定） | ✅ 已定（用户四次修订） | 无 |
| D22 | **截图上传失败后是否允许「无截图手填提交」**：**用户 2026-10-22 裁决 A（保持必须先有截图）**；上传失败只能重试/换图，OCR/阅读失败仍可手填 `NEED_CODE`。**同日改判：用户指令「开放手动填写功能」→ 改为 B（允许无截图手填提交），落地见 D24**；旧口径 A 作废，保留改判留痕 | ✅ 已定 A → **改判 B（2026-10-22 晚）** | 选 B 的代价见 D24；TD-039 关闭依据同步改为 D24；页面/服务端校验与断言按 D24 实现 |
| D23 | **批量下单与合并窗口（v1.0 订单模型变更，用户 2026-10-22 指令）**：一次多选 0~5 张截图 → 识别后**合成一张订单（1~10 件包裹）**；同一顾客+同一绑定兼职在 `orderMergeWindowMinutes`（默认 10 分钟，0=关闭）内、且已有 `SUBMITTED` 订单且配送地址相同 → 新提交包裹**自动追加到同一订单**（短间隔归一单）；不满足则新建订单。订单级动作作用于全部包裹；单量统计按订单计（合并单=1 单）；`createBatch` **已移除**（无生产数据 D11 空库起、客户端零调用、测试零覆盖；一图多码能力并入 `create` 的 `parcels[]`/`images[]`；调用未登记动作 → `FORBIDDEN`「不支持的操作」） | ✅ 已定（用户明确要求） | 代价：订单主表从单包裹改多包裹（`parcels[]`/`images[]`），状态动作/DTO/兼职工作台/后台/清理/复核/全部判据联动；无生产数据（D11 空库起）故可破坏式升级；合并仅限 `SUBMITTED`，已接单后的新提交另建新单；不同地址不合并；上限 10 件/5 图（D40 已修订为 10 图） |
| D24 | **无截图手填提交（D22 改判 B，用户 2026-10-22 指令「开放手动填写功能」）**：截图非必填，`images=[]` 且 `manualEntry=true` 可提交；兼职端/订单详情/后台显示「无截图·手填」；仍鼓励上传截图（识别更快）；无截图单不进入识别链路、不调 AI、不写复核队列；每件包裹仍必须站点+取件码或运单尾号（`NEED_CODE` 口径不变） | ✅ 已定 B | 代价：D22/隐私文本/QA/UX 与 `order.create` 校验/兼职核对体验联动；D9「截图 7 天删除」仅适用于有截图单；伪造/漏填风险由「站点+码/尾号」校验兜底 |
| D25 | **每单配送地址（互送场景，用户 2026-10-22 指令）**：`orders.delivery{zone,buildingNo,room,dormKey,buildingText,recipientName?,phoneTail?}`，默认=下单人当前宿舍；下单时可改为他人苑/楼栋/宿舍并填收件人称呼（≤20 字）；**仅本单有效**，不写回 `customers`、不触发重绑/roomTag；兼职按本单 `delivery` 送达；合并窗口要求 `delivery` 相同才合并 | ✅ 已定 | 代价：新增 L3 第三方地址/称呼（仅本单顾客本人、该单兼职、admin 脱敏可见；不进通知/分享卡片）；`orders.dorm` 保留为下单人宿舍快照；地址校验复用宿舍规则 |
| D26 | **顾客取件清单（独立入口，用户 2026-10-22 指令）**：新增页面 `pkg-customer/pages/pickup-list/index`；只显示本人进行中订单的「快递站点 + 取件码」（可复制、可按订单分组），可本地勾选"我已取到"（**仅本地标记，不回写服务端、不影响订单状态**）；入口=顾客首页卡片（独立入口，不新增 tab）；数据来自 `order.listCustomer` 的 `parcels[]`；无新采集/新集合/新通知 | ✅ 已定 | 代价：新增分包页面（app.json/页面地图/QA/UX 联动）；勾选状态只在本机（换设备/清缓存丢失，符合"清单"语义）；不显示他人包裹。**D57（2026-11-01 用户拍板）修订**：本页新增「我的取件码（本机）」区（自建清单、不强制绑定、只存本机），D26 原「进行中订单」区不变 |
| D27 | **「看兼职到哪一栋」实时位置**（用户 2026-10-22 晚指令）：**不做 GPS 连续定位、不做行踪轨迹**；推荐 **B0 楼栋级自报**——兼职在订单「已取件」窗口内点一次「我到 X 苑 Y 栋了」，顾客端订单详情显示**楼栋级位置卡**（不移动点/不倒计时/不留历史、终态即清、可关闭；零设备定位接口、零新集合）；备选：A=仅「已取件 N 分钟/历史通常用时」状态卡（不做位置）、B1=真 GPS 单点上报（类目白名单+行踪轨迹敏感个人信息+室内漂移，三重风险，**不建议**）、不做=维持"永不收集定位" | 🔄 **待用户裁决**（裁决前维持「永不收集定位」，不新增任何定位字段/页面/文案） | 选 B0 代价：新增一个可选展示字段与一次性自报动作（兼职端 1 次点击）、顾客端位置卡文案与「可能不更新」提示、隐私文本加一句「楼栋为兼职主动提供、非设备定位」；选 A 代价最小但只能给"大概还要多久"；B1 不建议 |
| D28 | **换绑一体化（B-1，用户 2026-10-22 晚「按推荐采纳」）**：顾客换绑兼职时**一次确认**内由客户端顺序执行 `bind.release` → `bind.create`（服务端接口不变、不加新 action）；**有进行中订单仍禁止换绑**；任一步失败必须给**单步恢复**且不留双重绑定/半完成中间态（重试只补未完成的那一步） | ✅ 已定（推荐 A） | 代价：跨两个 action 的客户端编排与失败恢复文案/断言；服务端保持无状态（不做跨调用事务）；解绑成功的顾客在重绑失败时短暂无绑定（UX 明确提示"重试绑定"） |
| D29 | **状态事件计入未读红点 + AI 低置信不写入（B-2/B-5，用户 2026-10-22 晚「按推荐采纳」）**：`message.list` 的 `unread` = **未读留言 + 未读状态事件**，在**合并视图内计数**（零新增查询/索引，上界=最近单×每单事件/留言上限；公告/NOTICE/测试数据/已删单不计）；`markRead` 为**统一前进水位**（事务内 CAS 只进不退；进消息中心或任一订单详情即前进——跨单事件一并清零，属水位语义，文档写明）；AI 识别 `confidence=LOW` 的建议**不写入字段**（**仅 AI 来源 `source='DEEPSEEK'` 适用；`source∈{RULE,NONE}` 的规则/降级结果照旧自动预填**），改为「建议条 + 采纳」（采纳后按建议来源归一 `recognitionSource`，`confidence` 保留 LOW 快照）；HIGH/MEDIUM 及降级分支的规则字段保持自动预填 | ✅ 已定（推荐 A） | 代价：红点数字与列表可见未读点可能不同（视图内计数少计同单 >2 事件，文案不承诺精确数字）；进任一单详情会把他单事件红点一并清零；低置信件多一次「采纳」点击 |
| D30 | **收费口径澄清（用户 2026-10-27 补充）**：用户「不需要花钱」=**交易不在小程序内发生**（线下交易与结账）；小程序内仍不出现任何交易语义（价目/收付/账单/支付入口），D6 不变；对外文案按「本程序不涉及任何费用收付，交易在小程序外完成」表述 | ✅ 已定 | 文案边界解析为「小程序内不发生交易」，不新增交易字段/功能；真机文案待用户点检 |
| D31 | **顾客性别（用户 2026-10-27 要求）**：新增 `customers.gender`（MALE/FEMALE/UNKNOWN）+ `genderManual`；默认按「苑+楼栋」推断——仅东苑 D：楼栋 1/2/5/6/7/8=男、3/4/9/10=女，其余苑=未知；可手动修改、未知不阻塞资料保存；当前仅本人可见，兼职端暂不配置/不展示，后台不展示 | ✅ 已定 | 隐私文本新增性别收集项；D31 落地见 DECISIONS 留痕 |
| D32 | **站点名称可改 + 命中匹配（用户 2026-10-27 要求）**：`config.stations` 固定 8 条 `{id,name}`，开发者可改正式名（1~20 字、唯一）；识别/手输按「精确名→规范名→别名→关键词命中」唯一命中归一，多解不猜 | ✅ 已定 | 不做自建站点；默认名/别名保留；A8 以本方案闭环 |
| D33 | **识别失败原图与 AI 诊断回传开发者（用户 2026-10-27 要求修复）**：任何识别失败必须调用一次 `ai.parseParcel` 入队（无文本只入队不外呼）；失败记录落真实截图 `fileId`（服务端按 upload ticket 校验）；复核页展示 AI 排障字段与只读 AI 状态（enabled/hasKey/model，绝不下发 Key）；修正去敏运单掩码被当取件码的规则缺陷 | ✅ 已定 | 原图复核口径沿用 D17（临时 URL 5 分钟 + 逐次审计） |
| D34 | **v1.1 本批范围（用户 2026-10-27 补充）**：收费文案按 D30；识别兜底/失败回传按 D33；性别按 D31；站点按 D32；顾客端 UI（兼职卡压缩、宿舍标识防误解、订单 tab 居中、头像修复、全局按钮宽度）与卡顿治理；后端安全基线（入参总闸/限流/越权测试/控制台清单）；**A2/A3/A7/A8 明确不处理**，A1/A4/A5/A6 维持后置 | ✅ 已定 | 落地与证据见 DECISIONS 留痕、RUNBOOK §12.1 |
| D35 | **取件码自动填充修复（用户 2026-10-27 真机复验）**：真实截图 `取件码：207-3-1014` 在 OCR 输出**连写 `20731014`／逐字空格／标签粘连／拆多行**时都必须自动回填；**AI 兜底归一后的 `20731014` 不得被客户端日期启发式丢弃**；外发 AI 的去敏文本**保留取件码行 4~12 位码**（手机号/门牌/≥13 位运单长数字仍打码）；日期启发式只拦「带分隔符/年月日」或现实年份（1900~2029）的 8 位日期 | ✅ 已定（修复已实现） | 若本地 OCR 完全没出文本，AI 只吃去敏文本不吃图，无法补码（需手填/开发者看原图复核）；真机三形态复验见 QA §W10 |
| D36 | **分享与朋友圈（v1.2，用户 2026-10-28 指令「转发功能是不是没有，朋友圈转发也要」）**：好友转发覆盖顾客/兼职 19 个业务页；**朋友圈仅 role/home/help 三页**（落地=当前页单页模式，无登录态/不能跳页/云资源不可用，只给静态可自洽页面）；卡片只有「兼职绑定卡（只带 partnerNo）」与「通用邀请卡（零 query）」两种，**固定中性封面、禁止页面截图、零 L3**；切换会话隐藏分享/朋友圈（`wx.hideShareMenu`，O3/M-33 关闭）；可见入口=首页/帮助/我的；朋友圈卡片 query 恒空、不自定义 path（平台限制）、不得诱导分享 | ✅ 已定 | 代价：朋友圈是平台 Beta（基础库 ≥2.11.3、平台支持以官方文档为准、只能经右上角菜单触发、不能自定义落地页）⇒ 单页模式页面无登录态，需静态降级；订单/详情/表单等页面不能发朋友圈；卡片无个性化信息（不支持"带订单转发"）；真机分享/朋友圈效果只能用户点检 |
| D37 | **分享卡经 `launch` 落地 + 隐私闸（2026-10-28 用户拍板 1=A）**：分享卡 path 统一改为 `/pages/launch/index`（绑定卡 `?bind={partnerNo}`、通用卡零 query）；`launch.onLoad` 读 `bind`/`orderNo` 白名单参数（归一/丢弃非法值）→ **先过隐私同意闸** → 再分流（`bind`→`role?bind=` 邀请卡；`orderNo`→订单详情；否则角色/资料/绑定分流）；朋友圈卡片 query 恒空不变（单页模式无登录态）。根治「新用户从分享卡进入无同意入口、所有写动作被拒」与「隐私版本变更后非 launch 首启无入口」。 | ✅ 已定（方案 A） | 代价：多一跳/首屏可能闪一下；`role` 不再作为分享落地，D36 的 path 与「launch 唯一启动页」的自相矛盾按方案 A 收敛；需同步 `utils/share`/`config/route`/QA/`selftest-share`/check #33 判据；**兜底（2026-10-30 用户侧复现后补强）**：修复前已发出的分享卡 path 固化在聊天里（仍指 `role`）、朋友圈卡落当前页，`role`/`customer/home` 等非 launch 首启页在未同意/版本变更时经 `utils/privacy-gate` 纯件回 `launch` 过闸并保留 `bind`/`orderNo`（判据 `selftest-core` D37-b 组 + 变异首红）；真机分享落地只能用户点检 |
| D38 | **绑定自动化（用户拍板 3）**：新用户从邀请卡进入后，按「隐私同意 → 资料补齐」完成后**客户端自动调 `bind.create`**，不再要求顾客在绑定页点「确认绑定」；成熟用户从邀请卡点「绑定这位兼职」直接自动发起；已绑定同号提示「已绑定·去下单」不重复 create；换绑仍按 D28 一次确认。仍由顾客本人发起、仍受隐私/资料完整/自绑/测试隔离/限流校验，**不得后台静默绑定、不得跳过隐私或限流**。 | ✅ 已定 | 代价：绑定动作从「显式确认页」变为「保存后自动执行」，需 loading/失败单步恢复文案与断言；误绑风险由「顾客本人 openid + 邀请卡来源 + 防枚举限流」兜底；已绑定异号仍需显式换绑确认 |
| D39 | **绑定限流改时间窗（用户拍板 2）**：预览 `partner.getPublic` + 提交 `bind.create` 合并同一计数桶，**60 秒窗口内最多 5 次**（按 UTC+8 分钟分片，跨片最坏约 2 秒再放 5 次，上界约 7200 次/日）；取消「每自然日 5 次」总量；失败计入、格式错不计数；同编号 60 秒内不重复请求（客户端）；查询按钮 loading 文案「查询中」且禁用、确认按钮提交中禁用；超限文案单源「操作太频繁，请 1 分钟后再试」，页面说明改「每分钟最多尝试 5 次」。 | ✅ 已定 | 代价：60s/5 ⇒ 每日理论上限 7200 次，保留防枚举（`partnerNo` 32^6 空间）；文档/文案三源（云端 message/`shared/error-copy.js`/页面说明）必须同批统一；测试账号不豁免（未裁决，维持现口径） |
| D40 | **截图上限 10 张 + AI 不限额（用户拍板 4）**：`MAX_IMAGES_PER_ORDER` 5→10（共享单源 + 云副本 sync），件数上限仍 10；清理槽位 `IMAGE_INDEX_SLOTS` 5→10（7 天删除与引用计数覆盖 `images[0..9]`）；AI 兜底取消「每人每日 5 次」（`maxPerUserPerDay=0` 语义=不限），保留全局日配额/冷却/超时降级；`upload.prepare` 30→60 次/日/人；逐图识别加「第 n/N 张」进度。 | ✅ 已定 | 代价：AI 成本面变大（靠全局日配额与超时兜底）；10 图串行识别最坏约 80s，须进度提示；`wx.chooseMedia` 单次上限（常见 9）可能需分次选图（不阻断）；隐私/UX/QA/断言批量回写 |
| D41 | **服务类型重定义 + 新增「送至楼下」（用户拍板 5）**：`PICKUP_STD` 标准代取＝**送到寝室门口（上楼）**；新增 `PICKUP_LOW` 送至楼下＝**宿舍楼下/约定地点（不上楼）**；原 `PICKUP_DOOR` 送寝上门与标准重复 → **默认目录移除、不可新启用**（保留枚举与历史订单展示「送寝上门（已停用）」）；默认 5 类顺序 `STD/LOW/URGENT/DROP_OFF/CUSTOM`（`CUSTOM` 仍末项）。顾客端选择器能区分两档并给层级说明；地址卡文案区分两档；`orders.delivery` 不新增位置字段、不采集定位。 | ✅ 已定 | 代价：`shared/enums`/`config` 目录/兼职服务配置/客服与后台文案/断言联动；存量环境需后台更新服务目录或迁移才生效；原 `PICKUP_DOOR` 历史订单仅展示不新选；兼职激活默认启用口径（现状 5 类全开 vs UX 文档「全部未启用」漂移）同批纠正为代码现状并在 UX 写明 |
| D42 | **头像显示修复（用户拍板 6「一直显示称呼第一个字的默认，选了微信头像也没变」）**：新增 `user.avatarUrl`（本人头像 5 分钟临时 URL，无头像返回空）；绑定对方头像随 `bind.getCurrent`/`user.bootstrap.binding` 下发 `avatarUrl`（仅 ACTIVE 绑定）；DTO 保留 `avatarFileId` 作回退键；`avatar-view` 加载失败可重试（不永久锁死）；保存资料时头像票据失效**不得清空已有头像**（保留旧 `avatarFileId` + 提示重试）；修正 2 处 `file-id` 驼峰属性（`pages/customer/home/index.wxml`、`pkg-customer/pages/order-detail/index.wxml`）为 `fileId`；兼职端「我的」`onShow` 补刷新。 | ✅ 已定 | 代价：新增一个读动作与两处 DTO 字段（需 ARCHITECTURE 冻结接口 + 鉴权矩阵/临时 URL TTL 断言）；头像仍私有存储（不放开 `cloud://` 直读，避免私有文件暴露面）；旧头像上传票据过期不再清空属口径变更（须同步 UX §4.10 与隐私说明）；真机头像效果只能用户点检 |
| D43 | **送达单日结自动完成（后由 D51 修订）**：`cleanup` 按 UTC+8 日结批，cutoff=该单 `deliveredAt` 所在自然日的 `config.autoCompleteAt`（默认 22:00），`now ≥ cutoff` 的 `DELIVERED` 单置 `COMPLETED`（`AUTO_COMPLETED` 逐单、幂等）；10 分钟触发器粒度 ⇒ 实际完成落该时刻~+10 分钟；不额外保留顾客确认窗口、完成即只读归档；**D51 修订：默认 22:00；22:00–24:00 送达的下一轮批内自动完成（不再顺延次日）** | ✅ 已定（次日口径，2026-11-01；D51 修订当日尾窗） | 否：逐单 24 小时（现状）/ 次日 00:xx / 第二触发器 |
| D44 | **代客下单补全（用户 2026-11-01 拍板，Q8）**：①站点按件——每件独立 `stationId/stationName`（默认继承首件、可逐件修改），提交逐件输出、逐件必填，去掉「暂不指定」默认值（与 CONTRACT §5.2 逐件站点一致，属修复而非新口径）；②图片上限 0~10 张（对齐 D40），代客单仍不产生绑定（D12）、BOUND 路径本单配送地址按 D25 后置 | ✅ 已定（2026-11-01） | 否：保持 1 张 / 整单同站点（多件不同站无法表达）。代价：`pkg-partner/pages/create-on-behalf/**`、`components/image-picker`、`api/upload.js`（聊天图 size 透传）、`selftest-order-flow`/`selftest-partner-pages`、UX_PARTNER §3.4 同批 |
| D45 | **工作台新增「按日期分类」能力（用户 2026-11-01 拍板，Q3）**：在现有「进行中按站点分组 + 已完结折叠区」基础上新增日期维度；**批 16 设计研究给出 7 个案对比与推荐（`docs/archive/research/2026-11-01_WORKBENCH_DATE_GROUPING.md`），批 17 按推荐 M1 实施**：已完结区按订单 `createdAt`（UTC+8 自然日）归档 + 进行中行「顺延 N 天」标签；进行中仍站点分组/四档动线不变；服务端零改动、不建 `(partnerId,createdAt)` 索引；未送达单不迁出原下单日（顺延展示）；M2（进行中分节）/M4（日期筛选器）用户可改判另立裁决；不改服务端排序/分页口径 | ✅ 已定（形态=M1，2026-11-01 批 16 研究后按推荐实施，用户可改判） | 否：M2 完整分节（动线视图重设计）/ M3 独立日期页（新增第 33 页联动）/ M5 服务端排序+索引（需用户控制台建索引，且必须 4 件同批改）。代价：工作台 `index.js` 497/500 行须先拆 `parts/`；分组结构变化会整表替换（性能 P0-5 同批） |
| D46 | **新增独立「楼层配送清单」页（用户 2026-11-01 拍板，Q7=独立页）**：`pkg-partner` 新增第 32 页（暂名 pick-list），按 苑→栋→楼层（`floor(room/100)`）分组，默认含 `PICKED`（设计稿定是否含 `ACCEPTED`）；分页/分片 ≤20 行、不参与 30s 轮询、切页才刷新；可复用现有批量送达动作；页面可显示房间号/roomTag（本人订单 L3），复制文案只到楼栋级（D48） | ✅ 已定（独立页） | 否：工作台内切页（联动小但工作台已 497 行）。代价：app.json/CONTRACT §7/ARCHITECTURE §2/UX/QA/工具注册表（31→32 页）+ `shared/zones.floorOf` 新纯件 |
| D47 | **预约新增「最晚可接受时间」（用户 2026-11-01 拍板，Q5=推荐 P-A）**：`APPOINT_TYPE` 增加 `LATEST`（`{type:'LATEST',latestAt}`，UTC+8 毫秒）；UI 改为「尽快 / 最晚时间」，日期+时间（预设+自定义），30 分钟粒度、≤7 天、最小提前 30 分钟；`ASAP` 保留；`SLOT` 保留仅历史订单展示、新单不可选；到点未送达**不自动取消**，只标红提示；详情/确认页补齐时间展示 | ✅ 已定（P-A） | 否：SLOT 语义改最晚（字段名不符）/ 全替换（历史单不可无损迁移）。代价：`shared/enums`/`_parcel.normalizeAppoint`/`_dto`/`_merge`/幂等指纹/下单与代客下单/详情/工作台筛选展示/6 套 selftest/文档；登记本 D 时同步 `check-docs` D 编号上限 |
| D48 | **订单汇总复制（用户 2026-11-01 拍板，Q6：受众=顾客群、口径=取件/送达进度）**：`order.listPartner` 工作台响应只增 `summary`（按苑/栋聚合 + 已取件/已送达/进行中计数 + 总件数），复用本次查询 rows、禁止二次扫描/新 action；客户端工作台/统计页加「复制汇总」按钮，纯件生成文案（只到苑/栋，不含房间号/尾号/取件码/昵称/编号）；复制后手动发群 | ✅ 已定（顾客群口径） | 代价：`listPartner`/`_dto`/`selftest-query-window` 预算/工作台 497 行/UX §9 文案；隐私红线=楼栋级封顶 |
| D49 | **存量兼职「送至楼下」一次性回填（用户 2026-11-01 拍板，Q4=可以）**：对存量 `partners.serviceConfig.services` 中缺 `PICKUP_LOW` 的兼职补 `enabled=true`（保留其既有启用/停用选择、不覆盖其他类型；写前导出备份、幂等可重跑）；执行只能由用户/运维在真实环境执行（agent 给脚本与步骤，不代跑）；新激活兼职默认全开不变；顾客端可见性随回填恢复 | ✅ 已定（一次性回填） | 否：页面提示兼职手动开（依赖兼职操作、顾客看不到）/ 后台逐人改（不可批量）。代价：一次性管理脚本 + RUNBOOK 步骤 + 回滚说明；无结构变更 |
| D50 | **不新增「已支付」状态（用户 2026-11-01 撤回 Q1）**：不做第八状态、也不做订单级标记；D6/D30 零交易口径不变；线下付款如需留痕用订单留言/备注；零金额词表/白名单与提审材料均不改；若未来重提，优先评估「订单级独立标记（B）」，第八状态（C）仍不推荐 | ✅ 已定（不做，2026-11-01 撤回） | 被否：第八状态（状态机/进度条/KPI/审核风险全联动）/ 独立标记（仍需修订 D6/D30）。代价：无 |
| D51 | **日结改 22:00 + 22:00–24:00 送达的下一轮批内自动完成（修订 D43）**：`config.autoCompleteAt` 默认 22:00；cutoff=该单 `deliveredAt` 所在自然日的该时刻，`now ≥ cutoff` 即 `COMPLETED`（`AUTO_COMPLETED` 逐单、幂等）；22:00–24:00 送达的单在下一轮 10 分钟批内完成（送达即完成，不再顺延次日）；顾客 `confirmDelivery` 不变 | ✅ 已定（用户 2026-11-01 补充，选 A：保留 DELIVERED ≤10 分钟） | 取 B（送达动作立即置 COMPLETED）需另做撤销/纠错链路，本批不做 |
| D52 | **工作台「全部」= 今日订单流水（修订 D45/D48 口径）**：`order.listPartner` 新增 `view=day`——UTC+8 今日（00:00~now）内 `statusUpdatedAt` 的七状态订单，按状态更新时间倒序平铺、不再按站点分组；待确认/已完成/已取消行服务端剥 `actions[]`（只读）；「已完结」只放昨日及更早；「今日完成」计数点击 → 切「全部」+toast | ✅ 已定（用户选方案 2） | view=day 每次 7 状态 find + 6 counts，轮询开销上升；首页/30s 轮询规模可接受，压测关注 |
| D53 | **复制汇总改为「今日已送达」口径（修订 D48）**：`listPartner(view=day)` 返回 `summary{scope:'deliveredToday',total,parcels,completed,pending,byDorm,truncated}`——`deliveredAt∈今日` 且状态 DELIVERED/COMPLETED、排除取消单；文案「今日已送达 N 单（M 件）…已完成 X / 待确认 Y」，只到苑/栋 | ✅ 已定（用户：按送达时间、取消单不进入、仍只到苑/栋） | 点击优先零请求复用，跨日/counts 变化才补拉 1 次 |
| D54 | **客户页首屏体验（灰色占位/分片流式/刷新不闪/排序空值置底/底部安全区）**：客户列表首屏 6 张灰占位卡 + 首片 ≤10 行、帧间按行追加；onShow 保留旧行、行级 diff、同 bindingId+avatarFileId 沿用旧头像 URL；空 dormKey 恒置底并标「资料未完善」（游标同全序）；底部 120rpx+safe-area 底垫；顾客订单页/首页首屏灰骨架 | ✅ 已定（用户 2026-11-01 反馈，方案按推荐） | 骨架/滚动/安全区真机点检；`_customer.js` 497/500 贴边，后续改动先拆件 |
| D55 | **兼职端「取件清单」双阶段（修订 D46）**：`pkg-partner/pages/pick-list` 升级——「待取件」（ACCEPTED，按站点 P1~P8 分组、码/尾号/柜号/宿舍锚、可复制）与「待送达」（PICKED，原楼层分组/批量送达）两 chip 切换；默认待取件；复用 `order.listPartner` 两条现成 payload、零服务端改动；复制只到站点/码/尾号/柜号/宿舍锚，不含称呼/订单号/手机尾号 | ✅ 已定（用户 2026-11-01：「兼职端也需要取件清单，可以」） | 页面 496/500 贴边，后续改动先拆 parts；工作台入口文案同步「取件清单」 |
| D56 | **开发者后台列表补用户称呼（脱敏）**：`admin.listOrders` 行增 `customerDisplayName/partnerDisplayName`（`maskedName`；代客单回退 guest 快照、无归属留空；按本页 customerId/partnerId 各 ≤1 次批量 in，不逐单 N+1）；后台订单总览/消息页展示「顾客：称呼（编号）」「兼职：称呼（编号）」 | ✅ 已定（用户 2026-11-01 补充） | admin 列表查询预算每页 +2 次；详情/其它已有称呼列表不变 |
| D57 | **顾客端「我的取件码（本机）」清单（2026-11-01 用户拍板定稿，批 21 实现）**：用户三条边界原文——「①当这个清单面向顾客自己时，**不强制绑定**；②**不开放**；③**本地**」。落地：`pkg-customer/pages/pickup-list/index` 顶部新增本机清单区（D26 原「进行中订单」区保留）——顾客可**手动粘贴多个取件码**或**端侧识别截图（纯本机、零上传零外呼）**添加；条目 = 码 + 站点（可空）+ 添加时间 + 「我已取到」本机标记；可复制/删除/一键清空；**上限 50 条、按码去重、最新在前**；**不建单、不绑定、不生成服务端数据**；只存本机 `ex_college_v4.pickcodes`（独立于 `ex_college_v4.store`，仅 `utils/storage.js` 单一写口）；**兼职端与开发者后台（含只读视角）不可见**；`READONLY` 会话仅渲染说明卡（不渲染本机数据/入口）且拒写；换设备/清缓存丢失（页面固定说明）；取件码属 L3，本机存储是**唯一例外**（见 §11.2 v1.8） | ✅ 已定（用户 2026-11-01 三条边界：不强制绑定 / 不开放 / 本地） | 代价：新增「L3 明文存本机」例外（换机/清缓存丢失、无法跨设备同步、兼职不可见即无法代取，均已在页面说明）；新增本地键与解析/视图纯件、OCR 平台适配器抽取；不新增云函数/集合/接口，**本批无需重部署云函数**；真机点检 QA §AD |

| D58 | **已接单订单转派给其他兼职（2026-11-02 用户裁决 Q1=A：目标确认接收、可转任意 ACTIVE 兼职）**：订单 `ACCEPTED`（未取件）时，当前兼职凭目标兼职**完整 `partnerNo`** 发起 `order.requestTransfer` → 目标兼职确认（`order.acceptTransfer`）或拒绝/过期（10 分钟）；确认时事务改订单归属 `partnerId/partnerOpenid/partnerNo`（不改订单号/顾客/绑定/roomTag）并写事件 `TRANSFER_REQUESTED/ACCEPTED/DECLINED/CANCELLED/EXPIRED`，同时通知顾客（消息中心 + 订单详情显示当前履约兼职，绑定关系不变）；原兼职可撤回；**转派后目标兼职只经本订单 DTO 取得履约必需信息，不展示顾客头像/昵称/客户档案**（D19/D42 不破，本单 L3 履约必需除外）；真实×测试禁止互转；统计按当前归属；不改变 D4「一顾客绑一兼职」与 D19「头像昵称仅绑定对方可见」 | ✅ 已定（用户 Q1=A：目标确认接收 + 任意 ACTIVE 兼职；仅 ACCEPTED） | 代价：新增 `orders.transfer` 字段/4 个动作/待接收列表与红点/DTO/动作矩阵/通知/限流/审计与 8 套判据联动；被否：直接改派（对方无确认、顾客无感）、退回待接单（推翻接单不可撤销）；真机项交用户。**批 26 冻结（2026-11-03，原批 26 接口草案 Q1~Q12 全部关闭）**：待接收列表复用 `order.listPartner({view:'transfer'})`（顶层只增 `transferPending` 角标、`counts` 六项形状不变）；过期=惰性判定（读到即落 `EXPIRED`，不新增 sweep）；`pickedCount>0` 禁发起转派；PENDING 期间订单离开 `ACCEPTED` 时邀请落 `EXPIRED`（`reason=STATE_CHANGED`）且确认报 `INVALID_STATE`；顾客侧只显示 `partnerNo` 与 `fulfillmentPartnerNo`；目标兼职 DTO 不给 `customerNo/displayName/avatarUrl`、可读 `roomTag/delivery/parcels/note`；目标只校验 `status='ACTIVE'`（不校验接单开关/服务范围）；子队员发起的转派限本队、主兼职可转任意 ACTIVE；不新增 audit 枚举（留痕在 `order_events`）；config 新增 `transferTtlMinutes=10`、`transferRate{perMinute:3,perDay:20}`（出厂默认、不入公开子集、后台白名单不变）；新增只读索引 `idx_transfer_target` 待用户控制台创建（RUNBOOK）；DTO 增只读键 `transfer` 与 `fulfillmentPartnerNo`；`order.get` 放宽为「当前履约人/顾客/`PENDING` 邀请目标」可读、转派完成后原履约人 `FORBIDDEN`；4 个私有 `TRANSFER_*` 不进顾客消息中心（`MESSAGE_HIDDEN_EVENT_TYPES`），仅 `TRANSFER_ACCEPTED` 可见并计未读；`anonymizeOrder` 清 `transfer` 编号快照、保留 `status/resolveReason`；`pickedCount>0` 禁发起（`INVALID_STATE`）；**counterpart 取人口径（W2 风险回写）**：顾客侧恒按当前 ACTIVE 绑定（`binding.partnerId`）取人、不随转派变，当前履约人只以只读 `fulfillmentPartnerNo` 呈现，未绑定履约人 `counterpart=null`（头像/昵称可见面不扩大） |
| D59 | **兼职子队员（2026-11-02 用户裁决 Q2=B：主兼职发子邀请码开子账号；顾客不绑定子队员）**：`invitation_codes` 增 `kind('DEV'|'SUB')`/`issuerPartnerId`，激活时写 `partners.parentPartnerId`（**层级仅一层**）；主兼职可生成子邀请码（一次性、有效期 24h/72h/7d、可作废、默认上限 5 人，`config.teamMaxMembers`），子队员为独立兼职账号（独立 `partnerNo`/昵称/头像/服务配置）；**顾客只能绑定主兼职，不能绑定子队员**（`partner.getPublic` 对子队员返回 `NOT_FOUND`、`bind.create` 拒绝）；子队员不可代客下单；订单推送 = D58 转派邀请且限本队；主兼职停用/注销时子队员级联停用、未确认转派取消；测试账号同隔离口径；**隐私文本新增「订单可能由你绑定兼职的协作队员协助履约」披露**（顾客资料对未绑定兼职的履约必需最小可见） | ✅ 已定（用户 Q2=B + 顾客不绑子队员） | 代价：修订 D3/§1.1/§10「邀请码只能开发者发」为「开发者发主码、主兼职可发子码」；新增 `partner.createSubInvites/revokeSubInvite/listSubMembers/removeSubMember`、团队页/入口、停用级联、审计与隐私文本；被否：轻量协作（与用户选择 B 不符）、队员可被顾客绑定（隐私面扩大）；真机+隐私文本项交用户。**批 26 冻结（2026-11-03，原批 26 接口草案 Q7~Q13 关闭）**：主兼职可见子队员 `partnerNo`+`displayName`（无头像/fileId）；团队页=新分包页 `pkg-partner/pages/team/index`（页数 32→33，客户端批 27 落）；`partner.removeSubMember`=解除隶属（`parentPartnerId=''`）+`status='SUSPENDED'`（`suspendedReason='TEAM_REMOVED'`）；不新增 audit 枚举（留痕在 `invitation_codes`/`partners`）；隐私披露列为 CONTRACT §11.2 v1.10 新增项；config 新增 `teamMaxMembers=5`、`subInviteRate{perMinute:3,perDay:20}`（出厂默认、不入公开子集、后台白名单不变）；新增索引 `idx_issuer`/`idx_parent` 待用户控制台创建（RUNBOOK）；`revokeSubInvite` 为**批次级作废**（入参 `{batchId}`、返回 `{batchId,revokedCount}`；该批无未用码 `INVALID_STATE`、他人批次 `NOT_FOUND`；团队页按 `batchId` 分组「作废本批」）；`listSubMembers.pendingInvites` 只回 `codeTail(后4位)/expiresAt/batchId`（完整码只在创建响应）；`partner.getPublic`/`bind.create` 对子队员 `NOT_FOUND`、`order.create` 两路 `FORBIDDEN`；`partner.activate` 读 SUB 码写 `parentPartnerId/teamJoinedAt`；admin `setPartnerStatus` 级联子队员并取消该队 PENDING 转派；admin 邀请码列表增 `kind/issuerPartnerNo`（SUB 只读）；**激活闸（W3 收尾）**：`partner.activate` 读 SUB 码时校验发码主兼职——`SUSPENDED`/非 `ACTIVE` → `PARTNER_CLOSED`（「邀请方已停用，请联系管理员」），`CLOSED`/不存在/`deletedAt`/上级非主兼职（`parentPartnerId!==''`）脏数据 → `NOT_FOUND`（同码同文案防枚举），`DEV`/无 `kind` 旧码零改动；**团队页不提供分享/转发**（含子邀请码/成员信息，不进 `tools/lib/share-pages.js` 好友转发清单，`selftest-share` 禁分享断言双向对帐）；**恢复悬挂上级（W3 收尾）**：admin 恢复子队员时若其上级主兼职不存在/非 `ACTIVE`/已注销 → 清 `parentPartnerId/teamJoinedAt`（恢复为独立主兼职），审计 `detail.detachedFromParent=true`；上级仍 `ACTIVE` 则保留隶属并置 `false` |
| D60 | **快递件信息来源可行性结论（2026-11-02 用户裁决 Q3=接受推荐）**：结论 = **受限可行→本项目不可行**——微信手机号组件仅非个人主体开放且只返回号码、无快递数据；菜鸟/丰巢/快递100/顺丰/京东/EMS 等无公开可自助的「按手机号查件」接口；微信物流消息/查询插件仅服务本小程序自有购物订单（本项目零交易不适用）；小程序无短信/通知读取 API。**维持现状**：截图 OCR + 规则解析 + 云函数 DeepSeek 去敏文本兜底 + 无截图手填（D24）+ 本机取件码清单（D57）；**本期不做** P1「粘贴短信文本端侧解析」与 P2「线下与驿站/校方数据合作」；**不改**「永不收集完整手机号」口径；第三方接口计费属运营成本、不进程序字段/文案。研究见 `docs/archive/research/2026-11-02_PARCEL_SOURCE_FEASIBILITY.md` | ✅ 已定（用户 Q3=接受推荐：维持现状） | 代价：无工程改动；被否：手机号组件（个人主体不可用）、第三方按手机号查件（无准入/合规风险）、短信读取（平台无能力）；后续若采购数据合作需另立项目与主体资质 |
| D61 | **件级取件（2026-11-02 用户裁决 Q4=B/Q5/Q6；修订 D23「订单级动作作用于全部包裹、不设包裹级状态」）**：一单多包裹允许**逐件独立取件**——`parcels[].pickedAt`（可选 `pickedByNo`）；`order.markPicked`/`order.unmarkPicked` 增可选 `itemIndex`（缺省=全部件，保持整单批量兼容）；新增事件 `PARCEL_PICKED`/`PARCEL_PICKED_REVERTED`（payload 带 `itemIndex`）；订单 `PICKED` 由「全部件已取」聚合派生（部分取件订单仍 `ACCEPTED`，DTO 增 `pickedCount/totalCount`）；送达/异常/取消/自动完成仍**整单**；未送达前可逐件「撤销已取」（不沿用 5 秒撤销条；撤销后订单回 `ACCEPTED`）；顾客详情逐件展示已取/待取；旧单兼容（`PICKED/DELIVERED/COMPLETED`→全部件已取、`ACCEPTED`→未取，无数据迁移）；**同一订单多个取件码在兼职端缩进逐件展示、每码独立显示并各有独立「已取件/撤销已取」入口**（Q6 文案「已取件」「撤销已取」、逐件操作免二次确认） | ✅ 已定（用户 Q4/Q5/Q6=采用推荐） | 代价：状态机/事件枚举/DTO/动作守卫/工作台/取件清单/详情/顾客进度/判据约 20 文件联动；被否：仅本机勾选（换设备丢失、进度不真实）、仅视觉逐件（不满足「独立取件」）；真机项交用户 |
| D62 | **兼职端多站点按件分组（2026-11-02 用户裁决 Q4=采用推荐，修订 UX §4.3「跨站点单只归一组」）**：工作台与兼职取件清单按**件的站点**分组——一单在其每件所属站点组各出现一次（行内只列本站件，并标「另 N 件在 Pn」）；组内四档动线排序按**本站件**计算；组头计数同时给单数/件数；批量动作仍按**订单**（选中多站单时提示将作用于整单）；同批回写 UX_PARTNER §4.3/§4.16 与 QA F24/AC4 | ✅ 已定（用户 Q4=采用推荐） | 代价：工作台/清单分组与排序纯件重写、选择/批量语义说明、UX/QA/判据联动；被否：首站定组只修组内排序（多站单仍只在首站出现）、一包一行平铺（订单级动作/计数全重做） |
| D63 | **顾客邀请顾客（2026-11-02 用户裁决 Q7=不记录，被邀请者绑定邀请者当前绑定的兼职）**：顾客在自己有 ACTIVE 绑定时可生成**该兼职的绑定卡**（复用现有 bind 卡 path=`/pages/launch/index?bind=`，仍**只带 partnerNo**，不带邀请者编号/昵称/头像/宿舍/尾号）；被邀请顾客落地后按 D37 隐私闸 → 邀请卡 → 隐私同意+资料完整后按 **D38 自动绑定邀请者当前绑定的那位兼职**；已绑同号提示「已绑定·去下单」、已绑异号走 D28 换绑确认（不静默换绑）、兼职停用/注销显示对应文案；**不记录邀请关系**（不新增集合/字段/接口/统计，不把 `customerNo` 放进卡片/URL）；D36 卡片类型不变（仅增加顾客也可生成绑定卡） | ✅ 已定（用户 Q7=不记录；「被邀请顾客绑定邀请者绑定的兼职」） | 代价：`utils/share` 放行条件、我的页入口、role 页文案、selftest-share/check-share 卡片白名单联动；被否：记录邀请关系（需 token/新集合+隐私披露，用户选不记录）、卡片带邀请者编号（违反 §3.1 可见性）；真机分享落地交用户。**批 27 冻结（2026-11-03，原批 27 接口草案 Q14/Q15 关闭）**：新增中性卡片标题常量 `TITLES.BIND_CUSTOMER`（卡片类型/字段/path 不变）；分享入口只在「我的」（`pages/profile`）主入口，不进首页/订单详情；落地链路 `launch?bind=`→隐私闸→`role`→隐私同意+资料完整→自动 `bind.create`（D38）；`launch` query 白名单不变（只 `bind`/`orderNo`）；`utils/share` 的 `buildAppMessage` 入参 +`boundPartnerNo`、`viewSession=true` 一律通用卡、零 `wx.`（纯件） |
| D64 | **顾客取件码升为一级入口（2026-11-02 用户裁决 Q10=C：伪 tab；改名「取件码」；删 D26 订单区；首页入口卡删除；本页禁分享）**：`pkg-customer/pages/pickup-list` 迁主包为 `pages/customer/pickcodes/index`（tab 名「取件码」、页标题「我的取件码」），与首页/订单/我 同级；**平台 tabBar.list 上限 5 项且已满 → 采用伪 tab**：底部栏视觉抽为共用组件，页面内自绘 4 格（顾客）并按 `wx.switchTab`/`wx.reLaunch` 跳转，`app.json` tabBar 仍 5 项；该页**只显示顾客自建本机取件码**（写入：手动粘贴/端侧识别截图/「我已取到」标记；删除：单条/一键清空；另可复制），**不再显示上传的订单**（删除 D26 订单区，订单详情仍逐件显示站点+取件码）；首页原「取件清单」入口卡删除；本页不提供分享/转发；D57 本机边界（只存本机/不上传/不开放/READONLY 只读说明卡且拒写）与 Q10 命名不变 | ✅ 已定（用户 Q10=采用推荐） | 代价：页面迁移主包、共用底部栏组件、app.json/页数注册表/门禁/分享页清单/5 套判据/约 20 处文档联动；被否：兼职「客户」退 tab 换真 tab（改动兼职 IA）、订单并入新页（违背同级）、维持 3 tab+首页入口（不满足同级）；真机 tab 切换手感交用户 |
| D65 | **全局底部安全区与滚动修复（2026-11-02 用户裁决 Q9=采用推荐）**：系统性修复「下拉到底部显示不全」——`app.wxss` 增 tabbar/safe 设计 token 与 `.page-body--tab`（tab 页补足 `100rpx+env(safe-area-inset-bottom)`）；底部固定条/弹层统一带 `env(safe-area-inset-bottom)`（抽底部条组件替代静态垫高，多选/撤销/操作条复用）；`onPullDownRefresh` 与页面 json `enablePullDownRefresh` 对齐；`pages/launch` 小屏可滚动；新增 **3 条机械门禁**（tab 页根 class 含 `page-body--tab`；`position:fixed`+`bottom:0` 必带 safe-area env；有下拉 handler 的页面 json 必须开开关）；32 页逐页审计，真机三机型（iPhone home indicator/iPhone SE/Android 三键导航）+ 系统大字号点检（人） | ✅ 已定（用户 Q9=采用推荐） | 代价：`app.wxss`（S0 单写者）+32 页根 class+约 10 处底部条/弹层样式+门禁/基线/判据/QA 联动；被否：逐页热修（会复发、漏页）；真机项交用户 |
| D66 | **首页下单文案（2026-11-02 用户裁决 Q11=采用推荐）**：顾客首页主 CTA「上传取件码截图下单」改为「**下单**」；同批统一 4 处近似文案（首页空态、首用引导第 2 步、角色页副标题、帮助页首段）为「下单」表述（去掉「上传截图」前置，功能/跳转/截图链路与识别流程不变）；订单创建页标题不改 | ✅ 已定（用户 Q11=采用推荐） | 代价：`selftest-order-customer` J14 与 UX_CUSTOMER §3.1/§3.3、QA A23、提审截图图注联动；无服务端改动；真机文案交用户点检 |

| D67 | **兼职端客户页筛选器（2026-11-02 用户裁决 Q8=采用推荐）**：一期筛选维度 = 全部 / 资料未完善（`dormKey===''`）/ 按苑（D/X/N/B/C）/ 按楼栋（1~10，苑可空=跨苑同栋号）/ 有备注（`partnerNote` 非空），关键词搜索保留；服务端 `partner.listBindings` **只增** `zone/buildingNo/profileIncomplete/hasNote` 入参（在关键词/游标过滤链内、无需新索引），行 DTO 与排序（`dormKey` 自然序 → roomTag）不变；**「有进行中订单」维度一期不做**（D54 已把 `activeOrderCount` 收窄到本页，列入二期再议；chips 不带计数、不新增聚合查询）；筛选空态与真空态文案分离；筛选变化重置游标、返回页面保持筛选态；`_customer.js` 397 行（已拆 `_customer-list.js`）；真机项交用户 | ✅ 已定（用户 Q8=采用推荐；一期五维，不含「有进行中单」） | 代价：`handlers/partner/{listBindings,_customer,_customer-list}.js` 拆件+入参、`pages/partner/customers/**`（`parts/filter-model.js` 纯件）chips/筛选态、`selftest-partner-customers/-pages/-query-window`、DATA_MODEL §7.4、UX_PARTNER §3.5、QA AE6；被否：全量服务端「有进行中单」筛（破查询预算）、新增 sort/索引（二期） |

**未决项一律在 `docs/contract/V4_DECISIONS.md` 展开（背景/选项/推荐理由/被否方案/代价）。**

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
| O18 | **文档一致**：D 编号 D1~D50、后台 11 页、14 集合、13 错误码不变；新增内容零金额 | 全部文档 | 保持既有索引与验收基线稳定 |
