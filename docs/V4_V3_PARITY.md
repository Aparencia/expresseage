# V4_V3_PARITY · v3 → v4 功能对照验收表

> 口径源：`docs/V4_CONTRACT.md`（唯一口径源）、`docs/V4_ENGINEERING.md`（工程/门禁）、`docs/V4_DATA_MODEL.md` §11（v3 字段映射）、`docs/V4_UX_PARTNER.md` §5（已有局部 v3→v4 对照）。
> v3 仓库（**只读**）：`D:\Code\expresseage_college_v3`（注意目录名拼写）；v4 仓库：`D:\Code\expressage_college_v4`。
> 用途：给用户一张**可勾选**的验收表——证明 v3 的可运行能力在 v4 全部有去向（等价/改进/新增/取舍不迁），并给出对应判据与测试证据。
> **文档级对照 ≠ 真机验收**：真机项只能由用户点检（`docs/QA_CHECKLIST.md`），agent 不代勾、不代宣布通过；本文不是「全门禁已过」声明。
> 写作纪律：只写对照/验收/证据，不写实现代码；引用 v3 用「文件 + 函数名」，不写行号；未决项用 `[D#]`（D1~D22）、`[E#]`（E1~E18）、`[R#]`、`P1`/`P2`/「待用户裁决」；数字不写死，取数命令见 §6。

## 0. 结论速览

- **形态对照**：v3 是单机本地台账（主包 4 页 + 独立分包聊天工具入口页 1 个、`utils/` 纯函数层、本机存储、**零云函数**）；v4 是云开发双业务角色平台（30 页 = 主包 7 + 分包 23、`api`/`cleanup` 云函数、14 集合、13 错误码、开发者后台）。
- **能力去向**：v3 可运行能力**全部有去向**（§2/§3），无「沉默丢失」。v3 的 6 类形态/能力为**取舍不迁**，均有 D# 依据：本机存储与旧库（D1/D2/D11）、聊天工具入口页（§2.1）、件级硬删（v4 订单不可删）、「未归类→归户」（guest 代客单承接，MVP 无认领）、已取件 3 天硬窗口（改历史分页）、档案回收站（改注销与软删记录）。
- **v4 新增**（v3 无对应）：云开发与双角色、邀请码准入（D3）、双角色唯一编号（D15）、roomTag 绑定（D7/D21）、七状态机与事件流水、顾客端闭环、服务端搜索、单量统计、头像/昵称（D19）、开发者后台与切换会话（D14/D18）、测试账号、消息中心、注销、cleanup 定时清理。
- **证据形态**：机器判据 = `tools/check.js` #1~#31、`tools/check-docs.js` #1~#10、`tools/selftest.js` 注册套件、`tools/mutation.ps1` 变异电池；用户侧 = `docs/QA_CHECKLIST.md` 人点检项（本表只索引，不替代）。
- **当前还不能宣布验收通过**：**批 9 工程侧已收口（2026-10-22，离线部分：注销链路判据 + 审核材料手册 + 本文对照表 + 灰度回滚演练 + QA H12~H17）**，且 **D1~D22 已于 2026-10-22 全部裁决**；但真机项未点检、云环境未创建/部署、隐私与提审未开始（详见 §5）。本表是批 9 的验收**输入**与用户勾选底稿，不代勾、不代宣布通过。

## 1. 方法与范围

### 1.1 对照依据（各取所需，不重复长文）

| 依据 | 本文用途 |
| :-- | :-- |
| `docs/V4_CONTRACT.md` §7 页面地图（30 页 = `app.json` 声明）、§5 订单状态机、§10 权限矩阵、§13 D1~D22 | 页面路径唯一来源、状态与权限口径、取舍理由编号 |
| `docs/V4_DATA_MODEL.md` §11 v3→v4 字段映射（不迁移，D11）、§7 API 契约 | v3 数据体到 v4 集合/字段的映射、action/集合名 |
| `docs/V4_ENGINEERING.md` §1.2 v3 资产三清单（文件级继承/改造/丢弃）、§7 测试策略、§8 门禁、§11 批 6~9 | 资产去向、证据套件与门禁号、批次归属 |
| `docs/V4_UX_PARTNER.md` §5（v3→v4 功能对照 + v3 六条教训）、`docs/V4_UX_CUSTOMER.md`、`docs/V4_UX_DEVELOPER.md` | 页面级交互差异、真机验收分区、P1 清单 |
| `STATE.md` §2 批次台账、§3b~§3h 批 2~8 交付快照、§6b~§6h 收口证据（真实输出） | 每项能力的实现批次与机器证据 |
| v3 仓库：`app.json`、`pages/**`、`chatpick/**`、`utils/**`、`docs/lessons/`、`docs/ARCHITECTURE.md`、`V3_MIGRATION_PLAN.md` | 左侧盘点对象（只读） |

### 1.2 v3 盘点对象（真实目录，命令见 §6）

