# 服务通知（微信订阅消息）接入可行性研究（2026-11-08）

> **性质**：可行性研究 / 决策输入（只读；未改代码、未申请模板、未外呼）。**不作为现行口径**；现行口径见 [`V4_CONTRACT.md`](../contract/V4_CONTRACT.md) §9（D10：站内必做、订阅消息 P1）。裁决后按 CONTRACT §13 追加编号，再按 ENGINEERING §8.6 回写全链路。
> **触发**：2026-11-08 用户问「这个项目能不能接入服务通知？」；基线 HEAD `f06f33f`（批 29 收口后，工作树另有未提交改动）。
> **取证**：微信官方文档（developers.weixin.qq.com / kf.qq.com，逐条附链接）+ 仓库静态阅读（`文件:行号`）。平台行为未在真机/云环境实测，相关项标「待控制台/真机核实」；真机项按 QA 纪律只能由用户点检。

## 0. 结论先行

**能接，但只有一条路：一次性订阅消息（用户弹窗授权）。** 结论拆开是 7 条：

1. **能力**：「服务通知」不是独立推送能力，是微信聊天列表里的展示位；小程序只能通过「订阅消息」进入。本项目（个人主体 + 工具类目，D13）**只能使用一次性订阅**——长期订阅（一次授权、长期多次下发）仅对政务民生/医疗/交通/金融/教育/设备等类目开放，工具类目无入口；新版一次性（免弹窗，支付单号或 `liveActivity` 按钮）限定业态类目，本项目不满足；设备订阅、限频订阅同样不适用。
2. **授权**：必须由用户**点击**触发 `wx.requestSubscribeMessage`（不能在 onLoad/onShow 静默弹）；一次最多 5 个模板；用户点一次「允许」= 该模板 **1 条**下发额度，额度可累积、**无 7 天时限**（7 天是已下线的旧模板消息规则）；不存在「一次授权覆盖整个订单生命周期」的路径。
3. **下发**：云函数 `cloud.openapi.subscribeMessage.send`（需在云函数 `config.json` 声明 `permissions.openapi`，否则 `-604101`）；服务端 10 万/分钟，未开通微信支付的小程序 1kw/日；43101（无额度/已拒收）必须静默降级，不得影响业务。
4. **模板**：只能从**与小程序类目匹配的公共模板库**选用；没有合适的可申请新增（需审核，官方会评估场景合理性、骚扰/营销倾向）。**「能否申请到 3 个可用模板」是 P1 成立的前置条件**，也是本项目最大的不确定性。
5. **本仓库现状**：只有设计、**零实现**；且存在一个**契约冲突**——客户端必须拿到 `tmplIds` 才能授权，而 DATA_MODEL 规定「模板 ID 不下发客户端」。实现前必须先裁决（§5 Q1）。
6. **建议范围**：P1a = 顾客侧「接单 / 取件 / 送达」状态提醒 + 兼职侧「转派邀请」；P1b = 异常提醒。**兼职「新订单提醒」不作为主通道**（按条消耗额度，量大不现实，继续用工作台 30s 轮询）；复核结果、团队变更、自动完成、解绑等列 P2/不做。
7. **预期管理**：顾客每单最多消耗 3 次额度（接单/取件/送达）；若用户只点一次「允许」，只能收到其中 1 条——授权文案必须如实说明，避免「授权了却收不到」的落差。站内消息中心 + 红点 + 轮询仍是**可靠主通道**，订阅消息只是「放大器」。

## 1. 平台事实（官方口径）

### 1.1 形态与入口

| 项 | 官方口径 | 来源 |
| :-- | :-- | :-- |
| 展示位置 | 「订阅消息推送位置：服务通知」 | [订阅消息总览](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html) |
| 下发条件 | 开发者通过一定方式触发**用户主动订阅** | 同上 |
| 点击跳转 | 卡片可跳转至小程序页面；服务端 `page` 支持带参数，仅限本小程序页面；不填则无跳转 | [sendMessage](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html) |
| 退订 | 每条消息可单独订阅或退订；用户在服务通知卡片「…」里拒收会上报事件 | [开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html) |

### 1.2 订阅消息类型与本项目适配

