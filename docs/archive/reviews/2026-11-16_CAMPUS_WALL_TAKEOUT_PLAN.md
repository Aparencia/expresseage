# 方案：校门代取（E）+ 角色入口优化（2026-11-16，本次不做校园墙）

> **性质**：方案稿 + Phase 1 实施记录（D80 已实施；真机/备案/提审待用户；不作为验收证据）。输入 = `docs/archive/research/2026-11-14_CAMPUS_WALL_TAKEOUT_FEASIBILITY.md` + 2026-11-16 用户澄清「外卖员已把餐送到大学东门，顾客再找我们代取；无商家/餐品/抢单」+ 2026-11-16 用户裁决「这次不做校园墙」「进行代码实施」。
> **结论先行**：**本次只做 Phase 1：在现有个人主体内做「校门代取 E」+ 角色入口 M1**；不新增小程序、不换主体、不新增微信类目；备案描述做一次补充/变更；E 不做公开池/商家/餐品/站内点餐/支付。**校园墙本次不做**：不排期、不写代码、不以墙为理由升级主体；研究结论保留，后续若要重启另立方案。
> **口径源**：`docs/contract/V4_CONTRACT.md` §1/§4/§5/§7/§10/§11/§13、`docs/data/V4_DATA_MODEL.md`、`docs/engineering/V4_ARCHITECTURE.md`；本稿不登记新 D#，正式裁决编号由 Lead 在用户拍板后分配。

---

## 0. 范围（做 / 不做）

| 做 | 不做（本期） |
| :-- | :-- |
| 校门代取 E：顾客选校门（东门等）+ 送达地址 + 时间/备注；绑定/固定指派的兼职到校门取已送达物品并送达 | 公开抢单池、跑腿员抢单、平台撮合 |
| 角色入口 M1：去掉「我是顾客/我是兼职」强制二选一；服务卡 + 「切换工作台」 | 统一 4 tab 全量重写、能力模型全量替换 |
| 备案描述补充/变更、提审说明、隐私文本同步 | **校园墙（本次整体不做）** |
| 复用现有订单状态/动作/绑定/转派/留言/清理/后台 | 商家入驻、菜单/餐品选择、站内点餐、外卖平台订单 |
|  | 支付/收费/款项、评价、公开排行 |

**一句话**：本次是「在快递代取的同一套履约模型上，增加一个取件点是校门的 E 场景」，不是「做一个外卖平台」，也不做校园墙。

---

## 1. 合规路径

### 1.1 为什么 Phase 1 不用换主体、不用新小程序

- E 的实质：**外卖员已经把餐送到东门，餐已经是顾客的**；你们只做「从校门取到校内」的二次代取。没有商家、没有餐品选择、没有站内下单、没有公开抢单。
- 它和现有快递代取同形态：**已送达物品 + 取件信息 + 送达履约**；差别只是取件点从驿站变成校门、物品可能是外卖。
- 备案：现有备案若只写「校园快递代取」，建议补充/变更为「校园物品代取（快递/外卖等已送达物品）的信息与履约工具」；变更备案平台初审 1~2 个工作日、管局 1~20 个工作日，**变更期间不影响小程序正常使用**（以官方 FAQ 为准）。
- 微信类目：仍用现有「工具-信息查询/订单功能」口径；**不新增「生活服务-跑腿」或「餐饮-外卖平台」类目**。页面/描述用「校门代取/物品代取」，不出现「外卖下单/外卖平台/商家/餐品选择/抢单」。
- 风险：E 与现有快递共享同一条「个人主体类目边缘」风险，不是零；「外卖」字样和食品属性会提高审核注意。保持与快递完全同形态，是把风险控制在现有水平的关键。

### 1.2 什么情况会破坏这个结论