- **主包页面（4 个）**：`pages/pickup-list/index`（取件清单）、`pages/archive-list/index`（用户档案）、`pages/customer-detail/index`（客户详情）、`pages/recognize/index`（录入页）。
- **独立分包页面（1 个）**：`chatpick/index`（聊天工具入口页；`app.json` 的 `subPackages[].root=chatpick` + `chatTools`，带 `renderer: skyline`）。
- **页面零件**：`pages/**/*.js`（各页纯件，如 `list-actions.js`、`list-parts.js`、`sheet-flow.js`、`swipe.js`、`recycle.js`、`parse-patch.js`、`form-parts.js`、`share-flow.js`）；**没有 `components/` 目录**。
- **能力层**：`utils/`——解析 `utils/parse.js`（`parseParcelText`）、`utils/parse-*.js`，OCR `utils/ocr.js`（`recognizeImage`）、`utils/ocr-vision.js`，站点/楼区 `utils/stations.js`、`utils/buildings.js`，会话键 `utils/chat-tool.js`，存储 `utils/storage*.js`（`loadStore`/`saveStore` 等），迁移 `utils/migrate.js`，隐私 `utils/privacy.js`（`ensureMediaAccess`/`ensureCameraAccess`）。
- **无 `cloudfunctions/`**：v3 全部业务判据在本机，页面经 `utils/storage.js` 门面读写本机存储。
- **门禁/自测**：`tools/check.js`、`tools/selftest*.js`（波次件）；文档 `docs/lessons/`、`docs/registry/`、`docs/decisions/`、`docs/ARCHITECTURE.md`。
- 盘点读数一律以 §6 命令的真实输出为准（本文不写死文件数/断言数）。

### 1.3 状态图例（本文五态）

| 状态 | 含义 | 验收口径 |
| :-- | :-- | :-- |
| 等价 | v3 的判据/行为在 v4 同义保留 | v4 有对应判据且不弱化；真机项在 QA 对应分区 |
| 改进 | v4 覆盖 v3 能力并补齐/重构（可能换承载形态） | 有套件/门禁证据 + 差异说明；不得有 v3 能力静默丢失 |
| 新增 | v3 无对应能力，v4 按 D# 新增 | 设计文档 + 判据 + QA 人点检项 |
| 取舍不迁 | 明确不做，有 D#/P1/P2 依据与理由 | 逐条列理由与后续归属（另立项/P1/P2） |
| P1 / P2 | 延后到 MVP 之后（编号在册） | 不阻塞本轮验收；在 §5 汇总 |

### 1.4 边界与纪律

- **数据不迁移**（D11）：v3 空库起；v4 不读 v3 本机键，**禁止读写 `ex_college_v3.store`**（D2 新 appid）。
- **v3 只读**：本文盘点只读 v3 仓库，未修改任何 v3 文件。
- **零金额**（D5/D6）：v3 无费用类能力；历史费用口径「已废弃（v0.7）」，不迁移；本文不展开任何交易语义。
- **真机项只能用户点检**（AGENTS §5.5、`docs/QA_CHECKLIST.md`）；本表以「待用户点检」标注，agent 不代勾。
- **引用纪律**：v3 一律「文件 + 函数名」；证据简写——`selftest-*` = `tools/selftest-*.js` 套件，`check #N` = `tools/check.js` 第 N 条，`QA §X` = `docs/QA_CHECKLIST.md` 的人点检分区。

## 2. 页面级对照

### 2.1 v3 页面逐个 → v4 落点