| 类型 | 官方准入 | 本项目 | 依据 |
| :-- | :-- | :-- | :-- |
| 一次性订阅（弹窗） | 个人主体可用；模板按类目 | **唯一可用** | [腾讯客服·个人类型功能](https://kf.qq.com/faq/170328fIJR3q170328EFvuya.html) |
| 长期订阅 | 仅政务民生/医疗/交通/金融/教育/设备等部分二级类目；工具类目无入口、无需申请也申请不到 | 不可用 | [总览](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html)、[官方社区·工具类目](https://developers.weixin.qq.com/community/minihome/doc/00026eccfdcde83f6983a221561800) |
| 新版一次性（Beta，免弹窗） | 限定业态卡片（购物/物流/交通/餐饮/酒店/门票等）；凭证 = 微信支付订单号或 `liveActivity` 按钮 code；不支持 `requestSubscribeMessage` | 不可用（个人主体无微信支付；类目不含工具） | [新版指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-2.html) |
| 长期订阅·限频 | 当前暂向金融等指定行业开放 | 不可用 | [总览](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html) |
| 设备订阅 | 属长期订阅，需完成设备接入 | 不适用 | 同上 |

### 1.3 客户端授权 API 约束

| 约束 | 官方口径 | 来源 |
| :-- | :-- | :-- |
| 手势 | 「仅在点击行为时调用」；2.8.2 起需用户点击或支付回调 | [requestSubscribeMessage](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html) |
| 数量 | 一次最多 5 个 `tmplId`；同次调用模板标题不能重复（重复被 `filter`） | 同上 |
| 返回 | 每模板 `accept` / `reject` / `ban` / `filter`；失败码 10001~10005、20001~20005、20013（20004=用户关闭主开关） | 同上 |
| 总是保持 | 勾选后下次调用**不弹窗**、沿用上次选择，但仍需用户点击触发；`wx.getSetting({withSubscriptions:true})` 可读状态 | [开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html) |
| 基础库 | 2.4.4 起；2.4.4~2.8.3 仅支持 1 个模板 | [requestSubscribeMessage](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html) |
| 静默订阅 | **不能**（传统一次性）；唯一免弹窗形态是新版一次性，本项目不满足 | 同上 + [新版指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-2.html) |

### 1.4 服务端下发与额度

| 项 | 官方口径 | 来源 |
| :-- | :-- | :-- |
| 接口 | HTTPS `POST /cgi-bin/message/subscribe/send`；云调用 `cloud.openapi.subscribeMessage.send`（camelCase 入参） | [sendMessage](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html) |
| 必填 | `touser`、`template_id`、`data`；`page` / `miniprogram_state` / `lang` 选填（文档表与说明有矛盾，建议显式传） | 同上 |
| 额度语义 | 一次授权 = 一条；**可累积**；用户同意几次就能发几次；**无 7 天时限** | [云托管指引](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/scene/deploy/subscribe.html)、[总览](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html) |
| 上限 | 未开通微信支付：1kw/日；开通：3kw/日；服务端调用 10 万/分钟 | [开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)、[云调用](https://developers.weixin.qq.com/doc/oplatform/developers/dev/cloudCall.html) |
| 错误码 | 43101 未订阅/额度用完；43107 能力封禁；43108 同用户并发；45168 敏感词；47003 参数/字段不符；41030 `page` 在现网不存在 | [sendMessage](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html)、[全局错误码](https://developers.weixin.qq.com/doc/oplatform/developers/errCode/README.html) |
| 云调用权限 | 云函数 `config.json` → `permissions.openapi: ["subscribeMessage.send"]`，有 10 分钟缓存 | [云调用](https://developers.weixin.qq.com/doc/oplatform/developers/dev/cloudCall.html) |

### 1.5 模板库与字段

| 项 | 官方口径 | 影响 |
| :-- | :-- | :-- |
| 来源 | 后台「功能-订阅消息-公共模板库」，按小程序类目确定可选集合 | 工具类目下是否有「订单/取件/异常」模板，**必须后台核实** |
| 自定义 | 可申请新增模板或新增事项，均需审核 | 审核不确定，是 P1 前置风险 |
| 审核口径 | 评估场景合理性；骚扰、营销、滥用倾向不支持入库 | 校园代取属工具场景，需写清服务闭环 |
| 字段 | `thing` ≤20 字符、`phrase` ≤5 汉字、`character_string` ≤32、`number` ≤32、`time`、`date` 等；按模板类型前缀填 `data` | 订单号、站点、状态可用；**取件码/宿舍/尾号不得进通知（L3）** |
| `page` | 必须是现网存在的页面路径，与 `app.json` 一致 | 只能指已发布页面；开发版调试需 `miniprogram_state` |

### 1.6 合规红线

- 运营规范单列「滥用订阅消息」：诱导订阅/诱导点击、强制订阅后才能继续、下发与用户预期严重不符，均可「删除订阅消息或短期、长期、永久封禁订阅消息能力」（[运营规范](https://developers.weixin.qq.com/miniprogram/product/)）。本项目执行口径：**授权按钮独立、可跳过、拒绝不阻断**（与 UX §8.4 一致），文案不得营销化。
- 订阅消息本身不新增「隐私接口」声明项（不在官方隐私接口对照表），但通知内容仍受现有隐私口径约束：不得带取件码/宿舍/尾号/头像/昵称/截图/票据。隐私文本已披露「微信订阅消息为可选能力，仅在你点击授权后发送订单状态提醒」（`pkg-customer/parts/privacy-text.js:54`、`docs/privacy/隐私保护指引.md:48`），范围若扩到兼职新单需同批回写（§8）。

### 1.7 替代通道对比（只做事实对比）

| 通道 | 关键约束 | 本项目 |
| :-- | :-- | :-- |
| 站内消息中心（现状） | 无需授权；用户打开小程序/轮询才可见 | **主通道，必须保留** |
| 客服消息 | 用户先发消息/进客服会话后 48 小时窗口，被动回复 | 不可主动触达；CONTRACT 已定不做原生客服 IM |
| 公众号模板消息/订阅通知 | 需认证服务号；个人主体不能注册服务号 | 不可用 |
| 短信跳小程序 | URL Scheme/Link **仅对非个人主体开放**，另需短信服务 | 不可用 |
| 长期订阅 | 类目门槛 | 不可用 |

## 2. 本项目现状（代码与文档证据）

### 2.1 设计已定、实现为零

| 检查项 | 结论 | 证据 |
| :-- | :-- | :-- |
| 口径 | 站内必做；订阅消息 P1；模板 ID 进 `config`、不硬编码 | `docs/contract/V4_CONTRACT.md:122,466`（D10） |
| 交互 | 模板 3 类（新订单/状态/异常）；授权时机/文案/拒绝不阻断 | `docs/ux/V4_UX_CUSTOMER.md:701-704,722` |
| 数据 | `config.subscribeTemplates` `{enabled,newOrderTemplateId?,statusTemplateId?,exceptionTemplateId?}`；公开配置只下发 `subscribeEnabled` | `docs/data/V4_DATA_MODEL.md:264` |
| 工程 | `subscribe` `{enabled,templates:{newOrder,status,exception}}`（与 DATA_MODEL 命名/形状不一致） | `docs/engineering/V4_ENGINEERING.md:197` |
| 代码默认值 | `subscribeTemplates: { enabled: false }`，无模板 ID 子键 | `config/defaults.js:63` |
| 公开子集 | 仅派生 `subscribeEnabled:boolean`，不下发模板 ID | `config/defaults.js:129-140`；`cloudfunctions/api/handlers/config/_common.js:78` |
| 后台维护 | `admin.updateConfig` 白名单**不含** `subscribeTemplates`；后台配置 DTO 也不含 | `cloudfunctions/api/handlers/admin/updateConfig.js:33-48`；`handlers/admin/_dto.js:431-456` |
| 客户端 | 全仓 0 处 `wx.requestSubscribeMessage`；`subscribeEnabled` 无生产消费者 | grep 全仓；仅 `config/defaults.js` 与两套 selftest 命中 |
| 服务端 | 0 处 `subscribeMessage`；现有 openapi 仅 `security.msgSecCheck` | `handlers/message/_common.js:152`、`handlers/user/_common.js:237`、`handlers/order/_create.js:165` |
| 云调用权限 | `cloudfunctions/api` 无 `config.json`（目录列举）；订阅发送需新增该文件 | 目录列举；云调用要求见 §1.4 |
| 债单/审批 | TD-012「订阅消息 P1 未实现」开放；模板审批 R6 未申请 | `docs/governance/V4_TECH_DEBT.md:21`；`docs/engineering/V4_ENGINEERING.md:1005` |

### 2.2 关键契约冲突：模板 ID 到不了客户端

- 平台要求 `wx.requestSubscribeMessage({tmplIds})` 在**客户端**拿到模板 ID；但 DATA_MODEL 明确「`config.getPublic` 只下发 `subscribeEnabled`，不下发模板 ID」（`docs/data/V4_DATA_MODEL.md:264,267`），ENGINEERING 同口径（`docs/engineering/V4_ENGINEERING.md:197`）。
- 三者叠加后，当前**没有任何合法通道**把 `tmplIds`送到客户端；硬编码又违反 CONTRACT「代码不硬编码」（`V4_CONTRACT.md:466`）。
- 可选解法（需裁决，见 §5 Q1）：**A** 公开配置增下发模板 ID（模板 ID 非密钥，改 DATA_MODEL 一句 + 两处断言）；**B** 新增客户端读动作（改 `shared/actions.js`、router、CONTRACT §5.3、DATA_MODEL §7，过门禁 #13）。A 改动最小，B 保住「公开配置不下发 ID」的原意但链路更长。

### 2.3 现有通知链路（订阅消息只是增量）

- 无 `notifications` 集合：消息中心 = `order_events` 状态事件 + `order_messages` + 公告聚合（`cloudfunctions/api/handlers/message/list.js:127-181`；`_common.js:1-2`）。
- 事件写入全部在**事务内**：通用动作引擎 `runOrderAction`（`handlers/order/_common.js:121-224`，写事件 `:96`）、下单（`_create.js:386`）、合并追加（`_merge.js:222`）、转派（`_transfer.js:395`）、清理定时器（`cleanup/sweeps/orders.js:13-105`）。
- 重放/幂等：事件 `requestKey` 先查后写，命中即返回 `duplicated` 且不写事件（`_common.js:159-165`；`_create.js:392-400`；`_transfer.js:397-402`）——**发送放在「非 duplicated 且事务成功」之后即可天然去重**。
- 顾客订单详情 10s 轮询（终态停）、兼职工作台 30s 轮询、消息中心红点 D29（`message/list.js:96-104`；`pkg-customer/parts/poll-policy.js:7-9`）——这些仍是主通道。
- **最大盲区**：转派邀请只进工作台「待接收转派」区块（`_list-transfer.js:75-100`），目标兼职此时不是 `orders.partnerId`，消息中心扫不到（`message/_common.js:337-349`），最适合用订阅消息补。

### 2.4 接入点候选

| 触发点 | 事件 | 现有站内通知 | 建议模板 | 目标 | 发送位置 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 下单成功 | `ORDER_CREATED` | 兼职消息中心 + 工作台轮询 | 新订单（P2，不做主通道） | 接单兼职 | `_create.js:401` 之后（事务后） |
| 接单 | `ACCEPTED` | 顾客消息中心 + 详情轮询 | 状态提醒 | 顾客 | `runOrderAction` 事务后（`:224` 之后） |
| 取件 | `PICKED` / `PARCEL_PICKED` | 同上 | 状态提醒 | 顾客 | 同上 |
| 送达 | `DELIVERED` | 同上 | 状态提醒 | 顾客 | 同上 |
| 异常 | `EXCEPTION_REPORTED` | 双方消息中心 | 异常提醒 | 顾客（P1）/兼职（P2） | 同上 |
| 顾客取消 / 兼职拒单 | `CANCELLED` / `REJECTED` | 对侧可见 | 状态提醒（P2） | 对侧 | 同上 |
| 转派发起 | `TRANSFER_REQUESTED` | 仅工作台区块 | 转派邀请（P1，复用或新模板） | 目标兼职 | `requestTransfer.js` 事务后 |
| 转派被拒/接手 | `TRANSFER_DECLINED` / `TRANSFER_ACCEPTED` | 兼职消息中心 / 顾客可见 | P2 | 发起方/顾客 | 各 handler 事务后 |
| 转派过期 | `TRANSFER_EXPIRED` | 兼职消息中心 | **不做**（读路径惰性落库，发送会放大） | — | 禁止在 `_transfer-expire.js` 发送 |
| 复核结果 | 无订单事件（`RECOGNITION_REVIEW` 留言） | 有站内 NOTICE | P2 | 上传者 | `admin/_review.js` 非事务，需 try/catch |
| 自动完成/超时 | `AUTO_COMPLETED` / `TIMEOUT_CANCELLED` | 有 | 不做（cleanup 独立部署单元） | — | 需复制发送器 + 改其 config，成本高 |

## 3. 分场景可行性判断

| 场景 | 价值 | 额度成本 | 结论 | 理由 |
| :-- | :-- | :-- | :-- | :-- |
| 顾客：接单/取件/送达 | 高（离线触达核心） | 每单 1~3 条 | **P1a** | 用户下单后一次弹窗勾选 3 个模板 = 3 条额度，可覆盖一单；文案如实说明 |
| 顾客：异常 | 高 | 低频 | **P1b** | 异常需及时处理，且不是每单都有 |
| 兼职：转派邀请 | 高（当前最大盲区） | 每次转派 1 条 | **P1a** | 低频、需即时；目标兼职可提前在工作台授权 |
| 兼职：新订单 | 中 | 每单 1 条，量大 | **P2，不做主通道** | 30s 轮询已可用；订阅额度按单消耗，高峰期需反复授权，体验不可持续 |
| 顾客：取消/拒单 | 中 | 低频 | P2 | 可选，先看 P1 数据 |
| 复核结果 | 低 | 低频 | P2 | 站内 NOTICE 已可达；且需改造 `notifyUploader` 的「是否新写」返回值 |
| 团队变更（移除子队员） | 低 | 低频 | 不做 | 无站内通知通道，需新模板 + 新消息路径，成本高于收益 |
| 自动完成/超时 | 低 | 低频 | 不做 | cleanup 独立部署，需复制发送器并改权限，首版不背 |
| 解绑通知 | 低 | 低频 | 不做 | 站内 NOTICE 已覆盖 |

## 4. 推荐方案（分批，先口径后代码）

> 本文件只给设计与文件级清单，不写实现代码；每批仍按 AGENTS §5 的 DoD（`check.ps1` 退出码 0 + 真实输出）收口。

**M0 前置（用户执行，1~2 小时可出结论）**
1. 后台「功能-订阅消息-公共模板库」盘点：搜「快递/取件/代取/订单/异常/提醒」，记录模板 tid、标题、字段类型、`type`；确认工具类目下**没有**长期订阅入口。
2. 挑 3 个最贴近的模板尝试「选用/申请新增事项」；驳回则记录原文，P1 降级并登记欠账。
3. 确认小程序未开通微信支付（预期）、确认隐私指引现有收集项无需新增。

**M1 授权链路（不发送；可独立合并）**
- 裁决模板 ID 通道（Q1）→ 客户端能拿到 `tmplIds`。
- 新增 `utils/subscribe.js`（wx 包装 + 纯件：模板组装、`accept/reject/ban/filter` 文案与状态映射、CTA 显示判据），页面只调用一个方法。
- 授权入口：下单成功卡、顾客订单详情、兼职工作台/订单详情/转派区；切换会话（READONLY）隐藏；文案按 UX §8.4。
- 判据：纯件断言 + 页面静态接线；不弹真机。

**M2 服务端发送（4 个动作型触发点）**
- 新增 `cloudfunctions/api/lib/subscribe-message.js`：纯件（事件→模板/字段/落地页映射、发送闸 `enabled` + 模板 ID 非空 + `order.isTest` 跳过 + 目标 `users.status=ACTIVE` + 非删除中）、`ctx.cloud.openapi.subscribeMessage.send` 尽力而为（catch + 日志，绝不抛）。
- 接线：`runOrderAction` 事务后（接单/取件/送达/异常/取消）、`requestTransfer` 事务后、`_create` 事务后（P2）。
- 新增 `cloudfunctions/api/config.json` 声明 `permissions.openapi: ["subscribeMessage.send"]`；用户重新部署 `api`。
- 判据：扩 `tools/selftest-messages.js`（0 次/1 次/参数/失败不抛/重放不重发/测试数据不发）+ 扩 `tools/selftest-message-pages.js`（授权映射）。

**P2 / 不做**：兼职新单提醒主通道、转派过期发送、复核结果、团队变更、自动完成/超时、解绑、授权状态落库、任何"按人计数"的本地额度账本。

## 5. 待裁决（Q1~Q8；裁决后登记 CONTRACT §13）

| # | 问题 | 选项 | 建议 |
| :-- | :-- | :-- | :-- |
| Q1 | 模板 ID 如何到客户端 | A 公开配置增字段；B 新增读动作 | **A**（模板 ID 非密钥，改动最小；改 DATA_MODEL 一句 + 两处断言） |
| Q2 | config 键名/形状 | `subscribeTemplates`（DATA_MODEL/代码）vs `subscribe.templates`（ENGINEERING） | 统一为 `subscribeTemplates`，回写 ENGINEERING |
| Q3 | 模板范围 | 3 类（新订单/状态/异常）vs 增加转派/复核 | 首版 3 类 + 转派复用「新订单」语义；复核 P2 |
| Q4 | 模板 ID 维护路径 | 进 `admin.updateConfig` + 后台配置页 vs 控制台/部署脚本 | 参照 `aiFallback` 先例走控制台/部署脚本，后台暂只读 |
| Q5 | 是否落库「已授权次数」 | 是（新字段/新 action）vs 否 | **否**（平台管额度，43101 即降级；避免新集合/新动作） |
| Q6 | 首版触发点最小集 | 4 个（接单/取件/送达/转派）vs 更多 | 4 个 + 异常；其余 P2 |
| Q7 | 单环境发送策略 | `miniprogramState` 固定 `formal` vs 配置化；失败告警口径 | 固定 `formal`；模板 ID 为空时 fail-closed；失败只记日志 |
| Q8 | 额度预期与文案 | 一次授权只值一条，是否每单都提示 | 下单成功卡提示「可接收 1 条进度提醒」；详情页可再次授权 |

## 6. 工程改造清单（文件级；行数为当前工作树静态读数）

| 文件 | 性质 | 余量/风险 |
| :-- | :-- | :-- |
| `config/defaults.js`（152 行） | 改：模板 ID 字段 | 富余；改后必须 `node tools/sync-cloud-shared.js`（两云副本，禁止手写） |
| `config` 公开子集（`pickPublicConfig`） | 改：Q1=A 时增下发 | 同步改两处 selftest 断言 |
| `utils/subscribe.js`（新） | 新：wx 包装 + 纯件 | 导出必须有生产调用（#35） |
| `pkg-customer/pages/order-create/index.{js,wxml}`（403 行） | 改：成功卡加授权按钮 | +≤97 行 |
| `pkg-customer/pages/order-detail/index.js`（417 行） | 改：授权入口 | +≤83 |
| `pages/partner/workbench/index.js`（377 行） | 改：授权/转派入口 | +≤123 |
| `pkg-partner/pages/order-detail/index.js`（425 行） | 改：授权入口 | +≤75 |
| `cloudfunctions/api/lib/subscribe-message.js`（新） | 新：映射/闸/发送 | 单函数 ≤50 行；禁 `https://`/`fetch(` 字样（门禁 #25） |
| `handlers/order/_common.js`（267 行） | 改：事务后发送 | 富余；`runOrderAction` 出口唯一 |
| `handlers/order/_create.js`（442 行） | 改（P2）：事务后发送 | +≤58；先判 `isTest` |
| `handlers/order/requestTransfer.js` | 改：事务后发送 | 需处理 duplicated |
| `handlers/admin/_review.js`（87 行） | 改（P2）：`notifyUploader` 返回值 | 现状无 try/catch，需收敛 |
| `cloudfunctions/api/config.json`（新） | 新：云调用权限 | 平台要求；部署后生效（10 分钟缓存） |
| `tools/selftest-messages.js`（751 行/108 断言） | 改：发送断言 | +≤249；同步 `EXPECTED_ASSERTIONS` |
| `tools/selftest-message-pages.js`（570 行/149 断言） | 改：授权映射断言 | +≤430 |
| `tools/selftest-cloud-fixtures.js` | 改：`cloudStub` 扩 `subscribeMessage.send` | 与 msgSecCheck 同桩 |
| `utils/storage.js`（500 行） | **不动** | 顶格；授权引导不落本机存储 |

## 7. 判据与测试策略（零真实外呼）

- **不 mock 全局 `wx`**（ENGINEERING §6.3）：客户端纯件断言 + 页面静态接线；`api/client.js` transport 注入是唯一允许的桩。
- **服务端用 `cloud` 注入桩**：扩 `tools/selftest-cloud-fixtures.js` 的 `cloudStub`，记录调用参数；断言：
  1. `enabled=false` / 模板 ID 空 → 0 次外呼；
  2. 测试订单 `isTest` / 测试账号 / `users.status!=ACTIVE` / 已注销 → 0 次；
  3. 正常事件 → 恰好 1 次，参数键集合与字段长度合规；
  4. `send` 抛错或返回非 0 → 业务成功、不抛、不写用户可见错误；
  5. 重放（`duplicated`）→ 0 次；
  6. 43101 → 静默（不重试、不告警刷屏）。
- **变异电池**（安全面）：去掉 `isTest` 闸 / 去掉 `enabled` 闸 / 事务内发送 / 失败抛出 / 模板 ID 硬编码，均应被套件捕获并留首红证据。
- **门禁联动**：`shared/actions.js` 若加动作需同步 `tools/lib/project.js` 与 CONTRACT §5.3（#13）；改 `config/defaults.js` 需 sync（#17）；新增导出必须有生产调用（#35）；`check.ps1` 判据/套件条数不动（39/12/38）。

## 8. 隐私与合规影响

- **不新增采集**：订阅消息只把已有订单状态/编号/站点推给本人；不采集新字段、不新增第三方。
- **内容红线**：通知卡片不得含取件码、宿舍号、手机尾号、头像/昵称、截图、识别原文（AGENTS §7；分享卡同口径）。可用：订单号（`character_string`）、状态（`phrase`）、站点（`thing`）、时间（`date`/`time`）。
- **现有披露**：隐私文本已写「微信订阅消息为可选能力，仅在你点击授权后发送订单状态提醒，拒绝不影响站内进度」（`pkg-customer/parts/privacy-text.js:54`、`docs/privacy/隐私保护指引.md:48`、`docs/privacy/补充文档.txt:28`）——覆盖顾客状态提醒；若加兼职新单/转派，需同批回写三处与 CONTRACT §11.2。
- **隔离**：`isTest` 订单/测试账号不发送；READONLY 会话不展示授权入口、不发送；注销/删除中用户不发送。
- **平台声明**：一次性订阅无需额外能力申请；模板选择在后台完成，不需要新增隐私接口声明项（待控制台核实）。

## 9. 风险与不做项

| # | 风险 | 处置 |
| :-- | :-- | :-- |
| R1 | 工具类目下无匹配模板，申请被驳回 | M0 先验证；失败则 P1 不成立，保留站内通道并登记欠账 |
| R2 | 模板 ID 通道未裁决就写代码 | 先裁决 Q1；裁决前不动 `config/defaults.js`/`shared/actions.js` |
| R3 | 一次性额度被误解为「一次授权长期有效」 | 文案如实说明；每单最多 3 条；详情页可再次授权 |
| R4 | 事务内发送导致业务回滚/重复 | 只在事务提交后 best-effort；重放分支不发 |
| R5 | 读路径惰性落库（转派过期）触发发送 | 明确禁止；只允许动作型触发点 |
| R6 | 单环境无 staging，误开发送直达真实用户 | `enabled` 默认 false + 模板 ID 空 fail-closed；测试账号不发送 |
| R7 | `miniprogramState` 选错导致点卡片落到错误版本 | 固定 `formal`；发布顺序：先上有落地页的现网版本，再启用模板 |
| R8 | 云调用权限缺失（`-604101`） | `config.json` 声明 + 部署后等 10 分钟缓存；RUNBOOK 写步骤 |
| R9 | 43107 封禁/45168 敏感词 | 文案过审；不营销；失败只记日志并监控 |
| R10 | cleanup 独立部署无法复用发送器 | 首版不做自动完成/超时通知 |

## 10. 待控制台/真机核实（用户执行，agent 不代勾）

| # | 事项 | 证据 |
| :-- | :-- | :-- |
| 1 | 公共模板库：工具类目下一次性模板清单；搜快递/取件/代取/订单/异常 | tid/标题/字段截图 |
| 2 | 申请新增模板/事项的结果与驳回原文 | 驳回截图 |
| 3 | 长期订阅 tab 是否存在（预期无） | 截图 |
| 4 | 微信支付是否开通（预期否） | 状态截图 |
| 5 | 云函数 `config.json` 权限声明后真实下发一条 | 发送返回 + 服务通知截图 |
| 6 | 43101/41030/47003 三类失败的真实表现 | 日志截图 |
| 7 | 「总是保持以上选择」后不弹窗但仍需点击 | 真机录屏 |
| 8 | 服务通知卡片展示、点击跳转 `page?query`、拒收后行为 | iOS/Android 各一台 |

## 11. 验收判据（分机器/人）

- **机器**：`check.ps1` 4 步退出码 0；`selftest-messages`/`selftest-message-pages` 新增断言全 PASS；变异电池首红→SHA256 还原复绿；`config/defaults.js` 与两云副本 hash 一致；`config.getPublic` 不含模板 ID（若 Q1=A 则只含 ID、不含其它治理键）。
- **人（真机）**：授权弹窗、返回结果、服务通知卡片、点击跳转、拒收后不再打扰、拒绝不阻断下单——按 QA 纪律由用户点检，agent 不代勾、不代宣布通过。

## 12. 证据与来源

**官方文档**：[订阅消息总览](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html) · [开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html) · [新版一次性指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-2.html) · [requestSubscribeMessage](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html) · [sendMessage](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage.html) · [云调用](https://developers.weixin.qq.com/doc/oplatform/developers/dev/cloudCall.html) · [云托管接入指引](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/scene/deploy/subscribe.html) · [运营规范](https://developers.weixin.qq.com/miniprogram/product/) · [腾讯客服·个人类型功能](https://kf.qq.com/faq/170328fIJR3q170328EFvuya.html) · [官方社区·工具类目无长期订阅](https://developers.weixin.qq.com/community/minihome/doc/00026eccfdcde83f6983a221561800)。

**仓库证据**：`docs/contract/V4_CONTRACT.md:122,466` · `docs/ux/V4_UX_CUSTOMER.md:701-704,722` · `docs/data/V4_DATA_MODEL.md:264` · `docs/engineering/V4_ENGINEERING.md:197,1005` · `docs/governance/V4_TECH_DEBT.md:21` · `config/defaults.js:63,129-140` · `cloudfunctions/api/handlers/config/_common.js:78` · `handlers/admin/updateConfig.js:33-48` · `handlers/order/_common.js:121-224` · `handlers/order/_create.js:386,392-401` · `handlers/order/_transfer.js:395` · `handlers/message/list.js:127-181` · `handlers/message/_common.js:1-2,96-104` · `pkg-customer/parts/privacy-text.js:54`。

## 附录 A：追问——「每次下单询问 + 不再提醒」能否实现无感通知？

> 2026-11-08 用户追问。结论：**能减少打扰，但不能把一次性订阅变成长期订阅**；「无感」的边界必须写清。

### A.1 三种「不再提醒」语义不同

| 用户看到的「不再提醒」 | 实际效果 | 能否继续收到通知 |
| :-- | :-- | :-- |
| 平台弹窗里的「总是保持以上选择，不再询问」 | 后续 `wx.requestSubscribeMessage` **不弹窗**，沿用上次 accept/reject；但仍需点击触发，且每次调用只加 1 条/模板额度 | 能（每单点击补额度）；需真机验证每次调用是否稳定 +1 |
| 我们自己做的「不再提醒」开关（不再调用授权） | 不再产生新额度；已积累额度用完后 43101 | 不能（额度耗尽后停发） |
| 用户拒绝且未勾「总是保持」 | 下次仍会弹窗 | 本次无额度 |
| 用户勾「总是保持」并拒绝 | 后续静默 reject，不弹窗 | 不能，直到用户去小程序设置里改 |

### A.2 可行方案：把「询问」挂在下单点击上

- 首次：提交按钮的点击里先调 `wx.requestSubscribeMessage([3 个模板])` → 用户勾选「总是保持」并允许 → 本单得 3 条额度。
- 之后：同一按钮点击里再调，**不弹窗**，静默 +3 条；用户对「补额度」无感。
- 关键限制：调用必须在**点击回调的同步上下文**里（不能 `await` 完下单接口再调，手势可能丢失）；如果放在「提交成功卡」的按钮上，则每单多一次点击。
- 因此「无感」= **首次授权后不再弹窗**，不是「授权一次永久有效」；每单仍需那一次点击（提交按钮本来就要点）。

### A.3 不建议把「不再提醒」做成停止授权

- 停止调用 = 停止额度 = 停止通知；文案必须写「关闭后将收不到微信提醒，站内进度仍可查看」，否则是假承诺。
- 更稳的做法：不提供应用内「不再提醒」，只用平台自带的「总是保持」+ 系统设置；应用内只提供「开启提醒」。
- 运营规范：不能「订阅后才能继续下一步」；授权失败/拒绝必须不阻断下单。

### A.4 必须真机验证的三件事

1. 勾选「总是保持」后，每次调用是否稳定新增 1 条/模板额度（官方文档只写「不弹窗、保持之前的选择」，未明写「每次 +1」；用 43101 边界验证）。
2. 一次弹窗勾选 3 个模板是否各 +1。
3. 在「提交订单」按钮的 tap 回调里先调授权、再调下单接口，是否被判定为手势（不同基础库/机型）。

> 若第 1 条不成立（平台只认首次授权、后续调用不加额度），则「每单静默补额度」方案不成立，只能退回「首次授权 + 额度耗尽后提示再授权」。

## 附录 B：成本口径（2026-11-08）

> 口径：微信侧没有按条计费项；真正花钱的是**云开发资源**，而本项目已在用云开发。下列数字取自官方计费页（2026-11-08 读取），实际以控制台「配额方案 / 账单」为准。

| 项 | 计费方式（官方） | 对本项目的增量 |
| :-- | :-- | :-- |
| 订阅消息能力 / 模板申请 / 下发接口 | 官方未列出按条计费项 | 0 |
| 云函数调用 | 13.3 资源点/万次（≈0.0133 元/万次） | 发送放在现有订单 handler 内则**不新增调用**；单独函数才按次计 |
| 云开发 API 调用 | 200 资源点/万次（≈0.2 元/万次） | 若每条 send 计一次：3 条/单 ≈ 0.00006 元 |
| 云函数资源使用量 | 0.11108 资源点/GBs（≈0.00011108 元/GBs） | 每单 3 条 × 约 0.1~0.3 秒 ≈ 0.00001 元级 |
| 云开发基础套餐 | 19.9 元/月，含 40,000 资源点/月（原 39 元，5 折长期） | 与订阅消息无关的固定成本；现有环境已需要 |
| 免费云环境 | 开发期免费；上线后第 15 天到期（活动至 2026-12-31） | 上线后需转付费，与订阅消息无关 |
| 短信（替代通道） | 50 资源点/条（≈0.05 元/条） | 不采用 |
| 认证 | 订阅消息不要求新增认证 | 0 |

- **量级**：按 1,000 单/月、每单 3 条估算，资源增量在 0.1 元以内；真正的代价是开发批次（M1+M2）、模板审核返工与「一次授权一条」的体验设计，不是钱。
- **配额**：1kw/日（未开通微信支付）是平台下发上限，不是计费项。
- **取数**：云开发控制台「设置-环境设置-配额方案 / 账单」；官方计费说明页 <https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/billing/>。