- 加入**公开抢单/接单池** → 变成平台撮合（B），个人主体没有跑腿类目，不能合规上线；
- 加入**商家/菜单/餐品选择/站内点餐** → 变成外卖/点餐平台（C），个人通常不可；
- 加入**发帖求助、他人回应帮取** → 变成社交/社区或跑腿（D），个人均不可；
- 加入**支付/收费/款项** → 触发支付、商户号、交易类目、退款/投诉/发票/税务等一整套，另立项目；
- 页面叫「外卖下单」但实际有接单/取送 → 审核会按 B/C 看，改名不解决问题（运营规范 2.5.19）。

### 1.3 校园墙：本次不做

- 用户 2026-11-16 明确本次不做；本方案**不包含**墙的页面、集合、类目、主体变更、审核人力与安全评估。
- 原因不变：个人主体没有「社交」类目；墙需要非个人主体 + 社交-社区/论坛 + 备案网络社交 + 安全评估 + 持续审核人力，且存在网暴/开盒/未成年人风险。
- 研究结论保留在 `docs/archive/research/2026-11-14_CAMPUS_WALL_TAKEOUT_FEASIBILITY.md`；后续若要重启，另立方案与 gate，不混进本批。

---

## 2. 产品方案

### 2.1 E 校门代取（Phase 1 核心）

**顾客流程**：

1. 首页/角色页选「校门代取」；
2. 选校门（首期只放东门；配置支持多门）；
3. 填送达地址（首期复用现有宿舍地址；教学楼/其他地点 P1）、期望时间（复用现有 `appoint`）、备注（≤200 字）；
4. 提交后生成订单，等待绑定/指派的兼职接单；
5. 兼职到校门取已送达物品 → 标记已取到 → 送达 → 顾客确认/超时自动完成；
6. 异常走现有异常/留言/取消/转派链路。

**兼职流程**：

- 工作台出现「校门代取 · 东门 → D4-522」行；
- 接单 → 到校门取件 → 「我已取到」→「已送达」；
- 不需要取件码/柜号/运单尾号/截图识别；不进入按站点分组的取件清单；
- 转派、留言、异常、取消与快递单一致。

**明确不做**：

- 商家名、餐品名/菜单、外卖平台订单号、餐品选择；
- 公开池/抢单/多人竞价；
- 支付/收费/款项；
- 评价/评分/排行；
- 图片上传（首期不需要；若后续要拍照存证，另立方案）；
- 手机号采集（保持现有「永不收集完整手机号」口径）。

**命名**：

- 对外统一「校门代取」；文案可解释「含外卖等已送达校门的物品」，但**功能名不叫「外卖下单/外卖代取」**，避免审核按外卖平台理解。
- 订单状态文案沿用现有：待接单/已接单/已取件/已送达/已完成/异常/已取消；「已取件」在 E 语境可显示「已取到」。

**与快递代取的区别**：

| 维度 | 快递代取（现状） | 校门代取 E |
| :-- | :-- | :-- |
| 取件点 | 驿站 P1~P8 | 校门（东门等） |
| 凭证 | 取件码/柜号/运单尾号 | 无；到校门取已送达物品 |
| 识别 | 截图 OCR/AI 兜底 | 不需要 |
| 分组 | 按站点/楼层 | 工作台单列；不进站点分组 |
| 时效 | 可预约最晚时间 | 默认尽快；可选最晚时间 |
| 关系 | 1:1 绑定 | 同左（绑定/固定指派），**不公开抢单** |
| 计费 | 零金额 | 零金额（线下自行处理，平台不参与） |

### 2.2 角色入口 M1（去掉强制二选一）

现状：`users.roles[]` 已支持同一 openid 同时是顾客与兼职；`shared/role.js` 在双角色时优先兼职；但 `pages/role` 仍让用户二选一，`bindings` 1:1，`order.create` 顾客路径先要求绑定。

M1 只做「入口/导航」层：