| v3 页面（真实路径） | v3 关键零件（文件+函数） | v4 落点 | 状态 | 证据（机器/人） | 差异说明 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pages/pickup-list/index` | `pages/pickup-list/list-actions.js`（`batchPlan`/`stationTakePlan`/`filterOptions`）、`list-parts.js`（`splitUnassigned`/`pickedDayView`）、`utils/aggregate.js`（`buildPickupList`/`pendingIdsOfStation`） | `pages/partner/workbench/index`（主包 tab）+ `pkg-partner/pages/order-detail/index`（行内改码/异常/送达） | 改进 | `selftest-order-workbench`、`selftest-order-partner`；check #21；QA §F | 站点聚合 → 服务端状态桶 + 站点过滤；勾选已取件 → 七状态动作 + 批量同一 `batchActionId` + 5 秒撤销；已取件 3 自然日硬窗口 → 历史分页；件级硬删 → 订单不可删（取消/软删记录）；「未归类→归户」→ guest 代客单（MVP 无认领） |
| `pages/archive-list/index` | `pages/archive-list/sheet-flow.js`（`planSave`/`resolveChatKeyForSave`/`gateSheetForm`）、`swipe.js`（`decideSwipe`）、`recycle.js`（`recyclePatch`）、`utils/storage.js`（`createCustomer`/`softDeleteCustomer`/`restoreCustomer`/`purgeCustomer`） | `pages/partner/customers/index`（主包 tab） | 改进 | `selftest-partner-customers`、`selftest-partner-pages`、`selftest-bind`；check #28；QA §C/§F16/§F22 | 建档从「兼职手填 + 聊天会话键」→「顾客自己建资料 + 顾客发起绑定（D20）」；左划删除 → 解绑（原因必填 + 通知顾客）；档案回收站 → 不迁（注销/软删记录）；会话键 → 完整 `partnerNo` |
| `pages/customer-detail/index` | `pages/customer-detail/parts.js`（`groupByStation`/`openEditPatch`）、`utils/parcel-edit.js`（`validateEdit`/`planEditSave`）、`utils/parcel-remove.js`（`removeTapPlan`/`removePatch`） | `pkg-partner/pages/customer-detail/index`（档案/备注/历史单）+ `pkg-partner/pages/order-detail/index`（行内改码/异常/凭证） | 改进 | `selftest-partner-pages`、`selftest-partner-customers`；QA §F16 | 档案字段可改 → 资料由顾客维护、兼职只写 `partnerNote`（≤100）；会话键摘要展示 → 丢弃；名下快件行内改码 → `order.correct`（改站点/码/柜/尾号）；新增顾客编号、头像/昵称（仅绑定后可见） |
| `pages/recognize/index` | `pages/recognize/index.js` 编排 + `parse-patch.js`（`planParsePatch`）、`form-parts.js`（`planSingleSave`）、`utils/parse.js`（`parseParcelText`）、`utils/ocr.js`（`recognizeImage`）、`utils/stations.js`（`inferStation`）、`utils/buildings.js`（`parseRoomLine`） | `pkg-customer/pages/order-create/index`（顾客下单）+ `pkg-partner/pages/create-on-behalf/index`（代客下单，v3 录入页移植） | 改进 | `selftest-recognize`、`selftest-order-flow`、`selftest-ai`、`selftest-order`；check #24~#26；QA §D/§R | 端内录入 → 顾客四步下单（截图→识别→确认→提交）；单机入库 → 云存储截图 + 7 天删除（D9）；一图多码全存 → `order.createBatch`（≤5 单原子建）；新增 AI 兜底（D16）与失败复核（D17）；草稿与三段布局不迁（改为分步页） |
| `chatpick/index`（独立分包） | `chatpick/bridge.js`；平台接口经 `utils/chat-tool.js`（`openChatTool`/`getChatToolInfo`/`fingerprint`/`maskRoomIds`）唯一调用 | **无**（v4 不做聊天工具） | 取舍不迁 | `docs/V4_ENGINEERING.md` §1.2（`chatpick/**` 丢弃）；`docs/V4_CONTRACT.md` §7 主路径 | 理由：`chatTools` 只接受独立分包且引不到主包（v3 真机读数），v4 改「完整 `partnerNo` + 顾客发起绑定（D20）」；聊天入件不在 v4 主流程；会话标识最小化要求保留（隐私文本已声明） |

### 2.2 v4 30 页反向覆盖（每页都有 v3 来源或显式新增）

| 分组 | v4 页面 | v3 来源 | 状态 | 证据（机器/人） |
| :-- | :-- | :-- | :-- | :-- |
| 主包 | `pages/launch/index` | 无（启动分流，v4 新增） | 新增 | `selftest-switch`、`selftest-profile`；QA §A |
| 主包 | `pages/role/index` | 无（身份选择/邀请码/绑定卡片落地） | 新增 | `selftest-cloud`、`selftest-bind`；QA §A/§C |
| 主包 | `pages/customer/home/index` | 无（顾客端全新） | 新增 | `selftest-order-customer`；QA §E |
| 主包 | `pages/customer/orders/index` | 无（顾客订单列表） | 新增 | `selftest-order-customer`；QA §E |
| 主包 | `pages/partner/workbench/index` | `pages/pickup-list/index` | 改进 | `selftest-order-workbench`；QA §F |
| 主包 | `pages/partner/customers/index` | `pages/archive-list/index` | 改进 | `selftest-partner-customers`；QA §C/§F16 |
| 主包 | `pages/profile/index` | 无（双角色共用「我的」） | 新增 | `selftest-profile`、`selftest-bind`；QA §B/§P |
| pkg-customer | `pkg-customer/pages/bind/index` | `chatpick` 会话键（关系建立，方向相反） | 改进 | `selftest-bind`、`selftest-bind-cloud`；QA §C |
| pkg-customer | `pkg-customer/pages/order-create/index` | `pages/recognize/index` | 改进 | `selftest-order-flow`、`selftest-recognize`；QA §D/§R |
| pkg-customer | `pkg-customer/pages/order-detail/index` | 无（顾客闭环，v4 新增） | 新增 | `selftest-order-lifecycle`、`selftest-order-customer`；QA §E |
| pkg-customer | `pkg-customer/pages/messages/index` | 无 | 新增 | `selftest-messages`、`selftest-message-pages`；QA §E |
| pkg-customer | `pkg-customer/pages/help/index` | 无（隐私全文/零金额声明） | 新增 | `selftest-privacy-text`；QA §P/§M |
| pkg-partner | `pkg-partner/pages/activate/index` | 无（邀请码激活，D3） | 新增 | `selftest-cloud`；QA §A/§B |
| pkg-partner | `pkg-partner/pages/order-detail/index` | `utils/parcel-edit.js`（行内编辑器） | 改进 | `selftest-order-detail-partner`；QA §F |
| pkg-partner | `pkg-partner/pages/create-on-behalf/index` | `pages/recognize/index` | 改进 | `selftest-partner-orders`；QA §F18 |
| pkg-partner | `pkg-partner/pages/customer-detail/index` | `pages/customer-detail/index` | 改进 | `selftest-partner-pages`；QA §F16/§F22 |
| pkg-partner | `pkg-partner/pages/service-settings/index` | 无（服务类型/范围/接单开关） | 新增 | `selftest-bind-cloud`；QA §C |
| pkg-partner | `pkg-partner/pages/stats/index` | 无（单量统计，零金额口径） | 新增 | `selftest-partner-stats`；QA §F20 |
| pkg-partner | `pkg-partner/pages/messages/index` | 无 | 新增 | `selftest-message-pages`；QA §E |
| pkg-admin | `pkg-admin/pages/overview/index` | 无（后台总览/审计区块） | 新增 | `selftest-admin`、`selftest-admin-pages`；QA §G |
| pkg-admin | `pkg-admin/pages/invite-codes/index` | 无（D3 邀请码） | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/customers/index` | 无（脱敏查询） | 新增 | `selftest-admin`、`selftest-admin-pages`；QA §G |
| pkg-admin | `pkg-admin/pages/customer-detail/index` | 无 | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/partners/index` | 无（停启用） | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/orders/index` | 无（异常工单） | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/order-detail/index` | 无 | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/config/index` | 无（全局配置） | 新增 | `selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/account-switch/index` | 无（D14/D18 切换会话+测试账号管理） | 新增 | `selftest-switch`、`selftest-testaccount`；QA §V/§T |
| pkg-admin | `pkg-admin/pages/messages/index` | 无 | 新增 | `selftest-message-pages`、`selftest-admin`；QA §G |
| pkg-admin | `pkg-admin/pages/recognition-review/index` | 无（D17 识别失败复核） | 新增 | `selftest-ai`、`selftest-cloud`；QA §R |

> 合计 30 页：主包 7 + `pkg-customer` 5 + `pkg-partner` 7 + `pkg-admin` 11（与 `app.json`/CONTRACT §7 一致，取数命令见 §6）；其中 7 页承接 v3 能力（改进）、23 页为 v4 新增能力（含聊天工具入件的替代路径），**无「v4 有页面而来源不明」项**。

## 3. 业务能力 / 流程对照

| 能力/流程 | v3 现状（文件+函数） | v4 落点（页面 / action / 集合） | 状态 | 判据与证据 | 说明 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 下单与识别 | `pages/recognize/index.js`；`utils/parse.js:parseParcelText`；`utils/ocr.js:recognizeImage`；`utils/stations.js:inferStation`；`utils/buildings.js:parseRoomLine`；`utils/parcel-drafts.js:buildDrafts` | `pkg-customer/pages/order-create`；`order.create`/`order.createBatch`、`ai.parseParcel`、`upload.prepare`；集合 `orders`/`upload_tickets`/`recognition_failures` | 改进 | `selftest-recognize`、`selftest-order`、`selftest-order-flow`、`selftest-ai`；check #24~#27；QA §D/§R | 识别规则与语料移植（ENGINEERING §1.2）；新增 AI 兜底只发去敏文本、失败静默降级并入复核队列；多图/多码逐张下单 |
| 订单状态机与操作 | `utils/storage-parcels.js`（`setParcelPicked`/`setParcelsPicked`）；`Parcel.status` 仅 `todo`/`done` + `pickedAt`；`utils/aggregate.js:dayOffsetOf` | `shared/order-state.js` 七态；`order.accept`/`reject`/`markPicked`/`unmarkPicked`/`markDelivered`/`unmarkDelivered`/`reportException`/`resolveException`/`cancel`/`confirmDelivery`/`correct`/`undo`/`deleteRecord`；集合 `orders`/`order_events` | 改进 | `selftest-state`、`selftest-order-lifecycle`、`selftest-order-partner`；QA §E/§F | v3「已取件只是时间戳」→ 独立 `PICKED` + 事件流水 + 撤销动作；送达闭环/自动完成/异常恢复补齐 |
| 绑定与 roomTag | `utils/chat-tool.js`（`pairKeyOf`/`fingerprint`/`maskRoomIds`）；`utils/storage-customers.js`（`findCustomerByChatKey`/`rebindCustomerChatKey`） | `pkg-customer/pages/bind`、`pages/role`；`bind.create`/`release`/`getCurrent`、`partner.getPublic`；集合 `bindings`；roomTag 由 `lib/tag-allocator` 分配（大写 A…Z/AA…） | 改进 | `selftest-bind`、`selftest-bind-cloud`；check #28/#29；QA §C | 会话键 → 完整 `partnerNo` + **顾客发起**（D20）；roomTag 绑定成功时事务分配、旧号不复用（D7/D21）；解绑后双方互不可见头像/昵称 |
| 工作台（取件清单） | `pages/pickup-list/list-actions.js`（`batchPlan`/`stationTakePlan`）；`utils/aggregate.js`（`buildPickupList`/`pendingIdsOfStation`）；`utils/storage-parcels.js:setParcelsPicked`（原子） | `pages/partner/workbench`；`order.listPartner({view:'workbench'})`；批量 = 客户端循环 + 同一 `batchActionId`；动作同上一行 | 改进 | `selftest-order-workbench`、`selftest-order-partner`；check #21；QA §F | 四档动线排序落 `shared/order-view`（TD-017）；分页/分片/行级 patch/30s 增量；服务端状态桶 + 搜索 + 部分失败逐单说 |
| 客户档案与详情 | `utils/storage.js`（`createCustomer`/`updateCustomer`/`softDeleteCustomer`/`restoreCustomer`）；`utils/aggregate-customers.js`（`sortCustomers`/`filterCustomers`）；`pages/archive-list/sheet-flow.js`（`planSave`） | `pages/partner/customers`、`pkg-partner/pages/customer-detail`；`partner.listBindings`/`getCustomer`/`saveCustomerNote`/`unbindCustomer`；集合 `customers`/`bindings` | 改进 | `selftest-partner-customers`、`selftest-partner-pages`；QA §C/§F16 | 档案由顾客自己维护；兼职只写 `partnerNote`（≤100）；解绑原因必填 + 通知；展示顾客编号/头像/昵称（仅绑定后） |
| 代客下单 | v3 录入页即兼职录件（无顾客 App） | `pkg-partner/pages/create-on-behalf`；`order.create` 兼职路径：绑定顾客（`bindingId`）与 guest 显式互斥，**均不写 `bindings`**（D12） | 改进 | `selftest-partner-orders`、`selftest-partner-pages`；QA §F18 | guest 单无顾客访问路径；防误操作（两条路径互斥、逐条结果块） |
| 统计（单量） | 无统计页（v3 仅本机台账） | `pkg-partner/pages/stats`、`pkg-admin/pages/overview`；`partner.stats`、`admin.stats`；集合 `orders`/`order_events` | 新增 | `selftest-partner-stats`、`selftest-admin`；QA §F20 | 只统计单量/状态分布/完成率（零金额，D6）；服务端聚合、排除测试数据（D18） |
| 服务配置与接单开关 | 无（v3 无服务类型概念） | `pkg-partner/pages/service-settings`；`partner.saveServiceConfig`；`config.getPublic`；`serviceConfig.acceptingOrders=false` ⇒ `PARTNER_CLOSED` | 新增 | `selftest-bind-cloud`、`selftest-partner-pages`；QA §C | 服务只表达「做什么」（D5/D6），启用/停用无定价语义 |
| 角色/入口/邀请码 | 无（单身份单机） | `pages/launch`/`pages/role`/`pages/profile`、`pkg-partner/pages/activate`；`user.bootstrap`、`partner.activate`；集合 `invitation_codes` | 新增 | `selftest-cloud`、`selftest-switch`；QA §A | 一次性/可过期/可作废/可审计（D3）；开发者由 `ADMIN_OPENIDS` 白名单分流 |
| 双角色唯一编号 | 无编号概念（`id` 不上屏，负向判据在 v3 自测） | `utils/ids.js` + 云端 `lib/id-generator`；`customerNo`/`partnerNo`/`developerNo` | 新增 | `selftest-core`、check #8/#19；QA §B | C+8 / P+6 / DEV-01（D15）；服务端随机生成 + 唯一索引 + 碰撞重试；客户端只校验/展示、不作鉴权 |
| 头像/昵称 | 无采集 | `pkg-customer/pages/order-create` 资料段、`pages/profile`、`pkg-partner/pages/customer-detail`；`upload.prepare({purpose:'AVATAR'})`、`customer.saveProfile`/`partner.saveProfile` | 新增 | `selftest-profile`、check #29；QA §P/§T | `chooseAvatar` + `nickname` 输入；头像可拒绝→默认头像；仅绑定对方可见；后台/卡片/通知不展示；注销删文件（D19） |
| 后台与切换会话/测试账号 | 无后台（v3 仅本地工具链） | `pkg-admin` 11 页；`admin.*` 23 动作；`switch-session` 中间件；集合 `admin_view_sessions`/`admin_audit` | 新增 | `selftest-admin`、`selftest-admin-pages`、`selftest-switch`、`selftest-testaccount`；check #30/#31；QA §G/§V/§T | READONLY（真实账号只读）/ TEST_WRITE（测试账号可写）；测试数据隔离/标记/排除统计/30 天清理（D14/D18） |
| 消息与通知 | 无（v3 无站内消息、无订阅） | `pkg-customer/pages/messages`、`pkg-partner/pages/messages`、`pkg-admin/pages/messages`；`message.list`/`send`/`markRead`；集合 `order_messages`；10s/30s 轮询 + 红点 | 新增 | `selftest-messages`、`selftest-message-pages`；QA §E | 订阅消息 P1（D10）；通知/日志不带 L3 敏感值；终态订单留言只读归档 |
| 隐私与同意 | `utils/privacy.js`（`ensureMediaAccess`/`ensureCameraAccess`）；`docs/privacy/隐私保护指引.md` | `api/privacy.js`（三类隐私接口/拒绝降级）、launch 同意弹窗、`pkg-customer/pages/help` 隐私全文；`user.acceptPrivacy`；`config.getPublic.privacyVersion` | 改进 | `selftest-privacy-text`、`selftest-profile`；check #24 窄豁免；QA §P | 相册/摄像头/头像/昵称逐项声明；隐私文本定稿候选 v1.0；版本升级可重同意 |
| 注销与数据删除 | 无（本机档案可恢复/彻底删除；件级硬删 `utils/parcel-remove.js`） | `user.deleteAccount` + `cleanup.accountDeletion`（两阶段匿名化）；兼职 `admin.setPartnerStatus(CLOSED)`（匿名化+删头像文件+邀请码 `usedBy` 置空）；头像文件删除；订单 `order.deleteRecord`（只软删记录，不删单） | 新增 | `selftest-deletion`（批 9 端到端 89 断言，含 14 条缺陷首红修复）、`selftest-cleanup`、`selftest-cloud`；QA §P/§E15 | v3 数据不迁（D11）；注销后双方互不可见；订单/事件按留存策略清理；两阶段时点见 DATA_MODEL §10.4 |
| cleanup 定时清理 | 无（无服务端，无定时任务） | 独立云函数 `cleanup` + 单定时触发器；13 个幂等 sweep（邀请码过期、票据、截图 7 天、自动完成、注销、测试数据等） | 新增 | `selftest-cleanup`；运行项在云控制台（用户执行） | 可注入执行器 + 部分失败隔离 + 每轮 `CLEANUP` 汇总审计（E8 口径） |
| 分享 | `pages/recognize/share-flow.js:shareCard`（中性封面、零业务值） | 绑定卡片 `pages/profile/parts/share-card.js`（只带 `partnerNo`、无头像昵称）；切换会话隐藏分享 | 改进 | `selftest-bind`（静态扫描）、`selftest-switch`；QA §V | 分享面收窄到「邀请顾客自己绑定」；只读/测试会话禁分享（O3） |
| 数据载体与迁移 | `utils/storage-core.js`（`STORE_KEY`）+ `utils/migrate.js`（`SCHEMA_VERSION`）本机存储 | 云 DB 14 集合，唯一出口 `db/dao.js`；本机只留会话提示键 | 取舍不迁 | check #12/#14/#15；`docs/V4_DATA_MODEL.md` §11 | D1/D2/D11：新 appid 空库起，**不迁移**、不读旧键；v3 字段映射仅作文档对照 |
| 费用类能力 | v3 无费用类能力；若历史文档提到，口径「已废弃（v0.7）」 | v4 全链路零金额（D5/D6） | 取舍不迁 | check #22、`check-docs #7`；零金额扫描 0 命中 | 不迁移、不新增字段/动作/文案/验收；服务类型只表达类型 |

## 4. v3 教训是否解决

> 分三层：v3 工程教训（`docs/V4_ENGINEERING.md` §9.3 搬迁清单 12 张）、`docs/V4_UX_PARTNER.md` §5.2 六条业务教训、v4 批 1~8 自产踩坑卡（`docs/lessons/`）。只引用，不重写长文。

### 4.1 v3 工程教训 12 张 → v4 机制

| v3 教训卡（v3 `docs/lessons/`） | v4 落点（机制/门禁） | 状态 |
| :-- | :-- | :-- |
| `数字口径与CRLF` | `docs/V4_ENGINEERING.md` §9.2「数字不写死」；`.gitattributes * text eol=lf`；文档门禁 `check-docs` | 已解决 |
| `UTF-16LE编码破坏` | `check #8` 编译产物零 BOM + `check #7` `.ps1` 必须 BOM（两向） | 已解决 |
| `PowerShell写文件会加BOM` | 同上 #7/#8；`check.ps1`/`gate.ps1`/`doctor.ps1` 显式 BOM 并在每轮门禁校验 | 已解决 |
| `编辑器改ps1会吃掉BOM` | 同 #7（常驻判据，不靠人工记） | 已解决 |
| `假exit码` | `check.ps1` 四步汇总 + 退出码；「没有汇总行 = 读数作废」（ENGINEERING §8.1/#22）；`selftest.js` 的 `EXPECTED_ASSERTIONS` 完整性闸 | 已解决 |
| `门禁参数串成一个` | `gate.ps1 -ScopeFiles` 单逗号串（ENGINEERING §8.4）；六项判据固定入参形态 | 已解决 |
| `空集上的全绿` | 批 2/3 变异取证：`check #29` 脱敏件缺失即判红（TD-002 关闭）、`check #28` 去注释后三条同时命中（TD-031 关闭）；`tools/mutation.ps1` 保留首红证据 | 已解决（有首红） |
| `并行写同一工作树会让范围门禁误报` | ENGINEERING §8.4：并行写只走 `git worktree`，同树并行声明并集；本仓批 2~8 按共享任务板写作用域执行 | 持续执行 |
| `非ASCII路径被git转义` | `gate.ps1` 统一 `git -c core.quotepath=false`（取变更集/状态/numstat） | 已解决 |
| `相对路径喂给NET静态方法会读空` | v4 `check.ps1` 用 `$PSCommandPath` 取脚本绝对根再 `Set-Location`；工具链只跑 `node`/`powershell -File` | 已解决（形态改变） |
| `变异不红的两种含义` | `tools/mutation.ps1`（锚点→注入→首红→SHA256 还原→复跑）+ AGENTS §5.3「判绿即判据没牙，当场补断言并留首红证据」；批 2~8 各批按 ENGINEERING §7.5 跑变异电池（M9~M22 安全判据在册） | 已解决 |
| `git未配身份会让提交静默失败` | `doctor.ps1` 与 `gate.ps1` 前置 `git var GIT_AUTHOR_IDENT`；ENGINEERING §8.5 显式配置身份 | 已解决 |

### 4.2 UX_PARTNER §5.2 六条业务教训

| v3 教训（业务） | v4 解决 | 证据 |
| :-- | :-- | :-- |
| 已取件只是时间戳（`pickedAt`），状态仍是待办 | 独立 `PICKED` 状态 + `order_events`；`order.unmarkPicked` 明确回退 | `selftest-state`、`selftest-order-lifecycle` |
| 无送达闭环（done/archived 零 UI 调用） | `DELIVERED` + 顾客确认 / `autoCompleteHours` 自动 `COMPLETED` | `selftest-order-lifecycle`、`selftest-cleanup` |
| 无撤销（误勾只能逐件找） | 5 秒撤销条 + `order.undo`（只覆盖取件/送达）；批量逐单校验、部分失败如实说 | `selftest-order-workbench`、`selftest-order-partner` |
| 无搜索（件多靠翻） | 服务端搜索（订单号/码/宿舍/称呼/尾号）+ 状态/站点/客户筛选 | `selftest-order-partner`、`selftest-partner-customers` |
| 无凭证（口头/记忆对账） | 事件流水 + 顾客确认 + `deliveryNote`；截图 7 天删除，只作识别材料 | `selftest-order-lifecycle`、`selftest-order-detail-partner` |
| 全量 setData（勾一次重发全表） | 分页 + 分片 + 行级 patch + 30s 增量轮询（客户端四档排序在 `shared/order-view`） | `selftest-order-workbench`、`selftest-order-partner` |

### 4.3 v4 自产踩坑卡是否已固化为判据（节选）

- `小写集合键让下单快乐路径全挂` → `selftest-bind-cloud` G 组静态回归闸：全仓 `cloudfunctions/**/*.js` 去注释后扫 `COLLECTIONS.<小写键>` 零命中。
- `判据写死路径导致子检查空转` → `check #29` 文件缺失即判红、`check #28` 去注释加固（批 2 M21 / 批 3 M28 首红证据）。
- `隐私披露文本与客户端零外呼门禁冲突` → `check #24` 单文件窄豁免 + 补偿断言（批 8 回写）。
- `cleanup域无测试导致全域运行必崩` → 新增 `selftest-cleanup`（时间旅行/重跑幂等/失败隔离/不变量）。
- `计数器首次取号只预留1个` → `selftest-order` D5b/D5c 回归断言（批 4 修复）。
- `二选一入参要靠显式互斥校验`、`幂等键应按逻辑提交生成` → `selftest-partner-orders`、`selftest-order-flow` 覆盖互斥与重放。
- 其余卡对应的判据见各批新增套件与 `STATE.md` §3b~§3h 交付快照；**判据未固化前不得把 lesson 卡当验收证据**。