- `pages/role` 改为「继续使用 + 服务卡」：快递代取 / 校门代取；不再出现「我是顾客/我是兼职」两张必选卡（墙本次不做，不放进口）。
- 有 `lastRole` 时给「继续上次」；没有则默认顾客首页；开发者/切换会话仍按现有分流。
- 「我的」增加「切换工作台」：顾客首页 ↔ 接单工作台（仅已开通接单时显示）；不再要求重新选身份。
- 顾客首页增加「校门代取」服务卡；订单列表行加「校门代取」标签。
- 服务端**不改鉴权模型**：仍按 `users.roles` + 资源归属；M1 不引入新的能力枚举，避免大改。
- 不做：统一 4 tab 重写、`role` 数据迁移、把 `PARTNER` 从 `users.roles` 移除。

> 目标态仍是「账号—能力—服务线—关系」，但 M1 先用最小改动解决「强制二选一」；等多服务线真正上来，再做能力模型全量替换。

### 2.3 校园墙：本次不做

- 用户 2026-11-16 明确本次不做；本方案不排期、不写代码、不做主体变更、不新增社交类目。
- 现有研究结论保留：墙需要非个人主体 + 社交-社区/论坛 + 备案网络社交 + 安全评估 + 审核人力 + 校方沟通；这些不在本批。
- 本批不以墙为理由升级主体或新增小程序；若未来重启，另立方案与裁决。

---

## 3. 技术方案

### 3.1 数据模型（Phase 1）

**订单增加线字段与校门块**：

| 字段 | 类型 | 说明 |
| :-- | :-- | :-- |
| `orders.line` | string | `EXPRESS`（默认，旧单零迁移）/ `GATE`（校门代取）；不引入 `TAKEOUT` |
| `orders.gate` | object | GATE 单必填：`{pointId,pointName,itemKind,note?}`；`itemKind ∈ FOOD/OTHER/UNKNOWN`；`note ≤200` |
| `orders.service` | object | GATE 单 `code='GATE_PICKUP'`、`name='校门代取'`；仍只有 code/name，无款项字段 |
| `orders.parcels` | array | GATE 单**服务端固定 1 件内部占位**（站点空、站名=校门点、码空），供既有 7 状态/取件/转派复用；DTO 对 GATE 不下发该件并改发 `gate` 摘要；EXPRESS 保持 1~10 件 |
| `orders.images` / `manualEntry` | array/bool | GATE 单 `[]`/`false`；不进入识别链路 |
| `orders.delivery` | object | 复用现有宿舍地址；首期不改结构 |
| `orders.appoint` | object | 复用现有 ASAP/LATEST；GATE 默认 ASAP |
| `orders.transfer` | object | 复用 D58；GATE 可转派 |

**配置**：

- `config.serviceCatalog` 增默认项 `{code:'GATE_PICKUP',name:'校门代取',desc:'到校门取已送达物品并送到校内'}`；仍无任何款项字段。
- `config.gatePoints`：`[{id:'EAST',name:'东门'}]`（首期可只放东门；后续可加西门/南门；进公开子集）。
- `config.gateEnabled`：布尔，默认 `false`；客户端入口按此显示；部署后先关，备案/审核/QA 通过再开。
- `config.getPublic` 下发 `serviceCatalog`、`gatePoints`、`gateEnabled`；不下发内部治理字段。

**状态与事件**：

- 复用 7 状态：`SUBMITTED → ACCEPTED → PICKED → DELIVERED → COMPLETED`，异常/取消分支不变；
- 复用事件：`ORDER_CREATED/ACCEPTED/PICKED/DELIVERED/COMPLETED/...`；GATE 的 `markPicked` 写订单级 `pickedAt`，不写件级；
- GATE 单 `order.correct` 拒绝（无取件码）；`order.imageUrl` 不适用；`order.markPicked/markDelivered/unmark*` 按 `line` 分支。

**索引**：

- 现有工作台查询按 `partnerId/status/statusUpdatedAt`；若服务端按 `line` 过滤，补 `(partnerId,status,line,statusUpdatedAt)` 组合索引；
- 顾客列表同理；是否新增索引以 DATA_MODEL §5 查询路径与真实查询为准，不预先堆索引；索引由用户在控制台创建。

### 3.2 服务端/API

| 动作 | 变更 |
| :-- | :-- |
| `order.create` | 接受 `line:'GATE'` + `gate{...}`；GATE 客户端**不传** `parcels`/取件码/截图，服务端内部生成 1 件占位；仍要求资料完整 + ACTIVE 绑定（与快递一致）；幂等/合并窗口不适用 GATE（GATE 不做合并） |
| `order.get` | DTO 增 `line`、`gate`、`gatePicked`/`pickedAt`；GATE 不返回 `parcels` 件级字段 |
| `order.listCustomer` | 行 DTO 增 `line`/`gate` 摘要；counts 口径不变 |
| `order.listPartner` | 工作台/历史/客户视图含 GATE 行；`view=pick-list` 排除 GATE（首期不做校门 chip）；`view=transfer` 不变 |
| `order.markPicked` | GATE：订单级置 PICKED、写 `pickedAt`、记 `PICKED`；不接受 `itemIndex` |
| `order.unmarkPicked` | GATE：回 ACCEPTED、清 `pickedAt`、记 `PICKED_REVERTED` |
| `order.markDelivered` | GATE：与快递一致；送达后顾客确认/自动完成不变 |
| `order.correct` | GATE 返回 `INVALID_STATE`/`VALIDATION_FAILED`（无码可改） |
| `order.imageUrl` | GATE 返回 `NOT_FOUND`（无图） |
| `order.transfer` | GATE 可发起/接收；只改履约人，不改 `line/gate` |
| `order.cancel` | GATE 与快递一致（接单前顾客可取消；接单后按现有规则） |
| `config.getPublic` | 增 `gateEnabled/gatePoints`；`serviceCatalog` 含 GATE_PICKUP |
| `admin.listOrders/getOrder` | 增 `line`/`gate` 只读投影；脱敏口径不变 |

**守卫**：

- GATE 仍要求 `CUSTOMER` 角色 + 资料完整 + ACTIVE 绑定；兼职仍需 `PARTNER` + ACTIVE + 服务线开启（建议 GATE 默认关闭，兼职在服务配置里主动开启）；
- 测试账号/真实账号隔离、切换会话只读/TEST_WRITE 白名单不变；
- 后台不新增写动作；不做「代客校门代取」首期（P1）。

### 3.3 客户端页面

| 端 | 页面 | 变更 |
| :-- | :-- | :-- |
| 顾客 | `pkg-customer/pages/gate-create`（**新增 1 页**） | 校门选择、送达地址、时间、备注、确认提交；无商家/餐品/取件码/截图；页面四件套 + parts 纯件 |
| 顾客 | `pkg-customer/pages/order-detail` | `parts/gate-view.js` 分支：显示「校门：东门 → D4-522」、物品类型（可选）、进度；无包裹卡/截图/取件码 |
| 顾客 | `pages/customer/home` | 服务卡「校门代取」（`gateEnabled` 时显示） |
| 顾客 | `pages/customer/orders` | 行标签「校门代取」；状态/时间不变 |
| 兼职 | `pages/partner/workbench` | 行/分组支持 GATE：单列「校门代取」行；不按站点分组；动作「我已取到/已送达」 |
| 兼职 | `pkg-partner/pages/order-detail` | GATE 视图；隐藏改码/补码/截图；保留转派/留言/异常/取消 |
| 兼职 | `pages/partner/pick-list` | 首期排除 GATE（校门单不进站点清单）；页面说明「校门代取在工作台处理」 |
| 兼职 | `pkg-partner/pages/service-settings` | 增加「校门代取」开关（默认关）；开启后接收 GATE 单 |
| 共用 | `pages/role` | 服务卡 + 「继续使用」；去掉强制二选一 |
| 共用 | `pages/profile` | 「切换工作台」入口（已开通接单时） |
| 后台 | `pkg-admin/pages/orders` / `order-detail` | 行/详情显示 `line` 标签；可选筛选；只读脱敏；无新页 |