## 5. 验收结论与剩余项

### 5.1 结论（文档级）

1. v3 的 5 个页面全部有去向：4 个**改进**落入 v4 对应页，1 个（`chatpick` 聊天工具）**取舍不迁**且有理由（§2.1）。
2. v3 的 19 类业务能力/流程全部映射到 v4 页面/action/集合/判据（§3）：**8 类改进 + 9 类新增 + 2 类取舍不迁**（本机存储、费用类能力），无「有实现在 v3、v4 无去向」项。
3. v3 的 12 张工程教训与 6 条业务教训均已在 v4 有机制或判据承接（§4）；v4 批 1~8 自产教训卡已按「卡片 → 判据」逐条回写（节选见 §4.3）。
4. **未验收项**：所有真机/双机/后台人点检项、云环境实际部署、审核与提审均未开始（§5.2）；本表**不能**作为「已验收通过」或「全门禁已过」的依据。
5. 验收方式：机器证据以 `powershell -File check.ps1` 退出码 0 且含汇总行、`node tools/selftest.js` 全绿、`node tools/check-docs.js` 全过、零金额扫描 0 命中为准（取数见 §6）；人证据以 `docs/QA_CHECKLIST.md` 勾选为准。

### 5.2 剩余项汇总（D 级已于 2026-10-22 全部闭环；余 E#/R#/真机与提审项）