**页数**：新增 1 页（`gate-create`），以 `app.json` / `tools/lib/project.js` / CONTRACT §7 实际取数为准；同步页面地图、check-docs #2。

### 3.4 权限与隐私

- GATE 与快递同一绑定/归属：顾客看自己的单；绑定兼职看绑定顾客的 GATE 单；转派后新履约人只看履约必需信息；顾客只看 `partnerNo`，不扩大头像/昵称可见面（D19/D42/D58）。
- 不采集商家、餐品、外卖平台账号、完整手机号；`gate.note` 过 `msgSecCheck`；`gate.itemKind` 只是分类，不强制。
- 隐私文本增补：校门代取会记录「校门点、物品类型（可选）、送达地址、时间、备注」；不新增手机号/定位/支付信息；公开范围仍为订单双方与后台脱敏视图。
- 后台 DTO：只加 `line/gate.pointName/itemKind`；不展示完整备注中的敏感值？现有备注已按后台策略；保持脱敏。
- 分享：订单详情不新增分享；现有分享规则不变；GATE 卡片不带校门/地址/备注（若未来加分享，另评）。

### 3.5 备案/提审

- **备案**：先核对后台「服务内容」。若只写快递，做一次变更/补充，描述用「校园物品代取（快递/外卖等已送达物品）的信息与履约工具：顾客提交取件点与送达信息，兼职按信息取件并送达，双方在同一订单中同步进度；不涉及商家入驻、站内点餐、公开抢单或支付」。管局 1~20 个工作日；变更不影响使用。
- **微信审核**：类目不变；提审说明明确「外卖员已送达校门后的二次代取，无商家/餐品/下单/抢单/支付」；截图用「校门代取」页面，不出现「外卖下单」；如审核追问，按 D13 顺序「换子类目→调整描述→企业主体→仅体验版」处理，不虚构功能。
- **提审材料**：更新 `docs/delivery/review/04_类目备案与业务说明.md` 的产品描述/功能清单/截图说明；更新隐私对照与 QA。
- **开关**：`gateEnabled=false` 先部署；备案/审核/QA 通过后再开；若审核要求调整，关开关即可回退，不必回滚代码。

---

## 4. 分批计划

### Phase 0：裁决与准备（用户，0 代码）

| 事项 | 产出 | Gate |
| :-- | :-- | :-- |
| 确认 E 范围：无商家/餐品/抢单/支付；首期只宿舍、只东门 | 书面确认 Q1~Q6（§7） | G0-a |
| 核对备案服务内容；准备变更描述 | 后台截图 + 变更草稿 | G0-b |
| 校门取件规则/校方沟通 | 书面要求或邮件 | G0-c |
| 审核说明/截图计划 | 提审材料草稿 | G0-d |
| 确认本次不做校园墙 | 书面裁决（已确认） | G0-e |

### Phase 1：E + 角色 M1（工程侧）

| 工作包 | 内容 | 作用域 | 验收 |
| :-- | :-- | :-- | :-- |
| P1-1 口径/契约 | 新增裁决（E/line/gate/service/role M1/零金额/不做池）；CONTRACT/DATA_MODEL/ARCHITECTURE/UX 更新 | S1/S6 | 口径评审通过；无 D# 越界 |
| P1-2 共享/数据 | `shared` line/gate 校验、serviceCatalog、gatePoints、gateEnabled；`orders` 字段/索引；`config` 公开子集 | S1/S8 | 单测；旧单零迁移 |
| P1-3 云端订单 | `order.create` GATE 分支；DTO；`markPicked/unmark/markDelivered/correct` 分支；列表/工作台；后台投影 | S8/S9 | handler 单测；越权负向 |
| P1-4 顾客端 | `gate-create` 页；首页服务卡；详情 gate-view；订单标签；页数/地图 | S3/S0 | 页面四件套；交互验收 |
| P1-5 兼职端 | 工作台 GATE 行/动作；详情；pick-list 排除；服务配置开关 | S4 | 双端流程；转派/异常/取消 |
| P1-6 角色 M1 | `pages/role` 服务卡；`profile` 切换工作台；路由/lastRole；不迁移数据 | S0/S3/S4 | 同一账号双角色；旧入口不丢 |
| P1-7 后台 | 订单列表/详情 line 标签/筛选；脱敏 | S5 | 只读；无新写动作 |
| P1-8 测试/门禁 | 新增 `selftest-gate-order`、`selftest-gate-pages`；回归 order-*/role/privacy/share；变异电池 | S2 | `check.ps1` 0；零金额 0；页数/地图一致 |
| P1-9 备案/提审/文档 | 备案变更；提审说明；隐私文本；QA/RUNBOOK/REVIEW；CHANGELOG/STATE | S6 | 备案通过/受理；提审材料齐 |