| # | 事项 | 类别 | 影响/阻塞 | 处理人 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | 开通云开发并创建 dev/prod 环境 | D1 | 云资源、部署、联调 | 用户（已裁决 A，待执行） |
| 2 | 确认 appid `wxcb7e5b41b89bc806` 主体可用 | D2 | 开工门/真机 | 用户（已裁决沿用 v3 appid） |
| 3 | 邀请码准入方案确认 | D3 | 激活流程锁定 | 用户（已裁决 A） |
| 4 | 主体/类目：个人主体 + 工具类目（提审前确认类目可选+备案） | D13 | 提审风险 | 用户（已裁决） |
| 5 | 五苑展示名：东苑/西苑/南苑/北苑/翠苑 | D8 | 展示文案（默认值已落 `shared/zones.js`） | 用户（已裁决） |
| 6 | 上传失败后无截图手填：不允许（必须先有截图） | D22 | 交互口径（无需改代码） | 已裁决 A |
| 7 | 云存储安全规则与分包形态实测 | E5 | 上传链路 | 用户 + Lead 实测 |
| 8 | 头像/昵称隐私接口与基础库能力 | E12 | 头像/昵称可能降级 | 用户真机实测 |
| 9 | DeepSeek 账号/条款/配额合规 | E11 | 识别兜底不能上线 | 用户 + Lead |
| 10 | VisionKit 真机吐字、上传链路、订阅消息模板 | R3/R2/R6 | 识别形态/通知增强 | 用户真机/申请 |
| 11 | 校方/驿站线下要求、云配额与成本估算 | R9/R13 | 运营与成本 | 用户 |
| 12 | `docs/QA_CHECKLIST.md` 全部人点检项（§A~§P） | R12 | 发布前置 | 用户点检 |
| 13 | 隐私文本 13 项用户填写 + 微信后台声明 | D9/D16~D19 相关 | 阻塞提审 | 用户 |
| 14 | P1 清单（订阅消息、提示音、送达照片/签名/二维码、趋势对比、站点动线序、搜索历史、guest 认领 `order.guestClaim`、后台批量作废/复核批量等） | P1 | 后续版本，不阻塞本轮 | 用户裁决排期 |
| 15 | P2 / 不做清单（评分评价等，见 `docs/V4_UX_CUSTOMER.md` §2 与 `docs/V4_UX_DEVELOPER.md` §10.3） | P2 / 不做 | 不在范围 | 用户确认 |
| 16 | v3 6 类不迁项（本机存储、聊天工具、件级硬删、「未归类→归户」、3 天硬窗口、档案回收站） | 取舍确认 | 需用户确认取舍清单 | 用户勾选 |

### 5.3 用户勾选栏（供逐项打勾，不代勾）

| 勾选 | 验收包 | 对应章节/证据 |
| :-- | :-- | :-- |
| ☐ | v3 5 个页面 → v4 落点确认 | §2.1 |
| ☐ | v4 30 页覆盖确认（含 23 个新增页） | §2.2 |
| ☐ | v3 19 类能力 → v4 action/集合确认 | §3 |
| ☐ | v3 6 类不迁项取舍确认 | §0/§2.1/§5.2 #16 |
| ☐ | v3 12 张工程教训 + 6 条业务教训解决确认 | §4 |
| ☐ | 真机 QA §A/§B/§C（账号、编号、绑定与 roomTag） | `docs/QA_CHECKLIST.md` |
| ☐ | 真机 QA §D/§E（下单链路、订单闭环） | 同上 |
| ☐ | 真机 QA §F（工作台/客户档案/统计） | 同上 |
| ☐ | 真机 QA §G/§V/§T（后台、只读视角、切换会话与测试账号） | 同上 |
| ☐ | 真机 QA §R/§S/§P/§M（识别兜底、隔离负向、隐私、零金额巡检） | 同上 |
| ☐ | 发布前 §H + 隐私文本 13 项填写 | 同上 + `docs/privacy/发布前填写清单.md` |
| ☐ | D1/D2/D3/D8/D13/D22 裁决与确认（2026-10-22 已全部裁决，待用户最终勾选归档） | §5.2 #1~#6 |