**建议顺序**：P1-1 → P1-2 → P1-3 → P1-4/P1-5 并行 → P1-6 → P1-7 → P1-8 → P1-9。云端先部署、客户端后发；`gateEnabled=false` 全程默认关。

**粗估**：工程 3~5 周（1~2 名开发，含测试/文档）；备案变更 1~20 个工作日（与工程并行）；真机点检由用户执行。**不是承诺，按实际排期调整。**

**Gate G1**：

- `check.ps1` 4 步退出码 0 + 真实输出；
- 新套件与回归全绿；变异电池至少覆盖：GATE 复用 parcel 校验、GATE 公开池、角色强制二选一、DTO 泄露商家/餐品、`gateEnabled` 失效；
- 顾客/兼职双端真机流程通过（用户点检）；
- 备案变更已受理/通过（未通过则保持 gate 关闭，不对外）；
- 提审材料/隐私文本同步。

### 附：校园墙（本次不做，不属于本批）

- 本次**不排期、不写代码、不做主体变更、不新增社交类目**；不以墙为理由升级主体或新增小程序。
- 若未来重启：按研究稿的六项前置（主体/类目/备案/安全评估/审核人力/校方）另立方案与 gate，不与本批混做。

### 后续可选（不在本批，不承诺）

- 图片（`mediaCheckAsync` + 消息推送端点）、评论、回复通知、教学楼/其他地点、公开接单池（需非个人主体+跑腿类目）。
- 每项单独评估合规/审核/运营，不默认做。

---

## 5. 测试、门禁与回滚

### 5.1 测试

- 新增：`selftest-gate-order`（创建/校验/状态/DTO/转派/越权/无池/无商家/无图/无码）、`selftest-gate-pages`（页面/角色入口/配置开关）。
- 回归：`selftest-order`、`order-flow`、`order-lifecycle`、`order-customer`、`order-partner`、`order-workbench`、`order-detail-partner`、`admin`、`admin-pages`、`query-window`、`share`、`privacy-text`。
- 变异电池（至少 5 组）：GATE 客户端不传 `parcels` 仍能取件；GATE 不允许公开池；角色页不得恢复强制二选一；DTO 不得下发商家/餐品；`gateEnabled=false` 必须隐藏入口。
- 真机：用户点检；agent 不代勾。

### 5.2 门禁

```bash
node tools/check.js
node tools/check-docs.js
node tools/zero-money-scan.js
node tools/selftest.js
powershell -File check.ps1
```

- 页数/地图：`app.json` ↔ `tools/lib/project.js` ↔ CONTRACT §7 三端一致；新增 1 页必须同步。
- 零金额：GATE 不新增任何款项字段/文案；文档/页面/源码三范围 0 命中。
- 隐私：`docs/privacy/` 与端内全文/补充文档/发布前清单同源；`privacyVersion` 是否升版按实际新增信息类型决定（E 只加校门点/物品类型/备注，若现有披露已覆盖订单信息，可能不升版；以隐私评审为准）。

### 5.3 回滚

- **功能开关**：`gateEnabled=false` 立即隐藏入口；云端保留 `line/gate` 字段但不接受新 GATE 单；旧单仍可读/完成。
- **客户端**：回退到上一版本；`line` 默认 EXPRESS，旧客户端不受影响。
- **云端**：`order.create` GATE 分支可关；保留字段不做破坏性迁移；不删旧数据。
- **备案/审核**：若审核要求调整，先关开关、改描述/页面，再提审；不虚构类目。