## 6. 附录 · 盘点与取数命令（数字以真实输出为准）

```powershell
# ── v3 页面登记（唯一可信来源 = app.json，不靠目录猜测）──────────────
$v3 = 'D:\Code\expresseage_college_v3'
$a  = Get-Content "$v3\app.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$a.pages
$a.subPackages | ForEach-Object { $_.root + ': ' + ($_.pages -join ', ') }

# ── v3 盘点规模（以输出为准）─────────────────────────────────────────
Get-ChildItem "$v3\pages" -Recurse -File -Filter *.js | Measure-Object
Get-ChildItem "$v3\utils" -File -Filter *.js | Measure-Object
Get-ChildItem "$v3\docs\lessons" -File | Select-Object -ExpandProperty Name
(Get-ChildItem $v3 -Directory | Where-Object Name -match 'cloud').Count   # 期望 0

# ── v4 页面全集 = 30 页对帐（以输出为准）────────────────────────────
node -e "const P=require('./tools/lib/project');console.log(P.ALL_PAGES.length);P.ALL_PAGES.forEach(p=>console.log(p))"

# ── v4 机器证据（退出码 0 且含汇总行才算数）─────────────────────────
node tools/check.js
node tools/check-docs.js
node tools/selftest.js
node tools/zero-money-scan.js
powershell -File check.ps1

# ── 变异电池（判据有牙的取证形态）───────────────────────────────────
powershell -File tools/mutation.ps1 -DryRun -Target tools/check.js -Anchor <唯一锚点> -Replace <变异文本> -Test 'node tools/check.js'

# ── 批 1~8 收口证据与台账 ───────────────────────────────────────────
Select-String -Path STATE.md -Pattern '^## (2|6[bcdefgh]?)\.'
```

- 本文引用的套件/门禁编号以仓库当前文件为准；套件清单取数：`Get-ChildItem tools -Filter 'selftest-*.js'`。
- 真机/人点检项的通过与否**只能**以 `docs/QA_CHECKLIST.md` 的勾选与证据记录为准；本表不复制其条目。
- 本文自身在 `docs/V4_V3_PARITY.md`；若需要纳入文档门禁的"必需文件"清单，由 Lead 在 `tools/lib/project.js` 登记（属 Lead 域，本文不代改）。