---

## 6. 影响面清单

| 层 | 文件/对象 | 变更 |
| :-- | :-- | :-- |
| 口径 | CONTRACT §1/§4/§5/§6/§7/§10/§11/§13 | 新增 E/line/gate/service/role M1/零金额/不做池；新裁决编号待登记 |
| 数据 | `orders` | `line`、`gate`、`service.GATE_PICKUP`；GATE 内部 1 件占位（DTO 隐藏）；索引按需 |
| 数据 | `config` | `serviceCatalog` 增项、`gatePoints`、`gateEnabled`；公开子集 |
| 共享 | `shared/{enums,validate,actions,order-state}` | line/gate 校验、状态分支、动作可见性；云副本同步 |
| 云端 | `handlers/order/{_create,_dto,get,listCustomer,listPartner,markPicked,...}` | GATE 分支；越权/脱敏 |
| 云端 | `handlers/admin/{listOrders,getOrder}` | line/gate 只读投影 |
| 页面 | `pkg-customer/pages/gate-create`（新）、`order-detail`、`home`、`orders`、`pages/role`、`profile` | 新页 + 分支 + 入口 |
| 页面 | `pages/partner/workbench`、`pkg-partner/pages/order-detail`、`pick-list`、`service-settings` | GATE 行/详情/排除/开关 |
| 后台 | `pkg-admin/pages/{orders,order-detail}` | line 标签/筛选 |
| 测试 | 新 2 套 + 回归 + 变异 | 判据有牙 |
| 文档 | UX/QA/RUNBOOK/privacy/review/CHANGELOG/STATE | 同步回写 |
| 备案 | 后台服务内容/描述 | 变更/补充；不影响使用 |

**不新增**：小程序、云环境、集合（Phase 1）、支付/商户号、第三方服务、定位、手机号采集。

---

## 7. 待裁决（建议默认）

| 编号 | 问题 | 选项 | 建议 |
| :-- | :-- | :-- | :-- |
| Q1 | E 的范围 | 仅校门→宿舍 / 校门→任意校内点 | **首期仅宿舍；教学楼/其他 P1** |
| Q2 | 校门点 | 仅东门 / 东门+西门+南门 | **首期仅东门；配置留多门** |
| Q3 | 对外命名 | 校门代取 / 外卖代取 / 外卖下单 | **校门代取**；文案可解释含外卖 |
| Q4 | 角色 M1 | 只改入口 / 同时重写 tab / 全量能力模型 | **只改入口，保留 tab** |
| Q5 | 备案 | 先变更再上线 / 先上线后补 | **先变更/受理，`gateEnabled` 后开** |
| Q6 | 兼职服务开关 | 默认开 / 默认关 | **默认关，兼职主动开** |
| Q7 | 数据留存/隐私 | E 只复用现有订单留存 / 新增 | **复用现有** |
| Q8 | 验收/排期 | 用户真机 / 只看门禁 | **门禁 + 用户真机双签** |

---

## 8. 推荐结论

1. **本次只批 Phase 1**：E 校门代取 + 角色 M1，在现有个人主体/现有小程序内完成；不新增小程序、不换主体、不新增微信类目；备案描述补充/变更。
2. **E 的红线**：不做商家、餐品、站内点餐、公开抢单、支付/收费；页面叫「校门代取」；与快递完全同形态。
3. **校园墙本次不做**：不排期、不写代码、不做主体变更；研究结论保留，后续重启另立方案与 gate。
4. **下一步**：用户回答 §7 的 Q1~Q6（至少 Q1/Q2/Q3/Q5），Lead 按「先口径后代码」开 Phase 1 批。

> 本稿只做方案，不改 CONTRACT、不登记新 D#、不替代用户裁决；平台规则以提交时官方最新要求为准。
